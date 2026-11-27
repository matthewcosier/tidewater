import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { CoastalRoad } from '../src/world/CoastalRoad.js';
import { Colliders } from '../src/world/Colliders.js';
import { Rocks } from '../src/world/Rocks.js';
import { applyTerminalSite, Terminal, PLACES } from '../src/ferry/Terminal.js';
import { JOEY_VILLAGE_SITE } from '../src/joey/Village.js';
import { verifySites } from '../src/windfarm/Sites.js';
import { trunkCylinders } from '../src/rally/WorldPhysics.js';
import { VEHICLES } from '../src/rally/Vehicles.js';
import { loadModel } from '../src/rally/VehicleModel.js';
import { makePiece, stepPiece } from '../src/rally/Wreckage.js';
import { Scene, Vector3 } from '../src/engine/index.js';

const terrain = new TerrainData();
for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
applyTerminalSite( terrain, JOEY_VILLAGE_SITE, PLACES.joey );
const beforeHeights = Float32Array.from( terrain.heights );
const route = new CoastalRoute( terrain );

test( 'Expanded island road network spans over 8.5 km with all named routes and clear spawns', () => {
	const total = route.paths.reduce( ( sum, p ) => sum + ( p.points.at( - 1 )?.distance || 0 ), 0 );
	assert.ok( route.totalLength > 8500 && Math.abs( route.totalLength - total ) < 1,
		`expected expanded road network > 8500 m, got totalLength=${ route.totalLength } (sum=${ total.toFixed( 0 ) } m)` );
	for ( const name of [ 'westHeadland', 'islandHighway', 'mountainPass', 'eastHeadland', 'rallyStage', 'joeyPeninsula' ] ) {
		const path = route.paths.find( p => p.name === name );
		assert.ok( path, `missing road path ${ name }` );
		assert.ok( path.points.at( - 1 ).distance > 500, `${ name } too short: ${ path.points.at( - 1 ).distance.toFixed( 0 ) } m` );
	}
	for ( const start of [ 'westHeadland', 'northCoast', 'mountainPass', 'rallyStage', 'joeyPeninsula' ] ) {
		const spot = route.spawn( start );
		const surface = terrain.roadSurfaceAt( spot.x, spot.z );
		assert.ok( surface, `spawn ${ start } is not on a road surface` );
		const fx = Math.sin( spot.yaw ), fz = Math.cos( spot.yaw );
		const hs = [ [ - 2.7, - 1.3 ], [ - 2.7, 1.3 ], [ 2.7, - 1.3 ], [ 2.7, 1.3 ] ].map(
			( [ a, b ] ) => terrain.heightAt( spot.x + fx * a + fz * b, spot.z + fz * a - fx * b ) );
		assert.ok( Math.min( ...hs ) > 1.2 && Math.max( ...hs ) - Math.min( ...hs ) < 0.7,
			`spawn ${ start } has invalid footprint heights: ${ hs.map( h => h.toFixed( 2 ) ) }` );
	}
	// Wind turbine sites remain strictly untouched and valid.
	const turbines = verifySites( terrain );
	assert.equal( turbines.length, 3 );
} );

test( 'Every expanded road grades smoothly without cliffs, vertical kinks or surface drift', () => {
	const { res, heights } = terrain;
	const walls = [];
	for ( let z = 1; z < res - 1; z ++ ) for ( let x = 1; x < res - 1; x ++ ) {
		const i = z * res + x;
		for ( const j of [ i + 1, i + res ] ) {
			if ( heights[ i ] === beforeHeights[ i ] && heights[ j ] === beforeHeights[ j ] ) continue;
			const step = Math.abs( heights[ i ] - heights[ j ] ), nat = Math.abs( beforeHeights[ i ] - beforeHeights[ j ] );
			if ( step > Math.max( 1.4, nat + 0.2 ) ) walls.push( `${ step.toFixed( 2 ) } m at (${ x },${ z })` );
		}
	}
	assert.equal( walls.length, 0, `${ walls.length } graded walls, e.g. ${ walls.slice( 0, 4 ).join( '; ' ) }` );
	let worstDrift = 0;
	for ( const s of route.segments ) for ( let t = 0; t <= 1; t += 0.5 ) {
		const x = s.a.x + ( s.b.x - s.a.x ) * t, z = s.a.z + ( s.b.z - s.a.z ) * t, h = s.a.h + ( s.b.h - s.a.h ) * t;
		worstDrift = Math.max( worstDrift, Math.abs( terrain.heightAt( x, z ) - h ) );
	}
	assert.ok( worstDrift < 0.12, `road surface drifts ${ worstDrift.toFixed( 3 ) } m from graded profile` );
} );

