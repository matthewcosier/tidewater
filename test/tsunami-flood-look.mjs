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
	// still water: the foam stays put and decays (in two stages: 'Once its source stops the foam falls in two stages')
	const still = sheet( n, dx, 1, 0 );
	H.data[ at( 16, 16 ) ] = 1;
	for ( let t = 0; t < 7 * FL.FOAM_LIFE; t += 0.1 ) H.step( still, n, dx, 0.1 );
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
		let cellsB = 0, foamB = 0, rollB = 0;
		for ( let j = 1; j < n - 1; j ++ ) for ( let i = 1; i < n - 1; i ++ ) {

			const k = ( j * n + i ) * 4, h = P[ k + 3 ];
			if ( h <= 0.002 ) continue;
			// (the cells a front's roller covers, FL.frontFoam: the classifier's breaking calls nearly every cell of a big flood)
			const roll = FL.frontFoam( P, n, i, j, g.dx );
			if ( roll > 0.5 ) { cellsB ++; foamB += H.data[ k + FL.HIST_FOAM ]; rollB += roll; }

		}
		if ( cellsB >= 20 && ( ! born || foamB / cellsB < born.mean ) ) born = { mean: foamB / cellsB, roller: rollB / cellsB, cells: cellsB, t: e.time - e.arrival };

	}
	return run2 = { field, e, H, n, deepest, lastWet, rest, born, ms: steps ? ms / steps : 0, steps };

}

test( 'A 2 m surge: foam is born on the breaking face and outlives it; the flooded land runs rough and loaded with sediment', () => {

	const r = surge(), H = r.H;
	assert.ok( H, 'the flood keeps no history: foam cannot outlive the breaking, be carried, or decay' );
	const g = r.field.water, P = g.pixels, n = r.n, scratch = {};
	console.log( `# measured 2 m history: ${ r.steps } steps, ${ r.ms.toFixed( 2 ) } ms each on this machine` );
	assert.ok( r.born, 'the 2 m run never had a front with a roller over 20 cells' );
	assert.ok( r.born.mean >= r.born.roller - 1e-6 && r.born.mean > 0.5, `the roller of the front carries foam ${ r.born.mean.toFixed( 2 ) } at its weakest moment against ${ r.born.roller.toFixed( 2 ) } it makes there (want at least that, dense: arrival ${ r.born.t.toFixed( 0 ) } s, ${ r.born.cells } cells)` );
	let breaking = 0, carried = 0, carriedSum = 0, land = 0, turb = 0, load = 0, deep = 0, deepTurb = 0;
	for ( let j = 1; j < n - 1; j ++ ) for ( let i = 1; i < n - 1; i ++ ) {

		const k = ( j * n + i ) * 4, h = P[ k + 3 ];
		if ( h <= 0.002 ) continue;
		const speed = Math.hypot( P[ k + 1 ], P[ k + 2 ] ), bed = P[ k ] - h;
		if ( FL.frontFoam( P, n, i, j, g.dx ) > 0.5 ) breaking ++;
		else if ( H.data[ k + FL.HIST_FOAM ] > 0.3 ) { carried ++; carriedSum += H.data[ k + FL.HIST_FOAM ]; }
		if ( bed > 0.5 && h > 0.3 && speed > 2 ) { land ++; turb += H.data[ k + FL.HIST_TURB ]; load += H.data[ k + FL.HIST_LOAD ]; }
		if ( h > 30 ) { deep ++; deepTurb = Math.max( deepTurb, H.data[ k + FL.HIST_TURB ] ); }

	}
	console.log( `# measured 2 m at arrival + 25 s: ${ breaking } cells under a roller, ${ carried } more carry foam over 0.3 (mean ${ ( carriedSum / Math.max( carried, 1 ) ).toFixed( 2 ) }); ${ land } fast land cells, turbulence ${ ( turb / Math.max( land, 1 ) ).toFixed( 2 ) }, sediment ${ ( load / Math.max( land, 1 ) ).toFixed( 2 ) }; deep sea turbulence max ${ deepTurb.toFixed( 3 ) } over ${ deep } cells` );
	assert.ok( carried > breaking, `foam stands on ${ carried } cells off the front against ${ breaking } under its roller: it does not outlive the breaking` );
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
	// a loaded sheet runs over the shallows (bed -0.3 m; a metre deep at 4 m/s, shallow enough for its speed to carry
	// the bed to the surface), the drawdown bares them for 5 s, then the still sea returns
	const loaded = sheet( n, dx, 1, 4, - 0.3 ), bare = sheet( n, dx, 0, 0, - 0.3 ), back = sheet( n, dx, 0.3, 0, - 0.3 );
	const k = ( 4 * n + 4 ) * 4 + FL.HIST_LOAD;
	for ( let t = 0; t < 2; t += 0.1 ) H.step( loaded, n, dx, 0.1 );
	assert.ok( H.data[ k ] > 0.9, `the flood over the shallows is loaded (${ H.data[ k ].toFixed( 2 ) })` );
	for ( let t = 0; t < 5; t += 0.1 ) H.step( bare, n, dx, 0.1 );
	for ( let t = 0; t < 5; t += 0.1 ) H.step( back, n, dx, 0.1 );
	assert.ok( H.data[ k ] > 0.8, `10 s after a loaded flood left the shallows, the sea that returned over them carries a load of ${ H.data[ k ].toFixed( 2 ) } (clear, it drew a turquoise strip along the brown bay)` );

} );

