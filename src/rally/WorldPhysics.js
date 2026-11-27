// Island data the car physics needs beyond the heightfield and walker colliders.

// Terrain material per height texel, from the same splat data the renderer uses:
// 0 dry sand, 1 soil/grass, 2 rock, 7 wet sand (firm, near the waterline).
export function terrainMaterialCodes( terrain ) {

	const { res, heights } = terrain;
	const codes = new Uint8Array( res * res );
	for ( let i = 0; i < codes.length; i ++ ) {

		const sand = ( terrain.sand?.[ i ] ?? 255 ) / 255, rock = terrain.rock?.[ i ] ?? 0;
		codes[ i ] = rock > 0.7 && sand < 0.25 ? 2 : sand > 0.3 ? ( heights[ i ] < 0.9 ? 7 : 0 ) : 1;

	}
	return codes;

}

// Palm and tree trunks as solid cylinders for cars and walkers. Leaning palms are segmented
// along the exact stem curve from VegNodes.js so bumper- and roof-height impacts meet the
// visible trunk instead of empty air beside it. Young palms and bananas remain drivable.
export function trunkCylinders( vegetation, terrain ) {

	const out = [];
	const records = vegetation?.records;
	if ( ! records ) return new Float32Array();
	for ( const r of records.palms || [] ) {
		if ( r.disasterFallen ) continue;
		const ground = terrain.heightAt( r.x, r.z );
		const s = r.s || 1, H = Math.max( 2.5, r.H || 8 ), top = Math.min( 6, H );
		const lean = r.l || 0, lx = Math.cos( r.la || 0 ), lz = Math.sin( r.la || 0 );
		if ( lean * H < 0.15 ) {
			out.push( r.x, r.z, 0.26 * s, ground - 0.6, ground + top );
			continue;
		}
		// Match VegNodes.js: c = fract(seed * 7.31), fc = mix(u, u * (2 - u), c).
		const c = ( ( r.seed || 0 ) * 7.31 ) % 1;
		const spans = [ [ - 0.6, 1.4, 0.26 ], [ 1.4, 3.2, 0.22 ], [ 3.2, top, 0.18 ] ];
		for ( const [ y0, y1, rad ] of spans ) {
			if ( y1 <= y0 + 0.05 ) continue;
			const mid = Math.max( 0, ( Math.max( 0, y0 ) + y1 ) * 0.5 );
			const u = Math.min( 1, mid / H );
			const fc = u + ( u * ( 2 - u ) - u ) * c;
			const off = lean * fc * H;
			out.push( r.x + lx * off, r.z + lz * off, rad * s, ground + y0, ground + y1 );
		}
	}
	for ( const r of records.trees || [] ) {
		if ( r.disasterFallen ) continue;
		const ground = terrain.heightAt( r.x, r.z );
		const s = r.s || 1, top = Math.min( 6, r.H || 6 );
		// Broadleaf trunk tapers above the root buttresses (PlantGeometry.js: 0.38..0.30 * s).
		out.push( r.x, r.z, 0.38 * s, ground - 0.6, ground + Math.min( 1.8, top ) );
		if ( top > 1.8 ) out.push( r.x, r.z, 0.30 * s, ground + 1.8, ground + top );
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
