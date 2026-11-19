import { test, expect } from '@playwright/test';
import { SCENARIO_TIMEOUT_MS, untilGameTime } from './gameTime.js';

// A tsunami ends on its water (src/disasters/Field.js tsunamiOver, docs/disasters.md "How a tsunami ends"): after the
// incoming train the land drains through the solver and the open sea settles, the hand-back soaks the last standing
// water in and settles the sea, and only then do the flood grids drop. The old ends were a timer that deleted the flood
// in one frame, then a drain judged on the land alone with bounds that cut the hand-back and dropped what was left.
// Real game, real panel controls, the GPU solver the game runs. The Then reads the event record the field keeps and
// the flood the player sees: the host grids' packed depth (WaterGrid pixels, read back from the GPU), which the
// renderer and every CPU consumer sample. An observer in the page compares each read-back field with the one before,
// over the land cells, from the start of the hand-back to the frame the grids drop (the drop itself included): what
// the hand-back and the drop do. The backwash before it is the solver's own flow and is only reported.
// The wave: a Surge at the village replayed from one seed through the internal one-shot hook (disasters.nextSeed, as
// test/browser/disasters.spec.js does; no UI shows or sets it): 5 m, the smallest crest whose ending the old rule cut
// for every seed tried. Under the old rule (the drain judged on the land alone, bounded at 600 s, the hand-back cut at
// 120 s) its drain ran to the bound for seeds 1, 2 and 3, and seed 2 dropped 1.10 m of water at the end; under the rule
// it drains on its water 882-888 s after the train and hands back in 107-124 s (node probes on the island, 3 s train).
// A run is about 18 game minutes; the game clock is real time, so about 20 wall minutes on a quiet machine.
// Evidence only, after the outcome is read: captures from the street (review view 'village') and the air
// ('tsunamiAir') when the hand-back begins and after the grids drop, under PW_OUT.

const STEP_SEEN = 0.05; // m: the largest one-frame fall of the flood on land a player may see across the ending
const BUDGET = 1500; // game s from Start to the grids dropping: the approach, the train, the drain and the hand-back
const INTENSITY = 5; // m
const SEED = 1;
const OUT = process.env.PW_OUT ?? 'test-results';
async function capture( page, name ) {

	for ( const view of [ 'village', 'tsunamiAir' ] ) {

		await page.evaluate( ( v ) => window.__view( v ), view );
		await page.evaluate( () => new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( r ) ) ) );
		await page.screenshot( { path: `${ OUT }/ending-${ name }-${ view }.png` } );

	}

}

