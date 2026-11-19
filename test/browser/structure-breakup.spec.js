// A building broken by a surge comes apart without throwing its pieces (docs/disaster-damage.md, "A structure
// breaks without throwing its pieces"). The surge is started from the Disasters panel with the keyboard. The pieces
// are read from the running game after every frame's physics; page.evaluate only reads state and stages the camera.
import { test, expect } from '@playwright/test';
import { SCENARIO_TIMEOUT_MS, untilGameTimeCheck } from './gameTime.js';

const OUT = process.env.PW_OUT ?? '/tmp';
const status = page => page.getByRole( 'status', { name: 'Disaster simulation' } );
// The wave height slider is logarithmic: 1,000 steps from 1 m to 3,000 m (src/disasters/TsunamiPanel.js, SLIDER_STEPS).
// Home takes it to 1 m and each arrow press one step up.
async function waveHeight( page, H ) {
	const slider = page.getByRole( 'slider', { name: 'Wave height', exact: true } ), steps = Math.round( 1000 * Math.log( H ) / Math.log( 3000 ) );
	await slider.focus();
	await page.keyboard.press( 'Home' );
	for ( let k = 0; k < steps; k ++ ) await page.keyboard.press( 'ArrowRight' );
	await expect( slider ).toHaveValue( String( steps ) );
}
// Both review cameras at one moment: the village street and the village from 150 m out and 60 m up.
async function frames( page, name ) {
	for ( const view of [ 'village', 'village150' ] ) {
		await page.evaluate( v => window.__view( v ), view );
		await page.evaluate( () => new Promise( r => requestAnimationFrame( () => requestAnimationFrame( r ) ) ) );
		await page.screenshot( { path: `${ OUT }/breakup-${ name }-${ view }.png` } );
	}
}

// Follows every loose piece of every structure from the frame it becomes a body to the end of the run. Climb (m): how
// far the piece's lowest point stands above the higher of the water, the ground and where that point began. A piece
// that falls, floats or is carried level has none; a thrown piece has the height of its throw. Drawn (m): the distance
// between a piece's first and last drawn vertices against the same distance as built, checked once, 3 s after a
// torn-off part appears or a jointed section's structure first breaks, so a piece collapsed to a point or stretched
// is seen.
const follow = page => page.evaluate( () => {
	const app = window.__app, S = app.disasters.structures, field = app.disasters.field, terrain = app.terrainData;
	const rec = window.__breakup = { pieces: new Map(), firstAt: null, worst: 0, worstOf: '', misdrawn: 0, checked: 0 };
	const sample = {}, sync = S.sync.bind( S );
	const span = ( s, array ) => {
		const a = array === 'rest' ? s.pos : s.geo.attributes.position.array, i = array === 'rest' ? 0 : s.start * 3, j = i + ( s.count - 1 ) * 3;
		return Math.hypot( a[ j ] - a[ i ], a[ j + 1 ] - a[ i + 1 ], a[ j + 2 ] - a[ i + 2 ] );
	};
	S.sync = poses => {
		sync( poses );
		const now = field.time;
		for ( const b of S.bodies.values() ) {
			const q = b.quaternion, h = b.half, record = b.member?.record;
			const reach = Math.abs( 2 * ( q.x * q.y + q.z * q.w ) ) * h.x + Math.abs( 1 - 2 * ( q.x * q.x + q.z * q.z ) ) * h.y + Math.abs( 2 * ( q.y * q.z - q.x * q.w ) ) * h.z;
			const low = b.position.y - reach;
			let p = rec.pieces.get( b.id );
			if ( ! p ) { rec.pieces.set( b.id, p = { low0: low, until: record ? Infinity : now + 3, done: false } ); rec.firstAt ??= now; }
			if ( record?.broken && p.until === Infinity ) p.until = now + 3;
			const ground = terrain.heightAt( b.position.x, b.position.z );
			field.sample( b.position.x, b.position.y, b.position.z, sample );
			const climb = low - Math.max( ground, sample.height > ground + .02 ? sample.height : - Infinity, p.low0 );
			if ( climb > rec.worst ) { rec.worst = climb; rec.worstOf = `${ b.name } (${ b.mass.toFixed( 0 ) } kg) at ${ now.toFixed( 1 ) } s`; }
			if ( p.done || now < p.until ) continue;
			p.done = true;
			// Rigid pieces only: a member of two sections bends between them by design.
			const spans = b.piece ? b.spans : b.member?.sections.length === 1 ? b.member.spans : null, s = spans?.find( x => x.count > 1 && span( x, 'rest' ) > .05 );
			if ( s ) { rec.checked ++; if ( Math.abs( span( s, 'drawn' ) - span( s, 'rest' ) ) > .02 * span( s, 'rest' ) + .01 ) rec.misdrawn ++; }
		}
	};
} );
const read = page => page.evaluate( () => {
	const r = window.__breakup, S = window.__app.disasters.structures, now = window.__app.disasters.field.time;
	return { now, firstAt: r.firstAt, pieces: r.pieces.size, done: [ ...r.pieces.values() ].filter( p => p.done ).length, worst: r.worst, worstOf: r.worstOf, misdrawn: r.misdrawn, checked: r.checked, broken: S.records.filter( x => x.broken ).map( x => x.name ) };
} );

