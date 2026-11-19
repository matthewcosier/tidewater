import { ShaderModule } from '../engine/gpu/Shader.js';
import { UniformBlock } from '../engine/gpu/Uniforms.js';
import { commonModule } from '../engine/render/wgsl/common.js';
import { Vector4 } from '../engine/index.js';
import { FUNNEL, tornadoLifecycle } from './TornadoFunnel.js';
import { STORM, STORM_WGSL, shieldEdge, stormCover, stormCoverToward, stormTransmittance, stormLight, stormExposure, stormRain, stormRainAmount, stormPlace } from './StormModel.js';
import { StormLightning } from './Lightning.js';

// The storm a tornado comes out of (docs/tornado-visuals.md, "Design: the storm"): one state and one
// geometry for everything that shows it. StormState (TornadoFunnel.js) holds the arrival and the
// clearing; this class turns them into the overcast shield, the light under it, the rain and the
// lightning, and feeds:
//   the sky pass       `module` (prefix `storm`): fn stormSky( dir, sky, fine ) -> vec3f composites the
//                      overcast over the sky radiance; fn stormSunDisk() -> f32 dims the sun's disk.
//                      Sky.js calls both; with no storm they return their input unchanged.
//   the storm volume   feed( uniforms ): the same shield, rain, flash and channel (TornadoVolume.js)
//   the frame light    applyLight( G, post ): sun colour, sky irradiance, horizon colour, the image-based
//                      light's flash gain and the exposure meter's reference
//   the lens           wetLens( lens, dt ): rain on the camera
//   scenarios          the "Storm telemetry" status (data-* attributes, at most every 0.1 s)
//   listeners          lightning.onStroke( fn ), lightning.strokes (Lightning.js)
// With no storm every one of these is the fine day exactly, and update() does no more than read the state.

const PUBLISH_INTERVAL = 0.1; // s between telemetry writes (wall clock)
const FLASH_COLOUR = [ 0.78, 0.86, 1.0 ]; // a return stroke's blue-white (about 30000 K)

const f = ( x ) => {

	const s = String( x );
	return /[.e]/.test( s ) ? s : s + '.0';

};

