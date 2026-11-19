import { test, expect } from '@playwright/test';
import { SCENARIO_TIMEOUT_MS } from './gameTime.js';
import { SED_ABSORB, SED_SCATTER } from '../../src/disasters/FloodLook.js';

// What leaves the flood's surface and what the camera sees from inside it (docs/disasters.md "Spray and mist" and
// "Inside the water"). The player starts each tsunami from the Disasters panel and restores the island from it.
// page.evaluate only reads telemetry (the spray ring's snapshot, the underwater pass's medium, the solver's front) and
// stages review cameras; it never starts, steers or ends an event.
// A fresh seed is drawn for every event, so the assertions are physical: where the solver has a breaking front there
// is spray on it, and the water at a camera under the flood over land has the flood's optics.
const OUT = process.env.PW_OUT ?? 'test-results';
const SCALE = process.env.PW_RENDER_SCALE ?? '0.5';
const FRONT_CELLS = 3, FRONT_CREST = 0.3; // cells, m: a front is a face over the still sea, not a speck in the drawdown
const THROW = 48; // m: spray is thrown ahead of and behind a short face, so the search reaches at least six cells
const LENS_REACH = 0.35; // m: closer than this to the surface the lens straddles it (src/post/Underwater.js)
const UNDER_HOLD = 1.5; // s under the surface before the medium is read (its 0.35 s blend has settled)

async function island( page ) {

	await page.route( 'https://fonts.googleapis.com/**', ( r ) => r.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( `/?scale=${ SCALE }&noAudio${ process.env.PW_QUERY ?? '' }` );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
	await page.getByRole( 'button', { name: 'Click to explore', exact: true } ).click();
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();

}

async function openPanel( page ) {

	if ( ! await page.getByRole( 'button', { name: 'Restore island', exact: true } ).isVisible() ) await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();

}

async function startTsunami( page, height ) {

	await openPanel( page );
	await page.getByLabel( 'Disaster type' ).selectOption( 'tsunami' );
	const advanced = page.locator( 'details.disaster-advanced:not([open]) > summary' );
	if ( await advanced.isVisible() ) await advanced.click();
	await page.getByLabel( 'Target location' ).selectOption( 'pier' );
	await page.getByRole( 'spinbutton', { name: 'Intensity', exact: true } ).fill( String( height ) );
	await page.getByLabel( 'Warning lead time (s)' ).fill( '3' );
	await page.getByLabel( 'Duration (s)' ).fill( '90' );
	await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).click();
	await expect( page.getByRole( 'alert', { name: 'Disaster validation' } ) ).toBeEmpty();
	// the event's seed goes to the test log and the report only (no panel or HUD shows it): a red run names its seed
	await expect.poll( () => page.evaluate( () => window.__app.disasters.field.events.size ) ).toBeGreaterThan( 0 );
	const seed = await page.evaluate( () => window.__app.disasters.runSeed );
	test.info().annotations.push( { type: 'disaster-seed', description: String( seed ) } );
	console.log( `[disaster-seed] ${ test.info().title.slice( 0, 40 ) }: ${ seed }` );

}

async function restore( page ) {

	await openPanel( page );
	await page.getByRole( 'button', { name: 'Restore island', exact: true } ).click();

}

// Evidence only: the frame with the Disasters panel closed (it covers the left third).
async function shot( page, name ) {

	const close = page.getByRole( 'button', { name: 'Close disaster controls', exact: true } );
	if ( await close.isVisible() ) await close.click();
	await page.screenshot( { path: `${ OUT }/${ name }.png` } );

}

// Evidence only: the same frame with the particle sprites hidden, to tell what the spray adds from the water's own
// white. The sprites are shown again straight after.
async function shotWithoutSpray( page, name ) {

	await page.evaluate( () => { window.__app.spray.mesh.visible = false; } );
	await page.waitForTimeout( 500 );
	await page.screenshot( { path: `${ OUT }/${ name }.png` } );
	await page.evaluate( () => { window.__app.spray.mesh.visible = true; } );

}

// The spray ring as it is now: the live particles a flood made, and how many of them lie on the front. With `kind`
// the review camera is staged on the front first (the emitter works around the camera, as the player's view does).
const sprayCensus = ( page, kind ) => page.evaluate( async ( [ k, reach ] ) => {

	const f = k ? window.__viewFront( k ) : null;
	const s = await window.__app.spray.snapshot();
	const radius = f ? Math.max( f.length, reach ) : 0;
	let live = 0, onFront = 0;
	for ( let i = 0; i < s.count; i ++ ) {

		const o = i * 4, life = s.info[ o + 1 ];
		if ( ! ( life > 0 && s.pos[ o + 3 ] < life && s.info[ o + 3 ] >= s.floodTag ) ) continue;
		live ++;
		if ( f && Math.hypot( s.pos[ o ] - f.x, s.pos[ o + 2 ] - f.z ) <= radius ) onFront ++;

	}
	return { time: s.time, live, onFront, radius, front: f ? { x: f.x, z: f.z, length: f.length, cells: f.cells, crest: f.crest } : null };

}, [ kind, THROW ] );

