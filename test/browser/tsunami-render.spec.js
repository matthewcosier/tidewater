import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = process.env.PW_OUT ?? 'test-results';
const TAG = process.env.CAPTURE_TAG ?? '';

async function ready( page ) {

	await page.route( 'https://fonts.googleapis.com/**', ( r ) => r.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( `/?scale=${ process.env.PW_RENDER_SCALE ?? '1' }&noAudio${ process.env.PW_QUERY ?? '' }` );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
	await page.getByRole( 'button', { name: 'Click to explore', exact: true } ).click();
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
	// telemetry only: log every resolution step the governor takes during the event (D5 diagnosis)
	await page.evaluate( () => {

		const g = window.__app.engine.resolution;
		window.__govLog = [ { t: performance.now(), level: { ...g.level }, mode: g.mode } ];
		g.onChange.push( ( l ) => window.__govLog.push( { t: performance.now(), level: { ...l } } ) );

	} );
	await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();

}

const event = ( page ) => page.evaluate( () => {

	const e = window.__app.disasters.field.events.get( 'tsunami' );
	return e ? { time: e.time, launched: e.launched, arrival: e.arrival, coast: !! e.coastReached } : null;

} );
const look = ( page ) => page.evaluate( () => {

	const l = window.__app.disasterWater.look();
	return { inner: l.inner?.boreCells ?? 0, outer: l.outer?.boreCells ?? 0, coast: l.inner?.coastBore ?? 0, jump: Math.max( l.inner?.maxJump ?? 0, l.outer?.maxJump ?? 0 ), turbid: l.inner?.turbidLand ?? 0 };

} );

// Stage a wave-following view and wait until a rendered frame shows the front inside the frustum, then shoot and
// check again on the front as it is at the capture (it moves 5-60 m/s).
const FRONT_CELLS = 3, FRONT_CREST = 0.3; // cells, m
async function follow( page, kind, name, settle, timeout = 600000 ) {

	let front = null;
	await expect.poll( async () => {

		front = await page.evaluate( ( k ) => window.__viewFront( k ), kind );
		// A front is a face, not a speck: at least FRONT_CELLS connected cells, and from the shore and the air its crest
		// stands FRONT_CREST m over the still sea. The largest breaking run is often one or two cells in the drawdown
		// (a seeded 2 m run staged on one cell with its crest 0.63 m under the datum, 43 s before the wave), and every
		// capture of that run showed calm sea or the drained bay.
		if ( ! front || front.cells < FRONT_CELLS || ( kind !== 'street' && front.crest < FRONT_CREST ) ) return false;
		await page.waitForTimeout( 300 );
		return page.evaluate( ( k ) => window.__frontOnScreen( k ), kind );

	}, { timeout, intervals: [ 500 ] } ).toBe( true );
	await page.waitForTimeout( settle );
	await mkdir( OUT, { recursive: true } );
	await page.screenshot( { path: `${ OUT }/${ TAG }-${ name }.png` } );
	const onScreen = await page.evaluate( ( k ) => window.__frontOnScreen( k ), kind );
	for ( const m of ( process.env.PW_WDBG ?? '' ).split( ',' ).filter( Boolean ).map( Number ) ) {

		await page.evaluate( ( v ) => { window.__app.waterMaterial.debugMode.value = v; }, m );
		await page.waitForTimeout( 600 );
		await page.screenshot( { path: `${ OUT }/${ TAG }-${ name }-wdbg${ m }.png` } );

	}
	if ( process.env.PW_WDBG ) await page.evaluate( () => { window.__app.waterMaterial.debugMode.value = 0; } );
	return { kind, onScreen, cells: front.cells, crest: front.crest, bed: front.bed, x: front.x, z: front.z, pose: front.pose };

}

for ( const [ height, label, seeded ] of [ [ 2, '2m', false ], [ 320, '320m', false ], [ 2, 'review-2m', true ], [ 320, 'review-320m', true ] ] ) test( `Tsunami ${ height } m${ seeded ? ' REVIEW (seed 7)' : '' }: the bore face is detected and drawn`, async ( { page } ) => {

	test.setTimeout( 900000 );
	const errors = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );
	await test.step( 'Given the island and the Disasters panel', async () => {

		await ready( page );
		await page.getByLabel( 'Disaster type' ).selectOption( 'tsunami' );
		await page.getByLabel( 'Target location' ).selectOption( 'village' );
		// (the lead time and the height in metres sit under the tsunami panel's Advanced section, closed by default)
		await page.getByText( 'Advanced', { exact: true } ).click();
		await page.getByLabel( 'Warning lead time (s)' ).fill( '3' );
		await page.getByRole( 'spinbutton', { name: 'Intensity', exact: true } ).fill( String( height ) );

	} );
	await test.step( `When I start a ${ height } m tsunami`, async () => {

		if ( seeded ) await page.evaluate( ( h ) => window.__app.disasters.start( 'tsunami', { intensity: h, warningLead: 3, seed: 7 } ), height );
		else await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).click();
		await expect.poll( async () => ( await event( page ) )?.launched, { timeout: 120000, intervals: [ 1000 ] } ).toBe( true );
		await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();

	} );
	await test.step( 'Then the breaking front is on screen from the shore and the air, and the flood\'s edge at street level', async () => {

		const shore = await follow( page, 'shore', `${ label }-shore`, height > 100 ? 500 : 900 );
		const seen = await look( page );
		const air = await follow( page, 'air', `${ label }-air`, 700, 60000 );
		await page.waitForTimeout( 5000 );
		const shore2 = await follow( page, 'shore', `${ label }-shore-late`, 700, 60000 ).catch( () => null );
		// the flood's own edge over the land (a 2 m surge may stop short of the streets: recorded, not required)
		const street = await follow( page, 'street', `${ label }-street`, 900, height > 100 ? 120000 : 60000 ).catch( () => null );
		const after = await look( page );
		const govFree = await page.evaluate( () => ( { level: { ...window.__app.engine.resolution.level }, log: window.__govLog } ) );
		await writeFile( `${ OUT }/${ TAG }-${ label }-look.json`, JSON.stringify( { shore, air, shore2, street, seen, after, event: await event( page ), govFree }, null, 1 ) );
		expect( shore.onScreen ).toBe( true );
		expect( air.onScreen ).toBe( true );
		expect( shore.cells ).toBeGreaterThanOrEqual( 3 );
		expect( seen.coast ).toBeGreaterThan( 0 );
		expect( seen.jump ).toBeGreaterThan( height > 100 ? 30 : 0.3 );
		if ( height > 100 ) expect( street?.onScreen ).toBe( true );
		expect( errors ).toEqual( [] );

	} );

} );
