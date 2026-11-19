import test from 'node:test';
import assert from 'node:assert/strict';
import { GliderPhysics, STEP, WING, equilibrium, stallSpeed } from '../src/glider/GliderPhysics.js';
import { LAUNCH, launchPoint } from '../src/glider/Site.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { poseQ, rotate } from '../src/aviation/Math.js';
import { DisasterField } from '../src/disasters/Field.js';
import { Colliders } from '../src/world/Colliders.js';
import { Player } from '../src/player/Player.js';
import { Glider } from '../src/glider/Glider.js';
import { BOOT_WIND } from '../src/core/BootWind.js';
import { G as GLOBALS } from '../src/core/Globals.js';
import { buildStation } from '../src/glider/Station.js';
import { GliderCollision } from '../src/glider/Collision.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { Group } from '../src/engine/index.js';
import { Material } from '../src/engine/render/Material.js';

const G = 9.81;
const terrain = new TerrainData();
const heightAt = ( x, z ) => terrain.heightAt( x, z );
const calmHigh = { sample: () => ( {} ), terrainAt: () => - 1000, waterAt: () => - 1000 };
// Wind blowing toward 70 degrees (x 0.35, z 0.94): straight up the north face into the ramp.
const UP_RAMP = [ 0.35, 0.94 ];
const airAt = ( wx, wz ) => ( { sample: () => ( { wx, wz } ), terrainAt: heightAt, waterAt: () => 0 } );

function trimmed() {

	const g = new GliderPhysics(), e = equilibrium();
	g.phase = 'airborne';
	g.position = [ 0, 500, 0 ];
	g.velocity = [ 0, e.speed * Math.sin( e.gamma ), e.speed * Math.cos( e.gamma ) ];
	g.quaternion = poseQ( 0, e.pitch );
	return g;

}

test( 'holding full pull-in for 10 s keeps positive lift and builds speed toward 18-20 m/s', () => {

	const g = trimmed();
	g.controls.pitch = - 1;
	let minLift = Infinity;
	for ( let i = 0; i < 1200; i ++ ) {

		g.step( STEP, calmHigh );
		minLift = Math.min( minLift, g.metrics.lift );

	}
	assert.equal( g.phase, 'airborne', g.reason );
	assert.ok( minLift > 0, `lift went negative: ${ minLift.toFixed( 0 ) } N` );
	assert.ok( g.metrics.speed > 16 && g.metrics.speed < 22, `pulled-in airspeed ${ g.metrics.speed.toFixed( 1 ) } m/s` );
	assert.ok( g.metrics.sink < 4, `pulled-in sink ${ g.metrics.sink.toFixed( 1 ) } m/s` );

} );

test( 'holding full bank for 10 s settles in a 23-32 degree turn at a modest sink', () => {

	const g = trimmed();
	g.controls.roll = 1;
	let peak = 0;
	const late = [], sinks = [];
	for ( let i = 0; i < 1200; i ++ ) {

		g.step( STEP, calmHigh );
		peak = Math.max( peak, Math.abs( g.metrics.bank ) );
		if ( i >= 720 ) {

			late.push( Math.abs( g.metrics.bank ) );
			sinks.push( g.metrics.sink );

		}

	}
	const deg = 180 / Math.PI, mean = late.reduce( ( s, v ) => s + v, 0 ) / late.length, sink = sinks.reduce( ( s, v ) => s + v, 0 ) / sinks.length;
	assert.equal( g.phase, 'airborne', g.reason );
	assert.ok( mean * deg > 23 && mean * deg < 32, `steady bank ${ ( mean * deg ).toFixed( 1 ) } deg` );
	assert.ok( peak * deg < 34, `bank overshoot to ${ ( peak * deg ).toFixed( 1 ) } deg` );
	assert.ok( Math.max( ...late ) - Math.min( ...late ) < 0.05, 'the turn is not steady' );
	const straight = - equilibrium().speed * Math.sin( equilibrium().gamma );
	assert.ok( sink > straight && sink < 3, `turning sink ${ sink.toFixed( 2 ) } m/s against ${ straight.toFixed( 2 ) } straight` );

} );

