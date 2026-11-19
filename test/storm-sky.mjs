// The storm a tornado comes out of (docs/tornado-visuals.md, "Design: the storm"): decisions of the
// real StormState, StormSky and StormLightning, stepped at 60 Hz as the game steps them. The cover
// of the dome and the sun's transmittance from anywhere on the island, the light under the deck and
// what the exposure meter does with it, the arrival from the storm's side, the clearing, a restart
// during the clearing, where it rains, and the lightning's seed, footprint and safe flash rate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FUNNEL, StormState, tornadoLifecycle } from '../src/disasters/TornadoFunnel.js';
import { STORM, stormCover, stormCoverToward, stormTransmittance, stormLightDrop, stormExposure, stormRain, stormPlace, rainExtinction } from '../src/disasters/StormModel.js';
import { StormSky } from '../src/disasters/StormSky.js';
import { LIGHTNING, StormLightning, pulseLight } from '../src/disasters/Lightning.js';

const DT = 1 / 60;
const norm = ( x, y, z ) => { const n = Math.hypot( x, y, z ); return { x: x / n, y: y / n, z: z / n }; };
const SUN = norm( 0.45, 0.62, 0.64 ); // mid afternoon
// a fine afternoon in the frame's units: sun colour, sky irradiance over pi, horizon colour
const CLEAR = { sun: [ 9, 8.6, 8 ], sky: [ 0.9, 1.2, 1.7 ], horizon: [ 2.2, 2.6, 3.2 ] };
const GROUND = 4; // m

// The real state and sky, driven as TornadoVisuals.updateStorm drives them.
function world( seed, config = {} ) {

	const e = { kind: 'tornado', seed, duration: 60, time: 0, direction: 0, x: 40, z: - 115, speed: 3, radius: 100, intensity: 65, ...config };
	const centre = ( ev ) => { const a = ev.direction * Math.PI / 180; return { x: ev.x + Math.cos( a ) * ev.time * ev.speed, z: ev.z + Math.sin( a ) * ev.time * ev.speed }; };
	const field = { time: 0, terrain: () => GROUND, center: centre };
	const app = { camera: { position: { x: 62, y: 7, z: - 62 } }, atmosphere: { sunDir: { value: SUN } }, clouds: { coverage: { value: 0.49 } } };
	const visuals = { storm: new StormState(), field, app, volume: null };
	const sky = new StormSky();
	const w = { e, field, app, visuals, sky, state: visuals.storm, active: null };
	w.step = ( dt = DT ) => {

		if ( w.active ) w.active.time += dt;
		field.time += dt;
		w.state.update( dt, !! w.active, app );
		sky.update( dt, w.active ?? undefined, visuals );

	};
	w.run = ( seconds, each ) => { for ( let i = 0, n = Math.round( seconds / DT ); i < n; i ++ ) { w.step(); each?.( i ); } };
	return w;

}

const colour = ( r, g, b ) => ( { r, g, b, setRGB( x, y, z ) { this.r = x; this.g = y; this.b = z; return this; }, multiplyScalar( k ) { this.r *= k; this.g *= k; this.b *= k; return this; } } );
const frame = () => ( { sunColor: { value: colour( ...CLEAR.sun ) }, skyIrradiance: { value: colour( ...CLEAR.sky ) }, horizonColor: { value: colour( ...CLEAR.horizon ) }, sunDir: { value: SUN }, envIntensity: { value: 1 } } );
const meter = () => ( { autoExposure: { refScale: { value: 1 }, maxScale: { value: 1 } } } );
const lum = ( c ) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

