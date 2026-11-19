// People on foot at the island's ferry terminal, built and stepped as the game builds and steps them
// (docs/people.md, Solid trunks, cars and room): the real terminal and its colliders, her moored at it with her deck,
// the real people hub (People.js) and the ferry's real crowd (Crowd.js), and the real Player on foot in the shared
// disaster field with the game's default breeze (the Breezy sea state: 8 m/s from 210 degrees, App.setAmbientWind),
// which Disasters hands him every frame. Each frame runs in the game's order: the ferry's crowd (Ferry.update), the
// player's own walk step and his contact with people (Player.update), then the hub (App.finishFrame).
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
register( '../style-transport-loader.mjs', import.meta.url );
const { Ferry } = await import( '../../src/ferry/Ferry.js' );
const { FerryShip } = await import( '../../src/ferry/FerryShip.js' );
const { FerryDeck } = await import( '../../src/ferry/FerryDeck.js' );
const { Terminal, applyTerminalSite } = await import( '../../src/ferry/Terminal.js' );
const { Crowd } = await import( '../../src/ferry/Crowd.js' );
const { People } = await import( '../../src/people/People.js' );
const { Player } = await import( '../../src/player/Player.js' );
const { TerrainData } = await import( '../../src/world/TerrainData.js' );
const { Colliders } = await import( '../../src/world/Colliders.js' );
const { DisasterField } = await import( '../../src/disasters/Field.js' );
const { Scene, PerspectiveCamera } = await import( '../../src/engine/index.js' );
const { parseGLB } = await import( '../../src/engine/loaders/GLTF.js' );
const { SkinnedModel } = await import( '../../src/engine/render/Skinning.js' );
const { StorageBuffer } = await import( '../../src/engine/gpu/Texture.js' );

const parse = b => parseGLB( b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) );
const playerGLB = parse( await readFile( new URL( '../../public/models/characters/player.glb', import.meta.url ) ) );
const crowdGLB = parse( await readFile( new URL( '../../public/models/characters/crowd/f01.glb', import.meta.url ) ) );
const terminalData = JSON.parse( await readFile( new URL( '../../public/ferry/terminal_colliders.json', import.meta.url ) ) );
const deckData = JSON.parse( await readFile( new URL( '../../public/ferry/ferry_colliders.json', import.meta.url ) ) );

export const DT = 1 / 60;                   // s, the game's frame at 60 frames a second
// The frame lengths the game played the terminal at, in order (a browser run of the foot passenger scenario: 73 %
// of its frames at 1/60 s, 25 % at 1/30 s, the rest up to the 0.1 s cap)
export const GAME_FRAMES = [ 1 / 60, 1 / 60, 1 / 30, 1 / 60, 1 / 60, 1 / 30, 1 / 60, 1 / 20, 1 / 60, 1 / 60, 1 / 30, 0.1 ];
export const BREEZE = 8, BREEZE_FROM = 210;  // m/s and degrees: the game's default ambient wind (UI.js Breezy)

// No GPU in node: a skinned model's buffer writes are kept on the buffer. Call the returned function after the tests.
export function keepBufferWrites() {

	const write = StorageBuffer.prototype.write;
	StorageBuffer.prototype.write = function ( data ) { this.pendingData = data.slice(); };
	return () => { StorageBuffer.prototype.write = write; };

}

