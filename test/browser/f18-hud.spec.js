import { test, expect } from '@playwright/test';
import { pickWheel } from './helpers/wheel.js';

const OUT = process.env.PW_OUT || 'test-results/f18-hud';
const instruments = page => page.getByRole( 'status', { name: 'Flight instruments' } );
const metric = async ( page, key ) => Number( await instruments( page ).getAttribute( `data-${ key }` ) );

async function land( page ) {
	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=0.6&noAudio' );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	await expect( page.getByRole( 'button', { name: 'Activities menu' } ) ).toBeVisible();
}

async function separated( first, second, label ) {
	const a = await first.boundingBox(), b = await second.boundingBox();
	expect( a, `${ label }: first visible bounds` ).toBeTruthy();
	expect( b, `${ label }: second visible bounds` ).toBeTruthy();
	const overlap = Math.max( 0, Math.min( a.x + a.width, b.x + b.width ) - Math.max( a.x, b.x ) )
		* Math.max( 0, Math.min( a.y + a.height, b.y + b.height ) - Math.max( a.y, b.y ) );
	expect( overlap, `${ label } must not overlap` ).toBe( 0 );
}

test( 'F/A-18 Hornet: Activity Wheel enters flight with no form panel, launches with live HUD LEDs, and unifies key/strip/wheel commands', async ( { page } ) => {
	test.setTimeout( 180_000 );
	const errors = [];
	page.on( 'pageerror', err => errors.push( err.message ) );

	await test.step( 'Given I land on the island and launch Fly Hornet from the Activity Wheel using M', async () => {
		await land( page );
		await page.keyboard.press( 'm' );
		const menu = page.getByRole( 'menu', { name: 'Activity Wheel' } );
		await expect( menu ).toBeVisible();
		await menu.getByRole( 'menuitem', { name: 'Air', exact: true } ).click();
		await menu.getByRole( 'menuitem', { name: 'F/A-18 Hornet', exact: true } ).click();
		await menu.getByRole( 'menuitem', { name: 'Fly Hornet', exact: true } ).click();
		await expect( menu ).toBeHidden();
		await expect( page.getByRole( 'region', { name: 'Aviation controls' } ) ).toHaveCount( 0 );
		await expect( instruments( page ) ).toBeVisible();
		await expect( instruments( page ) ).toContainText( 'Hold W to launch' );
		await expect( page.getByText( 'Flying · Hornet', { exact: true } ) ).toBeVisible();
		await expect( page.locator( '.gm-map' ) ).toBeHidden();
		await page.screenshot( { path: `${ OUT }/ready-on-catapult.png` } );
	} );

	await test.step( 'When I hold W to launch then the HUD tracks throttle, auto-retract turns off the Gear LED, and cockpit HUD renders cleanly', async () => {
		await page.keyboard.down( 'w' );
		await expect( instruments( page ) ).toHaveAttribute( 'data-phase', 'launching', { timeout: 15_000 } );
		await expect( instruments( page ).locator( '[data-read=throttle]' ) ).toHaveText( '100%' );
		await expect( instruments( page ) ).toContainText( 'You have control', { timeout: 60_000 } );
		await page.keyboard.up( 'w' );
		await expect( instruments( page ) ).toHaveAttribute( 'data-gear', 'up' );
		await expect( instruments( page ).getByRole( 'button', { name: 'Landing gear', exact: true } ) ).toHaveAttribute( 'aria-pressed', 'false' );

		// Switch to cockpit view through the M Activity Wheel context ring (Hornet -> Cockpit View)
		await page.keyboard.press( 'm' );
		const menu = page.getByRole( 'menu', { name: 'Activity Wheel' } );
		await menu.getByRole( 'menuitem', { name: 'Hornet', exact: true } ).click();
		await menu.getByRole( 'menuitem', { name: 'Cockpit View', exact: true } ).click();
		await expect( instruments( page ) ).toHaveAttribute( 'data-view', 'cockpit' );
		await expect( instruments( page ).getByRole( 'button', { name: 'Cockpit view', exact: true } ) ).toHaveAttribute( 'aria-pressed', 'true' );
		await page.screenshot( { path: `${ OUT }/climb-cockpit.png` } );
	} );

	await test.step( 'When I use key G, strip Hook button, and photo mode P then all three doors stay in sync and photo mode hides the HUD', async () => {
		await page.keyboard.press( 'g' );
		await expect( instruments( page ) ).toHaveAttribute( 'data-gear', 'down' );
		await expect( instruments( page ).getByRole( 'button', { name: 'Landing gear', exact: true } ) ).toHaveAttribute( 'aria-pressed', 'true' );

		await instruments( page ).getByRole( 'button', { name: 'Arrestor hook', exact: true } ).click();
		await expect( instruments( page ) ).toHaveAttribute( 'data-hook', 'down' );
		await expect( instruments( page ).getByRole( 'button', { name: 'Arrestor hook', exact: true } ) ).toHaveAttribute( 'aria-pressed', 'true' );

		await page.keyboard.press( 'p' );
		await expect( instruments( page ) ).toBeHidden();
		await page.screenshot( { path: `${ OUT }/photo-mode.png` } );
		await page.keyboard.press( 'p' );
		await expect( instruments( page ) ).toBeVisible();
	} );

	await test.step( 'When I select Landing Approach from the Hornet wheel in cockpit view then ICLS and E-bracket render cleanly', async () => {
		await pickWheel( page, 'Hornet', 'Landing Approach' );
		await page.keyboard.press( 'c' );
		await expect( instruments( page ) ).toHaveAttribute( 'data-view', 'cockpit' );
		await expect( instruments( page ) ).toHaveClass( /is-approach/ );
		await expect( instruments( page ) ).toHaveClass( /is-bracket/ );
		await page.screenshot( { path: `${ OUT }/approach-cockpit.png` } );
	} );

	await test.step( 'When I click Gear during catapult launch then the unified command door marks gearDone so automation does not reverse it', async () => {
		await instruments( page ).getByRole( 'button', { name: 'Reset aircraft', exact: true } ).click();
		await expect( instruments( page ) ).toHaveAttribute( 'data-phase', 'ready' );
		await page.keyboard.down( 'w' );
		await expect( instruments( page ) ).toHaveAttribute( 'data-phase', 'launching', { timeout: 15_000 } );
		await expect( instruments( page ) ).toHaveAttribute( 'data-gear', 'up', { timeout: 30_000 } );
		await page.keyboard.up( 'w' );
		// Pilot explicitly clicks Landing gear down via the micro strip while launch climb continues.
		await instruments( page ).getByRole( 'button', { name: 'Landing gear', exact: true } ).click();
		await expect( instruments( page ) ).toHaveAttribute( 'data-gear', 'down' );
		await page.waitForTimeout( 3000 );
		await expect( instruments( page ) ).toHaveAttribute( 'data-gear', 'down' );
		expect( errors ).toEqual( [] );
	} );
} );

