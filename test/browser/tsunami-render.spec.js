import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = process.env.PW_OUT ?? 'test-results';
const TAG = process.env.CAPTURE_TAG ?? '';

async function ready( page ) {

	await page.route( 'https://fonts.googleapis.com/**', ( r ) => r.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( `/?scale=${ process.env.PW_RENDER_SCALE ?? '1' }&noAudio${ process.env.PW_QUERY ?? '' }` );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
	await page.getByRole( 'button', { name: 'Click to explore', exact: true } ).click();
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
	// telemetry only: log every resolution step the governor takes during the event (D5 diagnosis)
	await page.evaluate( () => {

		const g = window.__app.engine.resolution;
		window.__govLog = [ { t: performance.now(), level: { ...g.level }, mode: g.mode } ];
		g.onChange.push( ( l ) => window.__govLog.push( { t: performance.now(), level: { ...l } } ) );

	} );
	await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();

}

const event = ( page ) => page.evaluate( () => {

	const e = window.__app.disasters.field.events.get( 'tsunami' );
	return e ? { time: e.time, launched: e.launched, arrival: e.arrival, coast: !! e.coastReached } : null;

} );
const look = ( page ) => page.evaluate( () => {

	const l = window.__app.disasterWater.look();
	return { inner: l.inner?.boreCells ?? 0, outer: l.outer?.boreCells ?? 0, coast: l.inner?.coastBore ?? 0, jump: Math.max( l.inner?.maxJump ?? 0, l.outer?.maxJump ?? 0 ), turbid: l.inner?.turbidLand ?? 0 };

} );

// Stage a wave-following view and wait until a rendered frame shows the front inside the frustum, then shoot and
// check again on the front as it is at the capture (it moves 5-60 m/s).
const FRONT_CELLS = 3, FRONT_CREST = 0.3; // cells, m
async function follow( page, kind, name, settle, timeout = 600000 ) {

	let front = null;
	await expect.poll( async () => {

		front = await page.evaluate( ( k ) => window.__viewFront( k ), kind );
		// A front is a face, not a speck: at least FRONT_CELLS connected cells, and from the shore and the air its crest
		// stands FRONT_CREST m over the still sea. The largest breaking run is often one or two cells in the drawdown
		// (a seeded 2 m run staged on one cell with its crest 0.63 m under the datum, 43 s before the wave), and every
		// capture of that run showed calm sea or the drained bay.
		if ( ! front || front.cells < FRONT_CELLS || ( kind !== 'street' && front.crest < FRONT_CREST ) ) return false;
		await page.waitForTimeout( 300 );
		return page.evaluate( ( k ) => window.__frontOnScreen( k ), kind );

	}, { timeout, intervals: [ 500 ] } ).toBe( true );
	await page.waitForTimeout( settle );
	await mkdir( OUT, { recursive: true } );
	await page.screenshot( { path: `${ OUT }/${ TAG }-${ name }.png` } );
	const onScreen = await page.evaluate( ( k ) => window.__frontOnScreen( k ), kind );
	for ( const m of ( process.env.PW_WDBG ?? '' ).split( ',' ).filter( Boolean ).map( Number ) ) {

		await page.evaluate( ( v ) => { window.__app.waterMaterial.debugMode.value = v; }, m );
		await page.waitForTimeout( 600 );
		await page.screenshot( { path: `${ OUT }/${ TAG }-${ name }-wdbg${ m }.png` } );

	}
	if ( process.env.PW_WDBG ) await page.evaluate( () => { window.__app.waterMaterial.debugMode.value = 0; } );
	return { kind, onScreen, cells: front.cells, crest: front.crest, bed: front.bed, x: front.x, z: front.z, pose: front.pose };

}

// What the page reports as broken: thrown errors, and the engine's own log of a shader that failed to compile or a
// draw the GPU refused (Shader.js createShaderModule, GPU.js uncapturederror). Those are logged, not thrown, and the
// frame then has no water, or no flood on it: every scenario here fails on either.
function watch( page ) {

	const errors = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );
	page.on( 'console', ( m ) => {

		if ( m.type() !== 'error' || ! /^(WGSL error|WebGPU:)/.test( m.text() ) ) return;
		errors.push( m.text().slice( 0, 1500 ) );
		console.log( `[gpu] ${ m.text().slice( 0, 1500 ) }` );

	} );
	return errors;

}

