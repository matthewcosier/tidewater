// The GPU tsunami solver (src/disasters/WaterGridGPU.js) against the CPU reference (WaterGrid) on the real island,
// headless WebGPU (Dawn) through test/headless.mjs. Cases: the Surge 2 m and the 320 m wall (seed 1) in the real
// DisasterField, both grids (the 32 m ring with its sponge and far-field inflow, the 8 m village grid with its
// nest) snapshotted in flight, then the same CFL steps on both solvers. And a closed basin: a mound on the
// village grid with no sponge, sloshing onto the beach (wet and dry fronts), must keep its water.
// Tolerances: the GPU state is f32, the CPU's f64; the bounds are stated per case below with the measured values.
import './headless.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';
import { WaterGrid } from '../src/disasters/WaterGrid.js';
import { WaterGridGPU } from '../src/disasters/WaterGridGPU.js';

// A machine with no GPU adapter skips with that reason; the CPU solver's tests still run.
const adapter = await navigator.gpu.requestAdapter();
const device = adapter ? await adapter.requestDevice() : null;
const noGPU = device ? false : 'no WebGPU adapter on this machine';
const island = new TerrainData(), ground = ( x, z ) => island.heightAt( x, z );
const STEPS = 60; // solver steps compared per grid (several seconds of the wave at the CFL step)
const AFTER = 6; // s after launch: the wave is moving on both grids

// Max |GPU - CPU| of depth and momentum, the wave's size, and both volumes (m^3).
function compare( grid, U ) {

	let dh = 0, dq = 0, eta = 0, q = 0, vg = 0, vc = 0;
	for ( let k = 0; k < grid.h.length; k ++ ) {

		const rest = Math.max( 0, - grid.bed[ k ] );
		dh = Math.max( dh, Math.abs( U[ k * 4 ] - grid.h[ k ] ) );
		dq = Math.max( dq, Math.abs( U[ k * 4 + 1 ] - grid.qx[ k ] ), Math.abs( U[ k * 4 + 2 ] - grid.qz[ k ] ) );
		eta = Math.max( eta, Math.abs( grid.h[ k ] - rest ) );
		q = Math.max( q, Math.hypot( grid.qx[ k ], grid.qz[ k ] ) );
		vg += U[ k * 4 ];
		vc += grid.h[ k ];

	}
	const area = grid.dx * grid.dx;
	return { dh, dq, eta, q, volumeGPU: vg * area, volumeCPU: vc * area, volumeError: Math.abs( vg - vc ) / vc };

}

async function run( grid, gpu, steps ) {

	for ( let s = 0; s < steps; s ++ ) {

		const dt = grid.stableStep();
		gpu.encodeStep( dt ); // before the CPU step: both read the same inflow clock
		grid.step( dt );

	}
	return compare( grid, await gpu.readState() );

}

