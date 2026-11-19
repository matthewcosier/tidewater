// Loose wreckage in a flood (docs/disasters.md, "Trees and floating debris"): what the water carries stays in it.
// A loose prop floats by the water it displaces (its material, flooded or sealed), never by its bounding box, and rises
// to the surface no faster than water lets it; a part torn off a house starts beside its neighbours, so nothing but
// gravity and the loads moves it. The real island (test/helpers/flood-island.mjs): the production terrain, the
// authored village and its props, the WASM physics and the director's own loads. Every assertion is a physical
// outcome with the measured value in its message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { world, PIER } from './helpers/flood-island.mjs';
import { PROPS, PropPhysics, propBody } from '../src/physics/Props.js';
import { Quaternion, Vector3 } from '../src/engine/index.js';
import { RallyPhysics } from '../public/rally/rally_physics.js';
import { Disasters } from '../src/disasters/Disasters.js';
import { DisasterField } from '../src/disasters/Field.js';
import { WaterGrid } from '../src/disasters/WaterGrid.js';
import { rigidEnvironmentalLoad } from '../src/disasters/RigidLoads.js';
import { frontRate } from '../src/disasters/SurfaceRate.js';
import { SimulationPacing } from '../src/core/SimulationPacing.js';

const SEA = 1025; // kg/m³, sea water (src/physics/Loads.js)
const GRAVITY = 9.81; // m/s²
const WOOD = 500; // kg/m³, air-dry pine (USDA Wood Handbook FPL-GTR-282, Table 5-3): a slatted crate floats on its wood
const clamp = ( x, a, b ) => Math.max( a, Math.min( b, x ) );

// Vertical half extent (m) of a box of half extents h under rotation q: how far its lowest point sits below its centre.
function drop( q, h ) {
	const { x, y, z, w } = q;
	return Math.abs( 2 * ( x * y + w * z ) ) * h[ 0 ] + Math.abs( 1 - 2 * ( x * x + z * z ) ) * h[ 1 ] + Math.abs( 2 * ( y * z - w * x ) ) * h[ 2 ];
}

test( 'A loose prop floats by the water it displaces: a lobster pot sinks, a drum and a crate float as Archimedes puts them, and none leaves the water as it surfaces', () => {
	const { D, sim, app, terrain } = world();
	app.props = new PropPhysics( app );
	app.props.physics = sim;
	// Still sea at sea level, deep enough off the pier head that nothing touches the bed but what sinks.
	let spot = null;
	for ( let r = 40; ! spot && r < 400; r += 10 ) for ( let a = 0; a < 2 * Math.PI && ! spot; a += .2 ) { const x = PIER[ 0 ] + r * Math.cos( a ), z = PIER[ 1 ] + r * Math.sin( a ); if ( [ - 6, 0, 6 ].every( dx => terrain.heightAt( x + dx, z ) < - 6 && terrain.heightAt( x + dx, z + 12 ) < - 6 ) ) spot = { x, z }; }
	assert.ok( spot, 'there is open water 6 m deep off the pier' );
	const surface = 0; // m
	D.field.water = { sample: ( x, z, out = {} ) => { out.height = surface; out.depth = surface - terrain.heightAt( x, z ); out.ux = 0; out.uz = 0; return out; } };
	const types = [ 'trap', 'barrel', 'crate', 'fence' ], props = types.map( type => PROPS.all.find( p => p.type === type && ! p.panel ) );
	for ( const [ k, p ] of props.entries() ) {
		assert.ok( p, `the island has a ${ types[ k ] }` );
		// Released at rest 2 m under the surface, upright, 4 m apart.
		p.m.makeRotationFromQuaternion( new Quaternion() ).setPosition( spot.x + ( k - 1.5 ) * 4, surface - 2 - p.local.c.y, spot.z );
		app.props.wake( p );
		p.disasterActive = true;
	}
	// The share of its displaced volume under water: the load's own reading where the body has load points, else the
	// depth of its box under the surface. Half extents as the physics has them (a drum is a cylinder of radius max(x, z)).
	const seen = props.map( p => { const h = p.local.half, r = Math.max( h.x, h.z ); return { wet: 0, model: false, rise: - Infinity, half: p.type === 'barrel' ? [ r, h.y, r ] : [ h.x, h.y, h.z ] }; } );
	for ( const [ k, p ] of props.entries() ) {
		const load = D.bodyOptions( p.id )?.environmentLoad;
		if ( load ) { seen[ k ].model = true; p.physical.environmentLoad = context => { const out = load( context ); seen[ k ].wet = out.wet; return out; }; }
	}
	// A floating body still bobs a little after 20 s (quadratic drag damps a small heave slowly): its draft is the mean
	// over the last 10 s of 30.
	const dt = 1 / 60, q = new Quaternion(), from = 60 * 20;
	for ( let f = 0; f < 60 * 30; f ++ ) {
		D.loads( dt );
		sim.advance( dt, 0, 0, 0, 1 );
		app.props.readBack( dt, [] );
		const poses = sim.prop_poses();
		for ( let i = 0; i < poses.length; i += 10 ) {
			const k = props.findIndex( p => p.id === poses[ i ] );
			if ( k < 0 ) continue;
			q.set( poses[ i + 4 ], poses[ i + 5 ], poses[ i + 6 ], poses[ i + 7 ] );
			const s = seen[ k ], reach = drop( q, s.half ), bottom = poses[ i + 2 ] - reach;
			if ( ! s.model ) s.wet = clamp( ( surface - bottom ) / ( 2 * reach ), 0, 1 );
			if ( f >= from ) { s.sum = ( s.sum ?? 0 ) + s.wet; s.n = ( s.n ?? 0 ) + 1; }
			s.bottom = bottom; s.ground = terrain.heightAt( poses[ i + 1 ], poses[ i + 3 ] ); s.y = poses[ i + 2 ];
			// The lowest point of a floating body is always under the surface: any height it gains above it, it was thrown.
			s.rise = Math.max( s.rise, bottom - surface );
		}
	}
	for ( const s of seen ) s.wet = s.sum / s.n;
	const [ trap, drum, crate, fence ] = seen, [ , drumProp ] = props;
	assert.ok( trap.bottom - trap.ground < .15, `the lobster pot rests ${ ( trap.bottom - trap.ground ).toFixed( 2 ) } m above the sea bed (${ trap.ground.toFixed( 1 ) } m) after 30 s; ballasted, it sinks` );
	const drumShare = drumProp.physical.mass / ( SEA * drumProp.physical.volume );
	assert.ok( Math.abs( drum.wet - drumShare ) <= .05, `the closed drum floats with ${ ( drum.wet * 100 ).toFixed( 1 ) }% of its volume under; its ${ drumProp.physical.mass.toFixed( 0 ) } kg over its ${ drumProp.physical.volume.toFixed( 3 ) } m³ of sea water puts ${ ( drumShare * 100 ).toFixed( 1 ) }% under` );
	for ( const [ name, s ] of [ [ 'slatted crate', crate ], [ 'fence piece', fence ] ] ) assert.ok( Math.abs( s.wet - WOOD / SEA ) <= .05, `the ${ name } floats with ${ ( s.wet * 100 ).toFixed( 1 ) }% of its wood under; flooded, it floats on its wood: ${ ( WOOD / SEA * 100 ).toFixed( 1 ) }%` );
	for ( const [ k, s ] of seen.entries() ) assert.ok( s.rise <= .05, `the ${ types[ k ] } rose to the surface and its lowest point cleared it by ${ s.rise.toFixed( 2 ) } m: the water threw it out` );
} );