async function ready( page ) {

	await page.route( 'https://fonts.googleapis.com/**', ( r ) => r.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( `/?scale=${ process.env.PW_RENDER_SCALE ?? '0.5' }&noAudio` );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
	await page.getByRole( 'button', { name: 'Click to explore', exact: true } ).click();
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
	await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();

}

// Installed before Start: keeps the tsunami's event record after the field deletes it, and the largest fall of the
// flood depth on any land cell between two read-back fields during the ending.
function watchEnding() {

	const field = window.__app.disasters.field, watch = window.__tsunamiEnding = { fall: 0, drainFall: 0, ending: false, dropped: false, frames: 0, at: null };
	const last = new Map();
	// Frame intervals (wall ms) by phase, for the doc's frame-time table: the flood (arrival to the end of the train plus
	// 60 s), late in the drain (its last 60 s of game time are taken from the end) and the hand-back. Measurement only.
	watch.intervals = { flood: [], drain: [], calm: [] };
	let then = performance.now();
	const frame = () => {

		const now = performance.now(), ev = field.events.get( 'tsunami' );
		if ( ev?.launched && ev.time >= ev.arrival && ev.time < ev.trainEnd + 60 ) watch.intervals.flood.push( [ now - then, ev.time ] );
		else if ( ev?.launched && ev.time >= ev.trainEnd && ev.calmFrom === undefined ) watch.intervals.drain.push( [ now - then, ev.time ] );
		else if ( ev && ev.calmFrom !== undefined ) watch.intervals.calm.push( [ now - then, ev.time ] );
		then = now;

		const e = field.events.get( 'tsunami' ) ?? watch.event;
		if ( e ) watch.event = e;
		const grids = [ field.water, field.outer ];
		const draining = !! e && e.launched && e.time >= e.trainEnd && e.calmFrom === undefined;
		if ( e && e.calmFrom !== undefined ) watch.ending = true;
		if ( watch.ending && ! field.water && ! watch.dropped ) {

			// the grids dropped: whatever stood on land in the last field the player saw is gone in this frame
			watch.dropped = true;
			for ( const depth of last.values() ) for ( let k = 0; k < depth.length; k ++ ) if ( depth[ k ] > watch.fall ) { watch.fall = depth[ k ]; watch.at = 'drop'; }

		}
		for ( const g of grids ) {

			if ( ! g ) continue;
			const n = g.n, P = g.pixels, inner = g === field.outer ? field.water : null;
			let depth = last.get( g );
			if ( ! depth ) { depth = new Float32Array( n * n ).fill( - 1 ); last.set( g, depth ); }
			for ( let k = 0; k < n * n; k ++ ) {

				if ( g.bed[ k ] <= 0 || g.covered?.[ k ] || ( inner && inner.contains( g.x + ( k % n ) * g.dx, g.z + Math.floor( k / n ) * g.dx ) ) ) { depth[ k ] = 0; continue; }
				const d = P[ k * 4 + 3 ] > 0.002 ? P[ k * 4 + 3 ] : 0;
				if ( watch.ending && depth[ k ] >= 0 && depth[ k ] - d > watch.fall ) { watch.fall = depth[ k ] - d; watch.at = { x: g.x + ( k % n ) * g.dx, z: g.z + Math.floor( k / n ) * g.dx, t: e?.time }; }
				if ( draining && depth[ k ] >= 0 && depth[ k ] - d > watch.drainFall ) watch.drainFall = depth[ k ] - d;
				depth[ k ] = d;

			}

		}
		if ( watch.ending ) watch.frames ++;
		if ( ! watch.dropped ) requestAnimationFrame( frame );

	};
	requestAnimationFrame( frame );

}

test( 'A tsunami ends when its water has gone back', async ( { page } ) => {

	test.setTimeout( SCENARIO_TIMEOUT_MS * 3 );
	const errors = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );
	const status = page.getByRole( 'status', { name: 'Disaster simulation' } );
	await test.step( 'Given a 5 m tsunami aimed at the fishing village with the shortest train and warning the panel allows', async () => {

		await ready( page );
		await page.getByLabel( 'Disaster type' ).selectOption( 'tsunami' );
		await page.getByLabel( 'Target location' ).selectOption( 'village' );
		{ const advanced = page.locator( 'details.disaster-advanced:not([open]) > summary' ); if ( await advanced.isVisible() ) await advanced.click(); }
		await page.getByRole( 'spinbutton', { name: 'Intensity', exact: true } ).fill( String( INTENSITY ) );
		await page.locator( '[data-key="duration"]' ).fill( '3' );
		await page.getByLabel( 'Warning lead time (s)' ).fill( '3' );
		await page.evaluate( ( seed ) => { window.__app.disasters.nextSeed = seed; }, SEED );
		await page.evaluate( watchEnding );

	} );
	await test.step( 'When I start it and its wave comes ashore and runs back', async () => {

		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).click();
		await expect( status ).toHaveAttribute( 'data-active', 'tsunami' );
		// one wait is capped at 10 wall minutes (gameTime.js); under load a game second takes several wall seconds
		let calming = false, done = false, waited = 0;
		while ( ! calming && waited <= BUDGET ) {

			const r = await untilGameTime( page, () => window.__tsunamiEnding.event?.calmFrom !== undefined, BUDGET - waited );
			calming = r.value;
			waited += r.elapsed;

		}
		if ( calming && ! await page.evaluate( () => window.__tsunamiEnding.dropped ) ) await capture( page, 'handback' );
		while ( ! done && waited <= BUDGET ) {

			const r = await untilGameTime( page, () => !! window.__tsunamiEnding.dropped, BUDGET - waited );
			done = r.value;
			waited += r.elapsed;

		}
		expect( done, `the event's flood grids dropped within ${ BUDGET } game s (waited ${ waited.toFixed( 0 ) } s)` ).toBeTruthy();

	} );
	await test.step( 'Then the event ended by draining, no land point lost 5 cm of flood in one frame, and the panel offers Start again', async () => {

		const w = await page.evaluate( () => { const { fall, drainFall, at, frames, event } = window.__tsunamiEnding; return { seed: event.seed, fall, drainFall, at, frames, endedBy: event.endedBy, capped: event.drainCapped, drained: event.drainEnd - event.trainEnd, calm: event.calmFrom, time: event.time, arrival: event.arrival }; } );
		console.log( `ending: ${ JSON.stringify( w ) }` );
		const frames = await page.evaluate( () => {

			const { intervals, event } = window.__tsunamiEnding, stat = ( rows ) => { const v = rows.map( r => r[ 0 ] ).sort( ( a, b ) => a - b ); return v.length ? { frames: v.length, median: + v[ v.length >> 1 ].toFixed( 1 ), p95: + v[ Math.floor( v.length * 0.95 ) ].toFixed( 1 ) } : null; };
			return { flood: stat( intervals.flood ), lateDrain: stat( intervals.drain.filter( r => r[ 1 ] > event.drainEnd - 60 ) ), calm: stat( intervals.calm ) };

		} );
		console.log( `frame ms: ${ JSON.stringify( frames ) }` );
		expect( w.seed, 'the hook fixed the event seed' ).toBe( SEED );
		expect( w.endedBy, `the tsunami ended by ${ w.endedBy }` ).toBe( 'drained' );
		expect( w.capped, `the drain ended on the water, not its bound (${ w.drained?.toFixed( 0 ) } s after the train)` ).toBe( false );
		expect( w.frames, 'the hand-back was watched frame by frame' ).toBeGreaterThan( 10 );
		expect( w.fall, `the largest one-frame fall of the flood level on land during the ending is under ${ STEP_SEEN } m (${ w.fall.toFixed( 3 ) } m at ${ JSON.stringify( w.at ) })` ).toBeLessThan( STEP_SEEN );
		await expect( status ).toHaveAttribute( 'data-active', 'none' );
		await expect( page.getByRole( 'button', { name: 'Start disaster', exact: true } ) ).toBeEnabled();
		expect( errors ).toEqual( [] );
		await capture( page, 'after' );

	} );

} );
