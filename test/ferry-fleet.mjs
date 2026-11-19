import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FerryShip } from '../src/ferry/FerryShip.js';
import { FerryService, FLEET, CRUISE } from '../src/ferry/FerryService.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { readFileSync } from 'node:fs';
import { Vector3 } from '../src/engine/index.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { applyTerminalSite, PLACES } from '../src/ferry/Terminal.js';
import { JOEY_VILLAGE_SITE } from '../src/joey/Village.js';

const DT = 1 / 60;          // s, the game's frame
const SAFE = 100;           // m centre to centre: the safe passing distance docs/ferry.md declares
const BERTH_Z = 25.2;       // m, Terminal.js BERTH: her marks ahead of the terminal's origin along its yaw
// Ferry.js berth work, mirrored (Ferry.js imports its stylesheet and models, so node cannot load it):
// the lines' capture, the ramp and the gangway times.
const CAPTURE = { range: 1.5, yaw: 3 * Math.PI / 180, speed: 0.4, armed: 5 };
const RAMP_TIME = 12, GANGWAY_TIME = 5; // s
// The harbour each end: within HARBOUR m of the berth's marks lie the basin, the breakwater head
// (about 122 m out along the berth's axis, terminalSite.js ridges) and the swing room off it (the
// autopilot's gate 130 m out, and SWEEP 60 m short of it). Outside it is open water.
const HARBOUR = 200;        // m
const EXIT = 90;
const ENTRY = 150;          // s, the longest from the far harbour's edge to lines on: the swing and the back in
const PARTNER = 20;         // s, the longest a loaded ship waits for her partner before she sails
const HARBOUR_WORK = 165;   // s, the worst measured harbour work, both ends together
const SHORTEST = 180;       // s, three minutes: the limit on the short strait
const LONGEST = 210;        // s, three and a half minutes: the limit on the long strait

// The harbours as the game builds them (App, test/terminal-flat.mjs): both terminals' fills,
// dredged pockets and breakwater cores on the real island terrain, and the terminal's own collider
// boxes (the jetty, the marina walkway, the breakwater walk). Her hull is swept against both the
// way FerryShip.collide meets them: the keel lines (x +-6.7 m, 2.5 m down) against the seabed and
// the breakwater, the gunwales (x +-9 m, a 0.4 m capsule from 1 m to 4 m up) against the boxes.
const terrain = new TerrainData();
for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
applyTerminalSite( terrain, JOEY_VILLAGE_SITE, PLACES.joey );
const BOXES = JSON.parse( readFileSync( new URL( '../public/ferry/terminal_colliders.json', import.meta.url ) ) ).boxes
	.filter( b => b.center[ 1 ] - b.half[ 1 ] < 4.4 && b.center[ 1 ] + b.half[ 1 ] > 0.6 );
const KEEL_LINES = [], GUNWALES = [];
for ( let z = - 24; z <= 24; z += 2 ) { KEEL_LINES.push( new Vector3( - 6.7, - 2.5, z ), new Vector3( 6.7, - 2.5, z ) ); GUNWALES.push( new Vector3( - 9, 1, z ), new Vector3( 9, 1, z ) ); }
const _p = new Vector3();
// Worst contact of her hull with a harbour this frame: m into a box or under the seabed (0 is clear).
function contact( ship ) {

	let worst = 0, what = '';
	for ( const k of KEEL_LINES ) {

		const p = ship.toWorld( k, _p ), under = terrain.heightAt( p.x, p.z ) - p.y;
		if ( under > worst ) { worst = under; what = `keel aground at (${ p.x.toFixed( 0 ) }, ${ p.z.toFixed( 0 ) })`; }

	}
	for ( const place of Object.values( PLACES ) ) {

		const o = place.position, c = Math.cos( place.yaw ), s = Math.sin( place.yaw );
		if ( Math.hypot( ship.position.x - o.x, ship.position.z - o.z ) > 260 ) continue;
		for ( const g of GUNWALES ) {

			const p = ship.toWorld( g, _p ), dx = p.x - o.x, dz = p.z - o.z;
			const x = dx * c - dz * s, z = dx * s + dz * c;
			for ( const b of BOXES ) {

				const into = Math.min( b.half[ 0 ] + 0.4 - Math.abs( x - b.center[ 0 ] ), b.half[ 2 ] + 0.4 - Math.abs( z - b.center[ 2 ] ) );
				if ( into > worst ) { worst = into; what = `gunwale in a terminal ${ b.kind } box at terminal (${ x.toFixed( 1 ) }, ${ z.toFixed( 1 ) })`; }

			}

		}

	}
	return worst > 0 ? { worst, what } : null;

}

