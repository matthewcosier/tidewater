// The storm a tornado comes out of (docs/tornado-visuals.md, "Design: the storm"): the player starts
// the default tornado from the Disasters panel; the overcast closes over the island and hides the
// sun, it rains on a camera inside the precipitation and not on one in the dry inflow notch,
// lightning strikes inside the storm's footprint at a safe rate, and Restore island hands the sky
// back. Everything is read from the storm's own telemetry (the "Storm telemetry" status), which the
// game fills from the same state that draws the sky. The free camera is moved to the places the
// telemetry names only to stand somewhere: the storm is started and ended with the panel's controls.
// Fresh browser context per test, only the fonts mocked.
import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { SCENARIO_TIMEOUT_MS } from './gameTime.js';

const OUT = process.env.PW_OUT ?? 'test-results/storm-sky';
const telemetry = ( page ) => page.getByRole( 'status', { name: 'Storm telemetry' } );
const read = ( page ) => telemetry( page ).evaluate( ( el ) => ( { ...el.dataset } ) );
const numbers = ( s ) => String( s ?? '' ).split( ',' ).filter( ( v ) => v !== '' ).map( Number );
// stands the free camera at a point the telemetry names (x, y, z in m), looking north and level
const stand = ( page, p ) => page.evaluate( ( [ x, y, z ] ) => {

	const a = window.__app;
	a.setFreeCam( true );
	a.fly.setPose( a.camera.position.clone().set( x, y, z ), 0, 0 );
	a.fly.velocity.set( 0, 0, 0 );

}, p );