test( 'A breaking tsunami front throws spray', async ( { page } ) => {

	test.setTimeout( SCENARIO_TIMEOUT_MS );
	const errors = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );

	await test.step( 'Given the island under a calm sea, with no flood spray in the air', async () => {

		await island( page );
		const calm = await sprayCensus( page, null );
		expect( calm.live, 'live flood-tagged particles before any event' ).toBe( 0 );

	} );

	await test.step( 'When I start a 10 m tsunami from the Disasters panel', async () => {

		await startTsunami( page, 10 );

	} );

	await test.step( 'Then spray flies from the breaking front once it is in the shore band', async () => {

		// The crest is ashore (the solver's own flag) and a face stands in the shore band. The largest breaking run is
		// often a few cells of the drawdown, a minute before the wave: a census staged on one of those said nothing
		// about the front the player watches come in.
		const facing = ( f ) => !! f && f.cells >= FRONT_CELLS && f.crest >= FRONT_CREST;
		await expect.poll( async () => {

			if ( ! await page.evaluate( () => !! window.__app.disasters.field.events.get( 'tsunami' )?.coastReached ) ) return false;
			if ( ! facing( await page.evaluate( () => window.__viewFront( 'shore' ) ) ) ) return false;
			await page.waitForTimeout( 300 );
			return page.evaluate( () => window.__frontOnScreen( 'shore' ) );

		}, { timeout: 600000, intervals: [ 500 ] } ).toBe( true );
		// the spray takes a moment to be thrown; the census is taken on a face that still stands
		await page.waitForTimeout( 2500 );
		let census = null;
		await expect.poll( async () => {

			census = await sprayCensus( page, 'shore' );
			return facing( census.front );

		}, { timeout: 120000, intervals: [ 1000 ] } ).toBe( true );
		await shot( page, 'front-spray-shore' );
		await shotWithoutSpray( page, 'front-spray-shore-bare' );
		// evidence only: the same front from the air behind it
		if ( await page.evaluate( () => window.__viewFront( 'air' ) ) ) {

			await page.waitForTimeout( 1500 );
			await shot( page, 'front-spray-air' );
			await shotWithoutSpray( page, 'front-spray-air-bare' );

		}
		expect( census.front, 'the solver still has a breaking front in the shore band' ).not.toBeNull();
		const at = `within ${ census.radius.toFixed( 0 ) } m of the front at ${ census.front.x.toFixed( 0 ) }, ${ census.front.z.toFixed( 0 ) } (${ census.front.cells } cells, crest ${ census.front.crest.toFixed( 1 ) } m)`;
		expect( census.onFront, `flood-tagged live particles on the front are more than 0: ${ census.onFront } ${ at }, ${ census.live } live anywhere` ).toBeGreaterThan( 0 );

	} );

	await test.step( 'And ten seconds after I restore the island no flood spray is left', async () => {

		await restore( page );
		const from = ( await sprayCensus( page, null ) ).time;
		let last = null;
		await expect.poll( async () => {

			last = await sprayCensus( page, null );
			return last.time - from;

		}, { timeout: 120000, intervals: [ 1000 ] } ).toBeGreaterThanOrEqual( 10 );
		expect( last.live, `live flood-tagged particles ${ ( last.time - from ).toFixed( 1 ) } s after the restore` ).toBe( 0 );
		expect( errors, 'page errors' ).toEqual( [] );

	} );

} );

