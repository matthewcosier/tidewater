import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';
import { DamageState, ImpactMerge } from '../src/rally/DamageModel.js';

await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );
// The Aster's body box and wheel hubs in car-local metres (+Z nose, +X driver-left), as test/damage.mjs.
const DIMS = { hx: 0.95, hz: 2.3, floor: 0.1, top: 1.35, wheels: [ [ - 0.79, 1.35 ], [ 0.79, 1.35 ], [ - 0.79, - 1.3 ], [ 0.79, - 1.3 ] ] };
const FRAME = 1 / 60; // s: two 120 Hz physics steps per display frame, as in the game

function world() {
	const sim = new RallyPhysics();
	sim.set_terrain( new Float32Array( 81 ), 9, 400, - 200 );
	sim.reset( 0, 0.45, 0, 0 );
	const damage = new DamageState( DIMS, [] ), merge = new ImpactMerge();
	const crashes = [];
	// wall: the frame's wall-clock interval (s). The engine hands every system at most 0.1 s of it
	// (src/engine/Engine.js `if ( dt > 0.1 ) dt = 0.1`), the poses and advance alike; advance runs at most
	// 12 steps of 1/120 s over it (lib.rs CATCH_UP_MAX_STEPS).
	const frame = ( throttle = 0, brake = 0, before = null, wall = FRAME ) => {
		const dt = Math.min( wall, 0.1 );
		before?.( dt );
		sim.advance( dt, throttle, brake, 0, 0 );
		const crash = merge.add( sim.take_impacts(), dt );
		if ( crash ) { crashes.push( crash.severity ); damage.hit( crash.p, crash.d, crash.severity ); }
		damage.tick( dt );
	};
	for ( let i = 0; i < 120; i ++ ) frame();
	return { sim, damage, crashes, frame, kmh: () => sim.snapshot()[ 7 ] };
}
// A parked traffic car as src/ferry/Traffic.js builds it: four kinematic car bodies, fore and aft and a
// pair LOW under them (ParkedPickup: kind 1, lift -0.3, reach 0.7), at x, z (its origin), heading +Z.
function parkTraffic( sim, id, x, y, z ) {
	for ( let j = 0; j < 4; j ++ ) {
		const k = j & 1 ? - 1 : 1, low = j > 1 ? 1 : 0;
		sim.update_remote( id + j, 1, new Float32Array( [ x, y - 0.3 - low * 0.28, z + k * 0.7, 0, 0, 0, 1, 0 ] ) );
	}
}
const report = w => `crashes (delta-v, m/s) ${ w.crashes.map( v => v.toFixed( 1 ) ).join( ' ' ) || 'none' }; corners ${ w.damage.corners.map( v => v.toFixed( 2 ) ).join( ' ' ) }; zones ${ w.damage.zones.map( v => v.toFixed( 2 ) ).join( ' ' ) }`;

test( 'Backing at 8 km/h into a parked car, then 20 deck-pilot taps at 3-6 km/h: dents, no wheel off, no steam', () => {
	const w = world();
	parkTraffic( w.sim, 10, - 1.0, 0, - 8 );
	let peak = 0;
	for ( let i = 0; i < 600; i ++ ) { peak = Math.max( peak, - w.kmh() ); w.frame( 0, w.kmh() > - 8 ? 1 : 0 ); }
	for ( let n = 0; n < 20; n ++ ) {
		const target = 3 + ( n % 4 ), ahead = n % 2 === 0;
		for ( let i = 0; i < 300; i ++ ) { const go = Math.abs( w.kmh() ) < target; w.frame( ahead && go ? 1 : 0, ! ahead && go ? 1 : 0 ); }
	}
	assert.ok( peak < 10, `backed at ${ peak.toFixed( 1 ) } km/h` );
	assert.ok( w.crashes.length >= 1, 'the car never touched the parked car' );
	assert.equal( w.damage.wheelsLost, 0, `a wheel came off: ${ report( w ) }` );
	assert.equal( w.damage.steam, 0, `the radiator holed: ${ report( w ) }` );
} );

