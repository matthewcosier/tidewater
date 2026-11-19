import { test, expect } from '@playwright/test';

// Given/When/Then for the two-ship service (docs/ferry.md, Two ships): the Tidewater Spirit
// from Tidewater and the Sealion Spirit from Joey on the same clock. Only the free camera (the
// F-key camera a player flies) is posed from the test; the ships are the timetable's and the
// autopilot's. ?ferryTimetable=short shortens only the waits at the berths.
const OUT = process.env.PW_OUT || 'test-results';
const board = page => page.getByRole( 'status', { name: 'Ferry departures' } );
const row = ( page, ship ) => board( page ).locator( `.fy-board-row[data-ship="${ ship }"]` );

async function openIsland( page, query = '' ) {

	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( `/?scale=0.5&noAudio${ query }` );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();

}

// Look only: the free camera at `eye` looking at `at` (world [ x, y, z ]).
const look = ( page, eye, at ) => page.evaluate( ( [ eye, at ] ) => {

	const app = window.__app, V = app.camera.position.constructor;
	app.setFreeCam( true );
	app.fly.setPose( new V( ...eye ), Math.atan2( eye[ 0 ] - at[ 0 ], eye[ 2 ] - at[ 2 ] ), Math.atan2( at[ 1 ] - eye[ 1 ], Math.hypot( at[ 0 ] - eye[ 0 ], at[ 2 ] - eye[ 2 ] ) ) );
	app.fly.velocity.set( 0, 0, 0 );

}, [ eye, at ] );

// Both ships' state as the game publishes it: the Spirit's on the helm readout, the sister's on her
// telemetry element (Ferry.js buildSisterHud).
const ships = page => page.evaluate( () => [ document.querySelector( '[aria-label="Ferry helm"]' ), document.querySelector( '.fy-telemetry[data-ship="Sealion Spirit"]' ) ]
	.map( el => ( { x: + el.dataset.x, z: + el.dataset.z, yaw: + el.dataset.yaw, lines: el.dataset.lines, ramp: + el.dataset.ramp, berth: el.dataset.berth } ) ) );

const timetable = page => page.evaluate( () => window.__app.fleet.map( f => {

	const traffic = ( f.lead || f ).traffic, cars = traffic?.state() || [];
	return {
		ship: f.name, t: + f.service.time.toFixed( 1 ), phase: f.service.phase, leg: f.service.pilot.leg, wait: + f.service.wait.toFixed( 1 ),
		ready: f.service.ready, partner: + f.service.partner.toFixed( 1 ), moored: f.ship.moored, casting: !! f.castingOff, ramp: + f.ramp.toFixed( 2 ),
		cars: !! traffic?.holding( f ), walkers: !! f.crowd?.holding(), flood: f.flood, driven: !! f.driven,
		driving: cars.filter( c => c.ship === f.name && c.state !== 'parked' && c.state !== 'queue' ).map( c => `${ c.id }:${ c.state }${ c.by ? '/' + c.by : '' } ${ c.v }@${ c.local.map( Math.round ).join( ',' ) }` ),
		queue: cars.filter( c => c.state === 'queue' && c.terminal === f.at?.terminal?.name ).length,
	};

} ) );

async function untilGame( page, probe, budget, label ) {

	const t0 = ( await timetable( page ) )[ 0 ].t, wallCap = Date.now() + 600_000;
	let logged = 0, loggedAt = Date.now();
	for ( ;; ) {

		const value = await probe(), tt = await timetable( page ), elapsed = tt[ 0 ].t - t0;
		if ( value ) return { value, elapsed };
		if ( elapsed - logged >= 10 || Date.now() - loggedAt > 30_000 ) { logged = elapsed; loggedAt = Date.now(); console.log( `${ label } +${ elapsed.toFixed( 1 ) } s`, JSON.stringify( tt ) ); }
		if ( elapsed > budget || Date.now() > wallCap ) throw new Error( `${ label }: not within ${ budget } game s (${ elapsed.toFixed( 1 ) } s): ${ JSON.stringify( tt ) }` );
		await page.waitForTimeout( 250 );

	}

}

