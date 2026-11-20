import { test, expect } from '@playwright/test';

// Only the browser's hardware boundary is replaced. Every button travels through
// the game frame, its real menu or player controller, and the island simulation.
async function button( page, index ) {
	for ( const value of [ 1, 0 ] ) {
		await page.evaluate( ( [ index, value ] ) => {
			const b = window.pad.buttons[ index ]; b.value = value; b.pressed = !! value;
		}, [ index, value ] );
		await page.waitForFunction( ( [ index, value ] ) => !! ( window.__app.controller.previous & ( 1 << index ) ) === !! value, [ index, value ] );
	}
}

test.beforeEach( async ( { page } ) => {
	await page.addInitScript( () => {
		window.pad = { index: 0, connected: true, mapping: 'standard', axes: [ 0, 0, 0, 0 ],
			buttons: Array.from( { length: 17 }, () => ( { pressed: false, value: 0 } ) ) };
		navigator.getGamepads = () => window.pad.connected ? [ window.pad ] : [];
	} );
	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=0.5&noAudio' );
	const walk = page.locator( '.tw-start .tw-start-cta' );
	await expect( walk ).toBeVisible( { timeout: 120_000 } );
	for ( let i = 0; i < 24 && ! await walk.evaluate( el => el === document.activeElement ); i ++ ) await button( page, 13 );
	await expect( walk ).toBeFocused();
	await button( page, 0 );
	await expect( page.getByRole( 'button', { name: 'Skip', exact: true } ) ).toBeVisible();
	await button( page, 1 );
	await expect( page.getByRole( 'button', { name: 'Skip', exact: true } ) ).toBeHidden();
} );

test( 'Walk, use the car picker, drive and return to the island with a controller', async ( { page } ) => {
	const player = () => page.evaluate( () => { const p = window.__app.player; return [ p.position.x, p.position.z, p.yaw ]; } );
	const start = await player();
	await page.evaluate( () => { window.pad.axes[ 1 ] = -.7; window.pad.axes[ 2 ] = .4; } );
	await expect.poll( async () => { const [ x, z ] = await player(); return Math.hypot( x - start[ 0 ], z - start[ 1 ] ); } ).toBeGreaterThan( .8 );
	expect( Math.abs( ( await player() )[ 2 ] - start[ 2 ] ) ).toBeGreaterThan( .02 );
	await page.evaluate( () => window.pad.axes.fill( 0 ) );
	await button( page, 9 );
	const dialog = page.getByRole( 'dialog', { name: 'Controls', exact: true } );
	await expect( dialog ).toBeVisible();
	// Resume is initially focused. Wrap through Close to Choose car.
	await button( page, 13 ); await button( page, 13 );
	await expect( dialog.getByRole( 'button', { name: 'Choose car' } ) ).toBeFocused();
	await button( page, 0 );
	const car = page.getByLabel( 'Vehicle', { exact: true } );
	await expect( car ).toBeFocused();
	await button( page, 15 ); await expect( car ).toHaveValue( 'jeep' );
	await button( page, 13 ); await expect( page.getByLabel( 'Start at', { exact: true } ) ).toBeFocused();
	await button( page, 15 ); await button( page, 13 ); await button( page, 0 );
	await expect( page.getByRole( 'status', { name: 'Rally telemetry' } ) ).toBeVisible();
	await expect( page.locator( '.tw-prompt' ) ).toContainText( 'Leave car' );
	await page.evaluate( () => { window.__app.rally.damage.state.zones[ 0 ] = .6; } );
	await button( page, 12 );
	await expect.poll( () => page.evaluate( () => window.__app.rally.damage.state.zones[ 0 ] ) ).toBe( 0 );
	await expect( page.locator( '.tw-prompt' ) ).toContainText( 'X' );
	await button( page, 13 ); await expect.poll( () => page.evaluate( () => window.__app.freeCam ) ).toBe( true );
	await button( page, 13 ); await expect.poll( () => page.evaluate( () => window.__app.freeCam ) ).toBe( false );
	await button( page, 2 ); await expect( page.getByRole( 'status', { name: 'Rally telemetry' } ) ).toBeHidden();
	await page.evaluate( () => { window.pad.connected = false; } );
	await expect( page.locator( 'body' ) ).not.toHaveClass( /using-controller/ );
} );

test( 'Board the ferry, work its helm and leave using the controller', async ( { page } ) => {
	// Move the free camera to the ferry as in ferry.spec.js; all deck actions
	// following the drop are physical stick/button input.
	await page.evaluate( () => {
		const app = window.__app, ship = app.ferry.ship;
		app.setFreeCam( true ); app.fly.setPose( ship.toWorld( new app.camera.position.constructor( 0, 12.6, 3 ) ), ship.yaw + Math.PI, -.05 );
		app.fly.velocity.set( 0, 0, 0 );
	} );
	await button( page, 13 );
	await expect( page.getByText( 'Aboard the Tidewater Spirit', { exact: true } ) ).toBeVisible();
	await page.evaluate( () => { window.pad.axes[ 1 ] = -1; window.pad.buttons[ 10 ].value = 1; } );
	await expect( page.getByText( 'Take the helm', { exact: true } ) ).toBeVisible( { timeout: 20_000 } );
	await page.evaluate( () => { window.pad.axes.fill( 0 ); window.pad.buttons[ 10 ].value = 0; } );
	await button( page, 2 );
	const helm = page.getByRole( 'status', { name: 'Ferry helm' } );
	await expect( helm ).toBeVisible();
	await button( page, 14 );
	await expect( helm.locator( '.fy-lines' ) ).toHaveText( 'Off' );
	await page.evaluate( () => { window.pad.axes[ 0 ] = .5; window.pad.buttons[ 7 ].value = .6; } );
	await expect.poll( () => page.evaluate( () => window.__app.ferry.ship.lever ) ).toBeGreaterThan( .1 );
	await expect.poll( () => page.evaluate( () => window.__app.ferry.ship.wheel ) ).toBeGreaterThan( .05 );
	await page.evaluate( () => { window.pad.axes.fill( 0 ); window.pad.buttons[ 7 ].value = 0; } );
	await button( page, 0 ); await button( page, 1 );
	await expect.poll( () => page.evaluate( () => [ window.__app.ferry.ship.lever, window.__app.ferry.ship.wheel ] ) ).toEqual( [ 0, 0 ] );
	await button( page, 5 ); await expect( helm ).toHaveAttribute( 'data-horn', 'long' );
	await button( page, 2 ); await expect( helm ).toBeHidden();
} );
