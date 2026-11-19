// What the tornado does to real bodies (src/disasters/TornadoVortex.js through DisasterField), in the
// real WASM solver (public/rally) and, for the tree, the real Bodies director and Disasters.loads: light
// sheet debris is carried up, thrown out of the core and falls; a mature broadleaf is felled and not
// carried aloft; at the 120 m/s limit heavy pieces may be thrown, and they land. Nothing is airborne
// when the event is over, because nothing is held on rails: the event lasts until the vortex has
// decayed and lofted debris has had time to fall. SI units; heights are above the flat test ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';
import { Vector3, Group } from '../src/engine/index.js';
import { DisasterBodies } from '../src/disasters/Bodies.js';
import { Disasters } from '../src/disasters/Disasters.js';
import { DisasterField } from '../src/disasters/Field.js';
import { treeMassProperties } from '../src/disasters/TreeMass.js';
import { tornadoLifecycle } from '../src/disasters/TornadoFunnel.js';
import { buildPalmNear } from '../src/world/vegetation/PlantGeometry.js';
import { createPlantLeafMaterial } from '../src/world/vegetation/VegMaterials.js';
import { VegType } from '../src/world/vegetation/InstanceLOD.js';
await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );

const GROUND = 100; // m, flat test ground
const DT = 1 / 40; // s: the longest frame a disaster is advanced by (SimulationPacing caps it at 25 ms)
const motionOf = ( sim, id ) => {

	const a = sim.disaster_motion();
	for ( let i = 0; i < a.length; i += 7 ) if ( a[ i ] === id ) return a.slice( i + 1, i + 7 );
	return null;

};

// Loose pieces driven as Disasters.loads drives a woken prop with no load points: the field's quadratic
// drag at the centre of mass, the ground acceleration only while supported.
function runPieces( config, pieces ) {

	const sim = new RallyPhysics(), field = new DisasterField( () => GROUND );
	try {

		sim.set_terrain( new Float32Array( 25 ).fill( GROUND ), 5, 4000, - 2000 );
		sim.reset( 1500, GROUND + 10, 1500, 0 );
		const e = field.start( 'tornado', config );
		const wake = ( p, y ) => { sim.wake_prop( p.id, 0, new Float32Array( p.half ), new Float32Array( [ p.x, y, p.z, 0, 0, 0, 1, 0, 0, 0 ] ), p.mass, 0.6, 0, false ); p.awake = true; };
		for ( const p of pieces ) {

			Object.assign( p, { top: 0, out: 0, awake: false } );
			// a piece with a release is held in place (a roof sheet on its battens) until the wind at it passes its failure wind
			if ( ! p.release ) wake( p, GROUND + p.half[ 1 ] + 0.01 );

		}
		const loads = new Float32Array( pieces.length * 7 ), sample = {}, at = { x: 0, y: 0, z: 0 }, v = { x: 0, y: 0, z: 0 };
		let frames = 0;
		while ( field.events.has( 'tornado' ) && frames < 400 / DT ) {

			field.advance( DT );
			const supported = new Set( sim.disaster_supported() ), c = field.events.has( 'tornado' ) ? field.center( e ) : null;
			pieces.forEach( ( p, k ) => {

				if ( ! p.awake ) {

					const s = field.sampleRaw( p.x, GROUND + p.release.height, p.z, sample );
					if ( p.release.time !== undefined ? e.time >= p.release.time : Math.hypot( s.wx, s.wz ) > p.release.wind ) { wake( p, GROUND + p.release.height ); p.releasedAt = e.time; }
					loads.set( [ p.id, 0, 0, 0, 0, 0, 0 ], k * 7 );
					return;

				}
				const m = motionOf( sim, p.id );
				at.x = m[ 0 ]; at.y = m[ 1 ]; at.z = m[ 2 ]; v.x = m[ 3 ]; v.y = m[ 4 ]; v.z = m[ 5 ];
				const a = field.acceleration( at, v, { mass: p.mass, area: p.area, volume: 0, height: 2 * p.half[ 1 ], buoyancy: false, supported: supported.has( p.id ), dt: DT }, sample );
				loads.set( [ p.id, p.mass * a.ax, p.mass * a.ay, p.mass * a.az, 0, 0, 0 ], k * 7 );
				const h = m[ 1 ] - GROUND;
				if ( h > p.top ) { p.top = h; p.topRadius = c ? Math.hypot( m[ 0 ] - c.x, m[ 2 ] - c.z ) : 0; }
				if ( c && h > 2 ) p.out = Math.max( p.out, Math.hypot( m[ 0 ] - c.x, m[ 2 ] - c.z ) );

			} );
			sim.set_disaster_loads( loads );
			for ( let i = 0; i < 3; i ++ ) sim.advance( DT / 3, 0, 0, 0, 0 );
			frames ++;

		}
		const end = e.time;
		for ( const p of pieces ) {

			const m = motionOf( sim, p.id );
			if ( ! m ) { p.final = { h: p.release.height, speed: 0, travel: 0 }; continue; }
			p.final = { h: m[ 1 ] - GROUND - p.half[ 1 ], speed: Math.hypot( m[ 3 ], m[ 4 ], m[ 5 ] ), travel: Math.hypot( m[ 0 ] - p.x, m[ 2 ] - p.z ) };

		}
		return { end, duration: e.duration, rmax: e.radius * 0.18 };

	} finally { sim.free(); }

}