test( 'A camera inside the flood is in dirty water', async ( { page } ) => {

	test.setTimeout( SCENARIO_TIMEOUT_MS );
	const errors = [];
	page.on( 'pageerror', ( e ) => errors.push( e.message ) );
	const sediment = SED_ABSORB.map( ( a, i ) => a + SED_SCATTER[ i ] ); // 1/m per colour channel

	await test.step( 'Given the player standing at the boardwalk under a calm sea', async () => {

		await island( page );

	} );

	await test.step( 'When I start a 25 m tsunami from the Disasters panel and it reaches me', async () => {

		await startTsunami( page, 25 );

	} );

	await test.step( 'Then with the camera under the flood over land the water at the lens has the flood\'s optics', async () => {

		// evidence only: the frame as the flood's edge comes within 30 m of the camera
		await expect.poll( () => page.evaluate( () => {

			const a = window.__app, f = a.disasters.field, c = a.camera.position;
			for ( let k = 0; k < 8; k ++ ) {

				const x = c.x + Math.cos( k * Math.PI / 4 ) * 30, z = c.z + Math.sin( k * Math.PI / 4 ) * 30, ground = a.terrainData.heightAt( x, z );
				if ( ground > 0.5 && f.waterAt( x, z ) - ground > 0.3 ) return true;

			}
			return c.y < ( a.cameraWaterHeight ?? 0 );

		} ), { timeout: 600000, intervals: [ 200 ] } ).toBe( true );
		await shot( page, 'flood-arrives' );
		// The camera is staged 1 m under the flood's surface over land near where the player stood, once the flood
		// stands 3 m deep there (the free camera: where the player's own camera ends up depends on the event's seed,
		// and in some events it never goes under). The medium is read after its blend has settled, in a frame where
		// the camera is still under.
		let caught = null;
		await expect.poll( async () => {

			const at = await page.evaluate( () => {

				const a = window.__app, f = a.disasters.field, o = a.player.position;
				for ( let r = 0; r <= 240; r += 20 ) for ( let k = 0; k < 12; k ++ ) {

					const x = o.x + Math.cos( k * Math.PI / 6 ) * r, z = o.z + Math.sin( k * Math.PI / 6 ) * r;
					const ground = a.terrainData.heightAt( x, z ), water = f.waterAt( x, z );
					if ( ! ( ground > 0.5 && water - ground > 3 ) ) continue;
					a.setFreeCam( true );
					a.reviewPose = 'inside-flood';
					a.fly.setPose( a.camera.position.clone().set( x, water - 1, z ), 0, 0.3 );
					a.fly.velocity.set( 0, 0, 0 );
					return { x, z };

				}
				return null;

			} );
			if ( ! at ) return false;
			await page.waitForTimeout( UNDER_HOLD * 1000 );
			caught = await page.evaluate( ( reach ) => {

				const a = window.__app, c = a.camera.position, water = a.cameraWaterHeight ?? 0, ground = a.terrainData.heightAt( c.x, c.z );
				return c.y < water - reach && ground > 0.5 ? { depth: water - c.y, ground, water, state: a.underwater.mediumState() } : null;

			}, LENS_REACH );
			return !! caught;

		}, { timeout: 900000, intervals: [ 1000 ] } ).toBe( true );
		await shot( page, 'inside-flood' );
		// evidence only: the same water from just under its surface, looking up
		await page.evaluate( () => {

			const a = window.__app, c = a.camera.position;
			a.fly.setPose( c.clone().set( c.x, ( a.cameraWaterHeight ?? c.y ) - 0.45, c.z ), 0, 0.5 );

		} );
		await page.waitForTimeout( 800 );
		await shot( page, 'inside-flood-shallow' );
		const got = caught.state.extinction;
		const off = Math.max( ...got.map( ( v, i ) => Math.abs( v - sediment[ i ] ) / sediment[ i ] ) );
		expect( off, `the medium's extinction at the camera is within 10 % of the sediment extinction: ${ got.map( ( v ) => v.toFixed( 2 ) ) } /m against ${ sediment.map( ( v ) => v.toFixed( 2 ) ) } /m, ${ caught.depth.toFixed( 1 ) } m under the surface over ground at ${ caught.ground.toFixed( 1 ) } m` ).toBeLessThan( 0.10 );

	} );

	await test.step( 'And after I restore the island a dive off the beach is in the sea\'s own water again', async () => {

		await restore( page );
		// the named underwater review camera, 2.5 m under the sea off the beach
		await page.evaluate( () => window.__view( 'underwater' ) );
		await page.waitForTimeout( 3000 );
		const dive = await page.evaluate( ( reach ) => {

			const a = window.__app, c = a.camera.position;
			return { under: c.y < ( a.cameraWaterHeight ?? 0 ) - reach, state: a.underwater.mediumState() };

		}, LENS_REACH );
		await shot( page, 'dive-after-restore' );
		expect( dive.under, 'the review camera is under the sea' ).toBe( true );
		const sea = dive.state.seaExtinction;
		const off = Math.max( ...dive.state.extinction.map( ( v, i ) => Math.abs( v - sea[ i ] ) / sea[ i ] ) );
		expect( off, `the dive's extinction ${ dive.state.extinction.map( ( v ) => v.toFixed( 3 ) ) } /m against the sea's ${ sea.map( ( v ) => v.toFixed( 3 ) ) } /m` ).toBeLessThan( 0.01 );
		expect( errors, 'page errors' ).toEqual( [] );

	} );

} );
