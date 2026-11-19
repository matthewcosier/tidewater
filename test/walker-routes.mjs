// Every route people walk on foot keeps a body clear of every solid thing along its whole length
// (docs/people.md, Solid trunks, cars and room). The townsfolk walk authored polylines, not physics,
// so a route drawn through a wall, a stair stringer, a bench, a trunk or a parked car is a person
// walking through it on screen. Red before this change: the foot passengers' hall door and stair
// tower legs ran up to 1.85 m inside the terminal's solids, the drivers' walk off her car deck ran
// through the mirrors of the cars they had parked, and the passengers crossing her decks clipped her
// stairs and rails (step 1 of this change counted 1,623 frames of 3,251 with a passenger inside a
// terminal solid and 2,677 inside one of her deck boxes).
// Real data throughout: the island's colliders as App builds them (village, pier, stairs, the
// terminal's own terminal_colliders.json at both berths), the plants' trunks (trunkCylinders), her
// deck boxes (ferry_colliders.json) and the shipped car models' bodies in every parking slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TerrainData } from '../src/world/TerrainData.js';
import { Village } from '../src/world/Village.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { Colliders } from '../src/world/Colliders.js';
import { VegSite, scatterVegetation } from '../src/world/vegetation/Scatter.js';
import { trunkCylinders } from '../src/rally/WorldPhysics.js';
import { Terminal, applyTerminalSite, PLACES } from '../src/ferry/Terminal.js';
import { FerryDeck } from '../src/ferry/FerryDeck.js';
import { ROUTES } from '../src/ferry/Crowd.js';
import { JOEY_VILLAGE_SITE } from '../src/joey/Village.js';
import { JETSKI_HIRE } from '../src/world/JetskiHire.js';
import { BEACH_ROUTES } from '../src/people/Beach.js';
import { prepareEvacuationRoute } from '../src/evacuation/Route.js';
import { prepareWindFarmSites } from '../src/windfarm/Sites.js';
import { prepareGliderSite } from '../src/glider/Site.js';
import { Scene, Vector3 } from '../src/engine/index.js';
import { StorageBuffer, Texture } from '../src/engine/gpu/Texture.js';
import { GPU } from '../src/engine/gpu/GPU.js';

const R = 0.27, HEIGHT = 1.7, STEP = 0.4;   // m: a townsperson's capsule and step (EvacuationWalker HUMAN_WALK)
const SAMPLE = 0.1;                         // m between the points checked along each leg
const TOL = 0.01;                           // m a capsule may be pushed and still count as clear
const SIDLE = 0.15;                         // m: half a chest's depth (0.3 m, Fruin 1971), sidling along a row of seats