const berthOf = ( t, name ) => ( { name, label: name, x: t.position.x + Math.sin( t.yaw ) * BERTH_Z, z: t.position.z + Math.cos( t.yaw ) * BERTH_Z, yaw: t.yaw } );
const BERTHS = [ berthOf( WORLD.ferryTerminal, 'Tidewater' ), berthOf( WORLD.joeyTerminal, 'Joey Island' ) ];
// s, the open water between the two harbours at service speed, read from the berths the layout gives
const OPEN_WATER = Math.max( 0, Math.hypot( BERTHS[ 0 ].x - BERTHS[ 1 ].x, BERTHS[ 0 ].z - BERTHS[ 1 ].z ) - 2 * HARBOUR ) / CRUISE;
const CEILING = Math.min( LONGEST, Math.max( SHORTEST, HARBOUR_WORK + OPEN_WATER ) ); // s, lines off to lines on
const toward = ( v, goal, step ) => v < goal ? Math.min( goal, v + step ) : Math.max( goal, v - step );
const wrap = a => Math.atan2( Math.sin( a ), Math.cos( a ) );

// The parts of Ferry.js the timetable drives: lines, ramp, gangway and the capture on her marks.
class Hull {

	constructor( home ) {

		this.berths = BERTHS; this.at = BERTHS[ home ];
		this.ship = new FerryShip( this.at ); this.ship.moor( this.at );
		this.ramp = 0; this.rampGoal = 0; this.gangway = 0; this.castingOff = false; this.away = false;
		this.driven = false; this.flood = 0; this.rivals = [];

	}

	nearestBerth() { const p = this.ship.position; return BERTHS.reduce( ( a, b ) => Math.hypot( p.x - b.x, p.z - b.z ) < Math.hypot( p.x - a.x, p.z - a.z ) ? b : a ); }
	lowerRamp() { if ( ! this.ship.moored || this.castingOff ) return false; this.rampGoal = 1; return true; }
	castOff() { if ( ! this.ship.moored || this.castingOff ) return false; this.rampGoal = 0; this.castingOff = true; return true; }

	step( dt ) {

		this.service.update( dt );
		const s = this.ship;
		s.step( dt, null );
		const b = this.nearestBerth(), d = Math.hypot( s.position.x - b.x, s.position.z - b.z );
		if ( ! s.moored ) {

			if ( d > CAPTURE.armed ) this.away = true;
			if ( this.away && d < CAPTURE.range && Math.abs( wrap( s.yaw - b.yaw ) ) < CAPTURE.yaw && s.speed < CAPTURE.speed ) { this.at = b; s.moor( b ); this.castingOff = false; this.away = false; }

		}
		if ( ! s.moored ) this.rampGoal = 0;
		this.ramp = toward( this.ramp, this.rampGoal, dt / RAMP_TIME );
		this.gangway = toward( this.gangway, s.moored && ! this.castingOff ? 0 : 1, dt / GANGWAY_TIME );
		if ( this.castingOff && this.ramp === 0 && this.gangway === 1 ) { this.castingOff = false; this.away = false; s.castOff(); }

	}

}

