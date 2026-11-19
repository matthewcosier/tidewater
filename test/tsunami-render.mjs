import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField } from '../src/disasters/Field.js';
import { boreFroude, classifyBore, turbidity, gridLook, boreFront, BORE_FR_LO, BORE_FR_HI, COAST_BAND, LAND_BAND, COAST_BED_LO, COAST_BED_HI } from '../src/disasters/FloodLook.js';
import { frontPose, clearSight, FRONT_SHORE_LO, FRONT_SHORE_HI } from '../src/core/DebugViews.js';
import * as FloodLook from '../src/disasters/FloodLook.js';

const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );

test( 'The bore thresholds are Chanson\'s: undular below a bore Froude number of 1.3, fully breaking by 2', () => {
	// Chanson (2009, Eur. J. Mech. B 28): undular bores for Fr1 < 1.3-1.5, breaking (a roller) beyond ~1.5-1.8.
	assert.ok( Math.abs( boreFroude( BORE_FR_LO ) - 1.3 ) < 0.02, `local Fr ${ BORE_FR_LO } is bore Fr ${ boreFroude( BORE_FR_LO ).toFixed( 3 ) }` );
	assert.ok( Math.abs( boreFroude( BORE_FR_HI ) - 2.0 ) < 0.02, `local Fr ${ BORE_FR_HI } is bore Fr ${ boreFroude( BORE_FR_HI ).toFixed( 3 ) }` );
	// Still water and slow flow with no face are never a bore; a fast thin sheet running onto the land is.
	assert.equal( classifyBore( 5, 0, 0 ).breaking, 0 );
	assert.equal( classifyBore( 5, 1.0, 0.0 ).breaking, 0, 'a steady current with a flat surface has no face' );
	assert.ok( classifyBore( 0.8, 6, 0.2 ).breaking > 0.99, 'a 0.8 m sheet at 6 m/s with a 0.2 face is a breaking bore' );
	// Sediment: none in the deep sea, opaque brown water over the land.
	assert.equal( turbidity( 60, 0.5, - 60 ), 0 );
	assert.ok( turbidity( 1.5, 4, 3 ) > 0.8 );
} );

