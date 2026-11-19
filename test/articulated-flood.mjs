// The people's ragdolls in a real 10 m tsunami flood (seed 7, the island's terrain, the real field and its
// second-order water grid), solved by real workers and by the serial solver.
//
// In the game the GPU water solver delivers its readback into the host grid whenever the mapping resolves
// (src/disasters/WaterGridGPU.js readback). A frame that runs in one task never sees one land mid-frame; a frame
// that waits for the ragdoll workers does. Each landing stepped the grid's version, and the pool threw away every
// result in flight as stale (`grid=false`), so in a flood the ferry crowd's rigs were solved twice a frame: once in
// a worker and again on the main thread (CPU profile, 10 m tsunami, flood on land: 35.5 ms a frame of
// Ragdoll.simulate on the main thread, 1,319 of 2,929 results discarded, every one for that reason).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { Player } from '../src/player/Player.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';
import { WaterGridGPU } from '../src/disasters/WaterGridGPU.js';
import { Vector3, PerspectiveCamera } from '../src/engine/index.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { SkinnedModel } from '../src/engine/render/Skinning.js';
import { StorageBuffer } from '../src/engine/gpu/Texture.js';
import { RagdollPool } from '../src/player/workers/RagdollPool.js';
import { Ragdoll as AllocatingRagdoll } from './reference/PreScratchRagdoll.js';
import { Session } from 'node:inspector/promises';

StorageBuffer.prototype.write = function ( data ) { this.pendingData = data.slice(); };
globalThis.GPUMapMode ??= { READ: 1 };
const bytes = await readFile( new URL( '../public/models/characters/player.glb', import.meta.url ) );
const source = parseGLB( bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ) );
const terrain = new TerrainData(), ground = ( x, z ) => terrain.heightAt( x, z );

// The flood: a 10 m wave, seed 7, run to 3 s after it reaches the village target (40, -25). At (40, -115) the bore
// then stands 4.6 m deep over the ground and runs at 18 m/s: bodies tumble, go under and hit the bed.
const field = new DisasterField( ground );
const wave = field.start( 'tsunami', { ...DEFAULTS.tsunami, intensity: 10, warningLead: 3, seed: 7 } );
while ( wave.time < wave.arrival + 3 ) field.advance( 0.1 );

// A knocked person at x (m) on the flooded bank: the player's own rig (the solver every person uses).
function knocked( x, Solver = null ) {

	const model = new SkinnedModel( source ), player = new Player( { camera: new PerspectiveCamera(), input: { down: () => false, hit: () => false }, terrain, colliders: new Colliders(), query: { allocate: () => 0 } } );
	model.play( 'idle', { fade: 0 } ); model.update( 0 );
	player.position.set( x, terrain.heightAt( x, - 115 ), - 115 ); model.group.position.copy( player.position );
	player.avatar = { model, group: model.group, idle: model.layers[ 0 ] };
	if ( Solver ) player.rag = new Solver( player );
	player.colliders.addBox( new Vector3( x + .7, player.position.y + .1, - 115 ), new Vector3( .3, .2, 2 ), .3, { walkable: true } );
	assert.equal( player.ragdoll( null, null, { velocity: new Vector3( 2, - 1, 3 ), spin: new Vector3( 1, 0, 2 ) } ), true );
	const rig = player.rag;
	rig.player.reef = null; rig.disasterField = field;
	return { rig, person: { knock: { rag: { rd: rig } } } };

}

class BrowserWorker {

	constructor() {

		const script = `import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:m=>parentPort.postMessage(m)};await import(${ JSON.stringify( new URL( '../src/player/workers/RagdollWorker.js', import.meta.url ).href ) });parentPort.on('message',data=>self.onmessage({data}));`;
		this.node = new NodeWorker( new URL( 'data:text/javascript,' + encodeURIComponent( script ) ), { type: 'module' } ); this.listeners = new Map();

	}
	addEventListener( type, fn ) { const f = type === 'message' ? data => fn( { data } ) : error => fn( { message: error.message } ); this.listeners.set( fn, f ); this.node.on( type, f ); }
	removeEventListener( type, fn ) { this.node.off( type, this.listeners.get( fn ) ); this.listeners.delete( fn ); }
	postMessage( message ) { this.node.postMessage( message ); }
	terminate() { this.node.terminate(); }

}

