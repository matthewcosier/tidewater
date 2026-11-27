import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { Colliders } from '../src/world/Colliders.js';
import { applyTerminalSite, PLACES, terminalToWorld, BERTH } from '../src/ferry/Terminal.js';
import { JOEY_VILLAGE_SITE } from '../src/joey/Village.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { FerryShip } from '../src/ferry/FerryShip.js';
import { Autopilot } from '../src/ferry/FerryService.js';
import { Scene, Vector3 } from '../src/engine/index.js';
import { BRIDGE, StraitBridge } from '../src/world/StraitBridge.js';

await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );

const terrain = new TerrainData();
for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
applyTerminalSite( terrain, JOEY_VILLAGE_SITE, PLACES.joey );
const beforeHeights = Float32Array.from( terrain.heights );
const route = new CoastalRoute( terrain );
const colliders = new Colliders();
const scene = new Scene();
const bridge = new StraitBridge( scene, terrain, colliders );

test( 'Both scheduled ferry crossings pass cleanly under the suspension bridge main span with real air-draft and pier clearance', () => {
	const tw = terminalToWorld( BERTH, undefined, WORLD.ferryTerminal );
	const jy = terminalToWorld( BERTH, undefined, WORLD.joeyTerminal );
	const bTW = { x: tw.x, z: tw.z, yaw: WORLD.ferryTerminal.yaw };
	const bJY = { x: jy.x, z: jy.z, yaw: WORLD.joeyTerminal.yaw };
	const mastTop = 20.25; // measured top of radar mast in public/ferry/ferry.glb
	const [ t1x, t1z ] = BRIDGE.worldXZ( BRIDGE.T1, 0 );
	const [ t2x, t2z ] = BRIDGE.worldXZ( BRIDGE.T2, 0 );

	for ( const [ label, from, to ] of [ [ 'Tidewater->Joey', bTW, bJY ], [ 'Joey->Tidewater', bJY, bTW ] ] ) {
		const ship = new FerryShip( from );
		const pilot = new Autopilot();
		pilot.route( ship, to, from );
		let crossed = false, minAirDraft = Infinity, minTowerDist = Infinity, totalImpacts = 0;
		for ( let step = 0; step < 1200; step ++ ) {
			pilot.steer( ship );
			ship.step( 0.25, { terrain, colliders } );
			totalImpacts += ship.takeImpacts().length;
			const d1 = Math.hypot( ship.position.x - t1x, ship.position.z - t1z );
			const d2 = Math.hypot( ship.position.x - t2x, ship.position.z - t2z );
			minTowerDist = Math.min( minTowerDist, d1, d2 );
			const dx = ship.position.x - BRIDGE.P0[ 0 ], dz = ship.position.z - BRIDGE.P0[ 1 ];
			const s = dx * BRIDGE.ux + dz * BRIDGE.uz;
			const lat = Math.abs( dx * BRIDGE.uz - dz * BRIDGE.ux );
			if ( lat < 18 ) {
				crossed = true;
				assert.ok( s > BRIDGE.T1 + 25 && s < BRIDGE.T2 - 25,
					`${ label } crossed outside main span at s=${ s.toFixed( 1 ) } m` );
				const soffit = BRIDGE.deckY( s ) - BRIDGE.GIRDER_DEPTH;
				minAirDraft = Math.min( minAirDraft, soffit - mastTop );
			}
			if ( Math.hypot( ship.position.x - to.x, ship.position.z - to.z ) < 3 && ship.speed < 0.6 ) break;
		}
		assert.equal( crossed, true, `${ label } must sail underneath the suspension bridge` );
		assert.equal( totalImpacts, 0, `${ label } struck bridge piers (${ totalImpacts } impacts)` );
		assert.ok( minTowerDist > 45, `${ label } passed within ${ minTowerDist.toFixed( 1 ) } m of a bridge tower` );
		assert.ok( minAirDraft > 8.0, `${ label } air-draft margin above 20.25 m mast is only ${ minAirDraft.toFixed( 1 ) } m` );
	}
} );

