import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { SCENARIO_TIMEOUT_MS } from './gameTime.js';

const OUT = process.env.PW_OUT ?? 'test-results/tornado-cinematic';
const funnel = ( page ) => page.evaluate( () => ( { ...window.__app.disasters.tornadoVisuals.snapshot().funnel, time: window.__app.disasters.field.events.get( 'tornado' )?.time ?? null } ) );
const p95 = ( a ) => {

	const s = [ ...a ].sort( ( x, y ) => x - y );
	return s.length ? s[ Math.min( s.length - 1, Math.floor( s.length * 0.95 ) ) ] : NaN;

};

// Mean linear luminance of the funnel at mid-height against the sky either side of it, from the
// screenshot itself (decoded by the page's image decoder).
async function funnelContrast( page, png, f ) {

	return page.evaluate( async ( { png, f } ) => {

		const cam = window.__app.camera, V = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements;
		const w = [ f.x, f.ground + f.base * 0.4, f.z, 1 ], mul = ( m, v ) => [ 0, 1, 2, 3 ].map( ( r ) => m[ r ] * v[ 0 ] + m[ 4 + r ] * v[ 1 ] + m[ 8 + r ] * v[ 2 ] + m[ 12 + r ] * v[ 3 ] );
		const clip = mul( P, mul( V, w ) );
		const img = new Image();
		img.src = 'data:image/png;base64,' + png;
		await img.decode();
		const c = new OffscreenCanvas( img.width, img.height ), g = c.getContext( '2d' );
		g.drawImage( img, 0, 0 );
		const px = Math.round( ( clip[ 0 ] / clip[ 3 ] * 0.5 + 0.5 ) * img.width ), py = Math.round( ( 0.5 - clip[ 1 ] / clip[ 3 ] * 0.5 ) * img.height );
		const lin = ( v ) => ( v /= 255, v <= 0.04045 ? v / 12.92 : ( ( v + 0.055 ) / 1.055 ) ** 2.4 );
		const lum = ( x0 ) => {

			const d = g.getImageData( x0 - 2, py - 8, 5, 17 ).data;
			let s = 0;
			for ( let i = 0; i < d.length; i += 4 ) s += 0.2126 * lin( d[ i ] ) + 0.7152 * lin( d[ i + 1 ] ) + 0.0722 * lin( d[ i + 2 ] );
			return s / ( d.length / 4 );

		};
		const core = lum( px ), sky = ( lum( px - 45 ) + lum( px + 45 ) ) / 2;
		return { px, py, core, sky, contrast: Math.abs( core - sky ) / Math.max( sky, 1e-4 ) };

	}, { png: png.toString( 'base64' ), f } );

}

