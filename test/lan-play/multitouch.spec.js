import { test, expect } from '@playwright/test';

test.use( { browserName: 'chromium' } );
test( 'The Mac steers while throttle is held and releases both keys when the phone disconnects', async ( { page, context } ) => {
	await page.goto( '/' );
	const control = page.locator( '#controls' );
	const cdp = await context.newCDPSession( page );
	const point = async ( name, id ) => {
		const b = await page.getByRole( 'button', { name, exact: true } ).boundingBox();
		return { x: b.x + b.width / 2, y: b.y + b.height / 2, id };
	};
	await test.step( 'Given the phone has taken the driver seat', async () => {
		const drive = page.getByRole( 'button', { name: 'Drive GT3', exact: true } );
		await expect( drive ).toBeEnabled( { timeout: 140000 } ); await drive.tap();
		await expect( page.getByRole( 'button', { name: 'Throttle' } ) ).toBeVisible();
	} );
	await test.step( 'When two fingers hold Throttle and Right, then the real car turns under power', async () => {
		const gas = await point( 'Throttle', 1 ), right = await point( 'Right', 2 );
		await cdp.send( 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [ gas ] } );
		await cdp.send( 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [ gas, right ] } );
		await expect( control ).toHaveAttribute( 'data-host-keys', /KeyW.*KeyD|KeyD.*KeyW/ );
		await expect.poll( async () => Math.abs( Number( await control.getAttribute( 'data-turn-rate' ) ) ), { timeout: 15000 } ).toBeGreaterThan( .1 );
		await expect.poll( async () => parseInt( await page.getByRole( 'status' ).textContent() ) ).toBeGreaterThan( 5 );
	} );
	await test.step( 'When the phone leaves with both fingers down and reconnects, then both host keys are up', async () => {
		await page.reload();
		await page.getByRole( 'button', { name: 'Resume game', exact: true } ).tap();
		await expect( page.getByRole( 'button', { name: 'Throttle' } ) ).toBeVisible();
		await expect( control ).toHaveAttribute( 'data-host-keys', '' );
	} );
} );
