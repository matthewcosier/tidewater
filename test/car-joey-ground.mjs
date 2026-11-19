import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { applyTerminalSite, terminalToWorld, PLACES, Terminal } from '../src/ferry/Terminal.js';
import { JOEY_VILLAGE_SITE } from '../src/joey/Village.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { uploadTerrain, leftWorld } from '../src/rally/WorldPhysics.js';

await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );

const terrain = new TerrainData();
for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
applyTerminalSite( terrain, JOEY_VILLAGE_SITE, PLACES.joey );
// the road grading (both islands' roads, Joey's ring and its terminal link) cuts and fills the
// heights before the car physics reads them (App.js builds CoastalRoute before RallyDrive.init)
const route = new CoastalRoute( terrain );

// Joey's start spot, from the Terminal's own queueSpot (where "Start at: Joey Island terminal" puts a car)
const joey = { yaw: PLACES.joey.yaw, toWorld: local => terminalToWorld( local, undefined, PLACES.joey ) };
const spot = Terminal.prototype.queueSpot.call( joey );
const tide = WORLD.ferryTerminal.position, far = WORLD.joeyTerminal.position;

test( 'the car physics ground at Joey Island is the terminal flat, the same ground TerrainData.heightAt gives', () => {

	const physics = new RallyPhysics();
	assert.ok( uploadTerrain( physics, terrain ), 'uploadTerrain accepted the island as App builds it' );
	// the start spot, Joey's terminal origin, and points along the strait past the old z 1024 edge
	const probes = [ [ spot.x, spot.z ], [ far.x, far.z ], [ - 100, 1100 ], [ 0, 1500 ], [ 300, 2200 ] ];
	// and Joey's graded road, every 25th sample of its centre line
	const joeyRoad = route.paths?.find( p => p.points?.some( q => q.z > 1500 ) );
	for ( const q of ( joeyRoad?.points || [] ).filter( ( _, i ) => i % 25 === 0 ) ) probes.push( [ q.x, q.z ] );
	assert.ok( probes.length > 10, `Joey's road found in the route (${ probes.length - 5 } road probes)` );
	for ( const [ x, z ] of probes ) {

		const cpu = terrain.heightAt( x, z ), wasm = physics.terrain_height( x, z );
		assert.ok( Math.abs( cpu - wasm ) <= 0.05, `ground at (${ x.toFixed( 1 ) }, ${ z.toFixed( 1 ) }): CPU ${ cpu.toFixed( 3 ) } m vs WASM ${ wasm.toFixed( 3 ) } m` );

	}
	physics.free();

} );

test( 'a car started at Joey Island\'s terminal settles on four wheels and is not rescued', () => {

	const physics = new RallyPhysics();
	uploadTerrain( physics, terrain );
	physics.reset( spot.x, terrain.heightAt( spot.x, spot.z ) + 0.45, spot.z, spot.yaw );
	for ( let i = 0; i < 30; i ++ ) physics.advance( 0.1, 0, 0, 0, 1 ); // RallyDrive.init's settle
	const s = physics.snapshot();
	const p = { x: s[ 0 ], y: s[ 1 ], z: s[ 2 ] };
	let down = 0;
	for ( let w = 0; w < 4; w ++ ) if ( s[ 13 + w * 4 + 3 ] > 0.5 ) down ++;
	physics.free();
	assert.equal( down, 4, `wheels on the ground at Joey's start spot (${ spot.x.toFixed( 1 ) }, ${ spot.z.toFixed( 1 ) })` );
	assert.ok( Math.hypot( p.x - spot.x, p.z - spot.z ) < 0.5, `the car stayed on its spot: at (${ p.x.toFixed( 2 ) }, ${ p.z.toFixed( 2 ) })` );
	assert.equal( leftWorld( terrain, p ), false, `the rescue rule keeps a car at (${ p.x.toFixed( 1 ) }, ${ p.y.toFixed( 2 ) }, ${ p.z.toFixed( 1 ) }) in the world` );

} );

test( 'a car riding the ferry anywhere on the strait stays in the world; one past the heightfield edge is rescued', () => {

	// the straight line berth to berth, every 10 m, on her car deck (about 3 m above the sea)
	const out = [];
	for ( let f = 0; f <= 1; f += 10 / Math.hypot( far.x - tide.x, far.z - tide.z ) ) {

		const p = { x: tide.x + ( far.x - tide.x ) * f, y: 3, z: tide.z + ( far.z - tide.z ) * f };
		if ( leftWorld( terrain, p ) ) out.push( `(${ p.x.toFixed( 0 ) }, ${ p.z.toFixed( 0 ) })` );

	}
	assert.equal( out.length, 0, `points on the crossing the rescue rule calls out of the world: ${ out.slice( 0, 4 ).join( ' ' ) } ...` );
	const D = WORLD.terrain;
	for ( const [ x, z ] of [ [ D.originX - 5, 0 ], [ D.originX + D.sizeX + 5, 0 ], [ 0, D.originZ - 5 ], [ 0, D.originZ + D.sizeZ + 5 ] ] ) {

		assert.equal( leftWorld( terrain, { x, y: 0, z } ), true, `a car at (${ x }, ${ z }), off the heightfield, is rescued` );

	}
	assert.equal( leftWorld( terrain, { x: 0, y: NaN, z: 0 } ), true, 'a non-finite car is rescued' );
	assert.equal( leftWorld( terrain, { x: 0, y: - 41, z: 0 } ), true, 'a car 41 m under the sea is rescued' );

} );
