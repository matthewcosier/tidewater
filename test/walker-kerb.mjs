// Walkers wait at the kerb for a car they can see coming (docs/people.md, Solid trunks, cars and room). A townsperson
// whose next step is in a moving car's road waits where they stand, outside the band the car stops for, and crosses
// behind it; one already in the car's band walks on and the car waits for them, so the two never wait for each
// other. Before this a walker stepped into a moving car's road and the car braked to a stop for them. Each check
// drives the real Traffic (its own blocked(), personInWay() and roadAhead(), the shipped models' drawn bodies) and
// steps a walker along a straight route as Crowd.step does, asking the crowd's own atKerb() before each step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Traffic } from '../src/ferry/Traffic.js';
import { atKerb } from '../src/ferry/Crowd.js';
import { Grid } from '../src/people/Perception.js';
import { Colliders } from '../src/world/Colliders.js';
import { Scene, Group, Vector3 } from '../src/engine/index.js';

const BODY_R = 0.27;     // m, a townsperson's capsule (Contact.js BODY_R)
const DT = 1 / 60;       // s
const PACE = 1.3;        // m/s, a walker (Crowd.add: 1.2 to 1.5)
const V = 2.2;           // m/s, a car driving aboard (the yield test's speed, Traffic.drive's easing)
const TOL = 0.02;        // m

// The shipped models' drawn extents (public/ferry/parked_cars.glb: each model's body mesh on its root node and its
// four wheels), in the group-local frame the game draws them in, as Traffic.parts holds them.
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
const PARTS = shippedParts();

// A car named `name` driving a straight road up x 0 from z0 to z1 at V, a walker on `pts` ([ x, z ] points) setting
// off at once, on flat ground, the player far away. Each frame the car first (Ferry.update runs the traffic, then
// the crowd): it stops for whatever Traffic.blocked() names and pulls away again (Traffic.drive's 4 m/s² and
// 1.5 m/s²); then the walker, who waits a frame wherever atKerb() says and otherwise walks on at PACE.
function run( name, pts, { z0 = 0, z1 = 40, secs = 30 } = {} ) {

	const path = pts.map( ( [ x, z ] ) => new Vector3( x, 0, z ) ), w = { world: path[ 0 ].clone(), posture: 'walk' };
	const grid = new Grid( 8 ), app = { colliders: new Colliders(), camera: { position: new Vector3( 0, 50, 0 ) }, scene: new Scene(), player: { mode: 'walk', position: new Vector3( 300, 0, 300 ) },
		people: { grid, list: [ w ] }, rally: { state: new Float32Array( [ 500, 0, 500, 0, 0, 0, 1, 0 ] ), forward: { x: 0, y: 0, z: 1 }, velocity: { x: 0, y: 0, z: 0 } } };
	const traffic = new Traffic( app, { berths: [], ship: null } );
	traffic.parts = PARTS;
	const g = new Group();
	g.position.set( 0, 0, z0 );
	const pts2 = [ new Vector3( 0, 0, z0 ), new Vector3( 0, 0, z1 ) ], len = z1 - z0;
	const car = { id: 1, seq: 1, name, group: g, state: 'board', slot: null, s: 0, v: V, world: g.position.clone(), local: null,
		path: { points: [ [ 'T', 0, 0, z0, V ], [ 'T', 0, 0, z1, V ] ], pts: pts2, seg: new Float64Array( [ len ] ), len } };
	traffic.cars.push( car );
	const e = traffic.extent( name );
	const out = { e, slowest: Infinity, closest: Infinity, held: 0, both: 0, walked: null, drove: null, walking: 0 };
	for ( let i = 1; i < path.length; i ++ ) out.walking += path[ i ].distanceTo( path[ i - 1 ] ) / PACE;
	let leg = 0, s = 0;
	for ( let t = 0; t < secs; t += DT ) {

		grid.clear();
		grid.add( w );
		if ( out.drove === null ) {

			const by = traffic.blocked( car, car.path.pts, car.path.seg, 0, len );
			const want = by ? 0 : V;
			car.v = want < car.v ? Math.max( want, car.v - 4 * DT ) : Math.min( want, car.v + 1.5 * DT );
			car.s = Math.min( len, car.s + car.v * DT );
			car.world.copy( pts2[ 0 ] ).lerp( pts2[ 1 ], car.s / len );
			g.position.copy( car.world );
			out.slowest = Math.min( out.slowest, car.v );
			if ( car.s >= len ) out.drove = t;

		}
		if ( out.walked === null ) {

			const a = path[ leg ], b = path[ leg + 1 ];
			if ( atKerb( traffic, w.world, b.x - a.x, b.z - a.z ) ) {

				w.posture = 'stand';
				out.held += DT;
				if ( car.by === 'person' && out.drove === null ) out.both += DT;

			} else {

				w.posture = 'walk';
				s += PACE * DT;
				while ( out.walked === null && s >= path[ leg + 1 ].distanceTo( path[ leg ] ) ) {

					s -= path[ leg + 1 ].distanceTo( path[ leg ] );
					leg ++;
					if ( leg === path.length - 1 ) { out.walked = t; s = 0; }

				}
				if ( out.walked === null ) w.world.copy( path[ leg ] ).lerp( path[ leg + 1 ], s / path[ leg + 1 ].distanceTo( path[ leg ] ) );
				else w.world.copy( path.at( - 1 ) );

			}

		}
		// how far the walker's centre is outside the car's drawn body (it faces +z, unturned); inside when negative
		const dx = w.world.x - car.world.x, dz = w.world.z - car.world.z;
		out.closest = Math.min( out.closest, Math.max( e.min.x - dx, dx - e.max.x, e.min.z - dz, dz - e.max.z ) );

	}
	return out;

}

