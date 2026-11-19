// The gate queue closes up as its front pair boards (docs/people.md, Solid trunks, cars and room). Foot passengers
// wait at the gangway gate in pairs (Crowd.js spot(): two files 0.8 m apart, rows 0.7 m apart) and the front pair
// boards first. Before this the queue kept its gaps: the places by the gate emptied while everyone behind stood
// still, and each new arrival walked up past the people waiting to the front-most free place. Each check runs the
// crowd's own closeUp and boarder on the real crowd at the real terminal (test/helpers/crowd-world.mjs), its gate
// queue as Crowd.stop makes it and its people as Crowd.spawnFoot makes them (the places and the way in from the
// tables the crowd walks, ROUTES).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '../src/ferry/Crowd.js';
import { crowdWorld, keepBufferWrites } from './helpers/crowd-world.mjs';

test.after( keepBufferWrites() );

const PLACES = [ ...ROUTES.queue() ];   // terminal frame [ x, y, z ], the front pair first
const WAY_IN = new Map();               // the way in from the hall to each place, as the crowd walks it
for ( const [ name, pts ] of ROUTES.terminal() ) if ( name.startsWith( 'the way in' ) ) WAY_IN.set( Number( name.match( /\d+$/ )[ 0 ] ), pts );
const EPS = 1e-6;                       // m

// the crowd's gate queue at the terminal with n people the crowd makes for it (Crowd.spawnFoot: each to the front-most
// free place), the first `placed` standing in their places and the rest on their way in from the hall
function queued( n, placed = n ) {

	const w = crowdWorld( n ), queue = w.crowd.stop( w.terminal ).queue;
	for ( let k = 0; k < n; k ++ ) w.crowd.spawnFoot( w.terminal, k < placed );
	return { crowd: w.crowd, queue, people: w.crowd.people.slice() };

}
const same = ( w, place ) => Math.abs( w[ 1 ] - place[ 0 ] ) < EPS && Math.abs( w[ 3 ] - place[ 2 ] ) < EPS;
const fmt = w => `(${ w[ 1 ].toFixed( 2 ) }, ${ w[ 3 ].toFixed( 2 ) })`;
// everything wrong with where p is going: their claim, their place, the end of their way and its last leg
function moved( queue, p, from, to ) {

	const bad = [], who = `the person from place ${ from }`;
	if ( queue.slots[ to ].who !== p || p.slot?.i !== to || p.spot !== to ) bad.push( `${ who } holds place ${ p.slot?.i } (spot ${ p.spot }), not ${ to }` );
	if ( ! same( p.at, PLACES[ to ] ) ) bad.push( `${ who } is bound for ${ fmt( p.at ) }, not place ${ to }` );
	if ( ! p.path ) return [ ...bad, `${ who } is not walking up` ];
	const end = p.path.at( - 1 ), before = p.path.at( - 2 );
	if ( ! same( end, PLACES[ to ] ) ) bad.push( `${ who } walks to ${ fmt( end ) }, not place ${ to }` );
	// the last leg runs up their own file from behind: never across the other file, never back down the queue
	if ( Math.abs( before[ 1 ] - end[ 1 ] ) > EPS || before[ 3 ] > end[ 3 ] ) bad.push( `${ who } walks the last leg from ${ fmt( before ) } to ${ fmt( end ) }, not up their own file` );
	return bad;

}

test( 'When the front pair boards, everyone behind moves up a row in their own file and an arrival\'s claim moves up with them', () => {

	const { crowd, queue, people } = queued( 11, 10 );   // the eleventh still on the way in
	queue.release( people[ 0 ] );               // the front pair boards (Crowd.update)
	queue.release( people[ 1 ] );
	crowd.closeUp( queue );
	const bad = [];
	for ( let k = 2; k <= 10; k ++ ) {

		const p = people[ k ];
		bad.push( ...moved( queue, p, k, k - 2 ) );
		// standing ones set off from where they stand
		if ( k < 10 && p.path && ! same( p.path[ 0 ], PLACES[ k ] ) ) bad.push( `the person from place ${ k } sets off from ${ fmt( p.path[ 0 ] ) }, not where they stand` );

	}
	for ( const k of [ 9, 10, 11 ] ) if ( queue.slots[ k ].who ) bad.push( `place ${ k } is still held` );
	assert.deepEqual( bad, [], 'the queue did not close up' );

} );

test( 'With two rows free the queue closes up over two frames, front to back, keeping its order, and leaves no gap ahead of anyone', () => {

	const { crowd, queue, people } = queued( 12, 10 );
	for ( const k of [ 0, 1, 2, 3 ] ) queue.release( people[ k ] );
	crowd.closeUp( queue );
	crowd.closeUp( queue );
	const bad = [];
	for ( let k = 4; k < 12; k ++ ) bad.push( ...moved( queue, people[ k ], k, k - 4 ) );
	for ( let k = 0; k < 12; k ++ ) {

		const held = !! queue.slots[ k ].who;
		if ( held !== k < 8 ) bad.push( `place ${ k } is ${ held ? 'held' : 'free' } after closing up` );

	}
	assert.deepEqual( bad, [], 'the queue did not close up to the gate' );

} );

test( 'Only someone standing in their place boards: whoever is still walking up to the front waits until they stand in it', () => {

	const { crowd, queue, people } = queued( 6 );
	queue.release( people[ 0 ] );               // the front of the left file boards
	people[ 0 ].aboard = true;
	crowd.closeUp( queue );                     // the left file moves up a row, the right file stands
	const waiting = people.filter( p => ! p.aboard ), next = crowd.boarder( waiting );
	assert.ok( next && ! next.path, `the next to board is the person from place ${ next ? people.indexOf( next ) : 'none' } (bound for place ${ next?.spot }), ${ next?.path ? 'still walking up the file' : 'nobody' }: the front of the right file stands in place 1` );
	assert.equal( next.spot, 1, `the next to board stands in place ${ next.spot }, not the front of the right file` );
	for ( const p of waiting ) if ( p.path ) p.path = null;   // they reach their places (Crowd.arrive)
	const then = crowd.boarder( waiting );
	assert.equal( then?.spot, 0, `once standing in it, the person in place 0 boards first, not place ${ then?.spot }` );

} );