test( 'A parked car beside her on a rolling deck, set into the car each frame, is not a crash', () => {
	const w = world();
	let t = 0;
	const sway = () => { t += FRAME; parkTraffic( w.sim, 10, - 2.05 + 0.06 * Math.sin( t * 2 * Math.PI / 4 ), 0, - 0.5 ); };
	for ( let i = 0; i < 1800; i ++ ) w.frame( 0, 0, sway );
	assert.equal( w.damage.wheelsLost, 0, `a wheel came off: ${ report( w ) }` );
	assert.equal( w.damage.steam, 0, `the radiator holed: ${ report( w ) }` );
	assert.ok( Math.max( 0, ...w.crashes ) < 4.2, `a sway against a parked car merged into a crash: ${ report( w ) }` );
} );

// Her deck as Ferry.js hands it to the car physics: one kinematic platform (the deck, the transom and the
// lowered ramp from HINGE to TOE, Ferry.js:25 and its platform boxes) posed once a frame by
// set_platform( p, q, v.x, 0, v.z, 0, yaw rate, 0 ) (Ferry.js:147): no heave, pitch or roll rate. Her
// motion at the berth: FerryShip.js:141-143 swell at lively 1 (0.06 + 0.03 m heave, 0.004 rad pitch,
// 0.006 rad roll) plus waterPose's wave heave and tilt, taken as a 0.1 m chop (heave 0.1 m at 1 rad/s,
// pitch 0.006 rad = 0.24 m over the 40 m between her sample points, roll 0.01 rad = 0.14 m over 14 m).
const HINGE = { z: - 25.2, y: 2.6 }, TOE = { z: - 25.2 - 7.79, y: 2.10 }, DECK = 900, T = 0.15;
const RUN = HINGE.z - TOE.z, RISE = HINGE.y - TOE.y, PITCH = Math.atan2( RISE, RUN ), HALF = ( Math.hypot( RUN, RISE ) + 0.4 ) / 2;
const DECK_BOXES = [
	0, HINGE.y - T, - 2.6, 6.6, T, 22.6, 0, 0, 0.9,
	0, 0.5, HINGE.z - T, 6.6, 1.5, T, 0, 0, 0.9,
	0, HINGE.y - HALF * Math.sin( PITCH ) - T * Math.cos( PITCH ), HINGE.z - HALF * Math.cos( PITCH ) + T * Math.sin( PITCH ), 5.0, T, HALF, 0, - PITCH, 0.9,
];
function deckPose( t ) {
	const heave = 0.06 * Math.sin( t * 0.7 ) + 0.03 * Math.sin( t * 1.3 + 1 ) + 0.1 * Math.sin( t );
	const pitch = 0.004 * Math.sin( t * 0.6 ) + 0.006 * Math.sin( t * 0.9 + 0.5 ), roll = 0.006 * Math.sin( t * 0.5 + 2 ) + 0.01 * Math.sin( t * 0.8 + 1.2 );
	const cx = Math.cos( pitch / 2 ), sx = Math.sin( pitch / 2 ), cz = Math.cos( roll / 2 ), sz = Math.sin( roll / 2 );
	return { p: [ 0, heave - TOE.y, 0 ], q: [ sx * cz, - sx * sz, cx * sz, cx * cz ] }; // XYZ euler, yaw 0 (FerryShip.js:190)
}
function rotate( [ x, y, z, w ], [ vx, vy, vz ] ) {
	const tx = 2 * ( y * vz - z * vy ), ty = 2 * ( z * vx - x * vz ), tz = 2 * ( x * vy - y * vx );
	return [ vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx ];
}
// The deck moving under a car at rest on it, a parked pickup riding the deck (Traffic.js:551-561 poses parked
// cars on the deck with speed 0 whatever the deck does), as the game does it each frame. Under way the deck
// also runs ahead at the ship's speed, which set_platform is given (Ferry.js:147 passes v.x, v.z).
function deckWorld( z0, { speed = 0, pickup = [ - 2.05, z0 ] } = {} ) {
	const w = world();
	// Under way she works up to speed over 20 s (a ferry takes longer); the car came aboard at the berth.
	const RAMP_UP = 20, run = t => speed * ( t < RAMP_UP ? t * t / ( 2 * RAMP_UP ) : t - RAMP_UP / 2 );
	let t = 0;
	w.sim.add_platform_pitched( DECK, new Float32Array( DECK_BOXES ) );
	w.lift = 0;
	w.ride = ( dt = FRAME ) => {
		t += dt;
		const { p, q } = deckPose( t );
		p[ 2 ] += run( t );
		p[ 1 ] += w.lift;
		w.sim.set_platform( DECK, new Float32Array( [ ...p, ...q, 0, 0, speed * Math.min( 1, t / RAMP_UP ), 0, 0, 0 ] ) );
		for ( let j = 0; j < 4; j ++ ) {
			const k = j & 1 ? - 1 : 1, low = j > 1 ? 1 : 0;
			const at = rotate( q, [ pickup[ 0 ], HINGE.y + 0.45 - 0.3 - low * 0.28, pickup[ 1 ] + k * 0.7 ] );
			w.sim.update_remote( 10 + j, 1, new Float32Array( [ at[ 0 ] + p[ 0 ], at[ 1 ] + p[ 1 ], at[ 2 ] + p[ 2 ], ...q, 0 ] ) );
		}
	};
	w.ride();
	w.sim.reset( 0, HINGE.y + 0.45, z0, 0 );
	for ( let i = 0; i < ( speed ? ( RAMP_UP + 2 ) / FRAME : 120 ); i ++ ) w.frame( 0, 0, w.ride );
	w.damage.reset(); w.crashes.length = 0;
	w.deckZ = () => w.sim.snapshot()[ 2 ] - run( t );
	return w;
}