test( 'With no tornado the sky, the sun, the light, the exposure and the rain are untouched', () => {

	const w = world( 11 );
	w.run( 5 );
	assert.equal( w.sky.phase, 'clear' );
	assert.equal( w.sky.coverOverhead, 0 );
	assert.equal( w.sky.sunDisk, 1, 'the sun disk is whole' );
	assert.equal( w.sky.rainCamera, 0 );
	assert.equal( w.sky.lightning.count, 0 );
	assert.equal( w.sky.uniforms.fields.shield.value.z, 0, 'the sky pass sees no shield: stormSky returns the sky as it is' );
	assert.equal( w.sky.uniforms.fields.rain.value.z, 1, 'the sun disk multiplier in the sky pass is 1' );
	assert.equal( w.sky.changing, false, 'the image-based light keeps its own timer' );
	const G = frame(), post = meter();
	w.sky.applyLight( G, post );
	assert.deepEqual( [ G.sunColor.value.r, G.sunColor.value.g, G.sunColor.value.b ], CLEAR.sun, 'sun colour bit for bit' );
	assert.deepEqual( [ G.skyIrradiance.value.r, G.skyIrradiance.value.g, G.skyIrradiance.value.b ], CLEAR.sky );
	assert.deepEqual( [ G.horizonColor.value.r, G.horizonColor.value.g, G.horizonColor.value.b ], CLEAR.horizon );
	assert.equal( G.envIntensity.value, 1 );
	assert.deepEqual( [ post.autoExposure.refScale.value, post.autoExposure.maxScale.value ], [ 1, 1 ] );
	assert.equal( stormTransmittance( 0 ), 1 );
	assert.equal( w.app.clouds.coverage.value, 0.49, 'the shared cloud cover is the player\'s' );

} );

test( 'The overcast arrives from the storm\'s side, without a step, and has closed before the funnel is down', () => {

	const w = world( 21 );
	const life = tornadoLifecycle( w.e, {} );
	w.active = w.e;
	const g = w.sky.geometry;
	let last = 0, worst = 0, closed = null, ahead = null, behind = null, sunGone = null;
	w.run( life.genesis, () => {

		const c = w.sky.coverOverhead;
		assert.ok( c >= last - 1e-12, `cover overhead never falls while the storm arrives (${ last } to ${ c })` );
		worst = Math.max( worst, c - last );
		last = c;
		// the sky 6 km ahead of the tornado (the storm's side) and 6 km behind it
		if ( ahead === null && stormCover( g, g.x + 6000 * g.fx, g.z + 6000 * g.fz ) >= 0.5 ) ahead = w.e.time;
		if ( behind === null && stormCover( g, g.x - 6000 * g.fx, g.z - 6000 * g.fz ) >= 0.5 ) behind = w.e.time;
		if ( closed === null && c >= 0.98 ) closed = w.e.time;
		if ( sunGone === null && w.sky.sunDisk < 0.001 ) sunGone = w.e.time;

	} );
	assert.ok( worst < 0.05, `largest change of the cover overhead in one frame ${ worst.toFixed( 4 ) }: no snap` );
	assert.ok( ahead !== null && behind !== null && ahead < behind - 1, `the sky darkens on the storm's side first: ${ ahead?.toFixed( 1 ) } s ahead, ${ behind?.toFixed( 1 ) } s behind` );
	assert.ok( closed !== null && closed < life.genesis - 3, `the sky has closed overhead at ${ closed?.toFixed( 1 ) } s, before the funnel is down at ${ life.genesis.toFixed( 1 ) } s` );
	assert.ok( sunGone !== null && sunGone <= closed + 0.5, `the sun is hidden by ${ sunGone?.toFixed( 1 ) } s` );
	assert.equal( w.sky.phase, 'mature' );
	assert.equal( w.sky.changing, false, 'a mature storm is steady: the image-based light keeps its own timer' );

} );