// ---- The water holds what it carries. Drag reaches the solver as load points and is integrated there every substep
// (rally-physics/src/disasters.rs fluid_drag), not as a force held over the frame.
const FLAT = 100; // m
const STEP = 1 / 120; // s, the solver's fixed step
// A tank on flat ground (at `ground` m): the director's own loads (Disasters.prototype.loads) and the real solver, a
// level water surface with a uniform flow (or no water) and a steady wind. Bodies are loaded as the game's loose parts are.
function tank( { surface = null, flow = [ 0, 0 ], wind = [ 0, 0 ], ground = FLAT } = {} ) {
	const sim = new RallyPhysics();
	sim.set_terrain( new Float32Array( 25 ).fill( ground ), 5, 4000, - 2000 );
	sim.reset( 1500, ground + 10, 1500, 0 );
	const field = new DisasterField( () => ground ), state = { surface, flow, wind: { x: wind[ 0 ], z: wind[ 1 ] } };
	if ( surface !== null ) field.water = { sample: ( x, z, out = {} ) => { out.height = state.surface; out.depth = state.surface - FLAT; out.ux = state.flow[ 0 ]; out.uz = state.flow[ 1 ]; return out; } };
	field.ambient = () => state.wind;
	const bodies = new Map();
	const d = { app: { rally: { physics: sim, profile: { mass: 1400 } } }, field, structures: { bodies }, bodies: { bodies: new Map() }, restored: false, limited: 0, peakForce: 0, rawPeakForce: 0, touched: new Set(), bodyOptions: Disasters.prototype.bodyOptions };
	let next = 100000;
	const add = ( { half, mass, area, volume }, at, velocity = [ 0, 0, 0 ] ) => {
		const body = { id: next ++, kind: 'structure', position: new Vector3( ...at ), quaternion: new Quaternion(), half: new Vector3( ...half ), mass, area, volume, height: 2 * half[ 1 ], reach: half, asleep: false, velocity: new Vector3( ...velocity ) };
		body.environmentLoad = context => rigidEnvironmentalLoad( field, sim, body, context );
		assert.ok( sim.wake_prop( body.id, 0, new Float32Array( half ), new Float32Array( [ ...at, 0, 0, 0, 1, ...velocity ] ), mass, .65, .05, false ), 'the solver took the body' );
		bodies.set( body.id, body );
		return body;
	};
	// One frame in the game's order (loads, then the solver, then the poses). Returns the fixed steps the solver ran.
	const frame = dt => {
		Disasters.prototype.loads.call( d, dt );
		const steps = sim.advance( dt, 0, 0, 0, 0 ), poses = sim.prop_poses(), motion = sim.disaster_motion();
		for ( let i = 0; i < poses.length; i += 10 ) { const b = bodies.get( poses[ i ] ); if ( b ) { b.position.fromArray( poses, i + 1 ); b.quaternion.fromArray( poses, i + 4 ); b.asleep = poses[ i + 9 ] === 1; } }
		for ( let i = 0; i < motion.length; i += 7 ) bodies.get( motion[ i ] )?.velocity.fromArray( motion, i + 4 );
		return steps;
	};
	// Frames of 1 / hz s for `seconds` of game time, paced as the game paces a disaster (at most 25 ms and 3 steps a frame).
	const run = ( hz, seconds, each ) => {
		const pacing = new SimulationPacing( { mode: 'realtime', storage: null } );
		for ( let time = 0; time < seconds; ) {
			const dt = pacing.step( 1 / hz, true );
			sim.set_max_steps( pacing.physicsSteps );
			time += frame( dt ) * STEP;
			each?.( time );
		}
	};
	return { sim, field, state, add, frame, run };
}

