// People on foot, stepped through the code that makes and moves them (docs/people.md, Solid trunks, cars and room).
// Each check builds the real people hub (People.js) and the real owner (the ferry's crowd, the beach crowd, the
// traffic), makes its people the way the game does (Crowd.spawnFoot, Crowd.add, Beach.spawn and send), and steps
// the owner's own update in the game's order (Ferry.update: the traffic, then the crowd; then the beach and the
// hub, App.finishFrame). Room.js decides the pace and the side step; these checks hold what the owners do with it.
// Before this a walker made by the crowd had no side step value until its first arrival, so the room rule computed
// NaN and the walker walked straight through the player standing on its way in (the room checks set that value by
// hand and passed on state the game never had).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crowdWorld, walker, watch, keepBufferWrites, DT, GAME_FRAMES, BREEZE } from './helpers/crowd-world.mjs';
import { Traffic } from '../src/ferry/Traffic.js';
import { Beach } from '../src/people/Beach.js';
import { Vector3, Group } from '../src/engine/index.js';
import { mulberry32 } from '../src/util/Noise.js';

test.after( keepBufferWrites() );

const R = 0.27, PLAYER_R = 0.3; // m: a person's body (Contact.js BODY_R), the player's (Player.js RADIUS)
const TOL = 0.05;               // m of overlap that still reads as two bodies touching
const STILL = 0.05;             // m: a player who stood still has not moved further than this

// The player stands on the way in while the crowd's next foot passenger walks in from the hall, stepped at the frame
// lengths the game played it at, the player's own walk step in the game's breeze included. Judged against where he
// stood: a passenger walking into him shoves him (Contact.player), so the distance to where he is now would hide it.
// Before this the game failed the same check while this one passed: the player was not stepped here, and in the
// game the breeze moved him (1.5 m in three minutes standing still), so the passenger walked where he had stood.
test( 'A foot passenger the crowd makes in its hall steps round the player standing on its way in, and reaches its place in the gate queue', t0 => {

	const w = crowdWorld( 1 );
	// the player stands on the yard leg of the way in (terminal frame x 22.4, from z -6.8 to -33.4), 13 m along it
	const at = w.terminal.toWorld( [ 22.4, 3.36, - 20 ] );
	w.stand( at );
	w.crowd.spawnFoot( w.terminal, false );
	const p = w.crowd.people[ 0 ];
	assert.ok( p && p.state === 'in' && ! p.world, 'the crowd made a foot passenger walking in, with no place until its first frame' );
	let closest = Infinity, moved = 0, t = 0;
	for ( let k = 0; t < 150 && p.state !== 'queue'; k ++ ) {

		const dt = GAME_FRAMES[ k % GAME_FRAMES.length ];
		w.frame( dt );
		t += dt;
		if ( p.world && Math.abs( p.world.y - at.y ) < 1 ) closest = Math.min( closest, Math.hypot( p.world.x - at.x, p.world.z - at.z ) );
		moved = Math.max( moved, Math.hypot( w.player.position.x - at.x, w.player.position.z - at.z ) );

	}
	t0.diagnostic( `closest ${ closest.toFixed( 3 ) } m to where the player stood; the player moved ${ moved.toFixed( 3 ) } m; in its place after ${ t.toFixed( 1 ) } s` );
	assert.ok( moved < STILL, `the player standing still in the ${ BREEZE } m/s breeze was moved ${ moved.toFixed( 2 ) } m while the passenger walked in` );
	assert.ok( closest >= R + PLAYER_R - 0.02, `the walker's centre came within ${ closest.toFixed( 2 ) } m of where the player stood on its way (bodies ${ R } m and ${ PLAYER_R } m)` );
	assert.equal( p.state, 'queue', `the walker never reached its place in the gate queue (still ${ p.state } after ${ t.toFixed( 1 ) } s)` );

} );

test( 'Two foot passengers meeting head on in the covered walkway share the pass, and neither is held', () => {

	// the walkway's middle (x 14.6) between its walls (x 13.04 and 15.40), terminal frame
	const w = crowdWorld( 2 ), a = walker( w, [ [ 14.6, 7.0, - 20 ], [ 14.6, 7.0, - 8 ] ] ), b = walker( w, [ [ 14.6, 7.0, - 8 ], [ 14.6, 7.0, - 20 ] ] );
	const r = watch( w, [ a, b ], 20 );
	assert.ok( r.close >= 2 * R - TOL, `they came within ${ r.close.toFixed( 2 ) } m centre to centre (side steps ${ r.at } m)` );
	assert.ok( Math.max( ...r.held ) <= 0.5, `held ${ r.held.map( h => h.toFixed( 2 ) ).join( ' and ' ) } s passing in the walkway` );
	assert.ok( r.arrived.every( t => t !== null ), `both walked the 12 m (arrived ${ r.arrived } s)` );

} );

