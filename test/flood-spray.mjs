// What leaves a flood's surface and what a camera sees from inside it (src/disasters/FloodSpray.js and
// FloodMedium.js; docs/disasters.md "Spray and mist" and "Inside the water"). Before these, a tsunami had no white
// water and no spray anywhere, and a camera caught inside the flood saw the clear sea's diving view.
// The tests hold the decisions, on the real island and a real seeded event: how hard, how big and how often a source
// throws spray against the jump and the speed of the water; that the breaking front throws and still water does not;
// that the emission is steered inside the particle region; and that the water at a camera is the flood's where the
// flood is turbid and the sea's everywhere else, with one set of sediment coefficients.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField } from '../src/disasters/Field.js';
import { GRAVITY } from '../src/engine/render/Frame.js';
import { classifyBore, boreFace, boreFront, turbidity, COAST_BAND, SED_ABSORB, SED_SCATTER, SED_WGSL } from '../src/disasters/FloodLook.js';
import * as Spray from '../src/disasters/FloodSpray.js';
import { floodMediumAt, blendMedium, mediumOptics, MEDIUM_BLEND, FLOOD_MEDIUM_WGSL } from '../src/disasters/FloodMedium.js';

const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );
const { emission, mist, source, resolve, steer, ringSeconds, candidateRadius, candidateArea } = Spray;
const SEA = { absorption: { x: 0.42, y: 0.075, z: 0.035 }, scattering: { x: 0.012, y: 0.018, z: 0.024 } }; // Frame.js, 1/m
const LENS_REACH = 0.35; // m (src/post/Underwater.js): shallower than this no camera is under the water

test( 'Spray is thrown one and a half jump heights and the live sprites cover the curtain once over', () => {

	for ( const jump of [ 0.5, 2, 5, 10, 40 ] ) {

		const cell = 8, e = emission( jump, 1, cell );
		const reach = e.launch * e.launch / ( 2 * GRAVITY );
		assert.ok( Math.abs( reach / jump - Spray.THROW_HEIGHTS ) < 0.01, `a ${ jump } m jump launches at ${ e.launch.toFixed( 2 ) } m/s, to ${ ( reach / jump ).toFixed( 2 ) } jump heights` );
		const radius = Math.min( Math.max( Spray.RADIUS_PER_JUMP * jump, Spray.SPRAY_RADIUS[ 0 ] ), Spray.SPRAY_RADIUS[ 1 ] );
		assert.ok( Math.abs( e.radius - radius ) < 1e-9, `a ${ jump } m jump throws sprites of ${ e.radius.toFixed( 2 ) } m radius` );
		const flight = Math.min( Math.max( 2 * e.launch / GRAVITY, Spray.SPRAY_LIFE[ 0 ] ), Spray.SPRAY_LIFE[ 1 ] );
		assert.ok( Math.abs( e.life - flight ) < 1e-9, `a ${ jump } m jump's sprites live ${ e.life.toFixed( 2 ) } s, the flight up and back` );
		// sprites alive over 1 m2 of breaking ground x their area, against the curtain standing on it
		const curtain = Spray.CURTAIN_HEIGHTS * jump / ( Spray.FACE_CELLS * cell );
		const cover = e.rate * e.life * Math.PI * e.radius * e.radius / curtain;
		assert.ok( Math.abs( cover - Spray.COVER ) < 0.01, `a ${ jump } m jump's live sprites cover the curtain ${ cover.toFixed( 2 ) } times` );
		// its mist covers the same curtain with bigger, longer-lived sprites
		const m = mist( e );
		assert.ok( m.radius > e.radius && m.life > e.life, `mist of ${ m.radius.toFixed( 2 ) } m for ${ m.life.toFixed( 1 ) } s over spray of ${ e.radius.toFixed( 2 ) } m for ${ e.life.toFixed( 1 ) } s` );
		assert.ok( Math.abs( m.rate * m.life * Math.PI * m.radius * m.radius / curtain - Spray.MIST_COVER ) < 0.01, 'the mist covers the curtain MIST_COVER times' );

	}

} );