test( 'a 1 s pull-in tap decays back to trim within two phugoid periods and never stalls', () => {

	const g = trimmed(), trim = equilibrium().speed;
	let stalled = false, early = 0, late = 0;
	for ( let i = 0; i < 2400; i ++ ) {

		g.controls.pitch = i < 120 ? - 1 : 0;
		g.step( STEP, calmHigh );
		stalled ||= g.metrics.stall;
		const error = Math.abs( g.metrics.speed - trim );
		if ( i < 1200 ) early = Math.max( early, error );
		else late = Math.max( late, error );

	}
	assert.equal( stalled, false, 'a short tap stalled the wing' );
	assert.ok( late < 0.35 * early, `speed error ${ early.toFixed( 2 ) } m/s in the first 10 s, still ${ late.toFixed( 2 ) } m/s after` );
	assert.ok( late < 0.8, `still porpoising by ${ late.toFixed( 2 ) } m/s` );

} );

test( 'weight-shift keys ease in over about 0.4 s instead of jumping', () => {

	const g = trimmed();
	g.controls.pitch = - 1;
	for ( let i = 0; i < 12; i ++ ) g.step( STEP, calmHigh );
	const early = g.bar?.pitch;
	for ( let i = 0; i < 60; i ++ ) g.step( STEP, calmHigh );
	assert.ok( early < - 0.1 && early > - 0.45, `bar after 0.1 s: ${ early }` );
	assert.equal( g.bar.pitch, - 1 );

} );

function launchIn( env ) {

	const g = new GliderPhysics(), error = g.launch( env );
	if ( error ) return { g, error };
	let i = 0;
	while ( g.phase === 'running' && i ++ < 2400 ) g.step( STEP, env );
	const leave = g.metrics.speed, top = g.position[ 1 ];
	let best = leave;
	for ( let j = 0; j < 120; j ++ ) {

		g.step( STEP, env );
		best = Math.max( best, g.metrics.speed );

	}
	for ( let j = 0; j < 480 && g.phase === 'airborne'; j ++ ) g.step( STEP, env );
	return { g, error, leave, best, drop: top - g.position[ 1 ] };

}

test( 'the retuned polar sits in the real bands: stall 28-30, trim 36-40 km/h, min sink 0.9-1.2 m/s, best glide 10-12', () => {

	const trim = equilibrium(), vs = stallSpeed( 0 );
	let best = 0, minSink = Infinity;
	for ( let a = 0; a <= WING.stallAlpha; a += 0.002 ) {

		const e = equilibrium( a );
		best = Math.max( best, e.ratio );
		minSink = Math.min( minSink, - e.speed * Math.sin( e.gamma ) );

	}
	assert.ok( vs * 3.6 >= 28 && vs * 3.6 <= 30, `stall ${ ( vs * 3.6 ).toFixed( 1 ) } km/h` );
	assert.ok( trim.speed * 3.6 >= 36 && trim.speed * 3.6 <= 40, `trim ${ ( trim.speed * 3.6 ).toFixed( 1 ) } km/h` );
	assert.ok( minSink >= 0.9 && minSink <= 1.2, `min sink ${ minSink.toFixed( 2 ) } m/s` );
	assert.ok( best >= 10 && best <= 12, `best glide ${ best.toFixed( 2 ) }:1` );

} );

test( 'calm and headwind launches reach 1.15 x stall within 1 s of leaving the ramp', () => {

	const vs = stallSpeed( LAUNCH.y );
	for ( const knots of [ 0, 3.5, 7 ] ) {

		const r = launchIn( airAt( knots * UP_RAMP[ 0 ], knots * UP_RAMP[ 1 ] ) );
		assert.equal( r.error, null, `${ knots } m/s: ${ r.error }` );
		assert.ok( r.best >= 1.15 * vs, `${ knots } m/s: ${ r.best.toFixed( 1 ) } m/s within 1 s of leaving, needs ${ ( 1.15 * vs ).toFixed( 1 ) }` );
		assert.equal( r.g.phase, 'airborne', `${ knots } m/s: ${ r.g.reason }` );

	}
	// Calm air: the run plus the ramp's slope alone carry the wing to flying speed before the edge.
	assert.ok( launchIn( airAt( 0, 0 ) ).leave >= 1.15 * vs, 'a calm run left the ramp below 1.15 x stall' );

} );