const canvas = new Proxy( { measureText: () => ( { width: 100 } ), getImageData: () => ( { data: new Uint8ClampedArray( 1024 * 1024 * 4 ) } ) }, { get: ( o, k ) => k in o ? o[ k ] : () => {} } );
// VegSite samples the terrain's detail texture on the CPU; building that texture also uploads it.
// No GPU in node: the upload is a no-op for this build (no mips, no encoder), as joey-grass.mjs does.
const oldDocument = globalThis.document, oldWrite = StorageBuffer.prototype.write, oldGetGPU = Texture.prototype.getGPU, oldEncoder = GPU.getEncoder;
globalThis.document = { createElement: () => ( { getContext: () => canvas } ) };
StorageBuffer.prototype.write = function ( data ) { this.pendingData = data; };
Texture.prototype.getGPU = function () { this.mipsOption = false; return {}; };
GPU.getEncoder = () => null;
let terrain, colliders, vegetation;
try {

	terrain = new TerrainData();
	for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
	applyTerminalSite( terrain, JOEY_VILLAGE_SITE, PLACES.joey );
	colliders = new Colliders();
	const village = new Village( { scene: new Scene(), terrain, colliders } ), route = new CoastalRoute( terrain );
	prepareEvacuationRoute( terrain ); prepareWindFarmSites( terrain ); prepareGliderSite( terrain, route );
	const paths = [];
	for ( const p of [ village.path, ...( village.sidePaths || [] ) ] ) {

		if ( ! p?.samples ) continue;
		const pts = [];
		for ( let i = 0; i < p.samples.length; i += 5 ) pts.push( [ p.samples[ i ].p.x, p.samples[ i ].p.z ] );
		pts.push( [ p.samples.at( - 1 ).p.x, p.samples.at( - 1 ).p.z ] );
		paths.push( { points: pts, width: p.width ?? 1.8 } );

	}
	vegetation = { records: scatterVegetation( new VegSite( terrain, { footprints: village.getFootprints(), paths: paths.length ? paths : null } ) ) };

} finally { globalThis.document = oldDocument; StorageBuffer.prototype.write = oldWrite; Texture.prototype.getGPU = oldGetGPU; GPU.getEncoder = oldEncoder; }
colliders.setTrunks( trunkCylinders( vegetation, terrain ) );
// the jetski hire stand's walker box (src/world/JetskiHire.js), on the sand where the game beds it
{
	const S = JETSKI_HIRE.stand, c = Math.cos( S.yaw ), s = Math.sin( S.yaw );
	const y = Math.min( ...[ [ - 1.5, - 0.8 ], [ 1.5, - 0.8 ], [ - 1.5, 0.8 ], [ 1.5, 0.8 ] ].map( ( [ x, z ] ) => terrain.heightAt( S.x + x * c + z * s, S.z - x * s + z * c ) ) );
	colliders.addBox( new Vector3( S.x, y + S.half[ 1 ], S.z ), new Vector3( ...S.half ), S.yaw, { solid: true, tag: 'jetski-hire' } );
}
const terminals = Object.keys( PLACES ).map( name => {

	const t = new Terminal( { colliders }, name );
	t.addColliders( JSON.parse( readFileSync( new URL( '../public/ferry/terminal_colliders.json', import.meta.url ), 'utf8' ) ) );
	return t;

} );
const deck = new FerryDeck( { ship: null }, JSON.parse( readFileSync( new URL( '../public/ferry/ferry_colliders.json', import.meta.url ), 'utf8' ) ) );

// The shipped models' largest body (public/ferry/parked_cars.glb), half extents about its origin.
const CAR = ( () => {

	const b = readFileSync( new URL( '../public/ferry/parked_cars.glb', import.meta.url ) ), len = b.readUInt32LE( 12 );
	const g = JSON.parse( b.subarray( 20, 20 + len ).toString() ), lo = [ 0, 0, 0 ], hi = [ 0, 0, 0 ];
	for ( const root of g.nodes ) {

		if ( ! /^Parked[A-Z][a-z]+$/.test( root.name || '' ) || root.mesh === undefined ) continue;
		for ( const p of g.meshes[ root.mesh ].primitives ) {

			const a = g.accessors[ p.attributes.POSITION ];
			for ( let k = 0; k < 3; k ++ ) { lo[ k ] = Math.min( lo[ k ], a.min[ k ] ); hi[ k ] = Math.max( hi[ k ], a.max[ k ] ); }

		}

	}
	return { lo, hi };

} )();
// her car deck's parking slots and the terminal's queue places, read from the game's own tables
const source = readFileSync( new URL( '../src/ferry/Traffic.js', import.meta.url ), 'utf8' );
const num = name => Number( source.match( new RegExp( `const ${ name } = (-? ?[\\d.]+)` ) )[ 1 ].replace( ' ', '' ) );
const SLOT_Z = [ ...source.match( /const SLOTS = \[([^\]]*)\]/ )[ 1 ].matchAll( /-? ?[\d.]+/g ) ].map( m => Number( m[ 0 ].replace( ' ', '' ) ) );
const SIDE = num( 'SIDE' ), DECK = 2.6;
// a car parked in each slot, facing aft (her frame): its body as a box on her car deck
const slotCars = new Colliders();
for ( const z of SLOT_Z ) for ( const side of [ 1, - 1 ] ) {

	const cx = ( CAR.lo[ 0 ] + CAR.hi[ 0 ] ) / 2, cz = - ( CAR.lo[ 2 ] + CAR.hi[ 2 ] ) / 2;
	slotCars.addBox( new Vector3( side * SIDE - cx, DECK + ( CAR.lo[ 1 ] + CAR.hi[ 1 ] ) / 2, z + cz ), new Vector3( ( CAR.hi[ 0 ] - CAR.lo[ 0 ] ) / 2, ( CAR.hi[ 1 ] - CAR.lo[ 1 ] ) / 2, ( CAR.hi[ 2 ] - CAR.lo[ 2 ] ) / 2 ), 0, { tag: 'slot-car' } );

}