// A 1.2 x 2.4 m roofing sheet of 6 kg/m^2 (the loose-panel mass rule, docs/disasters.md), tumbling: mean
// projected area half its face. Terminal fall speed about 13 m/s. Sheet debris comes off roofs: it is held
// 5 m up until the wind there passes the roof-cover failure wind, 43.5 m/s (BuildingComponents KINDS, EF DI 2).
const sheet = ( id, x, z, release = { height: 5, wind: 43.5 } ) => ( { id, x, z, half: [ 1.2, 0.01, 0.6 ], mass: 6 * 2.88, area: 1.44, release } );

test( 'Roof sheets torn off by the default tornado are thrown and land; none is airborne when it is over', ( t ) => {

	// sheets on roofs across the track ahead of a 65 m/s tornado moving +x at 3 m/s
	const pieces = [];
	for ( let k = 0; k < 16; k ++ ) pieces.push( sheet( 300 + k, 40 + ( k % 8 ) * 14, ( k < 8 ? - 1 : 1 ) * ( 4 + ( k % 4 ) * 6 ) ) );
	const run = runPieces( { x: 0, z: 0, intensity: 65, radius: 100, speed: 3, direction: 0, duration: 60, seed: 4 }, pieces );
	const report = pieces.map( ( p ) => `${ p.id - 300 }: torn off at ${ p.releasedAt?.toFixed( 1 ) } s, up ${ p.top.toFixed( 0 ) } m, out to ${ p.out.toFixed( 0 ) } m, ends ${ p.final.h.toFixed( 2 ) } m up at ${ p.final.speed.toFixed( 1 ) } m/s, ${ p.final.travel.toFixed( 0 ) } m away` ).join( '; ' );
	t.diagnostic( report );
	assert.ok( pieces.filter( ( p ) => p.final.travel > 20 ).length >= 12, `fewer than 12 of 16 torn-off sheets were thrown 20 m: ${ report }` );
	for ( const p of pieces ) assert.ok( p.final.h < 1 && p.final.speed < 3, `sheet ${ p.id - 300 } is still ${ p.final.h.toFixed( 1 ) } m up at ${ p.final.speed.toFixed( 1 ) } m/s when the event ends at ${ run.end.toFixed( 1 ) } s: ${ report }` );
	assert.ok( run.end > run.duration, `the event ended at ${ run.end.toFixed( 1 ) } s, before its vortex had decayed at ${ run.duration } s` );

} );

