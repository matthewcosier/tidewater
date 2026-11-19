import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

// GPU frame time at the tsunami review views (?bench, src/core/Bench.js), run on the same seeded events before and
// after a rendering change (docs/disasters.md "Rendering the flood"). Each event is staged through the internal hook
// with a fixed seed so both runs draw the same wave; this is a measurement, not a player scenario.
// With no event: a reference shot of each view with the clock stopped (Bench.shots: the same code gives the same
// image, so a shot before and after a change is compared byte for byte), then the timings. With an event
// (BENCH_HEIGHTS, m): the frames are driven until the flood has stood BENCH_AFTER s past its estimated arrival,
// then the timings at the same views, with the main-thread cost of the flood's history beside them.
const OUT = process.env.PW_OUT ?? 'test-results';
const TAG = process.env.BENCH_TAG ?? 'after';
const HEIGHTS = ( process.env.BENCH_HEIGHTS ?? '10,320' ).split( ',' ).filter( Boolean ).map( Number );
const AFTER = Number( process.env.BENCH_AFTER ?? 15 ); // s
const VIEWS = [ 'tsunamiApproach', 'tsunamiImpact', 'tsunamiFlood', 'tsunamiMegaWall' ];

async function boot( page ) {

	await page.route( 'https://fonts.googleapis.com/**', ( r ) => r.fulfill( { contentType: 'text/css', body: '' } ) );
	await mkdir( OUT, { recursive: true } );
	// (no render loop, and the start overlay is left up, so the guide never opens: neither is in the GPU passes)
	await page.goto( `/?scale=${ process.env.PW_RENDER_SCALE ?? '0.5' }&noAudio&bench` );
	await page.waitForFunction( () => window.__bench, null, { timeout: 240000 } );

}

test( 'Tsunami bench: reference shots and GPU ms at the tsunami review views with no event', async ( { page } ) => {

	test.setTimeout( 900000 );
	// the bench uploads each reference shot to a collector: this run is the collector
	await page.route( '**/bench-shots/**', async ( route ) => {

		await writeFile( `${ OUT }/${ new URL( route.request().url() ).pathname.split( '/' ).pop() }`, route.request().postDataBuffer() );
		await route.fulfill( { status: 200, body: 'ok' } );

	} );
	await boot( page );
	await page.evaluate( ( [ v, tag ] ) => window.__bench.shots( v, { tag, url: `${ location.origin }/bench-shots/` } ), [ VIEWS, `idle-${ TAG }` ] );
	const idle = await page.evaluate( ( v ) => window.__bench.run( { views: v, warm: 30, frames: 60 } ), VIEWS );
	await writeFile( `${ OUT }/tsunami-bench-${ TAG }-idle.json`, JSON.stringify( idle, null, 1 ) );
	expect( Number.isFinite( idle.total.gpu ) ).toBe( true );

} );

for ( const height of HEIGHTS ) test( `Tsunami bench: GPU ms at the tsunami review views in a ${ height } m flood`, async ( { page } ) => {

	test.setTimeout( 900000 );
	await boot( page );
	await page.evaluate( ( h ) => window.__app.disasters.start( 'tsunami', { intensity: h, warningLead: 3, seed: 7 } ), height );
	// the bench drives the frames itself: a second of game time (40 frames at the disaster's step cap) at a time
	const at = await page.evaluate( async ( after ) => {

		const app = window.__app, field = app.disasters.field, e = field.events.get( 'tsunami' );
		await app.engine.stop();
		window.__bench.setSize();
		while ( field.events.has( 'tsunami' ) && e.time < e.arrival + after ) await window.__bench._frames( 40, 1 / 40 );
		return { time: e.time, arrival: e.arrival, running: field.events.has( 'tsunami' ) };

	}, AFTER );
	const flood = await page.evaluate( ( v ) => window.__bench.run( { views: v, warm: 30, frames: 60 } ), VIEWS );
	const history = await page.evaluate( () => {

		const w = window.__app.disasterWater, k = Math.min( w.historySamples ?? 0, w.historyMs?.length ?? 0 );
		if ( ! k ) return null;
		const a = Array.from( w.historyMs.subarray( 0, k ) ).sort( ( p, q ) => p - q );
		return { median: a[ k >> 1 ], worst: a[ k - 1 ], samples: w.historySamples };

	} );
	await writeFile( `${ OUT }/tsunami-bench-${ TAG }-${ height }m.json`, JSON.stringify( { at, flood, history }, null, 1 ) );
	expect( at.running, `the ${ height } m event still runs ${ AFTER } s past its arrival` ).toBe( true );
	expect( Number.isFinite( flood.total.gpu ) ).toBe( true );

} );