// `bodies` crowd bodies are ready to be made into people (fewer than six, so the crowd does not fill its gate queue by
// itself: each check makes the people it needs). `breeze`: the ambient wind in m/s (0 for still air). `casts`: the
// avatar each body is, in turn (the model is the one avatar; the crowd tells bodies apart by cast). `seed`: the
// crowd's casting draws (Crowd.js castSeed), for a check that replays them.
export function crowdWorld( bodies, { breeze = BREEZE, casts = [ 'f01' ], seed } = {} ) {

	const terrainData = new TerrainData();
	applyTerminalSite( terrainData );
	const colliders = new Colliders(), camera = new PerspectiveCamera(), input = { down: () => false, hit: () => false };
	const player = new Player( { camera, input, terrain: terrainData, colliders, query: { allocate: () => 0 }, boat: null } );
	// the stand-in avatar's footfalls go by distance (Player.js stepPhase); the sea is far below the terminal's deck
	player.avatar = { model: new SkinnedModel( playerGLB ), stepPhase: () => null, takeStep: () => false };
	player.waterH = player.waterMean = - 50;
	const field = new DisasterField( ( x, z ) => terrainData.heightAt( x, z ) ), r = BREEZE_FROM * Math.PI / 180;
	field.ambient = () => ( { x: breeze * Math.cos( r ), z: breeze * Math.sin( r ) } );
	player.environment = field;
	const app = { terrainData, colliders, camera, player, scene: new Scene(), crowdSeed: seed };
	const terminal = app.terminal = new Terminal( app );
	terminal.addColliders( terminalData );
	const ferry = app.ferry = new Ferry( app );
	ferry.ship = new FerryShip( ferry.at );
	ferry.ship.moor( ferry.at );
	ferry.deck = new FerryDeck( ferry, deckData );
	player.groundProviders.add( ferry.deck.support );
	ferry.service = { update() {}, enabled: false, steering: false, phase: 'disabled', pilot: {} };
	const hub = app.people = new People( app );
	const crowd = ferry.crowd = new Crowd( app, ferry );
	for ( let i = 0; i < bodies; i ++ ) {

		const model = new SkinnedModel( crowdGLB );
		model.clipSet = new Set( model.clipNames() );
		crowd.free.push( { model, cast: casts[ i % casts.length ], walk: 1.3 } );

	}
	// the game's order each frame: the ferry's crowd, the player on foot (Player.update: his walk step, then his
	// contact with people), the hub
	const frame = ( dt = DT ) => {

		crowd.update( dt );
		if ( player.mode === 'walk' ) { player.updateWalk( dt ); if ( player.mode === 'walk' ) hub.contact.player( player, dt ); }
		hub.update( dt );

	};
	// the player standing still on foot at a world point
	const stand = at => { player.mode = 'walk'; player.grounded = true; player.position.copy( at ); player.velocity.set( 0, 0, 0 ); };
	return { app, hub, crowd, ferry, terminal, player, field, frame, stand };

}

// A walker the crowd makes (Crowd.add) on a route in the terminal's frame ([ x, y, z ] points), at a pace in the
// crowd's own range (1.2 to 1.5 m/s), walking until its route ends.
export function walker( w, pts, pace = 1.3 ) {

	const body = w.crowd.take(), path = pts.map( q => [ 'T', ...q ] );
	const p = w.crowd.add( { ...body, kind: 'foot', terminal: w.terminal, state: 'leave', path, at: path[ path.length - 1 ] } );
	p.pace = pace;
	return p;

}

// Step the world; per frame the closest two of `people` came, each one's longest hold, and when each arrived (its
// route done).
export function watch( w, people, secs, each = () => {}, dt = DT ) {

	const out = { close: Infinity, at: null, held: people.map( () => 0 ), arrived: people.map( () => null ) };
	for ( let t = 0; t < secs; t += dt ) {

		w.frame( dt );
		people.forEach( ( p, i ) => { out.held[ i ] = Math.max( out.held[ i ], p.held || 0 ); if ( out.arrived[ i ] === null && ! p.path ) out.arrived[ i ] = t; } );
		for ( let i = 0; i < people.length; i ++ ) for ( let j = i + 1; j < people.length; j ++ ) {

			const a = people[ i ].world, b = people[ j ].world;
			if ( ! a || ! b || ! people[ i ].path || ! people[ j ].path ) continue;
			const d = Math.hypot( a.x - b.x, a.z - b.z );
			if ( d < out.close ) { out.close = d; out.at = people.map( p => + ( p.lat || 0 ).toFixed( 2 ) ); }

		}
		each( t );
		if ( out.arrived.every( a => a !== null ) ) break;

	}
	return out;

}