test( 'A real WASM car drives smoothly across the entire 650 m suspension bridge on continuous asphalt without launch or drop-through', () => {
	const physics = new RallyPhysics();
	try {
		assert.ok( physics.set_terrain( terrain.heights, terrain.res, terrain.size, terrain.origin ) );
		assert.ok( physics.set_roads( route.physicsData() ) );
		const statics = colliders.boxes.filter( b => ( b.solid || b.walkable ) && ! b.prop && b.tag !== 'bridge-deck' && b.tag !== 'bridge-rail' );
		physics.add_surface_boxes( new Float32Array( statics.flatMap( b => [
			b.center.x, b.center.y, b.center.z, b.half.x, b.half.y, b.half.z, b.rotY, 0.65,
		] ) ), new Uint8Array( statics.length ) );
		assert.ok( bridge.attachPhysics( physics ) );
		assert.ok( physics.select_vehicle( 0 ) ); // Aster RS
		// Start just before the north expansion joint, heading straight along the bridge axis.
		const [ sx, sz ] = BRIDGE.worldXZ( - 6, 0 );
		const sy = terrain.heightAt( sx, sz ) + 0.6;
		physics.reset( sx, sy, sz, BRIDGE.yaw );
		for ( let i = 0; i < 60; i ++ ) physics.advance( 1 / 120, 0, 0, 0, 1 );

		let maxS = - 10, peakY = 0, minGrounded = 4, asphaltSteps = 0, totalSteps = 0, maxVerticalJump = 0;
		for ( let i = 0; i < 4200; i ++ ) {
			const snap = physics.snapshot();
			const dx = snap[ 0 ] - BRIDGE.P0[ 0 ], dz = snap[ 2 ] - BRIDGE.P0[ 1 ];
			const s = dx * BRIDGE.ux + dz * BRIDGE.uz;
			const lat = dx * BRIDGE.rx + dz * BRIDGE.rz; // +lat is left of bridge centreline
			const fwdX = 2 * ( snap[ 3 ] * snap[ 5 ] + snap[ 6 ] * snap[ 4 ] );
			const fwdZ = 1 - 2 * ( snap[ 3 ] * snap[ 3 ] + snap[ 4 ] * snap[ 4 ] );
			const headErr = fwdX * BRIDGE.rx + fwdZ * BRIDGE.rz; // >0 pointing left
			const steer = Math.max( - 1, Math.min( 1, lat * 0.14 + headErr * 1.4 ) );
			physics.advance( 1 / 120, snap[ 7 ] < 105 ? 0.85 : 0.25, 0, steer, 0 );
			const next = physics.snapshot();
			const ns = ( next[ 0 ] - BRIDGE.P0[ 0 ] ) * BRIDGE.ux + ( next[ 2 ] - BRIDGE.P0[ 1 ] ) * BRIDGE.uz;
			maxS = Math.max( maxS, ns );
			peakY = Math.max( peakY, next[ 1 ] );
			if ( ns > 10 && ns < BRIDGE.LENGTH - 10 ) {
				totalSteps ++;
				minGrounded = Math.min( minGrounded, next[ 10 ] );
				if ( next[ 89 ] === 3 || next[ 90 ] === 3 || next[ 91 ] === 3 || next[ 92 ] === 3 ) asphaltSteps ++;
				const expectedY = BRIDGE.deckY( ns );
				maxVerticalJump = Math.max( maxVerticalJump, Math.abs( next[ 1 ] - expectedY ) );
			}
			if ( ns > BRIDGE.LENGTH + 8 ) break;
		}
		assert.ok( maxS > BRIDGE.LENGTH + 5, `car only reached s=${ maxS.toFixed( 1 ) } m of ${ BRIDGE.LENGTH.toFixed( 1 ) } m bridge` );
		assert.ok( peakY > 35.5, `car never crested the 36.5 m main span arch (peak y=${ peakY.toFixed( 1 ) } m)` );
		assert.ok( minGrounded >= 3, `wheels lost bridge deck contact (min grounded=${ minGrounded })` );
		assert.ok( asphaltSteps / Math.max( 1, totalSteps ) > 0.98, `bridge deck did not register as asphalt (${ asphaltSteps }/${ totalSteps })` );
		assert.ok( maxVerticalJump < 1.3, `car bounced or sank off deck profile (max |y - deckY|=${ maxVerticalJump.toFixed( 2 ) } m)` );
	} finally {
		physics.free();
	}
} );

test( 'Both island approach roads meet the bridge flush with zero grading cliffs, and walkers have continuous deck support', () => {
	assert.ok( route.bridgeNorth, 'missing bridgeNorth approach road' );
	assert.ok( route.bridgeSouth, 'missing bridgeSouth approach road' );
	const northEnd = route.bridgeNorth.points.at( - 1 );
	const southStart = route.bridgeSouth.points[ 0 ];
	assert.ok( Math.hypot( northEnd.x - BRIDGE.P0[ 0 ], northEnd.z - BRIDGE.P0[ 1 ] ) < 1.0 );
	assert.ok( Math.abs( northEnd.h - BRIDGE.deckY( 0 ) ) < 0.15, `north joint off by ${ ( northEnd.h - BRIDGE.deckY( 0 ) ).toFixed( 2 ) } m` );
	assert.ok( Math.hypot( southStart.x - BRIDGE.P1[ 0 ], southStart.z - BRIDGE.P1[ 1 ] ) < 1.0 );
	assert.ok( Math.abs( southStart.h - BRIDGE.deckY( BRIDGE.LENGTH ) ) < 0.15, `south joint off by ${ ( southStart.h - BRIDGE.deckY( BRIDGE.LENGTH ) ).toFixed( 2 ) } m` );
	// Walker deck support every 10 m along the entire span
	for ( let s = 5; s < BRIDGE.LENGTH - 5; s += 10 ) {
		const [ x, z ] = BRIDGE.worldXZ( s, 0 );
		const target = BRIDGE.deckY( s );
		const floor = colliders.groundHeightAt( x, z, target + 0.6 );
		assert.ok( Math.abs( floor - target ) < 0.3, `walker deck support missing at s=${ s }: floor=${ floor } vs deckY=${ target.toFixed( 2 ) }` );
	}
	// Draw call budget: <= 5 merged meshes for the whole suspension bridge
	assert.ok( bridge.group.children.length <= 5, `bridge used ${ bridge.group.children.length } draw calls (budget <= 5)` );
	// Zero newly introduced steep terrain walls
	const { res, heights } = terrain;
	let walls = 0;
	for ( let z = 1; z < res - 1; z ++ ) for ( let x = 1; x < res - 1; x ++ ) {
		const i = z * res + x;
		for ( const j of [ i + 1, i + res ] ) {
			if ( heights[ i ] === beforeHeights[ i ] && heights[ j ] === beforeHeights[ j ] ) continue;
			if ( Math.abs( heights[ i ] - heights[ j ] ) > Math.max( 1.4, Math.abs( beforeHeights[ i ] - beforeHeights[ j ] ) + 0.2 ) ) walls ++;
		}
	}
	assert.equal( walls, 0, `bridge approaches left ${ walls } steep terrain steps` );
} );
