import { GRAVITY } from '../engine/render/Frame.js';

// Offline wave-propagation field for shoreline waves.
//
// Solves the Eikonal equation |grad T| = 1 / c(x) with the Fast Marching Method, where
// c = sqrt(g * depth) is the shallow-water wave speed (capped offshore). Sources are the
// domain borders initialized with a plane wave travelling along `swellDir`, so wave fronts
// refract naturally around headlands and align with the depth contours near the beach.
//
// Output texture (RGBA float, resX x resZ cells of `cell` metres over the rectangular terrain domain,
// row-major k = j * resX + i with j along z):
//   r = arrival time T (s), g,b = propagation direction * exposure (length = exposure 0..1),
//   a = arrival time at the nearest shoreline (extended onto land for swash timing)

class MinHeap {

	constructor( cap ) {

		this.keys = new Float64Array( cap );
		this.vals = new Int32Array( cap );
		this.size = 0;

	}

	push( k, v ) {

		let i = this.size ++;
		const keys = this.keys, vals = this.vals;
		while ( i > 0 ) {

			const p = ( i - 1 ) >> 1;
			if ( keys[ p ] <= k ) break;
			keys[ i ] = keys[ p ]; vals[ i ] = vals[ p ];
			i = p;

		}

		keys[ i ] = k; vals[ i ] = v;

	}

	pop() {

		const keys = this.keys, vals = this.vals;
		const top = vals[ 0 ];
		const k = keys[ -- this.size ], v = vals[ this.size ];
		let i = 0;
		const n = this.size;
		while ( true ) {

			let c = 2 * i + 1;
			if ( c >= n ) break;
			if ( c + 1 < n && keys[ c + 1 ] < keys[ c ] ) c ++;
			if ( keys[ c ] >= k ) break;
			keys[ i ] = keys[ c ]; vals[ i ] = vals[ c ];
			i = c;

		}

		keys[ i ] = k; vals[ i ] = v;
		return top;

	}

}

