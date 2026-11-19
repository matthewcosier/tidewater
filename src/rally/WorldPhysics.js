// Island data the car physics needs beyond the heightfield and walker colliders.

// The car physics' heightfield: TerrainData's whole grid (the WORLD.terrain rectangle), uploaded
// through the per-axis call. The square set_terrain wrapper would cover only z -1024..1024 and
// leave Joey Island (its terminal at z 1802) with no ground under a car.
export function uploadTerrain( physics, terrain ) {

	return physics.set_terrain_grid( terrain.heights, terrain.resX, terrain.resZ, terrain.texel, terrain.originX, terrain.originZ );

}

// A car that has left the world entirely (not a car afloat: the sea floats cars) is rescued:
// non-finite, 40 m under the sea, or within EDGE of the heightfield's edge on either axis. The
// edge is the WORLD.terrain rectangle (x -1024..1024, z -1024..2304), read from the terrain itself.
// It was |x| or |z| over 1010 m, the old square domain: after Joey moved to z 1802 that rescued a
// car at Joey's terminal every frame and threw a car off the ferry as she passed z 1010.
const EDGE = 14; // m inside the heightfield's edge, as before (1024 - 1010)
export function leftWorld( terrain, p ) {

	if ( ! Number.isFinite( p.x + p.y + p.z ) || p.y < - 40 ) return true;
	const x0 = terrain.originX + EDGE, x1 = terrain.originX + terrain.resX * terrain.texel - EDGE;
	const z0 = terrain.originZ + EDGE, z1 = terrain.originZ + terrain.resZ * terrain.texel - EDGE;
	return p.x < x0 || p.x > x1 || p.z < z0 || p.z > z1;

}

// Terrain material per height texel, from the same splat data the renderer uses:
// 0 dry sand, 1 soil/grass, 2 rock, 7 wet sand (firm, near the waterline).
export function terrainMaterialCodes( terrain ) {

	// one code per height texel, same row-major grid ( k = j * resX + i ) as terrain.heights
	const { heights } = terrain;
	const codes = new Uint8Array( terrain.resX * terrain.resZ );
	for ( let i = 0; i < codes.length; i ++ ) {

		const sand = ( terrain.sand?.[ i ] ?? 255 ) / 255, rock = terrain.rock?.[ i ] ?? 0;
		codes[ i ] = rock > 0.7 && sand < 0.25 ? 2 : sand > 0.3 ? ( heights[ i ] < 0.9 ? 7 : 0 ) : 1;

	}
	return codes;

}

// Palm and tree trunks as solid cylinders: the car physics takes them, and so do people on foot
// (Colliders.setTrunks, from RallyDrive.refreshIslandColliders), the ragdoll and flood clinging.
// Young palms and banana plants are soft enough to drive and walk through.
export function trunkCylinders( vegetation, terrain ) {

	const out = [];
	const records = vegetation?.records;
	if ( ! records ) return new Float32Array();
	for ( const [ list, radius ] of [ [ records.palms, 0.2 ], [ records.trees, 0.28 ] ] ) {

		for ( const r of list || [] ) {
			if (r.disasterFallen) continue;

			const ground = terrain.heightAt( r.x, r.z );
			out.push( r.x, r.z, radius * ( r.s || 1 ), ground - 0.6, ground + Math.min( 6, r.H || 6 ) );

		}

	}
	return new Float32Array( out );

}

// Camera-only obstacles for the chase boom (never in the car physics): each banana plant as a
// stem cylinder from the ground up through its leaf crown, so the boom comes in front of a plant
// standing between the lens and the car, and its crown (the leaf spread, at leaf height) for a
// small pull when the lens would sit in or just behind the leaves. Flat [ x, z, radius, bottom, top, ... ].
export function cameraPlants( vegetation, terrain ) {

	const stems = [], crowns = [];
	for ( const r of vegetation?.records?.bananas || [] ) {

		const ground = terrain.heightAt( r.x, r.z ), H = r.H || 1.8 * ( r.s || 1 );
		stems.push( r.x, r.z, 0.2 * ( r.s || 1 ), ground - 0.3, ground + 2.0 * H );
		crowns.push( r.x, r.z, 0.9 * H, ground + 0.6 * H, ground + 2.1 * H );

	}
	return { stems: new Float32Array( stems ), crowns: new Float32Array( crowns ) };

}
