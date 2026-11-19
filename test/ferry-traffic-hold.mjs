import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Traffic } from '../src/ferry/Traffic.js';
import { FerryService } from '../src/ferry/FerryService.js';
import { Vector3, Quaternion } from '../src/engine/index.js';

const DT = 1 / 60;                 // s, the game's frame
const RAMP = 2.2;                  // m/s, Traffic.js RAMP: the slowest pace on a boarding car's road
const EASE = 4;                    // s, the ease down to a stop at the slot (0.15 + 1.4 sqrt(d) m/s) and pulling away
// s per car ahead of it in the procession: that car's last 7.5 m (Traffic.js GAP) round her bow at
// TURN 2.4 m/s easing to a stop as 0.15 + 1.4 sqrt(d) m/s (about 4 s), then this car pulling away
// again from rest at 1.5 m/s2 (about 2 s), and the swing; measured 6.6 to 8.9 s a car (6 to 9 cars)
const SLOT = 9;
// a car's body footprint, half length and half width, m: a 4.8 m by 1.9 m mid-size car (a Camry is
// 4.88 m by 1.84 m; the four parked models run from a small hatch to a pickup), declared, so an
// overlap here is two car bodies through each other
const HALF_L = 2.4, HALF_W = 0.95;

// Do two cars' footprints overlap (separating axes; heading is atan2( dx, dz ), Traffic.drive)?
function overlap( a, b ) {

	if ( Math.abs( b.world.y - a.world.y ) > 1.5 ) return false;
	const dx = b.world.x - a.world.x, dz = b.world.z - a.world.z;
	const r = ( c, ax, az ) => HALF_L * Math.abs( Math.sin( c.heading ) * ax + Math.cos( c.heading ) * az ) + HALF_W * Math.abs( Math.cos( c.heading ) * ax - Math.sin( c.heading ) * az );
	for ( const h of [ a.heading, b.heading ] ) for ( const [ ax, az ] of [ [ Math.sin( h ), Math.cos( h ) ], [ Math.cos( h ), - Math.sin( h ) ] ] ) {

		if ( Math.abs( dx * ax + dz * az ) >= r( a, ax, az ) + r( b, ax, az ) ) return false;

	}
	return true;

}

// deterministic: the game's queue length and car models come from Math.random (Traffic.stop, spawn)
function seeded( seed ) {

	return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul( seed ^ seed >>> 15, 1 | seed ); t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t; return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296; };

}

// A terminal and a ship lying stern-to at it, both frames yaw 0 so local axes are world axes. Her
// stern ramp's toe (her z -25.2) meets the linkspan's end (terminal z -28.25), as on the berth.
function berth() {

	const terminal = { name: 'Tidewater', position: new Vector3( 0, 0, 0 ), yaw: 0, toWorld: ( p, out ) => out.set( p[ 0 ], p[ 1 ], p[ 2 ] ), openBoom() {} };
	const origin = new Vector3( 0, 0, - 3.05 );
	const ship = { moored: true, yaw: 0, quaternion: new Quaternion(), toWorld: ( v, out ) => out.copy( v ).add( origin ), toLocal: ( v, out ) => out.copy( v ).sub( origin ) };
	const ferry = { name: 'Tidewater Spirit', ship, ramp: 1, castingOff: false, at: { terminal }, berths: [ { terminal } ], service: { enabled: true, phase: 'loading', wait: 0 } };
	const app = { scene: { add() {}, remove() {} }, camera: { position: new Vector3( 0, 500, 0 ) }, rally: null, fleet: [ ferry ] };
	return { terminal, ship, ferry, app };

}

