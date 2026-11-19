// Trees and floating debris in a flood (docs/disasters.md, "Trees and floating debris"). A tree the water brings
// down goes over with the flow, floats low in the water that carries it, drifts no faster than that water and never
// flies; a part torn off a building starts at rest. The flood runs are the real island, the real WASM physics, a
// real launched tsunami at the harbour pier and the real tree bodies (test/helpers/flood-island.mjs), one run per
// worker. Every assertion is a physical outcome with the measured value in its message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';
import { Vector3, Quaternion, Group, Scene } from '../src/engine/index.js';
import { StorageBuffer } from '../src/engine/gpu/Texture.js';
import { DisasterBodies } from '../src/disasters/Bodies.js';
import { Disasters } from '../src/disasters/Disasters.js';
import { DisasterField } from '../src/disasters/Field.js';
import { standingMoment } from '../src/disasters/TreeFailure.js';
import { STRUCTURES, StructuralDamage } from '../src/disasters/Structures.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Village } from '../src/world/Village.js';
import { Colliders } from '../src/world/Colliders.js';
import { VegType } from '../src/world/vegetation/InstanceLOD.js';
import { buildPalmNear, buildCanopyNear } from '../src/world/vegetation/PlantGeometry.js';
import { createPlantLeafMaterial } from '../src/world/vegetation/VegMaterials.js';
import { AIR_DENSITY } from '../src/physics/Loads.js';
await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );

const GRAVITY = 9.81; // m/s²
const SEA = 1025; // kg/m³, sea water (src/physics/Loads.js)
const GREEN = { canopy: 850, palms: 700 }; // kg/m³, green wood (src/disasters/TreeMass.js)

// ---- One tree on flat ground: the director's own frame (failure and hinge, loads, native step, pose sync).
const FLAT = 100; // m
function flat( { kind = 'canopy', H = 12.5, water = null } ) {
	const sim = new RallyPhysics();
	sim.set_terrain( new Float32Array( 25 ).fill( FLAT ), 5, 4000, - 2000 );
	sim.reset( 1500, FLAT + 10, 1500, 0 );
	const r = { x: 0, y: FLAT, z: 0, s: H / 12.5, sy: 1, yaw: .4, H, seed: .3, la: 0, l: 0 };
	const geometry = kind === 'palms' ? buildPalmNear().geometry : buildCanopyNear().geometry;
	const type = new VegType( kind, [ r ], { near: [ { geometry, material: createPlantLeafMaterial() } ], fade: [ 100, 110 ] } );
	const vegetation = kind === 'palms' ? { palms: type, records: { palms: [ r ], trees: [] } } : { canopy: type, records: { trees: [ r ], palms: [] } };
	const app = { scene: new Group(), camera: { position: new Vector3( 0, FLAT + 2, 0 ) }, vegetation, terrainData: { heightAt: () => FLAT }, rally: { physics: sim, supports: [], profile: { mass: 1500 }, requestIslandColliders() {} } };
	const field = new DisasterField( () => FLAT );
	if ( water ) field.water = { sample: ( x, z, out = {} ) => Object.assign( out, water ) };
	const owner = { field, runSeed: 11 }, bodies = new DisasterBodies( app, owner );
	const d = { app, field, structures: { bodies: new Map() }, bodies, restored: false, limited: 0, peakForce: 0, rawPeakForce: 0, touched: new Set(), bodyOptions: Disasters.prototype.bodyOptions };
	const frame = dt => { bodies.update( dt ); Disasters.prototype.loads.call( d, dt ); sim.advance( dt, 0, 0, 0, 0 ); bodies.sync( sim.prop_poses() ); };
	return { sim, r, app, field, bodies, d, frame };
}
// The load the director sends to the physics for one body (the seven floats of set_disaster_loads).
function loadOf( f, id, dt ) {
	let seen;
	const bridge = f.sim.set_disaster_loads.bind( f.sim );
	f.sim.set_disaster_loads = loads => { seen = Array.from( loads ); return bridge( loads ); };
	try { Disasters.prototype.loads.call( f.d, dt ); } finally { f.sim.set_disaster_loads = bridge; }
	for ( let i = 0; i < seen.length; i += 7 ) if ( seen[ i ] === id ) return seen.slice( i + 1, i + 7 );
	return null;
}