test( 'Meeting head on where one of the two cannot step aside (along the walkway\'s wall), the other takes the whole pass', () => {

	// along the right wall (x 15.40): walking up it, keeping left is into the wall; the one coming down keeps left, away
	const w = crowdWorld( 2 ), a = walker( w, [ [ 15.1, 7.0, - 20 ], [ 15.1, 7.0, - 8 ] ] ), b = walker( w, [ [ 15.1, 7.0, - 8 ], [ 15.1, 7.0, - 20 ] ] );
	const r = watch( w, [ a, b ], 20 );
	assert.ok( r.close >= 2 * R - TOL, `they came within ${ r.close.toFixed( 2 ) } m centre to centre (side steps ${ r.at } m)` );
	assert.ok( Math.max( ...r.held ) <= 0.5, `held ${ r.held.map( h => h.toFixed( 2 ) ).join( ' and ' ) } s passing along the wall` );

} );

test( 'A walker who steps round the player just short of a corner is back on its line before it turns, and never jumps sideways', () => {

	// the yard leg of the way in turns at terminal frame (22.4, -33.4) toward the stair tower; the player stands 0.8 m short of it
	const w = crowdWorld( 1 ), at = w.terminal.toWorld( [ 22.4, 3.36, - 32.6 ] );
	w.stand( at );
	const p = walker( w, [ [ 22.4, 3.36, - 26 ], [ 22.4, 3.36, - 33.4 ], [ 16.5, 3.2, - 34.2 ], [ 14.85, 3.2, - 34.2 ] ] );
	let legs = p.path.length, turned = [], jump = 0, stepped = 0, last = null, closest = Infinity;
	const r = watch( w, [ p ], 25, () => {

		if ( p.path && p.path.length < legs ) { turned.push( + ( p.lat || 0 ).toFixed( 3 ) ); legs = p.path.length; }
		stepped = Math.max( stepped, Math.abs( p.lat || 0 ) );
		if ( p.world ) { if ( last ) jump = Math.max( jump, Math.hypot( p.world.x - last.x, p.world.z - last.z ) ); last = ( last || new Vector3() ).copy( p.world ); closest = Math.min( closest, Math.hypot( p.world.x - at.x, p.world.z - at.z ) ); }

	} );
	assert.ok( stepped > 0.3, `the walker stepped round the player (its side step reached ${ stepped.toFixed( 2 ) } m)` );
	assert.ok( closest >= R + PLAYER_R - 0.02, `the walker's centre came within ${ closest.toFixed( 2 ) } m of the player's` );
	assert.ok( turned.every( l => Math.abs( l ) <= 0.005 ), `it turned with a side step of ${ turned.join( ', ' ) } m in hand` );
	assert.ok( jump <= ( 1.5 + 0.7 ) * DT + 1e-3, `it moved ${ jump.toFixed( 3 ) } m in one frame (a walk and a side step are ${ ( ( 1.5 + 0.7 ) * DT ).toFixed( 3 ) } m at most)` );
	assert.ok( r.arrived[ 0 ] !== null, 'it reached the end of its way' );

} );

// The owner carries the part of a step that ends past a corner onto the next leg (Crowd.step's leg loop, Beach.step):
// at the game's slowest frame (0.1 s) a walker at 1.5 m/s carries up to 0.15 m of it. Before this the check against
// the player looked along the leg the walker was on, so a walker turning the yard leg's corner toward the player
// standing just round it, 0.6 to 0.75 m past the corner, stepped into his body and shoved him.
test( 'A walker turning a corner at a slow frame never carries its step round the corner into the player standing just past it', t0 => {

	// the yard leg of the way in turns at terminal frame (22.4, -33.4) toward the stair tower (16.5, -34.2)
	const corner = [ 22.4, 3.36, - 33.4 ], next = [ 16.5, 3.2, - 34.2 ], lx = next[ 0 ] - corner[ 0 ], lz = next[ 2 ] - corner[ 2 ], l = Math.hypot( lx, lz );
	const bad = [], seen = [], cases = [];
	// the frame lengths at which the carry reaches past the rule's margin, the walker's phase at the corner swept by
	// where it starts; at 60 frames a second (a carry of 0.025 m at most) once each
	for ( const dt of [ 0.1, 1 / 20 ] ) for ( const past of [ 0.61, 0.64, 0.67, 0.7 ] ) for ( const start of [ 0, 0.05, 0.1 ] ) cases.push( [ dt, past, start ] );
	for ( const past of [ 0.61, 0.64, 0.67, 0.7 ] ) cases.push( [ DT, past, 0 ] );
	for ( const [ dt, past, start ] of cases ) {

		const w = crowdWorld( 1 ), at = w.terminal.toWorld( [ corner[ 0 ] + lx / l * past, corner[ 1 ], corner[ 2 ] + lz / l * past ] );
		w.stand( at );
		w.frame( DT );   // on his feet
		const from = w.player.position.clone();
		const p = walker( w, [ [ 22.4, 3.36, - 28 - start ], corner, next, [ 14.85, 3.2, - 34.2 ] ], 1.5 );
		let closest = Infinity, moved = 0;
		// it reaches the corner after about 3.6 s; past the next corner, or 6 s, is enough
		for ( let t = 0; t < 6 && p.path && p.path.length > 2; t += dt ) {

			w.frame( dt );
			if ( p.world && Math.abs( p.world.y - from.y ) < 1.2 ) closest = Math.min( closest, Math.hypot( p.world.x - from.x, p.world.z - from.z ) );
			moved = Math.max( moved, Math.hypot( w.player.position.x - from.x, w.player.position.z - from.z ) );

		}
		const case_ = `${ ( 1 / dt ).toFixed( 0 ) } frames a second, the player ${ past } m past the corner (start ${ start } m back)`;
		if ( closest < R + PLAYER_R - 0.02 ) bad.push( `${ case_ }: the walker's centre came within ${ closest.toFixed( 2 ) } m of where he stood` );
		if ( moved >= STILL ) bad.push( `${ case_ }: the player was moved ${ moved.toFixed( 2 ) } m` );
		seen.push( closest );

	}
	t0.diagnostic( `closest ${ Math.min( ...seen ).toFixed( 3 ) } m over ${ seen.length } cases` );
	assert.deepEqual( bad, [], 'a walker turning a corner stepped into the player standing just round it' );

} );