test( 'A surge\'s current over open water leaves the sea its own colour: the bed\'s mud reaches the surface only where the water is shallow for its speed', () => {

	// The long-wave current of a 2 m surge is about 2 m/s over 10 m of water. The bed's fines take minutes to mix up
	// through that column; through half a metre they are at the surface in seconds.
	const open = FL.turbidity( 10, 2, - 10 );
	assert.ok( open < 0.05, `a 2 m/s current over 10 m of open water has turbidity ${ open.toFixed( 2 ) } (want the sea's own colour, under 0.05: the whole bay drew brown to the horizon)` );
	const shallow = FL.turbidity( 0.6, 3, - 2 );
	assert.ok( shallow > 0.8, `3 m/s through 0.6 m of water over the seabed has turbidity ${ shallow.toFixed( 2 ) } (want loaded: the surf zone of a surge is brown)` );
	const front = FL.turbidity( 12, 24, - 3 );
	assert.ok( front > 0.6, `the front of a 10 m wave at the shore (24 m/s through 12 m) has turbidity ${ front.toFixed( 2 ) } (want dark with the bed it tore up)` );
	// the seeded 2 m event 25 s after arrival: the bay beyond the 6 m depth line
	const r = surge(), g = r.field.water, P = g.pixels, n = r.n;
	let cells = 0, load = 0;
	for ( let j = 1; j < n - 1; j ++ ) for ( let i = 1; i < n - 1; i ++ ) {

		const k = ( j * n + i ) * 4, h = P[ k + 3 ];
		if ( h <= 0.002 || P[ k ] - h > - 6 ) continue;
		cells ++;
		load += r.H.data[ k + FL.HIST_LOAD ];

	}
	assert.ok( cells > 1000 && load / cells < 0.05, `25 s after a 2 m surge reached the village, the sea over beds deeper than 6 m carries a mean sediment load of ${ ( load / cells ).toFixed( 2 ) } over ${ cells } cells (want under 0.05: silt belongs where the flow has scoured)` );

} );

