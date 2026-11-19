// People on foot give each other room (docs/people.md, Solid trunks, cars and room). The townsfolk walk authored
// routes; before this change each walked theirs at its own pace through everyone else: in 54 s of the terminal
// crowd at loading, 1,196 of 3,251 frames had two upright people overlapping by more than 5 cm (boarders following
// each other up her wing stair and along her corridor, two arrivals on the stair tower, a boarder walking through a
// person standing at her rail). Each check walks people along straight routes stepped as the owners step theirs
// (Crowd.step, Beach.step: the room sets the pace and the side step, the owner advances along the leg and adds the
// side step along the leg's left normal), on the hub's real grid, and in her real side corridor for the narrow case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from '../src/engine/index.js';
import { Grid } from '../src/people/Perception.js';
import { FerryDeck } from '../src/ferry/FerryDeck.js';
import { room } from '../src/people/Room.js';

const R = 0.27;                 // m, a person's body (Contact.js BODY_R)
const PLAYER_R = 0.3;           // m, the player's (Player.js RADIUS)
const TOL = 0.05;               // m of overlap that still reads as two people touching, not one through the other
const DT = 1 / 60;              // s

// her deck boxes (ferry_colliders.json), her frame: the clearance a person's side step needs, as Crowd.canStand
// asks it aboard (a floor within a step, no solid within a body)
const deck = new FerryDeck( { ship: null }, JSON.parse( readFileSync( new URL( '../public/ferry/ferry_colliders.json', import.meta.url ), 'utf8' ) ) );
function onDeck( x, y, z ) {

	const g = deck.groundAt( x, z, y + 0.45 );
	if ( ! Number.isFinite( g ) || Math.abs( y - g ) > 0.45 ) return false;
	for ( const b of deck.boxes ) {

		if ( ! b.solid || b.center.y + b.half.y <= y + 0.45 || b.center.y - b.half.y >= y + 1.7 ) continue;
		if ( Math.abs( x - b.center.x ) < b.half.x + R && Math.abs( z - b.center.z ) < b.half.z + R ) return false;

	}
	return true;

}

// people on routes of [ x, z ] (or [ x, z, y ]) points; `wait` s before they set off
function walker( id, pts, pace, { y = 0, wait = 0 } = {} ) {

	const path = pts.map( ( [ x, z, h ] ) => new Vector3( x, h ?? y, z ) );
	return { id, path, s: 0, pace, lat: 0, held: 0, walkV: 0, heading: 0, wait, world: path[ 0 ].clone(), posture: 'walk', room: true, arrived: null, squeezed: 0 };

}

// Step everyone for `secs`: the hub's grid of feet rebuilt each frame (People.update), then each owner's step.
function run( people, secs, { clear = () => true, player = null } = {} ) {

	const grid = new Grid( 8 ), hub = { grid, player: { on: !! player, pos: player?.pos || new Vector3() }, app: { player: player ? { mode: 'walk', position: player.pos, velocity: new Vector3() } : null } };
	const owner = { clear: ( p, x, z ) => clear( x, p.world.y, z ) };
	const rows = [];
	for ( let f = 0, t = 0; f < secs / DT; f ++, t += DT ) {

		grid.clear();
		for ( const p of people ) grid.add( p );
		for ( const p of people ) {

			if ( ! p.path ) continue;
			if ( t < p.wait ) { p.walkV = 0; p.posture = 'stand'; continue; }
			p.posture = 'walk';
			let a = p.path[ 0 ], b = p.path[ 1 ], seg = Math.hypot( b.x - a.x, b.z - a.z ), hx = ( b.x - a.x ) / seg, hz = ( b.z - a.z ) / seg;
			room( hub, p, hx, hz, seg - p.s, b.x, b.z, p.path.length === 2, DT, owner );
			if ( p.held > 2.5 ) p.squeezed += DT;
			p.s += p.walkV * DT;
			while ( p.path && p.s >= seg ) {

				p.s -= seg;
				p.path.shift();
				if ( p.path.length < 2 ) { p.world.copy( p.path[ 0 ] ); p.path = null; p.arrived = t; p.walkV = 0; p.posture = 'stand'; break; }
				a = p.path[ 0 ]; b = p.path[ 1 ]; seg = Math.hypot( b.x - a.x, b.z - a.z ); hx = ( b.x - a.x ) / seg; hz = ( b.z - a.z ) / seg;

			}
			if ( ! p.path ) continue;
			p.world.set( a.x + hx * p.s + hz * p.lat, a.y + ( b.y - a.y ) * p.s / seg, a.z + hz * p.s - hx * p.lat );
			p.heading = Math.atan2( hx, hz );

		}
		// the closest two people came this frame, and how close anyone came to the player
		let close = Infinity, toPlayer = Infinity;
		for ( let i = 0; i < people.length; i ++ ) {

			for ( let j = i + 1; j < people.length; j ++ ) close = Math.min( close, Math.hypot( people[ i ].world.x - people[ j ].world.x, people[ i ].world.z - people[ j ].world.z ) );
			if ( player ) toPlayer = Math.min( toPlayer, Math.hypot( people[ i ].world.x - player.pos.x, people[ i ].world.z - player.pos.z ) );

		}
		rows.push( { t, close, toPlayer, lat: people.map( p => p.lat ) } );

	}
	return rows;

}
const min = ( rows, k ) => rows.reduce( ( m, r ) => Math.min( m, r[ k ] ), Infinity );

