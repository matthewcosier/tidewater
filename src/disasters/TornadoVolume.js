import { Mesh, BoxGeometry, Vector4 } from '../engine/index.js';
import { Material, LAYERS, ShaderModule } from '../engine/webgpu.js';
import { FUNNEL, FUNNEL_WGSL } from './TornadoFunnel.js';
import { STORM, STORM_WGSL } from './StormModel.js';


const f = ( x ) => {

	const s = String( x );
	return /[.e]/.test( s ) ? s : s + '.0';

};

// Rain of the storm inside the volume (prefix `tornadoRain`; reads the material's noise texture).
const RAIN_WGSL = /* wgsl */`
// Extinction of the rain at p, 1/m (0.312 R^0.67 per km, Atlas 1953, from StormModel's rain rate).
// ground: world height of the ground under the tornado, m; baseH: the storm base above it, m.
// The shafts fall 9 m/s and lean 0.35 m per m of height (the foot is where the model says it rains,
// so the camera's rain and the curtain's foot agree); the edge is torn 130 m either way.
fn tornadoRainSigma( p: vec3f, ground: f32, baseH: f32, clock: f32, anchor: vec4f, rain: vec2f ) -> f32 {
	let h = p.y - ground;
	let rq = p.xz - anchor.zw * ( 0.35 * h );
	let shaft = textureSampleLevel( tornadoNoise, smpLinearRepeat, vec3f( rq * 0.004, h * 0.0005 + clock * 0.0045 ), 0.0 );
	let rate = stormRain( rq + ( shaft.rb - 0.5 ) * 260.0, anchor, rain );
	let fall = smoothstep( 0.0, 80.0, baseH - 60.0 - h ) * ( 0.75 + 0.25 * smoothstep( 0.0, 300.0, h ) );
	return stormRainExtinction( rate ) * fall * ( 0.35 + 1.3 * shaft.g );
}
fn tornadoRainHash( p: vec2f ) -> f32 {
	return fract( sin( dot( p, vec2f( 12.9898, 78.233 ) ) ) * 43758.5453 );
}
// Rain on the camera: streaks in three shells 3, 7 and 16 m out. Each is a drop falling 9 m/s drawn
// over a 1/30 s exposure (0.3 m), one or two pixels wide, in angular columns 12 mrad apart, 2.5 m
// between drops in a column. amount 0..1 (full from 60 mm/h). Returns the streak coverage 0..1.
fn tornadoRainStreaks( ro: vec3f, rd: vec3f, tScene: f32, clock: f32, amount: f32 ) -> f32 {
	let flat = max( length( rd.xz ), 0.05 );
	let phi = atan2( rd.z, rd.x );
	var streak = 0.0;
	for ( var k = 0; k < 3; k ++ ) {
		let dist = 3.0 * pow( 2.3, f32( k ) );
		let tk = dist / flat;
		if ( tk < tScene ) {
			let c = phi / 0.012 + 37.0 * f32( k );
			let column = floor( c );
			// each column's drops fall a little off its middle, so the streaks are not an even comb
			let across = ( fract( c ) - 0.5 + 0.7 * ( tornadoRainHash( vec2f( column, 7.0 + f32( k ) ) ) - 0.5 ) ) * 0.012 / 0.0011;
			let v = ( ro.y + rd.y * tk + ${ f( STORM.fallSpeed ) } * clock ) / 2.5 + 53.0 * tornadoRainHash( vec2f( column, f32( k ) ) );
			let along = fract( v ) / 0.12;
			if ( along < 1.0 && tornadoRainHash( vec2f( column, floor( v ) ) ) < 0.25 + 0.75 * amount ) {
				streak += exp( - across * across ) * sin( 3.14159 * along ) * ( 1.0 - 0.2 * f32( k ) );
			}
		}
	}
	return clamp( streak, 0.0, 1.0 );
}
`;

