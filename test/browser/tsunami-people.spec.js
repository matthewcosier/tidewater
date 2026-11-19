import { test, expect } from '@playwright/test';
import { SCENARIO_TIMEOUT_MS } from './gameTime.js';
const OUT = process.env.PW_OUT || 'test-results';

async function ready( page ) {

	await page.route( 'https://fonts.googleapis.com/**', r => r.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=.5&noAudio' );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
	await page.keyboard.press( 'Enter' );
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
	await expect.poll( () => page.evaluate( () => window.__app.beach.people.length ), { timeout: 30000 } ).toBeGreaterThan( 15 );

}

async function startOnScreen( page, capture ) {

	await expect( page.getByRole( 'button', { name: 'Start disaster', exact: true } ) ).toBeInViewport( { ratio: 1 } );
	await expect( page.getByRole( 'button', { name: 'Restore island', exact: true } ) ).toBeInViewport( { ratio: 1 } );
	if ( capture ) await page.screenshot( { path: `${ OUT }/${ capture }` } );

}

async function openTsunami( page, phone = false ) {

	await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
	await page.getByLabel( 'Disaster type' ).selectOption( 'tsunami' );
	// Advanced is closed by default (decided 2026-10-05) and opens from the keyboard (Enter on its summary).
	const advanced = page.locator( 'details.disaster-advanced' );
	await expect( advanced ).not.toHaveAttribute( 'open', /.*/ );
	await startOnScreen( page, phone && 'tsunami-panel-closed-1440.png' );
	if ( phone ) {

		await page.setViewportSize( { width: 390, height: 844 } );
		await startOnScreen( page, 'tsunami-panel-closed-390.png' );
		await page.setViewportSize( { width: 1440, height: 900 } );

	}
	await advanced.locator( 'summary' ).focus();
	await page.keyboard.press( 'Enter' );
	await expect( advanced ).toHaveAttribute( 'open', /.*/ );

}

test( 'The tsunami panel sets the wave height by slider and by preset, and the field gets that crest', async ( { page } ) => {

	test.setTimeout( 300000 );
	const value = page.getByRole( 'status', { name: 'Wave height value' } );
	const crest = page.getByRole( 'spinbutton', { name: 'Intensity', exact: true } );
	await test.step( 'Given the island and the Disasters panel set to Tsunami', async () => {

		await ready( page );
		await openTsunami( page, true );
		await expect( page.getByRole( 'slider', { name: 'Wave height' } ) ).toBeVisible();

	} );
	await test.step( 'When I push the height slider to each end with the keyboard', async () => {

		const slider = page.getByRole( 'slider', { name: 'Wave height' } );
		await slider.focus();
		await page.keyboard.press( 'End' );
		await expect( value ).toHaveText( '3,000 m' );
		await expect( crest ).toHaveValue( '3000' );
		await page.keyboard.press( 'Home' );
		await expect( value ).toHaveText( '1.0 m' );
		await expect( crest ).toHaveValue( '1' );

	} );
	await test.step( 'And I pick the Catastrophic preset and a short warning', async () => {

		await page.getByRole( 'button', { name: /Catastrophic/ } ).click();
		await expect( page.getByRole( 'button', { name: /Catastrophic/ } ) ).toHaveAttribute( 'aria-pressed', 'true' );
		await expect( value ).toHaveText( '40 m' );
		await page.getByLabel( 'Warning', { exact: true } ).selectOption( 'short' );
		await expect( page.getByLabel( 'Warning lead time (s)' ) ).toHaveValue( '20' );
		await expect( page.getByRole( 'status', { name: 'Tsunami estimate' } ) ).toContainText( 'Run-up about' );
		await page.screenshot( { path: `${ OUT }/tsunami-panel.png` } );

	} );
	await test.step( 'Then Start hands the field a 40 m crest with a 20 s lead and the readout matches its arrival', async () => {

		const planned = Number( await page.getByRole( 'status', { name: 'Tsunami estimate' } ).getAttribute( 'data-arrival' ) );
		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).click();
		await expect( page.getByRole( 'alert', { name: 'Disaster validation' } ) ).toBeEmpty();
		const e = await page.evaluate( () => { const e = window.__app.disasters.field.events.get( 'tsunami' ); return { H: e.intensity, lead: e.warning, arrival: e.arrival }; } );
		expect( e.H ).toBe( 40 );
		expect( e.lead ).toBe( 20 );
		expect( Math.abs( e.arrival - planned ) ).toBeLessThan( 0.1 );

	} );

} );