test( 'A mature storm covers the dome from anywhere on the island, hides the sun and leaves a clear strip low on the far side', () => {

	const w = world( 31 );
	w.active = w.e;
	w.run( 25 );
	const g = w.sky.geometry;
	let least = 1, most = 0;
	// every place a tornado can be started is within 950 m of the island's middle (Field.js limits)
	for ( let x = - 950; x <= 950; x += 190 ) for ( let z = - 950; z <= 950; z += 190 ) {

		least = Math.min( least, stormCover( g, x, z ) );
		// the sun from 10 degrees up to overhead, from every side
		for ( let el = 10; el <= 90; el += 10 ) for ( let az = 0; az < 360; az += 30 ) {

			const c = Math.cos( el * Math.PI / 180 ), s = Math.sin( el * Math.PI / 180 );
			most = Math.max( most, stormTransmittance( stormCoverToward( g, x, 2, z, c * Math.cos( az * Math.PI / 180 ), s, c * Math.sin( az * Math.PI / 180 ) ) ) );

		}

	}
	assert.ok( least >= 0.98, `least cover overhead across the island ${ least }` );
	assert.ok( most < 0.001, `most of the sun's disk that shows from anywhere on the island, sun 10-90 degrees up: ${ most.toExponential( 2 ) }` );
	// the far strip: behind the storm's motion the deck ends, so the sky 2 degrees up is clear and 12 degrees up is not
	const low = norm( - g.fx * Math.cos( 0.035 ), Math.sin( 0.035 ), - g.fz * Math.cos( 0.035 ) ), high = norm( - g.fx * Math.cos( 0.21 ), Math.sin( 0.21 ), - g.fz * Math.cos( 0.21 ) );
	assert.equal( stormCoverToward( g, 62, 7, - 62, low.x, low.y, low.z ), 0, 'a clear strip 2 degrees over the far horizon' );
	assert.equal( stormCoverToward( g, 62, 7, - 62, high.x, high.y, high.z ), 1, 'the deck 12 degrees over the far horizon' );
	assert.equal( w.app.clouds.coverage.value, 0.49, 'the storm never writes the shared cloud cover' );

} );

test( 'The light under the deck falls inside the band of a deep cumulonimbus and the frame stays dark', () => {

	const drop = stormLightDrop( CLEAR, SUN.y );
	// 2-8 % diffuse transmittance (optical depth 100-400): 12.5-50x
	assert.ok( drop >= 12.5 && drop <= 50, `global light at the ground falls ${ drop.toFixed( 1 ) }x under the deck` );
	const w = world( 41 );
	w.active = w.e;
	w.run( 25 );
	const G = frame(), post = meter();
	const before = lum( G.sunColor.value ) * SUN.y + lum( G.skyIrradiance.value );
	w.sky.applyLight( G, post );
	assert.ok( lum( G.sunColor.value ) < 1e-4 * lum( colour( ...CLEAR.sun ) ), `the direct beam is gone (${ lum( G.sunColor.value ).toExponential( 2 ) }): no sun shadows under the deck` );
	const after = lum( G.sunColor.value ) * SUN.y + lum( G.skyIrradiance.value );
	assert.ok( Math.abs( before / after - drop ) < 0.01 * drop, `the frame's own light falls ${ ( before / after ).toFixed( 1 ) }x` );
	assert.ok( G.skyIrradiance.value.g >= G.skyIrradiance.value.b, 'light under deep cloud is grey-green, not sky blue' );
	// The exposure meter (PostFX): target = clamp( ( ref / average )^0.8, 0.6, 6 ) when the frame is darker than the reference.
	const exposure = ( average, ref, max ) => Math.min( 6 * max, Math.max( 0.6, ( 0.25 * ref / average ) ** 0.8 ) );
	const fine = 0.25, storm = fine / drop; // frame average: a fine day sits at the meter's reference
	const shown = exposure( storm, post.autoExposure.refScale.value, post.autoExposure.maxScale.value ) * storm / ( exposure( fine, 1, 1 ) * fine );
	const undone = exposure( storm, 1, 1 ) * storm / fine;
	assert.ok( shown >= 1 / 16 && shown <= 1 / 5, `on screen the storm is ${ Math.log2( 1 / shown ).toFixed( 1 ) } stops under the fine day` );
	assert.ok( shown < 0.6 * undone, `the fine-day meter would have opened to ${ Math.log2( 1 / undone ).toFixed( 1 ) } stops under` );
	assert.deepEqual( stormExposure( 0, {} ), { ref: 1, max: 1 } );

} );