// Where a walker cannot step round the player (a flight or the landing of the stair tower, the turn at the end of the
// yard leg, the mouth of the gate queue, along the walkway's wall in the leavers' lane), it waits behind him and goes
// on once he moves: it never walks into him. Before this a walker held there for the hold time (2.5 s) squeezed past
// at half pace as it does past a townsperson in her side corridor, walked into the player (its centre 0.09 m from
// where he stood at the stair tower's landing) and shoved him up to half a metre out of its way (Contact.player).
test( 'A walker that cannot step round the player waits behind him and never walks into him, and goes on once he steps away', t0 => {

	const bad = [], seen = [];
	// where it can, it steps round him without waiting: along the walkway's wall, where keeping left is into the wall,
	// round his other side
	for ( const [ where, place, route, round ] of [
		[ 'the stair tower\'s landing', [ 14.85, 3.99, - 29.8 ], null, false ],
		[ 'the stair tower\'s first flight', [ 14.85, 3.6, - 30.85 ], null, false ],
		[ 'the turn at the end of the yard leg', [ 22.4, 3.36, - 33.4 ], null, false ],
		[ 'the mouth of the gate queue', [ 14.6, 7.0, 3.0 ], null, false ],
		[ 'the leavers\' lane along the walkway\'s wall', [ 13.6, 7.0, - 10 ], [ [ 13.6, 7.0, 8.4 ], [ 13.6, 7.0, - 27.0 ] ], true ],
	] ) {

		const w = crowdWorld( 1 ), at = w.terminal.toWorld( place );
		let p;
		if ( route ) p = walker( w, route );
		else { w.crowd.spawnFoot( w.terminal, false ); p = w.crowd.people[ 0 ]; }
		w.stand( at );
		const from = w.player.position.clone();
		let closest = Infinity, moved = 0, t = 0, waited = 0, gone = null;
		// he stands there until the walker has waited 90 s for him (a walker coming back onto its line at a turn crept
		// into him after about 70 s), then steps off its way
		for ( ; t < 300 && p.path; t += DT ) {

			w.frame( DT );
			if ( gone === null && p.world && Math.hypot( p.world.x - from.x, p.world.z - from.z ) < 1.5 && ( p.walkV || 0 ) < 0.05 ) waited += DT;
			if ( gone === null && waited > 90 ) { gone = t; w.stand( w.terminal.toWorld( [ 60, 3.36, - 60 ] ) ); }
			if ( gone === null ) {

				if ( p.world && Math.abs( p.world.y - from.y ) < 1.2 ) closest = Math.min( closest, Math.hypot( p.world.x - from.x, p.world.z - from.z ) );
				moved = Math.max( moved, Math.hypot( w.player.position.x - from.x, w.player.position.z - from.z ) );

			}

		}
		seen.push( `${ where }: closest ${ closest.toFixed( 2 ) } m, moved ${ moved.toFixed( 2 ) } m, waited ${ waited.toFixed( 1 ) } s, ${ p.path ? 'still on its way' : 'arrived' } at ${ t.toFixed( 1 ) } s` );
		if ( closest < R + PLAYER_R - 0.02 ) bad.push( `at ${ where } the walker's centre came within ${ closest.toFixed( 2 ) } m of where the player stood` );
		if ( moved >= STILL ) bad.push( `at ${ where } the player was moved ${ moved.toFixed( 2 ) } m by the walker` );
		if ( p.path ) bad.push( `at ${ where } the walker never went on after the player stepped away (${ t.toFixed( 1 ) } s)` );
		if ( round && waited > 1 ) bad.push( `at ${ where } the walker waited ${ waited.toFixed( 1 ) } s for the player instead of stepping round his other side` );

	}
	t0.diagnostic( seen.join( '; ' ) );
	assert.deepEqual( bad, [], 'a walker walked into the player where it could not step round him' );

} );