test( 'Water slows a body moving through it at the rate of quadratic drag, at 10, 60 and 144 frames a second', () => {
	// A 0.6 m block as dense as sea water, 10 m under the surface: buoyancy carries its weight and only drag acts on it.
	const half = [ .3, .3, .3 ], volume = 8 * .3 ** 3, mass = SEA * volume, area = 4 * .3 * .3, v0 = 10; // m, m³, kg, m², m/s
	const c = SEA * area / ( 2 * mass ); // 1/m: rho Cd A / (2 m), Cd 1
	for ( const hz of [ 10, 60, 144 ] ) {
		const t = tank( { surface: FLAT + 20 } ), body = t.add( { half, mass, area, volume }, [ 0, FLAT + 10, 0 ], [ v0, 0, 0 ] );
		let worst = 0, at = null;
		t.run( hz, 1, time => {
			const expected = v0 / ( 1 + c * v0 * time ), error = Math.abs( body.velocity.x - expected ) / expected;
			if ( error > worst ) { worst = error; at = { time, speed: body.velocity.x, expected }; }
		} );
		assert.ok( at && worst <= .2, `at ${ hz } Hz the block moves at ${ at?.speed.toFixed( 3 ) } m/s after ${ at?.time.toFixed( 3 ) } s in still water; quadratic drag leaves v0 / (1 + c v0 t) = ${ at?.expected.toFixed( 3 ) } m/s (${ ( worst * 100 ).toFixed( 1 ) }% off, 20% allowed)` );
		assert.ok( Math.abs( body.velocity.x - v0 / ( 1 + c * v0 ) ) <= .2 * v0 / ( 1 + c * v0 ), `at ${ hz } Hz the block still moves at ${ body.velocity.x.toFixed( 3 ) } m/s after 1 s; drag leaves ${ ( v0 / ( 1 + c * v0 ) ).toFixed( 3 ) } m/s` );
		t.sim.free();
	}
} );

test( 'A crate thrown up at 10 m/s from the bed under a metre of water does not leave the water', () => {
	const crate = propBody( 'crate', { x: .3, y: .3, z: .3 } );
	for ( const hz of [ 10, 60 ] ) {
		const t = tank( { surface: FLAT + 1 } ), body = t.add( crate, [ 0, FLAT + .3, 0 ], [ 0, 10, 0 ] );
		let clear = - Infinity;
		t.run( hz, 3, () => { clear = Math.max( clear, body.position.y - drop( body.quaternion, body.reach ) - ( FLAT + 1 ) ); } );
		assert.ok( clear <= .3, `at ${ hz } Hz the ${ crate.mass.toFixed( 0 ) } kg crate thrown up at 10 m/s from the bed under 1 m of water rose until its lowest point was ${ clear.toFixed( 2 ) } m above the surface (0.3 m allowed)` );
		t.sim.free();
	}
} );

test( 'A 30 m/s flow holds a light body on a wall without moving it, and it rests when the flow stops', () => {
	// A lobster pot (ballasted: it stays on the bed) under 2 m of water, against a wall across the flow.
	const pot = propBody( 'trap', { x: .4, y: .25, z: .3 } ), t = tank( { surface: FLAT + 2, flow: [ 30, 0 ] } );
	t.sim.add_surface_boxes( new Float32Array( [ .95, FLAT + 1, 0, .5, 1, 2, 0, .8 ] ), new Uint8Array( 1 ) );
	const body = t.add( pot, [ 0, FLAT + .25, 0 ] ), free = .5 * SEA * pot.area * 30 * 30 / pot.mass; // m/s² on the pot were it free
	t.run( 60, 1 ); // the flow closes the 5 cm to the wall
	const start = body.position.clone();
	let moved = 0;
	t.run( 60, 10, () => { moved = Math.max( moved, body.position.distanceTo( start ) ); } );
	assert.ok( moved <= .05, `held on the wall for 10 s by a 30 m/s flow (${ free.toFixed( 0 ) } m/s² on it were it free) the ${ pot.mass.toFixed( 0 ) } kg pot moved ${ moved.toFixed( 3 ) } m (0.05 m allowed)` );
	t.state.flow = [ 0, 0 ];
	t.run( 60, 1 );
	assert.ok( body.velocity.length() < .05, `1 s after the flow stopped the pot still moves at ${ body.velocity.length().toFixed( 3 ) } m/s` );
	assert.ok( body.position.distanceTo( start ) <= .05, `after the flow stopped the pot ended ${ body.position.distanceTo( start ).toFixed( 3 ) } m from where it was held` );
	t.sim.free();
} );

