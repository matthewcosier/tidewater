import { test } from 'node:test';
import assert from 'node:assert/strict';
import { volumeNoise } from '../src/disasters/TornadoNoise.js';

const { data, size: n, channels } = volumeNoise();
const at = ( c, x, y, z ) => data[ ( ( ( z % n ) * n + ( y % n ) ) * n + ( x % n ) ) * channels + c ] / 255;

function correlation( c, d, a = c ) {

	let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, k = 0;
	for ( let z = 0; z < n; z += 3 ) for ( let y = 0; y < n; y += 3 ) for ( let x = 0; x < n; x ++ ) {

		const p = at( c, x, y, z ), q = at( a, x + d[ 0 ], y + d[ 1 ], z + d[ 2 ] );
		sx += p; sy += q; sxx += p * p; syy += q * q; sxy += p * q; k ++;

	}
	const cov = sxy / k - sx / k * sy / k;
	return cov / Math.sqrt( ( sxx / k - ( sx / k ) ** 2 ) * ( syy / k - ( sy / k ) ** 2 ) );

}

test( 'The volume noise is smooth from one voxel to the next along every axis, so a ray step does not read a fresh random value', () => {

	for ( const d of [ [ 1, 0, 0 ], [ 0, 1, 0 ], [ 0, 0, 1 ] ] ) {

		const r = correlation( 0, d );
		assert.ok( r >= 0.8, `neighbour correlation ${ r.toFixed( 3 ) } along ${ d }: per-voxel noise is speckle (white noise ~0)` );

	}

} );

test( 'The volume noise tiles: the step across the wrap is no larger than an interior step', () => {

	let wrap = 0, inner = 0;
	for ( let z = 0; z < n; z ++ ) for ( let y = 0; y < n; y ++ ) {

		wrap += Math.abs( at( 0, n - 1, y, z ) - at( 0, 0, y, z ) );
		inner += Math.abs( at( 0, n / 2 - 1, y, z ) - at( 0, n / 2, y, z ) );

	}
	assert.ok( wrap <= inner * 1.5, `wrap step ${ ( wrap / n / n ).toFixed( 4 ) } vs interior ${ ( inner / n / n ).toFixed( 4 ) }: a seam would draw a line round the funnel` );

} );

test( 'The shape channel spans the range and the detail channel is independent of it', () => {

	const v = [];
	for ( let i = 0; i < data.length; i += channels * 7 ) v.push( data[ i ] / 255 );
	v.sort( ( a, b ) => a - b );
	const spread = v[ Math.floor( v.length * 0.95 ) ] - v[ Math.floor( v.length * 0.05 ) ];
	assert.ok( spread >= 0.5, `5-95 % spread ${ spread.toFixed( 3 ) }: averaged octaves collapse to a flat mid grey unless stretched` );
	assert.ok( channels >= 2, `${ channels } channel(s): the funnel needs a shape and a detail field` );
	const r = Math.abs( correlation( 0, [ 0, 0, 0 ], 1 ) );
	assert.ok( r < 0.3, `shape and detail correlate ${ r.toFixed( 3 ) }` );

} );