test( 'A tall face is dark water with a white crest and a white foot: the foam off a wall does not paint its whole face', () => {

	// the middle of a 200 m face: breaking, with the foam the face has made carried on it, between two streaks
	const mid = FL.whitewater( 1, 2, 200, 100, - 20, 0.5, 0, 1, 1, 0 );
	assert.ok( mid <= 0.3, `the middle of a 200 m face between its streaks is ${ mid.toFixed( 2 ) } white (want dark water, at most 0.3: the wall drew as a cliff of chalk)` );
	const top = FL.whitewater( 1, 2, 200, 100, - 20, 0.5, 0, 1, 1, 1 );
	assert.ok( top >= 0.9, `the crest and the foot of the same face are ${ top.toFixed( 2 ) } white (want the torn white front, over 0.9)` );
	const bore = FL.whitewater( 1, 1, 2, 5, 0.5, 0, 0, 1, 1, 0 );
	assert.ok( bore >= 0.9, `the face of a 2 m bore is ${ bore.toFixed( 2 ) } white (want its roller white from top to toe)` );
	// the far wall keeps its white to the crest band: off the band, the water that falls away ahead of the face is no wake
	const far = FL.whitewater( 0, 2, 100, 50, - 50, 0.6, 0, 0, 0, 0 );
	assert.ok( far < 0.05, `the face of the far wall below its crest band is ${ far.toFixed( 2 ) } white (want none: it drew as a pale curtain)` );
	assert.ok( FL.tallFront, 'the look has no rule for where a tall face is white' );
	// where on a face: surface here, two cells behind and two cells ahead along the flow (m), over a span of 32 m
	const crest = FL.tallFront( 300, 300, 200, 32 ), foot = FL.tallFront( 20, 120, 18, 32 ), middle = FL.tallFront( 150, 200, 100, 32 ), plateau = FL.tallFront( 300, 300.5, 299.5, 32 );
	assert.ok( crest > 0.9, `the top of a face (level behind, 100 m lower ahead) is ${ crest.toFixed( 2 ) } front (want the crest white)` );
	assert.ok( foot > 0.9, `the foot of a face (100 m higher behind, level ahead) is ${ foot.toFixed( 2 ) } front (want the foot white)` );
	assert.ok( middle < 0.05, `the middle of a face (as much higher behind as lower ahead) is ${ middle.toFixed( 2 ) } front (want dark)` );
	assert.ok( plateau < 0.05, `the water behind the crest (a metre of fall over 32 m) is ${ plateau.toFixed( 2 ) } front (want none)` );

} );

test( 'The flood\'s own motion is written for the temporal pass wherever the flood is drawn, and nowhere else', () => {

	assert.ok( FL.motionWeight, 'the look has no rule for where the flood\'s motion is written' );
	// turbulence, sediment load and foam cover as the water shader has them at a pixel
	assert.equal( FL.motionWeight( 0, 0, 0 ), 0, 'the sea with no flood on it keeps the camera\'s motion alone' );
	const street = FL.motionWeight( FL.floodTurbulence( 2 / Math.sqrt( FL.G * 1 ), 2, 0 ), 1, 0 );
	assert.ok( street > 0.99, `2 m/s through a metre of brown water in a street carries ${ street.toFixed( 2 ) } of its flow as motion (want all of it: the pattern it drags smeared along the flow)` );
	const raft = FL.motionWeight( 0, 0, 0.6 );
	assert.ok( raft > 0.99, `a raft of foam drifting on clear water carries ${ raft.toFixed( 2 ) } of its flow as motion (want all of it)` );

} );

test( 'An arriving edge carries a line of foam to its very end, and a draining edge carries none', () => {

	assert.ok( FL.FloodHistory, 'the flood keeps no history' );
	// a sheet half a metre deep runs at 3 m/s toward +x over the land (bed 1 m) and ends at column 5: dry ground ahead
	const n = 13, dx = 8, P = sheet( n, dx, 0.5, 3, 1 ), back = sheet( n, dx, 0.5, - 3, 1 );
	for ( const G of [ P, back ] ) for ( let j = 0; j < n; j ++ ) for ( let i = 5; i < n; i ++ ) {

		const k = ( j * n + i ) * 4;
		G[ k ] = 0;
		G[ k + 1 ] = G[ k + 2 ] = G[ k + 3 ] = 0;

	}
	const H = new FL.FloodHistory(), at = ( i, j ) => H.data[ ( j * n + i ) * 4 + FL.HIST_FOAM ];
	H.begin( n, 0, 0, dx );
	H.step( P, n, dx, 0.1 );
	assert.ok( at( 5, 6 ) > 0.5, `the dry cell a 3 m/s front is about to enter holds foam ${ at( 5, 6 ).toFixed( 2 ) } (want the front's foam there already, over 0.5: the drawn sheet's film reaches into that cell and had no foam line at its end)` );
	assert.equal( at( 7, 6 ), 0, 'and the ground two cells further on holds none' );
	H.begin( n, 100, 0, dx );
	H.step( back, n, dx, 0.1 );
	assert.equal( at( 5, 6 ), 0, 'the dry cell beside an edge that runs away from it holds no foam' );
	// the line itself: the sheet's last centimetres, where a fast front has brought its foam
	assert.ok( FL.edgeLine, 'the look has no rule for the foam line at an arriving edge' );
	const tip = FL.edgeLine( 0.03, 3, 0.7, 1 ), body = FL.edgeLine( 0.6, 3, 0.7, 1 ), slack = FL.edgeLine( 0.03, 0.2, 0, 1 );
	assert.ok( tip > 0.8, `the last 3 cm of a sheet arriving at 3 m/s are ${ tip.toFixed( 2 ) } foam (want a white line, over 0.8)` );
	assert.equal( body, 0, 'the body behind the line is not part of it' );
	assert.equal( slack, 0, 'a still edge has no foam line' );

} );

