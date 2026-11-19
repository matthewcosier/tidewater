// The open sea sends nothing back. The tsunami's outer ring (Field.js OUTER_GRID, 257 x 257 cells at 32 m) is a box in
// an ocean that in reality goes on: a wave that leaves the island must leave the ring too, through its 8-cell sponge
// (WaterGrid.sources). Here: a 2 m Gaussian mound (sigma 400 m) released at rest at the centre of a ring on a flat 90 m
// sea spreads as a ring wave that meets all four edges near normal incidence; whatever they send back focuses on the
// centre about 2 x 4096 m / 30 m/s = 275 s later. Held: under 5 % of the mound comes back (measured 1.0 %); a ring
// with no band, reflecting walls, sends back far more, so the test fails if the band stops absorbing. A plane crest
// is no test of the edge: one running along the side bands is eaten there and its deficit diffracts in. A
// characteristic (Riemann-invariant) absorbing band was tried and returned 0.7 % against the sponge's 1.0 %, and the
// land on the real island flooded a second time 255-290 s after the 10 m crest with either: that re-flood is not the
// ring's edges (docs/disasters.md "How a tsunami ends").
import test from 'node:test';
import assert from 'node:assert/strict';
import { WaterGrid } from '../src/disasters/WaterGrid.js';

const DEPTH = 90; // m: the open sea round the island
const H = 2; // m
const SIGMA = 400; // m
const ring = sponge => new WaterGrid( () => - DEPTH, { n: 257, dx: 32, sponge } );

function returned( sponge ) {
	const g = ring( sponge ), n = g.n;
	for ( let k = 0; k < g.h.length; k ++ ) {
		const x = g.x + ( k % n ) * g.dx, z = g.z + Math.floor( k / n ) * g.dx;
		g.h[ k ] = DEPTH + H * Math.exp( - ( x * x + z * z ) / ( 2 * SIGMA * SIGMA ) );
	}
	g.pack();
	const centre = ( ( n - 1 ) / 2 ) * n + ( n - 1 ) / 2, c = Math.sqrt( 9.81 * DEPTH ), back = 2 * 4096 / c;
	let reflected = 0;
	for ( let t = 0; t < back + 60; ) {
		const dt = g.stableStep();
		g.step( dt ); t += dt;
		if ( t > back - 45 ) reflected = Math.max( reflected, Math.abs( g.h[ centre ] - DEPTH ) );
	}
	return { reflected, fraction: reflected / H };
}

test( 'A wave leaving the ring comes back at under 5 % of its height', () => {
	const open = returned( true ), walls = returned( false );
	console.log( `# sponge band: ${ open.reflected.toFixed( 3 ) } m back at the centre (${ ( 100 * open.fraction ).toFixed( 1 ) } % of the mound); reflecting walls: ${ walls.reflected.toFixed( 3 ) } m (${ ( 100 * walls.fraction ).toFixed( 1 ) } %)` );
	assert.ok( walls.fraction > 0.05, `the walls alone send back ${ ( 100 * walls.fraction ).toFixed( 1 ) } %: the gauge cannot tell an open edge from a closed one` );
	assert.ok( open.fraction < 0.05, `${ ( 100 * open.fraction ).toFixed( 1 ) } % of the mound came back from the ring's edge (${ open.reflected.toFixed( 3 ) } m)` );
} );

test( 'The edge band leaves a calm sea exactly at rest', () => {
	const g = ring( true ), before = g.h.slice();
	for ( let s = 0; s < 50; s ++ ) g.step( g.stableStep() );
	let moved = 0;
	for ( let k = 0; k < g.h.length; k ++ ) if ( g.h[ k ] !== before[ k ] || g.qx[ k ] !== 0 || g.qz[ k ] !== 0 ) moved ++;
	assert.equal( moved, 0, `${ moved } cells of a calm sea moved` );
} );