test( 'Sheet debris caught in the core of the default tornado is carried up, thrown out of the core and falls before the event is over', ( t ) => {

	// eight sheets in the corner flow, 8 m up and inside the radius of maximum wind (18 m), in the mature stage
	const config = { x: 0, z: 0, intensity: 65, radius: 100, speed: 0, direction: 0, duration: 60, seed: 4 }, pieces = [];
	const mature = tornadoLifecycle( { ...config, kind: 'tornado', time: 0 }, {} ).genesis + 2;
	for ( let k = 0; k < 8; k ++ ) {

		const a = k * Math.PI / 4, r = 6 + ( k % 4 ) * 3;
		pieces.push( sheet( 500 + k, Math.cos( a ) * r, Math.sin( a ) * r, { height: 8, time: mature } ) );

	}
	const run = runPieces( config, pieces );
	const report = pieces.map( ( p ) => `${ p.id - 500 }: up ${ p.top.toFixed( 0 ) } m (at ${ p.topRadius?.toFixed( 0 ) } m from the axis), out to ${ p.out.toFixed( 0 ) } m, ends ${ p.final.h.toFixed( 2 ) } m up at ${ p.final.speed.toFixed( 1 ) } m/s` ).join( '; ' );
	t.diagnostic( report );
	const lofted = pieces.filter( ( p ) => p.top > 20 );
	assert.ok( lofted.length >= 6, `only ${ lofted.length } of 8 sheets in the core were carried above 20 m: ${ report }` );
	for ( const p of lofted ) assert.ok( p.out > 2 * run.rmax, `sheet ${ p.id - 500 } rose to ${ p.top.toFixed( 0 ) } m and stayed within ${ p.out.toFixed( 0 ) } m of the axis: ${ report }` );
	for ( const p of pieces ) assert.ok( p.final.h < 1 && p.final.speed < 3, `sheet ${ p.id - 500 } is still ${ p.final.h.toFixed( 1 ) } m up at ${ p.final.speed.toFixed( 1 ) } m/s when the event ends at ${ run.end.toFixed( 1 ) } s: ${ report }` );

} );

test( 'At the 120 m/s limit heavy pieces may be thrown, and every piece has landed when the event is over', ( t ) => {

	const pieces = [];
	for ( let k = 0; k < 6; k ++ ) pieces.push( sheet( 400 + k, 30 + k * 10, ( k % 2 ? 1 : - 1 ) * 10 ) );
	// a 400 kg steel tank on its side and a 1.5 t car-sized box (bluff, Cd 1.1, side area)
	pieces.push( { id: 420, x: 45, z: 12, half: [ 1, 0.7, 0.7 ], mass: 400, area: 2.8 } );
	pieces.push( { id: 421, x: 60, z: - 12, half: [ 2.2, 0.7, 0.9 ], mass: 1500, area: 6.2 } );
	const run = runPieces( { x: 0, z: 0, intensity: 120, radius: 100, speed: 3, direction: 0, duration: 60, seed: 9 }, pieces );
	const report = pieces.map( ( p ) => `${ p.id }: up ${ p.top.toFixed( 0 ) } m, ends ${ p.final.h.toFixed( 2 ) } m up at ${ p.final.speed.toFixed( 1 ) } m/s, ${ p.final.travel.toFixed( 0 ) } m away` ).join( '; ' );
	t.diagnostic( report );
	for ( const p of pieces ) assert.ok( p.final.h < 1 && p.final.speed < 3, `piece ${ p.id } is still ${ p.final.h.toFixed( 1 ) } m up at ${ p.final.speed.toFixed( 1 ) } m/s when the event ends at ${ run.end.toFixed( 1 ) } s: ${ report }` );
	assert.ok( pieces.some( ( p ) => p.final.travel > 20 ), `nothing was thrown at 120 m/s: ${ report }` );

} );