// A knocked person's own steps keep out of the player too: stepping off a car's road (Contact.aside, the way the
// traffic asks a townsperson holding a car), going back to their place, fetching what they dropped. Before this
// such a step looked only at where their owner lets a body stand, and a townsperson asked to step off the road
// toward the player standing beside them walked through him and shoved him off the spot.
test( 'A townsperson stepping off a car\'s road never steps into the player standing beside them', t0 => {

	const w = crowdWorld( 1 ), body = w.crowd.take(), path = [ [ 'T', 0.6, 3.36, - 31 ], [ 'T', 0, 3.36, - 31 ] ];
	const p = w.crowd.add( { ...body, kind: 'foot', terminal: w.terminal, state: 'board', path, at: path[ 1 ] } );
	w.stand( w.terminal.toWorld( [ 60, 3.36, - 60 ] ) );
	for ( let i = 0; i < 60; i ++ ) w.frame( DT );   // they arrive and stand
	assert.equal( p.state, 'stand', 'the townsperson stands in the yard' );
	const a = w.terminal.toWorld( [ 0, 3.36, - 31 ] ), b = w.terminal.toWorld( [ 1, 3.36, - 31 ] ), nx = b.x - a.x, nz = b.z - a.z;
	w.stand( new Vector3( p.world.x + nx, p.world.y, p.world.z + nz ) );   // the player a metre to their side
	const from = w.player.position.clone();
	assert.ok( w.hub.contact.aside( p, nx, nz, 1.6, null ), 'asked to step off the road toward him' );
	let closest = Infinity, moved = 0;
	for ( let t = 0; t < 6; t += DT ) {

		w.frame( DT );
		closest = Math.min( closest, Math.hypot( p.world.x - from.x, p.world.z - from.z ) );
		moved = Math.max( moved, Math.hypot( w.player.position.x - from.x, w.player.position.z - from.z ) );

	}
	t0.diagnostic( `closest ${ closest.toFixed( 3 ) } m to where the player stood; he moved ${ moved.toFixed( 3 ) } m` );
	assert.ok( closest >= R + PLAYER_R - 0.02, `the townsperson's centre came within ${ closest.toFixed( 2 ) } m of where the player stood beside them` );
	assert.ok( moved < STILL, `the player was moved ${ moved.toFixed( 2 ) } m by the townsperson stepping aside` );

} );

// ---- the traffic: the real Traffic of the real ferry, its own drive, with the people hub and the crowd

// The shipped models' drawn extents (public/ferry/parked_cars.glb), as Traffic.parts holds them once loaded.
function shippedParts() {

	const b = readFileSync( new URL( '../public/ferry/parked_cars.glb', import.meta.url ) ), len = b.readUInt32LE( 12 );
	const g = JSON.parse( b.subarray( 20, 20 + len ).toString() ), parts = new Map();
	const part = ( mesh, t = [ 0, 0, 0 ] ) => g.meshes[ mesh ].primitives.map( p => {

		const a = g.accessors[ p.attributes.POSITION ];
		return { geometry: { boundingBox: { min: new Vector3( a.min[ 0 ] + t[ 0 ], a.min[ 1 ] + t[ 1 ], a.min[ 2 ] + t[ 2 ] ), max: new Vector3( a.max[ 0 ] + t[ 0 ], a.max[ 1 ] + t[ 1 ], a.max[ 2 ] + t[ 2 ] ) }, computeBoundingBox() {} } };

	} );
	for ( const root of g.nodes ) {

		if ( ! /^Parked[A-Z][a-z]+$/.test( root.name || '' ) || root.mesh === undefined ) continue;
		const list = part( root.mesh );
		for ( const i of root.children || [] ) if ( g.nodes[ i ].mesh !== undefined ) list.push( ...part( g.nodes[ i ].mesh, g.nodes[ i ].translation ) );
		parts.set( root.name, list );

	}
	return parts;

}

// A car parked aboard her (slot 0) set off to drive off at Tidewater (Traffic.unload), and a townsperson the crowd
// made standing in its road on the yard (terminal frame x 0, z -31, between her linkspan and the check-in lane).
function unloading( w ) {

	// as Ferry builds it (its cars' load skipped: the shipped models' extents are handed in)
	const traffic = w.ferry.traffic = new Traffic( w.app, w.ferry );
	traffic.parts = shippedParts();
	const car = { id: 1, seq: 0, name: 'ParkedSedan', group: new Group(), state: 'parked', path: null, s: 0, v: 0, world: null, local: new Vector3( 4.9, 2.6, - 19.5 ), localYaw: Math.PI, slot: 0, ferry: w.ferry, terminal: w.terminal, from: null, driverIn: true };
	traffic.cars.push( car );
	traffic.pose( car );
	traffic.unload( car, w.terminal );
	const body = w.crowd.take(), path = [ [ 'T', 0.6, 3.36, - 31 ], [ 'T', 0, 3.36, - 31 ] ];
	const p = w.crowd.add( { ...body, kind: 'foot', terminal: w.terminal, state: 'board', path, at: path[ 1 ] } );
	w.stand( w.terminal.toWorld( [ 60, 3.36, - 60 ] ) );   // the player well away
	return { traffic, car, p };

}

