import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField } from '../src/disasters/Field.js';
import * as FL from '../src/disasters/FloodLook.js';

const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );

test( 'The cover that ends the rest sea\'s surf is one rule across the waterline: no step where the bed crosses the datum', () => {

	// Either side of the 0 m contour under the same surge the swash, the surf foam and the surf medium fade alike.
	// (The beach is close to planar, so a step on that contour is a straight line across the frame.)
	for ( const surge of [ 0.3, 0.5, 0.8, 1.2, 2.0 ] ) {

		const sea = FL.floodCover( - 0.005, surge - 0.005, surge ), land = FL.floodCover( 0.005, surge + 0.005, surge );
		assert.ok( Math.abs( sea - land ) < 0.03, `a ${ surge } m surge covers the surf ${ sea.toFixed( 3 ) } just below the datum and ${ land.toFixed( 3 ) } just above it` );

	}
	// and the decisions the rule already held stay: the sea at rest keeps its surf, a flooded street has none, a bed
	// the drawdown has bared has none, dry land is not covered
	assert.equal( FL.floodCover( - 5, 0, 5 ), 0, 'the sea at rest keeps its surf' );
	assert.ok( FL.floodCover( 3, 3.8, 0.8 ) > 0.999, 'a 0.8 m flood over the land ends the surf' );
	assert.ok( FL.floodCover( - 0.3, - 0.3, 0 ) > 0.999, 'a bed the drawdown has bared 0.3 m under the datum has no surf' );
	assert.equal( FL.floodCover( 2, 0, 0 ), 0, 'dry land is not covered' );
	assert.ok( FL.floodCover( - 20, 2.5, 22.5 ) > 0.999, 'a 2.5 m surge over deep water ends the surf' );

} );

test( 'The snout\'s foam fades with the bed, it does not switch on a contour', () => {

	const at = ( bed ) => FL.whitewater( 0, 2.0, 0.05, 3, bed, 0, 1, 1 );
	for ( const bed of [ - 0.9, - 0.7, - 0.5, - 0.3 ] ) {

		const a = at( bed - 0.01 ), b = at( bed + 0.01 );
		assert.ok( Math.abs( a - b ) < 0.05, `the snout's cover steps from ${ a.toFixed( 2 ) } to ${ b.toFixed( 2 ) } across the ${ bed } m contour` );

	}
	assert.ok( at( 0.5 ) > 0.4, `a 5 cm sheet at 3 m/s over the land has a foaming snout (${ at( 0.5 ).toFixed( 2 ) })` );
	assert.equal( at( - 3 ), 0, 'no snout over 3 m of sea' );

} );

test( 'Fast water is rough, slack water is smooth, and the open sea keeps its own surface', () => {

	const t = FL.floodTurbulence ?? ( () => 0 );
	assert.ok( t( 1.2, 4, 0 ) > 0.85, `a supercritical sheet at 4 m/s has turbulence ${ t( 1.2, 4, 0 ).toFixed( 2 ) } (want a rough, boiling surface)` );
	assert.equal( t( 0.02, 0.1, 0 ), 0, 'slack water is smooth' );
	assert.ok( t( 0.08, 1.5, 0 ) < 0.15, `a 1.5 m/s current over deep water has turbulence ${ t( 0.08, 1.5, 0 ).toFixed( 2 ) } (the sea's own surface must stay)` );
	assert.ok( t( 0.3, 1, 1 ) > 0.99, 'a breaking face is fully turbulent' );
	assert.ok( t( 0.5, 2, 0 ) > t( 0.5, 1, 0 ), 'faster water is rougher' );

} );

test( 'The drawn sheet thins to nothing toward ground the flood has not reached, and keeps its level against rising ground', () => {

	const cap = FL.sheetCap ?? ( () => Infinity );
	assert.equal( cap( 0.4, 1 ), 0, `at a dry corner below the water's level the sheet is ${ cap( 0.4, 1 ) } m thick (a step: the stepped edge against the sand)` );
	assert.ok( cap( 0.4, 0 ) > 5, 'with no such corner the level is carried to where the real ground rises through it' );
	assert.ok( cap( 0.4, 0.5 ) >= 0.4, `half way to the dry corner the sheet still has its depth (${ cap( 0.4, 0.5 ).toFixed( 2 ) } m of 0.4)` );
	let last = Infinity;
	for ( let o = 0; o <= 1.0001; o += 0.05 ) {

		const c = cap( 0.4, o );
		assert.ok( c <= last + 1e-9, `the sheet thickens toward the dry corner at weight ${ o.toFixed( 2 ) }` );
		last = c;

	}

} );