test( 'The ground a flood leaves is wet to a ragged edge: soaked where it stood, dry where it never came, and between the two the ground\'s small relief decides', () => {

	assert.ok( FL.soakedGround, 'the look has no rule for the edge of the wet ground' );
	// wet: the history's wet value (1 under the flood, 0 never reached); relief: the ground's small relief, 0 a hollow, 1 a rise
	for ( const relief of [ 0, 0.5, 1 ] ) {

		assert.equal( FL.soakedGround( 1, relief ), 1, `ground the flood has just left is soaked on relief ${ relief }` );
		assert.equal( FL.soakedGround( 0, relief ), 0, `ground the flood never reached is dry on relief ${ relief }` );

	}
	const hollow = FL.soakedGround( 0.6, 0.1 ), rise = FL.soakedGround( 0.6, 0.9 );
	assert.ok( hollow > 0.9 && rise < 0.1, `at the flood's edge a hollow is ${ hollow.toFixed( 2 ) } soaked and a rise ${ rise.toFixed( 2 ) } (want the hollow wet and the rise dry: the wet ground's outline was a smooth lobe, like spilt paint)` );

} );

test( 'Behind the front the foam the face left is streaks on dark water, not a white sheet', () => {

	// water 3 m deep running at 8 m/s behind a 10 m front, no longer breaking, between two streaks of the pattern, with
	// the foam the face left decayed as the history decays it (0.94 of the face's after 0.3 s: its dense stage fades
	// with FOAM_ACTIVE_LIFE)
	const after = ( s ) => FL.whitewater( 0, 1.5, 3, 8, 1, 0, 0, 1, foamLeft( s ) );
	assert.ok( after( 0.3 ) > 0.85, `0.3 s behind the face the foam it left covers ${ after( 0.3 ).toFixed( 2 ) } (want the white of the front, over 0.85)` );
	assert.ok( after( 4 ) < 0.35, `4 s behind the face the foam it left still covers ${ after( 4 ).toFixed( 2 ) } between the streaks (want dark water there, under 0.35: the flood behind a 10 m and a 25 m front drew as a field of snow)` );

} );

// Where the foam is born (docs/disasters.md "Design: foam where the water breaks"). It was born wherever a cell
// classified as breaking (a local Froude number and an absolute surface slope), and in a large event nearly every
// cell does: nine tenths of the land behind a 10 m front and the whole sea behind the 320 m wall held dense foam.
// A stream of n x n cells of dx m running at u m/s along +x over a flat bed 1 m up, depth( i ) m deep in column i.
function stream( n, dx, u, depth ) {

	const P = new Float32Array( n * n * 4 );
	for ( let j = 0; j < n; j ++ ) for ( let i = 0; i < n; i ++ ) {

		const k = ( j * n + i ) * 4, h = depth( i );
		P[ k ] = 1 + h;
		P[ k + 1 ] = u;
		P[ k + 3 ] = h;

	}
	return P;

}

// The most foam the history holds in columns i0..i1 after stepping the frozen state P for t s from none.
function foamAfter( P, n, dx, t, i0 = 1, i1 = n - 2 ) {

	const H = new FL.FloodHistory();
	H.begin( n, 0, 0, dx );
	for ( let s = 0; s < t - 1e-6; s += 0.1 ) H.step( P, n, dx, 0.1 );
	let most = 0;
	for ( let j = 1; j < n - 1; j ++ ) for ( let i = i0; i <= i1; i ++ ) most = Math.max( most, H.data[ ( j * n + i ) * 4 + FL.HIST_FOAM ] );
	return most;

}

test( 'A deep, fast, smooth body behind the front makes no foam: foam is born where the water loses energy, not where it runs fast and deep', () => {

	// 10 m deep at 12 m/s (Froude 1.2) in the middle, the depth falling 6 % a cell along the flow (a depth ratio of
	// 1.26 across four cells, from 25 m to 4 m over the grid), so the flux converges as it does behind a front
	const n = 33, dx = 8, foam = foamAfter( stream( n, dx, 12, ( i ) => 10 * Math.pow( 1.06, 16 - i ) ), n, dx, 5 );
	assert.ok( foam < 0.05, `a 10 m deep flow at 12 m/s whose depth falls 6 % a cell along the flow holds foam ${ foam.toFixed( 2 ) } after 5 s (want none, under 0.05: a smooth body behind the front is dark water)` );

} );