// how far a body of radius r at q is outside the car's drawn body, in the car's frame (inside when negative)
function outside( traffic, car, q, r ) {

	const e = traffic.extent( car.name ), g = car.group, c = Math.cos( - car.heading ), s = Math.sin( - car.heading );
	const dx = q.x - g.position.x, dz = q.z - g.position.z, lx = dx * c + dz * s, lz = - dx * s + dz * c;
	return Math.max( e.min.x - lx, lx - e.max.x, e.min.z - lz, lz - e.max.z ) - r;

}

test( 'A townsperson knocked down in the road of a car driving off her is helped up and steps off it: the car is under way again within the hold time plus 5 s, and never touches them', t0 => {

	const w = crowdWorld( 1 ), { traffic, car, p } = unloading( w );
	let held = null, stopped = null, going = null, touch = Infinity, knocked = false, holds = 0, was = null;
	for ( let t = 0; t < 120 && going === null; t += DT ) {

		traffic.drive( car, DT ); traffic.walkers();
		w.frame();
		if ( car.by === 'person' && held === null ) held = t;   // (the player is 60 m off: the person is the only one near)
		// knocked down the moment the car first waits for them (as by the player, or the disaster's wind)
		if ( held !== null && ! knocked ) { knocked = true; w.hub.contact.start( p, 'fall', 1, 0, 0.8, null, 1 ); }
		if ( held !== null && stopped === null && car.v < 0.01 ) stopped = t;
		if ( stopped !== null && car.v > 0.3 ) going = t;
		// each time it is held anew: a car creeping up on someone lets go and is held again, in short stops
		if ( car.by === 'person' && was !== 'person' ) holds ++;
		was = car.by;
		if ( p.world && car.world ) touch = Math.min( touch, outside( traffic, car, p.world, R ) );

	}
	t0.diagnostic( `held ${ holds } times, first at ${ held?.toFixed( 1 ) } s, stopped at ${ stopped?.toFixed( 1 ) } s, under way at ${ going?.toFixed( 1 ) } s, closest ${ touch.toFixed( 2 ) } m outside its body, steps aside ${ w.hub.contact.count.aside }` );
	assert.ok( held !== null, 'the car never came to the person standing in its road' );
	assert.ok( going !== null && going - held <= 4 + 5, `the car was not under way again ${ going === null ? 'in 120 s' : ( going - held ).toFixed( 1 ) + ' s' } after it first waited for them (the hold is 4 s)` );
	assert.equal( holds, 1, `the car let go of the person and was held by them again ${ holds - 1 } times (it crept up on them in short stops)` );
	assert.ok( touch >= - TOL, `the car's body came ${ ( - touch ).toFixed( 2 ) } m into the person's` );

} );

// The player's car rolling on empty after he got out (the rally drive coasting) into a townsperson: Contact.cars
// pushes them out from under it past its side. Before this the push looked only at where they could stand, so with
// the player standing at the car's nose where the push put them, it put the townsperson into his body and shoved him.
// The car's body comes first: nobody is left under it.
test( 'A townsperson pushed out from under a car never lands in the player standing beside it, and is never left under it', t0 => {

	const bad = [], seen = [];
	// the car's half width and length (Contact.js CAR), m; where the push out past its near side puts them, m
	const W = 1.05, L = 2.45, PUSH = W + 0.35;
	for ( const across of [ 0.1, 0.3, 0.6 ] ) {

		const w = crowdWorld( 1 ), body = w.crowd.take(), path = [ [ 'T', 0.6, 3.36, - 31 ], [ 'T', 0, 3.36, - 31 ] ];
		const p = w.crowd.add( { ...body, kind: 'foot', terminal: w.terminal, state: 'board', path, at: path[ 1 ] } );
		w.stand( w.terminal.toWorld( [ 60, 3.36, - 60 ] ) );
		for ( let i = 0; i < 60; i ++ ) w.frame( DT );   // they arrive and stand
		const at = p.world.clone();
		// the car heading +z (world), its nose over them: 2.2 m ahead of its centre and `across` to its right (+x)
		w.app.rally = { active: false, coasting: true, state: [ at.x - across, at.y + 0.5, at.z - 2.2, 0, 0, 0, 1, 3.6 ] };
		// the player standing where the push out past its near side would put them
		w.stand( new Vector3( at.x - across + PUSH, at.y, at.z ) );
		w.frame( DT );
		const from = w.player.position.clone();
		let closest = Infinity, moved = 0, under = 0;
		for ( let t = 0; t < 3; t += DT ) {

			w.frame( DT );
			closest = Math.min( closest, Math.hypot( p.world.x - from.x, p.world.z - from.z ) );
			moved = Math.max( moved, Math.hypot( w.player.position.x - from.x, w.player.position.z - from.z ) );
			const st = w.app.rally.state, dx = p.world.x - st[ 0 ], dz = p.world.z - st[ 2 ];
			if ( t > 0.1 && Math.abs( dz ) < L && Math.abs( dx ) < W ) under += DT;

		}
		seen.push( `${ across } m across: closest ${ closest.toFixed( 2 ) } m, moved ${ moved.toFixed( 2 ) } m, under it ${ under.toFixed( 2 ) } s, out at (${ ( p.world.x - at.x ).toFixed( 2 ) }, ${ ( p.world.z - at.z ).toFixed( 2 ) })` );
		if ( closest < R + PLAYER_R - 0.02 ) bad.push( `${ across } m across the car's nose: the townsperson's centre came within ${ closest.toFixed( 2 ) } m of where the player stood` );
		if ( moved >= STILL ) bad.push( `${ across } m across the car's nose: the player was moved ${ moved.toFixed( 2 ) } m` );
		if ( under > 0 ) bad.push( `${ across } m across the car's nose: the townsperson was left under the car for ${ under.toFixed( 2 ) } s` );

	}
	t0.diagnostic( seen.join( '; ' ) );
	assert.deepEqual( bad, [], 'a townsperson pushed out from under a car landed in the player or was left under it' );

} );