test( 'A tree the wind fails falls with the wind, even with a cross flow at its foot', () => {
	for ( const kind of [ 'canopy', 'palms' ] ) {
		const f = flat( { kind, water: { height: FLAT + .5, ux: 0, uz: 2, depth: .5 } } );
		try {
			f.field.ambient = () => ( { x: 75, z: 0 } );
			const t = f.bodies.trees[ 0 ];
			for ( let i = 0; i < 600 && ! t.mode; i ++ ) f.frame( 1 / 60 );
			assert.ok( t.mode, `a 75 m/s wind fails the ${ kind } tree` );
			const angle = Math.acos( t.dirX ) * 180 / Math.PI;
			assert.ok( angle <= 30, `the ${ kind } tree the wind failed falls ${ angle.toFixed( 1 ) } deg off the wind` );
		} finally { f.bodies.reset(); f.sim.free(); }
	}
} );

// One set of aerodynamics: the standing tree's horizontal drag is minus the slope of its overturning moment with
// height at the root (every part above pushes with its own force); the body that replaces it must take the same.
test( 'The wind force on a tree does not jump when the solver takes it over', () => {
	for ( const kind of [ 'canopy', 'palms' ] ) {
		const f = flat( { kind, H: kind === 'palms' ? 16 : 12.5 } );
		try {
			assert.equal( f.bodies.fall( f.bodies.trees[ 0 ] ), true );
			const t = f.bodies.trees[ 0 ], b = t.body, U = 30, s = { wx: U, wz: 0, ux: 0, uz: 0, height: 0, shake: 0 };
			const standing = ( standingMoment( t.mass, s, 0, 0 ) - standingMoment( t.mass, s, 0, .01 ) ) / .01;
			f.field.ambient = () => ( { x: U, z: 0 } );
			const load = loadOf( f, b.id, 1 / 60 );
			assert.ok( Math.abs( load[ 0 ] / standing - 1 ) <= .05, `${ kind }: the body takes ${ ( load[ 0 ] / 1000 ).toFixed( 2 ) } kN of wind at ${ U } m/s where the standing tree took ${ ( standing / 1000 ).toFixed( 2 ) } kN (CdA ${ ( load[ 0 ] / ( .5 * AIR_DENSITY * U * U ) ).toFixed( 1 ) } against ${ ( standing / ( .5 * AIR_DENSITY * U * U ) ).toFixed( 1 ) } m²)` );
		} finally { f.bodies.reset(); f.sim.free(); }
	}
} );

// Green wood floats with its density over sea water's share under the surface (Archimedes), lying along it.
test( 'A fallen tree at rest in deep still water floats like green wood, lying along the surface', () => {
	for ( const kind of [ 'canopy', 'palms' ] ) {
		const surface = FLAT + 30, f = flat( { kind, H: 12.5, water: { height: surface, ux: 0, uz: 0, depth: 30 } } );
		try {
			assert.equal( f.bodies.fall( f.bodies.trees[ 0 ] ), true );
			const b = f.bodies.trees[ 0 ].body;
			f.sim.sleep_prop( b.id );
			b.quaternion.setFromAxisAngle( new Vector3( 0, 0, 1 ), Math.PI / 2 );
			b.position.set( 0, surface, 0 );
			f.bodies.spawn( b );
			let wet = 0;
			const load = b.environmentLoad;
			b.environmentLoad = context => { const out = load( context ); wet = out.wet; return out; };
			for ( let i = 0; i < 60 * 40; i ++ ) f.frame( 1 / 60 );
			const expected = GREEN[ kind ] / SEA, tilt = Math.abs( Math.PI / 2 - new Vector3( 0, 1, 0 ).applyQuaternion( b.quaternion ).angleTo( new Vector3( 0, 1, 0 ) ) ) * 180 / Math.PI;
			assert.ok( Math.abs( wet - expected ) <= .05, `${ kind }: ${ ( wet * 100 ).toFixed( 1 )}% of its volume is under water at rest; green wood of ${ GREEN[ kind ] } kg/m³ floats ${ ( expected * 100 ).toFixed( 1 ) }% under` );
			assert.ok( tilt <= 15, `${ kind }: it floats ${ tilt.toFixed( 1 ) } deg off the surface, not along it` );
		} finally { f.bodies.reset(); f.sim.free(); }
	}
} );