test( 'A front past the undular bore makes foam and an undular step does not: the roller starts at a bore Froude number of 1.3', () => {

	// a step spread over four cells on a 12 m/s stream: 10 m to 8 m (depth ratio 1.25, bore Froude 1.19) and 9 m to
	// 3 m (depth ratio 3, bore Froude 2.45), stepped for 1 s
	const n = 33, dx = 8, step = ( hi, lo ) => ( i ) => i <= 14 ? hi : i >= 18 ? lo : hi + ( lo - hi ) * ( i - 14 ) / 4;
	const undular = foamAfter( stream( n, dx, 12, step( 10, 8 ) ), n, dx, 1 );
	assert.ok( undular < 0.05, `an undular step (depth ratio 1.25, bore Froude 1.19) on a 12 m/s flow holds foam ${ undular.toFixed( 2 ) } (want none, under 0.05: only a front past Froude 1.3 carries a roller)` );
	const front = foamAfter( stream( n, dx, 12, step( 9, 3 ) ), n, dx, 1, 15, 17 );
	assert.ok( front > 0.9, `a breaking front (depth ratio 3, bore Froude 2.45) on a 12 m/s flow holds foam ${ front.toFixed( 2 ) } on its face (want its roller white, over 0.9)` );

} );

// The foam the history holds on still water s seconds after a source of 1 stopped (the history's own decay).
function foamLeft( s ) {

	const n = 9, dx = 8, H = new FL.FloodHistory(), still = sheet( n, dx, 1, 0 ), at = ( 4 * n + 4 ) * 4 + FL.HIST_FOAM;
	H.begin( n, 0, 0, dx );
	H.data[ at ] = 1;
	for ( let t = 0; t < s - 1e-6; t += 0.1 ) H.step( still, n, dx, 0.1 );
	return H.data[ at ];

}

test( 'Once its source stops the foam falls in two stages: dense for seconds, then a thin residue for tens of seconds', () => {

	// (fallbacks, so that without the two stages the failure is the value: clean sea foam's 3.5 s, Monahan and Zietlow 1969)
	const active = FL.FOAM_ACTIVE_LIFE ?? 3.5, residual = FL.FOAM_RESIDUAL ?? 0.3, life = FL.FOAM_LIFE;
	const dense = foamLeft( active ), want = residual + ( 1 - residual ) / Math.E;
	assert.ok( Math.abs( dense - want ) < 0.03, `${ active } s after the source stops the foam is still ${ dense.toFixed( 2 ) } (want the dense stage down to 1/e: about ${ want.toFixed( 2 ) })` );
	const thin = foamLeft( 4 * active ), floor = residual * Math.exp( - 4 * active / life );
	assert.ok( thin <= residual && thin > floor, `${ 4 * active } s after it the foam is ${ thin.toFixed( 2 ) } (want the dense stage over, at most ${ residual }, and the residue still there, over ${ floor.toFixed( 2 ) })` );
	const later = foamLeft( 4 * active + life ) / thin;
	assert.ok( Math.abs( later - 1 / Math.E ) < 0.03, `${ life } s later the residue has fallen to ${ later.toFixed( 2 ) } of itself (want 1/e: the residual life is ${ life } s)` );

} );

test( 'Flood foam is lit like the water round it: on a face turned from the sun it takes no sun, on a lit face the facet\'s cosine', () => {

	// light( sun, cos, sky, up ): the light on the flood's body and its foam per unit albedo, from the sun's irradiance
	// after the shadow maps, the facet's cosine to the sun, the sky's irradiance over pi and the facet's up component.
	// (fallback: the wrapped light flood foam took, so that without the rule the failure is the value)
	const light = FL.floodLight ?? ( ( sun, cos, sky ) => sun * ( Math.max( cos, 0 ) * 0.75 + 0.25 ) / Math.PI + sky * 0.95 );
	const sun = 3, sky = 0.4, share = ( cos, up ) => ( light( sun, cos, sky, up ) - light( 0, cos, sky, up ) ) / sun * Math.PI;
	assert.ok( Math.abs( share( - 0.5, 0.2 ) ) < 1e-6, `flood foam on a face turned from the sun takes ${ share( - 0.5, 0.2 ).toFixed( 2 ) } of the sun (want none: foam in the lee of the wall or of a building is in shadow)` );
	assert.ok( Math.abs( share( 0.6, 0.8 ) - 0.6 ) < 1e-6, `and on a face at 0.60 to the sun ${ share( 0.6, 0.8 ).toFixed( 2 ) } of the sun (want the facet's cosine, as the water round it takes)` );
	assert.ok( light( 0, 0, sky, 0 ) < light( 0, 0, sky, 1 ), `a vertical face sees as much sky as a level one (${ light( 0, 0, sky, 0 ).toFixed( 2 ) }: want less, as the water round it)` );

} );