for ( const [ height, label, seeded ] of [ [ 2, '2m', false ], [ 320, '320m', false ], [ 2, 'review-2m', true ], [ 320, 'review-320m', true ] ] ) test( `Tsunami ${ height } m${ seeded ? ' REVIEW (seed 7)' : '' }: the bore face is detected and drawn`, async ( { page } ) => {

	test.setTimeout( 900000 );
	const errors = watch( page );
	await test.step( 'Given the island and the Disasters panel', async () => {

		await ready( page );
		await page.getByLabel( 'Disaster type' ).selectOption( 'tsunami' );
		await page.getByLabel( 'Target location' ).selectOption( 'village' );
		// (the lead time and the height in metres sit under the tsunami panel's Advanced section, closed by default)
		await page.getByText( 'Advanced', { exact: true } ).click();
		await page.getByLabel( 'Warning lead time (s)' ).fill( '3' );
		await page.getByRole( 'spinbutton', { name: 'Intensity', exact: true } ).fill( String( height ) );

	} );
	await test.step( `When I start a ${ height } m tsunami`, async () => {

		if ( seeded ) await page.evaluate( ( h ) => window.__app.disasters.start( 'tsunami', { intensity: h, warningLead: 3, seed: 7 } ), height );
		else await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).click();
		await expect.poll( async () => ( await event( page ) )?.launched, { timeout: 120000, intervals: [ 1000 ] } ).toBe( true );
		await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();

	} );
	await test.step( 'Then the breaking front is on screen from the shore and the air, and the flood\'s edge at street level', async () => {

		const shore = await follow( page, 'shore', `${ label }-shore`, height > 100 ? 500 : 900 );
		const seen = await look( page );
		const air = await follow( page, 'air', `${ label }-air`, 700, 60000 );
		await page.waitForTimeout( 5000 );
		const shore2 = await follow( page, 'shore', `${ label }-shore-late`, 700, 60000 ).catch( () => null );
		// the flood's own edge over the land (a 2 m surge may stop short of the streets: recorded, not required)
		const street = await follow( page, 'street', `${ label }-street`, 900, height > 100 ? 120000 : 60000 ).catch( () => null );
		const after = await look( page );
		const govFree = await page.evaluate( () => ( { level: { ...window.__app.engine.resolution.level }, log: window.__govLog } ) );
		await writeFile( `${ OUT }/${ TAG }-${ label }-look.json`, JSON.stringify( { shore, air, shore2, street, seen, after, event: await event( page ), govFree }, null, 1 ) );
		expect( shore.onScreen ).toBe( true );
		expect( air.onScreen ).toBe( true );
		expect( shore.cells ).toBeGreaterThanOrEqual( 3 );
		expect( seen.coast ).toBeGreaterThan( 0 );
		expect( seen.jump ).toBeGreaterThan( height > 100 ? 30 : 0.3 );
		if ( height > 100 ) expect( street?.onScreen ).toBe( true );
		expect( errors ).toEqual( [] );

	} );

} );

// The ground the flood leaves behind (docs/disasters.md "Rendering the flood"), through the panel's own controls.
// A street point: a cell of the solver's grid on ground over STREET_BED m (behind the beach) that the flood covered
// at least STREET_COVER m deep and that now holds less than the solver's dry depth. Its wet history is read as the
// terrain shader reads it (DisasterWater.historyAt), and is 0 where the product keeps none.
const STREET_BED = 1, STREET_COVER = 0.1, DRY_DEPTH = 0.002, STAYS_WET = 10; // m, m, m, s
const street = ( page ) => page.evaluate( ( [ bedMin, cover, dry ] ) => {

	const app = window.__app, w = app.disasterWater, g = app.disasters.field.water;
	if ( ! g || w.grid !== g ) return null;
	const n = g.n, P = w.packed, T = window.__streetTrack ??= { covered: new Uint8Array( n * n ), left: null };
	let covered = 0;
	for ( let c = 0; c < n * n; c ++ ) {

		const h = P[ c * 4 + 3 ];
		if ( h > cover && P[ c * 4 ] - h > bedMin ) T.covered[ c ] = 1;
		if ( ! T.covered[ c ] ) continue;
		covered ++;
		if ( ! T.left && h <= dry ) T.left = { x: g.x + ( c % n ) * g.dx, z: g.z + Math.floor( c / n ) * g.dx };

	}
	return { covered, left: T.left };

}, [ STREET_BED, STREET_COVER, DRY_DEPTH ] );
const wetAt = ( page, at ) => page.evaluate( ( p ) => {

	const w = window.__app.disasterWater;
	return w.historyAt ? w.historyAt( p.x, p.z )[ 1 ] : 0;

}, at );

