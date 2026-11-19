import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Ragdoll } from '../src/player/Ragdoll.js';
import { Colliders } from '../src/world/Colliders.js';
import { DisasterField } from '../src/disasters/Field.js';
import { WaterGrid } from '../src/disasters/WaterGrid.js';
import { Vector3, Quaternion } from '../src/engine/index.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { SkinnedModel } from '../src/engine/render/Skinning.js';
import { StorageBuffer } from '../src/engine/gpu/Texture.js';

StorageBuffer.prototype.write = function ( data ) { this.pendingData = data.slice(); };
const bytes = await readFile( new URL( '../public/models/characters/player.glb', import.meta.url ) );
const glb = () => parseGLB( bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ) );

const DT = 1 / 60; // s, the player's ordinary frame
const DEPTH = 3; // m of water over a flat bed, sea level 0
const CURRENT = 2; // m/s along +x, uniform: h*u 6 m²/s, ten times the 0.6 m²/s adult stability line
const TRIP = new Vector3( 3.2, 0, 0 ); // m/s: the walk trip's push (TRIP_PUSH 3.2 m/s² over about 1 s), against a still body
const WITHIN = 5;

// a flat-bed field: bed at `bed` (m), sea level 0, a uniform current `u` (m/s) wherever the bed is under water
function flood( bed, u ) {

	const field = new DisasterField( () => bed );
	field.ambient = () => ( { x: 0, z: 0 } );
	field.water = new WaterGrid( () => bed, { n: 41, dx: 8, x: 0, z: 0 } );
	const depth = Math.max( 0, - bed );
	for ( let i = 0; i < field.water.h.length; i ++ ) { field.water.h[ i ] = depth; field.water.qx[ i ] = depth * u; field.water.qz[ i ] = 0; }
	field.water.pack();
	return field;

}

// trip a standing player at (0, feet, 0) into `field`, step the rig as Player.update does in ragdoll mode
// (Disasters.update writes waterY at the focus each frame), and log what the body does
function tumble( bed, feet, field, seconds, each = null ) {

	const model = new SkinnedModel( glb() );
	model.play( 'idle', { fade: 0 } );
	model.update( 0 );
	const rd = new Ragdoll( { terrain: { heightAt: () => bed }, colliders: new Colliders() } );
	assert.ok( rd.start( { model, group: model.group, idle: model.layers[ 0 ] }, new Vector3( 0, feet, 0 ), new Quaternion(), TRIP.clone() ) );
	rd.disasterField = field;
	const log = { phases: [], swimAt: null, getupAt: null, settle: null, x0: rd.pelvis.x.x };
	for ( let frame = 0; frame < seconds / DT; frame ++ ) {

		each?.( frame * DT );
		rd.waterY = field.waterAt( rd.focus.x, rd.focus.z );
		const was = rd.phase;
		if ( was === 'sim' ) log.last = { y: rd.pelvis.x.y, head: rd.head.x.y, water: rd.waterY, x: rd.pelvis.x.x, vx: rd.pelvis.v.x, vy: rd.pelvis.v.y };
		rd.update( DT );
		if ( rd.phase !== was ) {

			log.phases.push( rd.phase );
			if ( was === 'sim' ) log.settle = { t: frame * DT, speed: rd.stats.settleSpeed, head: log.last.head - log.last.water, pelvis: log.last.y - log.last.water, travelled: log.last.x - log.x0, vx: log.last.vx, vy: log.last.vy };
			if ( rd.phase === 'swim' && log.swimAt === null ) log.swimAt = frame * DT;
			if ( rd.phase === 'getup' && log.getupAt === null ) log.getupAt = frame * DT;

		}
		if ( rd.phase === 'done' ) { log.result = { ...rd.result, at: rd.result.at.clone() }; break; }

	}
	log.end = `phase ${rd.phase}, pelvis ${rd.pelvis.x.y.toFixed( 2 )} m at x ${rd.pelvis.x.x.toFixed( 1 )} m, water ${rd.waterY.toFixed( 2 )} m, rest speed ${rd.stats.restSpeed?.toFixed( 2 )} m/s, spin ${rd.stats.restSpin?.toFixed( 2 )} rad/s`;
	return log;

}

