
// Wall-clock cap for one wait: only a hang should reach it.
export const WALL_CAP_MS = 600_000;
// A whole disaster scenario under load: boot plus three or four game-time waits.
export const SCENARIO_TIMEOUT_MS = 1_200_000;

// Runs `probe` (a page function with no closure, returning a JSON value) between frames and
// returns [ value, disaster clock in game seconds ] read in the same task.
function sample( page, probe, arg ) {

	return page.evaluate( async ( { source, arg } ) => {

		await new Promise( ( resolve ) => {

			const check = () => window.__app.simulationPending ? setTimeout( check, 4 ) : resolve();
			check();

		} );
		const value = ( 0, eval )( `(${ source })` )( arg );
		return [ value, window.__app.disasters.field.time ];

	}, { source: probe.toString(), arg } );

}

// One read of `probe` between frames.
export async function atFrameBoundary( page, probe, arg ) {

	return ( await sample( page, probe, arg ) )[ 0 ];

}

// Polls `probe` until it returns truthy or `budget` game seconds pass on the disaster clock.
// Returns { value, elapsed } so the caller asserts on the value and reports the game time.
export async function untilGameTime( page, probe, budget, arg ) {

	const deadline = Date.now() + WALL_CAP_MS;
	let [ value, start ] = await sample( page, probe, arg );
	let elapsed = 0;
	while ( ! value && elapsed <= budget && Date.now() < deadline ) {

		await page.waitForTimeout( 250 );
		let now;
		[ value, now ] = await sample( page, probe, arg );
		elapsed = now - start;

	}
	return { value, elapsed };

}

// The same wait for a check that runs in the test, such as a locator read of the status panel.
export async function untilGameTimeCheck( page, check, budget ) {

	const clock = () => 0;
	const deadline = Date.now() + WALL_CAP_MS;
	const start = ( await sample( page, clock ) )[ 1 ];
	let value = await check();
	let elapsed = 0;
	while ( ! value && elapsed <= budget && Date.now() < deadline ) {

		await page.waitForTimeout( 250 );
		value = await check();
		elapsed = ( await sample( page, clock ) )[ 1 ] - start;

	}
	return { value, elapsed };

}

export const ASHORE_SLACK = 30; // game s past the planned crest arrival

export async function untilAshore( page ) {

	const planned = await atFrameBoundary( page, () => {

		const e = window.__app.disasters.field.events.get( 'tsunami' );
		return e ? e.arrival - e.time : 0;

	} );
	const budget = Math.max( 0, planned ) + ASHORE_SLACK;
	const r = await untilGameTime( page, () => !! window.__app.disasters.field.events.get( 'tsunami' )?.coastReached, budget );
	return { ...r, planned, budget };

}
