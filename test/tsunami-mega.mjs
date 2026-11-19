import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS, planApproach } from '../src/disasters/Field.js';

const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );
const RING_HALF = 4096; // m: the outer ring's half width (Field.js OUTER_GRID, 257 x 32 m)
const HOLD = 0.85;
const ROOF = 12; // m above local ground: a two-storey ridge is 8-10 m; the village's tallest roof with margin (declared)

// The island's highest point on a 16 m lattice over the ring (m).
function summit() {
	let best = { x: 0, z: 0, y: - Infinity };
	for ( let x = - RING_HALF; x <= RING_HALF; x += 16 ) for ( let z = - RING_HALF; z <= RING_HALF; z += 16 ) {
		const y = ground( x, z );
		if ( y > best.y ) best = { x, z, y };
	}
	return best;
}
const peak = summit();

function startWall( H, seed, duration = 120 ) {
	const field = new DisasterField( ground );
	const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, intensity: H, warningLead: 3, duration, seed } );
	return { field, e, a: e.direction * Math.PI / 180 };
}

for ( const [ H, seed ] of [ [ 3000, 2 ], [ 320, 4 ] ] ) test( `The ${ H } m wall keeps at least 85% of its height from the hand-off to the shelf edge`, () => {
	const { field, e, a } = startWall( H, seed ), cx = Math.cos( a ), cz = Math.sin( a );
	const gauges = [], deep = - ground( e.x - cx * e.launchDistance, e.z - cz * e.launchDistance ); // m
	for ( let s = e.launchDistance - 200; s > 0; s -= 100 ) {
		const x = e.x - cx * s, z = e.z - cz * s;
		if ( ground( x, z ) >= 0 || - ground( x, z ) < 0.9 * deep ) break;
		gauges.push( { s, x, z, max: - Infinity, by: e.launchTime + ( e.launchDistance - s ) / e.farField.speed + 1.5 } );
	}
	assert.ok( gauges.length >= 5, `${ gauges.length } sea gauges between the source and the coast` );
	const started = performance.now();
	while ( field.time < gauges.at( - 1 ).by ) {
		field.advance( 0.05 );
		if ( ! e.launched ) continue;
		for ( const g of gauges ) if ( field.time <= g.by ) g.max = Math.max( g.max, field.waterAt( g.x, g.z ) );
	}
	const low = gauges.reduce( ( m, g ) => g.max < m.max ? g : m );
	console.log( JSON.stringify( { mega: 'hold', H, speed: e.farField.speed, launchDistance: e.launchDistance, gauges: gauges.map( g => [ Math.round( g.s ), Math.round( g.max ) ] ), cpuMs: Math.round( performance.now() - started ) } ) );
	assert.ok( low.max >= HOLD * H, `the wall fell to ${ low.max.toFixed( 0 ) } m (${ ( low.max / H * 100 ).toFixed( 0 ) }% of ${ H } m) ${ low.s.toFixed( 0 ) } m out, by ${ ( low.by - e.launchTime ).toFixed( 1 ) } s after the hand-off` );
} );

test( 'The 3000 m wall overtops the island\'s highest summit', () => {
	const H = 3000, { field, e } = startWall( H, 2 );
	assert.ok( peak.y > 100 && peak.y < H, `summit ${ peak.y.toFixed( 0 ) } m at (${ peak.x }, ${ peak.z })` );
	let over = - Infinity, at = - 1;
	while ( field.time < e.arrival + 20 && field.events.has( 'tsunami' ) ) {
		field.advance( 0.05 );
		const y = field.waterAt( peak.x, peak.z ) - peak.y;
		if ( y > over ) over = y;
		if ( y > 1 ) { at = field.time; break; }
	}
	console.log( JSON.stringify( { mega: 'summit', peak, over, at, arrival: e.arrival } ) );
	assert.ok( at >= 0, `the water never covered the ${ peak.y.toFixed( 0 ) } m summit (closest ${ over.toFixed( 1 ) } m) by ${ ( e.arrival + 20 ).toFixed( 0 ) } s` );
} );

test( 'A 320 m wall arrives above the village rooftops', () => {
	const H = 320, { field, e } = startWall( H, 4 ), roof = ground( e.x, e.z ) + ROOF;
	let top = - Infinity;
	while ( field.time < e.arrival + 15 && field.events.has( 'tsunami' ) ) {
		field.advance( 0.1 );
		top = Math.max( top, field.waterAt( e.x, e.z ) );
		if ( top > roof + H / 4 ) break;
	}
	console.log( JSON.stringify( { mega: 'village', roof, top, arrival: e.arrival } ) );
	assert.ok( top > roof, `the 320 m wall reached ${ top.toFixed( 1 ) } m at the village against rooftops at ${ roof.toFixed( 1 ) } m` );
} );

const DIGESTS = {
	'2/default': 'cdef3aff9cb403da',
	'2/-60': '3618163b55efd22d',
	'10/default': '07c8f23b15c707e6',
	'10/-60': '06af976b9c3ae03f',
};
function digest( H, direction, seed ) {
	const field = new DisasterField( ground );
	const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, intensity: H, direction, warningLead: 3, duration: 60, seed } );
	while ( field.time < 13 - 1e-9 ) field.advance( 0.1 );
	const hash = createHash( 'sha256' );
	hash.update( JSON.stringify( planApproach( ground, { ...DEFAULTS.tsunami, intensity: H, direction, warningLead: 3, seed } ) ) );
	for ( const g of [ field.outer, field.water ] ) for ( const a of [ g.h, g.qx, g.qz ] ) hash.update( new Uint8Array( a.buffer, a.byteOffset, a.byteLength ) );
	return { hash: hash.digest( 'hex' ).slice( 0, 16 ), far: e.farField };
}
test( '2 m and 10 m waves are bit-identical to before the inflow', () => {
	const found = {};
	for ( const H of [ 2, 10 ] ) for ( const direction of [ DEFAULTS.tsunami.direction, - 60 ] ) {
		const { hash, far } = digest( H, direction, 1 );
		const key = `${ H }/${ direction === DEFAULTS.tsunami.direction ? 'default' : direction }`;
		found[ key ] = hash;
		assert.equal( far, null, `${ key }: no far field` );
	}
	console.log( JSON.stringify( { mega: 'digests', found, default: DEFAULTS.tsunami.direction } ) );
	for ( const key in DIGESTS ) assert.equal( found[ key ], DIGESTS[ key ], `${ key }: the grids changed` );
} );