// A uniform sheet: n x n cells of spacing dx, depth h over a flat bed at `bed`, running at (u, 0).
function sheet( n, dx, h, u, bed = 1 ) {

	const P = new Float32Array( n * n * 4 );
	for ( let k = 0; k < P.length; k += 4 ) { P[ k ] = bed + h; P[ k + 1 ] = u; P[ k + 3 ] = h; }
	return P;

}

test( 'Foam is carried by the flow and decays: a patch drifts at the water\'s speed and is gone within a few lifetimes', () => {

	assert.ok( FL.FloodHistory, 'the flood keeps no history: foam cannot outlive the breaking, be carried, or decay' );
	const n = 33, dx = 8, H = new FL.FloodHistory();
	H.begin( n, 0, 0, dx );
	const F = FL.HIST_FOAM, at = ( i, j ) => ( j * n + i ) * 4 + F;
	const centroid = () => { let s = 0, m = 0; for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) { s += H.data[ at( i, j ) ]; m += H.data[ at( i, j ) ] * i; } return { x: m / s * dx, sum: s }; };
	// still water: the foam stays put and decays with FOAM_LIFE
	const still = sheet( n, dx, 1, 0 );
	H.data[ at( 16, 16 ) ] = 1;
	for ( let t = 0; t < FL.FOAM_LIFE - 1e-6; t += 0.1 ) H.step( still, n, dx, 0.1 );
	const left = H.data[ at( 16, 16 ) ];
	assert.ok( left > 0.30 && left < 0.42, `after one lifetime (${ FL.FOAM_LIFE } s) on still water ${ left.toFixed( 3 ) } of the foam is left (want about 1/e)` );
	for ( let t = 0; t < 6 * FL.FOAM_LIFE; t += 0.1 ) H.step( still, n, dx, 0.1 );
	assert.ok( H.data[ at( 16, 16 ) ] < 0.01, `after seven lifetimes ${ H.data[ at( 16, 16 ) ].toFixed( 4 ) } of the foam is left` );
	// running water: 4 m/s for 5 s carries it 20 m
	H.begin( n, 100, 0, dx );
	const run = sheet( n, dx, 1, 4 );
	H.data[ at( 8, 16 ) ] = 1;
	const x0 = centroid().x;
	for ( let i = 0; i < 50; i ++ ) H.step( run, n, dx, 0.1 );
	const moved = centroid().x - x0;
	assert.ok( Math.abs( moved - 20 ) < 4, `foam on water running at 4 m/s drifted ${ moved.toFixed( 1 ) } m in 5 s (want 20 m)` );
	assert.equal( H.data[ at( 8, 12 ) ], 0, 'and none of it went across the flow' );

} );

