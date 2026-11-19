import { test, expect } from '@playwright/test';

test( 'An iPhone without WebGPU drives the Mac GT3 with sound and resumes after disconnecting', async ( { page, browser }, info ) => {
	const resources = [], errors = [];
	page.on( 'request', r => resources.push( r.url() ) );
	page.on( 'pageerror', e => errors.push( e.message ) );
	const speed = async () => parseInt( await page.getByRole( 'status' ).textContent() );
	const button = name => page.getByRole( 'button', { name, exact: true } );
	async function hold( name ) {
		const b = await button( name ).boundingBox();
		await page.mouse.move( b.x + b.width / 2, b.y + b.height / 2 ); await page.mouse.down();
	}
	await test.step( 'Given the Mac is hosting and the phone has no WebGPU', async () => {
		await page.addInitScript( () => Object.defineProperty( navigator, 'gpu', { value: undefined } ) );
		await page.goto( '/' );
		await expect( button( 'Drive GT3' ) ).toBeEnabled( { timeout: 140000 } );
	} );
	await test.step( 'When the player taps Drive GT3 and holds Throttle', async () => {
		await button( 'Drive GT3' ).tap();
		await expect( button( 'Throttle' ) ).toBeVisible();
		await hold( 'Throttle' );
		await expect.poll( speed, { timeout: 20000 } ).toBeGreaterThan( 20 );
		await page.mouse.up();
	} );
	await test.step( 'Then the car brakes, game pictures advance, and sound is decoded on the phone', async () => {
		const before = Number( await page.locator( 'canvas' ).getAttribute( 'data-frames' ) );
		await hold( 'Brake' );
		await expect.poll( speed ).toBeLessThan( 15 );
		await page.mouse.up();
		await expect.poll( async () => Number( await page.locator( 'canvas' ).getAttribute( 'data-frames' ) ) ).toBeGreaterThan( before + 10 );
		await expect.poll( async () => Number( await page.locator( 'canvas' ).getAttribute( 'data-audio-packets' ) ) ).toBeGreaterThan( 15 );
		await expect( page.locator( 'canvas' ) ).toHaveAttribute( 'data-audible', 'true' );
		await page.screenshot( { path: info.outputPath( 'driving.png' ) } );
		expect( resources.some( r => /\.(glb|wasm)(?:\?|$)/.test( r ) ) ).toBe( false );
		expect( errors ).toEqual( [] );
	} );
	await test.step( 'Given a second phone connects while the first is playing, it waits for control', async () => {
		const guest = await browser.newContext();
		try {
			const other = await guest.newPage(); await other.goto( page.url() );
			await expect( other.getByRole( 'status' ) ).toContainText( 'Another phone' );
			await expect( other.getByRole( 'button', { name: 'Drive GT3' } ) ).toBeDisabled();
		} finally { await guest.close(); }
	} );
	await test.step( 'When the first phone reconnects, it can resume the same game and explore on foot', async () => {
		await page.reload();
		await button( 'Resume game' ).tap();
		await expect( button( 'Throttle' ) ).toBeVisible();
		await button( 'Menu' ).tap(); await button( 'Explore on foot' ).tap();
		await expect( page.getByRole( 'status' ) ).toHaveText( 'On foot' );
		await expect( button( 'Interact' ) ).toBeVisible();
		await page.setViewportSize( { width: 402, height: 796 } );
		await button( 'Menu' ).tap();
		await page.screenshot( { path: info.outputPath( 'portrait-menu.png' ) } );
	} );
} );
