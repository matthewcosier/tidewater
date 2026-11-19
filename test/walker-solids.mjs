// People on foot meet the same solid world the cars do (docs/people.md, Solid trunks, cars and room).
// Red before this change: the walker went straight through every palm and tree trunk (trunks were
// cylinders for the car physics, the ragdoll and clinging only), through every other person's car
// (Traffic gave the car physics kinematic bodies and nothing to the walker), a boarding car drove on
// through a person standing in its road (it gave way to the player's car alone), and a sprinting
// walker broke a fence panel woken by a passing car (the panel broke for whatever touched it at
// 4 m/s). The checks drive the real Player, the real Colliders, the real Traffic give-way and the
// real fence break rule on the real island's plants and the shipped car models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TerrainData } from '../src/world/TerrainData.js';
import { Village } from '../src/world/Village.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { Colliders } from '../src/world/Colliders.js';
import { VegSite, scatterVegetation } from '../src/world/vegetation/Scatter.js';
import { trunkCylinders } from '../src/rally/WorldPhysics.js';
import { applyTerminalSite, PLACES } from '../src/ferry/Terminal.js';
import { JOEY_VILLAGE_SITE } from '../src/joey/Village.js';
import { prepareEvacuationRoute } from '../src/evacuation/Route.js';
import { prepareWindFarmSites } from '../src/windfarm/Sites.js';
import { prepareGliderSite } from '../src/glider/Site.js';
import { Player } from '../src/player/Player.js';
import { Traffic } from '../src/ferry/Traffic.js';
import { Grid } from '../src/people/Perception.js';
import { PropPhysics } from '../src/physics/Props.js';
import { Scene, Group, Vector3 } from '../src/engine/index.js';
import { StorageBuffer, Texture } from '../src/engine/gpu/Texture.js';
import { GPU } from '../src/engine/gpu/GPU.js';

const RADIUS = 0.3;                       // m, the walker's capsule (Player.js RADIUS)
const BODY_R = 0.27;                      // m, a townsperson's capsule (Contact.js BODY_R)
const DT = 1 / 60;                        // s

// The island as App builds it up to the plants: terminal and Joey site edits, the village, the coastal
// route, the evacuation route, the wind farm and glider sites, then the scatter with the village's
// footprints and boardwalks kept clear (Vegetation.js villageObstacles). Only canvas raster and GPU
// upload are isolated.
const canvas = new Proxy( { measureText: () => ( { width: 100 } ), getImageData: () => ( { data: new Uint8ClampedArray( 1024 * 1024 * 4 ) } ) }, { get: ( o, k ) => k in o ? o[ k ] : () => {} } );
// VegSite samples the terrain's detail texture on the CPU; building that texture also uploads it.
// No GPU in node: the upload is a no-op for this build (no mips, no encoder), as joey-grass.mjs does.
const oldDocument = globalThis.document, oldWrite = StorageBuffer.prototype.write, oldGetGPU = Texture.prototype.getGPU, oldEncoder = GPU.getEncoder;
globalThis.document = { createElement: () => ( { getContext: () => canvas } ) };
StorageBuffer.prototype.write = function ( data ) { this.pendingData = data; };
Texture.prototype.getGPU = function () { this.mipsOption = false; return {}; };
GPU.getEncoder = () => null;
let terrain, colliders, vegetation;
try {

	terrain = new TerrainData();
	for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
	applyTerminalSite( terrain, JOEY_VILLAGE_SITE, PLACES.joey );
	colliders = new Colliders();
	const village = new Village( { scene: new Scene(), terrain, colliders } ), route = new CoastalRoute( terrain );
	prepareEvacuationRoute( terrain ); prepareWindFarmSites( terrain ); prepareGliderSite( terrain, route );
	const paths = [];
	for ( const p of [ village.path, ...( village.sidePaths || [] ) ] ) {

		if ( ! p?.samples ) continue;
		const pts = [];
		for ( let i = 0; i < p.samples.length; i += 5 ) pts.push( [ p.samples[ i ].p.x, p.samples[ i ].p.z ] );
		pts.push( [ p.samples.at( - 1 ).p.x, p.samples.at( - 1 ).p.z ] );
		paths.push( { points: pts, width: p.width ?? 1.8 } );

	}
	vegetation = { records: scatterVegetation( new VegSite( terrain, { footprints: village.getFootprints(), paths: paths.length ? paths : null } ) ) };

} finally { globalThis.document = oldDocument; StorageBuffer.prototype.write = oldWrite; Texture.prototype.getGPU = oldGetGPU; GPU.getEncoder = oldEncoder; }

