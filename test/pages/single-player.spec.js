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
		await page.getByRole( 'button', { name: 'Walk instead' } ).waitFor( { timeout: 100_000 } );
		const picker = page.getByRole( 'region', { name: 'Island garage' } );
		await page.screenshot( { path: test.info().outputPath( 'garage.png' ) } );
		await page.keyboard.press( 'Tab' );
		await expect( picker.getByRole( 'button', { name: 'Edit character' } ) ).toBeFocused();
		await page.keyboard.press( 'Space' );
		const editor = page.getByRole( 'region', { name: 'Character appearance' } );
		await editor.getByRole( 'combobox', { name: 'Shirt' } ).selectOption( '1' );
		await editor.getByRole( 'combobox', { name: 'Skin tone' } ).selectOption( '2' );
		await editor.getByRole( 'combobox', { name: 'Field hat' } ).selectOption( 'off' );
		await expect( editor.getByRole( 'img' ) ).toHaveAttribute( 'src', /player-1-2-1\.webp$/ );
		await page.screenshot( { path: test.info().outputPath( 'character.png' ) } );
		await editor.getByRole( 'button', { name: 'Done' } ).focus();
		await page.keyboard.press( 'Enter' );
		await picker.getByRole( 'button', { name: 'GT3RS ZRY', exact: true } ).click();
		await picker.getByRole( 'combobox', { name: 'Start location' } ).selectOption( 'town' );
		await picker.getByRole( 'button', { name: 'Drive GT3RS ZRY', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await expect( page.getByRole( 'button', { name: 'Drive together' } ) ).toHaveCount( 0 );
	} );
	await test.step( 'When they accelerate on the town backroad', async () => {
		await expect( page.getByLabel( 'Start at', { exact: true } ) ).toHaveValue( 'town' );
		await expect( dash ).toHaveAttribute( 'data-grounded', '4.0000' );
		await page.keyboard.down( 'w' );
		try { await expect.poll( async () => Number( await dash.getAttribute( 'data-speed' ) ), { timeout: 15_000 } ).toBeGreaterThan( 20 ); }
		finally { await page.keyboard.up( 'w' ); }
	} );
	await test.step( 'Then the selected car is driving with all assets served over HTTP', async () => {
		await expect( dash ).toHaveAttribute( 'data-vehicle', 'gt3rszry' );
		await page.keyboard.press( 'e' );
		await expect( dash ).toBeHidden();
		await expect.poll( () => page.evaluate( () => __app.player.avatar?.group.visible ) ).toBe( true );
		const look = await page.evaluate( () => {
			const avatar = __app.player.avatar, body = avatar.model.materials.find( m => m.name === 'skinned-body' );
			return { hat: avatar.model.meshes.find( m => m.material.name === 'skinned-hat' ).visible,
				shirt: body.uniforms.shirtStyle.value, tone: body.uniforms.skinTone.value };
		} );
		await page.evaluate( () => new Promise( resolve => requestAnimationFrame( () => requestAnimationFrame( resolve ) ) ) );
		await page.screenshot( { path: test.info().outputPath( 'on-foot.png' ) } );
		expect( look ).toMatchObject( { hat: false, shirt: 1, tone: 2 } );
		expect( badAssets ).toEqual( [] );
		expect( errors ).toEqual( [] );
		expect( sockets ).toEqual( [] );
	} );
	await test.step( 'Returning on foot arrives beside the chosen car at the new location', async () => {
		await page.reload();
		const garage = page.getByRole( 'region', { name: 'Island garage' } );
		await garage.waitFor( { timeout: 100000 } );
		await garage.getByRole( 'button', { name: 'Sandpiper 1600', exact: true } ).click();
		await garage.getByRole( 'combobox', { name: 'Start location' } ).selectOption( 'mountain' );
		await garage.getByRole( 'button', { name: 'Walk instead' } ).click();
		const spawn = await page.evaluate( () => {
			const { player, rally, terrainData } = __app, spot = terrainData.roads.spawn( 'mountain' );
			return { mode: player.mode, car: rally.vehicleKey, distance: Math.hypot( player.position.x - spot.x, player.position.z - spot.z ),
				appearance: player.avatar.appearance };
		} );
		expect( spawn ).toMatchObject( { mode: 'walk', car: 'buggy', appearance: { shirt: 1, tone: 2, hat: false } } );
		expect( spawn.distance ).toBeLessThan( 22 );
	} );

} );
