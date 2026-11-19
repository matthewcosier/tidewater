import test from 'node:test';
import assert from 'node:assert/strict';
import { WaterGrid } from '../src/disasters/WaterGrid.js';

const G = 9.81; // m/s^2
const DX = 8; // m: Field.js WATER_GRID

// A solitary wave of height H over still depth d (m) on a flat floor that meets a plane beach of slope 1:cot,
// shoreline at x = 0, land rising to +LAND m. Returns the highest wet ground (m above datum) on the centre row.
function runUp( d, H, cot ) {
	const LAND = 200; // m of dry beach behind the shoreline
	const k = Math.sqrt( 3 * H / ( 4 * d * d * d ) ); // 1/m: the solitary wave's sech^2 width
	const toe = - d * cot; // m: the foot of the slope
	const x0 = toe - 3 / k; // m: the crest starts fully on the flat (sech^2 is 1% of H at 3 / k)
	const xMin = x0 - 3 / k - 120; // m: room behind the wave, and the wall's reflection stays out of the run
	const n = Math.ceil( ( LAND - xMin ) / DX ) + 1;
	const ground = x => x < toe ? - d : Math.min( LAND / cot, ( x - toe ) / cot - d );
	// sponge off: the side walls are mirrors for a plane wave, so the centre row is the 1-D problem.
	const w = new WaterGrid( x => ground( x ), { n, dx: DX, x: ( xMin + LAND ) / 2, z: 0, sponge: false } );
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {
		const p = j * n + i, x = w.x + i * DX, still = Math.max( 0, - w.bed[ p ] );
		if ( still <= 0 ) continue;
		const eta = H / Math.cosh( k * ( x - x0 ) ) ** 2; // m
		const h = still + eta;
		// A right-going simple wave of the shallow-water equations: u = 2 ( sqrt( g h ) - sqrt( g d ) ).
		w.h[ p ] = h;
		w.qx[ p ] = h * 2 * ( Math.sqrt( G * h ) - Math.sqrt( G * still ) );
	}
	w.pack();
	const row = Math.floor( n / 2 ) * n;
	const end = ( - x0 ) / Math.sqrt( G * d ) + 60; // s: the crest's travel to the shore, then the run-up
	let R = 0;
	for ( let t = 0; t < end; t += 0.1 ) {
		w.advance( 0.1 );
		for ( let i = 0; i < n; i ++ ) {
			const p = row + i;
			if ( w.bed[ p ] > 0 && w.h[ p ] > 0.02 && w.bed[ p ] + w.h[ p ] > R ) R = w.bed[ p ] + w.h[ p ];
		}
	}
	return R;
}

const nonBreaking = ( d, H, cot ) => d * 2.831 * Math.sqrt( cot ) * ( H / d ) ** 1.25;
const breaking = ( d, H ) => d * 0.918 * ( H / d ) ** 0.606;

for ( const [ name, d, ratio, cot, law ] of [
	[ 'non-breaking solitary wave on the 1:19.85 benchmark beach', 30, 0.0185, 19.85, 'non' ],
	[ 'breaking solitary wave on the 1:19.85 benchmark beach', 15, 0.3, 19.85, 'breaking' ],
	[ 'non-breaking solitary wave on the village\'s 1:10 beach', 30, 0.04, 10, 'non' ],
] ) {
	test( `Run-up: ${ name } (H / d ${ ratio }) is within 30% of Synolakis (1987)`, () => {
		const H = ratio * d;
		if ( law === 'non' ) assert.ok( ratio < 0.818 * cot ** ( - 10 / 9 ), 'the case lies inside the non-breaking law' );
		const expected = law === 'non' ? nonBreaking( d, H, cot ) : breaking( d, H );
		const R = runUp( d, H, cot );
		const report = `d ${ d } m, H ${ H.toFixed( 2 ) } m, 1:${ cot }: solver ${ R.toFixed( 2 ) } m, law ${ expected.toFixed( 2 ) } m (${ ( 100 * ( R / expected - 1 ) ).toFixed( 0 ) }%)`;
		console.log( report );
		assert.ok( Math.abs( R / expected - 1 ) <= 0.3, report );
	} );
}