test( 'Ground the flood covered stays wet after the water has gone', async ( { page } ) => {

	test.setTimeout( 900000 );
	const errors = watch( page );
	let point = null;
	await test.step( 'Given the island, the Disasters panel and a 2 m surge set for the village', async () => {

		await ready( page );
		await page.getByLabel( 'Disaster type' ).selectOption( 'tsunami' );
		await page.getByLabel( 'Target location' ).selectOption( 'village' );
		await page.getByText( 'Advanced', { exact: true } ).click();
		await page.getByLabel( 'Warning lead time (s)' ).fill( '3' );
		await page.getByRole( 'spinbutton', { name: 'Intensity', exact: true } ).fill( '2' );

	} );
	await test.step( 'When I start it and the water leaves a street point it covered', async () => {

		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).click();
		await expect.poll( async () => ( await street( page ) )?.left ?? null, { timeout: 780000, intervals: [ 2000 ] } ).not.toBeNull();
		point = ( await street( page ) ).left;

	} );
	await test.step( 'Then the ground there is still wet ten seconds later', async () => {

		await page.waitForTimeout( STAYS_WET * 1000 );
		const wet = await wetAt( page, point );
		expect( wet, `the wet history at a street point the flood covered is above 0.5 ten seconds after the water left it (${ wet.toFixed( 2 ) } at ${ point.x }, ${ point.z })` ).toBeGreaterThan( 0.5 );

	} );
	await test.step( 'And when I restore the island the ground there is dry', async () => {

		await page.getByRole( 'button', { name: 'Restore island', exact: true } ).click();
		await expect.poll( () => wetAt( page, point ), { timeout: 15000 } ).toBe( 0 );
		expect( errors ).toEqual( [] );

	} );

} );