const UNIFORM_AIR_START = Object.freeze( { east: 2, north: 19, height: 25 } );

test( 'a practice approach flared below 1.5 m lands under 1.5 m/s with no balloon above 2 m; an early flare stalls and drops', () => {

	const wind = airAt( 7 * UP_RAMP[ 0 ], 7 * UP_RAMP[ 1 ] );
	const fly = flareAt => {

		const g = new GliderPhysics();
		g.approach( wind, UNIFORM_AIR_START );
		let top = - 1;
		for ( let i = 0; i < 3600 && g.phase === 'airborne'; i ++ ) {

			g.controls.flare = i > 0 && ( g.metrics.agl < flareAt || top >= 0 );
			if ( g.controls.flare ) top = Math.max( top, g.metrics.agl );
			g.step( STEP, wind );

		}
		return { g, top };

	};
	const good = fly( 1.5 ), early = fly( 4 );
	assert.equal( good.g.phase, 'landed', good.g.reason );
	assert.ok( good.g.metrics.impactSpeed < 1.5, `touchdown ${ good.g.metrics.impactSpeed.toFixed( 2 ) } m/s` );
	assert.ok( good.top <= 2, `ballooned to ${ good.top.toFixed( 2 ) } m` );
	assert.equal( early.g.phase, 'crashed' );
	assert.ok( early.g.metrics.impactSpeed > 4, `early flare dropped at ${ early.g.metrics.impactSpeed.toFixed( 2 ) } m/s` );

} );

function flareFinal( headwind, airspeed ) {

	const env = { sample: () => ( { wz: - headwind } ), terrainAt: () => 0, waterAt: () => - 1000 };
	let alpha = WING.trimAlpha;
	for ( let i = 0; i < 40; i ++ ) alpha += ( equilibrium( alpha ).speed - airspeed ) * 0.002;
	const e = equilibrium( alpha ), pull = ( alpha - WING.trimAlpha ) / ( WING.trimAlpha - 0.01 );
	const g = new GliderPhysics();
	g.phase = 'airborne';
	g.position = [ 0, 1.45 + 8, 0 ];
	g.velocity = [ 0, e.speed * Math.sin( e.gamma ), e.speed * Math.cos( e.gamma ) - headwind ];
	g.quaternion = poseQ( 0, e.pitch );
	g.bar.pitch = g.controls.pitch = pull;
	let top = - 1, flareSpeed = 0;
	for ( let i = 0; i < 2400 && g.phase === 'airborne'; i ++ ) {

		if ( ! g.controls.flare && g.metrics.agl > 0 && g.metrics.agl < 2 ) {

			g.controls.flare = true;
			g.controls.pitch = 0;
			flareSpeed = g.metrics.speed;

		}
		if ( g.controls.flare ) top = Math.max( top, g.metrics.agl );
		g.step( STEP, env );

	}
	const m = g.metrics;
	const said = `${ headwind } m/s headwind: ${ g.phase } '${ g.reason }': final ${ e.speed.toFixed( 1 ) }, flare at ${ flareSpeed.toFixed( 1 ) } m/s air, ground ${ m.landingSpeed.toFixed( 2 ) } m/s, sink ${ m.impactSpeed.toFixed( 2 ) } m/s, top ${ top.toFixed( 2 ) } m`;
	return { g, e, m, top, flareSpeed, said };

}

test( 'a well-timed flare from a 13 m/s final into a 5.5 m/s surface wind touches down on the feet at 3 m/s or less over the ground', () => {

	const { g, e, m, top, flareSpeed, said } = flareFinal( 5.5, 13 );
	assert.ok( Math.abs( e.speed - 13 ) < 0.3 && flareSpeed > 12, said );
	assert.equal( g.phase, 'landed', said );
	assert.ok( m.landingSpeed <= 3, said );
	assert.ok( m.impactSpeed < 2.6, said );
	assert.ok( top <= 2, `ballooned: ${ said }` );

} );

