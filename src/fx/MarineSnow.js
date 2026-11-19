import { Vector2, Vector3, PlaneGeometry, InstancedBufferGeometry, Mesh } from '../engine/index.js';
import { UniformBlock, ShaderModule, Material } from '../engine/webgpu.js';
import { LAYERS } from '../core/SceneRenderer.js';
import { floodMediumModule, BACKSCATTER } from '../disasters/FloodMedium.js';

// Suspended particles in the water around the camera (marine snow, plankton, sand grains).
// Positions are procedural (hash of the instance) inside a box that wraps around the camera, so
// there is no simulation and no CPU work. The particles drift with a slow current and sway back
// and forth with the orbital motion of the passing swell (longest FFT cascades, decaying with
// depth). Only drawn while the view can be under water, and only below the surface (when the
// waterline crosses the lens, none float in the air half). The specks are tiny depth-writing discs
// in the opaque pass, so the underwater fog treats each one at its own distance (TAA smooths the
// edges).
//
// In a flood's sediment-laden water (medium > 0, disasters/FloodMedium.js) the sea's specks give way to a second
// population in a small box round the lens: grit and scraps carried by the water's own velocity at the camera, and
// bubbles rising through it. The water there is opaque within 20 cm, so only the specks at the lens show, and they
// cross it fast: each is drawn along its motion over the frame's exposure, a streak and not a dot that jumps. They
// are lit by the daylight that reaches their depth under the flood's surface and fogged by the composite like the
// rest. With medium 0 none of them is drawn and the sea's specks are exactly as before.
//
// Consumes: fft.module (oceanDisplacement: texture_2d_array, cascade sizes ocean.sizes[ c ].x),
// query.module (waterQueryHeightAtXZ( xz ) -> f32, optional), and the diver's torch of LocalLights
// (materials/LocalLights.js FLASH handles: on, pos, dir, col, cone). Port note: the torch values
// live in this material's own `SnowFlash` block whose `{ value }` handles are linked to FLASH by
// setFlash( FLASH ) (done automatically once materials/LocalLights.js loads; the spot profile is
// the same formula as LocalLights' spotProfile, localLightsSpotProfile in WGSL).
const MAX_CAMERA_SPEED = 80; // m/s: faster than any camera in the game moves; a jump between views is not motion

export class MarineSnow {

