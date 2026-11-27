import { test, expect } from '@playwright/test';

const OUT = process.env.PW_OUT || 'test-results/overhaul';
const telemetry = page => page.getByRole( 'status', { name: 'Rally telemetry' } );
const value = async ( page, key ) => Number( await telemetry( page ).getAttribute( `data-${ key }` ) );

async function enterDriving( page ) {
	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=0.5&noAudio' );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	await expect( page.getByRole( 'dialog' ) ).toBeHidden();
	await page.keyboard.press( 'm' );
	const wheel = page.getByRole( 'menu', { name: 'Activity Wheel' } );
	await expect( wheel ).toBeVisible();
	await wheel.getByRole( 'menuitem', { name: 'Drive' } ).click();
	await wheel.getByRole( 'menuitem', { name: 'Aster RS' } ).click();
}

// Drive the car with real W/S/A/D keys through a sequence of world-space waypoints.
async function steerWithKeys( page, waypoints, { maxMs = 45_000, stopWhen = null } = {} ) {
	const held = new Set();
	const hold = async ( key, on ) => {
		if ( on && ! held.has( key ) ) { await page.keyboard.down( key ); held.add( key ); }
		if ( ! on && held.has( key ) ) { await page.keyboard.up( key ); held.delete( key ); }
	};
	const started = Date.now();
	let next = 0, peakSpeed = 0, endSpeed = 0, minGoalDist = Infinity;
	const goal = waypoints.at( - 1 );
	try {
		while ( next < waypoints.length && Date.now() - started < maxMs ) {
			const state = await page.evaluate( () => {
				const s = window.__app.rally.state, fwd = window.__app.rally.forward;
				return { x: s[ 0 ], z: s[ 2 ], kmh: s[ 7 ], heading: Math.atan2( fwd.x, fwd.z ) };
			} );
			const dGoal = Math.hypot( goal.x - state.x, goal.z - state.z );
			minGoalDist = Math.min( minGoalDist, dGoal );
			peakSpeed = Math.max( peakSpeed, Math.abs( state.kmh ) );
			endSpeed = Math.abs( state.kmh );
			if ( stopWhen && stopWhen( state, dGoal, peakSpeed ) ) break;
			const wp = waypoints[ next ];
			if ( next < waypoints.length - 1 && Math.hypot( wp.x - state.x, wp.z - state.z ) < ( wp.tol ?? 6 ) ) {
				next ++; continue;
			}
			const want = Math.atan2( wp.x - state.x, wp.z - state.z );
			const err = Math.atan2( Math.sin( want - state.heading ), Math.cos( want - state.heading ) );
			await hold( 'a', err > 0.05 );
			await hold( 'd', err < - 0.05 );
			await hold( 'w', state.kmh < ( wp.kmh ?? 40 ) );
			await hold( 's', state.kmh > ( wp.kmh ?? 40 ) + 12 );
			await page.waitForTimeout( 50 );
		}
	} finally {
		for ( const key of [ ...held ] ) await hold( key, false );
	}
	return { peakSpeed, endSpeed, minGoalDist };
}