test( 'A body at rest in a steady wind sleeps and stays asleep, and wakes when the wind changes', () => {
	const crate = propBody( 'crate', { x: .3, y: .3, z: .3 } ), t = tank( { wind: [ 5, 0 ] } ), body = t.add( crate, [ 0, FLAT + .3, 0 ] );
	t.run( 60, 8 );
	assert.ok( body.asleep, 'a crate on the ground in a steady 5 m/s breeze did not fall asleep within 8 s' );
	const rest = body.position.clone();
	let woke = 0;
	t.run( 60, 2, () => { if ( ! body.asleep ) woke ++; } );
	assert.equal( woke, 0, `the same wind woke the sleeping crate on ${ woke } frames of 2 s` );
	assert.ok( body.position.distanceTo( rest ) === 0, `the sleeping crate moved ${ body.position.distanceTo( rest ) } m` );
	// A 45 m/s gust: 490 N on its face against 170 N of friction.
	t.state.wind.x = 45;
	t.frame( 1 / 60 );
	assert.ok( ! body.asleep, 'a changed wind did not wake the crate' );
	t.run( 60, .5 );
	assert.ok( body.position.x - rest.x > .05, `half a second of a 45 m/s gust moved the crate ${ ( body.position.x - rest.x ).toFixed( 3 ) } m` );
	t.sim.free();
} );

// ---- The water's vertical velocity (src/disasters/SurfaceRate.js). The solver holds a bore as a shock two or three
// cells wide, so the surface's rate read at a point is the mesh's (10 to 31 m/s on the face of the island's 10 m and
// 25 m waves). Real water rises over the length of a hydraulic jump, about six times the depth behind it (Peterka 1958,
// USBR Engineering Monograph 25; Chow 1959, Open-Channel Hydraulics, ch. 15), and the rate is averaged across the front
// over that length. Averaging keeps the whole rise and lowers only the peak.

// The flood solver on a small grid: a 2 m deep sea over a flat bed, a beach rising at 1 in 25 to the east, and a 3 m
// block of water released offshore. It sends a bore up the beach, and the beach drains back behind it.
function beachBore() {
	const bed = ( x, z ) => clamp( .04 * x - 2, - 2, 6 );
	const grid = new WaterGrid( bed, { n: 129, dx: 2, sponge: false, friction: true } ), n = grid.n;
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) { const x = grid.x + i * grid.dx, k = j * n + i; grid.h[ k ] = Math.max( 0, ( x > - 110 && x < - 60 ? 3 : 0 ) - grid.bed[ k ] ); }
	grid.pack();
	return { grid, bed };
}

test( 'The water lifts a drifter by the whole rise of the surface over a front, no faster than a front as long as a real hydraulic jump, and lowers it by the whole drawdown', () => {
	const { grid } = beachBore(), sample = {}, rate = {}, dt = 1 / 60;
	// Drifters in the sea off the beach and on the lower beach, moved with the water; each records the surface height at
	// itself (the truth), the depth, and the integral of the rate read from the grid.
	const drifters = [ - 30, - 10, 15 ].map( x => ( { from: x, x, z: 3, eta: [], depth: [], speed: [], sum: [ 0 ], peak: 0 } ) );
	// Two fixed gauges in the sea time the front: the first frame the surface at each stands 2 cm over its start.
	const gauges = [ - 40, - 20 ].map( x => ( { x, start: null, at: null } ) );
	for ( let f = 0; f < 60 * 40; f ++ ) {
		for ( const d of drifters ) { d.before = frontRate( grid, d.x, d.z, rate ).rate; d.peak = Math.max( d.peak, d.before ); }
		for ( const d of drifters ) { grid.sample( d.x, d.z, sample ); d.eta.push( sample.height ); d.depth.push( sample.depth ); d.ux = sample.ux; d.uz = sample.uz; d.speed.push( Math.hypot( sample.ux, sample.uz ) ); }
		for ( const g of gauges ) { grid.sample( g.x, 3, sample ); g.start ??= sample.height; if ( g.at === null && sample.height > g.start + .02 ) g.at = f * dt; }
		grid.advance( dt );
		for ( const d of drifters ) {
			// The drifter moves with the mean of the flow before and after the step; the rate is integrated the same way.
			grid.sample( d.x, d.z, sample );
			d.x += .5 * ( d.ux + sample.ux ) * dt; d.z += .5 * ( d.uz + sample.uz ) * dt;
			d.sum.push( d.sum.at( - 1 ) + .5 * ( d.before + frontRate( grid, d.x, d.z, rate ).rate ) * dt );
		}
	}
	assert.ok( gauges.every( g => g.at !== null ) && gauges[ 1 ].at > gauges[ 0 ].at, `the bore passed both gauges (${ gauges.map( g => g.at?.toFixed( 2 ) ).join( ', ' ) } s)` );
	const celerity = ( gauges[ 1 ].x - gauges[ 0 ].x ) / ( gauges[ 1 ].at - gauges[ 0 ].at ); // m/s
	let drained = 0;
	for ( const d of drifters ) {
		// The first front: it reaches the drifter when the surface there first stands 2 cm over its start, and its top is
		// where the surface then rises less than 2 cm in half a second (later waves come back off the beach and the wall).
		const first = d.eta.findIndex( v => v > d.eta[ 0 ] + .02 );
		let top = first;
		while ( top + 30 < d.eta.length && d.eta[ top + 30 ] > d.eta[ top ] + .02 ) top ++;
		const rise = d.eta[ top ] - d.eta[ 0 ], behind = d.depth[ top ];
		// Over the whole passage, not from first rise to top: averaged across the front, the rate starts before the
		// surface at the drifter moves and goes on until the front is half a jump past it, 3 y2 at the speed it passes.
		const passes = Math.max( .5, celerity - d.speed[ top ] ), end = Math.min( d.sum.length - 1, top + Math.ceil( 60 * 6 * behind / passes ) );
		let most = 0;
		for ( let k = 0; k <= end; k ++ ) if ( d.sum[ k ] > d.sum[ most ] ) most = k;
		const read = d.sum[ most ] - d.sum[ 0 ];
		assert.ok( first > 0 && rise > .5, `the bore lifts the drifter from x ${ d.from } m by ${ rise.toFixed( 2 ) } m` );
		assert.ok( Math.abs( read - rise ) <= .1 * rise, `over the front the surface at the drifter from x ${ d.from } m rose ${ rise.toFixed( 2 ) } m in ${ ( ( top - first ) / 60 ).toFixed( 1 ) } s and the rate read from the grid adds up to ${ read.toFixed( 2 ) } m by ${ ( end / 60 ).toFixed( 1 ) } s (10% allowed)` );
		// A front as long as a jump, 6 y2, passing at c lifts the surface at dh c / (6 y2); the roller, where most of the
		// rise is, is shorter than the jump, so up to half as much again (Hager 1992).
		const bound = 1.5 * rise * celerity / ( 6 * behind );
		assert.ok( d.peak <= bound, `the water under the drifter from x ${ d.from } m rose at up to ${ d.peak.toFixed( 2 ) } m/s; a front ${ ( 6 * behind ).toFixed( 1 ) } m long (6 x ${ behind.toFixed( 2 ) } m behind it) rising ${ rise.toFixed( 2 ) } m at ${ celerity.toFixed( 2 ) } m/s allows ${ bound.toFixed( 2 ) } m/s` );
		// The drawdown after it: from the top to the lowest the surface falls, against the read from its most to its least.
		let low = top, readLow = most;
		for ( let k = top; k < d.eta.length; k ++ ) if ( d.eta[ k ] < d.eta[ low ] ) low = k;
		for ( let k = most; k < d.sum.length; k ++ ) if ( d.sum[ k ] < d.sum[ readLow ] ) readLow = k;
		const fall = d.eta[ low ] - d.eta[ top ], readFall = d.sum[ readLow ] - d.sum[ most ];
		if ( fall > - .3 ) continue; // this one stayed high on the beach
		drained ++;
		assert.ok( Math.abs( readFall - fall ) <= .25 * - fall, `over the drawdown the surface at the drifter from x ${ d.from } m fell ${ ( - fall ).toFixed( 2 ) } m and the rate read from the grid adds up to ${ ( - readFall ).toFixed( 2 ) } m (25% allowed)` );
	}
	assert.ok( drained > 0, 'a drifter rode the drawdown' );
} );

