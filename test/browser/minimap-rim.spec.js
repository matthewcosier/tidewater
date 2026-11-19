import { test, expect } from '@playwright/test';

const OUT = process.env.PW_OUT || 'test-results';

async function openIsland( page ) {

	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=0.5&noAudio' );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();

}

// The N and every pin on the rim, as drawn: [ label, left, top, right, bottom ] in css px.
const rim = page => page.evaluate( () => [ ...document.querySelectorAll( '.gm-map-n, .gm-mk.is-edge' ) ]
	.filter( e => e.offsetParent !== null )
	.map( e => { const r = ( e.classList.contains( 'gm-map-n' ) ? e : e.lastElementChild ).getBoundingClientRect(); return [ e.className, r.left, r.top, r.right, r.bottom ]; } ) );

test( 'Pins on the minimap rim keep clear of the N and of each other', async ( { page } ) => {

	test.setTimeout( 240_000 );
	await test.step( 'Given the island, and the free camera over Joey Island\'s ferry berth', async () => {

		await openIsland( page );
		await page.evaluate( () => {

			const app = window.__app, b = app.joeyTerminal.berth(), V = app.camera.position.constructor;
			const eye = new V( b.x + 60, 45, b.z - 60 );
			app.setFreeCam( true );
			app.fly.setPose( eye, Math.atan2( eye.x - b.x, eye.z - b.z ), Math.atan2( 3 - eye.y, Math.hypot( b.x - eye.x, b.z - eye.z ) ) );
			app.fly.velocity.set( 0, 0, 0 );

		} );

	} );
	await test.step( 'When the minimap draws', async () => {

		await page.waitForTimeout( 3_000 );
		await page.screenshot( { path: `${ OUT }/minimap-rim-joey.png` } );

	} );
	await test.step( 'Then no pin on the rim overlaps the N badge or another rim pin', async () => {

		const boxes = await rim( page ), hits = [];
		for ( let i = 0; i < boxes.length; i ++ ) for ( let j = i + 1; j < boxes.length; j ++ ) {

			const [ a, al, at, ar, ab ] = boxes[ i ], [ b, bl, bt, br, bb ] = boxes[ j ];
			const w = Math.min( ar, br ) - Math.max( al, bl ), h = Math.min( ab, bb ) - Math.max( at, bt );
			if ( w > 1 && h > 1 ) hits.push( `${ a } on ${ b } (${ w.toFixed( 0 ) } x ${ h.toFixed( 0 ) } px)` );

		}
		console.log( `rim: ${ boxes.length } (N and pins)` );
		expect( boxes.length ).toBeGreaterThan( 1 );
		expect( hits, hits.join( '; ' ) ).toEqual( [] );

	} );

} );