// The GPU solver's readback, landing while the frame waits: the real WaterGridGPU.readback on a mapped buffer that
// holds newer water (the host's own field 2 cm higher and 1 % faster, as a later GPU step would differ from it).
// The host arrays it overwrites are put back after the frame, so the CPU flood itself runs on unchanged.
function gpuTwin( grid ) {

	const twin = Object.assign( Object.create( WaterGridGPU.prototype ), { grid, N: grid.n * grid.n, epoch: 0, rate: 1, readbacks: 0 } );
	const range = new ArrayBuffer( twin.N * 16 + 16 ), data = new Float32Array( range, 0, twin.N * 4 );
	const saved = { pixels: new Float32Array( grid.pixels.length ), h: new Float32Array( grid.h.length ), qx: new Float32Array( grid.qx.length ), qz: new Float32Array( grid.qz.length ) };
	return {
		twin,
		land() {

			for ( const k of [ 'pixels', 'h', 'qx', 'qz' ] ) saved[ k ].set( grid[ k ] );
			for ( let k = 0; k < twin.N; k ++ ) { data[ k * 4 ] = grid.pixels[ k * 4 ] + .02; data[ k * 4 + 1 ] = grid.pixels[ k * 4 + 1 ] * 1.01; data[ k * 4 + 2 ] = grid.pixels[ k * 4 + 2 ] * 1.01; data[ k * 4 + 3 ] = grid.pixels[ k * 4 + 3 ] > 0 ? grid.pixels[ k * 4 + 3 ] + .02 : 0; }
			new Float32Array( range, twin.N * 16, 1 )[ 0 ] = 1;
			twin.readback( { busy: false, buffer: { mapAsync: () => Promise.resolve(), getMappedRange: () => range, unmap() {} } } );
			return twin.pending;

		},
		restore() { for ( const k of [ 'pixels', 'h', 'qx', 'qz' ] ) grid[ k ].set( saved[ k ] ); },
	};

}

const pose = rig => rig.bodies.map( b => [ b.x.x, b.x.y, b.x.z, b.q.x, b.q.y, b.q.z, b.q.w, b.v.x, b.v.y, b.v.z, b.w.x, b.w.y, b.w.z ] );
// frames of 1/40 s (the disaster step cap), with a 0.1 s frame (a tab come back) and a 0.008 s one (a 120 Hz display)
const STEPS = [ 0.025, 0.025, 0.1, 0.025, 0.008, 0.025, 1 / 60, 0.025, 0.025, 0.025, 0.025, 0.025 ];

test( 'In a flood a knocked person\'s ragdoll is solved once a frame, by a worker, to the same motion as the serial solver', async () => {

	// Two people in the pool (a batch of one is not sent) and their serial twins, started identically.
	const people = [ knocked( 40 ), knocked( 44 ) ], twins = [ knocked( 40 ), knocked( 44 ) ];
	const gpu = gpuTwin( field.water ), pool = new RagdollPool( { size: 2, createWorker: () => new BrowserWorker(), timeout: 20000 } );
	let compared = 0, moved = 0;
	const differ = [];
	try {

		for ( const dt of STEPS ) {

			field.advance( dt );
			field.gpuWater = gpu.twin;
			const before = people[ 0 ].rig.pelvis.x.x, pending = pool.prepare( people.map( p => p.person ), dt, field );
			assert.ok( pending, 'two knocked people in the flood go to the workers' );
			// The serial solve of the same interval, against the water the frame started with.
			for ( const t of twins ) t.rig.simulate( dt );
			await gpu.land();
			await pending;
			for ( const p of people ) p.rig.update( dt );
			for ( let i = 0; i < people.length; i ++ ) {

				assert.ok( Math.abs( people[ i ].rig.stats.consumedTime - twins[ i ].rig.stats.consumedTime ) < 1e-12, `person ${ i } solved exactly once for the interval: ${ people[ i ].rig.stats.consumedTime } s against ${ twins[ i ].rig.stats.consumedTime } s` );
				const got = pose( people[ i ].rig ), want = pose( twins[ i ].rig );
				if ( JSON.stringify( got ) !== JSON.stringify( want ) ) differ.push( { person: i, dt, got, want } );
				compared ++;

			}
			moved = Math.max( moved, Math.abs( people[ 0 ].rig.pelvis.x.x - before ) / dt );
			field.gpuWater = null;
			gpu.restore();

		}

	} finally { for ( const w of pool.workers ) w.terminate(); field.gpuWater = null; }
	const share = pool.stats.accepted / pool.stats.dispatched;
	assert.ok( moved > 1, `the water carries the body: pelvis speed up to ${ moved.toFixed( 2 ) } m/s` );
	assert.ok( share > 0.9, `the pool accepts over nine tenths of what it sends while readbacks land: ${ pool.stats.accepted } of ${ pool.stats.dispatched } (${ ( 100 * share ).toFixed( 0 ) } %), last fallback: ${ pool.stats.lastFallback }` );
	assert.equal( compared, 2 * STEPS.length );
	assert.deepEqual( differ[ 0 ]?.got, differ[ 0 ]?.want, `${ differ.length } of ${ compared } solves differ from the serial solve of the same interval (first: person ${ differ[ 0 ]?.person }, a ${ differ[ 0 ]?.dt } s frame)` );

} );