test( 'After the tornado the overcast breaks up over a minute or two: partly open on the way, never in a step', () => {

	const w = world( 51 );
	w.active = w.e;
	w.run( 25 );
	w.active = null; // stopped or restored: the event is gone
	const G = frame(), post = meter();
	let last = w.sky.coverOverhead, worst = 0, partial = null, sunBack = null, strokes = w.sky.lightning.count;
	w.step();
	assert.ok( w.sky.coverOverhead > 0.95, `the overcast does not vanish when the tornado goes (cover ${ w.sky.coverOverhead })` );
	assert.equal( w.sky.phase, 'clearing' );
	let t = 0;
	w.run( FUNNEL.stormClear + 1, () => {

		t += DT;
		const c = w.sky.coverOverhead;
		worst = Math.max( worst, Math.abs( c - last ) );
		last = c;
		if ( partial === null && c > 0.3 && c < 0.7 ) partial = t;
		if ( sunBack === null && w.sky.sunDisk > 0.5 ) sunBack = t;
		if ( c > 0 ) assert.equal( w.sky.changing, true, 'the image-based light follows the clearing sky' );

	} );
	assert.ok( worst < 0.02, `largest change of the cover in one frame ${ worst.toFixed( 4 ) }` );
	assert.ok( partial !== null && partial > 20, `the sky is half open ${ partial?.toFixed( 0 ) } s into the clearing (breaks, not a fade to nothing at once)` );
	assert.ok( sunBack !== null && sunBack > 30 && sunBack < FUNNEL.stormClear, `the sun is back ${ sunBack?.toFixed( 0 ) } s into the clearing` );
	assert.equal( w.sky.phase, 'clear' );
	assert.equal( w.state.value, 0 );
	assert.equal( w.sky.uniforms.fields.shield.value.z, 0 );
	assert.equal( w.sky.lightning.count, strokes, 'no stroke after the tornado has gone' );
	w.sky.applyLight( G, post );
	assert.deepEqual( [ G.sunColor.value.r, G.skyIrradiance.value.g, G.envIntensity.value, post.autoExposure.refScale.value, post.autoExposure.maxScale.value ], [ CLEAR.sun[ 0 ], CLEAR.sky[ 1 ], 1, 1, 1 ], 'the fine day is handed back exactly' );

} );

test( 'A second tornado during the clearing closes the breaks and moves the shield across without a jump', () => {

	const w = world( 61 );
	w.active = w.e;
	w.run( 25 );
	w.active = null;
	w.run( 40 );
	const open = w.sky.coverOverhead;
	assert.ok( open < 0.9 && open > 0, `partly open before the restart (${ open.toFixed( 2 ) })` );
	const g = w.sky.geometry, second = { ...w.e, seed: 62, time: 0, x: - 600, z: 500, direction: 90 };
	w.active = second;
	let last = open, worst = 0, cx = g.cx, cz = g.cz, jump = 0;
	w.run( 30, () => {

		worst = Math.max( worst, Math.abs( w.sky.coverOverhead - last ) );
		last = w.sky.coverOverhead;
		jump = Math.max( jump, Math.hypot( g.cx - cx, g.cz - cz ) );
		cx = g.cx;
		cz = g.cz;

	} );
	assert.ok( worst < 0.02, `largest change of the cover in one frame across the restart ${ worst.toFixed( 4 ) }` );
	assert.ok( jump < 60, `the shield's centre moves at most ${ jump.toFixed( 1 ) } m in a frame` );
	assert.equal( w.sky.coverOverhead, 1, 'closed again' );
	assert.ok( Math.hypot( g.x - ( - 600 ), g.z - ( 500 + 90 ) ) < 150, 'the storm has moved to the new tornado' );

} );

