import { test, expect } from '@playwright/test';
import { pickWheel } from './helpers/wheel.js';

const TOOL_PATHS = {
	Disasters: { path: [ 'World', 'Disasters' ], region: 'Disaster controls' },
	'Wind farm': { path: [ 'World', 'Wind Farm' ], region: 'Wind farm controls' },
	'Hang glider': { path: [ 'Air', 'Hang Glider' ], region: 'Hang glider controls' },
	Animals: { path: [ 'World', 'More World', 'Animals' ], region: 'Island animals' },
	Evacuation: { path: [ 'World', 'More World', 'Evacuation' ], region: 'Evacuation controls' },
	'Watch sharks': { path: [ 'Water', 'Watch Sharks' ], region: null },
};

async function ready( page ) {
	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=0.5&noAudio' );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
	await page.keyboard.press( 'Enter' );
}

async function open( page, name ) {
	const spec = TOOL_PATHS[ name ];
	expect( spec, `known tool path for ${ name }` ).toBeTruthy();
	const wheel = await pickWheel( page, ...spec.path );
	await expect( wheel ).toBeHidden();
	if ( ! spec.region ) return { panel: null };
	const panel = page.getByRole( 'region', { name: spec.region } );
	await expect( panel ).toBeVisible();
	return { panel };
}

for ( const viewport of [ { width: 1440, height: 900 }, { width: 390, height: 844 } ] ) {
	test( `World controls: panels remain exclusive and reachable through the Activity Wheel at ${ viewport.width }px`, async ( { page } ) => {
		const errors = []; page.on( 'pageerror', error => errors.push( error.message ) );
		await test.step( 'Given the real island at the requested viewport', async () => {
			await page.setViewportSize( viewport ); await ready( page );
		} );
		let previous;
		await test.step( 'When I open each simulation tool then only its own panel remains open', async () => {
			for ( const name of [ 'Disasters', 'Wind farm', 'Hang glider', 'Animals', 'Evacuation' ] ) {
				const current = await open( page, name );
				if ( previous ) await expect( previous.panel ).toBeHidden();
				const bounds = await current.panel.boundingBox();
				expect( bounds.x ).toBeGreaterThanOrEqual( 0 ); expect( bounds.y ).toBeGreaterThan( 60 );
				expect( bounds.x + bounds.width ).toBeLessThanOrEqual( viewport.width );
				expect( bounds.y + bounds.height ).toBeLessThanOrEqual( viewport.height );
				previous = current;
			}
		} );
		await test.step( 'When I close with Escape then keyboard focus returns to the Activities launcher', async () => {
			await previous.panel.click( { position: { x: 15, y: 15 } } );
			await page.keyboard.press( 'Escape' );
			await expect( previous.panel ).toBeHidden();
			await expect( page.getByRole( 'button', { name: 'Activities menu' } ) ).toBeFocused();
			await page.screenshot( { path: test.info().outputPath( `tidewater-world-controls-${ viewport.width }.png` ) } );
			expect( errors ).toEqual( [] );
		} );
	} );
}

test( 'Shared ambient wind: the wind farm controls change the environment measured by disasters', async ( { page } ) => {
	await test.step( 'Given a fresh island with no active disaster', async () => { await ready( page ); } );
	for ( const speed of [ 0, 12 ] ) {
		await test.step( `When I apply ${ speed } m/s through the wind farm environment controls`, async () => {
			await open( page, 'Wind farm' );
			const windDetails = page.getByText( 'Shared island wind', { exact: true } );
			if ( ! await windDetails.locator( '..' ).getAttribute( 'open' ).then( value => value !== null ) ) await windDetails.click();
			await page.getByLabel( 'Ambient wind (m/s)', { exact: true } ).fill( String( speed ) );
			await page.getByLabel( 'Wind direction (°)', { exact: true } ).fill( '270' );
			await page.getByRole( 'button', { name: 'Apply wind', exact: true } ).click();
		} );
		await test.step( 'Then the independent disaster inspector samples that same wind field', async () => {
			await open( page, 'Disasters' );
			const status = page.getByRole( 'status', { name: 'Disaster simulation' } );
			await expect( status ).toHaveAttribute( 'data-active', 'none' );
			await expect.poll( async () => Number( await status.getAttribute( 'data-wind' ) ) ).toBeCloseTo( speed, 1 );
		} );
	}
} );

