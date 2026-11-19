// Water draining off land runs no faster than friction lets it. Reference: Manning's uniform-flow speed
// u = h^( 2 / 3 ) S^( 1 / 2 ) / n (SI, n = 0.035 on land, WaterGrid.sources), the speed at which gravity down a slope S
// balances bed friction for depth h. A film or a pool that outruns it by a wide margin is a solver defect, not a flow:
// on the real island 60 s after the 10 m crest (seed 1), 200 land cells under 2 cm ran at up to 12.7 x this speed
// (2-7 m/s in 2-4 mm of water) because friction used a 2 cm depth floor, and a 1.86 m pool on a 1:2 hillside held
// 30 m/s for 100 s without moving because the surface slope reconstructed its downhill face dry. Those sheets are
// what the flood's look streaked and what dragged bodies that should have grounded.
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

test( 'A pool moving downhill at 30 m/s over thin water runs on down the slope instead of hanging there', () => {
	const g = grid(), i = 16, j = 10, k = j * N + i;
	for ( let m = 0; m < g.h.length; m ++ ) g.h[ m ] = 0.013; // m: the 1.3 cm films round it on the island
	g.h[ k ] = 1.86; g.qz[ k ] = 1.86 * 30; // m, m^2/s
	g.pack();
	for ( let t = 0; t < 2; ) { const dt = g.stableStep(); g.step( dt ); t += dt; }
	assert.ok( g.h[ k ] < 0.2, `the pool still holds ${ g.h[ k ].toFixed( 2 ) } m on the 1:2 slope after 2 s` );
} );