test( 'It rains in the forward-flank core and the hook, not in the inflow notch, and only under a closed deck', () => {

	const w = world( 71 );
	w.active = w.e;
	const g = w.sky.geometry, at = ( ahead, left ) => stormPlace( g, ahead, left, { x: 0, z: 0 } );
	w.run( 3 );
	const early = at( - STORM.hookBehind, STORM.hookLeft );
	assert.equal( stormRain( g, early.x, early.z ), 0, 'no rain before the deck has closed' );
	w.run( 22 );
	const hook = at( - STORM.hookBehind, STORM.hookLeft ), core = at( STORM.coreAhead, STORM.coreLeft ), notch = at( STORM.notchAhead, - STORM.notchRight );
	assert.equal( stormRain( g, hook.x, hook.z ), STORM.hookRate, 'the hook\'s rain rate at its centre, mm/h' );
	assert.equal( stormRain( g, core.x, core.z ), STORM.coreRate, 'the core\'s rain rate at its centre, mm/h' );
	assert.equal( stormRain( g, notch.x, notch.z ), 0, 'the inflow notch is dry' );
	assert.equal( stormRain( g, g.x + 20000, g.z ), 0, 'no rain far outside the storm' );
	// the camera inside and outside
	Object.assign( w.app.camera.position, { x: hook.x, y: GROUND + 2, z: hook.z } );
	w.step();
	assert.equal( w.sky.rainCamera, STORM.hookRate, 'rain at a camera inside the hook, mm/h' );
	const lens = { wet: { value: 0 }, age: { value: 100 }, _wasUnder: false };
	for ( let i = 0; i < 120; i ++ ) w.sky.wetLens( lens, DT );
	assert.ok( lens.wet.value > 0.5, `the lens is wet after 2 s in the rain (${ lens.wet.value.toFixed( 2 ) })` );
	Object.assign( w.app.camera.position, { x: notch.x, z: notch.z } );
	w.step();
	assert.equal( w.sky.rainCamera, 0, 'no rain at a camera in the notch' );
	const dry = { wet: { value: 0 }, age: { value: 100 }, _wasUnder: false };
	w.sky.wetLens( dry, DT );
	assert.equal( dry.wet.value, 0, 'a dry lens outside the rain' );
	// visibility through the rain (Koschmieder 3.9 / extinction): a core hides what is behind it
	assert.ok( 3.9 / rainExtinction( STORM.coreRate ) < 800 && 3.9 / rainExtinction( STORM.hookRate ) > 1000, `visibility ${ ( 3.9 / rainExtinction( STORM.coreRate ) ).toFixed( 0 ) } m in the core, ${ ( 3.9 / rainExtinction( STORM.hookRate ) ).toFixed( 0 ) } m in the hook` );
	// the rain stops in the first part of the clearing
	w.active = null;
	w.run( STORM.rainEase + 1 );
	assert.equal( stormRain( g, core.x, core.z ), 0, 'the rain has stopped' );
	assert.ok( w.sky.coverOverhead > 0, 'while the overcast is still breaking up' );

} );

// lightning of a storm at full strength for `seconds`, stepped at `dt` of simulated time per 1/60 s of wall time
function lightning( seed, seconds, { dt = DT, reduced = false, strength = 1 } = {} ) {

	let wall = 0;
	const L = new StormLightning( () => wall ), e = { seed, time: 0 };
	const storm = { strength, x: 40, z: - 115, coreX: 1740, coreZ: - 915, wallRadius: 1000, deckY: 854, time: 0 };
	const strokes = [], levels = [];
	L.onStroke( ( s ) => strokes.push( { ...s, wall } ) );
	for ( let t = 0; t < seconds; t += dt ) {

		e.time += dt;
		storm.time = e.time;
		wall += DT;
		levels.push( L.update( dt, e, storm, () => GROUND, reduced ) );

	}
	return { L, strokes, levels, storm };

}

const mostInOneSecond = ( times ) => {

	let most = 0;
	for ( let i = 0, j = 0; i < times.length; i ++ ) {

		while ( times[ i ] - times[ j ] >= 1 ) j ++;
		most = Math.max( most, i - j + 1 );

	}
	return most;

};

