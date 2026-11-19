// Joey Island's open ground grows the same grass as Tidewater's. The grass mask (Scatter.js
// buildGrassMask) used to stop at z -950..0, the main island, so Joey (z about 1650..2100 since the
// move) was bare soil. Built on the island as App builds it: both terminals' site edits, Joey's
// village site and the road grading; the same density rules decide every texel on both islands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { applyTerminalSite, PLACES } from '../src/ferry/Terminal.js';
import { JOEY_VILLAGE_SITE } from '../src/joey/Village.js';
import { JOEY } from '../src/world/terrain/IslandShape.js';
import { VegSite, buildGrassMask } from '../src/world/vegetation/Scatter.js';
import { GPU } from '../src/engine/gpu/GPU.js';
import { Texture } from '../src/engine/gpu/Texture.js';

const terrain = new TerrainData();
for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
applyTerminalSite( terrain, JOEY_VILLAGE_SITE, PLACES.joey );
new CoastalRoute( terrain );
const t0 = performance.now();
// VegSite samples the terrain's detail texture on the CPU; building that texture also uploads it.
// There is no GPU in node, so for this build only the upload is a no-op (no mips, no encoder), as
// livestock-balance.mjs does: the CPU copy the placement reads is untouched.
const oldGetGPU = Texture.prototype.getGPU, oldEncoder = GPU.getEncoder;
Texture.prototype.getGPU = function () {

	this.mipsOption = false;
	return {};

};
GPU.getEncoder = () => null;
let site;
try {

	site = new VegSite( terrain );

} finally {

	Texture.prototype.getGPU = oldGetGPU;
	GPU.getEncoder = oldEncoder;

}
const mask = buildGrassMask( site );
const ms = performance.now() - t0;

// Joey's band along z, from its outline ellipses [ x, z, rx, rz ]
const J0 = Math.min( ...JOEY.map( e => e[ 1 ] - e[ 3 ] ) ), J1 = Math.max( ...JOEY.map( e => e[ 1 ] + e[ 3 ] ) );
const at = ( x, z, c ) => {
	const i = Math.floor( ( x - mask.originX ) / mask.texel ), j = Math.floor( ( z - mask.originZ ) / mask.texel );
	return mask.data[ ( j * mask.resX + i ) * 4 + c ];
};
// share of dry, open land (1.7 m up or more, outside every built site) with meadow grass on it
function cover( z0, z1 ) {
	let land = 0, grass = 0;
	for ( let z = z0; z < z1; z += 4 ) for ( let x = mask.originX + 40; x < mask.originX + mask.resX * mask.texel - 40; x += 4 ) {
		if ( terrain.heightAt( x, z ) < 2.5 || terrain.inClearZone( x, z, 4 ) ) continue;
		land ++;
		if ( at( x, z, 1 ) > 64 ) grass ++;
	}
	return { land, grass, share: grass / Math.max( land, 1 ) };
}

test( 'Joey Island\'s open land carries meadow grass about as thickly as Tidewater\'s', () => {

	const main = cover( - 950, 0 ), joey = cover( J0, J1 );
	console.log( `# meadow on open land: Tidewater ${ ( main.share * 100 ).toFixed( 1 ) } % of ${ main.land }, Joey ${ ( joey.share * 100 ).toFixed( 1 ) } % of ${ joey.land } (z ${ J0 }..${ J1 }); mask built in ${ ms.toFixed( 0 ) } ms` );
	assert.ok( joey.land > 500, `Joey has open land to grass: ${ joey.land } samples` );
	assert.ok( joey.share >= 0.5 * main.share, `Joey's meadow share ${ ( joey.share * 100 ).toFixed( 1 ) } % is at least half Tidewater's ${ ( main.share * 100 ).toFixed( 1 ) } %` );

} );

test( 'no grass on Joey\'s built ground (terminal yard, village slabs) or its road, none on the strait', () => {

	let built = 0, road = 0, sea = 0;
	for ( let z = J0; z < J1; z += 1 ) for ( let x = - 700; x < 900; x += 1 ) {
		if ( ! terrain.inClearZone( x, z, 0 ) ) continue;
		built ++;
		for ( let c = 0; c < 4; c ++ ) assert.equal( at( x, z, c ), 0, `grass channel ${ c } inside a built site at (${ x }, ${ z })` );
	}
	const joeyRoad = terrain.roads.paths.find( p => p.points.some( q => q.z > J0 ) );
	for ( const q of joeyRoad.points ) {
		road ++;
		for ( let c = 0; c < 4; c ++ ) assert.equal( at( q.x, q.z, c ), 0, `grass channel ${ c } on Joey's road at (${ q.x.toFixed( 1 ) }, ${ q.z.toFixed( 1 ) })` );
	}
	for ( let z = 600; z < J0 - 100; z += 8 ) for ( let x = - 900; x < 900; x += 8 ) {
		sea ++;
		for ( let c = 0; c < 4; c ++ ) assert.equal( at( x, z, c ), 0, `grass on the strait at (${ x }, ${ z })` );
	}
	assert.ok( built > 1000 && road > 100, `probed ${ built } built-site points and ${ road } road points on Joey` );

} );