	constructor( { fft, query = null, count = 12000, box = 8, floodCount = 12000, floodBox = 1.2 } ) {

		this.fft = fft;
		this.box = box;
		this.count = count;
		// flood water: about 70 specks in the 15 cm of water the lens sees into (6,900 per m3 in a 1.2 m box)
		this.floodCount = floodCount;
		this.floodBox = floodBox; // m
		this.last = new Vector3(); // the camera a frame ago (its own velocity)
		this.tracked = false;

		const geo = new PlaneGeometry( 1, 1 );
		const inst = new InstancedBufferGeometry();
		inst.index = geo.index;
		inst.setAttribute( 'position', geo.getAttribute( 'position' ) );
		inst.setAttribute( 'uv', geo.getAttribute( 'uv' ) );
		inst.instanceCount = count; // + floodCount while the camera is in flood water (update)
		this.geometry = inst;

		// the torch (linked to LocalLights' FLASH by setFlash)
		this.flashBlock = new UniformBlock( 'SnowFlash', {
			pos: [ 'vec3f', new Vector3() ],
			on: [ 'f32', 0 ],
			dir: [ 'vec3f', new Vector3( 0, 0, - 1 ) ],
			col: [ 'vec3f', new Vector3() ], // rgb x intensity
			cone: [ 'vec2f', new Vector2( 0.99, 0.82 ) ], // cos inner, cos outer
		}, { label: 'snow flash' } );
		const flashModule = new ShaderModule( {
			name: 'snowFlash',
			uniforms: this.flashBlock,
			uniformName: 'snowFlash',
			code: /* wgsl */`
// spot profile shared by the shading, the beam and the snow: hot centre, soft edge, faint spill
// (LocalLights spotProfile)
fn snowSpotProfile( cd: f32, cosInner: f32, cosOuter: f32 ) -> f32 {
	let m = smoothstep( cosOuter, cosInner, cd );
	return max( m * m, smoothstep( cosOuter - 0.55, cosOuter, cd ) * 0.05 );
}
`,
		} );

		// orbital sway from the passing swell: the two longest cascades
		let sway = '';
		for ( let c = 0; c < Math.min( 2, fft.cascades ?? 2 ); c ++ ) {

			// (cascade size L from the ocean uniforms, so setCascadeSizes() is followed)
			sway += `\tsway += textureSampleLevel( oceanDisplacement, smpLinearRepeat, p.xz / ocean.sizes[ ${ c } ].x, ${ c }, 3.0 ).xyz * exp( depth * ( - TWO_PI / ocean.sizes[ ${ c } ].x ) );\n`;

		}

		const modules = [ fft.module, flashModule, floodMediumModule ];
		if ( query && query.module ) modules.push( query.module );

		const mat = new Material( {
			name: 'MarineSnow',
			lit: false,
			modules,
			uniforms: {
				camPos: [ 'vec3f', new Vector3() ],
				snowOpacity: [ 'f32', 1 ],
				box: [ 'f32', box ],
				medium: [ 'f32', 0 ], // the water at the camera: 0 the sea's own, 1 a flood's (FloodMedium)
				floodBox: [ 'f32', floodBox ],
				advect: [ 'vec3f', new Vector3() ], // m: how far the flood water at the camera has carried its grit (wrapped to the box)
				flow: [ 'vec3f', new Vector3() ], // m/s: that water's velocity relative to the camera
			},
			varyings: { vFade: 'f32', vDepth: 'f32', vTorch: 'vec3f', vKind: 'f32' },
			vertex: /* wgsl */`
	let id = f32( v.instance );
	let h = snowHash3( id * 0.7131 );
	let h2 = snowHash3( id * 1.3917 + 5.1 );
	// the flood's own population follows the sea's specks: grit and scraps, and (about one in four) bubbles
	let isFlood = v.instance >= ${ count }u;
	let bubble = isFlood && h2.z > 0.74;
	let B = select( mat.box, mat.floodBox, isFlood );
	// slow current + sinking, wrapped into the camera box; flood water carries its grit with it and its bubbles rise
	let driftSea = vec3f( 0.05, - 0.012, 0.03 ) * frame.time + ( h2 - 0.5 ) * ( frame.time * 0.02 );
	let driftFlood = mat.advect + vec3f( 0.0, select( - 0.03, 0.25, bubble ), 0.0 ) * frame.time + ( h2 - 0.5 ) * ( frame.time * 0.08 );
	let drift = select( driftSea, driftFlood, isFlood );
	let local = ( fract( h + drift / B - mat.camPos / B ) - 0.5 ) * B;
	var p = mat.camPos + local;
	// orbital sway from the passing swell (decays ~exp(-k z) with depth)
	let depth = max( frame.seaLevel - p.y, 0.0 );
	var sway = vec3f( 0.0 );
	// (not in the flood: the swell's orbit, up to a metre, would carry the whole 1.2 m box away from the lens)
${ sway }	p += vec3f( sway.x, sway.y * 0.5, sway.z ) * select( 0.8, 0.0, isFlood );

	// camera-facing quad, 3-8 mm (a few flecks larger); flood: grit 2-9 mm with a few scraps, bubbles 1.5-5 mm
	let sizeFlood = select( mix( 0.002, 0.009, h2.x * h2.x ) + select( 0.0, 0.014, h2.y > 0.97 ), mix( 0.0015, 0.005, h2.x ), bubble );
	let size = select( mix( 0.003, 0.008, h2.x * h2.x ) + select( 0.0, 0.008, h2.y > 0.98 ), sizeFlood, isFlood );
	let pv0 = frame.view * vec4f( p, 1.0 );
	// fade in the box edges and right in front of the lens (by shrinking); the flood's specks are only ever seen at
	// the lens (the near plane, 0.1 m), so they hold their size to just beyond it
	let dist = length( local );
	var fade = smoothstep( B * 0.5, B * 0.3, dist ) * select( smoothstep( 0.08, 0.3, - pv0.z ), smoothstep( 0.1, 0.13, - pv0.z ), isFlood );
	// one water or the other: the sea's specks give way to the flood's as the medium turns
	fade *= select( 1.0 - mat.medium, mat.medium, isFlood );
${ query && query.module ? '\tlet wq = waterQueryHeightAtXZ( p.xz );\n\tfade *= smoothstep( 0.0, 0.04, wq - p.y );\n' : '\tlet wq = frame.seaLevel;\n' }	// (view-space offset: along the camera's right / up axes in world space)
	let right = vec3f( frame.view[ 0 ][ 0 ], frame.view[ 1 ][ 0 ], frame.view[ 2 ][ 0 ] );
	let up = vec3f( frame.view[ 0 ][ 1 ], frame.view[ 1 ][ 1 ], frame.view[ 2 ][ 1 ] );
	// flood specks: stretched along their motion across the lens over the frame's exposure
	let rel = vec2f( dot( mat.flow, right ), dot( mat.flow, up ) );
	let relSpeed = length( rel );
	let along = select( vec2f( 0.0, 1.0 ), rel / max( relSpeed, 1e-4 ), relSpeed > 1e-4 );
	// (at most 6 cm: at 10 m/s a longer streak was a line right across the view)
	let streak = min( relSpeed * clamp( frame.dt, 0.012, 0.05 ), 0.06 );
	let corner = v.position.xy * fade;
	let qFlood = along * ( corner.y * ( size + streak ) ) + vec2f( along.y, - along.x ) * ( corner.x * size );
	let q = select( v.position.xy * size * fade, qFlood, isFlood );
	o.vFade = fade;
	// (flood: the depth under the flood's own surface; the sea's specks keep the depth under the mean sea)
	o.vDepth = select( depth, max( wq - p.y, 0.0 ), isFlood );
	o.vKind = select( 0.0, select( 1.0, 2.0, bubble ), isFlood );
	// flashlight on the speck (per vertex): the backscatter sparkle of a diver's torch; the
	// view leg is attenuated by the underwater composite
	let tv = p - snowFlash.pos;
	let tr2 = max( dot( tv, tv ), 1e-4 );
	let tr = sqrt( tr2 );
	let tspot = snowSpotProfile( dot( tv / tr, snowFlash.dir ), snowFlash.cone.x, snowFlash.cone.y );
	let sigT = floodMediumAbsorption( mat.medium ) + floodMediumScattering( mat.medium );
	o.vTorch = snowFlash.col * exp( - sigT * tr ) * ( tspot / ( tr2 + 0.15 ) * snowFlash.on * 0.35 );
	// nearly still in the world: camera-only motion vectors (no previous position)
	v.useWorld = true;
	v.worldPos = p + right * q.x + up * q.y;
	v.worldNormal = - normalize( vec3f( frame.view[ 0 ][ 2 ], frame.view[ 1 ][ 2 ], frame.view[ 2 ][ 2 ] ) );
`,
			surface: /* wgsl */`
	let r = length( in.uv - 0.5 ) * 2.0;
	if ( r > 1.0 || in.vs.vFade < 0.02 ) { discard; }
	// lit by the light that reaches this depth, slightly greenish-white (organic matter)
	let sigA = floodMediumAbsorption( mat.medium );
	let sigS = floodMediumScattering( mat.medium );
	let sigT = sigA + sigS;
	// (in a flood's sediment the daylight comes down by the diffuse attenuation a + bb: post/Underwater.js)
	let sigL = mix( sigT, sigA + sigS * ${ BACKSCATTER }, mat.medium );
	let light = ( frame.sunColor * 0.1 + frame.skyIrradiance * 1.2 ) * exp( - sigL * in.vs.vDepth );
	// flood: wet grit and scraps are dark brown (wet soil reflects 5-15 %), bubbles scatter nearly all the light
	let kind = in.vs.vKind;
	let tint = select( select( vec3f( 1.8 ), vec3f( 0.20, 0.15, 0.10 ), kind < 1.5 ), vec3f( 0.9, 1.0, 0.95 ), kind < 0.5 );
	s.albedo = ( light + in.vs.vTorch ) * tint * mix( 1.3, 0.8, r ) * mat.snowOpacity;
	s.emissive = vec3f( 0.0 );
	s.alpha = 1.0;
`,
		} );
		// hash3 of the reference (sin-fract), in a tiny module of its own
		mat.modules.push( new ShaderModule( { name: 'snowHash', code: /* wgsl */`
fn snowHash3( n: f32 ) -> vec3f { return fract( sin( vec3f( n, n + 17.13, n + 43.71 ) ) * vec3f( 43758.5453, 22578.1459, 19642.3490 ) ); }
` } ) );

		this.material = mat;
		this.camPos = mat.uniforms.camPos;
		this.opacity = mat.uniforms.snowOpacity;
		this.medium = mat.uniforms.medium;
		this.advect = mat.uniforms.advect;
		this.flow = mat.uniforms.flow;

		this.mesh = new Mesh( inst, mat );
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		this.mesh.layers.set( LAYERS.OPAQUE );
		this.mesh.visible = false;

		// the torch of LocalLights (once that module is ported; harmless if it isn't)
		import( '../materials/LocalLights.js' ).then( ( m ) => {

			if ( m.FLASH ) this.setFlash( m.FLASH );

		} ).catch( () => {} );

	}