test( 'A bigger wave throws fewer, bigger, longer-lived sprites, and no source throws nothing', () => {

	const small = emission( 0.5, 1, 8 ), mid = emission( 3, 1, 8 ), big = emission( 20, 1, 8 );
	assert.ok( small.rate > mid.rate && mid.rate > big.rate, `sprites per m2 per s: ${ small.rate.toFixed( 3 ) } at 0.5 m, ${ mid.rate.toFixed( 3 ) } at 3 m, ${ big.rate.toFixed( 4 ) } at 20 m` );
	assert.ok( small.radius < mid.radius && mid.radius < big.radius, 'the sprite grows with the jump' );
	assert.ok( small.life <= mid.life && mid.life < big.life, 'the sprite lives longer with the jump' );
	assert.ok( emission( 3, 0.5, 8 ).rate < mid.rate, 'half the strength throws less' );
	const none = emission( 3, 0, 8 ), flat = emission( 0, 1, 8 );
	assert.equal( none.rate, 0, 'strength 0 throws nothing' );
	assert.ok( flat.rate === 0 && Number.isFinite( flat.radius ) && Number.isFinite( flat.life ), `no jump throws nothing and stays finite (rate ${ flat.rate })` );

} );

test( 'What throws: the breaking face by its jump, an obstacle by the stagnation head, the leading edge, never still water', () => {

	// still or slow water, and a film, throw nothing
	assert.equal( source( 5, 0, 0, 0, 1, 0, false ).kind, 0, 'still water' );
	assert.equal( source( 5, 1.0, 0, 0, 1, 0.02, false ).strength, 0, 'a slow current over a flat bed' );
	assert.equal( source( 0.01, 8, 1, 0.01, 1, 0, true ).kind, 0, 'a 1 cm film' );
	// a breaking bore: its own jump
	const face = source( 3, 8, 1, 2.2, 1, 0.05, false );
	assert.ok( face.kind === 1 && face.strength > 0.99 && Math.abs( face.jump - 2.2 ) < 1e-9, `a breaking 2.2 m bore is a face source (kind ${ face.kind }, strength ${ face.strength }, jump ${ face.jump })` );
	// the far wall's body is dark water: only its crest band throws
	assert.equal( source( 300, 40, 1, 150, 0, 0, false ).kind, 0, 'the far wall below its crest band' );
	// fast flow against a bank climbs its stagnation head u^2 / 2g; the same flow up a beach does not burst
	const hit = source( 2, 10, 0, 0, 1, 1.0, false ), head = 100 / ( 2 * GRAVITY );
	assert.ok( hit.kind === 2 && hit.strength > 0.99 && Math.abs( hit.jump - head ) < 1e-9, `10 m/s against a 1 in 1 bank throws by ${ hit.jump.toFixed( 2 ) } m (stagnation head ${ head.toFixed( 2 ) } m)` );
	assert.equal( source( 2, 10, 0, 0, 1, 0.08, false ).kind, 0, 'the same flow up a 1 in 12 beach' );
	assert.equal( source( 2, 1.0, 0, 0, 1, 1.0, false ).kind, 0, 'slow water against the same bank' );
	// the leading edge: wet, fast, dry ground ahead
	const edge = source( 0.3, 6, 0, 0, 1, 0, true );
	assert.ok( edge.kind === 3 && Math.abs( edge.strength - Spray.EDGE_STRENGTH ) < 1e-9 && edge.jump > 0.3, `a 6 m/s edge 0.3 m deep (kind ${ edge.kind }, strength ${ edge.strength }, jump ${ edge.jump.toFixed( 2 ) } m)` );
	assert.equal( source( 0.3, 6, 0, 0, 1, 0, false ).kind, 0, 'the same flow with water ahead' );
	// mist over fast shallow flow, none over deep or slow water
	assert.ok( source( 0.6, 10, 0, 0, 1, 0, false ).sheet > 0.9, 'a 0.6 m sheet at 10 m/s smokes' );
	assert.equal( source( 1, 2, 0, 0, 1, 0, false ).sheet, 0, 'a 1 m sheet at 2 m/s' );
	assert.equal( source( 12, 10, 0, 0, 1, 0, false ).sheet, 0, '12 m of water at 10 m/s' );

} );