// uniform StormParams stormParams. No texture: the relief is procedural (StormModel.js stormFbm).
const DOME_WGSL = /* wgsl */`
fn stormSunDisk() -> f32 { return stormParams.rain.z; }

// The overcast beyond the storm volume: the storm base as a plane at its own height, anchored in the
// world (it has parallax and drifts with the storm), seen from below. Returns premultiplied radiance
// and the transmittance of what lies behind. fine: the main view (one more octave of relief).
fn stormSkyLayer( dir: vec3f, fine: bool ) -> vec4f {
	let ro = frame.cameraPos;
	let rise = stormParams.deck.x - ro.y;
	// from above the base, or looking level and down: nothing of the plane (the volume draws the near deck)
	if ( rise <= 1.0 || dir.y <= 0.002 ) { return vec4f( 0.0, 0.0, 0.0, 1.0 ); }
	let t = rise / dir.y;
	let p = ro.xz + dir.xz * t;
	let q = p + stormParams.deck.yz;
	// the same field as the volume's deck (TornadoVolume.js), so the edge and the breaks line up
	let cover = stormCover( p, stormParams.shield, stormField( q ) );
	if ( cover <= 0.0005 ) { return vec4f( 0.0, 0.0, 0.0, 1.0 ); }
	// Relief of the base: billows 2.6 km across down to 650 m, and scud of 420 m and 210 m. Toward the
	// horizon one pixel spans hundreds of metres of the plane along the ray, more than the smallest
	// billow: the relief is flattened there so it cannot shimmer.
	let foot = t * 0.0012 / dir.y; // m of the base under one pixel along the ray (1.2 mrad a pixel)
	// the billows are bent by a slower field, so they are not a grid of round cells
	let bend = ( vec2f( stormFbm( q / 6100.0 + vec2f( 3.1, 8.2 ), 2 ), stormFbm( q / 6100.0 + vec2f( 19.4, 2.6 ), 2 ) ) - 0.5 ) * 2600.0;
	var relief = clamp( ( stormFbm( ( q + bend ) / 2600.0, 3 ) - 0.5 ) * 2.0 + 0.5, 0.0, 1.0 );
	if ( fine ) {
		relief = mix( relief, stormFbm( ( q + bend ) / 420.0 + vec2f( 7.3, 1.9 ), 2 ), 0.3 * clamp( 2.0 - foot / 60.0, 0.0, 1.0 ) );
	}
	relief = mix( 0.5, relief, clamp( 2.0 - foot / 220.0, 0.0, 1.0 ) );
	// a thin veil at the leading edge, opaque behind it; the lobes are thicker
	let tau = ${ f( STORM.sunDepth ) } * cover * cover * ( 0.6 + 0.8 * relief );
	let alpha = 1.0 - exp( - tau );
	// The base from below: thick lobes hang lower and are darker, thin hollows let more light down;
	// darkest round the updraft and the rain core, within a few wall-cloud radii of the tornado.
	let dCore = length( p - stormParams.anchor.xy ) / max( stormParams.rain.x, 1.0 );
	let dark = mix( 0.5, 1.0, smoothstep( 1.0, 7.0, dCore ) );
	var L = stormParams.deckLight.rgb * dark * mix( 1.5, 0.6, relief );
	// the leading veil is thin sunlit cloud: pale, not dark
	L = mix( stormParams.veilLight.rgb * ( 0.6 + 0.5 * relief ), L, smoothstep( 0.3, 0.95, cover ) );
	// lightning inside the deck: a glow round the flash, brightest through the thin places
	if ( stormParams.flash.z > 0.0 ) {
		let fo = p - stormParams.flash.xy;
		L += vec3f( ${ FLASH_COLOUR.map( f ).join( ', ' ) } ) * stormParams.flash.z * exp( - dot( fo, fo ) / ( stormParams.flash.w * stormParams.flash.w ) ) * ( 1.4 - 1.1 * relief );
	}
	// the storm's own haze: the base pales toward the far strip
	let haze = 1.0 - exp( - t / ${ f( STORM.haze ) } );
	L = mix( L, stormParams.stripLight.rgb * 0.5, haze * 0.85 );
	return vec4f( L * alpha, 1.0 - alpha );
}

// The sky with the storm over it. Exactly \`sky\` with no storm.
fn stormSky( dir: vec3f, sky: vec3f, fine: bool ) -> vec3f {
	if ( stormParams.shield.z <= 0.0 ) { return sky; }
	// Under the storm the far strip of clear sky is seen through tens of km of humid air: paler and
	// greyer than a fine horizon. Only low down: breaks overhead open onto the real sky.
	let grey = dot( sky, vec3f( 0.2126, 0.7152, 0.0722 ) );
	let low = 1.0 - smoothstep( 0.03, 0.3, dir.y );
	let behind = mix( sky, vec3f( grey ) * vec3f( 0.92, 0.88, 0.8 ), 0.8 * stormParams.rain.w * low );
	let layer = stormSkyLayer( dir, fine );
	return behind * layer.a + layer.rgb;
}
`;

const LIFE = {}; // scratch for tornadoLifecycle
const PLACE = { x: 0, z: 0 };
const CLEAR = { sun: [ 0, 0, 0 ], sky: [ 0, 0, 0 ], horizon: [ 0, 0, 0 ] };
const LIGHT = { deck: [ 0, 0, 0 ], strip: [ 0, 0, 0 ], veil: [ 0, 0, 0 ], under: [ 0, 0, 0 ] };
const EXPOSURE = { ref: 1, max: 1 };
const smooth = ( x ) => {

	const t = Math.min( 1, Math.max( 0, x ) );
	return t * t * ( 3 - 2 * t );

};

export class StormSky {

	constructor() {

		// see StormModel.js for the fields the model reads
		this.geometry = { on: false, x: 0, z: 0, fx: 1, fz: 0, cx: 0, cz: 0, edge: 0, breaks: 0, baseY: 850, wallRadius: 1000, rain: 0 };
		this.phase = 'clear'; // clear, arriving, mature, clearing
		this.sunDisk = 1; // transmittance of the storm toward the sun from the camera (1: whole disk)
		this.cameraPosition = null;
		this.coverOverhead = 0; // storm cover of the dome straight up from the camera, 0..1
		this.coverSun = 0; // storm cover on the line from the camera to the sun, 0..1
		this.rainCamera = 0; // mm/h at the camera
		this.flashGround = 0; // 0..1 light of the lightning on the ground at the camera this frame
		this.changing = false; // the cover is changing: the image-based light refreshes without waiting
		this.strength = 0; // 0..1 the storm's strength for the lightning rate
		this.evolve = 0; // s, the deck's own clock (holds while paused)
		this.driftX = 0; // m
		this.driftZ = 0;
		this.lit = false; // applyLight has changed the frame light and must hand it back
		this.lensClock = 0;
		this.lightning = new StormLightning();
		this.lightningStorm = { strength: 0, x: 0, z: 0, coreX: 0, coreZ: 0, wallRadius: 1000, deckY: 850, time: 0 };
		this.groundAt = null;
		this.element = null;
		this.nextPublish = 0;
		this.published = '';
		const v4 = () => [ 'vec4f', new Vector4() ];
		this.uniforms = new UniformBlock( 'StormParams', {
			shield: v4(), // centre x, centre z, edge radius m (0: no storm), breaks 0..1
			deck: v4(), // base world height m, texture drift x m, drift z m, the deck's clock s
			anchor: [ 'vec4f', new Vector4( 0, 0, 1, 0 ) ], // the tornado x, z; the unit vector it moves along x, z
			rain: [ 'vec4f', new Vector4( 1000, 0, 1, 0 ) ], // wall-cloud radius m, rain 0..1, sun disk transmittance, storm air at the camera 0..1
			deckLight: v4(), // radiance of the base from below, rgb
			stripLight: v4(), // radiance of the far clear strip, rgb
			veilLight: v4(), // radiance of the thin leading veil, rgb
			flash: v4(), // in-cloud flash x, z, radiance, e-folding radius m
		}, { label: 'storm' } );
		this.shape = new ShaderModule( { name: 'stormShape', code: STORM_WGSL } );
		this.module = new ShaderModule( { name: 'storm', deps: [ commonModule, this.shape ], uniforms: this.uniforms, uniformName: 'stormParams', code: DOME_WGSL } );

	}

