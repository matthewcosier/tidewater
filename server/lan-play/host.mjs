import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const width = 960, height = 540;
const keys = new Set( [ 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyR', 'KeyT', 'KeyJ', 'Space', 'ShiftLeft', 'Backquote', 'Escape' ] );

export async function openGame( url, events ) {
	const browser = await chromium.launch( { args: [
		'--enable-unsafe-webgpu', ...( process.platform === 'darwin' ? [ '--use-angle=metal' ] : [] ),
		'--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
	] } );
	try {
		const context = await browser.newContext( { viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: false } );
		const page = await context.newPage(), origin = new URL( url ).origin;
		await context.route( '**/*', route => {
			const req = route.request();
			return req.isNavigationRequest() && new URL( req.url() ).origin !== origin ? route.abort() : route.continue();
		} );
		context.on( 'page', other => { if ( other !== page ) other.close().catch( () => {} ); } );
		await page.exposeBinding( 'sendGameAudio', ( source, id, rate, data ) => {
			if ( source.frame === page.mainFrame() ) events.audio( id, rate, data );
		} );
		await page.addInitScript( { path: fileURLToPath( new URL( './capture-audio.js', import.meta.url ) ) } );
		page.on( 'crash', () => events.failure( 'The Mac game tab stopped.' ) );
		browser.on( 'disconnected', () => events.failure( 'The Mac renderer closed.' ) );
		await page.goto( url, { waitUntil: 'domcontentloaded', timeout: 60000 } );
		const cdp = await context.newCDPSession( page );
		let lastFrame = 0;
		cdp.on( 'Page.screencastFrame', frame => {
			cdp.send( 'Page.screencastFrameAck', { sessionId: frame.sessionId } ).catch( () => {} );
			const now = performance.now();
			if ( now - lastFrame < 1000 / 30 ) return;
			lastFrame = now; events.picture( frame.data );
		} );
		const capture = { format: 'jpeg', quality: 72, maxWidth: width, maxHeight: height, everyNthFrame: 1 };
		await cdp.send( 'Page.startScreencast', capture );
		await page.getByRole( 'button', { name: 'Click to explore' } ).waitFor( { timeout: 180000 } );
		let idle = false, picker = null;
		async function setIdle( value ) {
			if ( value === idle ) return;
			if ( value ) await cdp.send( 'Page.stopScreencast' );
			await page.evaluate( async paused => {
				const app = window.__app, engine = app.engine;
				if ( paused ) await engine.stop();
				else if ( ! engine.running ) {
					engine.clock.reset();
					engine.start( dt => app.frame( dt ) );
				}
				await window.setLanAudioIdle( paused );
			}, value );
			if ( ! value ) await cdp.send( 'Page.startScreencast', capture );
			idle = value;
		}
		const held = new Set();
		async function release() {
			if ( picker ) { await picker.dispose(); picker = null; }
			const down = [ ...held ]; held.clear();
			for ( const key of down ) await page.keyboard.up( key );
		}
		async function input( m ) {
			if ( m.type === 'release' ) return release();
			if ( m.type === 'key' && keys.has( m.key ) && typeof m.down === 'boolean' ) {
				if ( m.down === held.has( m.key ) ) return;
				if ( m.down ) { held.add( m.key ); await page.keyboard.down( m.key ); }
				else { held.delete( m.key ); await page.keyboard.up( m.key ); }
			} else if ( m.type === 'tap' && [ m.x, m.y ].every( n => Number.isFinite( n ) && n >= 0 && n <= 1 ) ) {
				const x = Math.min( width - 1, m.x * width ), y = Math.min( height - 1, m.y * height );
				const node = await page.evaluateHandle( ( [ x, y ] ) => document.elementFromPoint( x, y )?.closest( 'select:enabled' ) || null, [ x, y ] );
				if ( picker ) await picker.dispose();
				picker = node.asElement();
				if ( picker ) {
					events.options( await picker.evaluate( el => ( { name: el.getAttribute( 'aria-label' ) || 'Choose an option',
						items: Array.from( el.options ).slice( 0, 100 ).map( o => ( { label: o.text, disabled: o.disabled, selected: o.selected } ) ) } ) ) );
				} else { await node.dispose(); await page.mouse.click( x, y ); }
			} else if ( m.type === 'option' && picker && Number.isInteger( m.index ) && m.index >= 0 && m.index < 100 ) {
				const el = picker; picker = null;
				try {
					if ( await el.evaluate( ( select, i ) => select.isConnected && select.options[i] && !select.options[i].disabled, m.index ) )
						await el.selectOption( { index: m.index }, { timeout: 1500 } );
				} finally { await el.dispose(); }
			} else if ( m.type === 'look' && [ m.x, m.y ].every( n => Number.isFinite( n ) && Math.abs( n ) <= 200 ) ) {
				await page.evaluate( ( [ x, y ] ) => {
					document.querySelector( '#app canvas' ).dispatchEvent( new MouseEvent( 'mousedown', { button: 2, bubbles: true } ) );
					window.dispatchEvent( new MouseEvent( 'mousemove', { movementX: x, movementY: y } ) );
					window.dispatchEvent( new MouseEvent( 'mouseup', { button: 2 } ) );
				}, [ m.x, m.y ] );
			} else if ( m.type === 'start' && [ 'gt3', 'walk' ].includes( m.mode ) ) {
				await release();
				const start = page.getByRole( 'button', { name: 'Click to explore' } );
				const firstStart = await start.isVisible();
				if ( firstStart ) await start.click();
				const skip = page.getByRole( 'button', { name: 'Skip', exact: true } );
				if ( firstStart || await skip.isVisible() ) await skip.click( { timeout: 20000 } );
				await page.evaluate( mode => {
					const app = window.__app, rally = app.rally;
					if ( mode === 'walk' ) {
						if ( rally.active ) rally.leave();
					} else {
						rally.destination = 'coast';
						if ( rally.vehicleKey !== 'gt3rs' ) rally.selectVehicle( 'gt3rs' );
						else rally.reset();
						if ( ! rally.active ) rally.enter();
					}
					app.engine.domElement.focus();
				}, m.mode );
			}
		}
		const state = () => page.evaluate( () => ( { driving: !!__app.rally.active, car: __app.rally.vehicleKey,
			speed: Math.round( Math.abs( Number( document.querySelector( '.rh-speed' )?.textContent ) || 0 ) ),
			turnRate: Number( __app.rally.state?.[78] ) || 0, keys: [ ...__app.input.keys ].filter( k => [ 'KeyW', 'KeyA', 'KeyS', 'KeyD' ].includes( k ) ) } ) );
		return { input, release, state, setIdle, close: () => browser.close() };
	} catch ( e ) { await browser.close(); throw e; }
}