test( 'World modes: the global HUD follows flight and underwater observation', async ( { page } ) => {
	await test.step( 'Given the island and a ready fighter', async () => { await ready( page ); } );
	await test.step( 'When I enter the fighter through the Activity Wheel then the global mode identifies flight', async () => {
		const wheel = await pickWheel( page, 'Air', 'F/A-18 Hornet', 'Fly Hornet' );
		await expect( wheel ).toBeHidden();
		await expect( page.getByText( 'Flying · Hornet', { exact: true } ) ).toBeVisible();
	} );
	await test.step( 'When I leave aviation and watch sharks then the return prompt offers diving', async () => {
		await page.getByRole( 'status', { name: 'Flight instruments' } ).getByRole( 'button', { name: 'Leave aviation', exact: true } ).click();
		await open( page, 'Watch sharks' );
		await expect( page.locator( '.tw-mode-text' ) ).toHaveText( 'Free camera' );
		await expect( page.locator( '.tw-prompt-text' ) ).toHaveText( 'Dive' );
	} );
	await test.step( 'When I launch the glider then watching animals preserves the active flight controls', async () => {
		await open( page, 'Hang glider' ); await page.getByRole( 'button', { name: 'Launch glider', exact: true } ).click();
		await expect.poll( () => page.evaluate( () => window.__app.glider.active ) ).toBe( true );
		await open( page, 'Animals' ); await page.getByRole( 'button', { name: 'Watch goats', exact: true } ).click();
		await expect( page.getByText( 'Leave the vehicle controls before watching animals.', { exact: true } ) ).toBeVisible();
		expect( await page.evaluate( () => ( { active: window.__app.glider.active, mode: window.__app.player.mode, free: window.__app.freeCam } ) ) ).toEqual( { active: true, mode: 'glider', free: false } );
	} );
} );

async function separated( first, second, label ) {
	const a = await first.boundingBox(), b = await second.boundingBox();
	expect( a, `${ label }: first visible bounds` ).toBeTruthy(); expect( b, `${ label }: second visible bounds` ).toBeTruthy();
	const overlap = Math.max( 0, Math.min( a.x + a.width, b.x + b.width ) - Math.max( a.x, b.x ) ) * Math.max( 0, Math.min( a.y + a.height, b.y + b.height ) - Math.max( a.y, b.y ) );
	expect( overlap, `${ label } must not overlap` ).toBe( 0 );
}
test( 'Portrait coexistence: identity, warnings and flight instruments remain readable', async ( { page } ) => {
	await test.step( 'Given the real island on a narrow portrait display', async () => {
		await page.setViewportSize( { width: 390, height: 844 } ); await ready( page );
		await separated( page.locator( '.tw-brand' ), page.getByRole( 'button', { name: 'Activities menu' } ), 'Identity and Activities button' );
		await separated( page.locator( '.tw-prompt' ), page.locator( '.gm-map' ), 'Walking prompt and map' );
	} );
	await test.step( 'When I enter the Hornet via the Activity Wheel then its HUD and shortcut strip stay clear', async () => {
		const wheel = await pickWheel( page, 'Air', 'F/A-18 Hornet', 'Fly Hornet' );
		await expect( wheel ).toBeHidden();
		await expect( page.getByRole( 'status', { name: 'Flight instruments', exact: true } ) ).toBeVisible();
		await separated( page.locator( '.tw-brand' ), page.getByRole( 'button', { name: 'Activities menu' } ), 'Flight identity and Activities button' );
		await separated( page.getByRole( 'toolbar', { name: 'Flight controls' } ), page.locator( '.tw-rail' ), 'Shortcut strip and settings rail' );
	} );
	await test.step( 'When I configure a tsunami then the panel replaces the narrow flight instrument layer', async () => {
		await open( page, 'Disasters' ); await expect( page.locator( '.av-hud' ) ).toBeHidden();
		await page.getByLabel( 'Disaster type' ).selectOption( 'tsunami' );
		await page.getByLabel( 'Warning lead time (s)', { exact: true } ).fill( '120' );
		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).click();
		const warning = page.getByRole( 'status', { name: 'Tsunami warning', exact: true } ); await expect( warning ).toBeVisible();
		await separated( warning, page.getByRole( 'button', { name: 'Activities menu' } ), 'Warning and Activities launcher' );
		await separated( warning, page.getByRole( 'region', { name: 'Disaster controls' } ), 'Warning and disaster panel' );
		await page.screenshot( { path: test.info().outputPath( 'tidewater-portrait-warning-controls.png' ) } );
	} );
	await test.step( 'When I close the panel then the instruments return while the warning remains visible', async () => {
		await page.getByRole( 'button', { name: 'Close disaster controls', exact: true } ).click();
		await expect( page.locator( '.av-hud' ) ).toBeVisible();
		await expect( page.getByRole( 'status', { name: 'Tsunami warning', exact: true } ) ).toBeVisible();
		await separated( page.getByRole( 'status', { name: 'Tsunami warning', exact: true } ), page.getByRole( 'toolbar', { name: 'Flight controls' } ), 'Warning and shortcut strip' );
		await page.screenshot( { path: test.info().outputPath( 'tidewater-portrait-warning-flight.png' ) } );
	} );
} );