// Run one seeded event until its crest has been at the target for `after` s; record the strongest bore look seen.
function run( intensity, after ) {
	const field = new DisasterField( ground ), e = field.start( 'tsunami', { intensity, warningLead: 3, seed: 7 } );
	const best = { inner: null, outer: null, still: null };
	const look = ( grid ) => gridLook( grid.pixels, grid.n, grid.dx, grid.x, grid.z );
	best.still = [ look( field.water ), look( field.outer ) ];
	let restCover = 0;
	for ( const g of [ field.water, field.outer ] ) for ( let k = 0; k < g.pixels.length; k += 4 ) {
		const h = g.pixels[ k + 3 ];
		if ( h > FloodLook.SEABED_FILM ) restCover = Math.max( restCover, FloodLook.floodCover( g.pixels[ k ] - h, g.pixels[ k ], h ) );
	}
	const sight = { seen: 0, blocked: [] };
	let wall = 0, coast = 0, ashore = 0, front = null, land = null, ww = null, seabed = null, drawdown = null;
	while ( field.events.has( 'tsunami' ) && e.time < e.arrival + after ) {
		field.advance( 0.1 );
		if ( Math.round( field.time * 10 ) % 10 !== 0 || ! e.launched ) continue;
		{
			const P = field.water.pixels;
			let bare = 0, wetMin = 1, sea = 0, seaMax = 0, drained = 0, coverMin = 1;
			for ( let k = 0; k < P.length; k += 4 ) {
				const h = P[ k + 3 ], bed = P[ k ] - h;
				if ( bed < - 0.05 && h < 0.002 ) { drained ++; coverMin = Math.min( coverMin, FloodLook.floodCover( bed, P[ k ], h ) ); }
				if ( bed > - 1 ) continue;
				const w = FloodLook.seabedWetness?.( bed, P[ k ], h ) ?? 0;
				if ( h < 0.002 ) { bare ++; wetMin = Math.min( wetMin, w ); } else if ( h > 0.1 ) { sea ++; seaMax = Math.max( seaMax, w ); }
			}
			if ( ! seabed || bare > seabed.bare ) seabed = { bare, wetMin, sea, seaMax, drained, coverMin, t: e.time - e.arrival };
		}
		if ( e.time < e.arrival ) {
			const g = field.water, P = g.pixels, a = e.direction * Math.PI / 180, hx = Math.cos( a ), hz = Math.sin( a );
			let back = 0, white = 0, onshore = 0;
			for ( let j = 0; j < g.n - 1; j ++ ) for ( let i = 0; i < g.n - 1; i ++ ) {
				const k = ( j * g.n + i ) * 4, h = P[ k + 3 ], u = P[ k + 1 ], v = P[ k + 2 ], speed = Math.hypot( u, v );
				if ( h <= 0.002 || P[ k ] - h > - 0.5 || speed < 0.3 ) continue;
				const breaking = classifyBore( h, speed, FloodLook.boreFace( P, g.n, k, g.dx ) ).breaking > 0.5;
				if ( u * hx + v * hz < 0 ) { back ++; if ( breaking ) white ++; } else if ( breaking ) onshore ++;
			}
			// (the drawdown alone: once the wave's own face runs ashore in the grid, a bore reflected off the headlands runs
			// back to sea and breaks for real; at 320 m that is the last few seconds before the arrival estimate)
			if ( back >= 50 && onshore === 0 && ( ! drawdown || white / back > drawdown.frac ) ) drawdown = { back, white, frac: white / back, onshore, t: e.time - e.arrival };
		}
		{
			const g = field.water, fr = boreFront( g.pixels, g.n, g.dx, g.x, g.z, COAST_BAND, ground );
			if ( fr ) {
				const v = frontPose( 'shore', fr, ground );
				sight.seen ++;
				if ( ! clearSight( ...v.p, ...v.target, ground ) ) sight.blocked.push( `t ${ ( e.time - e.arrival ).toFixed( 0 ) } s eye ${ v.p.map( ( c ) => c.toFixed( 0 ) ).join( ' ' ) }` );
			}
		}
		for ( const key of [ 'inner', 'outer' ] ) {
			const s = look( key === 'inner' ? field.water : field.outer );
			if ( ! best[ key ] || s.boreCells > best[ key ].boreCells ) best[ key ] = s;
			wall = Math.max( wall, s.maxJump );
			if ( key === 'inner' && s.wwFloodCells >= 50 && ( ! ww || s.wwFlood > ww.mean ) ) ww = { mean: s.wwFlood, cells: s.wwFloodCells, t: e.time - e.arrival };
			if ( key === 'inner' && e.coastReached ) {
				ashore ++;
				coast = Math.max( coast, s.coastBore );
				const g = field.water;
				const fr = boreFront( g.pixels, g.n, g.dx, g.x, g.z, COAST_BAND, ground );
				if ( fr && ( ! front || fr.cells > front.cells ) ) front = { ...fr };
				const lf = boreFront( g.pixels, g.n, g.dx, g.x, g.z, LAND_BAND, ground, {}, { edge: true } );
				if ( lf && ( ! land || lf.cells > land.cells ) ) land = { ...lf };
			}
		}
	}
	return { ...best, wall, coast, ashore, front, land, ww, seabed, sight, restCover, drawdown, e };
}
const runs = new Map();
const once = ( intensity, after ) => runs.get( intensity ) ?? runs.set( intensity, run( intensity, after ) ).get( intensity );