test( 'The water\'s load on a body is the water and the body\'s pose now, whatever the body did before', () => {
	// Two crates at one pose in a bore, one of them loaded a frame before at another pose in the same front.
	const { grid, bed } = beachBore(), field = new DisasterField( bed );
	field.water = grid;
	for ( let f = 0; f < 60 * 6; f ++ ) grid.advance( 1 / 60 );
	const crate = propBody( 'crate', { x: .3, y: .3, z: .3 } ), sample = {};
	// The front: the steepest point of the surface along the line z = 3 m in the sea.
	let front = - 60, steepest = 0;
	for ( let x = - 60; x < 0; x += .5 ) { const a = grid.sample( x, 3, sample ).height, b = grid.sample( x + .5, 3, sample ).height; if ( a - b > steepest ) { steepest = a - b; front = x; } }
	const body = id => ( { id, mass: crate.mass, half: new Vector3( .3, .3, .3 ), area: crate.area, volume: crate.volume, quaternion: new Quaternion() } );
	const load = ( b, x ) => {
		const y = grid.sample( x, 3, sample ).height - .2, list = { data: new Float32Array( 24 * 9 ), n: 0 };
		const out = rigidEnvironmentalLoad( field, null, b, { position: new Vector3( x, y, 3 ), velocity: new Vector3(), dt: 1 / 60, drag: list }, {} );
		const records = [];
		for ( let i = out.dragFirst; i < list.n; i += 9 ) records.push( ...list.data.subarray( i + 1, i + 9 ) );
		return { force: [ out.fx, out.fy, out.fz, out.tx, out.ty, out.tz ], records };
	};
	const fresh = load( body( 1 ), front ), moved = body( 2 );
	load( moved, front - 6 );
	const after = load( moved, front );
	assert.ok( Math.abs( fresh.force[ 1 ] ) > 0 && fresh.records.length > 0, `the crate at the front at x ${ front } m is loaded (${ fresh.force[ 1 ].toFixed( 1 ) } N up)` );
	assert.deepEqual( after.force, fresh.force, `the crate loaded 6 m behind the front a frame before takes ${ after.force.map( v => v.toFixed( 2 ) ).join( ', ' ) } N, N m at the front, against ${ fresh.force.map( v => v.toFixed( 2 ) ).join( ', ' ) } for one loaded there first` );
	assert.deepEqual( after.records, fresh.records, 'its drag records at the front are the same as the fresh crate\'s' );
} );

