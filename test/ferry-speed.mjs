import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FerryShip } from '../src/ferry/FerryShip.js';

const PASSAGE = 1400; // m, the open-water leg the design note sets (docs/ferry.md)
const DT = 1 / 60;    // s, the game's frame

// Full ahead from a standstill on a straight course, the real hull through the real engines;
// returns the seconds to run `PASSAGE` metres and the fastest speed seen.
function run( boost ) {

	const ship = new FerryShip( { x: 0, z: 0, yaw: 0 } );
	ship.lever = 1;
	ship.boost = boost;
	let t = 0, top = 0;
	while ( ship.position.z < PASSAGE && t < 400 ) { ship.step( DT, null ); t += DT; top = Math.max( top, ship.u ); }
	return { t, top };

}

test( 'at service speed the passage takes about two minutes', () => {

	const { t, top } = run( false );
	assert.ok( Math.abs( t - 120 ) <= 15, `passage at full ahead took ${ t.toFixed( 1 ) } s (top ${ top.toFixed( 1 ) } m/s), want 120 +/- 15 s` );

} );

test( 'with boost the passage takes about one minute', () => {

	const { t, top } = run( true );
	assert.ok( Math.abs( t - 60 ) <= 10, `passage on boost took ${ t.toFixed( 1 ) } s (top ${ top.toFixed( 1 ) } m/s), want 60 +/- 10 s` );

} );

test( 'boost answers the lever within seconds, so the helm feels it', () => {

	// From service speed, ten seconds on boost must add real way: a lively 3 m/s or more.
	const ship = new FerryShip( { x: 0, z: 0, yaw: 0 } );
	ship.lever = 1;
	for ( let t = 0; t < 150; t += DT ) ship.step( DT, null );
	const cruise = ship.u;
	ship.boost = true;
	for ( let t = 0; t < 10; t += DT ) ship.step( DT, null );
	assert.ok( ship.u - cruise >= 3, `ten seconds of boost took her from ${ cruise.toFixed( 1 ) } to ${ ship.u.toFixed( 1 ) } m/s` );

} );