// How far her deck's solid boxes push a capsule of radius r standing at q (her frame): the same box-and-band test
// FerryDeck.resolveCapsule makes for the player, without its world transform.
function deckPush( q, r = R ) {

	let worst = 0, hit = null;
	for ( const b of deck.boxes ) {

		if ( ! b.solid || b.center.y + b.half.y <= q.y + STEP || b.center.y - b.half.y >= q.y + HEIGHT ) continue;
		const px = b.half.x + r - Math.abs( q.x - b.center.x ), pz = b.half.z + r - Math.abs( q.z - b.center.z );
		if ( px <= 0 || pz <= 0 ) continue;
		// the capsule's round edge against the box's corner
		const ex = Math.max( 0, Math.abs( q.x - b.center.x ) - b.half.x ), ez = Math.max( 0, Math.abs( q.z - b.center.z ) - b.half.z );
		const pen = ex > 0 && ez > 0 ? r - Math.hypot( ex, ez ) : Math.min( px, pz );
		if ( pen > worst ) { worst = pen; hit = b; }

	}
	return { pen: worst, box: hit };

}
// How far a route point stands off the floor under it: aboard, the highest of her walk boxes a step up or below
// it (a route over her stairwell has the treads metres below it); ashore, the terrain or the highest walkable box
// (2 cm of pad bridges the seams between the terminal's floor boxes).
function deckOff( q ) {

	let floor = - Infinity;
	for ( const b of deck.boxes ) {

		const top = b.center.y + b.half.y;
		if ( b.walk && top <= q.y + STEP && Math.abs( q.x - b.center.x ) <= b.half.x && Math.abs( q.z - b.center.z ) <= b.half.z ) floor = Math.max( floor, top );

	}
	return q.y - floor;

}
const islandOff = q => Math.abs( q.y - Math.max( terrain.heightAt( q.x, q.z ), colliders.groundHeightAt( q.x, q.z, q.y + STEP, 0.02 ) ) );
function islandPush( q ) {

	const m = q.clone();
	colliders.resolveWalker( m, R, HEIGHT, STEP );
	return Math.hypot( m.x - q.x, m.z - q.z );

}
// each leg of a polyline, every SAMPLE m, with the route point's own height
function* along( points ) {

	for ( let i = 0; i + 1 < points.length; i ++ ) {

		const a = points[ i ], b = points[ i + 1 ], n = Math.max( 1, Math.ceil( a.distanceTo( b ) / SAMPLE ) );
		for ( let k = 0; k <= n; k ++ ) yield { at: a.clone().lerp( b, k / n ), leg: i };

	}

}
const fmt = v => `(${ v.x.toFixed( 2 ) }, ${ v.y.toFixed( 2 ) }, ${ v.z.toFixed( 2 ) })`;

// The stair tower's only door (terminal_colliders.json: x 14.22 to 15.52 in its wall at z -33.35) is checked in its own
// test below. Its head was 1.1 m above the jetty (the terminal's builder started the wall and the header over it at
// JETTY + 1.1), so everyone walking in passed 0.46 m into the header; the builder now makes it a door's height
// (tools/ferry/terminal_build.py DOOR_H). The first test checks everything else.
const DOOR = { x: 14.87, z: - 33.35, x0: 0.65 + R, z0: 0.2 + R };   // terminal frame, m: the doorway and a body round it
const inDoor = ( t, p ) => { const o = t.toWorld( [ DOOR.x, 0, DOOR.z ], new Vector3() ), c = Math.cos( t.yaw ), s = Math.sin( t.yaw ), dx = p.x - o.x, dz = p.z - o.z; return Math.abs( dx * c - dz * s ) < DOOR.x0 && Math.abs( dx * s + dz * c ) < DOOR.z0; };

function terminalRoutes( keep ) {

	const bad = [];
	for ( const t of terminals ) for ( const [ name, local ] of ROUTES.terminal() ) {

		const pts = local.map( p => t.toWorld( p, new Vector3() ) );
		let worst = 0, where = null, off = 0, over = null;
		for ( const { at } of along( pts ) ) {

			if ( ! keep( t, at ) ) continue;
			const d = islandPush( at ), f = islandOff( at );
			if ( d > worst ) { worst = d; where = at; }
			if ( f > off ) { off = f; over = at; }

		}
		if ( worst > TOL ) bad.push( `${ t.name } ${ name }: ${ worst.toFixed( 2 ) } m inside a solid at ${ fmt( where ) }` );
		if ( off > STEP ) bad.push( `${ t.name } ${ name }: ${ off.toFixed( 2 ) } m off the floor at ${ fmt( over ) }` );

	}
	return bad;

}

