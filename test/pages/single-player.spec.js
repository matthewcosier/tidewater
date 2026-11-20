import { expect, test } from '@playwright/test';

test( 'A visitor can drive the ZRY from the static island site', async ( { page, baseURL } ) => {
	const sockets = [], badAssets = [], errors = [];
	page.on( 'websocket', socket => sockets.push( socket.url() ) );
	page.on( 'pageerror', error => errors.push( error.message ) );
	page.on( 'response', response => {
		const url = new URL( response.url() );
		if ( url.origin === new URL( baseURL ).origin && response.status() >= 400 ) badAssets.push( url.pathname );
	} );
	const dash = page.getByRole( 'status', { name: 'Rally telemetry' } );

	await test.step( 'Given a fresh visitor enters the island under the project URL', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( './' );
		await page.getByRole( 'button', { name: 'Click to explore' } ).waitFor( { timeout: 100_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await expect( page.getByRole( 'button', { name: 'Drive together' } ) ).toHaveCount( 0 );
	} );
	await test.step( 'When they choose the ZRY and accelerate on the coastal road', async () => {
		await page.getByLabel( 'Vehicle', { exact: true } ).selectOption( 'gt3rszry' );
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'coast' );
		await page.getByRole( 'button', { name: 'Drive GT3RS ZRY', exact: true } ).click();
		await expect( dash ).toHaveAttribute( 'data-grounded', '4.0000' );
		await page.keyboard.down( 'w' );
		try { await expect.poll( async () => Number( await dash.getAttribute( 'data-speed' ) ), { timeout: 15_000 } ).toBeGreaterThan( 20 ); }
		finally { await page.keyboard.up( 'w' ); }
	} );
	await test.step( 'Then the selected car is driving with all assets served over HTTP', async () => {
		await expect( dash ).toHaveAttribute( 'data-vehicle', 'gt3rszry' );
		expect( badAssets ).toEqual( [] );
		expect( errors ).toEqual( [] );
		expect( sockets ).toEqual( [] );
	} );
} );