// Flood height times speed at a rig's pelvis, m²/s (FloodHazard.js): what pins and pulls on a body.
const HU = `( F, rd, flow ) => { F.sample( rd.focus.x, rd.focus.y, rd.focus.z, flow ); return Math.max( 0, flow.height - F.terrain( rd.focus.x, rd.focus.z ) ) * Math.hypot( flow.ux, flow.uz ); }`;

test( 'A 2 m surge with a 20 s warning sweeps a wader downstream and catches the people who ignored the warning', async ( { page } ) => {

	test.setTimeout( 420000 );
	let staged;
	await test.step( 'Given a wader who films the wave in the run-up and a dawdler on the sand in its path', async () => {

		await ready( page );
		await openTsunami( page );
		await page.getByLabel( 'Target location' ).selectOption( 'pier' );
		staged = await page.evaluate( () => {

			const A = window.__app, B = A.beach, T = A.terrainData;
			const wader = B.people.find( p => p.role === 'wade' ), sand = B.people.find( p => p.role === 'camp' );
			let seed = null;
			for ( let s = 1; s < 200000 && seed === null; s ++ ) {

				const w = A.disasters.ignorerOf( s, wader.id ), d = A.disasters.ignorerOf( s, sand.id );
				if ( w?.ignore === 'film' && d?.ignore === 'dawdle' && d.lead < - 2 ) seed = s;

			}
			if ( seed === null ) return null;
			A.disasters.nextSeed = seed;
			// the main beach runs along x with the sea to +z (Beach.js deep())
			const x = wader.home.x;
			let zs = wader.home.z;
			while ( T.heightAt( x + 3, zs ) < 0.3 ) zs -= 0.25;
			let zw = zs;
			while ( T.heightAt( x, zw ) > - 0.5 ) zw += 0.25;
			const w = B.place( wader.id, x, zw ), d = B.place( sand.id, x + 3, zs );
			return { seed, wader: wader.id, dawdler: sand.id, w, d, lead: A.disasters.ignorerOf( seed, sand.id ).lead };

		} );
		console.log( `tsunami-people staged: ${ JSON.stringify( staged ) }` );
		expect( staged, 'no seed in 200,000 has the wader filming and the camper dawdling past the crest' ).not.toBeNull();
		expect( staged.w.y, 'the wader stands in the run-up, under the sea' ).toBeLessThan( - 0.4 );
		expect( staged.d.y, 'the dawdler stands on sand just above the sea' ).toBeGreaterThan( 0.25 );

	} );
	await test.step( 'When I start a Surge with a short warning from the panel', async () => {

		await page.getByRole( 'button', { name: /Surge/ } ).click();
		await page.getByLabel( 'Warning', { exact: true } ).selectOption( 'short' );
		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).click();
		await expect( page.getByRole( 'alert', { name: 'Disaster validation' } ) ).toBeEmpty();
		await page.getByRole( 'button', { name: 'Close disaster controls' } ).click();

	} );
	await test.step( 'And the warning is called out once per group, its bubbles clear of each other', async () => {

		// Speech.js: one voice per line within 15 m and 4 s; bubbles that would overlap stack
		// a bubble shows only for people within 24 m of the camera, so a warning may go unsaid on screen
		await page.waitForFunction( () => window.__app.people.speech.log.some( l => l.key === 'disaster-warning' ), null, { timeout: 8000 } ).catch( () => {} );
		await page.waitForTimeout( 300 );
		const said = await page.evaluate( () => {

			const A = window.__app, live = A.people.speech.live.filter( b => b.key === 'disaster-warning' && b.who.world );
			const near = [];
			for ( let i = 0; i < live.length; i ++ ) for ( let j = i + 1; j < live.length; j ++ ) {

				const d = Math.hypot( live[ i ].who.world.x - live[ j ].who.world.x, live[ i ].who.world.z - live[ j ].who.world.z );
				if ( live[ i ].text === live[ j ].text && d < 15 ) near.push( [ live[ i ].who.id, live[ j ].who.id, + d.toFixed( 1 ) ] );

			}
			const rects = [ ...document.querySelectorAll( '.pp-bubble' ) ].filter( e => e.style.visibility !== 'hidden' ).map( e => e.getBoundingClientRect() );
			const overlaps = [];
			for ( let i = 0; i < rects.length; i ++ ) for ( let j = i + 1; j < rects.length; j ++ ) {

				const a = rects[ i ], b = rects[ j ];
				if ( a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top ) overlaps.push( [ i, j ] );

			}
			return { live: live.length, near, shown: rects.length, overlaps };

		} );
		console.log( `tsunami-people warning bubbles: ${ JSON.stringify( said ) }` );
		await page.screenshot( { path: `${ OUT }/tsunami-warning-bubbles.png` } );
		expect( said.near, 'two people within 15 m called out the same warning line' ).toEqual( [] );
		expect( said.overlaps, 'two speech bubbles overlap on screen' ).toEqual( [] );

	} );
	let seen;
	await test.step( 'Then the wader is swept downstream over their h*u line and the dawdler is caught', async () => {

		seen = await page.evaluate( async ( { w, d, HU } ) => {

			const A = window.__app, F = A.disasters.field, flow = {}, huAt = eval( HU );
			const W = A.beach.people.find( p => p.id === w ), D = A.beach.people.find( p => p.id === d );
			const out = { swept: null, pinned: null, caught: null, maxT: 0, frames: 0, wall: 0 };
			const t0 = performance.now(), end = t0 + 300000;
			let hit = null;
			while ( performance.now() < end ) {

				await new Promise( requestAnimationFrame );
				out.frames ++;
				const e = F.events.get( 'tsunami' );
				if ( ! e ) break;
				out.maxT = e.time;
				const rd = W.knock?.rag?.rd;
				// pinned: the flow's h*u at the body is over this person's line (Disasters.people)
				if ( rd?.pinned && ! out.pinned ) out.pinned = { hu: huAt( F, rd, flow ), t: e.time };
				if ( ! hit && rd?.phase === 'sim' ) {

					F.sample( rd.focus.x, rd.focus.y, rd.focus.z, flow );
					const u = Math.hypot( flow.ux, flow.uz );
					if ( u > 0.3 ) hit = { x: rd.focus.x, z: rd.focus.z, ux: flow.ux / u, uz: flow.uz / u, u, t: e.time };

				}
				if ( hit && ! out.swept && e.time > hit.t + 3 ) {

					const at = W.knock?.rag?.rd?.focus ?? W.world;
					out.swept = { current: hit.u, downstream: ( at.x - hit.x ) * hit.ux + ( at.z - hit.z ) * hit.uz, t: hit.t };

				}
				const rdD = D.knock?.rag?.rd;
				if ( D.knock && ! out.caught ) out.caught = { kind: D.evacuation?.ignore ?? null, t: e.time, hu: rdD ? huAt( F, rdD, flow ) : null };
				if ( out.swept && out.caught ) break;

			}
			out.wall = ( performance.now() - t0 ) / 1000;
			out.ignorers = A.beach.people.filter( p => p.evacuation?.ignore ).map( p => p.evacuation.ignore );
			return out;

		}, { w: staged.wader, d: staged.dawdler, HU } );
		console.log( `tsunami-people: ${ JSON.stringify( seen ) } fps under load ${ ( seen.frames / seen.wall ).toFixed( 1 ) }` );
		await page.screenshot( { path: `${ OUT }/tsunami-swept.png` } );
		expect( seen.ignorers.length, 'one beach person in five ignores the warning' ).toBeGreaterThanOrEqual( 3 );
		expect( seen.swept, 'the wader in the run-up was never carried by the flow' ).not.toBeNull();
		expect( seen.pinned, 'the flow at the wader never went over their h*u line' ).not.toBeNull();
		// carried at least half the local flow speed over the 3 s after the knock (a free body is advected at it)
		expect( seen.swept.downstream, `the swept wader travels with the ${ seen.swept.current.toFixed( 2 ) } m/s flow` ).toBeGreaterThan( Math.max( 0.5, 0.5 * seen.swept.current * 3 ) );
		expect( seen.caught, 'the dawdler on the sand was never caught' ).not.toBeNull();
		expect( seen.caught.kind ).toBe( 'dawdle' );
		// review capture through the 'swept' view (DebugViews.js): the camera frames a knocked body
		const framed = await page.evaluate( () => window.__view( 'swept' ) );
		console.log( `tsunami-people swept view: ${ JSON.stringify( framed ) }` );
		expect( framed.view, `the swept view found no knocked body: ${ JSON.stringify( framed ) }` ).toBe( 'swept' );
		await page.waitForTimeout( 400 );
		await page.screenshot( { path: `${ OUT }/tsunami-swept-review.png` } );

	} );

} );

