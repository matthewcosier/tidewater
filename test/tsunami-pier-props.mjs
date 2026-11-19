import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '../src/engine/index.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';
import { PROPS } from '../src/physics/Props.js';
import { Disasters } from '../src/disasters/Disasters.js';

const STEP = 0.1; // s
const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );

test( 'A rail panel on the pier deck over the sea stays dormant until the tsunami floods the deck', () => {
	const P = WORLD.pier, z = P.zEnd - 6; // m: near the pier head, about 4 m of water under the deck
	assert.ok( ground( P.x, z ) < - 1, `the sea bed under the deck at z ${ z } is ${ ground( P.x, z ).toFixed( 2 ) } m` );
	const panel = PROPS.panel( new Vector3( P.x + P.width / 2, P.deckHeight + 0.5, z ), 0, new Vector3( 0.05, 0.5, 1 ) ); // base on the deck
	const field = new DisasterField( ground );
	const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, x: 58, z: - 46, intensity: 25, warningLead: 3, duration: 90, seed: 7 } );
	let woke = null;
	const host = { field, app: { props: { awake: new Set(), wake() {}, breakPanel( r ) { r.broken = true; woke ??= e.time; } } } };
	const deck = {}; // the water over the panel's base when it woke
	while ( e.time < e.arrival + 30 && woke === null ) {
		field.advance( STEP );
		Disasters.prototype.wakeProps.call( host );
		if ( woke !== null ) Object.assign( deck, field.sample( panel.centre.x, panel.centre.y, panel.centre.z ) );
	}
	assert.ok( woke !== null, `the deck panel never woke by ${ ( e.time - e.arrival ).toFixed( 0 ) } s after the crest estimate (25 m wave)` );
	const lead = e.arrival - woke;
	console.log( `pier deck panel woke ${ lead.toFixed( 1 ) } s before the crest estimate, water ${ ( deck.height - P.deckHeight ).toFixed( 2 ) } m over the deck (deck ${ P.deckHeight } m)` );
	assert.ok( deck.height > P.deckHeight, `woke ${ lead.toFixed( 1 ) } s before the crest with the water ${ ( deck.height - P.deckHeight ).toFixed( 2 ) } m relative to the deck at ${ P.deckHeight } m` );
} );
