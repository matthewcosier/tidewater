// Water draining off land runs no faster than friction lets it. Reference: Manning's uniform-flow speed
// u = h^( 2 / 3 ) S^( 1 / 2 ) / n (SI, n = 0.035 on land, WaterGrid.sources), the speed at which gravity down a slope S
// balances bed friction for depth h. A film or a pool that outruns it by a wide margin is a solver defect, not a flow:
// on the real island 60 s after the 10 m crest (seed 1), 200 land cells under 2 cm ran at up to 12.7 x this speed
// (2-7 m/s in 2-4 mm of water) because friction used a 2 cm depth floor, and a 1.86 m pool on a 1:2 hillside held
// 30 m/s for 100 s without moving because the surface slope reconstructed its downhill face dry. Those sheets are
// what the flood's look streaked and what dragged bodies that should have grounded.
// The other way is a defect too: a sheet held below its Manning speed cannot run off the land, so a flood never drains.
// Reconstructing every cell at a step in the surface first order held a film on an even slope at 2 to 35 % of it
// (0.015 m/s in 5 mm of water on any slope), and the drawdown's film and the backwash stood on the seabed and the land.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WaterGrid } from '../src/disasters/WaterGrid.js';

const SLOPE = 0.5; // 1:2 hillside, the slope at (360, -128) on the island
const MANNING = 0.035; // s / m^(1/3): WaterGrid's land roughness
const N = 33, DX = 8; // m
const hill = ( x, z ) => 200 - SLOPE * z; // m: ground falling toward +z, all above datum
const grid = () => new WaterGrid( hill, { n: N, dx: DX, x: 0, z: 0, sponge: false } );

function worst( g ) {
	// The largest ratio of speed to the Manning speed over the slope's film cells (away from the low wall that ponds it).
	let ratio = 0, at = null;
	for ( let j = 2; j < N - 6; j ++ ) for ( let i = 2; i < N - 2; i ++ ) {
		const k = j * N + i, h = g.h[ k ];
		if ( h < 0.002 || h > 0.1 ) continue;
		const u = Math.hypot( g.qx[ k ], g.qz[ k ] ) / h, manning = Math.pow( h, 2 / 3 ) * Math.sqrt( SLOPE ) / MANNING;
		if ( u / manning > ratio ) { ratio = u / manning; at = { h, u, manning }; }
	}
	return { ratio, at };
}

test( 'A film draining down a 1:2 hillside stays within 2 x the Manning speed for its depth', () => {
	const g = grid();
	for ( let k = 0; k < g.h.length; k ++ ) if ( Math.floor( k / N ) < 12 ) g.h[ k ] = 0.05; // m: a 5 cm sheet on the upper slope
	g.pack();
	let peak = { ratio: 0 }, wet = 0;
	for ( let t = 0; t < 20; ) {
		const dt = g.stableStep();
		g.step( dt ); t += dt;
		if ( t > 2 ) { const w = worst( g ); if ( w.ratio > peak.ratio ) peak = w; }
	}
	for ( let k = 0; k < g.h.length; k ++ ) if ( g.h[ k ] > 0.002 ) wet ++;
	assert.ok( wet > 0, 'the film is still on the slope' );
	assert.ok( peak.ratio <= 2, `a film ran at ${ peak.ratio.toFixed( 2 ) } x the Manning speed: ${ peak.at?.u.toFixed( 2 ) } m/s in ${ ( 1000 * ( peak.at?.h ?? 0 ) ).toFixed( 1 ) } mm against ${ peak.at?.manning.toFixed( 2 ) } m/s` );
} );

test( 'A film on an even slope runs at its Manning speed, however thin: 0.5 to 2 times it at 0.5 cm, 2 cm and 10 cm on 1:20, 1:5 and 1:2', () => {
	const n = 65, report = [];
	for ( const cot of [ 20, 5, 2 ] ) for ( const depth of [ 0.005, 0.02, 0.1 ] ) {
		const S = 1 / cot, g = new WaterGrid( ( x, z ) => 600 - ( x + 256 ) * S, { n, dx: DX, x: 0, z: 0, sponge: false } );
		g.h.fill( depth );
		g.pack();
		const manning = Math.pow( depth, 2 / 3 ) * Math.sqrt( S ) / MANNING; // m/s
		const T = Math.max( 20, 8 * manning / ( 9.81 * S ) + 10 ); // s: several e-folds of the friction's adjustment
		for ( let t = 0; t < T; t += 0.1 ) g.advance( 0.1 );
		const k = 32 * n + 20; // 160 m below the top edge, mid row: the sheet there is still the even sheet
		const ratio = g.qx[ k ] / g.h[ k ] / manning;
		report.push( `1:${ cot } ${ ( depth * 1000 ).toFixed( 0 ) } mm ${ ratio.toFixed( 2 ) }` );
		assert.ok( Math.abs( g.h[ k ] / depth - 1 ) < 0.05, `1:${ cot } ${ depth } m: the sheet at the gauge is ${ g.h[ k ].toFixed( 4 ) } m, no longer the even sheet` );
		assert.ok( ratio >= 0.5 && ratio <= 2, `1:${ cot }: a ${ ( depth * 1000 ).toFixed( 0 ) } mm sheet runs at ${ ratio.toFixed( 2 ) } x its Manning speed ${ manning.toFixed( 3 ) } m/s` );
	}
	console.log( `# speed / Manning: ${ report.join( ', ' ) }` );
} );

// The island's case (10 m seed 1, (360, -128)): the pool cell sits 2 m below the even slope, its ground 6 m under the cell
// above and 1.9 m over the cell below. On an even slope the pool always ran on; in the notch the film below it
// reconstructed its upper face's bed level with the pool's face surface and the pool hung at 1.86 m.
test( 'A pool moving downhill at 30 m/s over thin water runs on down the slope instead of hanging there', () => {
	const i = 16, j = 10, k = j * N + i, notch = 2; // m
	const g = new WaterGrid( ( x, z ) => hill( x, z ) - ( Math.abs( x - ( i - 16 ) * DX ) < 1 && Math.abs( z - ( j - 16 ) * DX ) < 1 ? notch : 0 ), { n: N, dx: DX, x: 0, z: 0, sponge: false } );
	for ( let m = 0; m < g.h.length; m ++ ) g.h[ m ] = 0.013; // m: the 1.3 cm films round it on the island
	g.h[ k ] = 1.86; g.qz[ k ] = 1.86 * 30; // m, m^2/s
	g.pack();
	for ( let t = 0; t < 2; ) { const dt = g.stableStep(); g.step( dt ); t += dt; }
	assert.ok( g.h[ k ] < 0.2, `the pool still holds ${ g.h[ k ].toFixed( 2 ) } m on the 1:2 slope after 2 s` );
} );