test( 'A write to the water inside the frame still sends the interval to the serial solver, exactly once', async () => {

	const people = [ knocked( 40 ), knocked( 44 ) ], pool = new RagdollPool( { size: 2, createWorker: () => new BrowserWorker(), timeout: 20000 } );
	try {

		field.advance( 0.025 );
		const spent = people.map( p => p.rig.stats.consumedTime ), pending = pool.prepare( people.map( p => p.person ), 0.025, field );
		assert.ok( pending );
		// a host write between dispatch and the barrier (an impulse or a launch packs the host grid: WaterGrid.pack)
		field.water.version ++;
		await pending;
		for ( const p of people ) p.rig.update( 0.025 );
		assert.equal( pool.stats.accepted, 0, `results computed before the write are not used: ${ pool.stats.accepted } accepted` );
		assert.equal( pool.stats.fallback, 2 );
		people.forEach( ( p, i ) => assert.ok( Math.abs( p.rig.stats.consumedTime - spent[ i ] - 0.025 ) < 1e-12, `person ${ i } solved the 0.025 s interval once: ${ p.rig.stats.consumedTime - spent[ i ] } s` ) );

	} finally { for ( const w of pool.workers ) w.terminate(); }

} );

test( 'The allocation-free solver carries a person through the flood bit for bit as the allocating solver did', () => {

	// The same person twice: one on the live solver, one on the solver as it was before its scratch storage.
	const live = knocked( 40 ), old = knocked( 40, AllocatingRagdoll );
	const seen = { frames: 0, substeps: 0, self: 0, retries: 0, protected: 0, depth: 0 };
	for ( let k = 0; k < 3 * STEPS.length; k ++ ) {

		const dt = STEPS[ k % STEPS.length ];
		field.advance( dt );
		live.rig.update( dt ); old.rig.update( dt );
		assert.deepEqual( pose( live.rig ), pose( old.rig ), `frame ${ k } (${ dt } s): every body's position, orientation and velocity as before` );
		for ( const key of [ 'substeps', 'consumedTime', 'selfContacts', 'forceRetries', 'protectionCount', 'protectionEnergy', 'maxNearTravelRatio', 'maxIntegratedAngle', 'hinge', 'swing', 'twist', 'clearance' ] ) assert.equal( live.rig.stats[ key ], old.rig.stats[ key ], `frame ${ k }: stats.${ key } ${ live.rig.stats[ key ] } as before ${ old.rig.stats[ key ] }` );
		assert.equal( live.rig.phase, old.rig.phase );
		seen.frames ++; seen.substeps += live.rig.stats.substeps; seen.self += live.rig.stats.selfContacts; seen.retries = live.rig.stats.forceRetries; seen.protected = live.rig.stats.protectionCount;
		seen.depth = Math.max( seen.depth, live.rig.waterY - live.rig.pelvis.x.y );

	}
	// The flood exercised the paths that changed: substeps, self contacts between limbs, the body under water.
	assert.ok( seen.self > 0 && seen.depth > 1, `the tumble reaches self contacts and deep water: ${ JSON.stringify( seen ) }` );

} );

// Bytes a call allocates under the solver's own files, by V8's sampling heap profiler with garbage counted
// (as test/frame-garbage.mjs measures the expansion systems).
const LIVE = [ 'src/player/Ragdoll.js', 'src/player/JointVelocity.js', 'src/player/ArticulatedMass.js', 'src/people/ArticulatedContacts.js' ];
const FROZEN = [ 'test/reference/PreScratchRagdoll.js', 'test/reference/PreScratchJointVelocity.js', 'test/reference/PreScratchArticulatedMass.js', 'src/people/ArticulatedContacts.js' ];
async function solverBytes( call, calls, files ) {

	for ( let i = 0; i < 200; i ++ ) call( i );
	const session = new Session();
	session.connect();
	await session.post( 'HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true } );
	for ( let i = 0; i < calls; i ++ ) call( i );
	const { profile } = await session.post( 'HeapProfiler.stopSampling' );
	session.disconnect();
	const by = {};
	const walk = node => { const f = files.find( f => node.callFrame.url.endsWith( f ) ); if ( f && node.selfSize ) { const k = node.callFrame.functionName + ' ' + f.split( '/' ).pop() + ':' + ( node.callFrame.lineNumber + 1 ); by[ k ] = ( by[ k ] || 0 ) + node.selfSize / calls; } for ( const c of node.children ) walk( c ); };
	walk( profile.head );
	return { total: Object.values( by ).reduce( ( a, b ) => a + b, 0 ), by };

}

test( 'The ragdoll solver makes under half the garbage it made in a flood interval', async () => {

	// The same person on the live solver and on the allocating one, each stepped 0.025 s at a time in the flood.
	const live = knocked( 44 ).rig, old = knocked( 44, AllocatingRagdoll ).rig;
	const now = await solverBytes( () => live.simulate( 0.025 ), 400, LIVE ), before = await solverBytes( () => old.simulate( 0.025 ), 400, FROZEN );
	// What is left are boxed doubles: V8 returns a double from a call it did not inline in a heap number, and
	// simulate is too large for it to inline its small helpers (wPos, invI, dot). Measured 651 KB against 1.87 MB
	// for the allocating solver (with the capsule narrow phase already shared); removing them needs the bodies'
	// state in typed arrays or smaller substep functions, not more scratch objects.
	assert.ok( now.total < before.total / 2, `one 0.025 s interval allocated ${ now.total.toFixed( 0 ) } bytes in the solver against ${ before.total.toFixed( 0 ) } before: ${ JSON.stringify( now.by ) }` );

} );
