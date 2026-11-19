import './headless.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';

const adapter = await navigator.gpu.requestAdapter();
const device = adapter ? await adapter.requestDevice() : null;
const noGPU = device ? false : 'no WebGPU adapter on this machine';
const island = new TerrainData(), ground = ( x, z ) => island.heightAt( x, z );
const FRAME = 0.1; // s: Field.advance's longest frame (its clamp), so the CPU twin runs in a few seconds
const AFTER = 8; // s after launch: the wave is on both grids and moving
const CONFIG = { ...DEFAULTS.tsunami, intensity: 2, warningLead: 3, duration: 90, seed: 1 };

// the wave's peak above the still sea and the water volume (m^3), from a grid's host arrays
function wave( grid ) {

	let eta = 0, volume = 0;
	for ( let k = 0; k < grid.h.length; k ++ ) {

		eta = Math.max( eta, grid.h[ k ] - Math.max( 0, - grid.bed[ k ] ) );
		volume += grid.h[ k ];

	}
	return { eta, volume: volume * grid.dx * grid.dx };

}

test( 'With the game\'s device the tsunami steps on the GPU, the launched wave reaches it, and a tornado or a stop hands the water back', { skip: noGPU }, async () => {

	const gpu = new DisasterField( ground ), cpu = new DisasterField( ground );
	gpu.device = device;
	const e = gpu.start( 'tsunami', CONFIG ), c = cpu.start( 'tsunami', CONFIG );
	assert.ok( gpu.gpuWater && gpu.gpuOuter, 'a tsunami started with a device steps its ring and village grid on the GPU (Field.attachGPU)' );
	assert.equal( cpu.gpuWater ?? null, null, 'no device: the CPU grids (node tests, the fallback)' );
	let launchedAt = null;
	while ( launchedAt === null || gpu.time < launchedAt + AFTER ) {

		gpu.advance( FRAME );
		cpu.advance( FRAME );
		if ( launchedAt === null && e.launched ) launchedAt = gpu.time;
		await Promise.all( [ gpu.gpuOuter.pending, gpu.gpuWater.pending ] ); // the readbacks land between frames, as in the game

	}
	assert.ok( c.launched, 'the CPU twin launched on the same frame' );
	const out = {};
	for ( const name of [ 'outer', 'water' ] ) {

		const g = wave( gpu[ name ] ), r = wave( cpu[ name ] );
		out[ name ] = { gpuEta: g.eta, cpuEta: r.eta, volumeError: Math.abs( g.volume - r.volume ) / r.volume, readbacks: gpu[ name === 'outer' ? 'gpuOuter' : 'gpuWater' ].readbacks, time: [ gpu[ name ].time, cpu[ name ].time ] };
		// The host field is one or two frames (0.1 to 0.2 s) behind the GPU's and the GPU steps at 0.9 of the CPU's
		// CFL step, so the peaks differ by the wave's change over a frame, not by its size: within 10 %.
		assert.ok( r.eta > 0.5, `${ name }: the CPU twin carries the launched wave (peak ${ r.eta.toFixed( 2 ) } m)` );
		assert.ok( Math.abs( g.eta - r.eta ) < 0.1 * r.eta, `${ name }: the GPU field read back on the host carries the launched wave (peak ${ g.eta.toFixed( 3 ) } m vs the CPU's ${ r.eta.toFixed( 3 ) } m)` );
		assert.ok( out[ name ].volumeError < 1e-3, `${ name }: water volume within 0.1 % of the CPU's (${ out[ name ].volumeError.toExponential( 2 ) })` );

	}
	console.log( JSON.stringify( out ) );
	// a tornado's wind stress is not on the GPU: the grids go back to the host, which steps on from the last readback
	const before = gpu.water.time;
	gpu.start( 'tornado', { ...DEFAULTS.tornado } );
	assert.equal( gpu.gpuWater, null, 'a tornado moves the water back to the CPU grid' );
	gpu.advance( FRAME );
	assert.ok( gpu.water.time > before, `the host grid steps on after the hand-back (${ before.toFixed( 2 ) } -> ${ gpu.water.time.toFixed( 2 ) } s)` );
	gpu.stop();
	assert.equal( gpu.gpuWater, null, 'stop releases the GPU grids' );

} );