const fields = new Map(); // H -> the DisasterField in flight (the frame-path test continues the 320 m one)
for ( const H of [ 2, 320 ] ) {

	test( `GPU solver matches the CPU solver on the ${ H } m tsunami (ring and village grid, ${ STEPS } steps each)`, { skip: noGPU }, async () => {

		const f = new DisasterField( ground ), e = f.start( 'tsunami', { ...DEFAULTS.tsunami, intensity: H, warningLead: 3, duration: 90, seed: 1 } );
		while ( ! e.launched ) f.advance( 0.1 );
		const launched = f.time;
		while ( f.time < launched + AFTER ) f.advance( 0.1 );
		fields.set( H, f );
		const ring = new WaterGridGPU( device, f.outer ), village = new WaterGridGPU( device, f.water, { parent: ring } );
		// The village grid first: its nest reads the ring's pixels, which neither solver's step() changes.
		const results = { village: await run( f.water, village, STEPS ), ring: await run( f.outer, ring, STEPS ) };
		console.log( JSON.stringify( { H, inflow: !! f.outer.inflow, ...results } ) );
		for ( const [ name, r ] of Object.entries( results ) ) {

			assert.ok( r.q > 0.1, `${ name }: the wave moves on the grid (max |q| ${ r.q.toFixed( 3 ) } m^2/s)` );
			// f32 vs f64 through 60 steps: depth within 1 mm + 1e-4 of the wave, momentum within 1e-3 of the largest.
			assert.ok( r.dh <= 1e-3 + 1e-4 * r.eta, `${ name }: depth within ${ ( 1e-3 + 1e-4 * r.eta ).toFixed( 4 ) } m of the CPU (max ${ r.dh.toExponential( 2 ) } m, wave ${ r.eta.toFixed( 2 ) } m)` );
			assert.ok( r.dq <= 1e-3 * r.q, `${ name }: momentum within ${ ( 1e-3 * r.q ).toExponential( 2 ) } m^2/s of the CPU (max ${ r.dq.toExponential( 2 ) }, largest ${ r.q.toFixed( 2 ) })` );
			assert.ok( r.volumeError < 1e-6, `${ name }: volume within 1e-6 of the CPU's (${ r.volumeError.toExponential( 2 ) }: ${ r.volumeGPU.toFixed( 0 ) } vs ${ r.volumeCPU.toFixed( 0 ) } m^3)` );

		}
		ring.destroy();
		village.destroy();

	} );

}

test( 'GPU solver keeps the water of a closed basin sloshing onto the beach (no sponge, wet and dry fronts)', { skip: noGPU }, async () => {

	// 1 km round the boardwalk (58, -46), walls at the edge; a 3 m Gaussian mound (sigma 60 m) on the sea cell over
	// 5 m deep nearest the centre (staging: written onto the host state as a launch would).
	const grid = new WaterGrid( ground, { n: 129, dx: 8, x: 58, z: - 46, sponge: false } ), n = grid.n;
	let centre = - 1, best = Infinity;
	for ( let k = 0; k < grid.h.length; k ++ ) {

		const d = ( k % n - 64 ) ** 2 + ( Math.floor( k / n ) - 64 ) ** 2;
		if ( grid.h[ k ] > 5 && d < best ) { best = d; centre = k; }

	}
	assert.ok( centre >= 0, 'a sea cell over 5 m deep lies on the grid' );
	for ( let k = 0; k < grid.h.length; k ++ ) {

		const r2 = ( ( k % n - centre % n ) ** 2 + ( Math.floor( k / n ) - Math.floor( centre / n ) ) ** 2 ) * grid.dx ** 2;
		if ( grid.h[ k ] > 0.2 ) grid.h[ k ] += 3 * Math.exp( - r2 / ( 2 * 60 * 60 ) );

	}
	grid.pack();
	const before = grid.volume(), gpu = new WaterGridGPU( device, grid );
	const r = await run( grid, gpu, 200 );
	const drift = Math.abs( r.volumeGPU - before ) / before;
	console.log( JSON.stringify( { basin: true, before, drift, cpuDrift: Math.abs( r.volumeCPU - before ) / before, positivity: grid.stats.positivityCorrection, ...r } ) );
	assert.ok( r.q > 0.1, `the mound moves (max |q| ${ r.q.toFixed( 3 ) } m^2/s)` );
	assert.ok( drift < 1e-6, `the GPU basin keeps its volume to 1e-6 (${ drift.toExponential( 2 ) } of ${ before.toFixed( 0 ) } m^3)` );
	assert.ok( r.dh <= 1e-3 + 1e-4 * r.eta, `depth within ${ ( 1e-3 + 1e-4 * r.eta ).toFixed( 4 ) } m of the CPU (max ${ r.dh.toExponential( 2 ) } m)` );
	gpu.destroy();

} );

