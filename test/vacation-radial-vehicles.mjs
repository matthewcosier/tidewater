import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hudChips } from '../src/game/HudContext.js';
import { JetskiController } from '../src/jetski/JetskiController.js';
import { pickRadialSector, RADIAL_WEDGE_IDS } from '../src/ui/RadialMenu.js';
import { VehicleRecall } from '../src/player/VehicleRecall.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { Colliders } from '../src/world/Colliders.js';
import { Vector3 } from '../src/engine/index.js';

test( 'Loading screen presents Tidewater as an island holiday sandbox rather than a fishing-only game', async () => {
	const html = await readFile( new URL( '../index.html', import.meta.url ), 'utf8' );
	assert.doesNotMatch( html, /An island fishing game/i, 'loader kicker must not brand Tidewater as a fishing-only game' );
	assert.match( html, /holiday|vacation/i, 'loader copy should establish the island holiday premise' );
	assert.match( html, /suspension bridge|Activity Wheel|jetski/i, 'loader tips should surface open-world sandbox activities' );
} );

test( 'Contextual HUD hides fishing purse and ATM PIN during ordinary exploration and reveals them in context', () => {
	const explore = hudChips( { mode: 'walk' } );
	assert.deepEqual( explore, { purse: false, pin: false, guidance: true }, 'ordinary beach walk hides fishing purse and ATM PIN' );

	const fishing = hudChips( { mode: 'walk', fishing: true } );
	assert.deepEqual( fishing, { purse: true, pin: false, guidance: true }, 'equipping the rod or visiting vendors shows the purse' );

	const atm = hudChips( { mode: 'walk', nearAtm: true } );
	assert.deepEqual( atm, { purse: true, pin: true, guidance: true }, 'standing by an ATM shows purse and card PIN' );

	const boat = hudChips( { mode: 'boat' } );
	assert.deepEqual( boat, { purse: true, pin: false, guidance: false }, 'fishing boat helm shows fuel/sonar purse' );

	const driving = hudChips( { mode: 'walk', driving: true, fishing: true, nearAtm: true } );
	assert.deepEqual( driving, { purse: false, pin: false, guidance: false }, 'driving clears all on-foot chips' );
} );

test( 'Radial menu exposes all 6 top-level vacation wedges and resolves pointer angles with a deadzone', () => {
	assert.deepEqual( RADIAL_WEDGE_IDS, [ 'drive', 'water', 'air', 'world', 'ride', 'places' ] );
	// Inside 46 px deadzone returns -1 (cancel/back)
	assert.equal( pickRadialSector( 10, - 12, 6, 46 ), - 1 );
	// Straight up (0, -100) hits sector 0 (Drive), clockwise every 60 deg
	assert.equal( pickRadialSector( 0, - 100, 6, 46 ), 0 );
	assert.equal( pickRadialSector( 87, - 50, 6, 46 ), 1 );
	assert.equal( pickRadialSector( 87, 50, 6, 46 ), 2 );
	assert.equal( pickRadialSector( 0, 100, 6, 46 ), 3 );
	assert.equal( pickRadialSector( - 87, 50, 6, 46 ), 4 );
	assert.equal( pickRadialSector( - 87, - 50, 6, 46 ), 5 );
} );

test( 'Unmanned jetski lanyard water-braking arrests step-off and wipeout glide instead of ghost-riding across the bay', () => {
	const flatOcean = { heightAt: () => - 20 };
	const ctl = new JetskiController( { terrain: flatOcean } );
	ctl.place( 0, 0.15, 0, 0 );
	ctl.hasWater = true;
	ctl.waterH.fill( 0 );
	ctl.waterV.fill( 0 );
	ctl.hEff.fill( 0 );
	ctl.driven = false;
	ctl.engineOn = false;
	ctl.disembarkBrake = 2.5;
	ctl.velocity.set( 0, 0, 18 ); // 65 km/h wipeout speed

	for ( let i = 0; i < 240; i ++ ) ctl.step( 1 / 60 ); // 4 seconds of real hydrodynamic integration
	const driftM = Math.hypot( ctl.position.x, ctl.position.z );
	assert.ok( driftM < 16, `jetski coasted ${ driftM.toFixed( 1 ) } m after lanyard cut-off (expected < 16 m)` );
	assert.ok( ctl.speed < 0.8, `jetski still moving at ${ ctl.speed.toFixed( 2 ) } m/s after 4 s` );
} );

test( 'VehicleRecall tracks last craft, opens an 8 s post-wipeout quick remount window, and recalls rides safely on land and water', () => {
	const terrain = new TerrainData();
	new CoastalRoute( terrain );
	const colliders = new Colliders();
	let placedSpot = null, mountedSki = null, placedSki = null;
	const app = {
		terrainData: terrain,
		colliders,
		player: { mode: 'walk', position: new Vector3( 15, terrain.heightAt( 15, - 58 ), - 58 ), yaw: Math.PI },
		rally: {
			active: false,
			profile: { name: 'Aster RS' },
			trunks: null,
			peerPositions: () => [],
			place( spot ) { placedSpot = spot; },
			enter() { this.active = true; },
		},
		jetskis: {
			riding: false,
			live: { name: 'Beach hire 1', position: new Vector3( 22, 0, - 38 ) },
			ctl: {
				position: new Vector3( 22, 0, - 38 ),
				velocity: new Vector3( 5, 0, 0 ),
				angular: new Vector3(),
				capsized: true,
				place( x, y, z, yaw ) { placedSki = { x, y, z, yaw }; this.position.set( x, y, z ); },
			},
			waterLevel: () => 0,
			mount( ski ) { mountedSki = ski; this.riding = true; },
		},
		game: { toast() {} },
		ui: { ui: { toast() {} } },
	};

	const recall = new VehicleRecall( app );
	// Record wipeout on jetski at t = 1000 ms
	recall.noteExit( 'jetski', { wipeout: true, now: 1000 } );
	assert.equal( recall.quickRemountPrompt( 3000 )?.key, 'R' );
	assert.match( recall.quickRemountPrompt( 3000 )?.text || '', /Back on jetski/i );
	assert.equal( recall.quickRemountPrompt( 10_000 ), null, 'quick remount expires after 8 s' );

	// Recall while swimming pulls jetski upright beside swimmer and mounts
	app.player.mode = 'swim';
	app.player.position.set( 30, - 0.2, 20 );
	assert.equal( recall.recall(), true );
	assert.ok( placedSki && Math.hypot( placedSki.x - 30, placedSki.z - 20 ) < 4.5, 'jetski recalled right beside swimmer' );
	assert.equal( mountedSki, app.jetskis.live, 'recalled jetski in water mounts smoothly' );

	// Record car exit on land and recall car onto clear dry ground ahead
	app.jetskis.riding = false;
	app.player.mode = 'walk';
	app.player.position.set( 15, terrain.heightAt( 15, - 58 ), - 58 );
	recall.noteExit( 'car', { wipeout: false, now: 12_000 } );
	assert.equal( recall.recall(), true );
	assert.ok( placedSpot, 'car recall placed vehicle near player' );
	const dist = Math.hypot( placedSpot.x - 15, placedSpot.z - ( - 58 ) );
	assert.ok( dist >= 2.5 && dist <= 14, `recalled car distance ${ dist.toFixed( 1 ) } m out of safe nearby band` );
} );
