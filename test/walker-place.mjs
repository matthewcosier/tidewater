// Every way a person arrives somewhere puts them in the same solid world as walking (docs/people.md, Solid trunks,
// cars and room): out of a car, a bail-out with no body to throw, out of an aircraft or the glider, back on their
// feet after a fall, a teleport, and a swimmer in the flood. Colliders.place pushes the body out of the boxes and
// cylinders, then the trunks, until a pass moves it no more. Before this getting out of a car and the rest resolved
// the boxes only, so a door opened against a palm set the player down inside its trunk, and a swimmer went through
// every trunk in a flooded palm grove. Real terrain at the rally car's spawn, the real Colliders, the real Player,
// RallyDrive.leave, Bailout.start and localAircraftExit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { Player } from '../src/player/Player.js';
import { register } from 'node:module';
register( './style-transport-loader.mjs', import.meta.url );
const { RallyDrive } = await import( '../src/rally/RallyDrive.js' );
import { Bailout } from '../src/rally/Bailout.js';
import { localAircraftExit } from '../src/aviation/OnFootExit.js';
import { PerspectiveCamera, Vector3, Quaternion } from '../src/engine/index.js';

const RADIUS = 0.3;        // m, the player's body (Player.js RADIUS)
const PALM = 0.25;         // m, a palm trunk's radius (WorldPhysics.trunkCylinders: 0.2 to 0.4 m)
const DT = 1 / 60;         // s
const terrain = new TerrainData();
const CAR = { x: - 55, z: - 64 };   // the rally car's spawn (RallyDrive SPAWN): dry ground, open round it

function world( keys = new Set() ) {

	const colliders = new Colliders();
	const input = { down: k => keys.has( k ), hit: () => false, keys: new Set(), pressed: new Set(), consumeLook() {} };
	const player = new Player( { camera: new PerspectiveCamera(), input, terrain, colliders, query: { allocate: () => 0 }, boat: null } );
	return { colliders, player, input };

}

// How far the body at p is from being clear: its deepest overlap with a box (resolveCapsule's push) or a trunk (m).
function overlap( colliders, p, height = 1.8 ) {

	const q = p.clone();
	colliders.resolveCapsule( q, RADIUS - 0.005, height, 0.4 );
	const box = Math.hypot( q.x - p.x, q.z - p.z );
	const T = colliders.trunks || [];
	let trunk = 0;
	for ( let k = 0; k < T.length; k += 5 ) trunk = Math.max( trunk, T[ k + 2 ] + RADIUS - 0.005 - Math.hypot( p.x - T[ k ], p.z - T[ k + 1 ] ) );
	return { box, trunk };

}

test( 'The player leaving a car parked against a palm stands outside the trunk and outside every box on the first frame', () => {

	const fails = [];
	// the car faces +z; its left door (x - 2.2 m) opens onto a palm: alone, then with a wall behind it
	for ( const wall of [ false, true ] ) {

		const { colliders, player, input } = world();
		const y = terrain.heightAt( CAR.x, CAR.z ), door = { x: CAR.x - 2.2, z: CAR.z };
		colliders.addBox( new Vector3( CAR.x, y + 0.8, CAR.z ), new Vector3( 0.96, 0.8, 2.25 ), 0, { tag: 'rally-car' } );   // the car's own walking box
		colliders.setTrunks( [ door.x + 0.1, door.z + 0.05, PALM, y - 1, y + 9 ] );
		if ( wall ) colliders.addBox( new Vector3( door.x - 0.75, y + 1.5, door.z ), new Vector3( 0.2, 1.5, 3 ), 0, { tag: 'wall' } );
		const drive = Object.assign( Object.create( RallyDrive.prototype ), {
			app: { player, terrainData: terrain, colliders, input, engine: { domElement: { focus() {} } } },
			model: { root: { position: new Vector3( CAR.x, y, CAR.z ), quaternion: new Quaternion() } },
			forward: new Vector3( 0, 0, 1 ), restoreLens() {}, refreshUI() {},
		} );
		drive.leave();
		const o = overlap( colliders, player.position ), at = player.position;
		if ( o.trunk > 0.01 || o.box > 0.01 ) fails.push( `${ wall ? 'palm and a wall' : 'palm' }: set down at (${ at.x.toFixed( 2 ) }, ${ at.z.toFixed( 2 ) }), ${ o.trunk.toFixed( 2 ) } m into the trunk and ${ o.box.toFixed( 2 ) } m into a box` );
		if ( Math.hypot( at.x - CAR.x, at.z - CAR.z ) > 4 ) fails.push( `${ wall ? 'palm and a wall' : 'palm' }: set down ${ Math.hypot( at.x - CAR.x, at.z - CAR.z ).toFixed( 1 ) } m from the car` );

	}
	assert.deepEqual( fails, [], 'getting out of the car set the player down inside a solid' );

} );

