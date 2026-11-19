// Breaking takes energy out of a structure and never puts any in (docs/disaster-damage.md, "A structure breaks
// without throwing its pieces"). On the real island, with the real solver and the game's own building damage, and
// with no wind and no water: sections and parts whose fitted boxes were built into each other, or into a standing
// box of the next structure, fall under gravity alone when their connections go. Before the rule the solver pushed
// overlapping boxes apart: the pier's sections left at up to 29.5 m/s with every connection removed and no load.
import test from 'node:test';
import assert from 'node:assert/strict';
import { world, PIER } from './helpers/flood-island.mjs';
import { RallyPhysics } from '../public/rally/rally_physics.js';
import { Vector3, Quaternion } from '../src/engine/index.js';
import { memberFrame } from '../src/disasters/MaterialMembers.js';
import { nativeAngularVelocity } from '../src/disasters/RigidLoads.js';

const STEP = 1 / 120; // s, the solver's fixed step
const G = 9.81; // m/s²
const MIN_HALF = .05; // m: no loose piece's collider is thinner than 10 cm (Structures.js MIN_HALF)
const AXES = [ new Vector3( 1, 0, 0 ), new Vector3( 0, 1, 0 ), new Vector3( 0, 0, 1 ) ];
const axis = new Vector3(), q = new Quaternion(), p = new Vector3(), v = new Vector3();

// Depth (m) of the overlap of two oriented boxes { position, quaternion, half }: the smallest over the 15 separating axes.
function overlap( a, b ) {
	const A = AXES.map( n => n.clone().applyQuaternion( a.quaternion ) ), B = AXES.map( n => n.clone().applyQuaternion( b.quaternion ) ), d = b.position.clone().sub( a.position );
	let depth = Infinity;
	const along = n => {
		const l = n.length();
		if ( l < 1e-6 ) return;
		n.multiplyScalar( 1 / l );
		const reach = ( axes, half ) => axes.reduce( ( s, x, i ) => s + half.getComponent( i ) * Math.abs( x.dot( n ) ), 0 );
		depth = Math.min( depth, reach( A, a.half ) + reach( B, b.half ) - Math.abs( d.dot( n ) ) );
	};
	for ( const n of A ) along( n.clone() );
	for ( const n of B ) along( n.clone() );
	for ( const x of A ) for ( const y of B ) along( x.clone().cross( y ) );
	return depth;
}
// Half the height (m) a box of these half sizes spans at this rotation.
function reachY( rotation, half ) {
	let y = 0;
	for ( let k = 0; k < 3; k ++ ) y += Math.abs( axis.copy( AXES[ k ] ).applyQuaternion( rotation ).y ) * half.getComponent( k );
	return y;
}
// One reading of every awake body the caller follows: per id, the centre, the lowest point, the speed (m/s) and the
// kinetic energy (J: translation plus rotation of a uniform box).
function read( sim, bodies, each ) {
	const motion = sim.disaster_motion(), poses = sim.prop_poses(), at = new Map();
	for ( let i = 0; i < poses.length; i += 10 ) at.set( poses[ i ], i );
	for ( let i = 0; i < motion.length; i += 7 ) {
		const b = bodies.get( motion[ i ] ), j = at.get( motion[ i ] );
		if ( ! b || j === undefined ) continue;
		p.fromArray( motion, i + 1 ); v.fromArray( motion, i + 4 ); q.fromArray( poses, j + 4 );
		const w = nativeAngularVelocity( sim, b.id, p, v ), h = b.half;
		let kinetic = .5 * b.mass * v.lengthSq();
		for ( let k = 0; k < 3; k ++ ) {
			const o = h.getComponent( ( k + 1 ) % 3 ), n = h.getComponent( ( k + 2 ) % 3 ), spin = w.dot( axis.copy( AXES[ k ] ).applyQuaternion( q ) );
			kinetic += .5 * b.mass * ( o * o + n * n ) / 3 * spin * spin;
		}
		each( b, p.y, p.y - reachY( q, h ), v.length(), kinetic );
	}
}
// Follows a set of bodies from the reading each is first seen in: the most any centre and any lowest point rose above
// where it began, and the largest excess of kinetic energy over 1.05 x the potential energy lost so far.
function follow() {
	const start = new Map(), worst = { rise: - Infinity, centre: - Infinity, excess: - Infinity, kinetic: 0, lost: 0, body: null, speed: 0 };
	let kinetic = 0, lost = 0, mass = 0;
	const each = ( b, y, low, speed, energy ) => {
		let s = start.get( b.id );
		if ( ! s ) start.set( b.id, s = { y, low } );
		kinetic += energy; lost += b.mass * G * ( s.y - y ); mass += b.mass;
		worst.speed = Math.max( worst.speed, speed );
		if ( low - s.low > worst.rise ) { worst.rise = low - s.low; worst.body = b; }
		worst.centre = Math.max( worst.centre, y - s.y );
	};
	const close = () => {
		// 5 % of the height lost, plus the energy of every piece at 0.1 m/s: the bound a hand-broken structure keeps.
		const excess = kinetic - ( 1.05 * Math.max( 0, lost ) + .5 * mass * .1 * .1 );
		if ( excess > worst.excess ) { worst.excess = excess; worst.kinetic = kinetic; worst.lost = lost; }
		kinetic = 0; lost = 0; mass = 0;
	};
	return { each, close, worst, start };
}