test( 'Five seconds after a 10 m wave reaches the village under a third of the flooded land carries dense foam, and its front still does', () => {

	const field = new DisasterField( ground ), e = field.start( 'tsunami', { intensity: 10, warningLead: 3, seed: 7 } );
	const g0 = field.water, n = g0.n, H = new FL.FloodHistory();
	H.begin( n, g0.x, g0.z, g0.dx );
	while ( field.events.has( 'tsunami' ) && e.time < e.arrival + 5 ) {

		field.advance( 0.1 );
		const g = field.water;
		if ( ! g ) break;
		H.step( g.pixels, n, g.dx, 0.1 );

	}
	assert.ok( field.water, 'the 10 m event lost its grids before arrival + 5 s' );
	const s = FL.foamShare( field.water.pixels, H.data, n );
	console.log( `# measured 10 m at arrival + 5 s (event ${ e.time.toFixed( 1 ) } s): ${ s.land } flooded land cells, ${ ( s.landShare * 100 ).toFixed( 1 ) } % dense foam; sea ${ ( s.seaShare * 100 ).toFixed( 1 ) } %` );
	assert.ok( s.land > 1000, `the 10 m wave flooded only ${ s.land } land cells by arrival + 5 s` );
	assert.ok( s.landShare < 1 / 3, `5 s after a 10 m wave reaches the village ${ ( s.landShare * 100 ).toFixed( 1 ) } % of the flooded land carries dense foam (want under a third: the body behind the front is dark water)` );
	assert.ok( s.landShare > 0.05, `and ${ ( s.landShare * 100 ).toFixed( 1 ) } % of it does (want the breaking front and its wake white, over 5 %)` );

} );

test( 'A deep column over a bed the drawdown silted keeps the sea\'s colour: the bed\'s silt is diluted through the column', () => {

	// the drawdown's sheet a metre deep at 4 m/s over the bared bay 20 m down loads the history; then the 320 m wall,
	// 300 m deep at 40 m/s, runs over the same bed (as the wall's face over the drained bay drew tan-brown from top to toe)
	const n = 9, dx = 8, H = new FL.FloodHistory(), k = ( 4 * n + 4 ) * 4 + FL.HIST_LOAD;
	H.begin( n, 0, 0, dx );
	for ( let t = 0; t < 2; t += 0.1 ) H.step( sheet( n, dx, 1, 4, - 20 ), n, dx, 0.1 );
	assert.ok( H.data[ k ] > 0.9, `the drawdown's fast sheet over the bay is loaded (${ H.data[ k ].toFixed( 2 ) })` );
	const wall = sheet( n, dx, 300, 40, - 20 );
	for ( let t = 0; t < 1; t += 0.1 ) H.step( wall, n, dx, 0.1 );
	assert.ok( H.data[ k ] < 0.05, `a 300 m column of the wall over a bed the drawdown silted carries a load of ${ H.data[ k ].toFixed( 2 ) } after 1 s (want the sea's own colour, under 0.05: a bed's silt is diluted through the column)` );

} );