test( 'A faster walker behind another follows at a person\'s depth and does not walk through them', () => {

	const lead = walker( 1, [ [ 0, 0 ], [ 0, 40 ] ], 1.2 ), back = walker( 2, [ [ 0, - 1.2 ], [ 0, 40 ] ], 1.5 );
	const rows = run( [ lead, back ], 25 );
	const closest = min( rows, 'close' ), gap = lead.world.z - back.world.z;
	assert.ok( closest >= 0.6, `the follower came within ${ closest.toFixed( 2 ) } m of the leader's centre (a person's depth is 0.66 m)` );
	assert.ok( gap < 1.0, `after 25 s the follower is ${ gap.toFixed( 2 ) } m behind: it walks on at the leader's pace, it does not stop or drop back` );

} );

test( 'Two people walking at each other on one line pass, each keeping left, without walking through each other', () => {

	const a = walker( 1, [ [ 0, 0 ], [ 0, 12 ] ], 1.3 ), b = walker( 2, [ [ 0, 12 ], [ 0, 0 ] ], 1.3 );
	const rows = run( [ a, b ], 14 );
	const closest = min( rows, 'close' ), meet = rows.reduce( ( m, r ) => r.close < m.close ? r : m );
	assert.ok( closest >= 2 * R - TOL, `they came within ${ closest.toFixed( 2 ) } m centre to centre: bodies of ${ R } m overlapped by ${ ( 2 * R - closest ).toFixed( 2 ) } m` );
	assert.ok( meet.lat[ 0 ] > 0.1 && meet.lat[ 1 ] > 0.1, `as they passed, each stepped ${ meet.lat.map( l => l.toFixed( 2 ) ).join( ' and ' ) } m to their left (keep left)` );
	assert.ok( a.arrived !== null && b.arrived !== null && Math.max( a.arrived, b.arrived ) < 12 / 1.3 + 2, `both reach their ends (at ${ a.arrived } and ${ b.arrived } s)` );

} );

test( 'On her wing stair, too narrow for two to pass (1.08 m between its walls), two people meeting squeeze past within seconds and nobody is held there for good', () => {

	// her port wing stair from the car deck (2.6 m, z -8.2) up to her corridor (7.0 m, z -1.96), walls at x 6.72 and 7.80
	const up = [ [ 7.26, - 8.2, 2.6 ], [ 7.26, - 1.96, 7.0 ] ], a = walker( 1, up, 1.2 ), b = walker( 2, [ ...up ].reverse(), 1.2 );
	const rows = run( [ a, b ], 20, { clear: onDeck } );
	assert.ok( a.arrived !== null && b.arrived !== null, `both get past each other on the stair in 20 s (arrived at ${ a.arrived } and ${ b.arrived } s)` );
	const through = rows.filter( r => r.close < 2 * R - TOL ).length * DT;
	assert.ok( through < 1, `they were overlapping for ${ through.toFixed( 2 ) } s while squeezing past` );

} );

test( 'People whose way ends at the same place close up behind each other there and stop, a person\'s depth apart', () => {

	const end = [ 0, 10 ], people = [ 0, 1, 2, 3 ].map( i => walker( i + 1, [ [ 0, - 2 * i ], end ], 1.3, { wait: 1.2 * i } ) );
	const rows = run( people, 30 );
	const closest = min( rows, 'close' ), z = people.map( p => p.world.z ).sort( ( a, b ) => b - a ), gaps = z.slice( 1 ).map( ( v, i ) => z[ i ] - v );
	assert.ok( closest >= 0.6, `two of them came within ${ closest.toFixed( 2 ) } m` );
	assert.ok( gaps.every( g => g < 0.9 ), `the line closed up behind the first: gaps ${ gaps.map( g => g.toFixed( 2 ) ).join( ', ' ) } m` );
	assert.ok( people.every( p => p.walkV < 0.02 && p.squeezed === 0 ), `everyone stopped (under 2 cm/s), nobody squeezed past the person ahead (speeds ${ people.map( p => p.walkV.toFixed( 3 ) ).join( ', ' ) } m/s, squeezing ${ people.map( p => p.squeezed.toFixed( 1 ) ).join( ', ' ) } s)` );

} );

test( 'A walker whose way runs through the player standing on it steps round him', () => {

	const player = { pos: new Vector3( 0, 0, 6 ) }, w = walker( 1, [ [ 0, 0 ], [ 0, 12 ] ], 1.3 );
	const rows = run( [ w ], 12, { player } );
	const closest = min( rows, 'toPlayer' );
	assert.ok( closest >= R + PLAYER_R - TOL, `the walker came within ${ closest.toFixed( 2 ) } m of the player's centre (bodies ${ R } + ${ PLAYER_R } m)` );
	assert.ok( w.arrived !== null, 'the walker got past him' );

} );

test( 'At a corner two walkers share (her port door, off the gangway), the one behind does not walk into the back of the one who has just turned there', () => {

	// her frame, as the crowd walks it: the gangway's last leg in through her port door to the corridor's lane, then
	// one forward up the corridor to a seat and the other aft to the sun deck's stair (Crowd.js GANGWAY, toSeat, toRail)
	const inDoor = [ [ 12.0, - 15.7 ], [ 9.32, - 15.5 ], [ 7.95, - 15.3 ] ];
	const ahead = walker( 1, [ ...inDoor, [ 7.95, - 1.2 ] ], 1.28 ), behind = walker( 2, [ [ 12.8, - 15.76 ], ...inDoor, [ 8.27, - 16.1 ], [ 8.27, - 20.3 ] ], 1.48 );
	const rows = run( [ ahead, behind ], 16 );
	const closest = min( rows, 'close' );
	assert.ok( closest >= 2 * R - TOL, `they came within ${ closest.toFixed( 2 ) } m centre to centre at the corner: bodies of ${ R } m overlapped by ${ ( 2 * R - closest ).toFixed( 2 ) } m` );
	assert.ok( ahead.arrived !== null && behind.arrived !== null, `both reach their ends (at ${ ahead.arrived } and ${ behind.arrived } s)` );

} );