test( 'the push-out brakes a calm-air 11 m/s final to a running touchdown at 3.5 m/s or less, and a 5.5 m/s headwind final to 2 m/s or less', () => {

	const calm = flareFinal( 0, 11 ), windy = flareFinal( 5.5, 13 );
	for ( const run of [ calm, windy ] ) {

		assert.equal( run.g.phase, 'landed', run.said );
		assert.ok( run.m.impactSpeed < 2.6, run.said );
		assert.ok( run.top <= 2, `ballooned: ${ run.said }` );

	}
	assert.ok( calm.m.landingSpeed <= 3.5, calm.said );
	assert.ok( windy.m.landingSpeed <= 2, windy.said );

} );

function footedTouchdown( ground ) {

	const env = { sample: () => ( {} ), terrainAt: () => 0, waterAt: () => - 1000 };
	const g = new GliderPhysics();
	g.phase = 'airborne';
	g.position = [ 0, 1.45 + 0.05, 0 ];
	g.velocity = [ 0, - 0.5, ground ];
	g.quaternion = poseQ( 0, 0.3 );
	g.controls.flare = true;
	for ( let i = 0; i < 120 && g.phase === 'airborne'; i ++ ) g.step( STEP, env );
	return { g, said: `${ ground } m/s over the ground: ${ g.phase } '${ g.reason }', touchdown ${ g.metrics.landingSpeed.toFixed( 2 ) } m/s, sink ${ g.metrics.impactSpeed.toFixed( 2 ) } m/s` };

}

test( 'feet down at 3 m/s over the ground is a running landing; at 5 m/s the pilot stumbles', () => {

	const jog = footedTouchdown( 3 ), fast = footedTouchdown( 5 );
	assert.equal( jog.g.phase, 'landed', jog.said );
	assert.ok( jog.g.metrics.landingSpeed <= 3.5, jog.said );
	assert.equal( fast.g.phase, 'crashed', fast.said );
	assert.match( fast.g.reason, /Stumbled/, fast.said );
	assert.ok( fast.g.metrics.landingSpeed > 3.5 && fast.g.metrics.impactSpeed < 2.6, `the stumble is the ground speed, not the sink: ${ fast.said }` );

} );

// The browser game launches through GliderAir, where 7 m/s up the north face adds several m/s of
// slope lift at the deck. A run posed against the ramp slope met that updraft at the stall angle and
// crashed on the deck in every glider.spec scenario (2026-10-05, run 5.04 m, stall true, sink 8 m/s).
test( 'a deck launch in the island air (7 m/s up the face plus slope lift) leaves unstalled and keeps flying', () => {

	const app = islandApp( { x: 7 * UP_RAMP[ 0 ], z: 7 * UP_RAMP[ 1 ] } );
	Object.assign( app, { coastalRoute: new CoastalRoute( terrain ), scene: new Group(), colliders: new Colliders(), village: { materials: { wood: new Material(), stone: new Material(), hard: new Material() } } } );
	buildStation( app );
	const glider = new Glider( app ), g = glider.flight, env = glider.env, collision = new GliderCollision( app.colliders );
	// The deck, rails and ramp the game wing collides with (Glider.init sets the same obstacleAt).
	env.obstacleAt = ( x, y, z ) => collision.at( x, y, z );
	const vs = stallSpeed( LAUNCH.y );
	assert.equal( g.launch( env ), null );
	let i = 0;
	while ( g.phase === 'running' && i ++ < 2400 ) g.step( STEP, env );
	const updraft = env.sample( ...g.position ).wy;
	let stalledFor = 0, best = 0, peakAlpha = - Infinity;
	for ( let j = 0; j < 360 && g.phase === 'airborne'; j ++ ) {

		g.step( STEP, env );
		if ( g.metrics.stall ) stalledFor += STEP;
		if ( j < 120 ) best = Math.max( best, g.metrics.speed );
		peakAlpha = Math.max( peakAlpha, g.metrics.alpha );

	}
	assert.equal( g.phase, 'airborne', `${ g.reason } (updraft at lift-off ${ updraft.toFixed( 2 ) } m/s)` );
	assert.equal( stalledFor, 0, `stalled ${ stalledFor.toFixed( 2 ) } s, peak angle of attack ${ peakAlpha.toFixed( 2 ) } rad (stall ${ WING.stallAlpha }), updraft ${ updraft.toFixed( 2 ) } m/s` );
	assert.ok( best >= 1.15 * vs, `${ best.toFixed( 1 ) } m/s within 1 s of leaving, needs ${ ( 1.15 * vs ).toFixed( 1 ) }` );

} );

