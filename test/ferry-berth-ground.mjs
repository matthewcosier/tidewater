import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { applyTerminalSite, terminalToWorld, PLACES, BERTH } from '../src/ferry/Terminal.js';
import { JOEY_VILLAGE_SITE } from '../src/joey/Village.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { uploadTerrain } from '../src/rally/WorldPhysics.js';
import { Vector3 } from '../src/engine/index.js';

await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );

const terrain = new TerrainData();
for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
applyTerminalSite( terrain, JOEY_VILLAGE_SITE, PLACES.joey );
new CoastalRoute( terrain );
const physics = new RallyPhysics();
assert.ok( uploadTerrain( physics, terrain ), 'uploadTerrain accepted the island as App builds it' );

// Her frame (x to port, z to her bow, m): her vehicle deck spans her beam inside the bulwarks,
// x -6.6 .. 6.6, from her stern ramp hinge (her z -25.2, the terminal's hinge line z 0) to her bow
// door, her z 18.6 (public/ferry/ferry_colliders.json 'car' boxes). Moored, her model origin sits at
// the terminal's BERTH and her waterline at sea level (the terminal origin's y).
const DECK = 2.6;    // m over her waterline: the 'car' deck box top (centre 2.45 + half 0.15)
const LAND = 2.10;   // m over sea level: the lowest linkspan car surface, its sea-end landing plate
                     // (tools/ferry/terminal_build.py LAND; its tops rise from here to the yard)
const CLEAR = 0.5;   // m: the ground must lie this far under the surface the wheels ride. A wheel
                     // finds whichever is higher, so ground within a tyre's squash of the deck
                     // plane is ground the car can touch through a dip or a tip.
const STEP = 0.5;    // m: the sample grid, finer than the 1 m-class terrain texel

// Every sample over an area of a terminal's frame where the ground must stay under `top - CLEAR`.
function overTop( place, xs, zs, top ) {

	const p = new Vector3(), worst = { cpu: - Infinity, wasm: - Infinity }, high = [];
	for ( let z = zs[ 0 ]; z <= zs[ 1 ] + 1e-6; z += STEP ) for ( let x = xs[ 0 ]; x <= xs[ 1 ] + 1e-6; x += STEP ) {

		terminalToWorld( [ x, 0, z ], p, place );
		const cpu = terrain.heightAt( p.x, p.z ), wasm = physics.terrain_height( p.x, p.z );
		if ( cpu > worst.cpu ) Object.assign( worst, { cpu, at: [ x, z ] } );
		if ( wasm > worst.wasm ) Object.assign( worst, { wasm, atW: [ x, z ] } );
		const limit = place.position.y + top - CLEAR;
		if ( ( cpu > limit || wasm > limit ) && high.length < 6 ) high.push( `terminal (${ x.toFixed( 1 ) }, ${ z.toFixed( 1 ) }) world (${ p.x.toFixed( 1 ) }, ${ p.z.toFixed( 1 ) }): CPU ${ cpu.toFixed( 2 ) } m, WASM ${ wasm.toFixed( 2 ) } m` );

	}
	return { worst, high };

}

for ( const [ name, place ] of Object.entries( PLACES ) ) {

	test( `Under her moored hull at ${ name }'s berth the ground lies well below her vehicle deck`, t => {

		// her deck footprint, in the terminal frame (her z + BERTH z)
		const { worst, high } = overTop( place, [ - 6.6, 6.6 ], [ - 25.2 + BERTH[ 2 ], 18.6 + BERTH[ 2 ] ], DECK );
		t.diagnostic( `highest ground: CPU ${ worst.cpu.toFixed( 2 ) } m at terminal (${ worst.at }), WASM ${ worst.wasm.toFixed( 2 ) } m at (${ worst.atW })` );
		assert.ok( Number.isFinite( worst.wasm ), `the WASM heightfield covers the berth at ${ name }` );
		assert.deepEqual( high, [], `ground within ${ CLEAR } m of her deck (${ ( place.position.y + DECK ).toFixed( 2 ) } m) under her hull at ${ name }; highest CPU ${ worst.cpu.toFixed( 2 ) } m at terminal (${ worst.at }), WASM ${ worst.wasm.toFixed( 2 ) } m at (${ worst.atW }):\n${ high.join( '\n' ) }` );

	} );

	test( `Under ${ name }'s linkspan the ground lies well below its car surface`, t => {

		// the linkspan's car boxes, x -3.7 .. 3.7, from 2 m off the quay wall (terminal z -26, where
		// the yard fill meets it by design) to the hinge line
		const { worst, high } = overTop( place, [ - 3.7, 3.7 ], [ - 24, 0 ], LAND );
		t.diagnostic( `highest ground: CPU ${ worst.cpu.toFixed( 2 ) } m at terminal (${ worst.at }), WASM ${ worst.wasm.toFixed( 2 ) } m at (${ worst.atW })` );
		assert.ok( Number.isFinite( worst.wasm ), `the WASM heightfield covers the berth at ${ name }` );
		assert.deepEqual( high, [], `ground within ${ CLEAR } m of the linkspan (${ ( place.position.y + LAND ).toFixed( 2 ) } m) at ${ name }; highest CPU ${ worst.cpu.toFixed( 2 ) } m at terminal (${ worst.at }), WASM ${ worst.wasm.toFixed( 2 ) } m at (${ worst.atW }):\n${ high.join( '\n' ) }` );

	} );

}