test( 'Two pier sections built into each other gain no speed when the connection between them breaks, and fall to a floor without rising', () => {
	const { D, sim } = world( { wreckage: true } ), S = D.structures;
	const pier = S.records.find( r => r.name === 'Harbour pier' );
	const joints = [], add = sim.add_structure_joint.bind( sim );
	sim.add_structure_joint = ( id, a, b, point, parameters ) => { joints.push( { a, b, point: [ ...point ], parameters: [ ...parameters ] } ); return add( id, a, b, point, parameters ); };
	assert.ok( S.fracture( pier ), 'the pier switches to its jointed sections' );
	sim.add_structure_joint = add;
	let pair = null;
	for ( const j of joints ) {
		const a = S.bodies.get( j.a ), b = S.bodies.get( j.b );
		if ( ! a || ! b ) continue;
		const depth = overlap( a, b );
		if ( ! pair || depth > pair.depth ) pair = { depth, a, b, j };
	}
	assert.ok( pair.depth > .5, `the two joined pier sections that overlap most do so by ${ pair.depth.toFixed( 2 ) } m` );
	const two = [ pair.a, pair.b ], ids = new Map( two.map( b => [ b.id, b ] ) );
	// The two sections alone, built as the builder builds them (the same box, pose, mass, friction, the builder's own
	// naming step, its connection point and compliance), with a connection a hand can break: 0.5 N and 0.5 N m.
	const build = floor => {
		const sim = new RallyPhysics();
		if ( floor !== null ) sim.set_terrain( new Float32Array( 25 ).fill( floor ), 5, 4000, - 2000 );
		sim.reset( 1500, ( floor ?? 5000 ) + 10, 1500, 0 );
		for ( const b of two ) {
			assert.ok( sim.wake_prop( b.id, 0, new Float32Array( b.half.toArray() ), new Float32Array( [ ...b.origin.toArray(), ...b.restQuaternion.toArray(), 0, 0, 0 ] ), b.mass, .65, .02, false ), 'the solver took the section' );
			S.piece?.( sim, b, pier );
		}
		const k = [ ...pair.j.parameters ];
		k[ 2 ] = k[ 3 ] = .5;
		assert.ok( sim.add_structure_joint( 1, pair.a.id, pair.b.id, new Float32Array( pair.j.point ), new Float32Array( k ) ), 'the solver took the connection' );
		return sim;
	};
	const hover = ( sim, push = 0 ) => sim.set_disaster_loads( new Float32Array( two.flatMap( ( b, i ) => [ b.id, 0, G * b.mass + ( i ? push : 0 ), 0, 0, 0, 0 ] ) ) );
	const snap = sim => {
		// 1 N on the second section until the connection breaks: under 0.1 mm/s a step on these masses.
		for ( let i = 0; sim.structure_joint_states()[ 1 ] === 0; i ++ ) { assert.ok( i < 240, 'the 0.5 N connection broke within 2 s under 1 N' ); hover( sim, 1 ); sim.advance( STEP, 0, 0, 0, 1 ); }
	};
	const speeds = sim => { const out = new Map(); read( sim, ids, ( b, y, low, speed ) => out.set( b.id, speed ) ); return out; };

	// No load and no gravity (an upward load equal to each weight).
	let sim2 = build( null );
	for ( let i = 0; i < 60; i ++ ) { hover( sim2 ); sim2.advance( STEP, 0, 0, 0, 1 ); }
	snap( sim2 );
	const before = speeds( sim2 );
	let gain = 0;
	for ( let i = 0; i < 240; i ++ ) { hover( sim2 ); sim2.advance( STEP, 0, 0, 0, 1 ); for ( const [ id, speed ] of speeds( sim2 ) ) gain = Math.max( gain, speed - before.get( id ) ); }
	assert.ok( gain <= .1, `with no load and no gravity, a ${ pair.a.mass.toFixed( 0 ) } kg and a ${ pair.b.mass.toFixed( 0 ) } kg pier section ${ pair.depth.toFixed( 2 ) } m inside each other gained ${ gain.toFixed( 2 ) } m/s when the connection between them broke (0.1 m/s allowed)` );
	sim2.free();

	// With gravity, half a metre above a flat floor.
	let lowest = Infinity;
	for ( const b of two ) lowest = Math.min( lowest, b.origin.y - reachY( b.restQuaternion, b.half ) );
	sim2 = build( lowest - .5 );
	for ( let i = 0; i < 30; i ++ ) { hover( sim2 ); sim2.advance( STEP, 0, 0, 0, 1 ); }
	snap( sim2 );
	sim2.set_disaster_loads( new Float32Array() );
	const fall = follow();
	let last = 0;
	for ( let i = 0; i < 600; i ++ ) { sim2.advance( STEP, 0, 0, 0, 1 ); last = 0; read( sim2, ids, ( b, y, low, speed, energy ) => { fall.each( b, y, low, speed, energy ); last = Math.max( last, speed ); } ); fall.close(); }
	assert.ok( fall.worst.centre <= .02, `dropped 0.5 m onto a floor with their connection broken, the centre of a pier section rose ${ fall.worst.centre.toFixed( 2 ) } m above where it started` );
	assert.ok( fall.worst.rise <= .1, `dropped 0.5 m onto a floor with their connection broken, the lowest point of a pier section rose ${ fall.worst.rise.toFixed( 2 ) } m above where it started` );
	assert.ok( last < .15, `5 s after the drop a section still moves at ${ last.toFixed( 2 ) } m/s` );
	sim2.free();
} );