// ---- A part torn off a building. The building is static, so the part leaves it at rest; the wind and the water
// that tore it off then load it like any other body (rigidEnvironmentalLoad).
test( 'A part the wind or the flood tears off a building starts with the velocity of the building, at rest', () => {
	const canvas = new Proxy( { measureText: () => ( { width: 100 } ), getImageData: () => ( { data: new Uint8ClampedArray( 1024 * 1024 * 4 ) } ) }, { get: ( o, k ) => k in o ? o[ k ] : () => {} } );
	const oldDocument = globalThis.document, oldWrite = StorageBuffer.prototype.write;
	globalThis.document = { createElement: () => ( { getContext: () => canvas } ) };
	StorageBuffer.prototype.write = function ( data ) { this.pendingData = data; };
	let terrain;
	try { terrain = new TerrainData(); new Village( { scene: new Scene(), terrain, colliders: new Colliders() } ); } finally { globalThis.document = oldDocument; StorageBuffer.prototype.write = oldWrite; }
	const sim = new RallyPhysics();
	try {
		sim.reset( 900, 100, 900, 0 );
		const house = STRUCTURES.find( r => ! /pier|boardwalk/i.test( r.name ) && r.spans.some( s => /roofMetal|thatch/.test( s.member?.material ) ) );
		assert.ok( house, 'the village has a roofed building' );
		const damage = Object.assign( Object.create( StructuralDamage.prototype ), { app: { terrainData: terrain, rally: { physics: sim }, camera: null }, owner: { field: new DisasterField( ( x, z ) => terrain.heightAt( x, z ) ) }, pending: [], bodies: new Map(), records: [], nextId: 700000, clock: 0, releaseCollider: () => false } );
		// The director's own bookkeeping: each span keeps its rest vertices (saveSpan), which the part split reads.
		StructuralDamage.prototype.addRecords.call( damage, [ house ] );
		// The sample the failure is read under: a 50 m/s gale over 2 m of water running at 4 m/s.
		damage.loadSample = { wx: 50, wz: 10, ux: 4, uz: - 1, height: 2 };
		const parts = StructuralDamage.prototype.components.call( damage, house );
		for ( const kind of [ 'roofCover', 'roofFrame', 'wall' ] ) {
			const c = parts.find( p => p.kind === kind );
			if ( ! c ) continue;
			house.onFail( c );
			const e = damage.pending.at( - 1 );
			assert.equal( StructuralDamage.prototype.spawnPiece.call( damage, e ), true, `the ${ kind } spawns a body` );
			const id = damage.nextId - 1, m = sim.disaster_motion();
			let v = null;
			for ( let i = 0; i < m.length; i += 7 ) if ( m[ i ] === id ) v = [ m[ i + 4 ], m[ i + 5 ], m[ i + 6 ] ];
			assert.ok( v && Math.hypot( ...v ) < 1e-6, `the torn-off ${ kind } leaves its building at ${ v?.map( x => x.toFixed( 2 ) ).join( ', ' ) } m/s, not at rest` );
		}
	} finally { sim.free(); }
} );

// ---- The flood on the real island. Two waves, three seeds, the game's 60 Hz frame and a loaded machine's 0.1 s frame
// (which SimulationPacing runs as 0.025 s with three physics steps). Seeds 1 and 2: the wave fails the trees. Seed 3:
// a 48 m/s gale fells trees 30 to 42 s after launch and the wave then takes them; those are judged from 50 s, in the water.
const RUNS = [];
for ( const H of [ 10, 25 ] ) for ( const seed of [ 1, 2, 3 ] ) for ( const frameDt of [ 1 / 60, .1 ] ) RUNS.push( { H, seed, frameDt, gust: seed === 3 ? 48 : 0, judgeFrom: seed === 3 ? 50 : 0 } );
let results;
async function flood() {
	if ( results ) return results;
	const pool = Math.max( 1, Math.min( RUNS.length, Number( process.env.FLOOD_TREE_WORKERS ) || Math.min( 6, availableParallelism() - 2 ) ) );
	const queue = [ ...RUNS ], out = [];
	const next = () => {
		const run = queue.shift();
		if ( ! run ) return Promise.resolve();
		return new Promise( ( resolve, reject ) => {
			const worker = new Worker( new URL( './helpers/flood-island.mjs', import.meta.url ), { workerData: { flood: run } } );
			worker.once( 'message', m => { out.push( m ); worker.terminate(); resolve(); } );
			worker.once( 'error', reject );
		} ).then( next );
	};
	await Promise.all( Array.from( { length: pool }, next ) );
	results = out;
	return out;
}
const label = r => `${ r.H } m wave, seed ${ r.seed }, ${ r.frameDt < .05 ? '60 Hz' : '0.1 s' } frames${ r.gust ? ', after a gale' : '' }`;