// One seeded 2 m event on the real island with the history stepped as the renderer steps it, to `after` s past arrival.
let run2 = null;
function surge() {

	if ( run2 ) return run2;
	const field = new DisasterField( ground ), e = field.start( 'tsunami', { intensity: 2, warningLead: 3, seed: 7 } );
	const H = FL.FloodHistory ? new FL.FloodHistory() : null;
	const g0 = field.water, n = g0.n, cells = n * n;
	H?.begin( n, g0.x, g0.z, g0.dx );
	const deepest = new Float32Array( cells ), lastWet = new Float32Array( cells ).fill( - 1 );
	let rest = null, born = null, ms = 0, steps = 0;
	const scratch = {};
	while ( field.events.has( 'tsunami' ) && e.time < e.arrival + 25 ) {

		field.advance( 0.1 );
		const g = field.water;
		if ( ! g ) break;
		const P = g.pixels;
		if ( H ) {

			const t0 = performance.now();
			H.step( P, n, g.dx, 0.1 );
			ms += performance.now() - t0;
			steps ++;

		}
		for ( let c = 0; c < cells; c ++ ) {

			const h = P[ c * 4 + 3 ];
			if ( h > deepest[ c ] ) deepest[ c ] = h;
			if ( h > 0.05 ) lastWet[ c ] = e.time;

		}
		if ( ! e.launched ) {

			// the sea at rest before the wave: what the history holds
			let most = 0;
			if ( H ) for ( let k = 0; k < H.data.length; k ++ ) most = Math.max( most, H.data[ k ] );
			rest = { most, live: H ? H.live : false };
			continue;

		}
		if ( ! H || Math.round( e.time * 10 ) % 10 !== 0 ) continue;
		// foam on the breaking face, each second there is one of at least 20 cells
		let cellsB = 0, foamB = 0;
		for ( let j = 1; j < n - 1; j ++ ) for ( let i = 1; i < n - 1; i ++ ) {

			const k = ( j * n + i ) * 4, h = P[ k + 3 ];
			if ( h <= 0.002 ) continue;
			FL.classifyBore( h, Math.hypot( P[ k + 1 ], P[ k + 2 ] ), FL.boreFace( P, n, k, g.dx ), scratch );
			if ( scratch.breaking > 0.5 ) { cellsB ++; foamB += H.data[ k + FL.HIST_FOAM ]; }

		}
		if ( cellsB >= 20 && ( ! born || foamB / cellsB < born.mean ) ) born = { mean: foamB / cellsB, cells: cellsB, t: e.time - e.arrival };

	}
	return run2 = { field, e, H, n, deepest, lastWet, rest, born, ms: steps ? ms / steps : 0, steps };

}

test( 'A 2 m surge: foam is born on the breaking face and outlives it; the flooded land runs rough and loaded with sediment', () => {

	const r = surge(), H = r.H;
	assert.ok( H, 'the flood keeps no history: foam cannot outlive the breaking, be carried, or decay' );
	const g = r.field.water, P = g.pixels, n = r.n, scratch = {};
	console.log( `# measured 2 m history: ${ r.steps } steps, ${ r.ms.toFixed( 2 ) } ms each on this machine` );
	assert.ok( r.born, 'the 2 m run never had a breaking face of 20 cells' );
	assert.ok( r.born.mean > 0.9, `the breaking face carries foam ${ r.born.mean.toFixed( 2 ) } at its weakest moment (arrival ${ r.born.t.toFixed( 0 ) } s, ${ r.born.cells } cells)` );
	let breaking = 0, carried = 0, carriedSum = 0, land = 0, turb = 0, load = 0, deep = 0, deepTurb = 0;
	for ( let j = 1; j < n - 1; j ++ ) for ( let i = 1; i < n - 1; i ++ ) {

		const k = ( j * n + i ) * 4, h = P[ k + 3 ];
		if ( h <= 0.002 ) continue;
		const speed = Math.hypot( P[ k + 1 ], P[ k + 2 ] ), bed = P[ k ] - h;
		FL.classifyBore( h, speed, FL.boreFace( P, n, k, g.dx ), scratch );
		if ( scratch.breaking > 0.5 ) breaking ++;
		else if ( H.data[ k + FL.HIST_FOAM ] > 0.3 ) { carried ++; carriedSum += H.data[ k + FL.HIST_FOAM ]; }
		if ( bed > 0.5 && h > 0.3 && speed > 2 ) { land ++; turb += H.data[ k + FL.HIST_TURB ]; load += H.data[ k + FL.HIST_LOAD ]; }
		if ( h > 30 ) { deep ++; deepTurb = Math.max( deepTurb, H.data[ k + FL.HIST_TURB ] ); }

	}
	console.log( `# measured 2 m at arrival + 25 s: ${ breaking } breaking cells, ${ carried } more carry foam over 0.3 (mean ${ ( carriedSum / Math.max( carried, 1 ) ).toFixed( 2 ) }); ${ land } fast land cells, turbulence ${ ( turb / Math.max( land, 1 ) ).toFixed( 2 ) }, sediment ${ ( load / Math.max( land, 1 ) ).toFixed( 2 ) }; deep sea turbulence max ${ deepTurb.toFixed( 3 ) } over ${ deep } cells` );
	assert.ok( carried > breaking, `foam stands on ${ carried } cells off the face against ${ breaking } breaking: it does not outlive the breaking` );
	assert.ok( carriedSum / Math.max( carried, 1 ) < 0.95, 'the carried foam has not decayed at all' );
	assert.ok( land >= 20, `only ${ land } land cells run faster than 2 m/s` );
	assert.ok( turb / land > 0.6, `fast flood water over the land has turbulence ${ ( turb / land ).toFixed( 2 ) } (want rough)` );
	assert.ok( load / land > 0.9, `fast flood water over the land has sediment load ${ ( load / land ).toFixed( 2 ) } (want opaque brown)` );
	assert.ok( deep > 100 && deepTurb < 0.25, `water deeper than 30 m has turbulence up to ${ deepTurb.toFixed( 2 ) } (the ocean's own surface must stay)` );

} );