// A bore in the real flood solver over a flat sea bed 3 m deep: a block of water H m over the sea along the west 100 m
// of a 640 m grid, released at once. Bodies rest on the bed in its path in the real rigid solver, loaded by the
// director's own loads as the game's loose pieces are.
function boreTank( H ) {
	const DEPTH = 3, bed = FLAT - DEPTH; // m
	const grid = new WaterGrid( () => bed, { n: 161, dx: 4, sponge: false, friction: true } ), n = grid.n;
	for ( let k = 0; k < n * n; k ++ ) grid.h[ k ] = DEPTH + ( grid.x + ( k % n ) * grid.dx < grid.x + 100 ? H : 0 );
	grid.pack();
	const t = tank( { ground: bed } );
	t.field.water = grid;
	return { ...t, grid, bed };
}

test( 'A crate, a deck slab and a masonry part resting in the path of a 10 m and a 25 m bore leave the water by no more than the water\'s own rise throws them', () => {
	const pieces = {
		crate: propBody( 'crate', { x: .3, y: .3, z: .3 } ),
		// A 3 x 3 m deck slab of 0.2 m pine (500 kg/m³, USDA Wood Handbook FPL-GTR-282, Table 5-3).
		slab: { half: [ 1.5, .1, 1.5 ], mass: 900, area: 9, volume: 1.8 },
		// The 80 kg masonry part of the 25 m flood: brick at 1,900 kg/m³ (CIBSE Guide A, Table 3.38).
		masonry: { half: [ .3, .1, .175 ], mass: 80, area: .6 * .35, volume: 80 / 1900 },
	};
	const rate = {}, sample = {};
	for ( const H of [ 10, 25 ] ) {
		const t = boreTank( H ), bodies = [];
		let z = - 40;
		for ( const [ name, p ] of Object.entries( pieces ) ) {
			const half = Array.isArray( p.half ) ? p.half : [ p.half.x, p.half.y, p.half.z ];
			bodies.push( { name, p, body: t.add( { ...p, half }, [ - 100, t.bed + half[ 1 ], z ] ), clear: - Infinity, peak: 0, risen: 0, start: null } );
			z += 40;
		}
		let last = 0;
		t.run( 60, 25, time => {
			t.grid.advance( time - last );
			last = time;
			for ( const b of bodies ) {
				const x = b.body.position.x, zz = b.body.position.z, surface = t.field.sample( x, b.body.position.y, zz, sample ).height;
				b.start ??= surface;
				b.risen = Math.max( b.risen, surface - b.start );
				b.peak = Math.max( b.peak, frontRate( t.grid, x, zz, rate ).rate );
				b.clear = Math.max( b.clear, b.body.position.y - drop( b.body.quaternion, b.body.reach ) - surface );
			}
		} );
		for ( const b of bodies ) {
			assert.ok( b.risen > H / 4, `the ${ H } m bore raised the water over the ${ b.name } by ${ b.risen.toFixed( 2 ) } m` );
			const bound = b.peak ** 2 / ( 2 * GRAVITY ) + .25;
			assert.ok( b.clear <= bound, `in the ${ H } m bore the ${ b.name } (${ b.p.mass.toFixed( 0 ) } kg) rose until its lowest point was ${ b.clear.toFixed( 2 ) } m above the water; the water rose at up to ${ b.peak.toFixed( 2 ) } m/s under it, which throws it ${ ( bound - .25 ).toFixed( 2 ) } m (0.25 m allowed for the frame)` );
		}
		t.sim.free();
	}
} );

// ---- A deck leaves its piles (src/disasters/Structures.js checkPiles and pole; MaterialMembers.js pileMember). A pier
// bay leaves as its deck, held at each pile cap it rests on; its piles stand as the island's standing shapes, and each
// fails when the water's drag bends it at the bed past what its round section carries, and leaves as a pole.
test( 'A broken pier keeps its piles standing and its bays on their caps in a 2 m surge, and a pile a 10 m wave bends past what it carries leaves as a pole of its own length', () => {
	const { D, sim } = world( { wreckage: true } ), S = D.structures, pier = S.records.find( r => r.name === 'Harbour pier' );
	D.runSeed = 1;
	// Level water over the pier and nowhere else: H m over the still sea (0 m), flowing along x at u m/s.
	const flow = { height: 2, u: 2.5 }, near = ( x, z ) => x > pier.lo.x - 5 && x < pier.hi.x + 5 && z > pier.lo.z - 5 && z < pier.hi.z + 5;
	D.field.water = { sample: ( x, z, out = {} ) => { const wet = near( x, z ); out.height = wet ? flow.height : - 100; out.depth = wet ? flow.height - D.field.terrain( x, z ) : 0; out.ux = wet ? flow.u : 0; out.uz = 0; return out; } };
	const cylinders = pier.colliders.filter( c => c.tag === 'pile' ), standing = () => cylinders.filter( c => ! c.disasterDisabled ).length;
	assert.ok( S.fracture( pier ), 'the pier broke into its bays' );
	assert.ok( cylinders.length >= 60 && standing() === cylinders.length, `the broken pier keeps ${ standing() } of its ${ cylinders.length } piles standing` );
	const caps = [ ...S.joints.values() ].filter( j => j.pile );
	assert.ok( caps.length >= cylinders.length / 2, `its bays rest on ${ caps.length } pile caps` );
	// The 2 m surge at 2.5 m/s for 3 s of the game's frames.
	for ( let f = 0; f < 180; f ++ ) { S.update( 1 / 60 ); D.loads( 1 / 60 ); sim.advance( 1 / 60, 0, 0, 0, 1 ); S.sync( sim.prop_poses() ); }
	const worst = pier.piles.reduce( ( a, p ) => Math.max( a, p.moment / ( p.momentCapacity * p.factor ) ), 0 ), broken = caps.filter( j => j.broken );
	assert.equal( standing(), cylinders.length, `a 2 m surge at 2.5 m/s left ${ standing() } of ${ cylinders.length } piles standing (the most bent at ${ ( 100 * worst ).toFixed( 0 ) }% of what it carries)` );
	assert.equal( broken.length, 0, `${ broken.length } of ${ caps.length } cap connections broke in the 2 m surge` );
	// A 10 m wave's flow: 6 m over the still sea at 10 m/s. One frame of the damage step.
	flow.height = 6; flow.u = 10;
	const before = S.bodies.size;
	S.update( 1 / 60 );
	const over = pier.piles.filter( p => p.moment > p.momentCapacity * p.factor ), poles = pier.piles.filter( p => p.pole );
	assert.ok( over.length > 0 && poles.length === Math.min( over.length, S.bodyBudget - before ), `in one frame of a 10 m wave's flow ${ over.length } piles were bent past what they carry and ${ poles.length } left as poles` );
	for ( const p of poles ) assert.ok( Math.abs( 2 * p.pole.half.y - p.length ) < .01 && p.collider.disasterDisabled && p.joints.length === 0, `a ${ p.length.toFixed( 2 ) } m pile left as a ${ ( 2 * p.pole.half.y ).toFixed( 2 ) } m pole, its standing shape ${ p.collider.disasterDisabled ? 'gone' : 'still there' } and ${ p.joints.length } cap connections left` );
	sim.free();
} );