// Two full round trips of the fleet as the game builds it (FLEET), with what each berth saw.
function sail() {

	const hulls = FLEET.map( f => new Hull( f.home ) );
	for ( const h of hulls ) { h.service = new FerryService( h ); h.rivals = hulls.filter( o => o !== h ); }
	const empty = BERTHS.map( () => ( { since: 0, worst: 0 } ) ), crossings = [];
	const out = { closest: Infinity, at: 0, port: [], cycles: [], casts: [], crossings, empty };
	const cycle = { a: 0, b: 0, together: 0, casts: 0 };
	const sailed = hulls.map( () => - 1 );
	// per ship: lines off, out past the harbour edge, into the far harbour; and loaded-and-ready since
	const legs = hulls.map( () => ( { off: - 1, out: - 1, in: - 1, from: null, ready: - 1 } ) );
	out.exits = []; out.entries = []; out.open = []; out.waits = []; out.contacts = [];
	for ( let t = 0; t < 1600; t += DT ) {

		for ( const h of hulls ) h.step( DT );
		hulls.forEach( ( h, i ) => {

			if ( ! h.ship.moored && sailed[ i ] < 0 ) { sailed[ i ] = t; out.casts.push( [ i, t ] ); }
			if ( h.ship.moored && sailed[ i ] >= 0 ) { crossings.push( t - sailed[ i ] ); sailed[ i ] = - 1; }
			const g = legs[ i ], p = h.ship.position, range = b => Math.hypot( p.x - b.x, p.z - b.z );
			if ( h.service.ready && g.ready < 0 ) g.ready = t;
			if ( h.service.phase === 'casting' && g.ready >= 0 ) { out.waits.push( t - g.ready ); g.ready = - 1; }
			if ( ! h.ship.moored && g.off < 0 ) { g.off = t; g.from = h.at; g.out = g.in = - 1; }
			if ( g.off >= 0 && g.out < 0 && range( g.from ) > HARBOUR ) { g.out = t; out.exits.push( t - g.off ); }
			if ( g.out >= 0 && g.in < 0 && BERTHS.some( b => b !== g.from && range( b ) < HARBOUR ) ) { g.in = t; out.open.push( t - g.out ); }
			if ( h.ship.moored && g.off >= 0 ) { if ( g.in >= 0 ) out.entries.push( t - g.in ); g.off = - 1; }
			// her hull through each harbour, from lines off until the lines are on at the far berth
			if ( ! h.ship.moored && BERTHS.some( b => range( b ) < HARBOUR ) ) {

				const hit = contact( h.ship );
				if ( hit && out.contacts.length < 8 && ! out.contacts.some( c => c.ship === i && t - c.t < 20 ) ) out.contacts.push( { ship: i, t, ...hit } );

			}

		} );
		BERTHS.forEach( ( b, i ) => {

			const held = hulls.some( h => h.ship.moored && h.at === b );
			if ( held ) empty[ i ].since = t; else empty[ i ].worst = Math.max( empty[ i ].worst, t - empty[ i ].since );

		} );
		if ( hulls.length > 1 ) {

			const [ a, b ] = hulls, d = a.ship.position.distanceTo( b.ship.position );
			if ( d < out.closest ) {

				out.closest = d; out.at = t;
				// which side each sees the other: + is to port (her local +x), COLREGS rule 14 wants port to port
				out.port = [ a.ship.toLocal( b.ship.position.clone() ).x, b.ship.toLocal( a.ship.position.clone() ).x ];

			}
			// loading per sailing: reset as the pair cast off, so each cycle is judged on its own
			if ( out.casts.length !== cycle.casts ) { if ( cycle.a > 0 && cycle.b > 0 ) out.cycles.push( cycle.together / Math.min( cycle.a, cycle.b ) ); Object.assign( cycle, { a: 0, b: 0, together: 0, casts: out.casts.length } ); }
			if ( a.ramp >= 1 ) cycle.a += DT;
			if ( b.ramp >= 1 ) cycle.b += DT;
			if ( a.ramp >= 1 && b.ramp >= 1 && a.at !== b.at ) cycle.together += DT;

		}

	}
	return out;

}

const run = sail();

test( 'the fleet is two ships, one from each terminal', () => {

	assert.equal( FLEET.length, 2, `fleet of ${ FLEET.length }` );
	assert.deepEqual( FLEET.map( f => f.home ).sort(), [ 0, 1 ], `homes ${ FLEET.map( f => f.home ) }` );
	assert.notEqual( FLEET[ 0 ].name, FLEET[ 1 ].name, 'each ship has her own name' );

} );

test( 'the two ships never come within the safe passing distance, and pass port to port', () => {

	assert.ok( run.closest >= SAFE, `closest approach ${ run.closest.toFixed( 1 ) } m at ${ run.at.toFixed( 0 ) } s, want >= ${ SAFE } m` );
	assert.ok( run.port.every( x => x > 0 ), `at the closest approach each saw the other at local x ${ run.port.map( x => x.toFixed( 1 ) ) } m (+ is port), want both to port` );

} );