test( 'Ground the flood covered stays wet, ground it never reached does not, and it dries over minutes after the grids are gone', () => {

	const r = surge(), H = r.H;
	assert.ok( H, 'the flood keeps no wet history: covered ground dries the instant the water leaves' );
	const g = r.field.water, P = g.pixels, n = r.n, W = FL.HIST_WET;
	let under = 0, underMin = 1, left = 0, leftMin = 1, never = 0, neverMax = 0, sea = 0, seaMax = 0;
	for ( let j = 1; j < n - 1; j ++ ) for ( let i = 1; i < n - 1; i ++ ) {

		const c = j * n + i, k = c * 4, h = P[ k + 3 ], bed = ground( g.x + i * g.dx, g.z + j * g.dx ), w = H.data[ k + W ];
		if ( bed < - 1 ) { sea ++; seaMax = Math.max( seaMax, w ); continue; }
		if ( bed < 0.5 ) continue;
		if ( h > 0.05 ) { under ++; underMin = Math.min( underMin, w ); }
		else if ( r.lastWet[ c ] >= 0 && h <= 0.002 && r.e.time - r.lastWet[ c ] < 60 ) { left ++; leftMin = Math.min( leftMin, w ); }
		else if ( r.deepest[ c ] <= 0.002 ) { never ++; neverMax = Math.max( neverMax, w ); }

	}
	console.log( `# measured 2 m wet history: ${ under } land cells under water (wet min ${ underMin.toFixed( 2 ) }), ${ left } the water left within 60 s (wet min ${ leftMin.toFixed( 2 ) }), ${ never } never reached (wet max ${ neverMax.toFixed( 3 ) }), ${ sea } sea cells (wet max ${ seaMax.toFixed( 3 ) })` );
	assert.ok( under >= 50 && underMin > 0.99, `flooded land is wet ${ underMin.toFixed( 2 ) } at its driest over ${ under } cells` );
	assert.ok( left === 0 || leftMin > 0.8, `ground the water left within the last minute is wet ${ leftMin.toFixed( 2 ) } (want still dark: over 0.8)` );
	assert.ok( never >= 1000 && neverMax === 0, `ground the flood never reached is wet ${ neverMax.toFixed( 3 ) } over ${ never } cells` );
	assert.equal( seaMax, 0, 'the seabed under the sea takes no wet history (the ocean\'s seabed look must not change)' );
	// the grids are dropped: the ground dries with WET_DRY and the history then switches itself off
	const k0 = ( () => { for ( let k = 0; k < H.data.length; k += 4 ) if ( H.data[ k + W ] > 0.99 ) return k; return - 1; } )();
	assert.ok( k0 >= 0 && H.live, 'the history is live while ground is wet' );
	for ( let t = 0; t < FL.WET_DRY - 1e-6; t += 0.5 ) H.dry( 0.5 );
	const one = H.data[ k0 + W ];
	assert.ok( one > 0.30 && one < 0.42, `after ${ FL.WET_DRY } s with the water gone the ground is wet ${ one.toFixed( 3 ) } (want about 1/e: it dries slowly)` );
	assert.ok( H.live, 'and the history is still live' );
	for ( let t = 0; t < 6 * FL.WET_DRY; t += 0.5 ) H.dry( 0.5 );
	assert.ok( ! H.live, 'once the ground has dried the history switches off (nothing left to draw or to pay for)' );

} );