test( 'Detail follows the eye: a candidate stands for 1 m2 at 10 m, 100 m2 at 100 m and a hectare at 1 km', () => {

	for ( const [ d, m2 ] of [ [ 10, 1 ], [ 100, 100 ], [ 1000, 10000 ] ] ) assert.ok( Math.abs( candidateArea( d ) / m2 - 1 ) < 0.05, `a candidate ${ d } m out stands for ${ candidateArea( d ).toFixed( 1 ) } m2` );
	// the rings tile the ground from NEAR to FAR
	let total = 0;
	for ( let ring = 0; ring < Spray.RINGS; ring ++ ) total += candidateArea( candidateRadius( ring ) ) * Spray.ANGLES;
	const disc = Math.PI * ( Spray.FAR ** 2 - Spray.NEAR ** 2 );
	assert.ok( Math.abs( total / disc - 1 ) < 0.02, `the candidates stand for ${ ( total / 1e6 ).toFixed( 2 ) } km2 of the ${ ( disc / 1e6 ).toFixed( 2 ) } km2 disc` );
	// far away a sprite is never under a few pixels, and the face is still covered once: fewer, bigger sprites
	const near = emission( 2, 1, 8, Spray.PIXEL_FLOOR * 20 ), far = emission( 2, 1, 8, Spray.PIXEL_FLOOR * 1500 );
	assert.ok( far.radius > near.radius * 5 && far.rate < near.rate / 25, `at 1.5 km: ${ far.radius.toFixed( 2 ) } m sprites at ${ far.rate.toFixed( 4 ) } per m2 per s, at 20 m: ${ near.radius.toFixed( 2 ) } m at ${ near.rate.toFixed( 3 ) }` );
	assert.ok( Math.abs( far.rate * far.radius ** 2 * far.life - near.rate * near.radius ** 2 * near.life ) < 1e-9, 'the same live area at any distance' );
	// at arm's length one sprite never walls off the view: smaller ones, more of them
	const close = emission( 10, 1, 8, 0, Spray.NEAR_CAP * 5 );
	assert.ok( close.radius <= 1.5 + 1e-9 && close.rate > emission( 10, 1, 8 ).rate, `a 10 m jump 5 m from the eye throws ${ close.radius.toFixed( 2 ) } m sprites` );
	// a candidate that owes more sprites than it may write in a frame writes bigger ones of the same total area
	const merged = resolve( 54, 0.5, 6, Spray.SPRAY_RADIUS[ 1 ] );
	assert.ok( merged.count === 6 && Math.abs( merged.count * merged.radius ** 2 - 54 * 0.25 ) < 1e-9, `54 sprites of 0.5 m become ${ merged.count } of ${ merged.radius.toFixed( 2 ) } m` );

} );

test( 'The emission is steered so the flood region never wraps inside the longest life in flight', () => {

	const slots = 32768;
	for ( const [ H, demand ] of [ [ 10, 60000 ], [ 2, 250000 ], [ 320, 9000 ] ] ) {

		// demand: particles per second the sources ask for at full scale; the head moves at scale x demand
		const target = slots / ringSeconds( H );
		let k = 0.5;
		for ( let frame = 0; frame < 900; frame ++ ) k = steer( k, k * demand, target );
		const rate = k * demand, wrap = slots / rate;
		assert.ok( wrap >= ringSeconds( H ) * 0.97, `a ${ H } m wave asking for ${ demand } particles/s is held to ${ rate.toFixed( 0 ) }/s: the region wraps every ${ wrap.toFixed( 1 ) } s, its longest life is ${ ringSeconds( H ).toFixed( 1 ) } s` );
		assert.ok( rate > target * 0.9 || k === 1, `and no more is held back than needed (${ rate.toFixed( 0 ) } of ${ target.toFixed( 0 ) } particles/s)` );

	}
	// a small source is never throttled
	let k = 0.05;
	for ( let frame = 0; frame < 900; frame ++ ) k = steer( k, k * 500, slots / ringSeconds( 10 ) );
	assert.ok( k > 0.99, `500 particles/s runs at full scale (${ k.toFixed( 3 ) })` );

} );