test( 'tailwind and strong crosswind launches are refused with a reason and the glider stays on the deck', () => {

	const side = [ UP_RAMP[ 1 ], - UP_RAMP[ 0 ] ];
	for ( const [ name, env ] of [ [ 'tailwind', airAt( - 7 * UP_RAMP[ 0 ], - 7 * UP_RAMP[ 1 ] ) ], [ 'crosswind', airAt( 7 * side[ 0 ], 7 * side[ 1 ] ) ] ] ) {

		const r = launchIn( env );
		assert.equal( typeof r.error, 'string', `${ name } launch was not refused` );
		assert.match( r.error, /wind/i );
		assert.equal( r.g.phase, 'ready', `${ name } launch left the deck` );

	}

} );

function islandApp( ambient ) {

	const field = new DisasterField( heightAt );
	field.ambient = () => ambient;
	return { terrainData: terrain, disasters: { field } };

}

// Steepest ground slope along the ramp axis, ahead of (sign 1) or behind (sign -1) the deck.
function slopePoint( sign ) {

	let best = null;
	for ( let along = 30; along <= 260; along += 5 ) {

		const a = launchPoint( 0, sign * along ), b = launchPoint( 0, sign * along + 5 ), c = launchPoint( 0, sign * along - 5 );
		const slope = ( heightAt( b[ 0 ], b[ 2 ] ) - heightAt( c[ 0 ], c[ 2 ] ) ) / 10;
		const score = - slope * sign;
		if ( ! best || score > best.score ) best = { x: a[ 0 ], z: a[ 2 ], y: heightAt( a[ 0 ], a[ 2 ] ), slope, score };

	}
	return best;

}

test( 'a 7 m/s wind up the north face lifts on the windward slope and sinks in the lee', () => {

	const glider = new Glider( islandApp( { x: 7 * UP_RAMP[ 0 ], z: 7 * UP_RAMP[ 1 ] } ) );
	const face = slopePoint( 1 ), lee = slopePoint( - 1 );
	const up = glider.env.sample( face.x, face.y + 20, face.z ).wy || 0;
	const down = glider.env.sample( lee.x, lee.y + 20, lee.z ).wy || 0;
	assert.ok( up > 1, `windward face (slope ${ face.slope.toFixed( 2 ) }) updraft ${ up.toFixed( 2 ) } m/s` );
	assert.ok( down < - 0.3, `lee (slope ${ lee.slope.toFixed( 2 ) }) vertical air ${ down.toFixed( 2 ) } m/s` );
	// env.sample fills one reused object (no allocation per step), so copy what is kept.
	const low = { ...glider.env.sample( LAUNCH.x, LAUNCH.y + 5, LAUNCH.z ) }, high = { ...glider.env.sample( LAUNCH.x, LAUNCH.y + 120, LAUNCH.z ) };
	const speed = s => Math.hypot( s.wx || 0, s.wz || 0 );
	assert.ok( speed( high ) > 1.2 * speed( low ), `wind ${ speed( low ).toFixed( 1 ) } m/s at 5 m, ${ speed( high ).toFixed( 1 ) } m/s at 120 m` );

} );

