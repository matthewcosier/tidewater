import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FerryShip } from '../src/ferry/FerryShip.js';
import { Fleet, SHIP_REACH } from '../src/ferry/Fleet.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { Vector3 } from '../src/engine/index.js';

const BERTH_Z = 25.2; // m, Terminal.js BERTH: her marks ahead of the terminal's origin along its yaw
const berthOf = ( t, name ) => ( { name, label: name, x: t.position.x + Math.sin( t.yaw ) * BERTH_Z, z: t.position.z + Math.cos( t.yaw ) * BERTH_Z, yaw: t.yaw } );
const ferryAt = ( name, berth ) => { const ship = new FerryShip( berth ); ship.moor( berth ); return { name, ship, at: berth }; };
const spirit = ferryAt( 'Tidewater Spirit', berthOf( WORLD.ferryTerminal, 'Tidewater' ) );
const sister = ferryAt( 'Sealion Spirit', berthOf( WORLD.joeyTerminal, 'Joey Island' ) );
const fleet = new Fleet();
fleet.push( spirit, sister );

test( 'every hull on the service is listed, the lead first, and the list is not rebuilt per read', () => {

	assert.deepEqual( fleet.ships, [ spirit.ship, sister.ship ] );
	assert.equal( fleet.ships, fleet.ships, 'a second read hands back the same array (no per-frame garbage)' );
	assert.ok( Array.isArray( fleet ) && fleet[ 0 ] === spirit && fleet.filter( f => f !== spirit ).constructor === Array, 'still the array App.fleet always was' );

} );

test( 'a point on either ship\'s deck finds that ship, at the same place in her own frame', () => {

	for ( const f of fleet ) for ( const along of [ - 22, 0, 20 ] ) {

		const p = f.ship.toWorld( new Vector3( 4, 0, along ) );
		assert.equal( fleet.shipAt( p )?.name, f.name, `${ f.name }: ${ along } m along her deck` );

	}
	const a = spirit.ship.position, b = sister.ship.position;
	const mid = { x: ( a.x + b.x ) / 2, z: ( a.z + b.z ) / 2 };
	assert.ok( Math.hypot( a.x - b.x, a.z - b.z ) > 4 * SHIP_REACH, 'the berths lie apart' );
	assert.equal( fleet.shipAt( mid ), null, 'open water mid-strait is no ship' );

} );

test( 'the ship carrying the player is the one whose deck he is on, sister or Spirit', () => {

	for ( const f of fleet ) {

		assert.equal( fleet.shipCarrying( { mode: 'ferry', vessel: { ferry: f } } ), f, `${ f.name }: on her deck` );
		assert.equal( fleet.shipCarrying( { mode: 'ferry-helm', vessel: { ferry: f } } ), f, `${ f.name }: at her helm` );
		assert.equal( fleet.shipCarrying( { mode: 'walk', vessel: { ferry: f } } ), null, `${ f.name }: walked off` );

	}

} );