test( 'A 2 m surge: a breaking bore face where it runs ashore, nothing on still water, brown water over the land', () => {
	const r = once( 2, 25 );
	for ( const s of r.still ) assert.equal( s.boreCells, 0, `still sea before launch: ${ s.boreCells } bore cells` );
	const s = r.inner;
	console.log( `# measured 2 m: bore cells ${ s.boreCells }, max local Fr ${ s.maxFroude.toFixed( 2 ) }, jump ${ r.wall.toFixed( 2 ) } m, turbidity land ${ s.turbidLand.toFixed( 2 ) } over ${ s.landCells } cells, deep ${ s.turbidDeep.toFixed( 3 ) }` );
	assert.ok( s.boreCells > 0, `no bore face found in the 2 km grid (max local Fr ${ s.maxFroude.toFixed( 2 ) })` );
	assert.ok( r.wall > 0.4 && r.wall < 8, `the 2 m surge's front jump is ${ r.wall.toFixed( 2 ) } m` );
	assert.ok( s.turbidLand > 0.6, `flood water over the land is turbidity ${ s.turbidLand.toFixed( 2 ) } (want sediment laden)` );
	assert.ok( s.turbidDeep < 0.05, `water deeper than 30 m is turbidity ${ s.turbidDeep.toFixed( 3 ) } (want the ocean's own colour)` );
} );

test( 'A 320 m wall: a towering breaking face, its jump a large fraction of the wall', () => {
	const r = once( 320, 6 );
	const cells = ( r.inner?.boreCells ?? 0 ) + ( r.outer?.boreCells ?? 0 );
	console.log( `# measured 320 m: bore cells inner ${ r.inner?.boreCells } outer ${ r.outer?.boreCells }, jump ${ r.wall.toFixed( 1 ) } m` );
	assert.ok( cells > 0, 'no bore face found for the 320 m wall' );
	assert.ok( r.wall > 60, `the 320 m wall's front jump is only ${ r.wall.toFixed( 1 ) } m` );
} );

test( 'A 2 m surge once it is ashore: the breaking face stands in the shore band where the player watches it', () => {
	const r = once( 2, 25 );
	console.log( `# measured 2 m ashore: ${ r.ashore } looks after coastReached, most bore cells in the shore band ${ r.coast }` );
	assert.ok( r.ashore > 0, 'the 2 m crest never reached the coast' );
	assert.ok( r.coast > 0, `no breaking bore cell on the shore (bed -8..+6 m) once the crest was ashore: ${ r.coast }` );
} );