// Her call at the berth: ramp down, the queue in its places, `load` s of timetable, then her time.
// Returns the game s past her time until Traffic lets her go, the bound, and what held her.
function call( load, seed ) {

	const random = Math.random;
	Math.random = seeded( seed );
	try {

		const { terminal, ferry, app } = berth();
		const traffic = new Traffic( app, ferry );
		traffic.parts = new Map( [ 'ParkedAster', 'ParkedJeep', 'ParkedWagon', 'ParkedPickup' ].map( n => [ n, [] ] ) );
		const stop = traffic.stop( terminal );
		for ( let i = 0; i < stop.want; i ++ ) traffic.spawn( terminal, true );
		ferry.service.wait = load;
		let bound = null, closed = null, t = 0;
		const late = new Set();
		const log = [];
		let hit = null;
		while ( t < 400 ) {

			ferry.service.wait -= DT;
			traffic.update( DT );
			t += DT;
			if ( ferry.service.wait <= 0 && bound === null ) {

				// her time: the cars already on their way aboard, and the road each has left
				const waved = traffic.cars.filter( c => c.ferry === ferry && c.state === 'board' ).sort( ( a, b ) => a.seq - b.seq );
				bound = Math.max( 0, ...waved.map( ( c, ahead ) => ( c.path.seg.reduce( ( a, b ) => a + b, 0 ) - c.s ) / RAMP + EASE + ahead * SLOT ) );
				closed = new Set( waved.map( c => c.id ) );

			}
			const past = - ferry.service.wait;
			// any two cars' bodies through each other while one of them drives aboard
			if ( ! hit ) for ( const a of traffic.cars ) if ( a.state === 'board' && a.world && a.heading !== undefined ) for ( const b of traffic.cars ) {

				if ( b !== a && b.world && b.heading !== undefined && overlap( a, b ) ) { hit = `car ${ a.id } (${ a.state }) and car ${ b.id } (${ b.state }) at ${ a.world.x.toFixed( 1 ) }, ${ a.world.z.toFixed( 1 ) } and ${ b.world.x.toFixed( 1 ) }, ${ b.world.z.toFixed( 1 ) }, t ${ t.toFixed( 1 ) } s`; break; }

			}
			// a car that leaves the queue for her deck after her time (the queue should wait for the next sailing)
			if ( closed ) for ( const c of traffic.cars ) if ( c.ferry === ferry && c.state === 'board' && ! closed.has( c.id ) ) late.add( c.id );
			if ( past > 0 && ! traffic.holding( ferry ) ) return { past, bound, late: late.size, queue: stop.want, aboard: traffic.cars.filter( c => c.state === 'parked' ).length, log, hit };
			if ( past > 0 && Math.abs( past % 10 ) < DT ) log.push( `+${ past.toFixed( 0 ) } s held=${ traffic.call( ferry ).held.toFixed( 1 ) } ` + JSON.stringify( traffic.state().filter( c => c.state !== 'parked' ).map( c => [ c.id, c.state, c.local.map( v => Math.round( v ) ).join( ',' ) ] ) ) );

		}
		return { past: Infinity, bound, late: late.size, queue: stop.want, aboard: traffic.cars.filter( c => c.state === 'parked' ).length, log, hit };

	} finally { Math.random = random; }

}

// her load at a berth, s, as FerryService sets it (short: ?ferryTimetable=short, the browser specs)
const LOAD = short => new FerryService( { berths: [ {}, {} ], at: {} }, { short } ).load;

for ( const [ name, load ] of [ [ `the short timetable (${ LOAD( true ) } s load)`, LOAD( true ) ], [ `the timetable (${ LOAD( false ) } s load)`, LOAD( false ) ] ] ) {

	test( `On ${ name } she casts off at her time plus the run of the cars already waved aboard, not after the whole queue`, t => {

		for ( const seed of [ 7, 12, 1, 4 ] ) {   // queues of 6, 7, 8 and 9 cars (Traffic.stop: 6 to 9)

			const r = call( load, seed );
			t.diagnostic( `seed ${ seed }: held ${ r.past.toFixed( 1 ) } s past her time (bound ${ r.bound.toFixed( 1 ) } s), ${ r.aboard } of a queue of ${ r.queue } aboard, ${ r.late } started late` );
			assert.equal( r.late, 0, `seed ${ seed }: ${ r.late } cars started aboard after her time\n${ r.log.join( '\n' ) }` );
			assert.equal( r.hit, null, `seed ${ seed }: two cars drove through each other: ${ r.hit }` );
			assert.ok( r.past <= r.bound + 1, `seed ${ seed }: held ${ r.past.toFixed( 1 ) } s past her time, want <= ${ r.bound.toFixed( 1 ) } s (the run of the cars already waved aboard); queue ${ r.queue }, aboard ${ r.aboard }\n${ r.log.join( '\n' ) }` );

		}

	} );

}

test( 'On the short timetable the cars waved aboard in her load, two lanes at once, still drive aboard and park on her deck', t => {

	// crowd.spec.js asserts 4 parked on the short timetable: a car from each lane at her ramp's coming
	// down and a car from each 2.8 s later (6 while the queue boarded past her time; 2 one lane at a time)
	for ( const seed of [ 7, 12, 1, 4 ] ) {

		const r = call( LOAD( true ), seed );
		t.diagnostic( `seed ${ seed }: ${ r.aboard } of a queue of ${ r.queue } aboard` );
		assert.ok( r.aboard >= 4, `seed ${ seed }: aboard ${ r.aboard } of a queue of ${ r.queue } on the short timetable` );

	}

} );

test( `On the timetable (${ LOAD( false ) } s load) a full queue boards two lanes at once and she casts off at her time`, t => {

	for ( const seed of [ 4, 1, 12 ] ) {   // queues of 9, 8 and 7 cars

		const r = call( LOAD( false ), seed );
		t.diagnostic( `seed ${ seed }: ${ r.aboard } of a queue of ${ r.queue } aboard, she cast off ${ r.past.toFixed( 1 ) } s past her time` );
		assert.equal( r.hit, null, `seed ${ seed }: two cars drove through each other: ${ r.hit }` );
		assert.equal( r.aboard, r.queue, `seed ${ seed }: ${ r.aboard } of a queue of ${ r.queue } aboard in her ${ LOAD( false ) } s load` );
		assert.ok( r.past <= 1, `seed ${ seed }: she cast off ${ r.past.toFixed( 1 ) } s past her time with a queue of ${ r.queue }, want <= 1 s\n${ r.log.join( '\n' ) }` );

	}

} );