// Greetings (Brain.sense, Crowd.step): someone on their way greets the player on the move at most, a look and perhaps
// a word, and never stops for it or for the second, long greeting; someone standing greets as before, with a wave or
// a nod. Before this the brain counted a walker as standing, and the crowd paused a walker for any gesture, so a foot
// passenger walking to the gate stopped beside the player for the wave (5.6 s), then a talk (27.4 s) or a point
// (14.2 s). The brain's draws are the game's own (Math.random), made replayable here with fixed seeds.
function seeded( seed, f ) { const random = Math.random; Math.random = mulberry32( seed ); try { return f(); } finally { Math.random = random; } }
// the camera at the player's head, looking at q's head (People.context: he is looking at them)
function looking( w, q ) {

	const P = w.player.position, c = w.app.camera;
	c.position.set( P.x, P.y + 1.6, P.z );
	if ( q.world ) c.lookAt( q.world.x, q.world.y + 1.5, q.world.z );
	c.updateMatrixWorld();

}

test( 'A foot passenger walking past the player who is looking at them greets him on the move: it never stands still for it and arrives on time', t0 => {

	const bad = [], seen = [];
	for ( const seed of [ 1, 2, 3, 4, 5, 6, 7, 8 ] ) seeded( seed, () => {

		// the yard leg of the way in (terminal frame x 22.4), 18 m of it; the player 2 m off its line half way along
		const w = crowdWorld( 1 ), len = 18, pace = 1.3;
		w.stand( w.terminal.toWorld( [ 20.4, 3.36, - 21 ] ) );
		const p = walker( w, [ [ 22.4, 3.36, - 12 ], [ 22.4, 3.36, - 12 - len ] ], pace );
		let still = 0, longest = 0, t = 0, last = null, greets = 0, word = 0;
		for ( ; t < 90 && p.path; t += DT ) {

			looking( w, p );
			w.frame( DT );
			if ( p.world && last ) still = Math.hypot( p.world.x - last.x, p.world.z - last.z ) < 0.05 * DT ? still + DT : 0;
			if ( p.world ) last = ( last || new Vector3() ).copy( p.world );
			longest = Math.max( longest, still );
			greets = Math.max( greets, p.brain.greets );
			if ( p.brain.spokeToPlayer ) word ++;

		}
		const late = t - len / pace;
		seen.push( `seed ${ seed }: greeted ${ greets }, stood still ${ longest.toFixed( 2 ) } s at most, ${ late.toFixed( 1 ) } s late${ p.gesture ? ', ' + p.gesture : '' }` );
		if ( greets < 1 ) bad.push( `seed ${ seed }: the passenger never noticed the player looking at it (the check would prove nothing)` );
		if ( longest > 1 ) bad.push( `seed ${ seed }: the passenger on its way stood still for ${ longest.toFixed( 1 ) } s while passing the player` );
		if ( late > 3 ) bad.push( `seed ${ seed }: the passenger arrived ${ late.toFixed( 1 ) } s after its unhindered time` );
		if ( greets > 1 ) bad.push( `seed ${ seed }: the passenger on its way took the second, long greeting` );

	} );
	t0.diagnostic( seen.join( '; ' ) );
	assert.deepEqual( bad, [], 'a foot passenger on its way stopped to greet the player' );

} );

test( 'Someone standing in the gate queue still greets the player who stops by them with a wave or a nod', t0 => {

	const bad = [], seen = [];
	for ( const seed of [ 1, 2, 3, 4 ] ) seeded( seed, () => {

		const w = crowdWorld( 1 );
		w.crowd.spawnFoot( w.terminal, true );
		// the player 1.5 m behind them in the walkway (terminal frame z), the queue's places behind empty
		const p = w.crowd.people[ 0 ];
		w.stand( w.terminal.toWorld( [ p.at[ 1 ], p.at[ 2 ], p.at[ 3 ] - 1.5 ] ) );
		let greeted = null, t = 0;
		for ( ; t < 10 && ! greeted; t += DT ) { looking( w, p ); w.frame( DT ); greeted = p.greeted || null; }
		seen.push( `seed ${ seed }: ${ greeted || 'no greeting' } after ${ t.toFixed( 1 ) } s` );
		if ( ! greeted ) bad.push( `seed ${ seed }: the passenger standing in its place never greeted the player stopping by in 10 s` );

	} );
	t0.diagnostic( seen.join( '; ' ) );
	assert.deepEqual( bad, [], 'someone standing in the queue no longer greets the player' );

} );

