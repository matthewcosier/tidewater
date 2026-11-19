import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';

await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );
const colliders = JSON.parse( await readFile( new URL( '../public/ferry/ferry_colliders.json', import.meta.url ) ) );
const ferrySource = await readFile( new URL( '../src/ferry/Ferry.js', import.meta.url ), 'utf8' );

// HINGE and TOE as Ferry.js declares them (one source: read from the file, not copied)
const hingeToe = ferrySource.match( /const HINGE = \{ z: ([^,]+), y: ([^}]+) \}, TOE = \{ z: ([^,]+), y: ([^}]+) \}/ );
assert.ok( hingeToe, 'Ferry.js declares HINGE and TOE' );
const [ hz, hy, tz, ty ] = hingeToe.slice( 1 ).map( s => Function( `return ${ s.trim() }` )() );
const HINGE = { z: hz, y: hy }, TOE = { z: tz, y: ty };

function deckBoxes() {

	const car = colliders.boxes.filter( b => b.kind === 'car' ).flatMap( b => [ ...b.center, ...b.half, 0, 0, 0.9 ] );
	const T = 0.15, transom = [ 0, 0.5, HINGE.z - T, 6.6, 1.5, T, 0, 0, 0.9 ];
	const run = HINGE.z - TOE.z, rise = HINGE.y - TOE.y, pitch = Math.atan2( rise, run );
	const half = ( Math.hypot( run, rise ) + 0.4 ) / 2;
	const ramp = [ 0, HINGE.y - half * Math.sin( pitch ) - T * Math.cos( pitch ), HINGE.z - half * Math.cos( pitch ) + T * Math.sin( pitch ), 5.0, T, half, 0, - pitch, 0.9 ];
	return new Float32Array( [ ...car, ...transom, ...ramp ] );

}

const DECK = 2.6; // m: her vehicle deck top over her waterline (the 'car' deck box, centre 2.45 + half 0.15)
const SETTLE = 3; // s: dropped 0.4 m on her handbrake (S at rest selects reverse), the Aster RS settles well inside this

// Parks the car at her (x, z) facing her bow and returns the grounded wheels and the deck height under each.
function parkAt( x, z ) {

	const s = new RallyPhysics();
	try {

		s.add_platform_pitched( 1, deckBoxes() );
		s.set_platform( 1, new Float32Array( [ 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0 ] ) );
		s.reset( x, DECK + 0.9, z, 0 );
		for ( let t = 0; t < SETTLE; t += 1 / 120 ) s.advance( 1 / 120, 0, 0, 0, 1 );
		const a = s.snapshot();
		const wheels = [ 0, 1, 2, 3 ].map( w => ( { grounded: a[ 13 + w * 4 + 3 ] > 0.5, x: a[ 29 + w * 10 ], y: a[ 30 + w * 10 ], z: a[ 31 + w * 10 ] } ) );
		return { grounded: a[ 10 ], wheels, y: a[ 1 ], kmh: Math.abs( a[ 7 ] ) };

	} finally {

		s.free();

	}

}

test( 'A car parked anywhere along her vehicle deck rests on all four wheels, on her deck plane', () => {

	const bad = [];
	for ( const x of [ - 1.5, 0, 1.5 ] ) for ( let z = - 22; z <= 14; z += 0.5 ) {

		const r = parkAt( x, z );
		const off = r.wheels.filter( w => ! w.grounded || Math.abs( w.y - DECK ) > 0.05 );
		if ( r.grounded !== 4 || off.length ) bad.push( `x ${ x } z ${ z }: ${ r.grounded } grounded, wheels ${ r.wheels.map( w => `${ w.grounded ? 'on' : 'OFF' }@${ w.z.toFixed( 2 ) }/${ w.y.toFixed( 3 ) }` ).join( ' ' ) }` );

	}
	assert.deepEqual( bad, [], `parked spots off her deck:\n${ bad.join( '\n' ) }` );

} );