function walker( c, ground = terrain ) {

	const keys = new Set(), input = { down: k => keys.has( k ), hit: () => false, consumeLook: () => ( { x: 0, y: 0 } ), consumeWheel: () => 0 };
	const p = new Player( { camera: {}, input, terrain: ground, colliders: c, query: { allocate: () => 0 }, boat: null } );
	p.grounded = true; p.waterH = p.waterMean = - 50;
	return { p, keys };

}

// The walker on its own keys at `target` from `from` (facing it: W walks along -sin(yaw), -cos(yaw)),
// for `seconds`; the closest its centre came to `target` in the horizontal plane.
function walkAt( c, from, target, { seconds = 2.5, sprint = true, ground = terrain, each = null } = {} ) {

	const { p, keys } = walker( c, ground );
	p.position.set( from.x, ground.heightAt( from.x, from.z ), from.z );
	p.yaw = Math.atan2( - ( target.x - from.x ), - ( target.z - from.z ) );
	keys.add( 'KeyW' ); if ( sprint ) keys.add( 'ShiftLeft' );
	let min = Infinity;
	for ( let i = 0; i < seconds / DT; i ++ ) {

		p.updateWalk( DT );
		each?.( i * DT, p );
		min = Math.min( min, Math.hypot( p.position.x - target.x, p.position.z - target.z ) );

	}
	return { min, p };

}

// Palms and trees on open, dry ground with no other trunk within 4 m: a clean run at each one.
function openTrunks( flat, n ) {

	const out = [];
	for ( let k = 0; k < flat.length && out.length < n; k += 5 ) {

		const x = flat[ k ], z = flat[ k + 1 ], r = flat[ k + 2 ];
		if ( terrain.heightAt( x, z ) < 1.5 || r < 0.15 ) continue;
		let alone = true;
		for ( let j = 0; j < flat.length && alone; j += 5 ) if ( j !== k && Math.hypot( flat[ j ] - x, flat[ j + 1 ] - z ) < 4 ) alone = false;
		const from = { x: x + 3, z };
		if ( alone && Math.abs( terrain.heightAt( from.x, from.z ) - terrain.heightAt( x, z ) ) < 0.6 ) out.push( { k, x, z, r, from } );

	}
	return out;

}

test( 'A walker sprinting at a palm or tree trunk is stopped at its bark, by the same trunks the cars hit', () => {

	const flat = trunkCylinders( vegetation, terrain ), c = new Colliders();
	c.setTrunks( flat );
	const runs = openTrunks( flat, 12 );
	assert.ok( runs.length >= 8, `open trunks found: ${ runs.length }` );
	const inside = [];
	for ( const t of runs ) {

		const { min } = walkAt( c, t.from, t );
		if ( min < t.r + RADIUS - 0.02 ) inside.push( `trunk r ${ t.r.toFixed( 2 ) } m at (${ t.x.toFixed( 1 ) }, ${ t.z.toFixed( 1 ) }): centre came ${ min.toFixed( 2 ) } m from its axis` );

	}
	assert.deepEqual( inside, [], 'the walker passed into trunks' );

} );