test( 'Foot passengers\' routes at both terminals keep a body clear of every terminal solid, trunk and queued car, on the floor', () => {

	assert.deepEqual( terminalRoutes( ( t, at ) => ! inDoor( t, at ) ), [], 'routes through solids' );

} );

test( 'Foot passengers walk in through the stair tower\'s door without passing through its header', () => {

	assert.deepEqual( terminalRoutes( inDoor ), [], 'the stair tower\'s door' );

} );

// The leavers' way down the walkway passes the gate queue: a body walking by keeps clear of everyone waiting in it
// (0.6 m centre to centre: two bodies, 0.54 m, that do not touch; Room.js CLEAR). The places are where each way in
// ends. Before this the leavers walked down the walkway's middle (x 14.6), between the two files, 0.35 and 0.45 m
// from the people standing in them.
test( 'Leavers walking off her gangway down the walkway keep 0.6 m from every place in the gate queue', () => {

	const ways = [ ...ROUTES.terminal() ], places = ways.filter( ( [ name ] ) => name.startsWith( 'the way in' ) ).map( ( [ , pts ] ) => pts.at( - 1 ) );
	const [ , off ] = ways.find( ( [ name ] ) => name.startsWith( 'off her gangway' ) );
	let worst = Infinity, where = null;
	for ( const { at } of along( off.map( p => new Vector3( ...p ) ) ) ) for ( const q of places ) {

		if ( Math.abs( at.y - q[ 1 ] ) > 1 ) continue;
		const d = Math.hypot( at.x - q[ 0 ], at.z - q[ 2 ] );
		if ( d < worst ) { worst = d; where = at; }

	}
	assert.ok( worst >= 0.6, `a leaver passes ${ worst.toFixed( 2 ) } m from a person waiting in the gate queue, at ${ fmt( where ) } (terminal frame)` );

} );

test( 'Routes on her decks keep a body clear of her walls, stairs, rails, seats and the cars parked in every slot, on her floor', () => {

	const bad = [];
	for ( const [ name, pts, seated ] of ROUTES.ship() ) {

		let worst = 0, where = null, what = '', off = 0, over = null;
		for ( const { at, leg } of along( pts ) ) {

			// a seated route's last legs: the sidle along the row's legroom, chest first (half a chest's depth clear),
			// then down onto the seat (the seat holds them: no check)
			const sit = seated && leg === pts.length - 2, sidle = seated && leg === pts.length - 3;
			if ( sit ) continue;
			const d = deckPush( at, sidle ? SIDLE : R ), m = at.clone();
			slotCars.resolveCapsule( m, sidle ? SIDLE : R, HEIGHT, STEP );
			const c = Math.hypot( m.x - at.x, m.z - at.z ), f = deckOff( at );
			if ( d.pen > worst ) { worst = d.pen; where = at; what = 'her deck'; }
			if ( c > worst ) { worst = c; where = at; what = 'a parked car'; }
			if ( f > off ) { off = f; over = at; }

		}
		if ( worst > TOL ) bad.push( `${ name }: ${ worst.toFixed( 2 ) } m into ${ what } at her ${ fmt( where ) }` );
		if ( off > STEP ) bad.push( `${ name }: ${ off.toFixed( 2 ) } m above her floor at her ${ fmt( over ) }` );

	}
	assert.deepEqual( bad, [], 'routes through her solids' );

} );

test( 'The beach walkers\' routes (the shell hunters\' tideline, the bowler\'s run-up, the hire attendant) keep a body clear of every solid and trunk', () => {

	const bad = [];
	for ( const [ name, pts ] of BEACH_ROUTES( terrain ) ) {

		let worst = 0, where = null;
		for ( const { at } of along( pts ) ) { const d = islandPush( at ); if ( d > worst ) { worst = d; where = at; } }
		if ( worst > TOL ) bad.push( `${ name }: ${ worst.toFixed( 2 ) } m inside a solid at ${ fmt( where ) }` );

	}
	assert.deepEqual( bad, [], 'beach routes through solids' );

} );