test( 'Expanded island highways, mountain pass and rally stage support responsive driving through real controls', async ( { page } ) => {
	test.setTimeout( 180_000 );
	await test.step( 'Given the real island loaded with the expanded road network and driver in Aster RS', async () => {
		await enterDriving( page );
		const totalLength = await page.evaluate( () => window.__app.coastalRoute.totalLength );
		expect( totalLength ).toBeGreaterThan( 8500 );
	} );

	await test.step( 'When the driver selects North Coast highway, accelerates to speed and steers firmly', async () => {
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'northCoast' );
		await expect.poll( () => value( page, 'grounded' ) ).toBe( 4 );
		await expect( telemetry( page ) ).toHaveAttribute( 'data-surface', 'asphalt' );
		// Follow the North Coast highway curve with real keys up to highway speed, then test firm high-speed turn-in.
		const runWaypoints = await page.evaluate( () => {
			const pts = window.__app.coastalRoute.islandHighway.points;
			const s = window.__app.rally.state;
			const startIdx = pts.reduce( ( b, p, i ) => Math.hypot( p.x - s[ 0 ], p.z - s[ 2 ] ) < Math.hypot( pts[ b ].x - s[ 0 ], pts[ b ].z - s[ 2 ] ) ? i : b, 0 );
			const out = [];
			for ( let i = startIdx + 25; i < Math.min( pts.length, startIdx + 280 ); i += 25 ) {
				out.push( { x: pts[ i ].x, z: pts[ i ].z, kmh: 110, tol: 8 } );
			}
			return out;
		} );
		const accel = await steerWithKeys( page, runWaypoints, {
			maxMs: 18_000,
			stopWhen: st => st.kmh > 82,
		} );
		expect( accel.peakSpeed, 'car reached highway speed on North Coast asphalt' ).toBeGreaterThan( 75 );
		const fx0 = await value( page, 'forward-x' ), fz0 = await value( page, 'forward-z' );
		await page.keyboard.down( 'w' );
		await page.keyboard.down( 'd' );
		let peakYaw = 0, peakLatG = 0;
		for ( let i = 0; i < 12; i ++ ) {
			await page.waitForTimeout( 60 );
			peakYaw = Math.max( peakYaw, Math.abs( await value( page, 'yaw-rate' ) ) );
			peakLatG = Math.max( peakLatG, Math.abs( await value( page, 'lateral-g' ) ) );
		}
		await page.keyboard.up( 'd' );
		await page.keyboard.up( 'w' );
		const fx1 = await value( page, 'forward-x' ), fz1 = await value( page, 'forward-z' );
		const turnedDeg = Math.acos( Math.max( - 1, Math.min( 1, fx0 * fx1 + fz0 * fz1 ) ) ) * 180 / Math.PI;
		expect( peakYaw, 'responsive high-speed yaw rate' ).toBeGreaterThan( 0.18 );
		expect( peakLatG, 'sustained lateral cornering g' ).toBeGreaterThan( 0.45 );
		expect( turnedDeg, 'noticeable heading change during held steer' ).toBeGreaterThan( 8 );
		await page.screenshot( { path: `${ OUT }/north-coast-drive.png` } );
	} );

	await test.step( 'Then every new named start lands all four wheels on its graded road surface', async () => {
		for ( const [ option, expectedSurface ] of [
			[ 'westHeadland', 'asphalt' ],
			[ 'straitBridge', 'asphalt' ],
			[ 'mountainPass', 'asphalt' ],
			[ 'rallyStage', 'gravel' ],
			[ 'joeyPeninsula', 'asphalt' ],
		] ) {
			await page.getByLabel( 'Start at', { exact: true } ).selectOption( option );
			await expect.poll( () => value( page, 'grounded' ), { timeout: 15_000 } ).toBe( 4 );
			await expect( telemetry( page ) ).toHaveAttribute( 'data-surface', expectedSurface );
		}
	} );
} );