	// Runs every frame from TornadoVisuals.updateStorm, with or without a tornado. dt is 0 while the
	// simulation is paused. e: the active tornado event or undefined.
	update( dt, e, visuals ) {

		const state = visuals.storm, field = visuals.field, app = visuals.app, g = this.geometry, U = this.uniforms.fields;
		const was = g.on;
		if ( ! e && ! was && state.shield <= 0 ) {

			if ( this.published !== 'clear' ) this.publish( app, field );
			return;

		}
		if ( ! ( Number.isFinite( dt ) && dt > 0 ) ) dt = 0;
		if ( e ) {

			tornadoLifecycle( e, LIFE );
			// the overcast crosses the sky in the declared share of the genesis, so it leads the funnel
			state.arrival = Math.max( 4, Math.min( FUNNEL.stormArrivalMax, FUNNEL.stormArrival * LIFE.genesis ) );
			const c = field.center( e ), a = e.direction * Math.PI / 180;
			const baseY = Math.max( 0, field.terrain( c.x, c.z ) ) + LIFE.lcl;
			// A first storm starts where its tornado is; a storm that starts while another is clearing
			// takes the old shield over, moving its centre across (no jump).
			const k = was ? 1 - Math.exp( - dt / STORM.centreTime ) : 1;
			g.x += ( c.x - g.x ) * k;
			g.z += ( c.z - g.z ) * k;
			g.fx += ( Math.cos( a ) - g.fx ) * k;
			g.fz += ( Math.sin( a ) - g.fz ) * k;
			const n = Math.hypot( g.fx, g.fz ) || 1;
			g.fx /= n;
			g.fz /= n;
			g.baseY += ( baseY - g.baseY ) * k;
			g.wallRadius += ( LIFE.wallRadius - g.wallRadius ) * k;
			this.strength = LIFE.strength * smooth( state.shield );

		} else this.strength = 0;
		g.on = state.shield > 0;
		g.edge = shieldEdge( state.shield );
		g.breaks = state.breaks;
		g.cx = g.x + g.fx * STORM.shieldLead;
		g.cz = g.z + g.fz * STORM.shieldLead;
		g.rain = stormRainAmount( state.shield, state.breaks, FUNNEL.stormClear );
		this.changing = g.on !== was || ( g.on && ( state.shield < 1 || state.breaks > 0 ) );
		this.evolve += dt;
		this.driftX -= g.fx * STORM.drift * dt;
		this.driftZ -= g.fz * STORM.drift * dt;

		// what the camera is under
		const cam = this.cameraPosition = app.camera.position, sun = app.atmosphere.sunDir.value;
		this.coverOverhead = stormCover( g, cam.x, cam.z );
		this.coverSun = stormCoverToward( g, cam.x, cam.y, cam.z, sun.x, sun.y, sun.z );
		this.sunDisk = stormTransmittance( this.coverSun );
		this.rainCamera = cam.y < g.baseY ? stormRain( g, cam.x, cam.z ) : 0;

		// lightning: only while a tornado is active
		const L = this.lightning, ls = this.lightningStorm;
		this.groundAt ??= ( x, z ) => field.terrain( x, z );
		stormPlace( g, STORM.coreAhead, STORM.coreLeft, PLACE );
		ls.strength = this.strength;
		ls.x = g.x;
		ls.z = g.z;
		ls.coreX = PLACE.x;
		ls.coreZ = PLACE.z;
		ls.wallRadius = g.wallRadius;
		ls.deckY = g.baseY;
		ls.time = field.time;
		const level = L.update( dt, e, ls, this.groundAt );
		this.flashGround = level > 0 ? level / ( 1 + ( ( L.x - cam.x ) ** 2 + ( L.z - cam.z ) ** 2 ) / ( STORM.flashReach * STORM.flashReach ) ) : 0;

		// the sky pass
		U.shield.value.set( g.cx, g.cz, g.on ? g.edge : 0, g.breaks );
		U.deck.value.set( g.baseY, this.driftX, this.driftZ, this.evolve );
		U.anchor.value.set( g.x, g.z, g.fx, g.fz );
		U.rain.value.set( g.wallRadius, g.rain, g.on ? this.sunDisk : 1, g.on ? this.coverOverhead : 0 );
		U.flash.value.set( L.x, L.z, level * STORM.flashRadiance * ( L.kind === 'ground' ? 0.6 : 1 ), STORM.flashRadius );

		this.phase = ! g.on ? 'clear' : ! e ? 'clearing' : state.shield < 1 || state.breaks > 0 ? 'arriving' : 'mature';
		this.publish( app, field );

	}