test( 'At rest on her heaving, pitching deck beside a parked car for 30 s: no crash', () => {
	const w = deckWorld( 0 );
	for ( let i = 0; i < 1800; i ++ ) w.frame( 0, 0, w.ride );
	assert.ok( Math.abs( w.sim.snapshot()[ 2 ] ) < 1, `the car slid along the deck to z ${ w.sim.snapshot()[ 2 ].toFixed( 2 ) }` );
	assert.equal( w.damage.wheelsLost, 0, `a wheel came off: ${ report( w ) }` );
	assert.equal( w.damage.steam, 0, `the radiator holed: ${ report( w ) }` );
	assert.ok( Math.max( 0, ...w.crashes ) < 4.2, `the deck's motion merged into a crash: ${ report( w ) }` );
	assert.ok( w.damage.zones.every( v => v <= 0.05 ), `resting on the deck dented her: ${ report( w ) }` );
} );

test( 'Backing off down the ramp at 8 km/h while her deck heaves and pitches: no wheel off, no steam', () => {
	const w = deckWorld( - 14 );
	let peak = 0, i = 0;
	for ( ; i < 1500 && w.sim.snapshot()[ 2 ] > TOE.z - 6; i ++ ) { peak = Math.max( peak, - w.kmh() ); w.frame( w.kmh() < - 8 ? 0.5 : 0, w.kmh() > - 7 ? 1 : 0, w.ride ); }
	for ( let j = 0; j < 240; j ++ ) w.frame( 0, 0, w.ride );
	assert.ok( w.sim.snapshot()[ 2 ] < TOE.z - 4, `she never got off the ramp: z ${ w.sim.snapshot()[ 2 ].toFixed( 2 ) }` );
	assert.ok( peak < 10, `backed at ${ peak.toFixed( 1 ) } km/h` );
	assert.equal( w.damage.wheelsLost, 0, `a wheel came off: ${ report( w ) }` );
	assert.equal( w.damage.steam, 0, `the radiator holed: ${ report( w ) }` );
	assert.ok( Math.max( 0, ...w.crashes ) < 4.2, `backing down a moving ramp merged into a crash: ${ report( w ) }` );
} );