test( 'Parked terminal cars and roadside guide posts physically block a driven car', async ( { page } ) => {
	test.setTimeout( 240_000 );
	let postTarget, parkedTarget;
	await test.step( 'Given the driver on the island after terminal parked cars and roadside posts have loaded', async () => {
		await enterDriving( page );
		await page.evaluate( () => window.__app.terminal?.ready );
		const counts = await page.evaluate( () => ( {
			guidePosts: window.__app.colliders.cylinders.filter( c => c.tag === 'guide-post' ).length,
			parkedCars: window.__app.colliders.boxes.filter( b => b.tag === 'parked-terminal-car' && b.solid ).length,
			terminalPosts: window.__app.colliders.boxes.filter( b => b.tag === 'terminal-post' ).length
				+ window.__app.colliders.cylinders.filter( c => c.tag === 'terminal-post' ).length,
		} ) );
		expect( counts.guidePosts ).toBeGreaterThan( 60 );
		expect( counts.parkedCars ).toBeGreaterThan( 40 );
		expect( counts.terminalPosts ).toBeGreaterThan( 15 );
	} );

	let postResult;
	await test.step( 'When the player starts on the Town backroad and steers with W/A/D into the nearest roadside guide post', async () => {
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'town' );
		await expect.poll( () => value( page, 'grounded' ), { timeout: 15_000 } ).toBe( 4 );
		postTarget = await page.evaluate( () => {
			const s = window.__app.rally.state, fwd = window.__app.rally.forward;
			const posts = window.__app.colliders.cylinders.filter( c => c.tag === 'guide-post' ).map( c => {
				const dx = c.x - s[ 0 ], dz = c.z - s[ 2 ];
				return { x: c.x, z: c.z, ahead: dx * fwd.x + dz * fwd.z, dist: Math.hypot( dx, dz ) };
			} ).filter( p => p.ahead > 12 && p.dist < 60 ).sort( ( a, b ) => a.dist - b.dist );
			return posts[ 0 ];
		} );
		expect( postTarget, 'a solid guide post stands ahead along the Town backroad' ).toBeTruthy();
		let hitPost = false;
		postResult = await steerWithKeys( page, [ { x: postTarget.x, z: postTarget.z, kmh: 35 } ], {
			maxMs: 12_000,
			stopWhen: ( st, d, peak ) => {
				if ( d < 3.4 && peak > 14 && Math.abs( st.kmh ) < peak * 0.5 ) { hitPost = true; return true; }
				return false;
			},
		} );
		postResult.hitPost = hitPost;
		await page.screenshot( { path: `${ OUT }/guide-post-hit.png` } );
	} );

	await test.step( 'Then the guide post physically arrests the car instead of letting it pass through', async () => {
		expect( postResult.peakSpeed ).toBeGreaterThan( 14 );
		expect( postResult.minGoalDist, 'car reached the guide post' ).toBeLessThan( 3.8 );
		expect( postResult.minGoalDist, 'car centre stayed clear of the post core' ).toBeGreaterThan( 1.2 );
		expect( postResult.hitPost || postResult.endSpeed < postResult.peakSpeed * 0.65 ).toBe( true );
	} );

	let parkedResult;
	await test.step( 'When the player drives down Ferry road with W/A/D straight into a parked car in the terminal car park', async () => {
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'ferryRoad' );
		await expect.poll( () => value( page, 'grounded' ), { timeout: 15_000 } ).toBe( 4 );
		const plan = await page.evaluate( () => {
			const app = window.__app, t = app.terminal, pts = app.coastalRoute.ferryRoad.points;
			const startX = app.rally.state[ 0 ], startZ = app.rally.state[ 2 ];
			const routePts = [];
			for ( let i = 0; i < pts.length; i += 35 ) {
				if ( pts[ i ].z > startZ + 12 ) routePts.push( { x: pts[ i ].x, z: pts[ i ].z, kmh: 55, tol: 8 } );
			}
			const end = pts.at( - 1 );
			routePts.push( { x: end.x, z: end.z + 6, kmh: 35, tol: 6 } );
			const parked = app.colliders.boxes.filter( b => b.tag === 'parked-terminal-car' && b.solid
				&& Math.hypot( b.center.x - t.position.x, b.center.z - t.position.z ) < 140 );
			parked.sort( ( a, b ) => Math.hypot( a.center.x - end.x, a.center.z - ( end.z + 18 ) )
				- Math.hypot( b.center.x - end.x, b.center.z - ( end.z + 18 ) ) );
			const car = parked[ 0 ];
			routePts.push( { x: car.center.x, z: car.center.z, kmh: 30 } );
			return { routePts, target: { x: car.center.x, z: car.center.z } };
		} );
		parkedTarget = plan.target;
		let hitCar = false, hitAtSpeed = 0;
		parkedResult = await steerWithKeys( page, plan.routePts, {
			maxMs: 40_000,
			stopWhen: ( st, d ) => {
				if ( d < 12 ) hitAtSpeed = Math.max( hitAtSpeed, Math.abs( st.kmh ) );
				if ( d < 5.2 && hitAtSpeed > 12 && Math.abs( st.kmh ) < hitAtSpeed * 0.5 ) { hitCar = true; return true; }
				return false;
			},
		} );
		parkedResult.hitCar = hitCar;
		parkedResult.approachSpeed = hitAtSpeed;
		await page.screenshot( { path: `${ OUT }/parked-car-collision.png` } );
	} );

	await test.step( 'Then the parked car physically blocks the player car instead of letting it clip through', async () => {
		expect( parkedTarget ).toBeTruthy();
		expect( parkedResult.approachSpeed, 'car entered the car park at speed' ).toBeGreaterThan( 12 );
		expect( parkedResult.minGoalDist, 'car reached the parked car' ).toBeLessThan( 5.5 );
		expect( parkedResult.minGoalDist, 'car centre never clipped through the parked car centre' ).toBeGreaterThan( 1.6 );
		expect( parkedResult.hitCar || parkedResult.endSpeed < parkedResult.approachSpeed * 0.65 ).toBe( true );
	} );
} );