test( 'F/A-18 Hornet: compact bottom-right shortcut strip clears rails and fits cleanly across desktop, portrait, and short landscape viewports', async ( { page } ) => {
	const errors = [];
	page.on( 'pageerror', err => errors.push( err.message ) );
	await land( page );
	await pickWheel( page, 'Air', 'F/A-18 Hornet', 'Fly Hornet' );
	await expect( instruments( page ) ).toBeVisible();
	const strip = page.getByRole( 'toolbar', { name: 'Flight controls' } );

	for ( const vp of [
		{ width: 1440, height: 900, shot: null },
		{ width: 390, height: 844, shot: null },
		{ width: 844, height: 390, shot: 'landscape-short.png' },
	] ) {
		await test.step( `Viewport ${ vp.width }x${ vp.height } keeps strip small, inside bounds, and clear of rails`, async () => {
			await page.setViewportSize( { width: vp.width, height: vp.height } );
			await page.waitForTimeout( 150 );
			const box = await strip.boundingBox();
			expect( box ).toBeTruthy();
			expect( box.height ).toBeLessThanOrEqual( 34 );
			expect( box.x ).toBeGreaterThanOrEqual( 0 );
			expect( box.y ).toBeGreaterThanOrEqual( 0 );
			expect( box.x + box.width ).toBeLessThanOrEqual( vp.width );
			expect( box.y + box.height ).toBeLessThanOrEqual( vp.height );
			await separated( strip, page.locator( '.tw-rail' ), `Strip and settings rail at ${ vp.width }x${ vp.height }` );
			await separated( strip, page.getByRole( 'button', { name: 'Activities menu' } ), `Strip and Activities at ${ vp.width }x${ vp.height }` );
			if ( vp.shot ) await page.screenshot( { path: `${ OUT }/${ vp.shot }` } );
		} );
	}
	expect( errors ).toEqual( [] );
} );