test( 'Under way at 5 m/s, she backs at 3 km/h onto the pickup parked behind her on the deck: a knock, not a crash', () => {
	const w = deckWorld( - 4, { speed: 5, pickup: [ 0, - 10.6 ] } );
	const deckZ = w.deckZ, z0 = deckZ();
	let peak = 0;
	for ( let i = 0; i < 900; i ++ ) {
		const rel = w.kmh(); // the snapshot's speed is over the ground under her wheels: her deck
		peak = Math.max( peak, - rel );
		w.frame( 0, rel > - 3 ? 1 : 0, w.ride );
	}
	assert.ok( peak < 6, `backed at ${ peak.toFixed( 1 ) } km/h along the deck` );
	for ( let i = 0; i < 240; i ++ ) w.frame( 0, 0, w.ride );
	assert.ok( Math.abs( z0 + 4 ) < 0.5, `the deck did not carry her while it worked up to speed: deck z ${ z0.toFixed( 2 ) }` );
	// 15 s at 3 km/h is 12 m of deck: she backed up to the pickup and it held her there.
	assert.ok( deckZ() < z0 - 1.2 && deckZ() > z0 - 3, `she did not back onto the pickup: deck z ${ z0.toFixed( 2 ) } to ${ deckZ().toFixed( 2 ) }` );
	assert.equal( w.damage.wheelsLost, 0, `a wheel came off: ${ report( w ) }` );
	assert.equal( w.damage.steam, 0, `the radiator holed: ${ report( w ) }` );
	assert.ok( Math.max( 0, ...w.crashes ) < 4.2, `a 3 km/h knock on a moving deck merged into a crash: ${ report( w ) }` );
} );

test( 'The check-in boom drops onto her bonnet at 0 km/h, then she noses into it at walking pace: no steam', () => {
	// Terminal.js setBoomSolid spawns the arm's car box (BOOM.car, 0.7 m deep, 0.2 m thick) whole once the
	// arm is under 0.12 of its lift, wherever the car is; then the driver creeps on into it.
	const w = world();
	w.sim.add_platform_pitched( 91, new Float32Array( [ 0, 0.75, 2.33, 2.25, 0.35, 0.1, 0, 0, 0.6 ] ) );
	w.sim.set_platform( 91, new Float32Array( [ 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0 ] ) );
	for ( let i = 0; i < 120; i ++ ) w.frame( 0, 0 );
	for ( let i = 0; i < 600; i ++ ) w.frame( w.kmh() < 5 ? 1 : 0, 0 );
	assert.equal( w.damage.steam, 0, `the boom holed the radiator: ${ report( w ) }` );
	assert.equal( w.damage.wheelsLost, 0, `a wheel came off: ${ report( w ) }` );
	assert.ok( w.damage.zones.every( v => v <= 0.05 ), `a walking-pace boom did more than dent her: ${ report( w ) }` );
} );

test( 'Forty 4 m/s knocks on her rear corner (10 km/h backs at the 1.5x a kinematic body reports) dent her and no more', () => {
	// The bumper floor (DamageModel BUMPER): under RCAR's 15 km/h a hit dents the panel and nothing else.
	const d = new DamageState( DIMS, [ { name: 'tail-lamp', anchor: [ - 0.8, 0.7, - 2.25 ], at: 0.3, radius: 0.6 } ] );
	let dented = 0;
	for ( let n = 0; n < 40; n ++ ) dented += d.hit( [ - 0.85, 0.4, - 1.6 ], [ 0.3, 0, 1 ], 4.0 ).energy > 0 ? 1 : 0;
	d.tick( FRAME );
	const r = `corners ${ d.corners.map( v => v.toFixed( 2 ) ).join( ' ' ) }; zones ${ d.zones.map( v => v.toFixed( 2 ) ).join( ' ' ) }; glass ${ d.glass.toFixed( 2 ) }; lost ${ d.lost }`;
	assert.equal( dented, 40, 'a knock must still dent the panel (energy for the mesh)' );
	assert.equal( d.wheelsLost, 0, `a wheel came off: ${ r }` );
	assert.ok( d.corners.every( v => v === 0 ) && d.toe.every( v => v === 0 ), `knocks bent the suspension: ${ r }` );
	assert.ok( d.zones.every( v => v <= 0.05 ) && d.glass === 0 && d.lost === 0, `knocks did more than dent: ${ r }` );
} );