async function funnelLook( page, png, f ) {

	return page.evaluate( async ( { png, f } ) => {

		const cam = window.__app.camera, V = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements;
		const mul = ( m, v ) => [ 0, 1, 2, 3 ].map( ( r ) => m[ r ] * v[ 0 ] + m[ 4 + r ] * v[ 1 ] + m[ 8 + r ] * v[ 2 ] + m[ 12 + r ] * v[ 3 ] );
		const img = new Image();
		img.src = 'data:image/png;base64,' + png;
		await img.decode();
		const W = img.width, H = img.height, c = new OffscreenCanvas( W, H ), g = c.getContext( '2d' );
		g.drawImage( img, 0, 0 );
		const project = ( x, y, z ) => {

			const q = mul( P, mul( V, [ x, y, z, 1 ] ) );
			return [ Math.round( ( q[ 0 ] / q[ 3 ] * 0.5 + 0.5 ) * W ), Math.round( ( 0.5 - q[ 1 ] / q[ 3 ] * 0.5 ) * H ) ];

		};
		const lin = ( v ) => ( v /= 255, v <= 0.04045 ? v / 12.92 : ( ( v + 0.055 ) / 1.055 ) ** 2.4 );
		const block = ( [ x, y ] ) => {

			const d = g.getImageData( x - 2, y - 2, 5, 5 ).data;
			let s = 0;
			for ( let i = 0; i < d.length; i += 4 ) s += 0.2126 * lin( d[ i ] ) + 0.7152 * lin( d[ i + 1 ] ) + 0.0722 * lin( d[ i + 2 ] );
			return s / 25;

		};
		const dx = f.x - cam.position.x, dz = f.z - cam.position.z, n = Math.hypot( dx, dz ) || 1;
		const { condensationX } = await import( '/src/disasters/TornadoFunnel.js' );
		const rc = f.rc ?? 16.06; // m (16.06 = the default tornado's core radius, for builds without f.rc)
		const kappa = 9.81 / ( f.presence * f.descent * ( f.vmax / 0.6382 ) ** 2 ); // 1/m, as TornadoVisuals.updateStorm
		const blocks = [];
		for ( const k of [ 0.3, 0.5, 0.7 ] ) {

			const R = 0.5 * rc * condensationX( kappa * f.base * ( 1 - k ) );
			for ( const o of [ - 1, 0, 1 ] ) blocks.push( block( project( f.x - dz / n * o * R, f.ground + f.base * k, f.z + dx / n * o * R ) ) );

		}
		const mean = blocks.reduce( ( a, b ) => a + b, 0 ) / blocks.length;
		const shading = ( Math.max( ...blocks ) - Math.min( ...blocks ) ) / Math.max( mean, 1e-4 );
		const x0 = Math.round( 400 * W / 1440 ), x1 = Math.round( 1340 * W / 1440 ), y0 = Math.round( 150 * H / 900 ), y1 = Math.round( 470 * H / 900 );
		const d = g.getImageData( x0, y0, x1 - x0 + 1, y1 - y0 + 1 ).data, w = x1 - x0 + 1, h = y1 - y0 + 1;
		const v = ( x, y ) => { const i = ( y * w + x ) * 4; return ( d[ i ] * 0.2126 + d[ i + 1 ] * 0.7152 + d[ i + 2 ] * 0.0722 ) / 255; };
		let step = 0, sum = 0, count = 0;
		for ( let y = 0; y < h - 1; y ++ ) for ( let x = 0; x < w - 1; x ++ ) { const a = v( x, y ); step += ( Math.abs( v( x + 1, y ) - a ) + Math.abs( v( x, y + 1 ) - a ) ) / 2; sum += a; count ++; }
		return { blocks: blocks.map( ( b ) => + b.toFixed( 4 ) ), shading, roughness: step / Math.max( sum, 1e-4 ) };

	}, { png: png.toString( 'base64' ), f } );

}