test( 'The sun\'s glint on the flood\'s chop is the Gaussian of its slopes, so off the glitter path the flood is no brighter than the sea, and without a flood the sea keeps its own lobe', () => {

	// glint( NdH, NdL, NdV, a2, share ): the microfacet lobe D x V the water material lights the sun's glint with, for a
	// pixel of roughness a2 (2 x the slope variance below it, the sea's convention) of which share is the flood's chop.
	// (fallback: the sea's GGX lobe on the summed a2, as the flood took it, so that without the rule the failure is the value)
	const ggx = ( nh, nl, nv, a2 ) => {

		const d = nh * nh * ( a2 - 1 ) + 1;
		return a2 / ( d * d * Math.PI ) * ( 0.5 / Math.max( nl * Math.sqrt( nv * nv * ( 1 - a2 ) + a2 ) + nv * Math.sqrt( nl * nl * ( 1 - a2 ) + a2 ), 1e-5 ) );

	};
	const glint = FL.floodGlint ?? ( ( nh, nl, nv, a2 ) => ggx( nh, nl, nv, a2 ) );
	// The density of facet normals the lobe holds, read back through the lobe itself: lit and seen along the facet's own
	// normal, D = glint / V, V = 1 / ( 4 c^2 ( 1 + 2 Lambda( c ) ) ) with the lobe's own Lambda (GGX's, exact, for the
	// sea's lobe). The slopes' density is D cos^4 of the facet's tilt.
	const lambdaG = ( c, a2 ) => ( Math.sqrt( 1 + a2 * ( 1 - c * c ) / ( c * c ) ) - 1 ) / 2;
	const lambda = FL.floodGlint ? ( c, a2 ) => FL.beckmannLambda( c, a2 / 2 ) : lambdaG;
	const slopeDensity = ( s, a2 ) => {

		const c = 1 / Math.sqrt( 1 + s * s );
		return glint( c, c, c, a2, 1 ) * 4 * c * c * ( 1 + 2 * lambda( c, a2 ) ) * c ** 4;

	};
	// The flood's chop at full turbulence holds a mean square slope of 0.06-0.09 (FloodLook CHOP_*); here 0.08, alone.
	const msq = 0.08, a2 = 2 * msq, gauss = ( s ) => Math.exp( - s * s / msq ) / ( Math.PI * msq );
	for ( const k of [ 3, 2, 1, 0 ] ) {

		const s = k * Math.sqrt( msq ), r = slopeDensity( s, a2 ) / gauss( s );
		assert.ok( Math.abs( r - 1 ) < 1e-3, `at ${ k } times its rms slope (${ s.toFixed( 2 ) }, ${ ( Math.atan( s ) * 180 / Math.PI ).toFixed( 0 ) } degrees) the flood's glint lobe holds ${ r.toFixed( 2 ) } times the density of the Gaussian of its slope variance ${ msq } (want the Gaussian: water's slopes are close to it, Cox and Munk 1954)` );

	}
	// normalised: the facets' projected area is the pixel's, and their mean square slope is the variance asked for
	let area = 0, second = 0;
	const D = ( nh ) => slopeDensity( Math.sqrt( 1 - nh * nh ) / nh, a2 ) / nh ** 4;
	for ( let i = 0, m = 20000; i < m; i ++ ) {

		const th = ( i + 0.5 ) / m * ( Math.PI / 2 ), dA = 2 * Math.PI * Math.sin( th ) * ( Math.PI / 2 / m );
		const d = D( Math.cos( th ) ) * Math.cos( th ) * dA;
		area += d;
		second += d * Math.tan( th ) ** 2;

	}
	assert.ok( Math.abs( area - 1 ) < 5e-3, `the flood's lobe covers ${ area.toFixed( 3 ) } of the pixel's projected area (want 1: normalised)` );
	assert.ok( Math.abs( second / msq - 1 ) < 0.01, `its facets' mean square slope is ${ second.toFixed( 4 ) } (want the chop's ${ msq })` );
	// the masking is the lobe's own: the facets seen from a direction cover the pixel's area projected on it
	for ( const deg of [ 30, 60, 80 ] ) {

		const cv = Math.cos( deg * Math.PI / 180 ), sv = Math.sin( deg * Math.PI / 180 ), g1 = 1 / ( 1 + lambda( cv, a2 ) );
		let seen = 0;
		for ( let i = 0, m = 600; i < m; i ++ ) for ( let j = 0, q = 240; j < q; j ++ ) {

			const th = ( i + 0.5 ) / m * ( Math.PI / 2 ), ph = ( j + 0.5 ) / q * 2 * Math.PI;
			const vm = Math.max( sv * Math.sin( th ) * Math.cos( ph ) + cv * Math.cos( th ), 0 );
			seen += g1 * vm * D( Math.cos( th ) ) * Math.sin( th ) * ( Math.PI / 2 / m ) * ( 2 * Math.PI / q );

		}
		assert.ok( Math.abs( seen / cv - 1 ) < 0.02, `seen from ${ deg } degrees the flood's facets cover ${ ( seen / cv ).toFixed( 3 ) } of the pixel's projected area (want 1: the masking matches the distribution)` );

	}
	// Toward the sun, a facet 40 degrees off the mirror direction (three rms slopes of the chop): the flood, its chop on
	// the sea's own roughness (a2 0.06, a 7 m/s wind far off), sends the eye less sun than the sea beside it.
	const sea = 0.06, flood = sea + a2, nh = Math.cos( 40 * Math.PI / 180 ), nl = 0.6, nv = 0.7;
	const ratio = glint( nh, nl, nv, flood, a2 / flood ) / ggx( nh, nl, nv, sea );
	assert.ok( ratio < 1, `toward the sun a flood facet 40 degrees off the mirror direction sends ${ ratio.toFixed( 2 ) } times the sea's glint beside it (want less: no facet on the water is tilted that far)` );
	// and without a flood the sea's lobe, to the last bit
	let moved = 0;
	for ( const g of [ 0.0012, 0.01, 0.06, 0.3 ] ) for ( let c = 0.05; c <= 1; c += 0.05 ) for ( const l of [ 0.1, 0.5, 0.9 ] ) if ( glint( c, l, 0.7, g, 0 ) !== ggx( c, l, 0.7, g ) ) moved ++;
	assert.equal( moved, 0, `without a flood the glint moved off the sea's GGX lobe at ${ moved } samples (want none)` );

} );