// The look review (LOOK in the title). The same seeded event stepped at a fixed rate with the render loop stopped
// (?bench: the bench drives the frames, src/core/Bench.js) and shot from fixed named views at fixed moments counted
// from the estimated arrival, so a change to the water's look is judged on the same water from the same places.
// PW_LOOK_MOMENTS and PW_LOOK_VIEWS (comma lists) narrow a run; PW_WDBG adds the water shader's debug views.
// The seeded 2 m event at the village: the surge reaches the beach at the arrival, runs through the streets to ground
// 7 m up by +45 s, drains from +55 s and has left the first street cells dry by +110 s (the solver's own timeline).
const LOOKS = {
	2: { moments: [ - 2, 3, 8, 20, 45, 75, 110, 150 ], views: [ 'tsunamiApproach', 'swashAbove', 'village', 'tsunamiFlood', 'tsunamiImpact', 'aerial' ] },
	320: { moments: [ - 8, - 3, 2, 10, 30 ], views: [ 'tsunamiMegaWall', 'tsunamiAir', 'tsunamiImpact', 'aerial' ] },
};
const LOOK_STEP = 0.1, LOOK_SETTLE = 16, LOOK_TIME = 15.5; // s of event time a driven frame (the solver's step); frames rendered at a view before it is shot; time of day (h)
for ( const height of [ 2, 320 ] ) test( `Tsunami ${ height } m LOOK (seed 7): fixed views at fixed moments of the flood`, async ( { page } ) => {

	test.setTimeout( 900000 );
	const errors = watch( page );
	const moments = process.env.PW_LOOK_MOMENTS ? process.env.PW_LOOK_MOMENTS.split( ',' ).map( Number ) : LOOKS[ height ].moments;
	const views = process.env.PW_LOOK_VIEWS ? process.env.PW_LOOK_VIEWS.split( ',' ) : LOOKS[ height ].views;
	const modes = ( process.env.PW_WDBG ?? '' ).split( ',' ).filter( Boolean ).map( Number );
	const reached = [];
	await test.step( 'Given the island with its frames driven at a fixed step and a seeded tsunami started', async () => {

		await page.route( 'https://fonts.googleapis.com/**', ( r ) => r.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( `/?scale=${ process.env.PW_RENDER_SCALE ?? '1' }&noAudio&bench${ process.env.PW_QUERY ?? '' }` );
		await page.waitForFunction( () => window.__bench, null, { timeout: 240000 } );
		await page.getByRole( 'button', { name: 'Click to explore', exact: true } ).click();
		// (no render loop: the guide opens a moment of game time after the overlay goes, once frames are driven, and
		// its dialog dims and covers the view)
		const skip = page.getByRole( 'button', { name: 'Skip', exact: true } );
		await expect.poll( async () => {

			await page.evaluate( () => window.__bench._frames( 6, 0.1 ) );
			return skip.isVisible();

		}, { timeout: 60000, intervals: [ 100 ] } ).toBe( true );
		await skip.click();
		await page.evaluate( ( h ) => window.__app.disasters.start( 'tsunami', { intensity: h, warningLead: 3, seed: 7 } ), height );
		await mkdir( OUT, { recursive: true } );

	} );
	await test.step( 'When the flood reaches each moment and is shot from each view', async () => {

		for ( const moment of moments ) {

			const at = await page.evaluate( async ( [ m, step ] ) => {

				const app = window.__app, field = app.disasters.field, e = field.events.get( 'tsunami' );
				if ( ! e ) return null;
				await app.engine.stop();
				// the main-thread cost of the flood's history over its last 256 bands (DisasterWater.historyMs), ms
				const cost = () => {

					const w = app.disasterWater, k = Math.min( w.historySamples ?? 0, w.historyMs?.length ?? 0 );
					if ( ! k ) return null;
					const a = Array.from( w.historyMs.subarray( 0, k ) ).sort( ( p, q ) => p - q );
					return { median: a[ k >> 1 ], worst: a[ k - 1 ], samples: w.historySamples };

				};
				const t0 = performance.now();
				let frames = 0;
				while ( field.events.has( 'tsunami' ) && e.time < e.arrival + m ) { await window.__bench._frames( 5, step ); frames += 5; }
				return { moment: m, time: e.time, arrival: e.arrival, running: field.events.has( 'tsunami' ), level: { ...app.engine.resolution.level }, frames, msPerFrame: frames ? ( performance.now() - t0 ) / frames : 0, history: cost() };

			}, [ moment, LOOK_STEP ] );
			if ( ! at?.running ) break;
			reached.push( at );
			for ( const view of views ) {

				const shoot = async ( suffix ) => {

					await page.evaluate( async ( n ) => window.__bench._frames( n, 1 / 60 ), LOOK_SETTLE );
					await page.screenshot( { path: `${ OUT }/${ TAG }-look-${ height }m-t${ moment }-${ view }${ suffix }.png` } );

				};
				await page.evaluate( ( [ v, time ] ) => { window.__view( v ); window.__app.settings.timeOfDay = time; }, [ view, LOOK_TIME ] );
				await shoot( '' );
				for ( const m of modes ) {

					await page.evaluate( ( v ) => { window.__app.waterMaterial.debugMode.value = v; }, m );
					await shoot( `-wdbg${ m }` );

				}
				if ( modes.length ) await page.evaluate( () => { window.__app.waterMaterial.debugMode.value = 0; } );

			}

		}
		await writeFile( `${ OUT }/${ TAG }-look-${ height }m.json`, JSON.stringify( { reached, views }, null, 1 ) );

	} );
	await test.step( 'Then every moment was reached while the event ran, with no shader or GPU error', async () => {

		expect( reached.map( ( r ) => r.moment ) ).toEqual( moments );
		expect( errors ).toEqual( [] );

	} );

} );