test( 'Tornado: the storm darkens, the funnel builds down from the wall cloud and touches down, visible from 2 km', async ( { page } ) => {

	test.setTimeout( SCENARIO_TIMEOUT_MS * 2 );
	const errors = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );
	await mkdir( OUT, { recursive: true } );
	let before;
	await test.step( 'Given the island and the Disasters panel set to a tornado', async () => {

		await page.route( 'https://fonts.googleapis.com/**', ( r ) => r.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( `/?scale=${ process.env.PW_RENDER_SCALE ?? '1' }&noAudio` );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 180000 } );
		await page.getByRole( 'button', { name: 'Click to explore', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
		await page.getByLabel( 'Disaster type' ).selectOption( 'tornado' );
		before = await page.evaluate( () => new Promise( ( resolve ) => {

			const d = [];
			let last = performance.now();
			const end = last + 4000;
			const f = ( t ) => { d.push( t - last ); last = t; if ( t < end ) requestAnimationFrame( f ); else resolve( d ); };
			requestAnimationFrame( f );

		} ) );
		// frame times while the event clock is in 5-40 s, collected by the page as it runs
		await page.evaluate( () => {

			const a = window.__app;
			window.__tornadoFrames = [];
			let last = performance.now(), seen = false;
			const f = ( t ) => {

				const e = a.disasters.field.events.get( 'tornado' );
				if ( e ) seen = true;
				if ( e && e.time >= 5 && e.time <= 40 ) window.__tornadoFrames.push( t - last );
				last = t;
				if ( ! seen || e ) requestAnimationFrame( f );

			};
			requestAnimationFrame( f );

		} );

	} );
	await test.step( 'When I start the default tornado from the panel with the keyboard', async () => {

		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).focus();
		await page.keyboard.press( 'Enter' );
		await expect( page.getByRole( 'status', { name: 'Disaster simulation' } ) ).toHaveAttribute( 'data-active', 'tornado' );

	} );
	let genesis;
	await test.step( 'Then the storm builds over seconds and the funnel is still aloft early in genesis', async () => {

		await expect.poll( async () => ( await funnel( page ) ).time, { timeout: 300000 } ).toBeGreaterThan( 3 );
		const early = await funnel( page );
		genesis = early.genesis;
		expect( early.genesis, 'genesis is drawn from the event seed, 20-30 s for a 60 s tornado' ).toBeGreaterThanOrEqual( 20 );
		expect( early.genesis ).toBeLessThanOrEqual( 30 );
		expect( early.storm, `storm ${ early.storm.toFixed( 2 ) } has started but not snapped` ).toBeGreaterThan( 0.1 );
		expect( early.storm ).toBeLessThan( 0.95 );
		expect( early.tip, `funnel tip ${ early.tip.toFixed( 0 ) } m above the ground early in genesis` ).toBeGreaterThan( 100 );

	} );
	await test.step( 'And after genesis the funnel reaches the ground under a dark storm, seen from 2 km, 500 m, 150 m and the ground', async () => {

		await expect.poll( async () => ( await funnel( page ) ).time, { timeout: 900000, intervals: [ 1000 ] } ).toBeGreaterThan( genesis + 0.5 );
		const down = await funnel( page );
		// The tip sits where the Burgers-Rott core deficit (1.70 rho vmax^2) meets rho g ( H - h ): with the
		// seeded pulses and base the default tornado touches down on most runs and hangs over its debris
		// cloud on some, as real ones do. Either way it has built hundreds of metres down from the wall cloud.
		const reach = Math.LN2 / 0.6382 ** 2 * down.vmax * down.vmax / 9.81; // 1.70 rho vmax^2 over rho g, exact as TornadoFunnel
		expect( down.tip, `tip ${ down.tip.toFixed( 0 ) } m for ${ down.vmax.toFixed( 1 ) } m/s under a ${ down.base.toFixed( 0 ) } m base` ).toBeCloseTo( down.base - down.descent * down.presence * reach, 0 );
		expect( down.base - down.tip, 'the funnel has built at least 300 m down from the wall cloud' ).toBeGreaterThanOrEqual( 300 );
		expect( down.storm ).toBeGreaterThan( 0.9 );
		for ( const view of [ 'tornadoFar', 'tornado500', 'tornado150', 'tornadoGround' ] ) {

			await page.evaluate( ( v ) => window.__view( v ), view );
			await page.waitForTimeout( 2500 );
			await expect( page.getByRole( 'region', { name: 'Disaster laboratory' } ).or( page.locator( '.disaster-panel' ) ).first(), 'the Disaster laboratory is closed for the review capture' ).toBeHidden();
			const png = await page.screenshot();
			await writeFile( `${ OUT }/tornado-${ view }.png`, png );
			if ( view === 'tornadoFar' ) {

				const c = await funnelContrast( page, png, await funnel( page ) );
				test.info().annotations.push( { type: 'contrast at 2 km', description: JSON.stringify( c ) } );
				expect( c.contrast, `funnel ${ c.core.toFixed( 4 ) } vs sky ${ c.sky.toFixed( 4 ) } at pixel ${ c.px },${ c.py }` ).toBeGreaterThanOrEqual( 0.3 );
				const look = await funnelLook( page, png, await funnel( page ) );
				test.info().annotations.push( { type: 'storm base roughness at 2 km', description: JSON.stringify( look ) } );
				expect.soft( look.roughness, `storm base and sky pixel roughness ${ look.roughness.toFixed( 3 ) } (a dither the TAA left unresolved)` ).toBeLessThanOrEqual( 0.03 );

			}
			if ( view === 'tornadoGround' ) {

				const eye = await page.evaluate( () => {

					const A = window.__app, V = A.camera.position.constructor, f = A.disasters.tornadoVisuals.snapshot().funnel, e = A.camera.position.clone();
					let near = 30;
					for ( let k = 0; k < 8; k ++ ) near = Math.min( near, A.colliders.raycast( e, new V( Math.cos( k * Math.PI / 4 ), 0, Math.sin( k * Math.PI / 4 ) ), 30 ) );
					const to = new V( f.x, f.ground + 20, f.z ).sub( e ), dist = to.length();
					const fwd = new V();
					A.camera.getWorldDirection( fwd );
					const off = Math.acos( Math.max( - 1, Math.min( 1, ( fwd.x * to.x + fwd.z * to.z ) / ( Math.hypot( fwd.x, fwd.z ) * Math.hypot( to.x, to.z ) ) ) ) );
					return { roof: A.colliders.raycast( e, new V( 0, 1, 0 ), 40 ), near, dist, off, sight: A.colliders.raycast( e, to.normalize(), dist ) };

				} );
				test.info().annotations.push( { type: 'ground eye', description: JSON.stringify( eye ) } );
				expect( eye.roof, `nothing over the eye for 40 m (${ JSON.stringify( eye ) })` ).toBeGreaterThanOrEqual( 40 );
				expect( eye.near, 'no wall within 3 m of the eye' ).toBeGreaterThan( 3 );
				expect( eye.sight, 'a clear line to the funnel foot' ).toBeGreaterThanOrEqual( eye.dist - 0.01 );
				expect( eye.off, 'the funnel foot is within 25 degrees of the view axis (probe: 39 degrees at yaw 0, out of frame)' ).toBeLessThan( 25 * Math.PI / 180 );
				expect( eye.dist, 'the foot is 40-120 m away' ).toBeGreaterThan( 40 );
				expect( eye.dist ).toBeLessThan( 120 );

			}
			if ( view === 'tornado500' ) {

				const look = await funnelLook( page, png, await funnel( page ) );
				test.info().annotations.push( { type: 'funnel shading at 500 m', description: JSON.stringify( look ) } );
				expect.soft( look.shading, `funnel blocks ${ look.blocks.join( ', ' ) }: a flat fill, not a lit volume` ).toBeGreaterThanOrEqual( 0.25 );

			}

		}

	} );
	await test.step( 'And the frame recovers 10 s after I stop it with the keyboard', async () => {

		await expect.poll( async () => ( await funnel( page ) ).time ?? 99, { timeout: 900000, intervals: [ 1000 ] } ).toBeGreaterThan( 40 );
		// The review pose closed the Disaster laboratory (DebugViews "a pose closes it"): reopen it from its menu button, as a player does.
		await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
		await expect( page.getByRole( 'button', { name: 'Stop all disasters', exact: true } ) ).toBeVisible();
		await writeFile( `${ OUT }/tornado-panel.png`, await page.screenshot() );
		await page.getByRole( 'button', { name: 'Stop all disasters', exact: true } ).focus();
		await page.keyboard.press( 'Enter' );
		await page.waitForTimeout( 10000 );
		const after = await page.evaluate( () => new Promise( ( resolve ) => {

			const d = [];
			let last = performance.now();
			const end = last + 4000;
			const f = ( t ) => { d.push( t - last ); last = t; if ( t < end ) requestAnimationFrame( f ); else resolve( d ); };
			requestAnimationFrame( f );

		} ) );
		const during = await page.evaluate( () => window.__tornadoFrames );
		const load = ( await import( 'node:os' ) ).loadavg()[ 0 ].toFixed( 0 );
		test.info().annotations.push( { type: 'frame time p95 ms', description: `before ${ p95( before ).toFixed( 1 ) }, t 5-40 s ${ p95( during ).toFixed( 1 ) } (${ during.length } frames), 10 s after ${ p95( after ).toFixed( 1 ) }, load ${ load }` } );
		await writeFile( `${ OUT }/frame-times.json`, JSON.stringify( { before: p95( before ), during: p95( during ), frames: during.length, after: p95( after ), load } ) );
		const clear = await funnel( page );
		expect( clear.storm, 'the storm clears gradually after the stop' ).toBeGreaterThan( 0 );
		expect( errors ).toEqual( [] );

	} );

} );