test( 'Real crashes still count: a 40 km/h nose-in steams, a 50 km/h hub-square hit snaps the wheel', () => {
	const w = world();
	w.sim.add_boxes( new Float32Array( [ 0, 1, 60, 6, 1, 0.5, 0, 0.9 ] ) );
	for ( let i = 0; i < 900 && w.sim.snapshot()[ 2 ] < 40; i ++ ) w.frame( w.kmh() < 40 ? 1 : 0, 0 );
	for ( let i = 0; i < 240; i ++ ) w.frame( 0, 0 );
	assert.ok( w.damage.steam > 0, `a 40 km/h nose-in did not hole the radiator: ${ report( w ) }` );
	const hub = new DamageState( DIMS, [] );
	hub.hit( [ 0.9, 0.35, 1.4 ], [ - 1, 0, 0 ], 14.5 );
	assert.equal( hub.wheelsLost & 2, 2, 'a 50 km/h square hit on the front-right hub left the wheel on' );
} );

test( 'Her deck re-posed 0.2 m higher in one frame (a step, not motion) does not throw her', () => {
	const w = deckWorld( - 14 );
	let top = - Infinity;
	const y0 = w.sim.snapshot()[ 1 ];
	w.lift = 0.2;
	for ( let i = 0; i < 240; i ++ ) { w.frame( 0, 0, w.ride ); top = Math.max( top, w.sim.snapshot()[ 1 ] ); }
	assert.ok( top - y0 < 0.6, `the step threw her ${ ( top - y0 ).toFixed( 2 ) } m up off a 0.2 m step: ${ report( w ) }` );
	assert.equal( w.damage.wheelsLost, 0, `a wheel came off: ${ report( w ) }` );
	assert.equal( w.damage.steam, 0, `the radiator holed: ${ report( w ) }` );
	assert.ok( Math.max( 0, ...w.crashes ) < 4.2, `a 0.2 m step in her deck merged into a crash: ${ report( w ) }` );
} );

test( 'A pickup creeping into her nose at 2 m/s through hitched frames (0.3 s wall, 0.1 s handed on) pushes her, no crash', () => {
	const w = world();
	let z = 5.2, peak = 0; // m: the pickup's origin, heading -Z into her nose (+Z)
	const creep = dt => {
		z -= 2 * dt;
		for ( let j = 0; j < 4; j ++ ) {
			const k = j & 1 ? - 1 : 1, low = j > 1 ? 1 : 0;
			w.sim.update_remote( 20 + j, 1, new Float32Array( [ 0, 0.45 - 0.3 - low * 0.28, z + k * 0.7, 0, 1, 0, 0, 7.2 ] ) );
		}
	};
	for ( let i = 0; i < 240; i ++ ) { w.frame( 0, 0, creep, i % 4 === 3 ? 0.3 : FRAME ); peak = Math.max( peak, Math.abs( w.kmh() ) ); }
	assert.ok( w.sim.snapshot()[ 2 ] < - 1, `the pickup never reached her: z ${ w.sim.snapshot()[ 2 ].toFixed( 2 ) }` );
	assert.ok( peak < 16, `pushed at 7.2 km/h she reached ${ peak.toFixed( 1 ) } km/h: ${ report( w ) }` );
	assert.equal( w.damage.steam, 0, `the radiator holed: ${ report( w ) }` );
	assert.ok( Math.max( 0, ...w.crashes ) < 4.2, `a 2 m/s push through slow frames merged into a crash: ${ report( w ) }` );
} );