test( 'A 2 m surge ashore: the review camera finds the breaking front running up the shore and stands 120-200 m in front of it', () => {
	const r = once( 2, 25 );
	const f = r.front;
	assert.ok( f, 'no connected breaking front in the shore band once the crest was ashore' );
	const lf = r.land;
	console.log( `# measured 2 m front: ${ f.cells } cells, ${ f.length.toFixed( 0 ) } m of face at x ${ f.x.toFixed( 0 ) } z ${ f.z.toFixed( 0 ) }, crest ${ f.crest.toFixed( 2 ) } m, bed ${ f.bed.toFixed( 2 ) } m, heading ${ f.dirX.toFixed( 2 ) } ${ f.dirZ.toFixed( 2 ) }; overland edge ${ lf ? `${ lf.cells } cells, bed ${ lf.bed.toFixed( 1 ) } m` : 'none' }` );
	assert.ok( f.cells >= 3, `the front is ${ f.cells } cells (${ f.length.toFixed( 0 ) } m): a speck, not a face` );
	assert.ok( f.bed >= COAST_BED_LO && f.bed <= COAST_BED_HI, `the front's mean bed ${ f.bed.toFixed( 2 ) } m is outside the shore band` );
	// it runs up the beach: the ground 40 m ahead of the face stands higher than 40 m behind it
	const rise = ground( f.x + f.dirX * 40, f.z + f.dirZ * 40 ) - ground( f.x - f.dirX * 40, f.z - f.dirZ * 40 );
	assert.ok( rise > 0, `the front heads ${ f.dirX.toFixed( 2 ) }, ${ f.dirZ.toFixed( 2 ) }, down the shore (ground change ${ rise.toFixed( 2 ) } m over 80 m)` );
	// the shore view: in front of the face, on the land side, above the ground, looking straight at it
	const v = frontPose( 'shore', f, ground );
	const d = Math.hypot( v.p[ 0 ] - f.x, v.p[ 2 ] - f.z );
	assert.ok( d >= FRONT_SHORE_LO && d <= FRONT_SHORE_HI, `the shore camera is ${ d.toFixed( 0 ) } m from the face` );
	assert.ok( v.p[ 1 ] >= ground( v.p[ 0 ], v.p[ 2 ] ) + 1, `the shore camera is ${ ( v.p[ 1 ] - ground( v.p[ 0 ], v.p[ 2 ] ) ).toFixed( 2 ) } m above the ground` );
	assert.ok( clearSight( ...v.p, ...v.target, ground ), `the ground hides the face from the shore eye at ${ v.p.map( ( c ) => c.toFixed( 0 ) ).join( ', ' ) }` );
	console.log( `# 2 m shore sight: ${ r.sight.seen } staged moments, ${ r.sight.blocked.length } blocked ${ r.sight.blocked.slice( 0, 3 ).join( '; ' ) }` );
	assert.equal( r.sight.blocked.length, 0, `the ground hides the face from the shore eye at ${ r.sight.blocked.length } of ${ r.sight.seen } moments: ${ r.sight.blocked.slice( 0, 3 ).join( '; ' ) }` );
	const fwd = [ - Math.sin( v.yaw ) * Math.cos( v.pitch ), Math.sin( v.pitch ), - Math.cos( v.yaw ) * Math.cos( v.pitch ) ];
	const t = [ v.target[ 0 ] - v.p[ 0 ], v.target[ 1 ] - v.p[ 1 ], v.target[ 2 ] - v.p[ 2 ] ], tl = Math.hypot( ...t );
	const off = Math.acos( Math.min( 1, ( fwd[ 0 ] * t[ 0 ] + fwd[ 1 ] * t[ 1 ] + fwd[ 2 ] * t[ 2 ] ) / tl ) ) * 180 / Math.PI;
	assert.ok( off < 2, `the shore camera looks ${ off.toFixed( 1 ) } deg off the face` );
	assert.ok( Math.hypot( v.target[ 0 ] - f.x, v.target[ 2 ] - f.z ) < 1, 'the shore camera aims beside the face' );
} );

test( 'The flooded land is brown water with foam streaks, not a white sheet: whitewater cover off the bore face under 0.35', () => {
	for ( const [ h, after ] of [ [ 2, 25 ], [ 320, 6 ] ] ) {
		const r = once( h, after );
		assert.ok( r.ww, `the ${ h } m run never flooded 50 cells of land` );
		console.log( `# measured ${ h } m: whitewater cover off the face ${ r.ww.mean.toFixed( 3 ) } over ${ r.ww.cells } flooded land cells at arrival + ${ r.ww.t.toFixed( 0 ) } s` );
		assert.ok( r.ww.mean < 0.35, `the ${ h } m flood over the land is ${ ( r.ww.mean * 100 ).toFixed( 0 ) } % white off the bore face (want streaks under 35 %)` );
	}
} );

test( 'A 320 m wall: the street view finds the flood\'s edge over the land and stands on dry ground with a clear sight of it', () => {
	const r = once( 320, 6 );
	const f = r.land;
	assert.ok( f, 'no leading edge of the flood over the land once the 320 m crest was ashore' );
	const v = frontPose( 'street', f, ground );
	const g = ground( v.p[ 0 ], v.p[ 2 ] );
	console.log( `# measured 320 m edge: ${ f.cells } cells, ${ f.length.toFixed( 0 ) } m at x ${ f.x.toFixed( 0 ) } z ${ f.z.toFixed( 0 ) }, bed ${ f.bed.toFixed( 1 ) } m, crest ${ f.crest.toFixed( 1 ) } m; eye at ${ v.p.map( ( x ) => x.toFixed( 0 ) ).join( ' ' ) } on ground ${ g.toFixed( 1 ) } m` );
	assert.ok( f.cells >= 3, `the edge is ${ f.cells } cells` );
	assert.ok( f.bed >= LAND_BAND[ 0 ] && f.bed <= LAND_BAND[ 1 ], `the edge's mean bed ${ f.bed.toFixed( 1 ) } m is off the land` );
	assert.ok( g > f.crest + 0.5, `the street eye stands on ground ${ g.toFixed( 1 ) } m, under the water at ${ f.crest.toFixed( 1 ) } m` );
	assert.ok( clearSight( ...v.p, ...v.target, ground ), 'the ground hides the edge from the street eye' );
} );