test( 'The GPU frame path keeps the clock, steps under the cap and lands its readback in the host grid (320 m wall)', { skip: noGPU }, async () => {

	// Continues the 320 m field (after its parity steps): 121 frames of 1/60 s through WaterGridGPU.advance, the
	// ring first and the village grid nested in it, as Field.advance orders them.
	const f = fields.get( 320 );
	assert.ok( f, 'the 320 m parity case ran first' );
	const ring = new WaterGridGPU( device, f.outer ), village = new WaterGridGPU( device, f.water, { parent: ring } );
	const t0 = [ f.outer.time, f.water.time ], dropped = [ f.outer.stats.droppedTime, f.water.stats.droppedTime ], steps = [ 0, 0 ];
	for ( let frame = 0; frame < 120; frame ++ ) {

		steps[ 0 ] = Math.max( steps[ 0 ], ring.advance( 1 / 60 ) );
		steps[ 1 ] = Math.max( steps[ 1 ], village.advance( 1 / 60 ) );
		if ( frame % 4 === 3 ) await Promise.all( [ ring.pending, village.pending ] ); // let readbacks land, as frames would

	}
	// A frame whose two readback buffers are both still mapping skips its copy (the host keeps the field it has), so
	// let them land and take one more frame: its copy is the one the host must then hold.
	await Promise.all( [ ring.pending, village.pending ] );
	ring.advance( 1 / 60 );
	village.advance( 1 / 60 );
	await Promise.all( [ ring.pending, village.pending ] );
	const out = {};
	for ( const [ name, gpu, i ] of [ [ 'ring', ring, 0 ], [ 'village', village, 1 ] ] ) {

		const grid = gpu.grid, kept = grid.time - t0[ i ] + gpu.lag, pixels = await gpu.readPixels();
		let diff = 0;
		for ( let k = 0; k < pixels.length; k ++ ) diff = Math.max( diff, Math.abs( pixels[ k ] - grid.pixels[ k ] ) );
		let deepest = 0;
		for ( let k = 0; k < grid.h.length; k ++ ) if ( grid.h[ k ] - Math.max( 0, - grid.bed[ k ] ) > grid.h[ deepest ] - Math.max( 0, - grid.bed[ deepest ] ) ) deepest = k;
		const x = grid.x + ( deepest % grid.n ) * grid.dx, z = grid.z + Math.floor( deepest / grid.n ) * grid.dx, sampled = grid.sample( x, z );
		out[ name ] = { kept, maxSteps: steps[ i ], dropped: grid.stats.droppedTime - dropped[ i ], readbacks: gpu.readbacks, rate: gpu.rate, step: gpu.stepSize(), pixelDiff: diff, sampled: sampled.height, pixel: pixels[ deepest * 4 ] };
		assert.ok( Math.abs( kept - 121 / 60 ) < 1e-6 && out[ name ].dropped === 0, `${ name }: 121 frames of 1/60 s advanced the water 121/60 s (stepped + lag ${ kept.toFixed( 6 ) } s, dropped ${ out[ name ].dropped } s)` );
		assert.ok( steps[ i ] >= 1 && steps[ i ] <= 12, `${ name }: 1 to 12 solver steps per frame (${ steps[ i ] })` );
		assert.ok( gpu.readbacks >= 20 && gpu.rate > 0 && Number.isFinite( gpu.rate ), `${ name }: readbacks landed (${ gpu.readbacks }) with a CFL rate (${ gpu.rate })` );
		assert.equal( diff, 0, `${ name }: the host pixels are the GPU's after the last readback (max diff ${ diff })` );
		assert.ok( Math.abs( sampled.height - pixels[ deepest * 4 ] ) < 1e-4, `${ name }: WaterGrid.sample reads the read-back field at the wave (${ sampled.height.toFixed( 3 ) } vs ${ pixels[ deepest * 4 ].toFixed( 3 ) } m)` );

	}
	console.log( JSON.stringify( { frames: out } ) );
	ring.destroy();
	village.destroy();

} );