	// The storm volume's copy of the same state (TornadoVolume.js uniforms). u: its material's uniforms.
	feed( u ) {

		const g = this.geometry, L = this.lightning, U = this.uniforms.fields;
		u.shield.value.copy( U.shield.value );
		u.sdrift.value.set( this.driftX, this.driftZ, this.evolve, this.rainCamera );
		u.anchor.value.copy( U.anchor.value );
		u.rain.value.set( g.wallRadius, g.rain, 0, 0 );
		u.flash.value.copy( U.flash.value );
		const lit = L.kind === 'ground' && L.level > 0, c = L.channel;
		u.bolt.value.set( L.channelGround, L.channelBase, lit ? L.level : 0, 0 );
		if ( lit ) {

			u.boltA.value.set( c[ 0 ], c[ 1 ], c[ 2 ], c[ 3 ] );
			u.boltB.value.set( c[ 4 ], c[ 5 ], c[ 6 ], c[ 7 ] );
			u.boltC.value.set( c[ 8 ], c[ 9 ], c[ 10 ], c[ 11 ] );
			u.boltD.value.set( c[ 12 ], c[ 13 ], c[ 14 ], c[ 15 ] );
			u.boltE.value.set( c[ 16 ], c[ 17 ], 0, 0 );

		}

	}

	// The frame's light under the storm. Called by App.applyAtmosphereReadback after it has written
	// the clear sun colour, sky irradiance and horizon colour into G: the direct beam is cut by the
	// storm's transmittance toward it, the sky light becomes the light of the deck and the far strip
	// by the cover overhead, lightning adds its few frames, and the exposure meter's reference follows.
	// With no storm nothing is touched.
	applyLight( G, post ) {

		const g = this.geometry, U = this.uniforms.fields, meter = post?.autoExposure;
		if ( ! g.on ) {

			if ( this.lit ) {

				// the frame after the storm has gone: the fine day's values, exactly
				this.lit = false;
				G.envIntensity.value = 1;
				if ( meter ) { meter.refScale.value = 1; meter.maxScale.value = 1; }

			}
			return;

		}
		this.lit = true;
		const sun = G.sunColor.value, sky = G.skyIrradiance.value, horizon = G.horizonColor.value;
		CLEAR.sun[ 0 ] = sun.r; CLEAR.sun[ 1 ] = sun.g; CLEAR.sun[ 2 ] = sun.b;
		CLEAR.sky[ 0 ] = sky.r; CLEAR.sky[ 1 ] = sky.g; CLEAR.sky[ 2 ] = sky.b;
		CLEAR.horizon[ 0 ] = horizon.r; CLEAR.horizon[ 1 ] = horizon.g; CLEAR.horizon[ 2 ] = horizon.b;
		stormLight( CLEAR, G.sunDir.value.y, LIGHT );
		U.deckLight.value.set( LIGHT.deck[ 0 ], LIGHT.deck[ 1 ], LIGHT.deck[ 2 ], 0 );
		U.stripLight.value.set( LIGHT.strip[ 0 ], LIGHT.strip[ 1 ], LIGHT.strip[ 2 ], 0 );
		U.veilLight.value.set( LIGHT.veil[ 0 ], LIGHT.veil[ 1 ], LIGHT.veil[ 2 ], 0 );
		const c = this.coverOverhead, fl = this.flashGround * STORM.flashSky;
		// the direct beam of the frame's key light (the sun, or the moon at night) through the storm
		const key = G.sunDir.value, cam = this.cameraPosition;
		sun.multiplyScalar( stormTransmittance( stormCoverToward( g, cam.x, cam.y, cam.z, key.x, key.y, key.z ) ) );
		sky.setRGB( sky.r + ( LIGHT.under[ 0 ] - sky.r ) * c + FLASH_COLOUR[ 0 ] * fl, sky.g + ( LIGHT.under[ 1 ] - sky.g ) * c + FLASH_COLOUR[ 1 ] * fl, sky.b + ( LIGHT.under[ 2 ] - sky.b ) * c + FLASH_COLOUR[ 2 ] * fl );
		const hs = STORM.horizonShare;
		horizon.setRGB( horizon.r + ( LIGHT.strip[ 0 ] * hs - horizon.r ) * c, horizon.g + ( LIGHT.strip[ 1 ] * hs - horizon.g ) * c, horizon.b + ( LIGHT.strip[ 2 ] * hs - horizon.b ) * c );
		G.envIntensity.value = 1 + STORM.flashEnv * this.flashGround;
		if ( meter ) {

			stormExposure( c, EXPOSURE );
			meter.refScale.value = EXPOSURE.ref;
			meter.maxScale.value = EXPOSURE.max;

		}

	}