test( 'Lightning comes from the event\'s seed, falls inside the storm and never flashes more than three times in a second', () => {

	const a = lightning( 1234, 120 ), b = lightning( 1234, 120 ), c = lightning( 99, 120 );
	const key = ( r ) => r.strokes.map( ( s ) => `${ s.kind } ${ s.x.toFixed( 2 ) } ${ s.z.toFixed( 2 ) } ${ s.time.toFixed( 4 ) }` ).join( '|' );
	assert.equal( key( a ), key( b ), 'the same seed replays the same strokes' );
	assert.notEqual( key( a ), key( c ), 'another seed gives another storm' );
	let ground = 0, total = 0;
	for ( let seed = 1; seed <= 8; seed ++ ) {

		const r = lightning( seed * 7919, 300 );
		const times = r.strokes.map( ( s ) => s.clock );
		const most = mostInOneSecond( times );
		assert.ok( most <= 3, `seed ${ seed }: ${ most } flashes in one second` );
		for ( let i = 1; i < times.length; i ++ ) assert.ok( times[ i ] - times[ i - 1 ] >= LIGHTNING.minSpacing - 1e-9, `seed ${ seed }: flashes ${ ( times[ i ] - times[ i - 1 ] ).toFixed( 3 ) } s apart` );
		const flashes = new Set( r.strokes.map( ( s ) => s.flash ) ).size;
		assert.ok( flashes >= 60 && flashes <= 200, `seed ${ seed }: ${ flashes } flashes in 5 min (12-40 a minute)` );
		for ( const s of r.strokes ) {

			const mid = Math.hypot( s.x - ( r.storm.x + r.storm.coreX ) / 2, s.z - ( r.storm.z + r.storm.coreZ ) / 2 ), near = Math.min( Math.hypot( s.x - r.storm.x, s.z - r.storm.z ), Math.hypot( s.x - r.storm.coreX, s.z - r.storm.coreZ ) );
			if ( s.kind === 'ground' ) {

				assert.ok( near <= LIGHTNING.groundReach * r.storm.wallRadius + 1e-6, `a ground stroke ${ near.toFixed( 0 ) } m from the tornado or the rain core` );
				assert.equal( s.y, GROUND, 'a ground stroke is recorded at the ground' );
				ground ++;

			} else {

				assert.ok( mid <= LIGHTNING.cloudReach + 1e-6, `a cloud flash ${ mid.toFixed( 0 ) } m from the storm's middle` );
				assert.ok( s.y > r.storm.deckY, 'a cloud flash is recorded inside the deck' );

			}
			assert.ok( Math.hypot( s.x - ( r.storm.x + STORM.shieldLead ), s.z - r.storm.z ) <= STORM.shieldRadius, 'inside the storm\'s footprint' );
			assert.ok( s.time > 0 && s.peak > 0 && s.peak <= 1 );
			total ++;

		}

	}
	assert.ok( ground / total > 0.15 && ground / total < 0.5, `${ ( 100 * ground / total ).toFixed( 0 ) } % of the strokes reach the ground` );
	// a weak storm flashes less often
	const weak = lightning( 5, 300, { strength: 0.2 } ), strong = lightning( 5, 300 );
	assert.ok( weak.strokes.length < 0.5 * strong.strokes.length, `${ weak.strokes.length } strokes at strength 0.2, ${ strong.strokes.length } at full strength` );

} );

test( 'The flash limit holds when the simulation runs ahead of the wall clock, and no stroke follows the tornado', () => {

	// four simulated seconds per second of wall time: the limit is on what the player sees
	const fast = lightning( 4242, 600, { dt: 4 * DT } );
	const most = mostInOneSecond( fast.strokes.map( ( s ) => s.wall ) );
	assert.ok( fast.strokes.length > 20 && most <= 3, `${ most } flashes in one wall second over ${ fast.strokes.length } strokes` );
	assert.ok( fast.L.dropped > 0, 'the limiter refused pulses instead of drawing them' );
	// the tornado goes: nothing waits, nothing is recorded
	const r = lightning( 77, 60 ), n = r.L.count;
	for ( let i = 0; i < 60 * 30; i ++ ) r.L.update( DT, undefined, r.storm, () => GROUND, false );
	assert.equal( r.L.count, n, 'no stroke is recorded once no tornado is active' );
	assert.equal( r.L.level, 0, 'and the last flash has faded' );

} );

test( 'With reduced motion a flash is a slow glow, never a step', () => {

	const sharp = lightning( 888, 120 ), soft = lightning( 888, 120, { reduced: true } );
	const step = ( levels ) => levels.reduce( ( m, l, i ) => Math.max( m, Math.abs( l - ( levels[ i - 1 ] ?? 0 ) ) ), 0 );
	assert.ok( step( sharp.levels ) >= 0.5, `with full motion the light steps by ${ step( sharp.levels ).toFixed( 2 ) } in a frame` );
	assert.ok( step( soft.levels ) <= 0.03, `with reduced motion the light changes at most ${ step( soft.levels ).toFixed( 3 ) } in a frame` );
	assert.ok( Math.max( ...soft.levels ) <= 0.7 && Math.max( ...soft.levels ) > 0.1, `glow peak ${ Math.max( ...soft.levels ).toFixed( 2 ) }` );
	assert.ok( soft.strokes.every( ( s ) => s.index === 0 ), 'one glow per flash: later pulses are not drawn or recorded' );
	assert.equal( pulseLight( 0, true ), 0, 'a glow starts from nothing' );
	assert.equal( pulseLight( 0, false ), 1, 'a flash starts at its peak' );

} );