test( 'A passenger talking with the player in the gate queue moves up when the queue closes up, without finishing the talk first', t0 => {

	const bad = [], seen = [];
	for ( const seed of [ 1, 2, 3, 4 ] ) seeded( seed, () => {

		// three in the queue (its front pair and the next in the left file); the player stops by the third
		const w = crowdWorld( 3 );
		for ( let i = 0; i < 3; i ++ ) w.crowd.spawnFoot( w.terminal, true );
		const [ front, , p ] = w.crowd.people;
		w.stand( w.terminal.toWorld( [ p.at[ 1 ], p.at[ 2 ], p.at[ 3 ] - 1.5 ] ) );
		let t = 0;
		for ( ; t < 20 && ! [ 'gestic_talk_neutral_01', 'gestic_presentation_right_01' ].includes( p.gesture ); t += DT ) { looking( w, p ); w.frame( DT ); }
		const talk = p.gesture;
		if ( ! talk ) { bad.push( `seed ${ seed }: the passenger never took the second greeting in 20 s (the check would prove nothing)` ); return; }
		// the one ahead of them in their file boards (Crowd.update): their place frees, and the queue closes up
		w.crowd.stop( w.terminal ).queue.release( front );
		front.state = 'gone';
		let moved = null;
		for ( let s = 0; s < 30 && moved === null; s += DT ) { looking( w, p ); w.frame( DT ); if ( p.spot === 0 && ! p.path ) moved = s; }
		seen.push( `seed ${ seed }: ${ talk } at ${ t.toFixed( 1 ) } s, in the place ahead ${ moved === null ? 'never' : moved.toFixed( 1 ) + ' s' } later` );
		if ( moved === null || moved > 2 ) bad.push( `seed ${ seed }: the passenger in the middle of a talk with the player took ${ moved === null ? 'over 30' : moved.toFixed( 1 ) } s to move up the 0.7 m into the place ahead` );

	} );
	t0.diagnostic( seen.join( '; ' ) );
	assert.deepEqual( bad, [], 'a passenger on its way stood still to finish its talk with the player' );

} );

// Casting (Crowd.take): the avatar least in use, and none of anyone the place they are taken for in the gate queue
// could come to stand beside: ahead of or behind it in its file, or anyone in the other file (the files slip against
// each other as the queue boards: the front-most standing boards, often the same file twice, Crowd.boarder). Before
// this two people side by side in the queue could be the same avatar, which has one outfit. The queue fills as the
// crowd fills it (Crowd.update: six in place, then arrivals walking in from the hall, Crowd.spawnFoot) and boards one
// after another as the crowd boards it, twice over, for many casting seeds.
test( 'People next to each other in the gate queue are never the same avatar', t0 => {

	// the game's cast: eight avatars, four bodies of each (Crowd.js CAST, PER_CAST)
	const casts = [ 'f01', 'm01', 'f03', 'm04', 'f06', 'm07', 'f09', 'm10' ], bad = [], seen = [];
	const twins = ( w, when, seed ) => {

		const slots = w.crowd.stop( w.terminal ).queue.slots;
		let n = 0;
		for ( let k = 0; k < slots.length; k ++ ) for ( const j of [ k ^ 1, k + 2 ] ) {

			const a = slots[ k ].who, b = slots[ j ]?.who;
			if ( a && b && j > k && a.cast === b.cast ) { n ++; bad.push( `seed ${ seed }, ${ when }: places ${ k } and ${ j } (${ j === ( k ^ 1 ) ? 'side by side' : 'one behind the other' }) are both ${ a.cast }` ); }

		}
		return n;

	};
	for ( let seed = 1; seed <= 8; seed ++ ) seeded( seed, () => {

		const w = crowdWorld( 32, { casts, seed } ), queue = w.crowd.stop( w.terminal ).queue, crowd = w.crowd;
		w.stand( w.terminal.toWorld( [ 60, 3.36, - 60 ] ) );
		const standing = () => crowd.people.filter( q => q.kind === 'foot' && q.state === 'queue' && ! q.path );
		const fill = placed => {

			for ( let i = 0; i < placed; i ++ ) crowd.spawnFoot( w.terminal, true );
			for ( let i = 0; i < 11 - placed; i ++ ) crowd.spawnFoot( w.terminal, false );
			for ( let t = 0; t < 120 && crowd.people.some( q => q.state === 'in' ); t += 0.1 ) w.frame( 0.1 );   // the arrivals walk in

		};
		let n = 0;
		for ( const [ sailing, placed ] of [ [ 1, 6 ], [ 2, 0 ] ] ) {

			fill( placed );
			n += twins( w, `sailing ${ sailing }, the queue filled`, seed );
			// boarding: the front-most standing in their place, about one a second, the queue closing up behind
			for ( let round = 1; round <= 12; round ++ ) {

				const p = crowd.boarder( standing() );
				if ( ! p ) break;
				queue.release( p ); p.state = 'gone';
				for ( let f = 0; f < 10; f ++ ) w.frame( 0.1 );
				n += twins( w, `sailing ${ sailing }, after ${ round } boarded`, seed );

			}

		}
		seen.push( `seed ${ seed }: ${ n } pairs of twins` );

	} );
	t0.diagnostic( seen.join( '; ' ) );
	assert.deepEqual( bad, [], 'two people next to each other in the gate queue were the same avatar' );

} );