export function computeShoreField( terrain, { cell = 4, swellDir = [ 0, - 1 ], seaLevel = 0, maxDepth = 25, minDepth = 0.25 } = {} ) {

	// cell (m): 4 m is the old 512 cells over the 2048 m square. The terrain is a rectangle now
	// (TerrainData sizeX x sizeZ), so the cell count is per axis and the field tiles it exactly.
	const sizeX = terrain.sizeX, sizeZ = terrain.sizeZ;
	const originX = terrain.originX, originZ = terrain.originZ;
	const resX = Math.round( sizeX / cell ), resZ = Math.round( sizeZ / cell );
	if ( ! ( resX > 0 && resZ > 0 && resX * cell === sizeX && resZ * cell === sizeZ ) ) {

		// a remainder would stretch the cells, and the GPU lookup ( ( xz - origin ) / size * res ) would
		// then drift from cellSize: the consumers would read a neighbouring cell
		throw new Error( `computeShoreField: cell ${ cell } m does not tile the terrain ${ sizeX } x ${ sizeZ } m` );

	}

	const h = cell;
	const N = resX * resZ;

	const depth = new Float32Array( N );
	const speed = new Float32Array( N );
	for ( let j = 0; j < resZ; j ++ ) {

		const z = originZ + ( j + 0.5 ) * h;
		for ( let i = 0; i < resX; i ++ ) {

			const x = originX + ( i + 0.5 ) * h;
			const d = seaLevel - terrain.heightAt( x, z );
			depth[ j * resX + i ] = d;
			speed[ j * resX + i ] = d > 0 ? Math.sqrt( GRAVITY * Math.min( Math.max( d, minDepth ), maxDepth ) ) : 0;

		}

	}

	const T = new Float32Array( N ).fill( Infinity );
	const state = new Uint8Array( N ); // 0 far, 1 trial, 2 known
	const heap = new MinHeap( N * 4 );
	const [ sdx, sdz ] = swellDir;
	const c0 = Math.sqrt( GRAVITY * maxDepth );

	// plane-wave initial condition on the border water cells
	for ( let j = 0; j < resZ; j ++ ) for ( let i = 0; i < resX; i ++ ) {

		if ( i !== 0 && j !== 0 && i !== resX - 1 && j !== resZ - 1 ) continue;
		const k = j * resX + i;
		if ( speed[ k ] <= 0 ) continue;
		const x = originX + ( i + 0.5 ) * h, z = originZ + ( j + 0.5 ) * h;
		// offset keeps T positive: | x * sdx + z * sdz | / c0 is at most the farthest corner over 15.7 m/s
		// (c0 at 25 m depth), well under the longer side in metres read as seconds
		T[ k ] = ( x * sdx + z * sdz ) / c0 + Math.max( sizeX, sizeZ );
		state[ k ] = 1;
		heap.push( T[ k ], k );

	}

	const solve = ( i, j ) => {

		const k = j * resX + i;
		const c = speed[ k ];
		if ( c <= 0 ) return Infinity;
		const f = h / c;
		const tx = Math.min(
			i > 0 && state[ k - 1 ] === 2 ? T[ k - 1 ] : Infinity,
			i < resX - 1 && state[ k + 1 ] === 2 ? T[ k + 1 ] : Infinity );
		const tz = Math.min(
			j > 0 && state[ k - resX ] === 2 ? T[ k - resX ] : Infinity,
			j < resZ - 1 && state[ k + resX ] === 2 ? T[ k + resX ] : Infinity );
		const a = Math.min( tx, tz ), b = Math.max( tx, tz );
		if ( ! isFinite( b ) || b - a >= f ) return a + f;
		return 0.5 * ( a + b + Math.sqrt( 2 * f * f - ( a - b ) * ( a - b ) ) );

	};

	while ( heap.size > 0 ) {

		const k = heap.pop();
		if ( state[ k ] === 2 ) continue;
		state[ k ] = 2;
		const i = k % resX, j = ( k / resX ) | 0;
		const nb = [ [ i - 1, j ], [ i + 1, j ], [ i, j - 1 ], [ i, j + 1 ] ];
		for ( const [ ni, nj ] of nb ) {

			if ( ni < 0 || nj < 0 || ni >= resX || nj >= resZ ) continue;
			const nk = nj * resX + ni;
			if ( state[ nk ] === 2 || speed[ nk ] <= 0 ) continue;
			const t = solve( ni, nj );
			if ( t < T[ nk ] ) {

				T[ nk ] = t;
				state[ nk ] = 1;
				heap.push( t, nk );

			}

		}

	}

	// Extend a field onto land one ring of cells per pass (average of the known neighbours + inc).
	// Each pass reads the previous pass only: filling in place while scanning would let values from
	// far away (e.g. the other side of the island) sweep across the land in a single pass.
	const extend = ( F, passes, inc ) => {

		const prev = new Float32Array( N );
		for ( let pass = 0; pass < passes; pass ++ ) {

			prev.set( F );
			let changed = false;
			for ( let j = 0; j < resZ; j ++ ) for ( let i = 0; i < resX; i ++ ) {

				const k = j * resX + i;
				if ( isFinite( prev[ k ] ) ) continue;
				let s = 0, n = 0;
				if ( i > 0 && isFinite( prev[ k - 1 ] ) ) { s += prev[ k - 1 ]; n ++; }
				if ( i < resX - 1 && isFinite( prev[ k + 1 ] ) ) { s += prev[ k + 1 ]; n ++; }
				if ( j > 0 && isFinite( prev[ k - resX ] ) ) { s += prev[ k - resX ]; n ++; }
				if ( j < resZ - 1 && isFinite( prev[ k + resX ] ) ) { s += prev[ k + resX ]; n ++; }
				if ( n > 0 ) { F[ k ] = s / n + inc; changed = true; }

			}

			if ( ! changed ) break;

		}

	};

	// arrival time at the nearest shoreline, extended unchanged onto land (swash timing)
	const Tshore = new Float32Array( T );
	extend( Tshore, 40, 0 );

	// extend T onto land (so the swash zone has a continuous phase), continuing slowly up the beach
	const Tfilled = new Float32Array( T );
	extend( Tfilled, 24, h / 1.5 );

	// smooth to remove first-order FMM kinks (keeps phase monotonic)
	let Ts = Tfilled;
	for ( let it = 0; it < 3; it ++ ) {

		const out = new Float32Array( N );
		for ( let j = 0; j < resZ; j ++ ) for ( let i = 0; i < resX; i ++ ) {

			const k = j * resX + i;
			if ( ! isFinite( Ts[ k ] ) ) { out[ k ] = Ts[ k ]; continue; }
			let s = Ts[ k ] * 4, w = 4;
			for ( const [ di, dj ] of [ [ - 1, 0 ], [ 1, 0 ], [ 0, - 1 ], [ 0, 1 ] ] ) {

				const ni = i + di, nj = j + dj;
				if ( ni < 0 || nj < 0 || ni >= resX || nj >= resZ ) continue;
				const v = Ts[ nj * resX + ni ];
				if ( isFinite( v ) ) { s += v; w ++; }

			}

			out[ k ] = s / w;

		}

		Ts = out;

	}

	// directions + exposure
	const data = new Float32Array( N * 4 );
	const sl = Math.hypot( sdx, sdz );
	for ( let j = 0; j < resZ; j ++ ) for ( let i = 0; i < resX; i ++ ) {

		const k = j * resX + i;
		const t = Ts[ k ];
		const g = ( a, b ) => ( isFinite( a ) && isFinite( b ) ) ? ( a - b ) : 0;
		const tl = i > 0 ? Ts[ k - 1 ] : t, tr = i < resX - 1 ? Ts[ k + 1 ] : t;
		const td = j > 0 ? Ts[ k - resX ] : t, tu = j < resZ - 1 ? Ts[ k + resX ] : t;
		let gx = g( tr, tl ), gz = g( tu, td );
		if ( gx === 0 && isFinite( tr ) && isFinite( t ) ) gx = tr - t;
		if ( gz === 0 && isFinite( tu ) && isFinite( t ) ) gz = tu - t;
		const len = Math.hypot( gx, gz ) || 1;
		const dx = gx / len, dz = gz / len;
		// exposure: how directly the local wave direction faces the incoming swell
		const align = ( dx * sdx + dz * sdz ) / sl;
		const exposure = Math.min( 1, Math.max( 0.02, align * 1.4 + 0.1 ) );
		// direction scaled by exposure (length = exposure), alpha = shoreline arrival time
		data[ k * 4 ] = isFinite( t ) ? t : 1e5;
		data[ k * 4 + 1 ] = dx * exposure;
		data[ k * 4 + 2 ] = dz * exposure;
		data[ k * 4 + 3 ] = isFinite( Tshore[ k ] ) ? Tshore[ k ] : ( isFinite( t ) ? t : 1e5 );

	}

	return { data, resX, resZ, cellSize: h, originX, originZ, sizeX, sizeZ, depth };

}