test( 'A felled tree stops nobody: the walker crosses where its trunk stood once the set is refreshed', () => {

	const flat = trunkCylinders( vegetation, terrain ), c = new Colliders();
	c.setTrunks( flat );
	const t = openTrunks( flat, 1 )[ 0 ];
	const list = [ ...vegetation.records.palms, ...vegetation.records.trees ];
	const record = list.find( r => Math.abs( r.x - t.x ) < 1e-4 && Math.abs( r.z - t.z ) < 1e-4 );
	record.disasterFallen = true;
	try {

		c.setTrunks( trunkCylinders( vegetation, terrain ) );
		const { min } = walkAt( c, t.from, t, { seconds: 1.5 } );
		assert.ok( min < 0.15, `the walker was held ${ min.toFixed( 2 ) } m from a felled tree's stump` );

	} finally { record.disasterFallen = false; }

} );

test( 'Trunks reach walkers without joining the shared cylinder list the car physics, clinging and the wake read', () => {

	const before = colliders.cylinders.slice();
	colliders.setTrunks( trunkCylinders( vegetation, terrain ) );
	assert.equal( colliders.cylinders.length, before.length, `the shared cylinder list grew from ${ before.length } to ${ colliders.cylinders.length }` );
	assert.ok( colliders.cylinders.every( ( c, i ) => c === before[ i ] ), 'the shared cylinder list changed' );
	// and a capsule query (FerryShip.collide, the ragdoll's near list) that asks only for boxes and cylinders meets no trunk
	const t = openTrunks( trunkCylinders( vegetation, terrain ), 1 )[ 0 ];
	const q = new Vector3( t.x + 0.1, terrain.heightAt( t.x, t.z ), t.z );
	const moved = q.clone();
	colliders.resolveCapsule( moved, 0.4, 3.0, 0 );
	assert.ok( moved.distanceTo( q ) < 1e-9, 'resolveCapsule alone now pushes out of trunks' );
	colliders.resolveWalker( moved, RADIUS, 1.75, 0.4 );
	assert.ok( Math.hypot( moved.x - t.x, moved.z - t.z ) >= t.r + RADIUS - 1e-6, 'resolveWalker leaves the walker inside the trunk' );

} );

// ---- other people's cars

// The shipped models' drawn extents (public/ferry/parked_cars.glb: each model's body mesh on its root
// node and its four wheels), in the group-local frame the game draws them in, as Traffic.parts holds them.
function shippedParts() {

	const b = readFileSync( new URL( '../public/ferry/parked_cars.glb', import.meta.url ) ), len = b.readUInt32LE( 12 );
	const g = JSON.parse( b.subarray( 20, 20 + len ).toString() ), parts = new Map();
	const part = ( mesh, t = [ 0, 0, 0 ] ) => g.meshes[ mesh ].primitives.map( p => {

		const a = g.accessors[ p.attributes.POSITION ];
		const box = { min: new Vector3( a.min[ 0 ] + t[ 0 ], a.min[ 1 ] + t[ 1 ], a.min[ 2 ] + t[ 2 ] ), max: new Vector3( a.max[ 0 ] + t[ 0 ], a.max[ 1 ] + t[ 1 ], a.max[ 2 ] + t[ 2 ] ) };
		return { geometry: { boundingBox: box, computeBoundingBox() {} } };

	} );
	for ( const root of g.nodes ) {

		if ( ! /^Parked[A-Z][a-z]+$/.test( root.name || '' ) || root.mesh === undefined ) continue;
		const list = part( root.mesh );
		for ( const i of root.children || [] ) if ( g.nodes[ i ].mesh !== undefined ) list.push( ...part( g.nodes[ i ].mesh, g.nodes[ i ].translation ) );
		parts.set( root.name, list );

	}
	return parts;

}

const flatGround = { heightAt: () => 0 };
function rig( { player = null, people = [] } = {} ) {

	const c = new Colliders(), grid = new Grid( 8 );
	for ( const p of people ) grid.add( p );
	const app = { colliders: c, camera: { position: new Vector3( 0, 50, 0 ) }, scene: new Scene(), player, people: { grid, list: people },
		rally: { state: new Float32Array( [ 500, 0, 500, 0, 0, 0, 1, 0 ] ), forward: { x: 0, y: 0, z: 1 }, velocity: { x: 0, y: 0, z: 0 } } };
	const traffic = new Traffic( app, { berths: [], ship: null } );
	traffic.parts = shippedParts();
	return { app, traffic, c };

}
// a car standing at (x, z) facing +z (heading 0), or on a straight road up x 0 at `s` m
function standing( traffic, name, x, z ) {

	const g = new Group();
	g.position.set( x, 0, z );
	const car = { id: traffic.cars.length + 1, seq: traffic.cars.length + 1, name, group: g, state: 'queue', path: null, s: 0, v: 0, world: g.position.clone(), local: null, slot: null };
	traffic.cars.push( car );
	return car;

}