test.describe( 'Two ferries on the strait', () => {

	test( 'At the Tidewater terminal one ship loads while the board shows her sister at Joey, and mid-strait they pass port to port', async ( { page } ) => {

		test.setTimeout( 600_000 );
		// Given the island with both ships on their timetable
		await openIsland( page, '&ferryTimetable=short' );
		const berth = await page.evaluate( () => ( { ...window.__app.terminal.berth(), name: window.__app.terminal.name } ) );
		// When the player looks over the Tidewater terminal's berth
		await look( page, [ berth.x + 70, 32, berth.z - 60 ], [ berth.x, 4, berth.z + 10 ] );
		// Then the Spirit loads here while the board shows the Sealion Spirit loading at Joey for Tidewater
		await untilGame( page, async () => ( await ships( page ) ).every( s => s.ramp >= 1 ), 120, 'both ramps down' );
		const [ spirit, sister ] = await ships( page );
		expect( spirit.berth, 'the Spirit lies at Tidewater' ).toBe( berth.name );
		expect( sister.berth, 'her sister lies at Joey' ).not.toBe( spirit.berth );
		await expect( row( page, 'Tidewater Spirit' ) ).toContainText( 'Joey Island' );
		await expect( row( page, 'Sealion Spirit' ) ).toContainText( 'Tidewater' );
		await page.waitForTimeout( 1500 );
		await page.screenshot( { path: `${ OUT }/fleet-terminal.png` } );

		// When the timetable sends both out
		const cast = await untilGame( page, async () => ( await ships( page ) ).every( s => s.lines === 'off' ), 120, 'both cast off' );
		console.log( `both cast off ${ cast.elapsed.toFixed( 1 ) } game s after the board read` );
		// Then mid-strait they pass port to port (her +X is port, FerryShip) no closer than 100 m
		let closest = { d: Infinity }, framed = false;
		const sailed = ( await timetable( page ) )[ 0 ].t, wallCap = Date.now() + 600_000;
		while ( ( await timetable( page ) )[ 0 ].t - sailed < 360 && Date.now() < wallCap ) {

			const [ a, b ] = await ships( page ), d = Math.hypot( a.x - b.x, a.z - b.z );
			const port = ( s, o ) => ( o.x - s.x ) * Math.cos( s.yaw ) - ( o.z - s.z ) * Math.sin( s.yaw );
			if ( d < closest.d ) closest = { d, a: port( a, b ), b: port( b, a ) };
			if ( ! framed && d < 260 ) {

				framed = true;
				await look( page, [ ( a.x + b.x ) / 2 + 120, 110, ( a.z + b.z ) / 2 - 160 ], [ ( a.x + b.x ) / 2, 0, ( a.z + b.z ) / 2 ] );

			}
			// at the closest pass, just after it (R2: they passed about 195 m apart, so a 190 m trigger never fired)
			if ( framed && ! closest.shot && d > closest.d + 2 ) { closest.shot = true; await page.screenshot( { path: `${ OUT }/fleet-passing.png` } ); }
			if ( closest.d < 260 && d > closest.d + 120 ) break;
			await page.waitForTimeout( 250 );

		}
		console.log( `closest pass ${ closest.d.toFixed( 1 ) } m, the Sealion Spirit ${ closest.a?.toFixed( 1 ) } m to the Spirit's port, the Spirit ${ closest.b?.toFixed( 1 ) } m to hers` );
		expect( closest.d, `closest approach ${ closest.d.toFixed( 1 ) } m` ).toBeGreaterThanOrEqual( 100 );
		expect( closest.d, 'they met mid-strait' ).toBeLessThan( 260 );
		expect( closest.a, `the Sealion Spirit to the Spirit's port (${ closest.a?.toFixed( 1 ) } m)` ).toBeGreaterThan( 0 );
		expect( closest.b, `the Spirit to the Sealion Spirit's port (${ closest.b?.toFixed( 1 ) } m)` ).toBeGreaterThan( 0 );

	} );


	test( 'At Joey Island the queued cars drive aboard the Sealion Spirit, the ship lying there, and ride with her', async ( { page } ) => {

		test.setTimeout( 420_000 );
		await test.step( 'Given the two ships at their home berths, the Sealion Spirit loading at Joey Island', async () => {

			await openIsland( page, '&ferryTimetable=short' );
			await expect.poll( async () => ( await ships( page ) )[ 1 ].berth, { timeout: 60_000 } ).toBe( 'joey' );

		} );
		const joeyCars = () => page.evaluate( () => window.__app.ferry.traffic.cars.filter( c => c.terminal.name === 'joey' )
			.map( c => ( { id: c.id, state: c.state, x: c.group.position.x, z: c.group.position.z } ) ) );
		let rider = null;
		await test.step( 'When the player watches her car deck from the free camera above Joey Island\'s terminal', async () => {

			const [ , s ] = await ships( page );
			await look( page, [ s.x + 60, 45, s.z - 60 ], [ s.x, 3, s.z ] );

		} );
		await test.step( 'Then a car from the Joey Island queue drives over the linkspan and parks on her deck', async () => {

			await expect.poll( async () => {

				const [ , s ] = await ships( page );
				rider = ( await joeyCars() ).find( c => c.state === 'parked' && Math.hypot( c.x - s.x, c.z - s.z ) < 30 ) || null;
				return !! rider;

			}, { timeout: 150_000, intervals: [ 1_000 ] } ).toBe( true );
			await page.screenshot( { path: `${ OUT }/fleet-joey-car-aboard.png` } );

		} );
		await test.step( 'And it rides with her when she sails for Tidewater', async () => {

			await expect.poll( async () => ( await ships( page ) )[ 1 ].lines, { timeout: 180_000, intervals: [ 1_000 ] } ).toBe( 'off' );
			await expect.poll( async () => {

				const [ , s ] = await ships( page ), c = ( await joeyCars() ).concat( await page.evaluate( () => window.__app.ferry.traffic.cars.map( c => ( { id: c.id, state: c.state, x: c.group.position.x, z: c.group.position.z } ) ) ) ).find( c => c.id === rider.id );
				return c && c.state === 'parked' && Math.hypot( c.x - s.x, c.z - s.z ) < 30 && Math.hypot( s.x - rider.x, s.z - rider.z ) > 40;

			}, { timeout: 120_000, intervals: [ 1_000 ] } ).toBe( true );

		} );

	} );

} );
