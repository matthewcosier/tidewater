// Terrain domain C: the heightfield is a rectangle at 1 m, x -1024..1024 and z -1024..2304
// (WORLD.terrain), so the ferry crossing south of the old 1024 m edge sits on generated
// seabed instead of the -90 m "outside" value. Asserts on the real TerrainData and the real rally
// WASM build: the grid covers the rectangle, the CPU heightAt and the car physics heightfield sit
// on the same vertices, and the deep-water fade moved from the old edge to the new one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { WORLD } from '../src/world/WorldLayout.js';

await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );

const terrain = new TerrainData();
const D = WORLD.terrain ?? {};
const OUTSIDE = - 90; // m, heightAt beyond the grid and the floor the border fades to

// texel index and texel-centre world position nearest ( x, z )
function texelAt( x, z ) {

	const i = Math.floor( ( x - terrain.originX ) / terrain.texel ), j = Math.floor( ( z - terrain.originZ ) / terrain.texel );
	return { i, j, x: terrain.originX + ( i + 0.5 ) * terrain.texel, z: terrain.originZ + ( j + 0.5 ) * terrain.texel };

}

test( 'the heightfield covers the WORLD terrain rectangle, x -1024..1024 and z -1024..2304', () => {

	assert.ok( D.sizeX > 0 && D.sizeZ > 0 && D.texel > 0, `WORLD.terrain must declare sizeX, sizeZ, texel; got ${ JSON.stringify( D ) }` );
	assert.equal( terrain.sizeX, D.sizeX, `TerrainData.sizeX ${ terrain.sizeX } vs WORLD ${ D.sizeX }` );
	assert.equal( terrain.sizeZ, D.sizeZ, `TerrainData.sizeZ ${ terrain.sizeZ } vs WORLD ${ D.sizeZ }` );
	assert.equal( terrain.originX, D.originX );
	assert.equal( terrain.originZ, D.originZ );
	assert.equal( terrain.originX, - 1024, 'west edge' );
	assert.equal( terrain.originX + terrain.sizeX, 1024, 'east edge' );
	assert.equal( terrain.originZ, - 1024, 'north edge' );
	assert.equal( terrain.originZ + terrain.sizeZ, 2304, 'south edge' );
	assert.equal( terrain.resX, terrain.sizeX / terrain.texel );
	assert.equal( terrain.resZ, terrain.sizeZ / terrain.texel );
	assert.equal( terrain.heights.length, terrain.resX * terrain.resZ, 'one height per texel, row stride resX' );
	for ( const [ x, z ] of [ [ 0, 1500 ], [ 0, 2000 ], [ - 176, 1802 ], [ 300, 1200 ], [ 0, 2200 ] ] ) {

		const t = texelAt( x, z );
		const h = terrain.heightAt( t.x, t.z );
		assert.ok( t.j < terrain.resZ && t.i < terrain.resX, `(${ x }, ${ z }) is texel (${ t.i }, ${ t.j }), outside ${ terrain.resX } x ${ terrain.resZ }` );
		assert.equal( h, terrain.heights[ t.j * terrain.resX + t.i ], `heightAt at the texel centre (${ t.x }, ${ t.z }) must be the stored height` );
		assert.ok( Number.isFinite( h ) && Math.abs( h - OUTSIDE ) > 0.5, `seabed at (${ x }, ${ z }) is ${ h } m: generated, not the ${ OUTSIDE } m outside value` );

	}

} );

test( 'the rally WASM heightfield sits on the same vertices as TerrainData.heightAt, within 0.02 m', () => {

	const physics = new RallyPhysics();
	assert.equal( typeof physics.set_terrain_grid, 'function', 'rally WASM exports set_terrain_grid' );
	assert.ok( physics.set_terrain_grid( terrain.heights, terrain.resX, terrain.resZ, terrain.texel, terrain.originX, terrain.originZ ), 'set_terrain_grid accepted the real grid' );
	// Parry splits each cell into two triangles, so it equals the bilinear heightAt exactly on
	// the vertices (texel centres) and along cell edges; probe both.
	const probes = [ [ 18, - 60 ], [ 150, 280 ], [ - 176, 1802 ], [ 0, 1500 ], [ 0, 2200 ], [ - 900, - 900 ], [ 900, 2100 ] ];
	const report = [];
	for ( const [ x, z ] of probes ) for ( const [ dx, dz ] of [ [ 0, 0 ], [ 0.5, 0 ], [ 0, 0.5 ] ] ) {

		const t = texelAt( x, z );
		const px = t.x + dx * terrain.texel, pz = t.z + dz * terrain.texel;
		const cpu = terrain.heightAt( px, pz ), wasm = physics.terrain_height( px, pz );
		report.push( `(${ px }, ${ pz }) cpu ${ cpu.toFixed( 3 ) } wasm ${ wasm.toFixed( 3 ) }` );
		assert.ok( Math.abs( cpu - wasm ) <= 0.02, `ground at (${ px }, ${ pz }): CPU ${ cpu } m vs WASM ${ wasm } m` );

	}

	physics.free();
	console.log( '# cpu vs wasm: ' + report.join( '; ' ) );

} );

test( 'the deep-water fade sits on the new south edge, not on the old z 1024 edge', () => {

	const south = terrain.originZ + terrain.sizeZ - 1;
	for ( const x of [ - 600, 0, 600 ] ) {

		const edge = terrain.heightAt( x, south );
		assert.ok( Math.abs( edge - OUTSIDE ) < 0.5, `south edge (${ x }, ${ south }) fades to ${ OUTSIDE } m, got ${ edge }` );
		const old = terrain.heightAt( x, 1024 );
		assert.ok( Number.isFinite( old ) && Math.abs( old - OUTSIDE ) > 0.5, `old edge (${ x }, 1024) is natural seabed, got ${ old } m` );

	}

} );