const LIGHT_WGSL = /* wgsl */`
// Extinction at the funnel's core, 1/m: 10 m of condensate has optical depth 0.9, so a 30-100 m wide
// funnel is opaque in the middle and see-through over its outer edge band (game choice inside the
// 0.05-0.2 1/m of cumulus cloud water, Bohren and Huffman 1983 via Wikipedia "Cloud optical depth").
const FUNNEL_SIGMA = 0.09;
// drawn condensation radius over the dry estimate (FUNNEL.drawnWidth: declared, the tip does not move)
const FUNNEL_DRAWN_WIDTH = ${ FUNNEL.drawnWidth.toFixed( 3 ) };
fn tornadoFunnelRadius( h: f32, H: f32, kappa: f32, rc: f32, rope: f32, cap: f32 ) -> f32 {
	let x = funnelX( kappa * ( H - h ) );
	if ( x <= 0.0 ) { return 0.0; }
	let rx = rc * FUNNEL_DRAWN_WIDTH * x * ( 1.0 - 0.55 * rope );
	return cap * ( 1.0 - exp( - rx / cap ) );
}
// Optical depth from p toward the key light l through the smooth funnel (no noise): three steps at
// 0.3, 0.8 and 1.6 local radii. ALU only, no texture fetch.
fn tornadoLightDepth( p: vec3f, l: vec3f, rf: f32, ground: f32, H: f32, kappa: f32, rc: f32, rope: f32, cap: f32, centre: vec2f, tilt: vec2f ) -> f32 {
	var tau = 0.0;
	var last = 0.0;
	for ( var k = 0; k < 3; k ++ ) {
		let d = rf * select( select( 1.6, 0.8, k == 1 ), 0.3, k == 0 );
		let q = p + l * d;
		let h = q.y - ground;
		let s = clamp( 1.0 - h / H, 0.0, 1.0 );
		let rad = length( q.xz - ( centre + tilt * s * s ) );
		let r = tornadoFunnelRadius( h, H, kappa, rc, rope, cap );
		tau += FUNNEL_SIGMA * 0.8 * ( 1.0 - smoothstep( r * 0.6, r * 1.1 + 1.5, rad ) ) * ( d - last );
		last = d;
	}
	return tau;
}
`;

export class TornadoVolume {