test( 'Leaning palm trunks align with the shader curve and tree trunks match visual girth and block walkers', () => {
	const flat = { heightAt: () => 5 };
	const leanPalm = { x: 10, z: 20, s: 1.0, la: 0.4, l: 0.35, H: 10, seed: 0.5 };
	const tree = { x: 40, z: 50, s: 1.2, H: 14 };
	const trunks = trunkCylinders( { records: { palms: [ leanPalm ], trees: [ tree ] } }, flat );
	// Exact VegNodes.js stem curve at y = 1.0 m above ground (u = 0.1)
	const c = ( leanPalm.seed * 7.31 ) % 1, u = 1.0 / leanPalm.H;
	const fc = u + ( u * ( 2 - u ) - u ) * c;
	const expectedX = leanPalm.x + Math.cos( leanPalm.la ) * leanPalm.l * fc * leanPalm.H;
	const expectedZ = leanPalm.z + Math.sin( leanPalm.la ) * leanPalm.l * fc * leanPalm.H;
	let bestErr = Infinity, treeRadius = 0;
	for ( let i = 0; i < trunks.length; i += 5 ) {
		const [ x, z, r, yMin, yMax ] = [ trunks[ i ], trunks[ i + 1 ], trunks[ i + 2 ], trunks[ i + 3 ], trunks[ i + 4 ] ];
		if ( yMin <= 6.0 && yMax >= 6.0 && Math.hypot( x - leanPalm.x, z - leanPalm.z ) < 5 ) {
			bestErr = Math.min( bestErr, Math.hypot( x - expectedX, z - expectedZ ) );
		}
		if ( Math.hypot( x - tree.x, z - tree.z ) < 1 ) treeRadius = Math.max( treeRadius, r );
	}
	assert.ok( bestErr < 0.18, `leaning palm trunk collider misses visual trunk at y=1m by ${ bestErr.toFixed( 3 ) } m` );
	assert.ok( treeRadius >= 0.34 * tree.s, `tree trunk collider radius ${ treeRadius.toFixed( 3 ) } m is undersized for scale ${ tree.s }` );
	// Walker collision blocks against registered trunks.
	const colliders = new Colliders();
	assert.equal( typeof colliders.setTrunks, 'function', 'Colliders must accept trunk cylinders for walker collision' );
	colliders.setTrunks( trunks );
	const walker = new Vector3( tree.x + 0.1, 5.0, tree.z );
	assert.equal( colliders.resolveCapsule( walker, 0.3, 1.75 ), true, 'walker passed through tree trunk' );
	assert.ok( Math.hypot( walker.x - tree.x, walker.z - tree.z ) >= treeRadius + 0.29 );
} );