test( 'A driven car crosses the 650 m inter-island suspension bridge from Tidewater Island to Joey Island on real controls', async ( { page } ) => {
	test.setTimeout( 180_000 );
	let crossResult, stats;
	await test.step( 'Given the driver starts at the Strait suspension bridge entrance on Tidewater Island', async () => {
		await enterDriving( page );
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'straitBridge' );
		await expect.poll( () => value( page, 'grounded' ), { timeout: 15_000 } ).toBe( 4 );
		await expect( telemetry( page ) ).toHaveAttribute( 'data-surface', 'asphalt' );
	} );

	await test.step( 'When the driver accelerates with W/A/D straight across the suspension bridge toward Joey Island', async () => {
		const waypoints = await page.evaluate( () => {
			// Straight along the suspension bridge axis from P0=(-250, 138) to P1=(5, 722) and onto bridgeSouth.
			const len = Math.hypot( 255, 584 ), ux = 255 / len, uz = 584 / len;
			const out = [];
			for ( let s = 40; s <= len + 20; s += 55 ) {
				out.push( { x: - 250 + ux * s, z: 138 + uz * s, kmh: 95, tol: 14 } );
			}
			return out;
		} );
		let midShot = false;
		crossResult = await steerWithKeys( page, waypoints, {
			maxMs: 45_000,
			stopWhen: st => {
				if ( st.z > 400 && st.z < 470 ) midShot = true;
				return st.z > 730;
			},
		} );
		expect( crossResult.peakSpeed ).toBeGreaterThan( 70 );
		expect( midShot, 'car drove through the mid-span over the strait' ).toBe( true );
		stats = await page.evaluate( () => {
			const s = window.__app.rally.state;
			return { x: s[ 0 ], y: s[ 1 ], z: s[ 2 ], grounded: s[ 10 ], kmh: s[ 7 ] };
		} );
		await page.screenshot( { path: `${ OUT }/bridge-crossing-joey.png` } );
	} );

	await test.step( 'Then the car completes the inter-island crossing onto Joey Island dry and grounded', async () => {
		expect( stats.z, 'car crossed the strait onto Joey Island' ).toBeGreaterThan( 700 );
		expect( stats.y, 'car stayed high on the bridge and Joey Island bluff' ).toBeGreaterThan( 10 );
		expect( stats.grounded, 'car landed grounded on Joey Island asphalt' ).toBeGreaterThanOrEqual( 3 );
	} );
} );

test( 'Capture whole-frame review views of the expanded roads, suspension bridge and terminal car park', async ( { page } ) => {
	test.setTimeout( 180_000 );
	await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
	await page.goto( '/?scale=0.75&noAudio' );
	await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
	await page.keyboard.press( 'Enter' );
	await expect( page.getByRole( 'dialog' ) ).toBeHidden();
	await page.evaluate( async () => {
		await window.__app.terminal?.ready;
		await window.__app.coastalRoad?.ready;
	} );
	for ( const view of [ 'straitBridge', 'straitBridgeDeck', 'westHeadland', 'northCoast', 'mountainPass', 'rallyStage', 'joeyPeninsula', 'terminalParked' ] ) {
		await page.evaluate( v => window.__view( v ), view );
		await page.waitForTimeout( 700 );
		await page.screenshot( { path: `${ OUT }/view-${ view }.png` } );
	}
} );
