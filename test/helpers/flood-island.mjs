// The real island in a flood, for test/flood-trees.mjs: the production terrain (with the terminal sites), the
// authored village and its static colliders, the plant scatter, the WASM physics with the whole terrain grid
// (src/rally/WorldPhysics.js uploadTerrain), a launched tsunami on the CPU grid, the real DisasterBodies and the
// real Disasters.prototype.loads, stepped in the game's call order (App: disasters.before, rally.update,
// disasters.after) through the game's own SimulationPacing. Only canvas rasterisation and GPU upload are stubbed,
// as in test/prop-clearance.mjs. Run as a worker (workerData.flood) it posts one run's measurements.
import { readFile } from 'node:fs/promises';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import init, { RallyPhysics } from '../../public/rally/rally_physics.js';
import { Vector3, Quaternion, Group, Scene } from '../../src/engine/index.js';
import { GPU } from '../../src/engine/gpu/GPU.js';
import { StorageBuffer, Texture } from '../../src/engine/gpu/Texture.js';
import { TerrainData } from '../../src/world/TerrainData.js';
import { Village } from '../../src/world/Village.js';
import { CoastalRoute } from '../../src/world/CoastalRoute.js';
import { Colliders } from '../../src/world/Colliders.js';
import { applyTerminalSite, PLACES } from '../../src/ferry/Terminal.js';
import { Evacuation } from '../../src/evacuation/Evacuation.js';
import { prepareWindFarmSites } from '../../src/windfarm/Sites.js';
import { prepareGliderSite } from '../../src/glider/Site.js';
import { VegSite, scatterVegetation } from '../../src/world/vegetation/Scatter.js';
import { VegType } from '../../src/world/vegetation/InstanceLOD.js';
import { buildPalmNear, buildCanopyNear } from '../../src/world/vegetation/PlantGeometry.js';
import { createPlantLeafMaterial } from '../../src/world/vegetation/VegMaterials.js';
import { trunkCylinders, uploadTerrain } from '../../src/rally/WorldPhysics.js';
import { Disasters } from '../../src/disasters/Disasters.js';
import { StructuralDamage } from '../../src/disasters/Structures.js';
import { DisasterBodies } from '../../src/disasters/Bodies.js';
import { DisasterField, DEFAULTS } from '../../src/disasters/Field.js';
import { PropPhysics, PROPS } from '../../src/physics/Props.js';
import { SimulationPacing } from '../../src/core/SimulationPacing.js';