test( 'A wall of water is white at its crest and its foot and torn into streaks down its whole face, whatever the classifier calls each part of it, and dark between the streaks', () => {

	// faceRoller( breaking, jumpRoller, front, wall ): the face's white source per pixel, from the breaking classifier,
	// the roller of the jump ahead, a tall face's crest and foot (tallFront) and the face of a wall (tallFace).
	// (fallback: the rule as it was, the classifier's breaking times the larger of the jump's roller and the crest and
	// foot, so that without the rule the failure is the value)
	const rollerOf = FL.faceRoller ?? ( ( breaking, jump, front ) => breaking * Math.max( jump, front ) );
	const wallOf = FL.tallFace ?? ( () => 0 );
	// The 320 m wall 3 s before it arrives (seed 7, 32 m cells, the stencil FRONT_SPAN cells either way): the classifier
	// called its crest band about half breaking and parts of it none (water debug view 19: the crest's front 1, its roller
	// 0). Here the classifier calls none of it breaking: the white must come from the face itself.
	const span = 2 * FL.FRONT_SPAN * 32;
	const at = ( s, behind, ahead, h, streakV, carried ) => {

		const front = FL.tallFront( s, behind, ahead, span ), wall = wallOf( s, behind, ahead, span, h );
		return FL.whitewater( rollerOf( 0, 1, front, wall ), 1.3, h, 40, - 20, 0, streakV, 1, carried, front );

	};
	const crest = at( 300, 300, 200, 320, 0, 0 );
	assert.ok( crest > 0.9, `the crest of a wall the classifier does not call breaking is ${ crest.toFixed( 2 ) } white (want the torn white crest, over 0.9: the 320 m wall drew a dark slab over a white lower face)` );
	const foot = at( 20, 120, 18, 30, 0, 0 );
	assert.ok( foot > 0.9, `its foot is ${ foot.toFixed( 2 ) } white (want white, over 0.9)` );
	const streak = at( 150, 200, 100, 170, 1, 0 );
	assert.ok( streak > 0.9, `a streak down the middle of its face is ${ streak.toFixed( 2 ) } white (want white, over 0.9: the streaks run down the whole face)` );
	const between = FL.whitewater( rollerOf( 1, 1, FL.tallFront( 150, 200, 100, span ), wallOf( 150, 200, 100, span, 170 ) ), 1.3, 170, 40, - 20, 0, 0, 1, 1, 0 );
	assert.ok( between < 0.05, `between the streaks the middle of a breaking face carrying its foam is ${ between.toFixed( 2 ) } white (want dark water, under 0.05: a quarter white there made the wall's face pale from a distance)` );
	const plateau = at( 300, 300.5, 299.5, 320, 1, 0 );
	assert.ok( plateau < 0.05, `the sea behind the crest is ${ plateau.toFixed( 2 ) } white on a streak (want sea, under 0.05)` );

} );