// The source at one grid cell, from the packed state, as the kernel reads it at a point.
const bore = {}, src = {};
function cellSource( g, i, j ) {

	const P = g.pixels, n = g.n, k = ( j * n + i ) * 4, h = P[ k + 3 ], u = P[ k + 1 ], v = P[ k + 2 ], speed = Math.hypot( u, v );
	if ( h <= 0.002 || speed < 0.3 || i >= n - 1 || j >= n - 1 ) return source( 0, 0, 0, 0, 1, 0, false, src );
	const x = g.x + i * g.dx, z = g.z + j * g.dx, dx = u / speed, dz = v / speed;
	classifyBore( h, speed, boreFace( P, n, k, g.dx ), bore );
	const rise = Math.max( ground( x + dx * Spray.HIT_STEP, z + dz * Spray.HIT_STEP ) - ground( x, z ), 0 ) / Spray.HIT_STEP;
	const ai = Math.min( n - 1, Math.max( 0, Math.round( i + dx ) ) ), aj = Math.min( n - 1, Math.max( 0, Math.round( j + dz ) ) );
	return source( h, speed, bore.breaking, bore.jump, 1, rise, P[ ( aj * n + ai ) * 4 + 3 ] <= 0.002, src );

}

test( 'A seeded 10 m tsunami: still water throws nothing, the breaking front throws a wall of spray, and the camera\'s water follows the flood', () => {

	const field = new DisasterField( ground ), e = field.start( 'tsunami', { intensity: 10, warningLead: 3, seed: 7 } );
	const g = field.water, n = g.n, em = {}, at = {};

	// ---- before the wave: the sea at rest
	let rest = 0;
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) rest += cellSource( g, i, j ).strength;
	assert.equal( rest, 0, 'the sea at rest throws no spray' );

	// ---- no event at all: the sea's own water everywhere, over the land and under the sea
	const calm = new DisasterField( ground );
	for ( const [ x, z ] of [ [ 15, - 60 ], [ - 70, 50 ], [ 0, 3000 ], [ 200, - 300 ] ] ) assert.equal( floodMediumAt( calm, x, z, ground( x, z ) ).medium, 0, `no event: the water at ${ x }, ${ z } is the sea's` );
	assert.equal( floodMediumAt( null, 0, 0, 0 ).medium, 0, 'no disaster system: the sea\'s' );

	// ---- run until the breaking front is in the shore band (the browser scenario's own condition)
	let front = null;
	while ( field.events.has( 'tsunami' ) && e.time < e.arrival + 60 ) {

		field.advance( 0.1 );
		if ( ! e.launched || Math.round( field.time * 10 ) % 5 !== 0 ) continue;
		front = boreFront( g.pixels, n, g.dx, g.x, g.z, COAST_BAND, ground, {} );
		if ( front && front.cells >= 3 && front.crest >= 0.3 ) break;
		front = null;

	}
	assert.ok( front, `a breaking front reached the shore band (event time ${ e.time.toFixed( 1 ) } s, arrival ${ e.arrival.toFixed( 1 ) } s)` );

	// the cells of that front throw: live sprites over them, from the model at full scale
	const reach = Math.max( front.length, 48 );
	let throwing = 0, live = 0, radius = 0, jump = 0;
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

		const x = g.x + i * g.dx, z = g.z + j * g.dx;
		if ( Math.hypot( x - front.x, z - front.z ) > reach ) continue;
		const s = cellSource( g, i, j );
		if ( s.kind !== 1 ) continue;
		emission( s.jump, s.strength, g.dx, 0, Infinity, em );
		throwing ++;
		live += em.rate * g.dx * g.dx * em.life;
		radius += em.radius;
		jump = Math.max( jump, s.jump );

	}
	assert.ok( throwing >= front.cells / 2, `${ throwing } cells of the ${ front.cells }-cell front throw spray off their face` );
	assert.ok( live > 200, `the front holds ${ live.toFixed( 0 ) } live sprites of ${ ( radius / throwing ).toFixed( 2 ) } m mean radius (largest jump ${ jump.toFixed( 2 ) } m): a wall of white water, not specks` );
	assert.ok( radius / throwing >= Spray.SPRAY_RADIUS[ 0 ] && radius / throwing <= Spray.SPRAY_RADIUS[ 1 ], 'the sprites are inside their size band' );

	// ---- run on until the flood stands over the land, then ask what water a camera is in
	let land = null;
	while ( field.events.has( 'tsunami' ) && e.time < e.arrival + 90 && ! land ) {

		field.advance( 0.1 );
		if ( Math.round( field.time * 10 ) % 10 !== 0 ) continue;
		const P = g.pixels;
		for ( let c = 0; c < n * n; c ++ ) {

			const h = P[ c * 4 + 3 ], bed = P[ c * 4 ] - h;
			if ( bed > 1 && h > 2 && ( ! land || h > land.h ) ) land = { x: g.x + ( c % n ) * g.dx, z: g.z + Math.floor( c / n ) * g.dx, h, bed };

		}

	}
	assert.ok( land, 'the flood stood more than 2 m deep over land above 1 m' );
	const inFlood = floodMediumAt( field, land.x, land.z, ground( land.x, land.z ), {} );
	assert.ok( inFlood.medium > 0.99, `under ${ land.h.toFixed( 1 ) } m of flood over land at ${ land.bed.toFixed( 1 ) } m the medium is ${ inFlood.medium.toFixed( 3 ) }` );
	assert.ok( Math.abs( inFlood.depth - land.h ) < 0.05, `the camera's water column is the solver's (${ inFlood.depth.toFixed( 2 ) } m against ${ land.h.toFixed( 2 ) } m)` );
	// the same decision the surface is drawn with
	const P = g.pixels, c = Math.round( ( land.z - g.z ) / g.dx ) * n + Math.round( ( land.x - g.x ) / g.dx );
	assert.ok( Math.abs( inFlood.medium - turbidity( P[ c * 4 + 3 ], Math.hypot( P[ c * 4 + 1 ], P[ c * 4 + 2 ] ), Math.min( P[ c * 4 ] - P[ c * 4 + 3 ], ground( land.x, land.z ) ) ) ) < 1e-6, 'the medium is the surface\'s turbidity at that column' );
	// its optics are the sediment's (the browser scenario's bound), from the one set of constants
	const optics = mediumOptics( inFlood.medium, SEA.absorption, SEA.scattering );
	const sediment = SED_ABSORB.map( ( a, i ) => a + SED_SCATTER[ i ] );
	const off = Math.max( ...optics.extinction.map( ( v, i ) => Math.abs( v - sediment[ i ] ) / sediment[ i ] ) );
	assert.ok( off < 0.10, `the medium's extinction at the camera is within 10 % of the sediment extinction: ${ optics.extinction.map( ( v ) => v.toFixed( 2 ) ) } /m against ${ sediment.map( ( v ) => v.toFixed( 2 ) ) } /m` );

	// ---- the deep open sea during the same event is the sea's own water
	const outer = field.outer;
	let deep = null;
	for ( let c = 0; c < outer.n * outer.n && ! deep; c += 97 ) {

		const x = outer.x + ( c % outer.n ) * outer.dx, z = outer.z + Math.floor( c / outer.n ) * outer.dx;
		if ( ground( x, z ) < - 45 && ! g.contains( x, z ) ) deep = { x, z };

	}
	assert.ok( deep, 'the outer ring has open sea deeper than 45 m' );
	const open = floodMediumAt( field, deep.x, deep.z, ground( deep.x, deep.z ), {} );
	assert.equal( open.medium, 0, `the open sea over ${ ( - ground( deep.x, deep.z ) ).toFixed( 0 ) } m of water at ${ deep.x }, ${ deep.z } is the sea's own (medium ${ open.medium })` );
	assert.deepEqual( mediumOptics( 0, SEA.absorption, SEA.scattering ).extinction, [ 0.42 + 0.012, 0.075 + 0.018, 0.035 + 0.024 ], 'medium 0 is exactly the sea\'s coefficients' );

	// ---- wherever a camera can be under the water, the medium changes continuously: from the flooded land out to
	// sea, halving the step at least halves the largest change between neighbours (a step would keep its size)
	const out = Math.hypot( land.x, land.z ) || 1, ox = land.x / out, oz = land.z / out;
	const largest = ( step ) => {

		let last = null, worst = 0;
		for ( let s = 0; s < 400; s += step ) {

			const x = land.x + ox * s, z = land.z + oz * s;
			floodMediumAt( field, x, z, ground( x, z ), at );
			if ( at.depth <= LENS_REACH ) { last = null; continue; }
			if ( last !== null ) worst = Math.max( worst, Math.abs( at.medium - last ) );
			last = at.medium;

		}
		return worst;

	};
	const coarse = largest( 0.5 ), fine = largest( 0.125 );
	assert.ok( fine <= coarse / 2 + 1e-6, `the largest change of the medium between neighbours: ${ coarse.toFixed( 4 ) } at 0.5 m steps, ${ fine.toFixed( 4 ) } at 0.125 m` );

} );