for ( const name of [ 'Harbour pier', 'Main boardwalk', 'Evacuation boardwalk 1' ] ) test( `${ name }: with every connection removed at once in still air its sections fall under gravity alone`, () => {
	const { D, sim, rally } = world( { wreckage: true } ), S = D.structures;
	const r = S.records.find( x => x.name === name );
	assert.ok( S.fracture( r ), 'the structure switches to its jointed sections' );
	rally.refresh();
	sim.set_disaster_loads( new Float32Array() );
	// Standing and unloaded, it is at rest: nothing in it moves and no connection breaks.
	const stand = follow();
	for ( let i = 0; i < 120; i ++ ) { sim.set_max_steps( 1 ); sim.advance( STEP, 0, 0, 0, 1 ); read( sim, S.bodies, stand.each ); stand.close(); }
	const states = sim.structure_joint_states();
	let broken = 0, count = 0;
	for ( let i = 0; i < states.length; i += 15 ) { count ++; broken += states[ i + 1 ]; }
	assert.equal( broken, 0, `standing in still air for 1 s, ${ broken } of ${ count } connections broke and a section reached ${ stand.worst.speed.toFixed( 2 ) } m/s` );
	// A hand removes every connection at once.
	for ( const id of S.joints.keys() ) sim.remove_structure_joint( id );
	const fall = follow();
	for ( let i = 0; i < 360; i ++ ) { sim.set_max_steps( 1 ); sim.advance( STEP, 0, 0, 0, 1 ); read( sim, S.bodies, fall.each ); fall.close(); }
	const w = fall.worst;
	assert.ok( w.excess <= 0, `${ S.bodies.size } sections fell for 3 s with no load and held ${ ( w.kinetic / 1000 ).toFixed( 1 ) } kJ of kinetic energy when they had lost ${ ( w.lost / 1000 ).toFixed( 1 ) } kJ of height (5 % over allowed); the fastest reached ${ w.speed.toFixed( 1 ) } m/s` );
	// The centre, not the lowest point: a section that lands across a pile tips level, and its low end swings up
	// (0.55 m for one 68 kg pier section, at 0.3 m/s) while its centre stays where it fell to.
	assert.ok( w.centre <= .1, `${ S.bodies.size } sections fell for 3 s with no load and the centre of one rose ${ w.centre.toFixed( 2 ) } m above where it started (0.1 m allowed)` );
	S.reset();
} );