test( 'Every other way the player arrives on foot (a bail-out with no body to throw, out of an aircraft, back up after a fall, a teleport) sets him outside the trunks and the boxes', () => {

	const fails = [];
	const y = terrain.heightAt( CAR.x, CAR.z ), at = { x: CAR.x + 6, z: CAR.z + 6 };
	const scene = () => {

		const w = world();
		w.colliders.setTrunks( [ at.x + 0.05, at.z, PALM, y - 1, y + 9 ] );
		w.colliders.addBox( new Vector3( at.x - 0.7, y + 1.5, at.z ), new Vector3( 0.2, 1.5, 3 ), 0, { tag: 'wall' } );
		return w;

	};
	const check = ( name, colliders, p ) => {

		const o = overlap( colliders, p );
		if ( o.trunk > 0.01 || o.box > 0.01 ) fails.push( `${ name }: ${ o.trunk.toFixed( 2 ) } m into the trunk, ${ o.box.toFixed( 2 ) } m into a box` );

	};
	// a bail-out while the character is still loading: he steps out beside the car (Bailout.start)
	{

		const { colliders, player } = scene();
		const bail = new Bailout( { player: Object.assign( player, { rag: player.rag || {}, ragdoll: () => false } ), terrainData: terrain, colliders, rally: { trunks: [] } } );
		bail.start( new Vector3( at.x - 0.2, y + 1.5, at.z ), new Vector3( 0, 0, 0 ), new Vector3( 1, 0, 0 ) );
		check( 'bail-out', colliders, player.position );

	}
	// out of an aircraft standing on the ground (localAircraftExit, the glider's and the planes' exit)
	{

		const { colliders, player } = scene();
		const app = { player, colliders, terrainData: terrain };
		const exit = localAircraftExit( app, { position: [ at.x - 2, y, at.z ], quaternion: [ 0, 0, 0, 1 ] }, { sideOffset: 2 } );
		assert.ok( exit, 'no exit found beside an aircraft on dry ground' );
		check( 'aircraft exit', colliders, new Vector3( ...exit.position ) );

	}
	// back on his feet where the ragdoll came to rest (Player.finishRagdoll)
	{

		const { colliders, player } = scene();
		player.rag = { result: { at: new Vector3( at.x, y, at.z ), yaw: 0, water: false }, phase: 'done' };
		player.finishRagdoll();
		check( 'up after a fall', colliders, player.position );

	}
	// a teleport (Player.debugPlace, the probes' and the captures' placement)
	{

		const { colliders, player } = scene();
		player.debugPlace( at.x, y, at.z, 'walk' );
		check( 'teleport', colliders, player.position );

	}
	assert.deepEqual( fails, [], 'a way of arriving on foot set the player down inside a solid' );

} );

test( 'A swimmer swimming at a palm standing in the flood stops at its bark', () => {

	// the sea off the island's west side, 5 m deep; a palm standing in it as one does in a flooded grove
	let x0 = - 420;
	const z0 = - 60;
	while ( x0 > - 900 && terrain.heightAt( x0, z0 ) > - 4 ) x0 -= 10;
	const ground = terrain.heightAt( x0, z0 );
	assert.ok( ground < - 4, `no sea 4 m deep west of the island along z ${ z0 } (${ ground.toFixed( 2 ) } m at x ${ x0 })` );
	const keys = new Set( [ 'KeyW' ] ), { colliders, player } = world( keys );
	const palm = { x: x0 + 3, z: z0 };
	colliders.setTrunks( [ palm.x, palm.z, PALM, ground, 9 ] );
	player.debugPlace( x0, 0, z0, 'swim' );
	player.yaw = - Math.PI / 2;   // facing +x, at the palm
	player.pitch = 0;
	let closest = Infinity;
	for ( let t = 0; t < 6; t += DT ) {

		player.waterH = player.waterMean = 0;
		player.updateSwim( DT );
		closest = Math.min( closest, Math.hypot( player.position.x - palm.x, player.position.z - palm.z ) );

	}
	assert.ok( player.position.x > x0 + 1.5, `the swimmer never swam to the palm (at x ${ ( player.position.x - x0 ).toFixed( 2 ) } m of 3 m)` );
	assert.ok( closest >= PALM + RADIUS - 0.02, `the swimmer's centre came within ${ closest.toFixed( 2 ) } m of the axis of a palm ${ PALM } m in radius (body ${ RADIUS } m)` );

} );
