import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = process.env.PW_OUT ?? 'test-results';
const TAG = process.env.BENCH_TAG ?? 'after';

test( 'Tsunami bench: GPU ms at the tsunami review views', async ( { page } ) => {

	test.setTimeout( 400000 );
	await page.route( 'https://fonts.googleapis.com/**', ( r ) => r.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( `/?scale=${ process.env.PW_RENDER_SCALE ?? '0.5' }&noAudio&bench` );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
	await page.getByRole( 'button', { name: 'Click to explore', exact: true } ).click();
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
	const views = [ 'tsunamiApproach', 'tsunamiImpact', 'tsunamiFlood', 'tsunamiMegaWall' ];
	const idle = await page.evaluate( ( v ) => window.__bench.run( { views: v, warm: 30, frames: 60 } ), views );
	await page.evaluate( () => window.__app.disasters.start( 'tsunami', { intensity: 320, warningLead: 3, seed: 7 } ) );
	// the bench drives the frames itself: advance the event 10 s (300 frames of 1/30 s) at a time until the solver has the wall
	await expect.poll( () => page.evaluate( async () => {

		await window.__bench.run( { views: [ 'tsunamiImpact' ], warm: 300, frames: 1, dt: 1 / 30 } );
		return window.__app.disasters.field.events.get( 'tsunami' )?.launched;

	} ), { timeout: 240000, intervals: [ 100 ] } ).toBe( true );
	const flood = await page.evaluate( ( v ) => window.__bench.run( { views: v, warm: 30, frames: 60 } ), views );
	await mkdir( OUT, { recursive: true } );
	await writeFile( `${ OUT }/-bench-${ TAG }.json`, JSON.stringify( { idle, flood }, null, 1 ) );
	expect( flood ).toBeTruthy();

} );