	// Rain on the camera wets the lens (src/post/LensDroplets.js): called after the lens's own update.
	// Drops gather while it rains and dry as after surfacing once it stops.
	wetLens( lens, dt ) {

		if ( this.rainCamera <= 0 || lens.wet.value <= 0 && lens._wasUnder ) return;
		// heavier rain keeps more water on the glass: full from 40 mm/h
		const target = Math.min( 1, 0.35 + this.rainCamera / 60 );
		if ( lens.wet.value < target ) lens.wet.value = Math.min( target, lens.wet.value + dt / 1.5 );
		// held young: the drops keep forming instead of running dry
		lens.age.value = Math.min( lens.age.value, 2.5 );

	}

	// The "Storm telemetry" status: what a scenario reads (never the seed).
	publish( app, field ) {

		if ( ! globalThis.document ) return;
		const now = performance.now() / 1000;
		if ( now < this.nextPublish && this.published === this.phase ) return;
		this.nextPublish = now + PUBLISH_INTERVAL;
		this.published = this.phase;
		if ( ! this.element ) {

			const el = this.element = document.createElement( 'output' );
			el.setAttribute( 'role', 'status' );
			el.setAttribute( 'aria-label', 'Storm telemetry' );
			el.setAttribute( 'aria-live', 'off' );
			el.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);pointer-events:none';
			document.body.append( el );

		}
		const d = this.element.dataset, g = this.geometry, L = this.lightning, ground = ( p ) => `${ p.x.toFixed( 1 ) },${ ( Math.max( 0, field.terrain( p.x, p.z ) ) + 2 ).toFixed( 1 ) },${ p.z.toFixed( 1 ) }`;
		d.phase = this.phase;
		d.sunDisk = String( this.sunDisk );
		d.coverOverhead = String( this.coverOverhead );
		d.coverSun = String( this.coverSun );
		d.rainCamera = this.rainCamera.toFixed( 2 );
		d.lensWet = ( app.post?.lens?.wet.value ?? 0 ).toFixed( 3 );
		d.cloudCover = String( app.clouds?.coverage.value ?? 0 );
		d.footprint = `${ g.cx.toFixed( 1 ) },${ g.cz.toFixed( 1 ) },${ STORM.shieldRadius }`;
		// places to stand: inside the hook's rain, and in the dry inflow notch (x, y 2 m over the ground, z)
		d.rainInside = ground( stormPlace( g, - STORM.hookBehind, STORM.hookLeft, PLACE ) );
		d.rainOutside = ground( stormPlace( g, STORM.notchAhead, - STORM.notchRight, PLACE ) );
		d.strokes = String( L.count );
		d.flashMode = L.reduced ? 'glow' : 'flash';
		let list = '', pulses = '';
		for ( let i = 0; i < 32; i ++ ) {

			const s = L.recent( i );
			if ( ! s ) break;
			if ( i < 16 ) list = `${ s.kind }:${ s.x.toFixed( 1 ) }:${ s.y.toFixed( 1 ) }:${ s.z.toFixed( 1 ) }:${ s.time.toFixed( 3 ) };` + list;
			pulses = `${ s.clock.toFixed( 3 ) },` + pulses;

		}
		d.strokeList = list;
		d.pulses = pulses;

	}

}