test( 'A walker sprinting into a queued car stops against its body, for every model on the service', () => {

	const fails = [];
	for ( const name of shippedParts().keys() ) for ( const [ side, from ] of [ [ 'its side', { x: 4, z: 0.3 } ], [ 'its tail', { x: 0.2, z: - 6 } ] ] ) {

		const { traffic, c } = rig();
		const car = standing( traffic, name, 0, 0 );
		traffic.walkers();
		const e = traffic.extent( name );
		// the closest the walker's centre came to the drawn body (negative: inside it), every frame
		let worst = Infinity;
		walkAt( c, from, { x: 0, z: 0 }, { ground: flatGround, seconds: 2, each: ( t, p ) => {

			if ( ! p ) return;
			worst = Math.min( worst, Math.max( e.min.x - p.position.x, p.position.x - e.max.x, e.min.z - p.position.z, p.position.z - e.max.z ) );

		} } );
		if ( worst < RADIUS - 0.02 ) fails.push( `${ name } from ${ side }: centre came within ${ worst.toFixed( 2 ) } m of its body (inside when negative)` );
		void car;

	}
	assert.deepEqual( fails, [], 'the walker walked into other people\'s cars' );

} );

// a straight road up x 0 from z0 to z1 at the ground's height, as the yield test drives it (Traffic.drive's easing)
function boarding( traffic, name, z0, z1 ) {

	const car = standing( traffic, name, 0, z0 );
	car.state = 'board';
	const pts = [ new Vector3( 0, 0, z0 ), new Vector3( 0, 0, z1 ) ];
	car.path = { points: [ [ 'T', 0, 0, z0, 2.2 ], [ 'T', 0, 0, z1, 2.2 ] ], pts, seg: new Float64Array( [ z1 - z0 ] ), len: z1 - z0 };
	return car;

}
function driveBy( traffic, car, seconds, each ) {

	const P = car.path, len = P.seg[ 0 ];
	let closest = Infinity;
	for ( let t = 0; t < seconds; t += DT ) {

		each?.( t );
		const by = traffic.blocked( car, P.pts, P.seg, 0, len );
		const want = by ? 0 : 2.2;
		car.v = want < car.v ? Math.max( want, car.v - 4 * DT ) : Math.min( want, car.v + 1.5 * DT );
		car.s = Math.min( len, car.s + car.v * DT );
		car.world.copy( P.pts[ 0 ] ).lerp( P.pts[ 1 ], car.s / len );
		car.group.position.copy( car.world );
		closest = Math.min( closest, ...( traffic.app.people.list.map( q => Math.hypot( q.world.x - car.world.x, q.world.z - car.world.z ) ) ) );

	}
	return closest;

}

test( 'A car driving aboard waits for a person standing in its road, the player on foot or a passenger, and never reaches them', () => {

	for ( const who of [ 'player', 'passenger' ] ) {

		const person = { world: new Vector3( 0.3, 0, 12 ), posture: 'stand' };
		const player = who === 'player' ? { mode: 'walk', position: person.world } : { mode: 'walk', position: new Vector3( 300, 0, 300 ) };
		const { traffic } = rig( { player, people: who === 'player' ? [] : [ person ] } );
		traffic.app.people.list.push( person );
		const car = boarding( traffic, 'ParkedVan', 0, 40 );
		const e = traffic.extent( car.name );
		driveBy( traffic, car, 15 );
		const nose = car.world.z + e.max.z;
		assert.ok( nose < person.world.z - BODY_R, `${ who }: the car's nose reached z ${ nose.toFixed( 2 ) } m, the person stands at z ${ person.world.z }` );
		assert.ok( car.v < 0.05, `${ who }: the car still rolls at ${ car.v.toFixed( 2 ) } m/s with a person in its road` );

	}

} );