test( 'A tree the flood fails goes over with the flow at its root, within 20 s', { timeout: 1_800_000 }, async () => {
	for ( const run of await flood() ) {
		if ( run.gust ) continue;
		// The wind is the 5 m/s breeze: its moment is under 2% of any tree's capacity, so the water failed these.
		const flooded = run.failed.filter( f => f.depth > 0 && f.air < 10 && f.angle !== null );
		assert.ok( flooded.length > 0, `${ label( run ) }: the flood fails trees near the pier` );
		const worst = flooded.reduce( ( a, f ) => f.angle > a.angle ? f : a );
		assert.ok( worst.angle <= 30, `${ label( run ) }: a tree the flood failed falls ${ worst.angle.toFixed( 0 ) } deg off the flow at its root (${ flooded.filter( f => f.angle > 30 ).length } of ${ flooded.length } beyond 30 deg)` );
		const settled = flooded.filter( f => f.age > 20 ), standing = settled.filter( f => ! f.over );
		assert.equal( standing.length, 0, `${ label( run ) }: ${ standing.length } of ${ settled.length } trees the flood failed 20 s or more ago still stand (largest tilt ${ Math.max( 0, ...standing.map( f => f.theta ) ).toFixed( 2 ) } rad)` );
	}
} );

test( 'No tree the flood carries leaves the water, flies or outruns the water, and a beached tree stops', { timeout: 1_800_000 }, async () => {
	for ( const run of await flood() ) {
		assert.ok( run.bodies.length > 0, `${ label( run ) }: trees become bodies near the camera` );
		for ( const b of run.bodies ) {
			// Floating green wood rides at the surface and a fallen trunk lies on the ground: a floating trunk bobs and rolls
			// within its own diameter (0.3 to 0.6 m) and a crushed crown rocks within its crush. Any half metre gained above
			// both the water and the ground it rests at means something threw it.
			assert.ok( b.climbMax <= .5, `${ label( run ) }: tree ${ b.id } climbed ${ b.climbMax.toFixed( 2 ) } m above the water and the ground (${ JSON.stringify( b.climbAt ) })` );
			// Free fall from its own release clearance h takes sqrt(2 h / g); 0.25 s covers the frame cadence of the count.
			const fall = Math.sqrt( 2 * Math.max( 0, b.start ) / GRAVITY ) + .25;
			assert.ok( b.flightMax <= fall, `${ label( run ) }: tree ${ b.id } flew ${ b.flightMax.toFixed( 2 ) } s clear of water and ground; a fall from its ${ b.start.toFixed( 2 ) } m release clearance takes ${ fall.toFixed( 2 ) } s` );
			// Drag pulls a floating tree toward the water's speed and never past it; 10% and 0.5 m/s allow for its inertia
			// in water that slows under it. The flow is the fastest any of its wet points is in.
			assert.ok( b.excess <= 0, `${ label( run ) }: tree ${ b.id } outran the water by ${ b.excess.toFixed( 2 ) } m/s beyond 10% plus 0.5 m/s (${ JSON.stringify( b.excessAt ) })` );
			// Beached, it slides no farther than v² / (2 mu g) with mu 0.5 (bark on soil and sand), plus 1 m.
			assert.ok( b.slideMax <= 1, `${ label( run ) }: tree ${ b.id } slid ${ b.slideMax.toFixed( 2 ) } m beyond its friction stop after beaching` );
		}
	}
} );
