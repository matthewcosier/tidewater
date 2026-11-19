// Trees in a tornado and a tsunami, driven from the Disasters panel with the keyboard
// (docs/disaster-damage.md). Telemetry is read from the running game; page.evaluate only reads
// state and stages the review cameras for the captures.
import { test, expect } from '@playwright/test';
import { SCENARIO_TIMEOUT_MS, untilGameTimeCheck } from './gameTime.js';

const OUT = process.env.PW_OUT ?? '/tmp';
const status = page => page.getByRole( 'status', { name: 'Disaster simulation' } );
async function fill( page, field, value ) {
	await field.focus();
	await page.keyboard.press( 'ControlOrMeta+A' );
	await page.keyboard.type( value );
}
async function choose( page, label, option ) {
	await page.getByLabel( label ).focus();
	await page.keyboard.type( option );
	await expect( page.getByLabel( label ) ).toHaveValue( option.toLowerCase() );
}
const trees = page => page.evaluate( () => window.__app.disasters.bodies.trees.filter( t => t.mode || t.util > .3 ).map( t => ( {
	mode: t.mode ?? 'bend', util: t.util, cut: t.cut, H: t.r.H, stump: Boolean( t.stump?.parent ),
	// Crown intact: every copied mesh draws the whole authored index buffer, never a stand-in.
	intact: ! t.group || t.group.children.every( ( m, i ) => m.geometry.index.count === t.type.near.meshes[ i ].geometry.index.count ),
} ) ) );