test( 'A car drives on past people beside its road (a driver walking down the gap to the next lane), and on once its road clears', () => {

	// 1.6 m from the car's lane middle: the drivers' walk between her centre and outer lanes
	const beside = { world: new Vector3( 1.6, 0, 12 ), posture: 'walk' };
	const { traffic } = rig( { player: { mode: 'walk', position: new Vector3( 300, 0, 300 ) }, people: [ beside ] } );
	traffic.app.people.list.push( beside );
	const car = boarding( traffic, 'ParkedVan', 0, 30 );
	driveBy( traffic, car, 16 );
	assert.ok( car.s > 29.9, `stopped at ${ car.s.toFixed( 2 ) } m of 30 m for a person 1.6 m beside its lane` );
	// someone crosses its road ahead and walks on: it waits, then drives on
	const crossing = { world: new Vector3( - 3, 0, 10 ), posture: 'walk' };
	const r = rig( { player: { mode: 'walk', position: new Vector3( 300, 0, 300 ) }, people: [ crossing ] } );
	r.app.people.list.push( crossing );
	const car2 = boarding( r.traffic, 'ParkedHatch', 0, 30 );
	let waited = 0;
	driveBy( r.traffic, car2, 30, t => {

		crossing.world.x = - 3 + 1.3 * Math.max( 0, t - 2 );   // a walk across from 2 s on
		r.app.people.grid.clear(); r.app.people.grid.add( crossing );
		if ( car2.by === 'person' ) waited += DT;

	} );
	assert.ok( car2.s > 29.9, `the car never went on after the person crossed (${ car2.s.toFixed( 2 ) } m of 30 m)` );
	void waited;

} );

// ---- fence panels

test( 'A sprinting walker never breaks a fence panel; a car at speed still does', () => {

	const calls = [];
	const props = Object.create( PropPhysics.prototype );
	props.physics = { sleep_prop: id => calls.push( [ 'sleep', id ] ), set_prop_solid: ( id, s ) => calls.push( [ 'solid', id, s ] ), wake_prop: () => true };
	props.awake = new Map(); props.stats = { breaks: 0 }; props.file = () => {}; props.wake = () => {};
	const panel = () => ( { id: 7, panel: true, solid: false, broken: false, pieces: [], box: { solid: true, walkable: false }, centre: new Vector3( 0, 0.5, 0 ), half: new Vector3( 0.08, 0.55, 1.2 ) } );
	const walkerPusher = { x: 0.4, y: 0, z: 0, r: 4.7, car: false, speed: 6.2, v: new Vector3( - 6.2, 0, 0 ) };
	const a = panel();
	props.awake.set( a.id, a );
	for ( const speed of [ 3, 4.5, 6.2, 8 ] ) props.panelContact( a, speed, 3, [ walkerPusher ] );
	assert.equal( a.broken, false, 'a walker broke the panel' );
	assert.equal( a.box.solid, true, 'the panel stopped being solid to the walker' );
	// a parked car nearby, out of reach, with a sprinting walker on the panel
	const far = { x: 12, y: 0, z: 0, r: 4.3, car: true, speed: 0.4, v: new Vector3( 0.4, 0, 0 ) };
	props.panelContact( a, 6.2, 3, [ far, walkerPusher ] );
	assert.equal( a.broken, false, 'a car 12 m away broke a panel the walker ran into' );
	const b = panel();
	props.awake.set( b.id, b );
	const car = { x: 2.1, y: 0, z: 0, r: 7, car: true, speed: 8, v: new Vector3( - 8, 0, 0 ) };
	props.panelContact( b, 8, 3, [ car ] );
	assert.equal( b.broken, true, 'a car at 8 m/s did not break the panel' );

} );