test( 'trimmed flight over the windward face holds height in 7 m/s and sinks normally in calm air', () => {

	const face = slopePoint( 1 ), e = equilibrium();
	const fly = ( ambient ) => {

		const glider = new Glider( islandApp( ambient ) ), g = glider.flight;
		g.phase = 'airborne';
		g.position = [ face.x, face.y + 35, face.z ];
		g.quaternion = poseQ( LAUNCH.yaw, e.pitch );
		g.velocity = rotate( g.quaternion, [ 0, 0, 0 ] );
		const ahead = rotate( poseQ( LAUNCH.yaw ), [ 0, e.speed * Math.sin( e.gamma ), e.speed * Math.cos( e.gamma ) ] );
		g.velocity = [ ahead[ 0 ] + ambient.x, ahead[ 1 ], ahead[ 2 ] + ambient.z ];
		const start = g.position[ 1 ];
		for ( let i = 0; i < 1200 && g.phase === 'airborne'; i ++ ) g.step( STEP, glider.env );
		return { loss: start - g.position[ 1 ], phase: g.phase };

	};
	const ridge = fly( { x: 7 * UP_RAMP[ 0 ], z: 7 * UP_RAMP[ 1 ] } ), calm = fly( { x: 0, z: 0 } );
	assert.equal( ridge.phase, 'airborne' );
	assert.ok( calm.loss > 7 && calm.loss < 14, `calm 10 s height loss ${ calm.loss.toFixed( 1 ) } m (trim sink about 1.0 m/s)` );
	assert.ok( ridge.loss < 5, `ridge 10 s height loss ${ ridge.loss.toFixed( 1 ) } m` );

} );

test( 'thermals lift in sunshine and leave the air between them alone', () => {

	const glider = new Glider( islandApp( { x: 0, z: 0 } ) );
	const thermal = glider.air?.thermals?.[ 0 ];
	assert.ok( thermal, 'no thermals exist' );
	const ground = Math.max( heightAt( thermal.x, thermal.z ), 0 );
	const core = glider.env.sample( thermal.x, ground + 200, thermal.z ).wy || 0;
	const away = glider.env.sample( thermal.x + thermal.radius * 4, ground + 200, thermal.z ).wy || 0;
	assert.ok( core > 1.5 && core < 4, `thermal core ${ core.toFixed( 2 ) } m/s` );
	assert.ok( Math.abs( away ) < 0.4, `air four radii out moves ${ away.toFixed( 2 ) } m/s` );

} );

function walkerApp( hitKey ) {

	const app = islandApp( { x: 7 * UP_RAMP[ 0 ], z: 7 * UP_RAMP[ 1 ] } );
	const pressed = new Set();
	app.input = { keys: new Set(), pressed, hit: k => pressed.has( k ), down: () => false, consumeLook: () => ( { x: 0, y: 0 } ) };
	app.colliders = new Colliders();
	app.camera = { up: { set() {} } };
	app.cameraCut = () => {};
	app.player = new Player( { camera: {}, input: app.input, terrain, colliders: app.colliders, query: { allocate: () => 0 }, boat: null } );
	app.player.mode = 'walk';
	return app;

}