test( 'A person knocked beside a pier pile grabs it and lets go as the flow rises past their grip', async ( { page } ) => {

	test.setTimeout( SCENARIO_TIMEOUT_MS );
	let staged;
	await test.step( 'Given a person who films the wave standing in the shallows just upstream of a pier pile', async () => {

		await ready( page );
		await openTsunami( page );
		await page.getByLabel( 'Target location' ).selectOption( 'pier' );
		staged = await page.evaluate( () => {

			const A = window.__app, B = A.beach, T = A.terrainData, who = B.people.find( p => p.role === 'camp' );
			const piles = A.colliders.cylinders.filter( c => c.tag === 'pile' && T.heightAt( c.x, c.z ) < - 0.3 && T.heightAt( c.x, c.z ) > - 0.9 );
			if ( ! piles.length ) return { piles: 0 };
			const pile = piles[ 0 ], off = pile.radius + 2.5; // m off the pile's surface, upstream
			const best = { dx: - 0.82, dz: 0.58 }; // unit vector against the knocking flow (seed 15, above)
			let seed = null;
			for ( let s = 1; s < 20000 && seed === null; s ++ ) if ( A.disasters.ignorerOf( s, who.id )?.ignore === 'film' ) seed = s;
			A.disasters.nextSeed = seed;
			const at = B.place( who.id, pile.x + best.dx * off, pile.z + best.dz * off );
			return { seed, id: who.id, piles: piles.length, pile: { x: pile.x, z: pile.z, r: pile.radius, yMin: pile.yMin, yMax: pile.yMax }, at };

		} );
		console.log( `tsunami-cling staged: ${ JSON.stringify( staged ) }` );
		expect( staged.piles, 'no pier pile stands in 0.3 to 0.9 m of water' ).toBeGreaterThan( 0 );
		expect( staged.seed ).not.toBeNull();

	} );
	await test.step( 'When I start a Severe tsunami with a short warning from the panel', async () => {

		await page.getByRole( 'button', { name: /Severe/ } ).click();
		await page.getByLabel( 'Warning', { exact: true } ).selectOption( 'short' );
		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).click();
		await expect( page.getByRole( 'alert', { name: 'Disaster validation' } ) ).toBeEmpty();
		await page.getByRole( 'button', { name: 'Close disaster controls' } ).click();

	} );
	await test.step( 'Then they are knocked, hold the pile, and let go once the flow rises past their grip', async () => {

		const watch = async ( phase ) => page.evaluate( async ( { id, HU, phase, pile } ) => {

			const A = window.__app, F = A.disasters.field, flow = {}, huAt = eval( HU ), P = A.beach.people.find( p => p.id === id );
			const out = window.__cling ??= { knock: null, on: null, off: null, maxT: 0 };
			const end = performance.now() + 600000;
			while ( performance.now() < end ) {

				await new Promise( requestAnimationFrame );
				const e = F.events.get( 'tsunami' );
				if ( ! e ) break;
				out.maxT = e.time;
				if ( ! out.knock && e.time > e.arrival + 40 ) break;
				const rd = P.knock?.rag?.rd;
				if ( rd && ! out.knock ) out.knock = { t: e.time, hu: huAt( F, rd, flow ) };
				if ( rd ) {

					const hu = huAt( F, rd, flow ), gap = Math.hypot( rd.focus.x - pile.x, rd.focus.z - pile.z ) - pile.r;
					out.maxHu = Math.max( out.maxHu ?? 0, + hu.toFixed( 2 ) );
					if ( rd.pinned ) out.pinnedFrames = ( out.pinnedFrames ?? 0 ) + 1;
					if ( rd.pinned && gap < ( out.pinnedGap?.gap ?? 1e9 ) ) out.pinnedGap = { gap: + gap.toFixed( 2 ), hu: + hu.toFixed( 2 ), depth: + ( flow.height - F.terrain( rd.focus.x, rd.focus.z ) ).toFixed( 2 ), t: + e.time.toFixed( 1 ) };
					if ( gap < ( out.minGap?.gap ?? 1e9 ) ) out.minGap = { gap: + gap.toFixed( 2 ), hu: + hu.toFixed( 2 ), pinned: !! rd.pinned, t: + e.time.toFixed( 1 ) };
					out.track ??= [];
					if ( out.track.length < 600 && e.time - ( out.track.at( - 1 )?.t ?? - 1 ) >= 0.1 ) out.track.push( { t: + e.time.toFixed( 2 ), x: + rd.focus.x.toFixed( 2 ), z: + rd.focus.z.toFixed( 2 ), gap: + gap.toFixed( 2 ), hu: + hu.toFixed( 2 ), pinned: !! rd.pinned } );

				}
				if ( rd?.cling && ! out.on ) {

					out.on = { tag: rd.cling.hold?.tag ?? null, hu: huAt( F, rd, flow ), t: e.time };
					if ( phase === 'grab' ) break;

				} else if ( out.on && ! out.off && ! rd?.cling ) {

					out.off = { hu: rd ? huAt( F, rd, flow ) : null, pinned: !! rd?.pinned, t: e.time };
					break;

				}
				if ( out.knock && e.time > out.knock.t + 40 ) break;

			}
			return out;

		}, { id: staged.id, HU, phase, pile: staged.pile } );
		let seen = await watch( 'grab' );
		await test.info().attach( 'cling-track', { body: JSON.stringify( { staged, track: seen.track ?? [] } ), contentType: 'application/json' } );
		console.log( `tsunami-cling grab: ${ JSON.stringify( { ...seen, track: seen.track?.length } ) }` );
		expect( seen.knock, 'the wave never knocked them' ).not.toBeNull();
		expect( seen.on, 'they never grabbed a hold' ).not.toBeNull();
		expect( seen.on.tag ).toBe( 'pile' );
		// review capture through the 'swept' view, which prefers a body that clings
		const framed = await page.evaluate( () => window.__view( 'swept' ) );
		console.log( `tsunami-cling view: ${ JSON.stringify( framed ) }` );
		await page.waitForTimeout( 400 );
		await page.screenshot( { path: `${ OUT }/tsunami-cling.png` } );
		seen = await watch( 'release' );
		console.log( `tsunami-cling release: ${ JSON.stringify( seen ) }` );
		expect( seen.off, 'they never let go' ).not.toBeNull();
		expect( seen.off.hu, `they let go at h*u ${ seen.off.hu?.toFixed( 2 ) } m²/s, not above the ${ seen.on.hu.toFixed( 2 ) } m²/s they grabbed at` ).toBeGreaterThan( seen.on.hu );

	} );

} );
