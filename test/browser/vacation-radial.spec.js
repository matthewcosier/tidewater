import { test, expect } from '@playwright/test';

const OUT = process.env.PW_OUT || 'test-results/vacation';

async function landOnIsland( page ) {
	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=0.6&noAudio' );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	await expect( page.getByRole( 'button', { name: 'Activities menu' } ) ).toBeVisible();
}

test( 'Landing on Tidewater presents a clean island holiday HUD with the BeamNG-style Activity Wheel', async ( { page } ) => {
	const errors = [];
	page.on( 'pageerror', err => errors.push( err.message ) );
	const wheel = page.getByRole( 'menu', { name: 'Activity Wheel' } );

	await test.step( 'Given I land on the island for my holiday', async () => {
		await landOnIsland( page );
		// No forced blocking 3-card fishing modal, no permanent debug rail, no fishing purse/PIN clutter, no permanent car card.
		await expect( page.getByRole( 'dialog' ) ).toBeHidden();
		await expect( page.getByRole( 'navigation', { name: 'World controls' } ) ).toBeHidden();
		await expect( page.locator( '.gm-purse' ) ).toBeHidden();
		await expect( page.getByLabel( /^Card PIN/ ) ).toBeHidden();
		await expect( page.locator( '.rh-dock' ) ).toBeHidden();
		await page.waitForTimeout( 1100 );
		await page.screenshot( { path: `${ OUT }/arrival-clean.png` } );
	} );

	await test.step( 'When I tap M to open the Activity Wheel then all six vacation categories appear', async () => {
		await page.keyboard.press( 'm' );
		await expect( wheel ).toBeVisible();
		await expect( wheel.getByRole( 'menuitem' ) ).toHaveText( [
			'Drive', 'Water', 'Air', 'World', 'Ride', 'Places',
		] );
		await page.screenshot( { path: `${ OUT }/radial-root.png` } );
	} );

	await test.step( 'When I pick Drive then Suspension Bridge, the car lands grounded on the strait crossing', async () => {
		await wheel.getByRole( 'menuitem', { name: 'Drive', exact: true } ).click();
		await expect( wheel.getByRole( 'menuitem', { name: 'Suspension Bridge' } ) ).toBeVisible();
		await page.screenshot( { path: `${ OUT }/radial-drive.png` } );
		await wheel.getByRole( 'menuitem', { name: 'Suspension Bridge', exact: true } ).click();
		await expect( wheel ).toBeHidden();
		const dash = page.getByRole( 'status', { name: 'Rally telemetry' } );
		await expect( dash ).toBeVisible();
		await expect.poll( async () => Number( await dash.getAttribute( 'data-grounded' ) ), { timeout: 15_000 } ).toBe( 4 );
		await expect( dash ).toHaveAttribute( 'data-surface', 'asphalt' );
	} );

	await test.step( 'When I step out with E, walk away, and press G then my car is delivered safely ahead and E hops straight back in', async () => {
		await page.keyboard.press( 'e' );
		await expect.poll( () => page.evaluate( () => window.__app.rally.active ) ).toBe( false );
		// Walk 16 m away so the car is out of reach before recall.
		await page.keyboard.down( 'Shift' );
		await page.keyboard.down( 'w' );
		await page.waitForTimeout( 2400 );
		await page.keyboard.up( 'w' );
		await page.keyboard.up( 'Shift' );
		const beforeDist = await page.evaluate( () => {
			const p = window.__app.player.position, s = window.__app.rally.state;
			return Math.hypot( p.x - s[ 0 ], p.z - s[ 2 ] );
		} );
		expect( beforeDist, 'walked away from parked car' ).toBeGreaterThan( 7 );

		await page.keyboard.press( 'g' );
		const afterDist = await page.evaluate( () => {
			const p = window.__app.player.position, s = window.__app.rally.state;
			return Math.hypot( p.x - s[ 0 ], p.z - s[ 2 ] );
		} );
		expect( afterDist, 'recalled car arrives nearby without landing on player' ).toBeGreaterThan( 3.5 );
		expect( afterDist, 'recalled car arrives within easy reach' ).toBeLessThan( 15 );
	} );

	await test.step( 'When I open Water with M and inspect sub-activities then Esc closes cleanly', async () => {
		await page.keyboard.press( 'm' );
		await expect( wheel ).toBeVisible();
		await wheel.getByRole( 'menuitem', { name: 'Water', exact: true } ).click();
		await expect( wheel.getByRole( 'menuitem', { name: 'Ride Jetski' } ) ).toBeVisible();
		await page.screenshot( { path: `${ OUT }/radial-water.png` } );
		await page.keyboard.press( 'Escape' );
		await expect( wheel ).toBeHidden();
		expect( errors ).toEqual( [] );
	} );
} );

test( 'Jetski dismount brakes cleanly in the water and G recalls and remounts effortlessly', async ( { page } ) => {
	test.setTimeout( 180_000 );
	const errors = [];
	page.on( 'pageerror', err => errors.push( err.message ) );
	const wheel = page.getByRole( 'menu', { name: 'Activity Wheel' } );

	await test.step( 'Given I launch a jetski from the Activity Wheel and accelerate across the bay', async () => {
		await landOnIsland( page );
		await page.keyboard.press( 'm' );
		await expect( wheel ).toBeVisible();
		await wheel.getByRole( 'menuitem', { name: 'Water', exact: true } ).click();
		await wheel.getByRole( 'menuitem', { name: 'Ride Jetski', exact: true } ).click();
		await expect.poll( () => page.evaluate( () => window.__app.jetskis.riding ), { timeout: 15_000 } ).toBe( true );

		await page.keyboard.down( 'w' );
		await expect.poll( () => page.evaluate( () => window.__app.jetskis.ctl.speed * 3.6 ), { timeout: 12_000 } ).toBeGreaterThan( 30 );
		await page.keyboard.up( 'w' );
	} );

	await test.step( 'When I press E to jump off at speed then lanyard braking stops the jetski nearby instead of ghost-riding away', async () => {
		await page.keyboard.press( 'e' );
		await expect.poll( () => page.evaluate( () => window.__app.jetskis.riding ) ).toBe( false );
		await page.waitForTimeout( 2500 );
		const after = await page.evaluate( () => {
			const p = window.__app.player.position, c = window.__app.jetskis.ctl;
			return {
				dist: Math.hypot( p.x - c.position.x, p.z - c.position.z ),
				speed: c.speed,
				mode: window.__app.player.mode,
			};
		} );
		await page.screenshot( { path: `${ OUT }/jetski-dismount.png` } );
		expect( after.dist, `jetski stayed nearby (${ after.dist.toFixed( 1 ) } m)` ).toBeLessThan( 20 );
		expect( after.speed, `jetski braked cleanly (${ after.speed.toFixed( 2 ) } m/s)` ).toBeLessThan( 1.5 );
	} );

	await test.step( 'When I swim away and press G then the jetski pulls right alongside and mounts smoothly', async () => {
		await page.keyboard.down( 's' );
		await page.waitForTimeout( 1800 );
		await page.keyboard.up( 's' );
		await page.keyboard.press( 'g' );
		await expect.poll( () => page.evaluate( () => window.__app.jetskis.riding ), { timeout: 5_000 } ).toBe( true );
		await page.screenshot( { path: `${ OUT }/jetski-recalled.png` } );
		expect( errors ).toEqual( [] );
	} );
} );
