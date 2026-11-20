import { benchMode } from './core/BenchSeed.js';
import { isAppleTouchDevice } from './engine/Engine.js';
import { App } from './App.js';
import { UI } from './ui/UI.js';
import { AppUI } from './ui/AppUI.js';

// ?bench runs in background tabs too (automation): rAF does not fire in a hidden page
if ( benchMode ) {

	const raf = window.requestAnimationFrame.bind( window ), caf = window.cancelAnimationFrame.bind( window );
	window.requestAnimationFrame = ( cb ) => document.visibilityState === 'hidden' ? setTimeout( () => cb( performance.now() ), 16 ) : raf( cb );
	window.cancelAnimationFrame = ( id ) => ( clearTimeout( id ), caf( id ) );

}

const ui = new UI();
window.__ui = ui;
// A killed WebContent process cannot show the normal device-lost dialog. A tab-scoped
// marker lets its replacement ask before allocating the same scene again.
const mobile = isAppleTouchDevice(), loadingKey = 'tidewater.mobileLoading';
function clearLoadingMarker() {

	if ( mobile ) try { sessionStorage.removeItem( loadingKey ); } catch { /* storage disabled */ }

}

if ( mobile ) {

	let interrupted = false;
	try { interrupted = sessionStorage.getItem( loadingKey ) === '1'; } catch { /* storage disabled */ }
	if ( interrupted ) await ui.waitForLoadingRetry();
	try { sessionStorage.setItem( loadingKey, '1' ); } catch { /* storage disabled */ }
	window.addEventListener( 'pagehide', clearLoadingMarker, { once: true } );

}
const app = new App();

// The browser can take the graphics device away (driver reset, GPU memory pressure). Nothing draws
// after that, so the loader stops and a dialog offers Reload (device-lost.spec.js).
window.addEventListener( 'tw-device-lost', () => { clearLoadingMarker(); ui.showDeviceLost(); }, { once: true } );

app.init( ( p, text, until ) => ui.setLoading( p, text, until ), ( done, total ) => ui.setLoadingDetail( done, total ) ).then( async () => {

	clearLoadingMarker();
	if ( ui.deviceLost ) return;
	app.ui = new AppUI( app, ui );
	ui.setLoading( 1, 'Ready' );
	await ui.hideLoader();
	// frame-time benchmark and reference shots (see core/Bench.js): it drives the frames itself
	if ( import.meta.env.MODE !== 'pages' && benchMode ) {

		window.__bench = new ( await import( './core/Bench.js' ) ).Bench( app );
		if ( app.qs.has( 'auto' ) ) window.__job = window.__bench.auto( app.qs.get( 'auto' ), { runs: Number( app.qs.get( 'runs' ) ) || 1 } );
		// ?bench&shots=view1,view2[&tag=name][&dt=seconds][&seq=n&every=frames]: reference shots of the named views only (core/DebugViews.js; dt > 0: the clock runs, e.g. for the eased lens flare)
		// &wdbg=N: the water shader's debug view (WaterMaterial debugMode) in the shots
		if ( app.qs.has( 'wdbg' ) && app.waterMaterial ) app.waterMaterial.debugMode.value = Number( app.qs.get( 'wdbg' ) );
		if ( app.qs.has( 'shots' ) ) window.__job = window.__bench.shots( app.qs.get( 'shots' ).split( ',' ), { tag: app.qs.get( 'tag' ) || 'shot', dt: Number( app.qs.get( 'dt' ) ) || 0, seq: Number( app.qs.get( 'seq' ) ) || 1, every: Number( app.qs.get( 'every' ) ) || 1 } );

	} else app.start();
	ui.showStartOverlay( choice => {
		app.startIsland( choice );
		if ( mobile ) {
			// The first tap starts the live mix while detailed geometry is still arriving. If the
			// browser kills this document there, offer a retry before starting the island again.
			try { sessionStorage.setItem( loadingKey, '1' ); } catch { /* storage disabled */ }
			const startFrame = app.engine.frame, startTime = performance.now();
			const check = () => {
				if ( ui.deviceLost ) return;
				if ( app.engine.frame >= startFrame + 30 && performance.now() - startTime >= 10000 ) clearLoadingMarker();
				else setTimeout( check, 1000 );
			};
			setTimeout( check, 10000 );
		}

		app.input.requestLock();
		if ( app.audio ) app.audio.resume();

	} );

} ).catch( ( e ) => {

	clearLoadingMarker();
	console.error( e );
	if ( ! ui.deviceLost ) ui.setLoadingError( 'Something went wrong: ' + e.message );

} );