test( 'With no wave the history holds nothing: the sea at rest and the dry beach leave it empty', () => {

	const fresh = FL.FloodHistory ? new FL.FloodHistory() : null;
	assert.ok( fresh, 'the flood keeps no history' );
	assert.equal( fresh.live, false, 'a new history is not live' );
	const r = surge();
	assert.ok( r.rest, 'the 2 m run launched on its first step' );
	assert.equal( r.rest.most, 0, `before the wave the history's largest value over the whole grid is ${ r.rest.most }` );
	assert.equal( r.rest.live, false, 'before the wave the history is not live' );

} );

// ---- What a frame of the flood showed once the shaders ran: decisions the look rests on.

test( 'Running water is rough whatever its regime: a current through a flooded street or over the beach breaks the surface, the open sea and slack water do not', () => {

	const t = FL.floodTurbulence ?? ( () => 0 );
	const street = t( 2 / Math.sqrt( 9.81 * 1 ), 2, 0 ), beach = t( 2 / Math.sqrt( 9.81 * 3 ), 2, 0 );
	assert.ok( street > 0.7, `2 m/s through 1 m of water in a street has turbulence ${ street.toFixed( 2 ) } (want a broken surface, over 0.7)` );
	assert.ok( beach > 0.45, `2 m/s through 3 m of water over the beach has turbulence ${ beach.toFixed( 2 ) } (want over 0.45: it drew as a mirror of the sky)` );
	assert.ok( t( 0.08, 1.5, 0 ) < 0.15, 'a current over deep water leaves the sea its own surface' );
	assert.equal( t( 0.02, 0.1, 0 ), 0, 'slack water is smooth' );

} );

test( 'A rough surface seen at a grazing angle reflects a fraction of the sky, a flat one nearly all of it', () => {

	const F = FL.meanFresnel ?? ( ( c ) => 0.02 + 0.98 * ( 1 - c ) ** 5 );
	const graze = Math.cos( 87 * Math.PI / 180 );
	assert.ok( F( graze, 0 ) > 0.7, `a flat sheet 3 degrees off grazing reflects ${ F( graze, 0 ).toFixed( 2 ) } of the sky (the mirror)` );
	assert.ok( F( graze, 0.245 ) < 0.35, `a boiling surface (slope deviation 0.245) 3 degrees off grazing reflects ${ F( graze, 0.245 ).toFixed( 2 ) } of the sky (want under 0.35: its own body shows)` );
	assert.ok( F( graze, 0.1 ) < F( graze, 0 ) && F( graze, 0.245 ) < F( graze, 0.1 ), 'the rougher, the less' );
	assert.ok( Math.abs( F( 1, 0.245 ) - 0.02 ) < 0.01, `straight down it stays water's 2 % (${ F( 1, 0.245 ).toFixed( 3 ) })` );

} );

test( 'The flood\'s edge is a film of its own water: a thin sheet over the land carries its sediment, and the sheet ends inside the cell', () => {

	const thin = FL.turbidity( 0.05, 1, 1 );
	assert.ok( thin > 0.9, `a 5 cm sheet over the land has turbidity ${ thin.toFixed( 2 ) } (clear, it drew a pale band along the flood's edge)` );
	assert.equal( FL.turbidity( 0.5, 0, - 0.5 ), 0, 'half a metre of the sea at rest stays clear' );
	assert.ok( FL.turbidity( 0.6, 0, - 0.5 ) < 0.2, `10 cm of surge over it barely colours it (${ FL.turbidity( 0.6, 0, - 0.5 ).toFixed( 2 ) })` );
	const cap = FL.sheetCap ?? ( () => Infinity );
	assert.equal( cap( 0.4, 0.85 ), 0, `with 85 % of the weight on dry corners the sheet is still ${ cap( 0.4, 0.85 ).toFixed( 3 ) } m thick: it ends only on the lines between dry grid points, a stair-step outline` );

} );