test( 'A player tripped into a 2 m/s current 3 m deep floats with it and is swimming within a few seconds', ( t ) => {

	// the trip lands him at chest depth as the flood deepens: feet 1.4 m under the surface, head clear
	const log = tumble( - DEPTH, - 1.4, flood( - DEPTH, CURRENT ), 12 );
	t.diagnostic( `phases ${log.phases.join( ' > ' )}; swim at ${log.swimAt?.toFixed( 2 )} s; settle ${JSON.stringify( log.settle )}; ${log.end}` );
	assert.ok( log.swimAt !== null && log.swimAt < WITHIN, `the tripped body never handed back to swimming within ${WITHIN} s (swim at ${log.swimAt}); ${log.end}` );
	assert.equal( log.getupAt, null, 'a body in 3 m of water started a land get-up' );
	assert.equal( log.result?.water, true, `the recovery ended ${JSON.stringify( log.result )}, not in the water (Player.finishRagdoll then picks walk)` );
	assert.ok( Math.abs( log.settle.vx - CURRENT ) < 0.6, `pelvis at ${log.settle.vx.toFixed( 2 )} m/s along the 2 m/s current at the handover` );
	assert.ok( log.settle.travelled > 0.5 * CURRENT * log.settle.t, `travelled ${log.settle.travelled.toFixed( 2 )} m in ${log.settle.t.toFixed( 2 )} s with a 2 m/s current` );
	assert.ok( log.settle.head > - 0.2, `head centre ${log.settle.head.toFixed( 2 )} m from the surface at the handover` );

} );

const BORE_BED = - 17; // m: the bed under the player's drift path at 120 s was -0.3 to -2.2 m under 16 to 18 m of water
const BORE_U = 6.4; // m/s along +x: the current at the body, 118 to 131 s
const BORE_FALL = 0.95; // m/s: the surface's fall at the body over the same frames

test( 'A player tripped into the receding bore (17 m deep, 6.4 m/s, the surface falling 0.95 m/s) floats down with it and is swimming within a few seconds', ( t ) => {

	const field = flood( BORE_BED, BORE_U );
	const recede = ( time ) => {

		const h = Math.max( 1, - BORE_BED - BORE_FALL * time );
		for ( let i = 0; i < field.water.h.length; i ++ ) { field.water.h[ i ] = h; field.water.qx[ i ] = h * BORE_U; field.water.qz[ i ] = 0; }
		field.water.pack();

	};
	const log = tumble( BORE_BED, - 1.4, field, 12, recede );
	t.diagnostic( `phases ${log.phases.join( ' > ' )}; swim at ${log.swimAt?.toFixed( 2 )} s; settle ${JSON.stringify( log.settle )}; ${log.end}` );
	assert.ok( log.swimAt !== null && log.swimAt < WITHIN, `the tripped body never handed back to swimming within ${WITHIN} s in the receding bore (swim at ${log.swimAt}); ${log.end}` );
	assert.equal( log.getupAt, null, 'a body in 17 m of water started a land get-up' );
	assert.equal( log.result?.water, true, `the recovery ended ${JSON.stringify( log.result )}, not in the water` );
	assert.ok( Math.abs( log.settle.vx - BORE_U ) < 0.6, `pelvis at ${log.settle.vx.toFixed( 2 )} m/s along the ${BORE_U} m/s current at the handover` );
	assert.ok( Math.abs( log.settle.vy + BORE_FALL ) < 0.4, `pelvis at ${log.settle.vy.toFixed( 2 )} m/s vertically with the surface falling ${BORE_FALL} m/s` );
	assert.ok( log.settle.head > - 0.2, `head centre ${log.settle.head.toFixed( 2 )} m from the surface at the handover` );

} );

test( 'A player tripped on dry land gets up and never swims', ( t ) => {

	const log = tumble( 1, 1, flood( 1, CURRENT ), 12 );
	t.diagnostic( `phases ${log.phases.join( ' > ' )}; getup at ${log.getupAt?.toFixed( 2 )} s; ${log.end}` );
	assert.equal( log.swimAt, null, `a body on land handed over to swimming at ${log.swimAt} s` );
	assert.ok( log.getupAt !== null, `a body on land never got up in 12 s; ${log.end}` );
	assert.equal( log.result?.water, false, `the land recovery ended in the water: ${JSON.stringify( log.result )}` );

} );