// ---- the beach: the real Beach on the island's real sand (its own layout and slots), with the people hub and the
// player, stepped in the game's order (the player's walk step and contact, then the beach, then the hub)

// A beach walker (Beach.spawn into a shell hunter's slot, then Beach.send) and the player standing still, stepped at
// `dt` for `secs`; `make( slot, inland )` gives its start, its route and where he stands (inland: the unit world z
// from the tideline up the sand at the slot). How close its centre came to where he stood, and how far he was moved.
function beachWalk( make, dt, secs, pace = 1.4 ) {

	const w = crowdWorld( 1 ), beach = w.app.beach = new Beach( w.app );
	beach.layout();
	const slot = beach.slots.find( s => s.role === 'shells' ), p = beach.spawn( w.crowd.take(), slot );
	const m = make( slot.at, Math.sign( slot.at.z - beach.shore( slot.at.x ) ) || 1 );
	p.world.copy( m.start ); p.world.y = beach.floor( p.world.x, p.world.z ); p.base.copy( p.world );
	const at = m.at( p );
	at.y = beach.floor( at.x, at.z );
	w.stand( at );
	const frame = d => { w.player.updateWalk( d ); w.hub.contact.player( w.player, d ); beach.update( d ); w.hub.update( d ); };
	frame( DT );
	const from = w.player.position.clone();
	beach.send( p, m.route( p ) );
	p.pace = pace;
	let closest = Infinity, moved = 0;
	for ( let t = 0; t < secs && p.path; t += dt ) {

		frame( dt );
		closest = Math.min( closest, Math.hypot( p.world.x - from.x, p.world.z - from.z ) );
		moved = Math.max( moved, Math.hypot( w.player.position.x - from.x, w.player.position.z - from.z ) );

	}
	return { closest, moved, mode: w.player.mode };

}

test( 'A beach walker never carries its step round a corner, or off the start of a route sent from where it stands, into the player', t0 => {

	const bad = [], seen = [], X = new Vector3( 1, 0, 0 );
	for ( const dt of [ 0.1, 1 / 20 ] ) for ( const past of [ 0.61, 0.65, 0.69 ] ) for ( const back of [ 0, 0.05, 0.1 ] ) {

		// along the beach (world x) from the shell hunter's place, a corner 6 m on, then up the sand; the player
		// standing `past` m round the corner on the next leg
		const a = beachWalk( ( at, inland ) => {

			const corner = at.clone().add( new Vector3( 6, 0, 0 ) ), next = corner.clone().add( new Vector3( 2, 0, 2 * inland ) ), u = next.clone().sub( corner ).normalize();
			return { start: at.clone().addScaledVector( X, - back ), route: () => [ corner, next, next.clone().add( new Vector3( 1, 0, inland ) ) ], at: () => corner.clone().addScaledVector( u, past ) };

		}, dt, 8 );
		// a route sent from where it stands (its first leg no length): the player `past` m along the next
		const b = beachWalk( at => ( { start: at.clone().addScaledVector( X, - back ), route: p => [ p.world.clone(), p.world.clone().add( new Vector3( 4, 0, 0 ) ) ], at: p => p.world.clone().addScaledVector( X, past ) } ), dt, 2 );
		for ( const [ where, r ] of [ [ 'round a corner', a ], [ 'setting off', b ] ] ) {

			const what = `${ ( 1 / dt ).toFixed( 0 ) } frames a second, ${ where }, the player ${ past } m on (start ${ back } m back)`;
			seen.push( r.closest );
			if ( r.mode !== 'walk' ) bad.push( `${ what }: the player was not on his feet on the sand (${ r.mode })` );
			if ( r.closest < R + PLAYER_R - 0.02 ) bad.push( `${ what }: the walker's centre came within ${ r.closest.toFixed( 2 ) } m of where he stood` );
			if ( r.moved >= STILL ) bad.push( `${ what }: the player was moved ${ r.moved.toFixed( 2 ) } m` );

		}

	}
	t0.diagnostic( `closest ${ Math.min( ...seen ).toFixed( 3 ) } m over ${ seen.length } cases` );
	assert.deepEqual( bad, [], 'a beach walker stepped into the player' );

} );