for ( const [ H, wave ] of [ [ 2, '2 m surge' ], [ 10, '10 m wave' ], [ 25, '25 m wave' ] ] ) test( `A building broken by a surge comes apart without throwing its pieces: ${ wave }`, async ( { page } ) => {
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
		await follow( page );
	} );
	await test.step( `When I start a ${ wave } at the harbour pier with the keyboard`, async () => {
		await page.getByLabel( 'Disaster type' ).focus();
		await page.keyboard.type( 'Tsunami' );
		await expect( page.getByLabel( 'Disaster type' ) ).toHaveValue( 'tsunami' );
		await page.getByLabel( 'Target location' ).focus();
		await page.keyboard.type( 'Harbour pier' );
		await expect( page.getByLabel( 'Target location' ) ).toHaveValue( 'pier' );
		await page.getByRole( 'combobox', { name: 'Warning', exact: true } ).focus();
		await page.keyboard.type( 'None' );
		await expect( page.getByRole( 'combobox', { name: 'Warning', exact: true } ) ).toHaveValue( 'none' );
		await waveHeight( page, H );
		await page.getByRole( 'button', { name: 'Start disaster', exact: true } ).focus();
		await page.keyboard.press( 'Enter' );
		await expect( status( page ) ).toHaveAttribute( 'data-active', /tsunami/ );
		// The review camera on the village street, for the captures (staged after the keys: it takes the keyboard).
		await page.evaluate( () => window.__view( 'village' ) );
	} );
	await test.step( 'Then a building by the pier fails, no piece of it rises clear of the water and the ground for 30 s after, and every piece is drawn at its full size', async () => {
		let last = null, shot = 0;
		await untilGameTimeCheck( page, async () => {
			last = await read( page );
			if ( last.firstAt === null ) return false;
			// Evidence only: both review views as the first piece appears, 5 s and 20 s later.
			if ( shot === 0 ) { shot = 1; await frames( page, `${ H }m-as-it-goes` ); }
			if ( shot === 1 && last.now > last.firstAt + 5 ) { shot = 2; await frames( page, `${ H }m-5s-later` ); }
			if ( shot === 2 && last.now > last.firstAt + 20 ) { shot = 3; await frames( page, `${ H }m-20s-later` ); }
			// Long enough for the structures the surge reaches to break and for their pieces' three seconds to pass.
			return last.broken.length > 0 && last.done > 0 && last.now > last.firstAt + 30;
		}, 150 );
		console.log( 'break-up', JSON.stringify( last ) );
		expect( last.pieces, 'the surge made loose pieces of a structure by the pier' ).toBeGreaterThan( 0 );
		expect( last.broken.length, 'a structure by the pier failed' ).toBeGreaterThan( 0 );
		expect( last.worst, `a piece of a broken structure rose clear of the water and the ground with nothing carrying it: its lowest point stood ${ last.worst.toFixed( 2 ) } m above both and above where it began (${ last.worstOf }; 0.5 m allowed)` ).toBeLessThan( .5 );
		expect( last.checked, 'pieces were compared with how they were built' ).toBeGreaterThan( 0 );
		expect( last.misdrawn, `${ last.misdrawn } of ${ last.checked } pieces are not drawn at the size they were built` ).toBe( 0 );
		expect( errors ).toEqual( [] );
	} );
} );