	// link the torch uniforms to LocalLights' FLASH handles ({ on, pos, dir, col, cone } with .value)
	setFlash( flash ) {

		const F = this.flashBlock.fields;
		for ( const k of [ 'on', 'pos', 'dir', 'col', 'cone' ] ) if ( flash[ k ] && 'value' in flash[ k ] ) F[ k ] = flash[ k ];

	}

	// underwater: any part of the view can be under water. medium: the water at the camera (0 the sea's own, 1 a
	// flood's sediment-laden water); ux, uz: that water's velocity (m/s); dt: the frame's time step (s).
	update( camera, underwater, medium = 0, ux = 0, uz = 0, dt = 0 ) {

		this.mesh.visible = underwater;
		const flood = underwater && medium > 0;
		this.geometry.instanceCount = flood ? this.count + this.floodCount : this.count;
		this.medium.value = flood ? medium : 0;
		if ( ! underwater ) {

			this.tracked = false;
			return;

		}
		const p = camera.position;
		if ( flood ) {

			// the camera's own velocity from its last position; a cut between views is not motion
			let cx = 0, cy = 0, cz = 0;
			if ( this.tracked && dt > 1e-4 ) {

				cx = ( p.x - this.last.x ) / dt;
				cy = ( p.y - this.last.y ) / dt;
				cz = ( p.z - this.last.z ) / dt;
				if ( cx * cx + cy * cy + cz * cz > MAX_CAMERA_SPEED * MAX_CAMERA_SPEED ) cx = cy = cz = 0;

			}
			this.flow.value.set( ux - cx, - cy, uz - cz );
			const A = this.advect.value, B = this.floodBox;
			A.x = ( A.x + ux * dt ) % B;
			A.z = ( A.z + uz * dt ) % B;

		}
		this.last.copy( p );
		this.tracked = true;
		this.camPos.value.copy( p );

	}

}