test( 'both berths have a ship within one sailing interval', t => {

	t.diagnostic( `crossings (cast off to lines on) ${ run.crossings.map( c => c.toFixed( 0 ) ).join( ', ' ) } s; closest approach ${ run.closest.toFixed( 1 ) } m` );
	assert.ok( run.crossings.length >= 6, `${ run.crossings.length } crossings made in two round trips' time, want 6 or more` );
	const interval = Math.max( ...run.crossings );
	for ( let i = 0; i < BERTHS.length; i ++ ) assert.ok( run.empty[ i ].worst <= interval + 5, `${ BERTHS[ i ].name } stood empty for ${ run.empty[ i ].worst.toFixed( 0 ) } s, longest crossing ${ interval.toFixed( 0 ) } s` );

} );

// In phase: they cast off together, and the whole time the later arrival loads, the other is
// loading at the far berth too. The first in loads longer while her partner berths (the Joey
// approach is the slower), which is the timetable's slack, not a ship missing.
test( 'the timetable phase: while one ship loads, the other loads at the far berth', () => {

	assert.ok( run.cycles.length >= 3, `${ run.cycles.length } loading cycles seen` );
	for ( const share of run.cycles ) assert.ok( share >= 0.9, `a cycle had both ramps down at opposite berths for ${ ( share * 100 ).toFixed( 0 ) } % of the shorter loading time, want >= 90 %` );
	for ( let k = 0; k + 1 < run.casts.length; k += 2 ) {

		const [ [ i, t ], [ j, u ] ] = [ run.casts[ k ], run.casts[ k + 1 ] ];
		assert.ok( i !== j && Math.abs( t - u ) <= 5, `sailings ${ k / 2 + 1 }: ship ${ i } cast off at ${ t.toFixed( 0 ) } s, ship ${ j } at ${ u.toFixed( 0 ) } s, want together within 5 s` );

	}

} );

test( 'she leaves her harbour promptly, berths through the far one without dawdling, and never waits long for her partner', t => {

	const f = a => a.map( x => x.toFixed( 0 ) ).join( ', ' );
	t.diagnostic( `out of her harbour ${ f( run.exits ) } s; open water ${ f( run.open ) } s; far harbour to lines on ${ f( run.entries ) } s; partner waits ${ f( run.waits ) } s` );
	assert.ok( run.exits.length >= 6 && run.entries.length >= 5, `${ run.exits.length } departures and ${ run.entries.length } arrivals seen` );
	assert.ok( Math.max( ...run.exits ) <= EXIT, `lines off to ${ HARBOUR } m out took ${ f( run.exits ) } s, want <= ${ EXIT } s` );
	assert.ok( Math.max( ...run.entries ) <= ENTRY, `${ HARBOUR } m off the far berth to lines on took ${ f( run.entries ) } s, want <= ${ ENTRY } s` );
	assert.ok( Math.max( ...run.waits ) <= PARTNER + 1, `loaded and held for her partner ${ f( run.waits ) } s, want <= ${ PARTNER } s` );

} );

test( 'her hull clears the jetty, the breakwater, the terminal and the seabed in both harbours', () => {

	assert.equal( run.contacts.length, 0, run.contacts.map( c => `ship ${ c.ship } at ${ c.t.toFixed( 0 ) } s: ${ c.what }, ${ c.worst.toFixed( 2 ) } m in` ).join( '; ' ) );

} );

test( 'a crossing, lines off to lines on, takes no longer than the strait allows', t => {

	t.diagnostic( `open water ${ OPEN_WATER.toFixed( 0 ) } s at ${ CRUISE } m/s + harbour work ${ HARBOUR_WORK } s -> limit ${ CEILING.toFixed( 0 ) } s` );
	assert.ok( run.crossings.length >= 6, `${ run.crossings.length } crossings seen` );
	assert.ok( Math.max( ...run.crossings ) <= CEILING, `crossings ${ run.crossings.map( c => c.toFixed( 0 ) ).join( ', ' ) } s, want <= ${ CEILING.toFixed( 0 ) } s (open water ${ OPEN_WATER.toFixed( 0 ) } s + harbour work ${ HARBOUR_WORK } s, between ${ SHORTEST } and ${ LONGEST } s)` );

} );