test( 'A deck slab in a 5 m/s current comes up to speed at the rate its edge gives edge-on and its face gives face-on', () => {
	// A 3 x 3 m slab of 0.2 m, as dense as sea water so only drag moves it, at rest 10 m down in a uniform 5 m/s current.
	// Its drag area along the flow is its solid's projected area (body.faces, as Structures.js gives every piece).
	const U = 5, volume = 3 * 3 * .2, mass = SEA * volume; // m/s, m³, kg
	for ( const [ name, half ] of [ [ 'edge-on', [ 1.5, .1, 1.5 ] ], [ 'face-on', [ .1, 1.5, 1.5 ] ] ] ) {
		const k = tank( { surface: FLAT + 20, flow: [ U, 0 ] } ), body = k.add( { half, mass, area: 9, volume }, [ 0, FLAT + 10, 0 ] );
		body.faces = [ 4 * half[ 1 ] * half[ 2 ], 4 * half[ 0 ] * half[ 2 ], 4 * half[ 0 ] * half[ 1 ] ];
		let time = 0;
		k.run( 60, .5, t => { time = t; } );
		// dv/dt = c (U - v)² with c = rho Cd A / (2 m), Cd 1, from rest: v = U c U t / (1 + c U t).
		const A = body.faces[ 0 ], c = SEA * A / ( 2 * mass ), expected = U * c * U * time / ( 1 + c * U * time );
		assert.ok( Math.abs( body.velocity.x - expected ) <= .2 * expected, `${ name }, the slab moves at ${ body.velocity.x.toFixed( 2 ) } m/s after ${ time.toFixed( 2 ) } s in a 5 m/s current; drag on the ${ A.toFixed( 2 ) } m² it shows the flow gives ${ expected.toFixed( 2 ) } m/s` );
		k.sim.free();
	}
} );

// ---- A fence panel that breaks. Its pieces are loose props cut in advance (Props.js, Panel). A panel the flood breaks
// (Disasters.wakeProps) lets them go where they stood, at rest, and the water carries them from there: every piece
// used to add a kick of 1 to 2.5 m/s upward onto the last one's, so the fifth piece of a panel left at up to 12 m/s.
// A car that breaks one throws each piece at 60 to 85 % of its own speed, plus a kick of 1 to 2.5 m/s up off the bumper
// and up to 0.75 m/s to either side.
test( 'A fence panel the flood breaks lets its pieces go at rest, and a car that breaks one throws each piece at a share of its own speed', () => {
	const { D, sim, app, terrain } = world();
	app.props = new PropPhysics( app );
	app.props.physics = sim;
	const panels = PROPS.all.filter( p => p.panel && p.pieces.length > 1 );
	const flooded = panels[ 0 ], struck = panels.find( p => p.centre.distanceTo( flooded.centre ) > 10 );
	assert.ok( flooded && struck, `the island has ${ panels.length } fence panels of more than one piece, two of them 10 m apart` );
	// Half a metre of still water over the first panel's foot, and none anywhere else.
	const foot = flooded.centre.y - flooded.half.y;
	D.field.water = { sample: ( x, z, out = {} ) => { out.height = Math.hypot( x - flooded.centre.x, z - flooded.centre.z ) < 4 ? foot + .5 : - 100; out.depth = out.height - terrain.heightAt( x, z ); out.ux = 0; out.uz = 0; return out; } };
	D.wakeProps();
	assert.ok( flooded.broken, 'half a metre of water over its foot broke the fence panel' );
	const velocity = id => { const m = sim.disaster_motion(); for ( let i = 0; i < m.length; i += 7 ) if ( m[ i ] === id ) return [ m[ i + 4 ], m[ i + 5 ], m[ i + 6 ] ]; return null; };
	const starts = flooded.pieces.map( p => velocity( p.id ) );
	assert.ok( starts.every( v => v && Math.hypot( ...v ) < 1e-6 ), `the ${ flooded.pieces.length } pieces of the panel the water broke left at ${ starts.map( v => v ? Math.hypot( ...v ).toFixed( 2 ) : 'none' ).join( ', ' ) } m/s, not at rest` );
	// A car at 10 m/s along x.
	const car = { car: true, v: new Vector3( 10, 0, 0 ) };
	app.props.breakPanel( struck, car );
	assert.ok( struck.broken, 'the car broke the second panel' );
	for ( const p of struck.pieces ) {
		const v = velocity( p.id );
		assert.ok( v && v[ 0 ] >= 5.25 - 1e-3 && v[ 0 ] <= 9.25 + 1e-3 && v[ 1 ] >= 1 - 1e-3 && v[ 1 ] <= 2.5 + 1e-3 && Math.abs( v[ 2 ] ) <= .75 + 1e-3, `a piece of the panel the 10 m/s car broke left at ${ v?.map( x => x.toFixed( 2 ) ).join( ', ' ) } m/s; a share of the car's speed is 5.25 to 9.25 along it, 1 to 2.5 up and 0.75 to either side` );
	}
	sim.free();
} );