test( 'E at the launch deck clips in, W runs off the ramp, and E in flight bails the pilot out while the glider flies on', () => {

	const app = walkerApp(), glider = new Glider( app ), p = app.player;
	glider.station = { launchRecord: { broken: false } };
	const deck = launchPoint( 0, - 5, 1.6 );
	p.position.set( deck[ 0 ], deck[ 1 ], deck[ 2 ] );
	const offer = glider.offer?.( p );
	assert.ok( offer && /glider/i.test( offer.text ), 'no E prompt at the launch deck' );
	offer.act();
	assert.equal( glider.active, true );
	assert.equal( glider.pilot, true );
	assert.equal( glider.flight.phase, 'ready' );
	app.input.pressed.add( 'KeyW' );
	glider.controls();
	app.input.pressed.clear();
	assert.equal( glider.flight.phase, 'running', 'W did not start the run' );
	for ( let i = 0; i < 2400 && glider.flight.phase !== 'airborne'; i ++ ) glider.flight.step( STEP, glider.env );
	for ( let i = 0; i < 240; i ++ ) glider.flight.step( STEP, glider.env );
	const thrown = [];
	p.ragdoll = ( impulse, point, opts ) => {

		thrown.push( opts );
		return true;

	};
	const at = [ ...glider.flight.position ], velocity = [ ...glider.flight.velocity ];
	app.input.pressed.add( 'KeyE' );
	glider.controls();
	app.input.pressed.clear();
	assert.equal( glider.active, false, 'E in flight did not leave the glider' );
	assert.equal( glider.lastExit, 'bail' );
	assert.equal( thrown.length, 1, 'the pilot was not handed to the ragdoll' );
	assert.ok( Math.hypot( thrown[ 0 ].velocity.x - velocity[ 0 ], thrown[ 0 ].velocity.y - velocity[ 1 ], thrown[ 0 ].velocity.z - velocity[ 2 ] ) < 0.5, 'the pilot did not keep the glider velocity' );
	assert.ok( Math.hypot( p.position.x - at[ 0 ], p.position.y - at[ 1 ], p.position.z - at[ 2 ] ) < 3, 'the pilot was teleported' );
	const before = glider.flight.distance;
	for ( let i = 0; i < 240; i ++ ) glider.flight.step( STEP, glider.env );
	// Into a 7 m/s headwind the trimmed wing covers about 4 m/s over the ground.
	assert.equal( glider.flight.phase, 'airborne', glider.flight.reason );
	assert.ok( glider.flight.distance - before > 6, `the empty glider covered ${ ( glider.flight.distance - before ).toFixed( 1 ) } m in 2 s` );

} );

test( 'E after landing steps off beside the wing', () => {

	const app = walkerApp(), glider = new Glider( app ), p = app.player;
	glider.station = { launchRecord: { broken: false } };
	const deck = launchPoint( 0, - 5, 1.6 );
	p.position.set( deck[ 0 ], deck[ 1 ], deck[ 2 ] );
	glider.offer( p ).act();
	const beach = [ - 92, heightAt( - 92, - 91 ) + 1.45, - 91 ];
	Object.assign( glider.flight, { phase: 'landed', position: beach, velocity: [ 0, 0, 0 ] } );
	app.input.pressed.add( 'KeyE' );
	glider.controls();
	assert.equal( glider.active, false );
	assert.equal( glider.lastExit, 'local' );
	assert.ok( Math.hypot( p.position.x - beach[ 0 ], p.position.z - beach[ 2 ] ) < 6, 'stepped off far from the wing' );

} );

test( 'the island boots with one wind: 7 m/s toward 70 degrees, the shader default and straight up the ramp', () => {

	const toward = BOOT_WIND.direction * Math.PI / 180, ramp = [ Math.sin( LAUNCH.yaw ), Math.cos( LAUNCH.yaw ) ];
	const shader = GLOBALS.windDir.value, shaderDegrees = Math.atan2( shader.y, shader.x ) * 180 / Math.PI;
	assert.ok( Math.abs( shaderDegrees - BOOT_WIND.direction ) < 1, `G.windDir default ${ shaderDegrees.toFixed( 1 ) } degrees, boot ${ BOOT_WIND.direction }` );
	assert.equal( BOOT_WIND.speed, 7 );
	const head = - ( Math.cos( toward ) * ramp[ 0 ] + Math.sin( toward ) * ramp[ 1 ] );
	assert.ok( head > 0.99, `boot wind is only ${ ( head * 100 ).toFixed( 0 ) }% headwind on the ramp` );

} );

import { hikePercent } from '../src/glider/Panel.js';
test( 'the hike chip never reads 100% before the last waypoint', () => {

	assert.equal( hikePercent( 3272, 3287 ), 99, `3272 of 3287 waypoints read ${ hikePercent( 3272, 3287 ) }%` );
	assert.equal( hikePercent( 3285, 3287 ), 99 );
	assert.equal( hikePercent( 3286, 3287 ), 100, "the last waypoint (index length - 1) is the summit" );
	assert.equal( hikePercent( 0, 3287 ), 0 );
	assert.equal( hikePercent( 1644, 3287 ), 50 );

} );