test( 'A walker crossing the road of a car coming at them waits at the kerb and crosses behind it, and the car drives on without stopping', () => {

	const bad = [];
	for ( const name of PARTS.keys() ) {

		const r = run( name, [ [ - 6, 14 ], [ 6, 14 ] ] );
		if ( r.slowest < V - 0.2 ) bad.push( `${ name }: the car slowed to ${ r.slowest.toFixed( 2 ) } m/s for the walker (the walker waited ${ r.held.toFixed( 2 ) } s)` );
		if ( r.closest < BODY_R - TOL ) bad.push( `${ name }: the walker's centre came within ${ r.closest.toFixed( 2 ) } m of the car's body` );
		if ( r.walked === null || r.drove === null ) bad.push( `${ name }: the walker ${ r.walked === null ? 'never got across' : 'crossed' } and the car ${ r.drove === null ? 'never got there' : 'got there' } in 30 s` );

	}
	assert.deepEqual( bad, [], 'the walker stepped into the car\'s road' );

} );

test( 'A walker already in a car\'s lane walks on out of it while the car waits for them: neither waits for the other for ever', () => {

	const bad = [];
	const e = run( 'ParkedVan', [ [ 0, 0 ], [ 0, 0.1 ] ] ).e;
	for ( const [ what, pts, z0 ] of [
		[ 'walking up the lane ahead of the car, then out of it', [ [ 0.2, 8 ], [ 0.2, 16 ], [ 5, 16 ] ], 0 ],
		[ 'setting off across the lane from inside the band the car stops for', [ [ - ( e.half + 0.2 ), 12 ], [ 6, 12 ] ], 4 ],
	] ) {

		const r = run( 'ParkedVan', pts, { z0 } );
		if ( r.walked === null || r.walked > r.walking + 0.5 ) bad.push( `${ what }: the walker took ${ r.walked?.toFixed( 2 ) ?? 'over 30' } s for a ${ r.walking.toFixed( 2 ) } s walk (held ${ r.held.toFixed( 2 ) } s)` );
		if ( r.both > 0 ) bad.push( `${ what }: walker and car waited for each other for ${ r.both.toFixed( 2 ) } s` );
		if ( r.drove === null ) bad.push( `${ what }: the car never got to the end of its road in 30 s` );
		if ( r.closest < BODY_R - TOL ) bad.push( `${ what }: the walker's centre came within ${ r.closest.toFixed( 2 ) } m of the car's body` );

	}
	assert.deepEqual( bad, [], 'the walker and the car held each other up' );

} );
