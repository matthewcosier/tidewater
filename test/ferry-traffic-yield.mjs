import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '../src/engine/index.js';
import { Traffic } from '../src/ferry/Traffic.js';

const DECK = 2.6;                         // m, her vehicle deck (the road's height)
const RAMP = 2.2;                         // m/s, a boarding car over the linkspan (Traffic.js RAMP)
const CONTACT = 4.4;                      // m centre to centre where the player's Aster meets the boarding car's tail
const DT = 1 / 60;                        // s

function road( z0, z1 ) {

	const pts = [ new Vector3( 0, DECK, z0 ), new Vector3( 0, DECK, z1 ) ];
	return { pts, seg: new Float64Array( [ z1 - z0 ] ), len: z1 - z0 };

}

function rig( player ) {

	const app = { rally: { state: new Float32Array( 8 ), forward: { x: 0, y: 0, z: 1 }, velocity: { x: 0, y: 0, z: 0 } } };
	const traffic = new Traffic( app, { berths: [] } );
	const car = { state: 'board', seq: 1, s: 0, v: 0, world: new Vector3(), path: {} };
	traffic.cars.push( car );
	const set = ( x, z, fx, fz, vx, vz ) => {

		const st = app.rally.state;
		st[ 0 ] = x; st[ 1 ] = DECK; st[ 2 ] = z; st[ 7 ] = Math.hypot( vx, vz );
		app.rally.forward.x = fx; app.rally.forward.z = fz;
		app.rally.velocity.x = vx; app.rally.velocity.z = vz;

	};
	if ( player ) set( ...player );
	return { app, traffic, car, set };

}

function at( r, car, s ) {

	car.s = s;
	car.world.copy( r.pts[ 0 ] ).lerp( r.pts[ 1 ], s / r.len );
	return r;

}

test( 'A boarding car does not stop for the player\'s car following it at 3 to 5 m, closing at up to 1.5 m/s', () => {

	const r = road( - 60, 0 );
	const fails = [];
	for ( const gap of [ 3, 4, 5 ] ) for ( const close of [ 0, 0.5, 1, 1.5 ] ) for ( const v of [ 0, RAMP ] ) {

		const { traffic, car, set } = rig();
		at( r, car, 20 );
		const pz = car.world.z - CONTACT - gap, pv = v + close;
		set( 0, pz, 0, 1, 0, pv );
		car.v = v;
		const by = traffic.blocked( car, r.pts, r.seg, 0, r.len );
		if ( by ) fails.push( `gap ${ gap } m, player ${ pv.toFixed( 1 ) } m/s, car ${ v } m/s: ${ by }` );

	}
	// pushing against its tail: in contact, the player's measured velocity jitters up to 0.6 m/s
	for ( const pv of [ 0.3, 0.45, 0.6 ] ) {

		const { traffic, car, set } = rig();
		at( r, car, 20 );
		set( 0, car.world.z - CONTACT, 0, 1, 0, pv );
		const by = traffic.blocked( car, r.pts, r.seg, 0, r.len );
		if ( by ) fails.push( `in contact, player ${ pv } m/s: ${ by }` );

	}
	assert.equal( fails.length, 0, `stopped for a tailing player: ${ fails.join( '; ' ) }` );

} );

test( 'A boarding car followed up the linkspan by the player\'s car drives its 40 m in under 25 s and the player is never stuck behind it', () => {

	const r = road( - 60, - 20 );
	const { traffic, car, set } = rig();
	at( r, car, 0 );
	let pz = car.world.z - CONTACT - 3, pv = 0, stopped = 0, stall = 0, worst = 0, t = 0;
	for ( ; t < 25 && car.s < r.len - 0.01; t += DT ) {

		set( 0, pz, 0, 1, 0, pv );
		const by = traffic.blocked( car, r.pts, r.seg, 0, r.len );
		const want = by ? 0 : RAMP;
		car.v = want < car.v ? Math.max( want, car.v - 4 * DT ) : Math.min( want, car.v + 1.5 * DT );
		at( r, car, Math.min( r.len, car.s + car.v * DT ) );
		if ( by ) stopped += DT;
		// the player drives up at 10 km/h feathering W (the deck pilot's default, and a player's walking
		// pace up a linkspan), 3 m/s^2, unaware of the gap; the boarding car's solid tail stops it, and
		// its velocity then reads what it actually moves
		const was = pz;
		pv = Math.min( 2.78, pv + 3 * DT );
		pz = Math.min( pz + pv * DT, car.world.z - CONTACT );
		pv = Math.min( pv, ( pz - was ) / DT + 3 * DT );
		stall = pv > 0 && car.world.z - pz - CONTACT < 0.01 && car.v < 0.05 ? stall + DT : 0;
		worst = Math.max( worst, stall );

	}
	assert.ok( car.s >= r.len - 0.01, `the boarding car reached ${ car.s.toFixed( 1 ) } m of 40 m in ${ t.toFixed( 1 ) } s (stopped for the player ${ stopped.toFixed( 1 ) } s)` );
	assert.ok( stopped === 0, `the boarding car stopped for the player following it for ${ stopped.toFixed( 2 ) } s` );
	assert.ok( worst < 1, `the player stood pushed against the stopped boarding car for ${ worst.toFixed( 1 ) } s` );

} );

test( 'A boarding car still gives way to the player\'s car ahead on its road or driving across it, and to one cutting across from behind', () => {

	const r = road( - 60, 0 );
	const cases = [
		[ 'parked on its road 5 m ahead', [ 0, - 35, 0, 1, 0, 0 ] ],
		[ 'driving across its road 6 m ahead from 5 m to the side at 3 m/s', [ 5, - 34, - 1, 0, - 3, 0 ] ],
		[ 'cutting across from 2 m behind and 4 m to the side, 3 m/s across and 1 m/s along', [ 4, - 42, - 0.95, 0.32, - 3, 1 ] ],
		[ 'reversing down its road at it from 8 m ahead', [ 0, - 32, 0, 1, 0, - 2 ] ],
	];
	for ( const [ name, p ] of cases ) {

		const { traffic, car } = rig( p );
		at( r, car, 20 );
		assert.equal( traffic.blocked( car, r.pts, r.seg, 0, r.len ), 'player', `the player's car ${ name }: not given way to` );

	}
	// a player a lane over (3.25 m) driving the same way does not stop it either
	const { traffic, car } = rig( [ 3.25, - 42, 0, 1, 0, 3 ] );
	at( r, car, 20 );
	assert.equal( traffic.blocked( car, r.pts, r.seg, 0, r.len ), null, 'the player\'s car a lane over stopped it' );

} );