test( 'Trees bend, snap or uproot with their crowns intact under a tornado and then a 2 m tsunami', async ( { page } ) => {
	test.setTimeout( SCENARIO_TIMEOUT_MS );
	const errors = [];
	page.on( 'pageerror', e => errors.push( e.message ) );
	await test.step( 'Given the island and the disaster controls', async () => {
		await page.route( 'https://fonts.googleapis.com/**', r => r.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( `/?scale=${ process.env.PW_RENDER_SCALE ?? '0.5' }&noAudio` );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
		await page.getByRole( 'button', { name: 'Click to explore', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
	} );
	await test.step( 'When I start a tornado and then a 2 m tsunami at the village with the keyboard', async () => {
		await choose( page, 'Disaster type', 'Tornado' );
		await choose( page, 'Target location', 'Village' );
		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).focus();
		await page.keyboard.press( 'Enter' );
		await expect( status( page ) ).toHaveAttribute( 'data-active', /tornado/ );
		await choose( page, 'Disaster type', 'Tsunami' );
		await fill( page, page.getByLabel( 'Warning lead time (s)' ), '6' );
		await fill( page, page.getByRole( 'spinbutton', { name: 'Intensity', exact: true } ), '2' );
		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).focus();
		await page.keyboard.press( 'Enter' );
		await expect( status( page ) ).toHaveAttribute( 'data-active', /tsunami/ );
	} );
	await test.step( 'Then trees fall, snap or bend, and every fallen tree keeps its whole crown', async () => {
		const r = await untilGameTimeCheck( page, async () => ( await trees( page ) ).some( t => t.mode !== 'bend' ), 60 );
		expect( r.value, `a tree gave way within 60 game s (waited ${ r.elapsed.toFixed( 1 ) } s)` ).toBeTruthy();
		await untilGameTimeCheck( page, async () => false, 8 );
		const seen = await trees( page );
		for ( const t of seen ) {
			expect( [ 'bend', 'snap', 'uproot' ] ).toContain( t.mode );
			expect( t.intact, `${ t.mode } tree keeps its authored crown mesh` ).toBe( true );
			if ( t.mode === 'snap' ) {
				expect( t.stump, 'a snapped tree leaves its stump standing' ).toBe( true );
				expect( t.cut / t.H ).toBeGreaterThanOrEqual( .15 );
				expect( t.cut / t.H ).toBeLessThanOrEqual( .7 );
			}
		}
		console.log( 'tree modes', JSON.stringify( seen.reduce( ( n, t ) => ( n[ t.mode ] = ( n[ t.mode ] ?? 0 ) + 1, n ), {} ) ) );
		await page.getByRole( 'button', { name: 'Pause simulation', exact: true } ).click();
		await page.evaluate( () => window.__view( 'village150' ) );
		await page.waitForTimeout( 1500 );
		await page.screenshot( { path: `${ OUT }/trees-150m.png` } );
		await page.evaluate( () => window.__view( 'village' ) );
		await page.waitForTimeout( 1500 );
		await page.screenshot( { path: `${ OUT }/trees-ground.png` } );
		expect( errors ).toEqual( [] );
	} );
} );

// One frame of the flood-tree recorder, run in the page between frames. It reads the game's own
// tree bodies (Bodies.js) and the field they are loaded by, and keeps, per body, the most its centre
// of mass climbs above the lowest clearance it has had over max(water surface, ground), and its
// longest flight clear of the water with no ground contact. Plain numbers only: it returns nothing.
function recordTreeFrame() {
	const a = window.__app, D = a.disasters, f = D.field, rec = window.__treeRec ??= { bodies: {}, frames: 0, over: {}, start: f.time };
	const motion = a.rally.physics.disaster_motion(), supported = new Set( a.rally.physics.disaster_supported() ), dt = f.time - ( rec.last ?? f.time );
	rec.last = f.time; rec.frames ++;
	for ( const t of D.bodies.trees ) if ( t.mode ) rec.over[ t.k ] = { theta: t.theta, phase: t.phase, failed: rec.over[ t.k ]?.failed ?? f.time };
	for ( let i = 0; i < motion.length; i += 7 ) {
		const b = D.bodies.bodies.get( motion[ i ] );
		if ( ! b || b.kind !== 'tree' ) continue;
		const com = b.position.clone().add( b.position.clone().fromArray( b.centerOfMass ).applyQuaternion( b.quaternion ) );
		const s = f.sample( com.x, com.y, com.z ), ground = f.terrain( com.x, com.z ), surface = s.height > ground + .02 ? s.height : - Infinity;
		const clearance = com.y - Math.max( surface, ground ), radius = b.half.x;
		const r = rec.bodies[ b.id ] ??= { released: f.time, start: clearance, lowest: clearance, rise: 0, riseAt: null, flight: 0, run: 0, upward: 0 };
		r.lowest = Math.min( r.lowest, clearance );
		const rise = clearance - Math.max( 0, r.lowest );
		if ( rise > r.rise ) { r.rise = rise; r.riseAt = { time: f.time, y: com.y, surface: s.height, ground, vy: motion[ i + 5 ] }; }
		// Clear of the water (no part of the stem within its own radius of the surface) and touching nothing below.
		if ( ! supported.has( b.id ) && com.y - radius > surface ) { r.run += dt; r.flight = Math.max( r.flight, r.run ); } else r.run = 0;
		r.upward = Math.max( r.upward, motion[ i + 5 ] );
	}
}

test( 'A tsunami takes the trees it uproots over with the flow and floats them, and none leaves the water', async ( { page } ) => {
	test.setTimeout( SCENARIO_TIMEOUT_MS );
	const errors = [];
	page.on( 'pageerror', e => errors.push( e.message ) );
	await test.step( 'Given the island and the disaster controls', async () => {
		await page.route( 'https://fonts.googleapis.com/**', r => r.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( `/?scale=${ process.env.PW_RENDER_SCALE ?? '0.5' }&noAudio` );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
		await page.getByRole( 'button', { name: 'Click to explore', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Disasters', exact: true } ).click();
	} );
	await test.step( 'When I start a 10 m tsunami at the harbour pier with the keyboard', async () => {
		await choose( page, 'Disaster type', 'Tsunami' );
		await page.getByLabel( 'Target location' ).focus();
		await page.keyboard.type( 'Harbour' );
		await expect( page.getByLabel( 'Target location' ) ).toHaveValue( 'pier' );
		await fill( page, page.getByLabel( 'Warning lead time (s)' ), '6' );
		await page.getByRole( 'button', { name: /^Severe/ } ).focus();
		await page.keyboard.press( 'Enter' );
		await expect( page.getByRole( 'status', { name: 'Wave height value' } ) ).toHaveText( /^10 m/ );
		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).focus();
		await page.keyboard.press( 'Enter' );
		await expect( status( page ) ).toHaveAttribute( 'data-active', /tsunami/ );
	} );
	let rec;
	await test.step( 'Then the trees the flood uproots go over and float, and none rises above the water that carries it', async () => {
		const until = await page.evaluate( () => window.__app.disasters.field.events.get( 'tsunami' ).arrival + 45 );
		// The recorder runs in the page, one sample per rendered frame, in chunks short of the evaluate cap.
		for ( let done = false; ! done; ) done = await page.evaluate( async ( { until, source } ) => {
			const a = window.__app, f = a.disasters.field, step = ( 0, eval )( `(${ source })` ), wall = performance.now() + 120000;
			const between = () => new Promise( resolve => requestAnimationFrame( () => { const check = () => a.simulationPending ? setTimeout( check, 4 ) : resolve(); check(); } ) );
			while ( f.time < until && f.events.has( 'tsunami' ) && performance.now() < wall ) { await between(); step(); }
			return f.time >= until || ! f.events.has( 'tsunami' );
		}, { until, source: recordTreeFrame.toString() } );
		rec = await page.evaluate( () => ( { ...window.__treeRec, end: window.__app.disasters.field.time } ) );
		await test.info().attach( 'flood-tree-frames', { body: JSON.stringify( rec ), contentType: 'application/json' } );
		const over = Object.values( rec.over ), bodies = Object.entries( rec.bodies );
		console.log( 'flood trees', JSON.stringify( { frames: rec.frames, failed: over.length, bodies: bodies.length, worst: bodies.sort( ( x, y ) => y[ 1 ].rise - x[ 1 ].rise ).slice( 0, 4 ), longest: bodies.sort( ( x, y ) => y[ 1 ].flight - x[ 1 ].flight ).slice( 0, 4 ) } ) );
		expect( over.length, 'the 10 m flood uproots trees at the village' ).toBeGreaterThan( 0 );
		// A tree the water fails goes over within 20 s: past the 60 degree release tilt, or a body already.
		const settled = over.filter( t => rec.end - t.failed > 20 );
		const standing = settled.filter( t => t.phase === 'hinge' && t.theta < Math.PI / 3 );
		expect( standing.length, `${ standing.length } of ${ settled.length } trees the flood failed 20 s or more ago still stand (largest tilt ${ Math.max( 0, ...standing.map( t => t.theta ) ).toFixed( 2 ) } rad)` ).toBe( 0 );
		for ( const [ id, r ] of bodies ) {
			// Floating green wood rides at the surface; a fallen trunk lies on the ground. Climbing more than
			// 0.5 m above the lowest clearance it has had over max(water, ground) means it left both.
			expect( r.rise, `tree body ${ id } climbed ${ r.rise.toFixed( 2 ) } m above the water and ground that carried it (${ JSON.stringify( r.riseAt ) })` ).toBeLessThanOrEqual( .5 );
			// Free fall from its own release clearance takes sqrt(2 h / g); any longer clear of water and ground is flight.
			const fall = Math.sqrt( 2 * Math.max( 0, r.start ) / 9.81 ) + .25;
			expect( r.flight, `tree body ${ id } flew ${ r.flight.toFixed( 2 ) } s clear of water and ground (a fall from ${ r.start.toFixed( 2 ) } m takes ${ fall.toFixed( 2 ) } s)` ).toBeLessThanOrEqual( fall );
		}
		expect( errors ).toEqual( [] );
	} );
} );