test( 'Foam off the face is gathered into rafts: clear water between them, dense foam inside, about the same share of the surface', () => {

	const raft = FL.raft ?? ( ( cover ) => cover );
	assert.equal( raft( 0.3, 0.2 ), 0, `a 30 % cover leaves ${ raft( 0.3, 0.2 ).toFixed( 2 ) } on the pattern's low ground (want clear water: an even thin cover draws as white scribbles)` );
	assert.ok( raft( 0.3, 0.95 ) > 0.7, `and is dense on its high ground (${ raft( 0.3, 0.95 ).toFixed( 2 ) })` );
	assert.equal( raft( 1, 0 ), 1, 'a full cover (the roller) stays solid' );
	assert.equal( raft( 0, 1 ), 0, 'no cover, no foam' );
	for ( const c of [ 0.2, 0.5, 0.8 ] ) {

		let sum = 0;
		for ( let i = 0; i < 1000; i ++ ) sum += raft( c, ( i + 0.5 ) / 1000 );
		assert.ok( Math.abs( sum / 1000 - c ) < 0.15, `a ${ c } cover gathered into rafts covers ${ ( sum / 1000 ).toFixed( 2 ) } of the surface` );

	}

} );

test( 'The history steps a band of rows a frame and ends where one whole step would: no frame carries the whole grid', () => {

	const r = surge();
	assert.ok( r.H, 'the flood keeps no history' );
	const g = r.field.water, P = g.pixels, n = r.n, whole = new FL.FloodHistory(), banded = new FL.FloodHistory();
	for ( const H of [ whole, banded ] ) {

		H.begin( n, g.x, g.z, g.dx );
		H.data.set( r.H.data );

	}
	whole.step( P, n, g.dx, 0.1 );
	const bands = FL.HISTORY_BANDS ?? 8, rows = Math.ceil( ( n - 2 ) / bands );
	for ( let j = 1; j < n - 1; j += rows ) banded.step( P, n, g.dx, 0.1, j, Math.min( n - 1, j + rows ) );
	let differ = 0, most = 0;
	for ( let k = 0; k < whole.data.length; k ++ ) {

		const d = Math.abs( whole.data[ k ] - banded.data[ k ] );
		if ( d > 0 ) differ ++;
		most = Math.max( most, d );

	}
	assert.equal( differ, 0, `stepped in ${ bands } bands of rows the history differs from one whole step at ${ differ } values (by up to ${ most.toFixed( 3 ) })` );
	assert.equal( banded.live, whole.live, 'and is live or not as the whole step says' );

} );

test( 'Water returning over a bed the flood silted is brown again: the bed keeps the load the flood left', () => {

	assert.ok( FL.FloodHistory, 'the flood keeps no history' );
	const n = 9, dx = 8, H = new FL.FloodHistory();
	H.begin( n, 0, 0, dx );
	// a loaded sheet runs over the shallows (bed -0.3 m), the drawdown bares them for 5 s, then the still sea returns
	const loaded = sheet( n, dx, 1.5, 3, - 0.3 ), bare = sheet( n, dx, 0, 0, - 0.3 ), back = sheet( n, dx, 0.3, 0, - 0.3 );
	const k = ( 4 * n + 4 ) * 4 + FL.HIST_LOAD;
	for ( let t = 0; t < 2; t += 0.1 ) H.step( loaded, n, dx, 0.1 );
	assert.ok( H.data[ k ] > 0.9, `the flood over the shallows is loaded (${ H.data[ k ].toFixed( 2 ) })` );
	for ( let t = 0; t < 5; t += 0.1 ) H.step( bare, n, dx, 0.1 );
	for ( let t = 0; t < 5; t += 0.1 ) H.step( back, n, dx, 0.1 );
	assert.ok( H.data[ k ] > 0.8, `10 s after a loaded flood left the shallows, the sea that returned over them carries a load of ${ H.data[ k ].toFixed( 2 ) } (clear, it drew a turquoise strip along the brown bay)` );

} );