// The real Bodies director and its tree failure (TreeFailure.js), as test/tree-failure.mjs drives it.
function treeFixture( record, seed ) {

	const sim = new RallyPhysics();
	sim.set_terrain( new Float32Array( 25 ).fill( GROUND ), 5, 4000, - 2000 );
	sim.reset( 1500, GROUND + 10, 1500, 0 );
	const { geometry } = buildPalmNear(), type = new VegType( 'canopy', [ record ], { near: [ { geometry, material: createPlantLeafMaterial() } ], fade: [ 100, 110 ] } );
	const app = { scene: new Group(), camera: { position: new Vector3( record.x, GROUND + 2, record.z - 30 ) }, vegetation: { canopy: type, records: { trees: [ record ] } }, terrainData: { heightAt: () => GROUND }, rally: { physics: sim, supports: [], profile: { mass: 1500 }, requestIslandColliders() {} } };
	const field = new DisasterField( () => GROUND ), owner = { field, runSeed: seed };
	const bodies = new DisasterBodies( app, owner );
	const director = { app, field, structures: { bodies: new Map() }, bodies, restored: false, limited: 0, peakForce: 0, rawPeakForce: 0, touched: new Set(), bodyOptions: Disasters.prototype.bodyOptions };
	return { sim, field, bodies, director };

}

test( 'A mature broadleaf is felled by the default tornado and is not carried aloft; it rests on the ground when the event is over', ( t ) => {

	const record = { x: 0, y: GROUND, z: 0, s: 1, sy: 1, yaw: 0.4, H: 12.5, seed: 0.3, la: 0, l: 0 };
	const mass = treeMassProperties( record, 'canopy' ).mass;
	assert.ok( mass > 600 && mass < 1200, `the 12.5 m broadleaf weighs ${ mass.toFixed( 0 ) } kg` );
	for ( const [ intensity, seed ] of [ [ 65, 21 ], [ 120, 22 ] ] ) {

		const f = treeFixture( { ...record }, seed );
		try {

			// the tree stands on the track, 18 m (the radius of maximum wind) to the side of the axis
			const e = f.field.start( 'tornado', { x: - 120, z: - 18, intensity, radius: 100, speed: 3, direction: 0, duration: 60, seed } );
			let top = - Infinity, start = null, frames = 0, body = null;
			while ( f.field.events.has( 'tornado' ) && frames < 400 / DT ) {

				f.field.advance( DT );
				f.bodies.update( DT );
				Disasters.prototype.loads.call( f.director, DT );
				f.sim.advance( DT, 0, 0, 0, 0 );
				f.bodies.sync( f.sim.prop_poses() );
				body = [ ...f.bodies.bodies.values() ].find( ( b ) => b.kind === 'tree' ) ?? body;
				if ( body ) {

					const com = body.position.clone().add( new Vector3().fromArray( body.centerOfMass ?? [ 0, 0, 0 ] ).applyQuaternion( body.quaternion ) );
					start ??= com.y - GROUND;
					top = Math.max( top, com.y - GROUND );

				}
				frames ++;

			}
			const tree = f.bodies.trees[ 0 ];
			t.diagnostic( `${ intensity } m/s: ${ mass.toFixed( 0 ) } kg broadleaf ${ tree.mode }, released centre of mass ${ start?.toFixed( 1 ) } m, highest ${ top.toFixed( 1 ) } m, event over at ${ e.time.toFixed( 1 ) } s` );
			assert.ok( tree.mode === 'uproot' || tree.mode === 'snap', `${ intensity } m/s: the broadleaf was ${ tree.mode ?? 'left standing' }` );
			if ( body ) {

				const com = body.position.clone().add( new Vector3().fromArray( body.centerOfMass ?? [ 0, 0, 0 ] ).applyQuaternion( body.quaternion ) );
				const lift = intensity <= 65 ? 1 : 15; // m above its centre of mass when released
				assert.ok( top <= start + lift, `${ intensity } m/s: the released tree's centre of mass rose from ${ start.toFixed( 1 ) } to ${ top.toFixed( 1 ) } m` );
				assert.ok( com.y - GROUND < 4, `${ intensity } m/s: the tree's centre of mass is ${ ( com.y - GROUND ).toFixed( 1 ) } m up when the event ends at ${ e.time.toFixed( 1 ) } s` );

			}

		} finally { f.bodies.reset(); f.sim.free(); }

	}

} );