test( 'A tornado brings its storm: the sky closes, it rains on the camera and lightning strikes', async ( { page } ) => {

	test.setTimeout( SCENARIO_TIMEOUT_MS * 2 );
	const errors = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );
	await mkdir( OUT, { recursive: true } );
	let own;
	await test.step( 'Given the island on a fine day and the Disasters panel set to a tornado', async () => {

		await page.route( 'https://fonts.googleapis.com/**', ( r ) => r.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( `/?scale=${ process.env.PW_RENDER_SCALE ?? '1' }&noAudio` );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 180000 } );
		await page.getByRole( 'button', { name: 'Click to explore', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
		await page.getByLabel( 'Disaster type' ).selectOption( 'tornado' );
		await expect( telemetry( page ) ).toHaveAttribute( 'data-phase', 'clear', { timeout: 60000 } );
		own = await read( page );
		expect( Number( own.sunDisk ), 'the sun disk is whole on a fine day' ).toBe( 1 );
		expect( Number( own.coverOverhead ), 'no storm cover on a fine day' ).toBe( 0 );
		expect( Number( own.rainCamera ), 'no rain on a fine day' ).toBe( 0 );
		expect( Number( own.strokes ), 'no lightning on a fine day' ).toBe( 0 );

	} );
	await test.step( 'When I start the default tornado from the panel with the keyboard', async () => {

		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).focus();
		await page.keyboard.press( 'Enter' );
		await expect( page.getByRole( 'status', { name: 'Disaster simulation' } ) ).toHaveAttribute( 'data-active', 'tornado' );

	} );
	let mature;
	await test.step( 'Then while it is mature the sun disk is hidden and the storm covers the dome overhead and toward the sun', async () => {

		await expect( telemetry( page ), 'the storm arrives over seconds, not in one frame' ).toHaveAttribute( 'data-phase', 'arriving', { timeout: 120000 } );
		await expect( telemetry( page ) ).toHaveAttribute( 'data-phase', 'mature', { timeout: 900000 } );
		mature = await read( page );
		expect( Number( mature.sunDisk ), `the sun disk is hidden while the tornado is mature (transmittance toward the sun ${ mature.sunDisk })` ).toBeLessThan( 0.001 );
		expect( Number( mature.coverOverhead ), `storm cover overhead ${ mature.coverOverhead }` ).toBeGreaterThanOrEqual( 0.98 );
		expect( Number( mature.coverSun ), `storm cover toward the sun ${ mature.coverSun }` ).toBeGreaterThanOrEqual( 0.98 );
		// Evidence only
		await writeFile( `${ OUT }/storm-mature-panel.png`, await page.screenshot() );

	} );
	await test.step( 'And a camera inside the precipitation is rained on and one in the inflow notch is not', async () => {

		await stand( page, numbers( mature.rainInside ) );
		await expect.poll( async () => Number( ( await read( page ) ).rainCamera ), { message: 'rain rate at a camera inside the precipitation, mm/h', timeout: 60000 } ).toBeGreaterThan( 5 );
		await expect.poll( async () => Number( ( await read( page ) ).lensWet ), { message: 'the lens takes drops in the rain', timeout: 60000 } ).toBeGreaterThan( 0 );
		await writeFile( `${ OUT }/storm-rain-inside.png`, await page.screenshot() );
		await stand( page, numbers( mature.rainOutside ) );
		await expect.poll( async () => Number( ( await read( page ) ).rainCamera ), { message: 'rain rate at a camera in the dry inflow notch, mm/h', timeout: 60000 } ).toBe( 0 );
		await writeFile( `${ OUT }/storm-rain-outside.png`, await page.screenshot() );

	} );
	await test.step( 'And lightning strokes are recorded inside the storm, never more than three flashes in a second', async () => {

		await expect.poll( async () => Number( ( await read( page ) ).strokes ), { message: 'strokes recorded', timeout: 900000, intervals: [ 1000 ] } ).toBeGreaterThanOrEqual( 3 );
		const t = await read( page );
		const [ fx, fz, fr ] = numbers( t.footprint );
		const strokes = String( t.strokeList ).split( ';' ).filter( Boolean ).map( ( s ) => s.split( ':' ) );
		expect( strokes.length, 'the telemetry lists the recorded strokes' ).toBeGreaterThanOrEqual( 3 );
		for ( const [ kind, x, y, z, time ] of strokes ) {

			expect( [ 'cloud', 'ground' ], `stroke kind ${ kind }` ).toContain( kind );
			const d = Math.hypot( Number( x ) - fx, Number( z ) - fz );
			expect( d, `a ${ kind } stroke ${ d.toFixed( 0 ) } m from the storm's centre, inside its ${ fr.toFixed( 0 ) } m footprint` ).toBeLessThanOrEqual( fr );
			expect( Number.isFinite( Number( y ) ) && Number( time ) > 0, `stroke height ${ y } m and game time ${ time } s` ).toBe( true );

		}
		const pulses = numbers( t.pulses );
		expect( pulses.length, 'the telemetry lists the flash times' ).toBeGreaterThanOrEqual( 3 );
		let most = 0;
		for ( let i = 0; i < pulses.length; i ++ ) most = Math.max( most, pulses.filter( ( p ) => p >= pulses[ i ] && p < pulses[ i ] + 1 ).length );
		expect( most, `at most three flashes in any one second (found ${ most })` ).toBeLessThanOrEqual( 3 );

	} );
	await test.step( 'And after Restore island the cloud cover is my own again, the sky clears without a snap and no stroke follows', async () => {

		// the Disaster laboratory is still open unless something closed it: open it only if its button is not on screen
		const restore = page.getByRole( 'button', { name: 'Restore island', exact: true } );
		if ( ! await restore.isVisible() ) await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
		await expect( restore ).toBeVisible();
		await restore.click();
		await expect( page.getByRole( 'status', { name: 'Disaster simulation' } ) ).toHaveAttribute( 'data-active', 'none' );
		await expect( telemetry( page ) ).toHaveAttribute( 'data-phase', 'clearing', { timeout: 60000 } );
		const after = await read( page );
		expect( Number( after.cloudCover ), 'the shared cloud cover is the player\'s own value' ).toBe( Number( own.cloudCover ) );
		expect( Number( after.coverOverhead ), `the overcast does not vanish on Restore (cover overhead ${ after.coverOverhead })` ).toBeGreaterThan( 0.5 );
		await page.waitForTimeout( 8000 );
		const later = await read( page );
		expect( Number( later.strokes ), 'no stroke after the tornado has gone' ).toBe( Number( after.strokes ) );
		await writeFile( `${ OUT }/storm-clearing.png`, await page.screenshot() );
		expect( errors ).toEqual( [] );

	} );

} );
