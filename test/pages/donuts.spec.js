import { expect, test } from '@playwright/test';

test( 'A GT3 donut leaves rubber and sounds louder than the engine at the ferry terminal', async ( { page }, info ) => {
	const dash = page.getByRole( 'status', { name: 'Rally telemetry' } );
	let sampleLoaded = false;
	page.on( 'response', r => {
		if ( new URL( r.url() ).pathname.endsWith( '/rally/audio/tyre-squeal.wav' ) && r.ok() ) sampleLoaded = true;
	} );
	await test.step( 'Given a visitor drives the GT3 into the ferry yard with assists off', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( './' );
		await page.getByRole( 'button', { name: 'Click to explore' } ).waitFor( { timeout: 100_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await page.getByLabel( 'Vehicle', { exact: true } ).selectOption( 'gt3rs' );
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'ferry' );
		await page.getByRole( 'button', { name: 'Drive COSIER GT3 RS' } ).click();
		await expect( dash ).toHaveAttribute( 'data-grounded', '4.0000' );
		await expect( dash ).toHaveAttribute( 'data-audio-state', 'playing' );
		await page.keyboard.press( 'j' );
		await expect( page.getByRole( 'button', { name: 'Driving aids' } ) ).toHaveAttribute( 'aria-pressed', 'false' );
	} );
	await test.step( 'When they spin the rear tyres and release the brake at full steering lock', async () => {
		await page.keyboard.down( 'd' );
		await page.keyboard.down( 's' );
		await page.keyboard.down( 'w' );
		await page.waitForFunction( () => Math.min( window.__app.rally.state[ 23 ], window.__app.rally.state[ 27 ] ) > 14 );
		await page.keyboard.up( 's' );
	} );
	await test.step( 'Then the car completes two circles, lays rubber and plays the tyre recording above the engine', async () => {
		const result = await page.evaluate( async () => {
			const r = window.__app.rally;
			function meter( gain ) {
				const analyser = r.sound.ctx.createAnalyser();
				const data = new Float32Array( analyser.fftSize );
				gain.connect( analyser );
				return () => {
					analyser.getFloatTimeDomainData( data );
					let energy = 0;
					for ( const v of data ) energy += v * v;
					return energy / data.length;
				};
			}
			const tyre = meter( r.sound.tyres.squeal.gain ), engine = meter( r.sound.gain );
			let yaw = Math.atan2( r.forward.x, r.forward.z ), angle = 0, distance = 0;
			let x = r.state[ 0 ], z = r.state[ 2 ], tyreEnergy = 0, engineEnergy = 0;
			const start = performance.now(), skids = r.tracks.skids;
			while ( Math.abs( angle ) < 4 * Math.PI && performance.now() - start < 25_000 ) {
				await new Promise( requestAnimationFrame );
				const heading = Math.atan2( r.forward.x, r.forward.z );
				angle += Math.atan2( Math.sin( heading - yaw ), Math.cos( heading - yaw ) );
				distance += Math.hypot( r.state[ 0 ] - x, r.state[ 2 ] - z );
				x = r.state[ 0 ]; z = r.state[ 2 ]; yaw = heading;
				tyreEnergy += tyre(); engineEnergy += engine();
			}
			return { turns: Math.abs( angle ) / ( 2 * Math.PI ), distance, skids: r.tracks.skids - skids,
				tyreDbAboveEngine: 10 * Math.log10( ( tyreEnergy + 1e-12 ) / ( engineEnergy + 1e-12 ) ), engineEnergy };
		} );
		await page.screenshot( { path: info.outputPath( 'donuts.png' ) } );
		console.log( 'Terminal donut', result );
		expect( result.turns ).toBeGreaterThanOrEqual( 2 );
		expect( result.distance ).toBeGreaterThan( 15 );
		expect.soft( result.skids ).toBeGreaterThan( 100 );
		expect.soft( sampleLoaded ).toBe( true );
		expect( result.engineEnergy ).toBeGreaterThan( 0.0001 );
		expect( result.tyreDbAboveEngine ).toBeGreaterThan( 3 );
	} );
	await test.step( 'Then muting the car fades the tyres during the slide', async () => {
		await page.getByRole( 'button', { name: 'Engine sound' } ).click();
		await expect.poll( () => page.evaluate( () => window.__app.rally.sound.tyres.squeal.gain.gain.value ) ).toBeLessThan( 0.001 );
		await page.keyboard.up( 'd' );
		await page.keyboard.up( 'w' );
	} );
	expect( await page.pageErrors() ).toEqual( [] );
} );