// ---- The wreckage of a flood on the real island: a 2 m surge, a 10 m and a 25 m wave at the harbour pier, three seeds
// each, the game's 60 Hz frame, every body the flood moves (test/helpers/flood-island.mjs runFlood, recordWreck): the
// sections and parts of broken structures, the props, the felled trees and the parked cars. Nothing leaves the water or
// the ground unless something throws it, and nothing the flood carries is thrown: a piece clear of both and carried by
// nothing (no stack down to the ground, no standing box, no connection to its foundation) gains at most 0.5 m, and is
// in flight no longer than a fall from where it started takes, sqrt( 2 h / g ), plus 0.25 s for the frame cadence.
const WRECK_RUNS = [];
for ( const H of [ 2, 10, 25 ] ) for ( const seed of [ 1, 2, 3 ] ) WRECK_RUNS.push( { H, seed, frameDt: 1 / 60, after: 50, wreckage: true } );
test( 'Nothing a flood breaks or carries is thrown clear of the water and the ground, at 2, 10 and 25 m', { timeout: 3_600_000 }, async () => {
	const pool = Math.max( 1, Math.min( WRECK_RUNS.length, Number( process.env.FLOOD_DEBRIS_WORKERS ) || Math.min( 6, availableParallelism() - 2 ) ) );
	const queue = [ ...WRECK_RUNS ], runs = [];
	const next = () => {
		const run = queue.shift();
		if ( ! run ) return Promise.resolve();
		return new Promise( ( resolve, reject ) => {
			const worker = new Worker( new URL( './helpers/flood-island.mjs', import.meta.url ), { workerData: { flood: run } } );
			worker.once( 'message', m => { runs.push( { H: m.H, seed: m.seed, wreckage: m.wreckage.map( ( { path, ...r } ) => r ) } ); worker.terminate(); resolve(); } );
			worker.once( 'error', reject );
		} ).then( next );
	};
	await Promise.all( Array.from( { length: pool }, next ) );
	const failures = [];
	for ( const run of runs.sort( ( a, b ) => a.H - b.H || a.seed - b.seed ) ) {
		const label = `${ run.H } m wave, seed ${ run.seed }`, kinds = new Map();
		for ( const r of run.wreckage ) ( kinds.get( r.kind ) ?? kinds.set( r.kind, [] ).get( r.kind ) ).push( r );
		assert.ok( run.wreckage.some( r => r.kind === 'member' || r.kind.startsWith( 'part:' ) ), `${ label }: the flood broke a structure into loose pieces` );
		for ( const [ kind, list ] of kinds ) {
			const climb = list.reduce( ( a, r ) => r.climbMax > a.climbMax ? r : a );
			if ( climb.climbMax > .5 ) failures.push( `${ label }: a ${ kind } (${ climb.mass?.toFixed( 0 ) } kg) climbed ${ climb.climbMax.toFixed( 2 ) } m clear of the water and the ground with nothing carrying it (${ list.filter( r => r.climbMax > .5 ).length } of ${ list.length } over 0.5 m; ${ JSON.stringify( climb.climbAt ) })` );
			const fall = r => Math.sqrt( 2 * Math.max( 0, r.start ?? 0 ) / GRAVITY ) + .25, flown = list.reduce( ( a, r ) => r.flightMax - fall( r ) > a.flightMax - fall( a ) ? r : a );
			if ( flown.flightMax > fall( flown ) ) failures.push( `${ label }: a ${ kind } (${ flown.mass?.toFixed( 0 ) } kg) flew ${ flown.flightMax.toFixed( 2 ) } s clear of the water and the ground; a fall from its ${ ( flown.start ?? 0 ).toFixed( 2 ) } m start takes ${ fall( flown ).toFixed( 2 ) } s (${ list.filter( r => r.flightMax > fall( r ) ).length } of ${ list.length } longer)` );
		}
	}
	assert.equal( failures.length, 0, failures.join( '\n' ) );
} );