test( 'Every part of three houses torn off at once in still air falls where it stood, at the size it is drawn', () => {
	const { D, sim, rally } = world( { wreckage: true } ), S = D.structures;
	const near = r => Math.hypot( r.center.x - PIER[ 0 ], r.center.z - PIER[ 1 ] );
	const houses = S.records.filter( r => r.progressive ).sort( ( a, b ) => near( a ) - near( b ) ).slice( 0, 3 );
	assert.equal( houses.length, 3, 'three houses stand by the pier' );
	// Every part of three houses fails at once; the director releases them at its own rate (Structures.releasePieces).
	for ( const r of houses ) for ( const c of ( r.components ??= S.components( r ) ) ) { c.failed = true; r.onFail( c ); }
	sim.set_disaster_loads( new Float32Array() );
	const fall = follow(), dt = 1 / 60;
	for ( let f = 0; f < 60 * 5; f ++ ) {
		S.releasePieces( dt );
		if ( rally.stale ) rally.refresh();
		// A part is first read where it is released, before the solver has moved it.
		read( sim, S.bodies, ( b, y, low ) => { if ( ! fall.start.has( b.id ) ) fall.start.set( b.id, { y, low } ); } );
		sim.advance( dt, 0, 0, 0, 1 );
		read( sim, S.bodies, fall.each ); fall.close();
		S.sync( sim.prop_poses() );
	}
	const w = fall.worst, parts = [ ...S.bodies.values() ];
	assert.ok( parts.length >= 8, `the three houses release ${ parts.length } parts as bodies` );
	assert.ok( w.centre <= .05, `${ parts.length } parts of three houses fell with no load and the centre of one rose ${ w.centre.toFixed( 2 ) } m above where it was released` );
	assert.ok( w.excess <= 0, `${ parts.length } parts of three houses fell with no load and held ${ ( w.kinetic / 1000 ).toFixed( 2 ) } kJ of kinetic energy when they had lost ${ ( w.lost / 1000 ).toFixed( 2 ) } kJ of height (5 % over allowed); the fastest reached ${ w.speed.toFixed( 1 ) } m/s` );
	for ( const b of parts ) {
		// The collider is the fitted box of the part as drawn, less only what stands under the ground (its buried end,
		// taken off the box's most upright axis).
		const frame = memberFrame( b.piece.spans ), drawn = frame.half, upright = frame.axes.map( a => Math.abs( a.y ) ), j = upright.indexOf( Math.max( ...upright ) );
		for ( let k = 0; k < 3; k ++ ) {
			const buried = k === j ? b.foundationCut / ( 2 * Math.max( .01, upright[ j ] ) ) : 0, short = Math.max( MIN_HALF, drawn.getComponent( k ) ) - b.half.getComponent( k );
			assert.ok( short > - 1e-6 && short <= buried + 1e-6, `the ${ b.piece.kind } of ${ b.name } collides as a box of half ${ b.half.toArray().map( x => x.toFixed( 2 ) ).join( ' x ' ) } m and is drawn as one of half ${ drawn.toArray().map( x => x.toFixed( 2 ) ).join( ' x ' ) } m, with ${ b.foundationCut.toFixed( 2 ) } m under the ground` );
		}
	}
} );