	constructor( app, noise ) {

		const depth = () => app.sceneRenderer.opaqueCopy.depthTexture;
		const funnel = new ShaderModule( { name: 'tornadoFunnel', code: FUNNEL_WGSL } );
		const light = new ShaderModule( { name: 'tornadoFunnelLight', code: LIGHT_WGSL } );
		const shape = new ShaderModule( { name: 'stormShape', code: STORM_WGSL } );
		const rain = new ShaderModule( { name: 'tornadoRain', deps: [ shape ], code: RAIN_WGSL } );
		this.material = new Material( {
			name: 'Tornado funnel, debris cloud and wall cloud', modules: [ funnel, light, shape, rain ], lit: false, transparent: true, blending: 'premultiplied', side: 'back', depthWrite: false, depthTest: false,
			defines: { VELOCITY_COVERAGE: 1 },
			textures: { tornadoNoise: noise, tornadoDepth: { texture: depth } },
			uniforms: { base: [ 'vec4f', new Vector4() ], shape: [ 'vec4f', new Vector4( 1, 600, 1e6, 0 ) ], trail: [ 'vec4f', new Vector4() ], wall: [ 'vec4f', new Vector4( 1000, 850, 1750, 3000 ) ], storm: [ 'vec4f', new Vector4() ], drift: [ 'vec4f', new Vector4() ],
				shield: [ 'vec4f', new Vector4( 0, 0, 1e9, 0 ) ], sdrift: [ 'vec4f', new Vector4() ], anchor: [ 'vec4f', new Vector4( 0, 0, 1, 0 ) ], rain: [ 'vec4f', new Vector4( 1000, 0, 0, 0 ) ], flash: [ 'vec4f', new Vector4() ],
				bolt: [ 'vec4f', new Vector4() ], boltA: [ 'vec4f', new Vector4() ], boltB: [ 'vec4f', new Vector4() ], boltC: [ 'vec4f', new Vector4() ], boltD: [ 'vec4f', new Vector4() ], boltE: [ 'vec4f', new Vector4() ] },
			vertex: /* wgsl */`
				let half = vec3f( 1.5 * mat.wall.w, 0.5 * mat.wall.z + 10.0, 1.5 * mat.wall.w );
				let centre = vec3f( mat.base.x, mat.base.y - 10.0 + half.y, mat.base.z );
				v.useWorld = true;
				v.worldPos = centre + v.position * 2.0 * half;
				v.prevWorldPos = v.worldPos;
				v.worldNormal = v.normal;
			`,
			output: /* wgsl */`
				let ro = frame.cameraPos;
				let rd = normalize( in.P - ro );
				let pixel = vec2i( clamp( in.pixel * frame.invResolution, vec2f( 0.0 ), vec2f( 0.9999 ) ) * vec2f( textureDimensions( tornadoDepth ) ) );
				// view depth grows by along per metre of ray
				let along = max( 1e-4, - ( frame.view * vec4f( rd, 0.0 ) ).z );
				let tScene = viewDepth( textureLoad( tornadoDepth, pixel, 0 ) ) / along;
				let jitter = fract( 52.9829189 * fract( dot( in.pixel + 5.588238 * f32( frame.frameIndex % 64u ), vec2f( 0.06711056, 0.00583715 ) ) ) );
				let ground = mat.base.y;
				let clock = mat.base.w;
				let centre = mat.base.xz;
				let rc = mat.shape.x;
				let H = mat.shape.y;
				let kappa = mat.shape.z;
				let rope = mat.shape.w;
				let tilt = mat.trail.xy;
				let spin = mat.trail.z;
				let dr = mat.trail.w;
				let dh = max( mat.storm.z, 1.0 );
				let load = mat.storm.w;
				let toLum = vec3f( 0.2126, 0.7152, 0.0722 );
				let sky = mix( frame.skyIrradiance, dot( frame.skyIrradiance, toLum ) * vec3f( 0.95, 1.0, 0.94 ), 0.75 );
				let sun = frame.sunColor;
				// light from beyond the storm: the clear horizon outside the deck lights cloud faces from the side
				let beyond = mix( frame.horizonColor, vec3f( dot( frame.horizonColor, toLum ) ), 0.5 );
				// Key light for the funnel: that horizon light, from the sun's azimuth (where the sky beyond the
				// storm is brightest), 17 degrees up. Declared: under the deck the sun itself is down to 15 %.
				let sunXZ = frame.sunDir.xz;
				let azimuth = select( vec2f( 0.6, 0.8 ), normalize( sunXZ ), dot( sunXZ, sunXZ ) > 1e-4 );
				let key = normalize( vec3f( azimuth.x, 0.3, azimuth.y ) );
				// Henyey-Greenstein relative to isotropic, g 0.6 forward and -0.2 back (cloud droplets scatter
				// forward): the rim facing the light glows when the camera looks toward it
				let cosKey = dot( rd, key );
				let phase = 0.7 * 0.64 / pow( 1.36 - 1.2 * cosKey, 1.5 ) + 0.3 * 0.96 / pow( 1.04 + 0.4 * cosKey, 1.5 );
				var T = 1.0;
				var L = vec3f( 0.0 );
				let d = rd.xz;
				let A = max( dot( d, d ), 1e-8 );

				// ---- funnel and debris skirt: a vertical cylinder round the middle of the trailing axis
				let bound = max( rc * 9.0, dr * 1.85 ) + 0.5 * length( tilt ) + 5.0;
				let cap = 0.5 * bound;
				let o = ro.xz - ( centre + 0.5 * tilt );
				let B = dot( o, d );
				let disc = B * B - A * ( dot( o, o ) - bound * bound );
				if ( disc > 0.0 && kappa < 1e5 ) {
					let sq = sqrt( disc );
					var t0 = ( - B - sq ) / A;
					var t1 = ( - B + sq ) / A;
					let lo = ground - 2.0;
					let hi = ground + H + 30.0;
					if ( abs( rd.y ) > 1e-6 ) {
						let ya = ( lo - ro.y ) / rd.y;
						let yb = ( hi - ro.y ) / rd.y;
						t0 = max( t0, min( ya, yb ) );
						t1 = min( t1, max( ya, yb ) );
					} else if ( ro.y < lo || ro.y > hi ) { t1 = - 1.0; }
					t0 = max( t0, 0.0 );
					t1 = min( t1, tScene );
					if ( t1 > t0 ) {
						let dt = ( t1 - t0 ) / 40.0;
						for ( var i = 0; i < 40; i ++ ) {
							let p = ro + rd * ( t0 + ( f32( i ) + jitter ) * dt );
							let h = p.y - ground;
							// the rope's lower end trails the parent cloud (quadratic bend, top fixed)
							let s = clamp( 1.0 - h / H, 0.0, 1.0 );
							let rel = p.xz - ( centre + tilt * s * s );
							let rad = length( rel );
							// Texture frame turning with the vortex and sheared into a helix: one tile round the axis (64
							// texels: 1-2 m on a 30-100 m wide funnel), 1.5 extra turns over 600 m (the slant of the banding
							// on real funnels), 700 m of height per tile so the detail channel draws vertical striations
							// 20-90 m long, rising 10 m/s with the updraft.
							let turn = ( atan2( rel.y, rel.x ) - clock * spin ) * 0.1591549 + h * 0.0025;
							let nz = textureSampleLevel( tornadoNoise, smpLinearRepeat, vec3f( turn, h * 0.0014 - clock * 0.014, rad * 0.006 ), 0.0 );
							var sigma = 0.0;
							var colour = vec3f( 0.0 );
							// condensation inside the Burgers-Rott radius where the core deficit reaches rho g ( H - h )
							let f = kappa * ( H - h );
							let r0 = tornadoFunnelRadius( h, H, kappa, rc, rope, cap );
							if ( r0 > 0.0 ) {
								let rag = textureSampleLevel( tornadoNoise, smpLinearRepeat, vec3f( turn * 3.0 + 0.21, h * 0.006 - clock * 0.03, rad * 0.02 ), 0.0 );
								let rf = r0 * ( 0.88 + 0.3 * nz.r + 0.2 * ( rag.g - 0.5 ) );
								// the striations reach into the edge band: streaks of thinner and thicker cloud down its length
								let fringe = smoothstep( rf * 0.7, rf * 1.15, rad );
								let edge = ( 1.0 - smoothstep( rf * ( 0.7 + 0.1 * nz.g ), rf * 1.25 + 2.0, rad ) ) * mix( 1.0, smoothstep( 0.2, 0.7, rag.b ), fringe );
								let band = smoothstep( 0.1, 0.9, 0.5 + 0.5 * sin( 31.415927 * turn + 6.0 * nz.r ) );
								let fineS = 0.5 + 0.5 * sin( 125.66371 * turn + 9.0 * rag.r );
								let stria = ( 0.35 + 1.3 * nz.g ) * ( 0.9 + 0.45 * band ) * ( 0.8 + 0.4 * fineS );
								// thins over the last 6 % of deficit at the tip, and dissolves into the wall cloud over its top
								// 220 m: this march composites in front of the base, so a flare left there drew a bulb on top
								let fade = smoothstep( 0.0, 0.06, FUNNEL_LN2 - f ) * ( 1.0 - smoothstep( H - 160.0, H - 10.0, h ) );
								let cond = FUNNEL_SIGMA * edge * stria * fade;
								if ( cond > 1e-5 ) {
									let shadow = exp( - tornadoLightDepth( p, key, rf, ground, H, kappa, rc, rope, cap, centre, tilt ) );
									// skylight reaches the core less (its own depth into the funnel)
									let skyIn = 0.22 + 0.4 * exp( - FUNNEL_SIGMA * 0.5 * max( rf - rad, 0.0 ) );
									let lit = ( ( beyond * 0.35 + sun * 0.25 ) * shadow * min( phase, 2.0 ) + sky * skyIn ) * ( 0.7 + 0.6 * nz.g ) * ( 1.0 - 0.32 * band ) * ( 0.86 + 0.28 * fineS ) * ( 0.92 + 0.16 * rag.g );
									// slate grey condensate, browner low down where the vortex has lofted soil into it
									// dust striations: the bands carry more of it (dust follows the denser inflow sheets)
									let soil = ( 1.0 - smoothstep( 0.0, 1.6 * dh, h ) ) * load * ( 0.45 + 0.3 * band );
									sigma += cond;
									colour += cond * mix( vec3f( 0.62, 0.65, 0.66 ), vec3f( 0.52, 0.45, 0.37 ), soil ) * lit * ( 1.0 - 0.35 * soil );
								}
							}
							let hr = h / dh;
							if ( load > 0.0 && hr < 1.5 && rad < dr * 2.1 ) {
								let nd = textureSampleLevel( tornadoNoise, smpLinearRepeat, vec3f( turn + 0.5, h * 0.008 - clock * 0.04, rad * 0.012 ), 0.0 );
								let reach = dr * ( 1.5 - 0.9 * min( hr, 1.0 ) ) * ( 0.75 + 0.5 * nd.b );
								let skirt = ( 1.0 - smoothstep( reach * 0.4, reach, rad ) ) * exp( - 1.5 * max( hr, 0.0 ) ) * ( 1.0 - smoothstep( 1.1, 1.5, hr ) );
								let debris = skirt * load * ( 0.35 + 1.5 * nd.b * nd.b ) * 0.07;
								sigma += debris;
								colour += debris * vec3f( 0.68, 0.6, 0.49 ) * ( sky * ( 0.75 + 0.3 * clamp( hr, 0.0, 1.0 ) ) + beyond * 0.5 * min( phase, 2.5 ) );
							}
							if ( sigma > 1e-5 ) {
								let ext = exp( - sigma * dt );
								L += T * ( colour / sigma ) * ( 1.0 - ext );
								T *= ext;
								if ( T < 0.01 ) { break; }
							}
						}
					}
				}

				// ---- rain (StormModel.js stormRain: the discs the camera's rain and the telemetry read): the
				// forward-flank core ahead and left of the tornado and the hook wrapped round its rear, from the
				// ground to the deck base, inside one cylinder round both. Lit by the sky light under the deck and
				// the light from beyond it, like the rest of the storm, and by lightning. Two marches of 12 steps:
				// rain between the camera and the tornado's axis goes in front of what has been marched so far
				// (the funnel), the rest behind it. The first rain curtain was one flat grey cylinder behind the funnel.
				if ( mat.rain.y > 0.002 ) {
					let fwd = mat.anchor.zw;
					let left = vec2f( fwd.y, - fwd.x );
					let coreC = mat.anchor.xy + ( fwd * ${ f( STORM.coreAhead ) } + left * ${ f( STORM.coreLeft ) } ) * mat.rain.x;
					let hookC = mat.anchor.xy + ( fwd * ${ f( - STORM.hookBehind ) } + left * ${ f( STORM.hookLeft ) } ) * mat.rain.x;
					let rr = 0.5 * length( coreC - hookC ) + ${ f( Math.max( STORM.coreRadius, STORM.hookRadius ) ) } * mat.rain.x + 130.0;
					let orr = ro.xz - 0.5 * ( coreC + hookC );
					let Br = dot( orr, d );
					let discr = Br * Br - A * ( dot( orr, orr ) - rr * rr );
					let rainLit = vec3f( 0.52, 0.57, 0.62 ) * ( sky + beyond * 0.06 ) + vec3f( 0.78, 0.86, 1.0 ) * ( mat.flash.z * 0.02 );
					var Lf = vec3f( 0.0 );
					var Tf = 1.0;
					var r0u = 0.0;
					var r1u = min( tScene, 12000.0 );
					if ( discr > 0.0 ) {
						let sq = sqrt( discr );
						r0u = max( r0u, ( - Br - sq ) / A );
						r1u = min( r1u, ( - Br + sq ) / A );
						let topY = ground + mat.wall.y - 60.0;
						if ( abs( rd.y ) > 1e-6 ) {
							let ya = ( ground - ro.y ) / rd.y;
							let yb = ( topY - ro.y ) / rd.y;
							r0u = max( r0u, min( ya, yb ) );
							r1u = min( r1u, max( ya, yb ) );
						}
					} else { r1u = - 1.0; }
					let split = clamp( dot( centre - ro.xz, d ) / A, r0u, max( r0u, r1u ) );
					if ( r1u > r0u && split > r0u ) {
						let du = ( split - r0u ) / 12.0;
						for ( var i = 0; i < 12; i ++ ) {
							let sigma = tornadoRainSigma( ro + rd * ( r0u + du * ( f32( i ) + jitter ) ), ground, mat.wall.y, clock, mat.anchor, mat.rain.xy );
							let ext = exp( - sigma * du );
							Lf += Tf * rainLit * ( 1.0 - ext );
							Tf *= ext;
						}
					}
					// rain on the camera (sdrift.w: the rate at the camera, mm/h): streaks in front of everything
					if ( mat.sdrift.w > 0.0 ) {
						let amount = clamp( mat.sdrift.w / 60.0, 0.0, 1.0 );
						let a = 0.4 * sqrt( amount ) * tornadoRainStreaks( ro, rd, tScene, clock, amount );
						Lf = Lf * ( 1.0 - 0.4 * a ) + ( rainLit * 2.4 + beyond * 0.5 ) * a;
						Tf *= 1.0 - 0.4 * a;
					}
					L = Lf + Tf * L;
					T *= Tf;
					if ( r1u > split && T > 0.01 ) {
						let du = ( r1u - split ) / 12.0;
						for ( var i = 0; i < 12; i ++ ) {
							let sigma = tornadoRainSigma( ro + rd * ( split + du * ( f32( i ) + jitter ) ), ground, mat.wall.y, clock, mat.anchor, mat.rain.xy );
							let ext = exp( - sigma * du );
							L += T * rainLit * ( 1.0 - ext );
							T *= ext;
						}
					}
				}

				// ---- storm base and wall cloud: a slab from the wall-cloud base to the deck top
				let Tbolt = T; // transmittance in front of the deck, for the lightning channel under it
				var u0 = 0.0;
				var u1 = min( tScene, 12000.0 );
				let deckLo = ground + H - 230.0; // the lowest lobe: wall-cloud base - 60 - 90 - 70 m
				let deckHi = ground + mat.wall.z;
				if ( abs( rd.y ) > 1e-6 ) {
					let ya = ( deckLo - ro.y ) / rd.y;
					let yb = ( deckHi - ro.y ) / rd.y;
					u0 = max( u0, min( ya, yb ) );
					u1 = min( u1, max( ya, yb ) );
				} else if ( ro.y < deckLo || ro.y > deckHi ) { u1 = - 1.0; }
				let deckC = centre + mat.drift.zw;
				let wallC = centre + mat.drift.xy;
				let deckR = 1.2 * mat.wall.w;
				let od = ro.xz - deckC;
				let Bd = dot( od, d );
				let discd = Bd * Bd - A * ( dot( od, od ) - deckR * deckR );
				if ( discd > 0.0 ) {
					let sq = sqrt( discd );
					u0 = max( u0, ( - Bd - sq ) / A );
					u1 = min( u1, ( - Bd + sq ) / A );
				} else { u1 = - 1.0; }
				if ( u1 > u0 && mat.storm.x > 0.002 && T > 0.01 ) {
					let span = u1 - u0;
					// the storm's own cover (arrival edge and breaks: stormCover on stormField, as the sky pass), every fourth step
					var shieldCover = 1.0;
					for ( var i = 0; i < 32; i ++ ) {
						// t = u0 + span a^2: step i covers span ( 2 a + 1 / 32 ) / 32
						let a = ( f32( i ) + jitter ) / 32.0;
						let du = span * ( 2.0 * a + 0.03125 ) / 32.0;
						let p = ro + rd * ( u0 + span * a * a );
						let h = p.y - ground;
						let rel = p.xz - centre;
						let rad = length( rel );
						if ( i % 4 == 0 ) { shieldCover = stormCover( p.xz, mat.shield, stormField( p.xz + mat.sdrift.xy ) ); }
						// the wall cloud turns slowly (declared 0.035 rad/s: a lap in 3 min), the deck does not
						let near = 1.0 - smoothstep( mat.wall.x * 0.6, mat.wall.x * 1.3, rad );
						let turnW = clock * 0.035 * near;
						let q = vec2f( rel.x * cos( turnW ) - rel.y * sin( turnW ), rel.x * sin( turnW ) + rel.y * cos( turnW ) );
						let lump = textureSampleLevel( tornadoNoise, smpLinearRepeat, vec3f( q * 0.0006, h * 0.0012 ), 0.0 );
						let fine = textureSampleLevel( tornadoNoise, smpLinearRepeat, vec3f( q * 0.0025, h * 0.004 ) + vec3f( 0.37 ), 0.0 );
						let radW = length( p.xz - wallC );
						let rim = mat.wall.x * ( 0.7 + 0.45 * lump.r );
						let inWall = ( 1.0 - smoothstep( rim * 0.9, rim, radW ) ) * mat.storm.y;
						let baseH = mix( mat.wall.y, H, inWall );
						let rough = mix( 1.0, 0.35, inWall );
						let under = baseH - 60.0 + rough * ( 180.0 * ( lump.r - 0.5 ) - 70.0 * lump.b * fine.b ) + 0.045 * max( radW - rim, 0.0 );
						let bottom = smoothstep( under, under + mix( 140.0, 35.0, inWall ), h );
						let top = 1.0 - smoothstep( mat.wall.z - 300.0, mat.wall.z, h );
						let radD = length( p.xz - deckC );
						let lobe = textureSampleLevel( tornadoNoise, smpLinearRepeat, vec3f( ( p.xz - deckC ) * 0.00012, 0.5 ), 0.0 ).r;
						let edge = 1.0 - smoothstep( mat.wall.w * ( 0.5 + 0.3 * lobe + 0.15 * lump.r ), mat.wall.w * ( 0.85 + 0.25 * lobe + 0.1 * lump.r ), radD );
						let cover = smoothstep( 0.3, 0.6, lump.r * 0.6 + fine.g * 0.4 + 0.25 * inWall + 0.1 );
						let sigma = bottom * top * edge * cover * mat.storm.x * 0.02 * shieldCover * shieldCover;
						if ( sigma > 1e-6 ) {
							let ext = exp( - sigma * du );
							let hf = clamp( ( h - under ) / max( mat.wall.z - under, 1.0 ), 0.0, 1.0 );
							let outside = smoothstep( 0.35 * mat.wall.w, mat.wall.w, radD );
							let lit = sky * mix( 0.4, 0.9, hf ) * ( 0.55 + 0.9 * lump.b * fine.r ) + beyond * ( 0.09 + 0.22 * outside ) + sun * 0.05 * phase;
							// lightning inside the deck: a glow round the flash
							let fo = p.xz - mat.flash.xy;
							let glow = vec3f( 0.78, 0.86, 1.0 ) * ( mat.flash.z * exp( - dot( fo, fo ) / max( mat.flash.w * mat.flash.w, 1.0 ) ) );
							// slate grey-green; the wall cloud 50 % darker (lower, denser and shadowed by the deck)
							L += T * vec3f( 0.66, 0.71, 0.70 ) * ( 1.0 - 0.4 * inWall ) * ( lit + glow ) * ( 1.0 - ext );
							T *= ext;
							if ( T < 0.01 ) { break; }
						}
					}
				}
				// ---- lightning channel of a ground stroke: 9 nodes from the storm base to the ground (Lightning.js).
				// The light is a function of the angle between the view ray and the nearest point of each segment:
				// a core about a pixel wide and a halo ten times wider, dimmed by what lies in front (Tbolt).
				if ( mat.bolt.z > 0.0 ) {
					var nodes = array<vec2f, 9>( mat.boltA.xy, mat.boltA.zw, mat.boltB.xy, mat.boltB.zw, mat.boltC.xy, mat.boltC.zw, mat.boltD.xy, mat.boltD.zw, mat.boltE.xy );
					var seen = 0.0;
					for ( var i = 0; i < 8; i ++ ) {
						let a = vec3f( nodes[ i ].x, mix( mat.bolt.y, mat.bolt.x, f32( i ) / 8.0 ), nodes[ i ].y );
						let b = vec3f( nodes[ i + 1 ].x, mix( mat.bolt.y, mat.bolt.x, f32( i + 1 ) / 8.0 ), nodes[ i + 1 ].y );
						let ab = b - a;
						let ao = a - ro;
						let rdab = dot( rd, ab );
						let s = clamp( ( rdab * dot( rd, ao ) - dot( ab, ao ) ) / max( dot( ab, ab ) - rdab * rdab, 1e-4 ), 0.0, 1.0 );
						let tc = dot( rd, ao + ab * s );
						if ( tc > 1.0 && tc < tScene ) {
							let ang = length( ao + ab * s - rd * tc ) / tc;
							seen = max( seen, exp( - ang * ang / 3.2e-6 ) + 0.1 * exp( - ang / 0.012 ) );
						}
					}
					L += Tbolt * vec3f( 0.78, 0.86, 1.0 ) * ( 60.0 * mat.bolt.z * seen );
					T *= 1.0 - 0.6 * min( seen, 1.0 ) * min( mat.bolt.z * 4.0, 1.0 ) * Tbolt;
				}
				let alpha = 1.0 - T;
				if ( alpha < 0.0005 ) { discard; }
				r.color = vec4f( L, alpha );
				// no reactive coverage bit: the history accumulates the moving jitter (see the material)
				r.mask = vec4f( 0.0 );
			`,
		} );
		this.mesh = new Mesh( new BoxGeometry( 1, 1, 1 ), this.material );
		this.mesh.name = 'Tornado funnel and storm base';
		this.mesh.layers.set( LAYERS.TRANSPARENT );
		this.mesh.renderOrder = 14; // behind the parcel clouds (15), which sit inside it
		this.mesh.frustumCulled = false;
		this.mesh.visible = false;
		app.scene.add( this.mesh );

	}

}