test( 'The medium blends in time, lands exactly on the sea, and reads one set of sediment constants', () => {

	// 63 % of the way in one blend time, never past the target
	const one = blendMedium( 0, 1, MEDIUM_BLEND );
	assert.ok( Math.abs( one - ( 1 - Math.exp( - 1 ) ) ) < 1e-9, `after ${ MEDIUM_BLEND } s the medium is ${ one.toFixed( 3 ) } of the way` );
	let m = 1, steps = 0;
	while ( m !== 0 && steps < 600 ) { m = blendMedium( m, 0, 1 / 60 ); steps ++; assert.ok( m >= 0 && m <= 1, 'the blend never leaves 0..1' ); }
	assert.ok( m === 0 && steps / 60 < 4, `back in the sea the medium is exactly 0 after ${ ( steps / 60 ).toFixed( 2 ) } s` );
	assert.equal( blendMedium( 0, 0, 1 / 60 ), 0, 'with no flood the medium stays exactly 0' );
	assert.equal( blendMedium( 0.4, NaN, 1 / 60 ), 0, 'a non-finite read is the sea' );
	// the shader adds the same sediment constants the surface is drawn with
	assert.ok( FLOOD_MEDIUM_WGSL.includes( SED_WGSL.absorb ) && FLOOD_MEDIUM_WGSL.includes( SED_WGSL.scatter ), 'the WGSL twin carries FloodLook\'s sediment absorption and scattering' );
	const full = mediumOptics( 1, SEA.absorption, SEA.scattering );
	assert.deepEqual( full.absorption, [ 0.42 + SED_ABSORB[ 0 ], 0.075 + SED_ABSORB[ 1 ], 0.035 + SED_ABSORB[ 2 ] ], 'absorption at medium 1 is the sea\'s plus SED_ABSORB' );
	assert.deepEqual( full.scattering, [ 0.012 + SED_SCATTER[ 0 ], 0.018 + SED_SCATTER[ 1 ], 0.024 + SED_SCATTER[ 2 ] ], 'scattering at medium 1 is the sea\'s plus SED_SCATTER' );

} );