test( 'Roadside guide posts, parked terminal cars, terminal gate posts and medium rocks register solid colliders', async () => {
	const colliders = new Colliders();
	const scene = new Scene();
	const road = new CoastalRoad( scene, terrain, route, colliders );
	assert.ok( colliders.cylinders.filter( c => c.tag === 'guide-post' ).length > 40,
		'roadside guide posts must register solid colliders' );

	// Terminal parked cars and gate posts
	const app = { scene, colliders };
	const terminal = new Terminal( app, 'tidewater' );
	const colData = JSON.parse( await readFile( new URL( '../public/ferry/terminal_colliders.json', import.meta.url ), 'utf8' ) );
	terminal.addColliders( colData );
	// Gate posts at terminal glTF (1.4, -93) and (-7.6, -93) -> world (151.4, 207) and (142.4, 207)
	const gatePosts = colliders.boxes.filter( b => b.tag === 'terminal-post' )
		.concat( colliders.cylinders.filter( c => c.tag === 'terminal-post' ) );
	assert.ok( gatePosts.length >= 15, `expected solid terminal gate posts, bollards and lamp posts, got ${ gatePosts.length }` );

	const bytes = await readFile( new URL( '../public/ferry/parked_cars.glb', import.meta.url ) );
	globalThis.__assetFile = () => bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
	try {
		const parkedModel = await loadModel( 'parked_cars' );
		terminal.park( parkedModel );
	} finally { delete globalThis.__assetFile; }
	const parkedBoxes = colliders.boxes.filter( b => b.tag === 'parked-terminal-car' && b.solid );
	assert.equal( parkedBoxes.length, terminal.parkedCount, 'every parked terminal car must have a solid collider' );
	assert.ok( parkedBoxes.length > 40, `expected > 40 parked car colliders, got ${ parkedBoxes.length }` );

	// Medium rocks (0.6..0.9 m) get solid colliders sized close to visual radius
	const rockColliders = new Colliders();
	const rocks = new Rocks( { scene: new Scene(), terrain, colliders: rockColliders, sunShadow: false } );
	const medium = rocks.instances.filter( r => r.size >= 0.6 && r.size < 0.9 && r.y + r.size * r.sy * 0.8 >= - 0.3 );
	assert.ok( medium.length > 20, 'island has medium rocks' );
	const covered = medium.filter( r => rockColliders.cylinders.some( c => Math.hypot( c.x - r.x, c.z - r.z ) < 0.05 && c.radius >= r.size * 0.88 ) );
	assert.equal( covered.length, medium.length, `only ${ covered.length }/${ medium.length } medium rocks have accurate colliders` );
} );

test( 'Vehicle collision hulls match rendered GLB widths and lengths within 15 cm', async () => {
	for ( const [ key, v ] of Object.entries( VEHICLES ) ) {
		const bytes = await readFile( new URL( `../public/rally/${ v.file }.glb`, import.meta.url ) );
		globalThis.__assetFile = () => bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
		let m;
		try { m = await loadModel( key ); } finally { delete globalThis.__assetFile; }
		m.root.updateMatrixWorld( true );
		let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;
		m.root.traverse( o => {
			if ( ! o.isMesh || ! o.geometry?.attributes?.position ) return;
			for ( let p = o; p; p = p.parent ) if ( /wheel|tyre|tire|brake|caliper|rotor|hub/i.test( p.name || '' ) ) return;
			const pos = o.geometry.attributes.position, mat = o.matrixWorld.elements;
			for ( let i = 0; i < pos.count; i ++ ) {
				const lx = pos.getX( i ), ly = pos.getY( i ), lz = pos.getZ( i );
				const x = mat[ 0 ] * lx + mat[ 4 ] * ly + mat[ 8 ] * lz + mat[ 12 ];
				const z = mat[ 2 ] * lx + mat[ 6 ] * ly + mat[ 10 ] * lz + mat[ 14 ];
				minX = Math.min( minX, x ); maxX = Math.max( maxX, x ); minZ = Math.min( minZ, z ); maxZ = Math.max( maxZ, z );
			}
		} );
		const visW = maxX - minX, visL = maxZ - minZ;
		assert.ok( Math.abs( v.hull[ 0 ] - visW ) <= 0.15, `${ key } hull width ${ v.hull[ 0 ] } vs visual ${ visW.toFixed( 2 ) }` );
		assert.ok( Math.abs( v.hull[ 1 ] - visL ) <= 0.15, `${ key } hull length ${ v.hull[ 1 ] } vs visual ${ visL.toFixed( 2 ) }` );
	}
} );

test( 'Detached wreckage bounces off solid world colliders instead of passing through walls', () => {
	const flat = { heightAt: () => 5, normalAt: ( x, z, out ) => out.set( 0, 1, 0 ) };
	const colliders = new Colliders();
	colliders.addBox( new Vector3( 0, 6, 3.5 ), new Vector3( 5, 2, 0.5 ), 0, { solid: true, tag: 'wall' } ); // face at z = 3.0
	const piece = makePiece( { position: new Vector3( 0, 5.5, 1.0 ), velocity: new Vector3( 0, 0.5, 12 ), radius: 0.35 } );
	for ( let i = 0; i < 60; i ++ ) stepPiece( piece, 1 / 60, flat, 0, null, colliders );
	assert.ok( piece.pos.z < 3.0, `wreckage passed through wall at z=3.0 to z=${ piece.pos.z.toFixed( 2 ) }` );
} );