await init( { module_or_path: await readFile( new URL( '../../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );

export const PIER = [ 58, - 46 ]; // m: the panel's Harbour pier target (src/disasters/Controls.js target())
export const CAMERA = [ 50, 20, - 90 ]; // m: over the pier foot, the village within the 300 m near-body range
const NEAR = [ 45, - 80 ], NEAR_RADIUS = 230; // m: the trees a camera there can see as bodies

let site;
export function island() {
	if ( site ) return site;
	const oldDoc = globalThis.document, oldWrite = StorageBuffer.prototype.write, oldTexture = Texture.prototype.getGPU, oldEncoder = GPU.getEncoder;
	const ctx = new Proxy( { measureText: () => ( { width: 100 } ), getImageData: () => ( { data: new Uint8ClampedArray( 1024 * 1024 * 4 ) } ) }, { get: ( o, k ) => k in o ? o[ k ] : () => {} } );
	globalThis.document = { createElement: () => ( { getContext: () => ctx } ) };
	StorageBuffer.prototype.write = function ( data ) { this.pendingData = data; };
	Texture.prototype.getGPU = function () { this.mipsOption = false; return {}; };
	GPU.getEncoder = () => null;
	try {
		const terrain = new TerrainData();
		for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
		const scene = new Scene(), colliders = new Colliders(), village = new Village( { scene, terrain, colliders } ), roads = new CoastalRoute( terrain );
		const app = { terrainData: terrain, colliders, scene, village };
		new Evacuation( app ).build(); prepareWindFarmSites( terrain ); prepareGliderSite( terrain, roads ); new PropPhysics( app ).link( colliders );
		const paths = [];
		for ( const p of [ village.path, ...village.sidePaths ] ) {
			const points = [];
			for ( let i = 0; i < p.samples.length; i += 5 ) points.push( [ p.samples[ i ].p.x, p.samples[ i ].p.z ] );
			const last = p.samples.at( - 1 );
			points.push( [ last.p.x, last.p.z ] );
			paths.push( { points, width: p.width ?? 1.8 } );
		}
		const plants = new VegSite( terrain, { footprints: village.getFootprints(), paths } );
		site = { terrain, colliders, village, records: scatterVegetation( plants ) };
		return site;
	} finally { globalThis.document = oldDoc; StorageBuffer.prototype.write = oldWrite; Texture.prototype.getGPU = oldTexture; GPU.getEncoder = oldEncoder; }
}

// The director over the real classes: the trees near the camera, every static box and cylinder the car physics gets.
export function world( { wreckage = false } = {} ) {
	const { terrain, colliders, village, records } = island();
	const near = r => Math.hypot( r.x - NEAR[ 0 ], r.z - NEAR[ 1 ] ) < NEAR_RADIUS;
	const palms = records.palms.filter( near ).map( r => ( { ...r } ) ), trees = records.trees.filter( near ).map( r => ( { ...r } ) );
	const material = createPlantLeafMaterial();
	const vegetation = {
		palms: new VegType( 'palms', palms, { near: [ { geometry: buildPalmNear().geometry, material } ], fade: [ 100, 110 ] } ),
		canopy: new VegType( 'canopy', trees, { near: [ { geometry: buildCanopyNear().geometry, material } ], fade: [ 100, 110 ] } ),
		records: { palms, trees },
	};
	const sim = new RallyPhysics();
	if ( ! uploadTerrain( sim, terrain ) ) throw new Error( 'the island terrain did not upload' );
	sim.reset( - 900, terrain.heightAt( - 900, 900 ) + 1, 900, 0 );
	const rally = { physics: sim, supports: [], profile: { mass: 1400 }, stale: true, requestIslandColliders() { this.stale = true; } };
	// RallyDrive.refreshIslandColliders: the standing trunks (fallen ones drop out), the boxes and the cylinders.
	rally.refresh = () => {
		rally.stale = false;
		sim.clear_island_statics();
		sim.add_cylinders( trunkCylinders( vegetation, terrain ) );
		const boxes = colliders.boxes.filter( b => ( b.solid || b.walkable ) && ! b.prop );
		sim.add_surface_boxes( new Float32Array( boxes.flatMap( b => [ b.center.x, b.center.y, b.center.z, b.half.x, b.half.y, b.half.z, b.rotY, b.tag.includes( 'pier' ) ? 0.8 : 0.65 ] ) ), new Uint8Array( boxes.length ) );
		sim.add_cylinders( new Float32Array( colliders.cylinders.filter( c => ! c.prop && c.yMax > c.yMin ).flatMap( c => [ c.x, c.z, c.radius, c.yMin, c.yMax ] ) ) );
	};
	rally.refresh();
	const app = { scene: new Group(), terrainData: terrain, colliders, vegetation, camera: { position: new Vector3( ...CAMERA ) }, rally };
	const D = Object.assign( Object.create( Disasters.prototype ), { app, field: new DisasterField( ( x, z ) => terrain.heightAt( x, z ) ), structures: { bodies: new Map() }, external: new Set(), restored: false, paused: false, limited: 0, peakForce: 0, rawPeakForce: 0, touched: new Set() } );
	// With wreckage: the game's own building damage over every authored structure, the loose props (crates, pots, drums,
	// fence panels) the director wakes, and four cars parked on the village path (the terminal cars' record: the
	// terminal's model is not built here).
	if ( wreckage ) {
		D.structures = new StructuralDamage( app, D );
		app.props = new PropPhysics( app );
		app.props.physics = sim;
		rally.supports = [];
	}
	D.bodies = new DisasterBodies( app, D );
	if ( wreckage ) {
		const path = village.path.samples;
		for ( const k of [ .35, .45, .55, .65 ] ) {
			const p = path[ Math.floor( k * ( path.length - 1 ) ) ].p, position = new Vector3( p.x, terrain.heightAt( p.x, p.z ), p.z );
			D.bodies.register( { name: 'Parked terminal car', position, quaternion: new Quaternion(), mass: 1400, half: new Vector3( .95, .75, 2.1 ), height: 1.5, area: 3, volume: 2 } );
		}
	}
	app.disasters = D;
	return { D, sim, app, terrain, rally };
}

const GRAVITY = 9.81; // m/s²
const clamp = ( x, a, b ) => Math.max( a, Math.min( b, x ) );

const NOBODY = []; // no walker or car near the props: only the disaster keeps them awake
const wq = new Quaternion(), wa = new Vector3(), wsample = {};
// What a body is, for the per-kind report: a tree, a parked car, a loose building part (by component), a legacy
// building proxy, a jointed member section, or a loose prop by type.
function wreckKind( D, id ) {
	const b = D.bodies.bodies.get( id );
	if ( b ) return { kind: b.kind, half: b.half, offset: b.centerOfMass ?? null, mass: b.mass, volume: b.volume };
	const s = D.structures.bodies.get( id );
	if ( s ) return { kind: s.piece ? 'part:' + s.piece.kind : s.member ? 'member' : 'proxy', half: s.half, offset: null, mass: s.mass, volume: s.volume };
	const p = PROPS.all[ id ];
	if ( p && ! p.panel ) return { kind: 'prop:' + p.type, half: p.local.half, offset: null, mass: p.physical?.mass, volume: p.physical?.volume };
	return null;
}
// One frame of the wreckage record: for every body the flood moves, its lowest point against the water and the ground
// under it. Clear: the lowest point more than 5 cm above both. Climb: the height gained while clear (upward speed
// integrated), reset when it touches the water or the ground again; a floating body's lowest point is always under the
// surface, so any climb is something throwing it out. Flight: clear, unsupported and moving faster than 1 m/s. Outrun:
// horizontal speed beyond 1.1 x the fastest wet flow under it plus 0.5 m/s, while wet.
export function recordWreck( D, motion, poses, supported, wrecks, dt, time, ground ) {
	const at = new Map();
	for ( let i = 0; i < poses.length; i += 10 ) at.set( poses[ i ], i );
	for ( let i = 0; i < motion.length; i += 7 ) {
		const id = motion[ i ], j = at.get( id );
		if ( j === undefined ) continue;
		let r = wrecks.get( id );
		if ( ! r ) {
			const k = wreckKind( D, id );
			if ( ! k ) continue;
			r = { id, kind: k.kind, half: k.half, offset: k.offset, mass: k.mass, volume: k.volume, spawned: time, start: null, climb: 0, climbMax: 0, climbAt: null, clearMax: - Infinity, clearAt: null, flight: 0, flightMax: 0, upClear: - Infinity, upward: - Infinity, excess: - Infinity, excessAt: null, ratio: 0, hang: 0, hangMax: 0, path: [] };
			wrecks.set( id, r );
		}
		wq.set( poses[ j + 4 ], poses[ j + 5 ], poses[ j + 6 ], poses[ j + 7 ] );
		wa.set( motion[ i + 1 ], motion[ i + 2 ], motion[ i + 3 ] );
		const cx = wa.x, cy = wa.y, cz = wa.z;
		let ex = 0, ey = 0, ez = 0;
		const h = r.half, hx = h.x ?? h[ 0 ], hy = h.y ?? h[ 1 ], hz = h.z ?? h[ 2 ];
		for ( let axis = 0; axis < 3; axis ++ ) {
			wa.set( axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0 ).applyQuaternion( wq );
			const e = axis === 0 ? hx : axis === 1 ? hy : hz;
			ex += Math.abs( wa.x ) * e; ey += Math.abs( wa.y ) * e; ez += Math.abs( wa.z ) * e;
		}
		const vx = motion[ i + 4 ], vy = motion[ i + 5 ], vz = motion[ i + 6 ], vh = Math.hypot( vx, vz ), speed = Math.hypot( vx, vy, vz );
		const bottom = cy - ey, g = ground( cx, cz );
		D.field.sample( cx, cy, cz, wsample );
		const water = wsample.height > g + .02 ? wsample.height : - Infinity, level = Math.max( water, g ), clear = bottom - level;
		const wet = water > - Infinity ? clamp( ( water - bottom ) / Math.max( .01, 2 * ey ), 0, 1 ) : 0;
		let flow = 0;
		for ( const [ dx, dz ] of [ [ 0, 0 ], [ ex, 0 ], [ - ex, 0 ], [ 0, ez ], [ 0, - ez ] ] ) {
			D.field.sample( cx + dx, cy, cz + dz, wsample );
			if ( wsample.height > ground( cx + dx, cz + dz ) + .02 && wsample.height > bottom ) flow = Math.max( flow, Math.hypot( wsample.ux, wsample.uz ) );
		}
		r.start ??= clear;
		const isClear = clear > .05, held = supported.has( id );
		if ( isClear ) {
			r.climb += Math.max( 0, vy ) * dt;
			if ( r.climb > r.climbMax ) { r.climbMax = r.climb; r.climbAt = { time: +time.toFixed( 2 ), y: +cy.toFixed( 2 ), clear: +clear.toFixed( 2 ), water: +( water > - Infinity ? water : NaN ).toFixed( 2 ), ground: +g.toFixed( 2 ), vy: +vy.toFixed( 2 ), since: +( time - r.spawned ).toFixed( 2 ) }; }
			r.upClear = Math.max( r.upClear, vy );
		} else r.climb = 0;
		if ( clear > r.clearMax ) { r.clearMax = clear; r.clearAt = { time: +time.toFixed( 2 ), y: +cy.toFixed( 2 ), vy: +vy.toFixed( 2 ), held }; }
		if ( isClear && ! held && speed > 1 ) { r.flight += dt; r.flightMax = Math.max( r.flightMax, r.flight ); } else r.flight = 0;
		if ( clear > 1 && ! held && speed < .5 ) { r.hang += dt; r.hangMax = Math.max( r.hangMax, r.hang ); } else r.hang = 0;
		r.upward = Math.max( r.upward, vy );
		if ( wet > .05 ) {
			const excess = vh - ( 1.1 * flow + .5 );
			if ( excess > r.excess ) { r.excess = excess; r.excessAt = { time: +time.toFixed( 2 ), speed: +vh.toFixed( 2 ), flow: +flow.toFixed( 2 ), wet: +wet.toFixed( 2 ) }; }
			if ( flow > 1 ) r.ratio = Math.max( r.ratio, vh / flow );
		}
		if ( r.path.length < 4000 && ( Math.round( time * 60 ) % 6 === 0 ) ) r.path.push( [ +time.toFixed( 2 ), +cy.toFixed( 2 ), +bottom.toFixed( 2 ), +( water > - Infinity ? water : NaN ).toFixed( 2 ), +g.toFixed( 2 ), +vy.toFixed( 2 ), +vh.toFixed( 2 ), +flow.toFixed( 2 ), +wet.toFixed( 2 ), held ? 1 : 0 ] );
	}
}

// One run: an H m tsunami at the pier with this seed, rendered frames of frameDt s (the game paces a disaster frame to
// at most 0.025 s and 3 physics steps, so 0.05 s and 0.1 s frames both run as 0.025 s), an ambient 5 m/s landward
// breeze, and optionally a gale of `gust` m/s from 30 to 42 s after launch that fells trees before the wave arrives.
// Returns, per tree body and per failed tree, the quantities test/flood-trees.mjs asserts on; a body's motion counts
// from judgeFrom s after launch (the gale's own throw of the trees it fells is not the flood's).
export function runFlood( { H, seed, frameDt, gust = 0, judgeFrom = 0, after = 40, wreckage = false } ) {
	const { D, sim, rally, terrain, app } = world( { wreckage } );
	const ground = ( x, z ) => terrain.heightAt( x, z );
	D.runSeed = seed >>> 0;
	const e = D.field.start( 'tsunami', { ...DEFAULTS.tsunami, x: PIER[ 0 ], z: PIER[ 1 ], intensity: H, warningLead: 3, duration: 180, seed } );
	const wind = { x: 0, z: - 5 };
	D.field.ambient = () => { const t = D.field.time - e.launchTime; wind.z = gust && t > 30 && t < 42 ? - gust : - 5; return wind; };
	const pacing = new SimulationPacing( { mode: 'realtime', storage: null } );
	const failures = [], bodies = new Map(), sample = {}, point = {}, q = new Quaternion(), com = new Vector3(), offset = new Vector3(), at = new Vector3(), up = new Vector3();
	const wrecks = new Map();
	const fail = D.bodies.fail;
	D.bodies.fail = function ( t, s, mode ) {
		const flow = [ s.ux ?? 0, s.uz ?? 0 ], air = Math.hypot( s.wx, s.wz ), depth = Math.max( 0, ( s.height ?? 0 ) - t.r.y );
		const ok = fail.call( this, t, s, mode );
		if ( ok ) failures.push( { t, time: D.field.time, flow, air, wind: [ s.wx, s.wz ], depth, dir: [ t.dirX, t.dirZ ] } );
		return ok;
	};
	const until = e.arrival + after;
	while ( D.field.time < until ) {
		const dt = pacing.step( frameDt, true );
		D.frameDt = dt;
		D.field.advance( dt );
		// The game's order (Disasters.before, then the physics, then the props' read-back and Disasters.after).
		if ( wreckage ) D.structures.update( dt );
		D.bodies.update( dt );
		if ( wreckage ) D.wakeProps();
		D.loads( dt );
		if ( rally.stale ) rally.refresh();
		sim.set_max_steps( pacing.physicsSteps );
		sim.advance( dt, 0, 0, 0, 1 );
		const poses = sim.prop_poses();
		if ( wreckage ) { app.props.readBack( dt, NOBODY ); D.structures.sync( poses ); }
		D.bodies.sync( poses );
		const motion = sim.disaster_motion(), supported = new Set( sim.disaster_supported() );
		if ( wreckage ) recordWreck( D, motion, poses, supported, wrecks, dt, D.field.time - e.launchTime, ground );
		for ( let i = 0; i < motion.length; i += 7 ) {
			const b = D.bodies.bodies.get( motion[ i ] );
			if ( ! b || b.kind !== 'tree' ) continue;
			const vx = motion[ i + 4 ], vy = motion[ i + 5 ], vz = motion[ i + 6 ];
			q.copy( b.quaternion );
			offset.fromArray( b.centerOfMass );
			com.copy( offset ).applyQuaternion( q ).add( at.set( motion[ i + 1 ], motion[ i + 2 ], motion[ i + 3 ] ) );
			// Each load point's submerged share, as RigidLoads takes it, and the fastest water any wet point is in.
			let wetVolume = 0, volume = 0, flow = 0;
			for ( const p of b.loadPoints ) {
				at.fromArray( p.local ).sub( offset ).applyQuaternion( q ).add( com );
				D.field.sample( at.x, at.y, at.z, point );
				let extent = 0;
				for ( let axis = 0; axis < 3; axis ++ ) extent += p.half[ axis ] * Math.abs( up.set( axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0 ).applyQuaternion( q ).y );
				extent = Math.max( .005, extent );
				const wet = point.height > ground( at.x, at.z ) + .02 ? clamp( ( point.height - at.y + extent ) / ( 2 * extent ), 0, 1 ) : 0;
				const share = p.volumeWeight ?? p.areaWeight;
				wetVolume += share * wet; volume += share;
				if ( wet > 0 ) flow = Math.max( flow, Math.hypot( point.ux, point.uz ) );
			}
			const wet = volume > 0 ? wetVolume / volume : 0;
			D.field.sample( com.x, com.y, com.z, sample );
			const g = ground( com.x, com.z ), water = sample.height > g + .02 ? sample.height : - Infinity;
			const judging = D.field.time - e.launchTime >= judgeFrom;
			let r = bodies.get( b.id );
			if ( ! r ) {
				const piece = b.massModel, cut = b.tree.cut, support = 0.3 * piece.crownRadius; // TreeFailure CROWN_SUPPORT
				// The centre of mass of the piece lying on flat ground: the root end down, the crown propped on its support.
				const rest = Math.max( piece.radius, support * ( piece.comY - cut ) / ( piece.crownY - cut ) );
				r = { id: b.id, kind: b.tree.kind, H: b.tree.r.H, released: D.field.time, rest, start: null, climb: 0, climbMax: 0, climbAt: null, flight: 0, flightMax: 0, upward: - Infinity, excess: - Infinity, excessAt: null, beached: null, slideMax: 0, slideAllowed: 0 };
				bodies.set( b.id, r );
			}
			if ( ! judging ) continue;
			r.start ??= com.y - Math.max( water, g );
			// Climb: the height the centre of mass gains while it is above both the water surface and its resting
			// height on the ground (any upward speed there is something throwing it, not water carrying it).
			const level = Math.max( water, g + r.rest );
			if ( com.y > level ) {
				r.climb += Math.max( 0, vy ) * dt;
				if ( r.climb > r.climbMax ) { r.climbMax = r.climb; r.climbAt = { time: +( D.field.time - e.launchTime ).toFixed( 2 ), y: +com.y.toFixed( 2 ), water: +sample.height.toFixed( 2 ), ground: +g.toFixed( 2 ), vy: +vy.toFixed( 2 ), wet: +wet.toFixed( 2 ) }; }
			} else r.climb = 0;
			// Free flight: moving, under 5 % wet and touching nothing below. A trunk lodged against a wall or a standing
			// tree after the water drains is not in flight: it is still.
			if ( ! supported.has( b.id ) && wet < .05 && Math.hypot( vx, vy, vz ) > 1 ) { r.flight += dt; r.flightMax = Math.max( r.flightMax, r.flight ); } else r.flight = 0;
			r.upward = Math.max( r.upward, vy );
			const vh = Math.hypot( vx, vz );
			if ( wet > .05 ) {
				const excess = vh - ( 1.1 * flow + .5 );
				if ( excess > r.excess ) { r.excess = excess; r.excessAt = { time: +( D.field.time - e.launchTime ).toFixed( 2 ), speed: +vh.toFixed( 2 ), flow: +flow.toFixed( 2 ), wet: +wet.toFixed( 2 ) }; }
			}
			// Beached: dry and on the ground. From there it may slide only as far as its speed and friction allow.
			if ( wet === 0 && supported.has( b.id ) ) {
				if ( ! r.beached ) r.beached = { x: com.x, z: com.z, speed: vh };
				else r.slideMax = Math.max( r.slideMax, Math.hypot( com.x - r.beached.x, com.z - r.beached.z ) - r.beached.speed ** 2 / ( 2 * .5 * GRAVITY ) );
			} else if ( wet > .05 ) r.beached = null;
		}
	}
	const failed = failures.map( f => ( {
		time: f.time, air: f.air, depth: f.depth, flow: Math.hypot( ...f.flow ),
		angle: Math.hypot( ...f.flow ) > 1e-3 ? Math.acos( clamp( ( f.flow[ 0 ] * f.dir[ 0 ] + f.flow[ 1 ] * f.dir[ 1 ] ) / Math.hypot( ...f.flow ), - 1, 1 ) ) * 180 / Math.PI : null,
		windAngle: f.air > 1e-3 ? Math.acos( clamp( ( f.wind[ 0 ] * f.dir[ 0 ] + f.wind[ 1 ] * f.dir[ 1 ] ) / f.air, - 1, 1 ) ) * 180 / Math.PI : null,
		over: f.t.phase === 'body' || f.t.phase === 'rest' || f.t.theta >= Math.PI / 3, theta: f.t.theta, age: D.field.time - f.time,
	} ) );
	sim.free();
	return { H, seed, frameDt, gust, launch: e.launchTime, arrival: e.arrival, end: D.field.time, failed, bodies: [ ...bodies.values() ], wreckage: wreckage ? [ ...wrecks.values() ] : null };
}

if ( ! isMainThread && workerData?.flood ) parentPort.postMessage( runFlood( workerData.flood ) );
