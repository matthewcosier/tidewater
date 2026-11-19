import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Player } from '../src/player/Player.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { DisasterField } from '../src/disasters/Field.js';
import {tornadoLifecycle} from '../src/disasters/TornadoFunnel.js'; // the mature stage starts when the seeded genesis ends
import { Vector3, PerspectiveCamera } from '../src/engine/index.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { SkinnedModel } from '../src/engine/render/Skinning.js';
import { StorageBuffer } from '../src/engine/gpu/Texture.js';

StorageBuffer.prototype.write = function ( data ) { this.pendingData = data.slice(); };
const bytes = await readFile( new URL( '../public/models/characters/player.glb', import.meta.url ) );
const source = parseGLB( bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ) );

const DT = 1 / 60; // s, the player's ordinary frame
const STOP = 6; // s, the field stops, as in test/articulated-solver.mjs
const RUN = 12; // s, every burial seen in the sweep happened before 9 s
const MAX_BURIAL = 0.02; // m
const SEEDS = [ 1, 2, 3, 4, 5, 6, 7, 8 ];
const at = new Vector3();
const SITE = { x: 53.6, z: - 77 }; // m

function fixture( seed ) {
	const model = new SkinnedModel( source ), terrain = new TerrainData();
	const player = new Player( { camera: new PerspectiveCamera(), input: { down: () => false, hit: () => false }, terrain, colliders: new Colliders(), query: { allocate: () => 0 } } );
	model.play( 'idle', { fade: 0 } );
	model.update( 0 );
	player.position.set( SITE.x, 0, SITE.z );
	player.position.y = terrain.heightAt( player.position.x, player.position.z );
	model.group.position.copy( player.position );
	player.avatar = { model, group: model.group, idle: model.layers[ 0 ] };
	// The slider's maximum, 20 m upwind: the same severe case as the articulated-solver fixture.
	const field = new DisasterField( ( x, z ) => terrain.heightAt( x, z ) );
	const e = field.start( 'tornado', { x: player.position.x - 20, z: player.position.z, intensity: 120, radius: 180, speed: 0, duration: 40, seed } );
	e.time = tornadoLifecycle( e, {} ).genesis + 1.2; // 1.2 s into the mature stage
	assert.equal( player.ragdoll( null, null, { velocity: new Vector3(), spin: new Vector3() } ), true );
	player.rag.disasterField = field;
	return { rig: player.rag, terrain, field };
}

for ( const seed of SEEDS ) test( `A 120 m/s tornado leaves no ragdoll limb buried in the terrain (seed ${seed})`, ( t ) => {
	const { rig, terrain, field } = fixture( seed );
	let worst = { depth: - Infinity }, stopped = false;
	for ( let frame = 0; frame < RUN / DT; frame ++ ) {
		if ( ! stopped && frame * DT >= STOP ) { field.stop(); stopped = true; }
		field.advance( DT );
		rig.update( DT );
		for ( const b of rig.bodies ) for ( const sample of b.samples ) {
			at.set( sample.x, sample.y, sample.z ).applyQuaternion( b.q ).add( b.x );
			const depth = terrain.heightAt( at.x, at.z ) + b.r - at.y; // m below the terrain
			if ( depth > worst.depth ) worst = { depth, body: b.name, time: frame * DT };
		}
	}
	t.diagnostic( `seed ${seed}: deepest ${worst.body} ${( worst.depth * 100 ).toFixed( 2 )} cm at ${worst.time.toFixed( 2 )} s` );
	assert.ok( worst.depth < MAX_BURIAL, `seed ${seed}: ${worst.body} ${( worst.depth * 100 ).toFixed( 1 )} cm into the terrain at ${worst.time.toFixed( 2 )} s (bound ${MAX_BURIAL * 100} cm)` );
} );
