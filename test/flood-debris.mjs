// Loose wreckage in a flood (docs/disasters.md, "Trees and floating debris"): what the water carries stays in it.
// A loose prop floats by the water it displaces (its material, flooded or sealed), never by its bounding box, and rises
// to the surface no faster than water lets it; a part torn off a house starts beside its neighbours, so nothing but
// gravity and the loads moves it. The real island (test/helpers/flood-island.mjs): the production terrain, the
// authored village and its props, the WASM physics and the director's own loads. Every assertion is a physical
// outcome with the measured value in its message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { world, PIER } from './helpers/flood-island.mjs';
import { PROPS, PropPhysics, propBody } from '../src/physics/Props.js';
import { Quaternion, Vector3 } from '../src/engine/index.js';
import { RallyPhysics } from '../public/rally/rally_physics.js';
import { Disasters } from '../src/disasters/Disasters.js';
import { DisasterField } from '../src/disasters/Field.js';
import { WaterGrid } from '../src/disasters/WaterGrid.js';
import { rigidEnvironmentalLoad } from '../src/disasters/RigidLoads.js';
import { surfaceRate } from '../src/disasters/SurfaceRate.js';
import { SimulationPacing } from '../src/core/SimulationPacing.js';

const SEA = 1025; // kg/m³, sea water (src/physics/Loads.js)
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
// A tank on flat ground: the director's own loads (Disasters.prototype.loads) and the real solver, a level water
// surface with a uniform flow (or no water) and a steady wind. Bodies are loaded as the game's loose parts are.
function tank( { surface = null, flow = [ 0, 0 ], wind = [ 0, 0 ] } = {} ) {
	const sim = new RallyPhysics();
	sim.set_terrain( new Float32Array( 25 ).fill( FLAT ), 5, 4000, - 2000 );
	sim.reset( 1500, FLAT + 10, 1500, 0 );
	const field = new DisasterField( () => FLAT ), state = { surface, flow, wind: { x: wind[ 0 ], z: wind[ 1 ] } };
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

test( 'The surface rate read from the flood grid is the rate the surface moves at a drifter, over a rising front and over a drawdown', () => {
	// The flood solver itself on a small grid: a 2 m deep sea over a flat bed, a beach rising at 1 in 25 to the east, and
	// a 3 m block of water released offshore. It sends a bore up the beach, and the beach drains back behind it.
	const bed = ( x, z ) => clamp( .04 * x - 2, - 2, 6 );
	const grid = new WaterGrid( bed, { n: 129, dx: 2, sponge: false, friction: true } ), n = grid.n;
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) { const x = grid.x + i * grid.dx, k = j * n + i; grid.h[ k ] = Math.max( 0, ( x > - 110 && x < - 60 ? 3 : 0 ) - grid.bed[ k ] ); }
	grid.pack();
	const sample = {}, dt = 1 / 60;
	// Drifters in the sea off the beach and on the lower beach, moved with the water; each records the surface height at
	// itself (the truth) and the integral of the rate read from the grid.
	const drifters = [ - 30, - 10, 15 ].map( x => ( { from: x, x, z: 3, eta: [], sum: [ 0 ] } ) );
	let drained = 0;
	for ( let f = 0; f < 60 * 40; f ++ ) {
		for ( const d of drifters ) d.before = surfaceRate( grid, d.x, d.z );
		for ( const d of drifters ) { grid.sample( d.x, d.z, sample ); d.eta.push( sample.height ); d.ux = sample.ux; d.uz = sample.uz; }
		grid.advance( dt );
		for ( const d of drifters ) {
			// The drifter moves with the mean of the flow before and after the step; the rate is integrated the same way.
			grid.sample( d.x, d.z, sample );
			d.x += .5 * ( d.ux + sample.ux ) * dt; d.z += .5 * ( d.uz + sample.uz ) * dt;
			d.sum.push( d.sum.at( - 1 ) + .5 * ( d.before + surfaceRate( grid, d.x, d.z ) ) * dt );
		}
	}
	for ( const d of drifters ) {
		const peak = d.eta.indexOf( Math.max( ...d.eta ) ), first = d.eta.findIndex( e => e > d.eta[ 0 ] + .02 );
		let low = peak;
		for ( let k = peak; k < d.eta.length; k ++ ) if ( d.eta[ k ] < d.eta[ low ] ) low = k;
		const rise = d.eta[ peak ] - d.eta[ first ], read = d.sum[ peak ] - d.sum[ first ], fall = d.eta[ low ] - d.eta[ peak ], readFall = d.sum[ low ] - d.sum[ peak ];
		assert.ok( rise > .5, `the bore lifts the drifter from x ${ d.from } m by ${ rise.toFixed( 2 ) } m` );
		// Measured: 2 to 23% under over the front (a shock two cells wide), within 2% over the drawdown.
		assert.ok( Math.abs( read - rise ) <= .3 * rise, `over the rising front the surface at the drifter from x ${ d.from } m rose ${ rise.toFixed( 2 ) } m in ${ ( ( peak - first ) / 60 ).toFixed( 1 ) } s and the rate read from the grid adds up to ${ read.toFixed( 2 ) } m (30% allowed)` );
		if ( fall > - .3 ) continue; // this one stayed high on the beach
		drained ++;
		assert.ok( Math.abs( readFall - fall ) <= .25 * - fall, `over the drawdown the surface at the drifter from x ${ d.from } m fell ${ ( - fall ).toFixed( 2 ) } m in ${ ( ( low - peak ) / 60 ).toFixed( 1 ) } s and the rate read from the grid adds up to ${ ( - readFall ).toFixed( 2 ) } m (25% allowed)` );
	}
	assert.ok( drained > 0, 'a drifter rode the drawdown' );
} );