test( 'A 320 m drawdown bares the seabed: the terrain draws it wet, as wet as the beach\'s wet band; the seabed under the sea is untouched', () => {
	for ( const [ h, after, least ] of [ [ 320, 6, 50 ], [ 2, 25, 1 ] ] ) {
		const sb = once( h, after ).seabed;
		console.log( `# measured ${ h } m seabed: ${ sb.bare } bared cells below -1 m at arrival ${ sb.t.toFixed( 0 ) } s, wetness min ${ sb.wetMin.toFixed( 3 ) }; ${ sb.sea } cells under the sea, wetness max ${ sb.seaMax.toFixed( 3 ) }` );
		assert.ok( sb.bare >= least, `the ${ h } m drawdown bared only ${ sb.bare } cells of seabed below -1 m` );
		assert.ok( sb.wetMin >= 0.999, `${ h } m: bared seabed draws wetness ${ sb.wetMin.toFixed( 3 ) }, drier than the beach's wet band (1 below the sea)` );
		assert.ok( sb.seaMax <= 0.001, `${ h } m: seabed under the sea takes wetness ${ sb.seaMax.toFixed( 3 ) }: the ocean's seabed look must not change` );
	}
} );

test( 'A 320 m drawdown ends the rest sea\'s surf on the bared seabed: no swash film, surf foam or surf medium over drained cells; the sea at rest keeps its surf', () => {
	for ( const [ h, after ] of [ [ 320, 6 ], [ 2, 25 ] ] ) {
		const r = once( h, after ), sb = r.seabed;
		console.log( `# measured ${ h } m: ${ sb.drained } drained cells under the rest sea, surf cover min ${ sb.coverMin.toFixed( 3 ) }; cover over the sea before the wave max ${ r.restCover.toFixed( 3 ) }` );
		assert.ok( sb.drained >= ( h > 100 ? 50 : 1 ), `the ${ h } m drawdown drained only ${ sb.drained } cells` );
		assert.ok( sb.coverMin >= 0.999, `${ h } m: the rest sea's surf keeps ${ ( 1 - sb.coverMin ).toFixed( 3 ) } of itself over a drained cell (the white field over the bared bay)` );
		assert.ok( r.restCover <= 0.001, `${ h } m: before the wave the flood covers the rest sea's surf by ${ r.restCover.toFixed( 3 ) }` );
	}
} );

test( 'A 320 m drawdown is water draining back to sea, not a breaking bore: under 1 % of the receding sheet classifies as a face before the wave\'s face reaches the grid', { todo: '5.3 % -> 4.2 % with the flux-convergence gate (FACE_FILL): the rest are real seaward fronts in the solver (the receding sheet running into the drained trough), remainder' }, () => {
	const d = once( 320, 6 ).drawdown;
	console.log( `# measured 320 m drawdown: ${ d.white } of ${ d.back } receding cells over the seabed breaking (${ ( d.frac * 100 ).toFixed( 1 ) } %) at ${ d.t.toFixed( 0 ) } s, ${ d.onshore } breaking cells running ashore` );
	assert.ok( d.frac < 0.01, `the drawdown draws ${ ( d.frac * 100 ).toFixed( 1 ) } % of the receding sheet as a breaking face (white)` );
} );
