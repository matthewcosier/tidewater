// Where a frame goes during a tsunami, on a running dev server (`npx vite --host 127.0.0.1 --port <port>`).
// Two parts:
//  loop : the real engine loop (no ?bench): frame rate, engine CPU ms, game seconds per wall second, a CPU profile
//         (self and inclusive ms a frame per function and per file), an allocation profile (bytes a frame per
//         function, garbage included) and the ragdoll pool's stats (dispatched, accepted, fallback and why), with no
//         event, during the approach and with the flood on land.
//  bench: frames driven by ?bench at fixed views, in one page: no event, event just started, flood on land, event
//         stopped. GPU ms per pass, draws and triangles, CPU ms and a CPU profile per state.
// Usage: node tools/flood-profile.mjs <port> <wave height m> <out.json> [loop|bench|both]
// Example: node tools/flood-profile.mjs 5251 10 flood.json loop
// A profile under machine load reads low on frame rate and high on everything: take a before and an after close
// together and note `uptime` (the load average is written into the result at the start, per phase and at the end).
import fs from 'node:fs';
import os from 'node:os';
import { chromium } from '@playwright/test';

const [ port = '5190', heightArg = '10', out = 'flood-profile.json', part = 'both' ] = process.argv.slice( 2 );
const HEIGHT = Number( heightArg ); // m: the tsunami's height (its intensity)
const SEED = 7; // the event's seed, fixed so a before and an after see the same wave
const VIEWS = [ 'tsunamiFlood', 'tsunamiImpact', 'aerial' ];
const HEAP_INTERVAL = 16384; // bytes between allocation samples (CDP default 32768; finer for short phases)
const log = ( ...a ) => console.log( new Date().toISOString().slice( 11, 19 ), ...a );
const load = () => os.loadavg().map( ( x ) => + x.toFixed( 1 ) );
const result = { port, height: HEIGHT, seed: SEED, started: new Date().toISOString(), load: load() };
const save = () => fs.writeFileSync( out, JSON.stringify( result, null, 1 ) );

const browser = await chromium.launch( { args: [ '--enable-unsafe-webgpu', ...( process.platform === 'darwin' ? [ '--use-angle=metal' ] : [] ), '--disable-background-timer-throttling' ] } );

async function open( query ) {

	const page = await browser.newPage( { viewport: { width: 2560, height: 1267 }, deviceScaleFactor: 1 } );
	page.on( 'pageerror', ( e ) => log( 'pageerror', String( e ).slice( 0, 300 ) ) );
	await page.route( 'https://fonts.googleapis.com/**', ( r ) => r.fulfill( { contentType: 'text/css', body: '' } ) );
	const cdp = await page.context().newCDPSession( page );
	await cdp.send( 'Profiler.enable' );
	await cdp.send( 'Profiler.setSamplingInterval', { interval: 500 } );
	await cdp.send( 'HeapProfiler.enable' );
	await page.goto( `http://127.0.0.1:${ port }/${ query }` );
	return { page, cdp };

}

const stat = ( a ) => {

	if ( ! a.length ) return null;
	const s = [ ...a ].sort( ( x, y ) => x - y ), q = ( p ) => s[ Math.min( s.length - 1, Math.floor( s.length * p ) ) ];
	return { n: a.length, mean: + ( a.reduce( ( x, y ) => x + y, 0 ) / a.length ).toFixed( 2 ), median: + q( 0.5 ).toFixed( 2 ), p95: + q( 0.95 ).toFixed( 2 ), max: + s[ s.length - 1 ].toFixed( 2 ) };

};

const file = ( u ) => u.startsWith( 'wasm' ) ? 'wasm' : ( u.split( '?' )[ 0 ].split( '/' ).slice( - 2 ).join( '/' ) || '(native)' );
const frameKey = ( f ) => `${ f.functionName || '(anonymous)' } ${ file( f.url ) }:${ f.lineNumber + 1 }`;

// CPU profile -> self and inclusive ms a frame per function, self ms a frame per file.
function aggregate( profile, frames ) {

	const { nodes, samples, timeDeltas } = profile;
	const byId = new Map( nodes.map( ( n ) => [ n.id, n ] ) );
	const self = new Map();
	for ( let i = 0; i < samples.length; i ++ ) self.set( samples[ i ], ( self.get( samples[ i ] ) || 0 ) + ( timeDeltas[ i ] || 0 ) );
	const total = new Map();
	const walk = ( n ) => {

		let t = self.get( n.id ) || 0;
		for ( const c of n.children || [] ) t += walk( byId.get( c ) );
		total.set( n.id, t );
		return t;

	};
	walk( nodes[ 0 ] );
	// Inclusive time counts a function once per stack: a recursive or re-entered function is not counted twice.
	const fnSelf = new Map(), fnTotal = new Map(), fileSelf = new Map();
	const inclusive = ( n, open ) => {

		const k = frameKey( n.callFrame ), outer = open.has( k );
		if ( ! outer ) { fnTotal.set( k, ( fnTotal.get( k ) || 0 ) + total.get( n.id ) ); open.add( k ); }
		for ( const c of n.children || [] ) inclusive( byId.get( c ), open );
		if ( ! outer ) open.delete( k );

	};
	inclusive( nodes[ 0 ], new Set() );
	let all = 0, idle = 0;
	for ( const n of nodes ) {

		const s = self.get( n.id ) || 0, k = frameKey( n.callFrame );
		all += s;
		if ( n.callFrame.functionName === '(idle)' ) idle += s;
		fnSelf.set( k, ( fnSelf.get( k ) || 0 ) + s );
		const f = n.callFrame.url ? file( n.callFrame.url ) : n.callFrame.functionName;
		fileSelf.set( f, ( fileSelf.get( f ) || 0 ) + s );

	}
	const busy = Math.max( 1, all - idle );
	const top = ( m, n ) => [ ...m.entries() ].filter( ( [ k ] ) => ! k.startsWith( '(idle)' ) && ! k.startsWith( '(root)' ) && ! k.startsWith( '(program)' ) ).sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, n ).map( ( [ k, v ] ) => ( { k, msPerFrame: + ( v / 1000 / frames ).toFixed( 3 ), share: + ( 100 * v / busy ).toFixed( 1 ) } ) );
	return { busyMsPerFrame: + ( busy / 1000 / frames ).toFixed( 2 ), idleShare: + ( 100 * idle / all ).toFixed( 1 ), files: top( fileSelf, 40 ), self: top( fnSelf, 70 ), inclusive: top( fnTotal, 90 ) };

}

// Sampling heap profile (garbage included) -> bytes a frame per allocating function and per file.
function allocation( profile, frames ) {

	const fnBytes = new Map(), fileBytes = new Map();
	let all = 0;
	const walk = ( n ) => {

		const k = frameKey( n.callFrame ), f = n.callFrame.url ? file( n.callFrame.url ) : ( n.callFrame.functionName || '(native)' );
		all += n.selfSize;
		fnBytes.set( k, ( fnBytes.get( k ) || 0 ) + n.selfSize );
		fileBytes.set( f, ( fileBytes.get( f ) || 0 ) + n.selfSize );
		for ( const c of n.children || [] ) walk( c );

	};
	walk( profile.head );
	const top = ( m, n ) => [ ...m.entries() ].filter( ( [ , v ] ) => v > 0 ).sort( ( a, b ) => b[ 1 ] - a[ 1 ] ).slice( 0, n ).map( ( [ k, v ] ) => ( { k, bytesPerFrame: Math.round( v / frames ), share: + ( 100 * v / Math.max( 1, all ) ).toFixed( 1 ) } ) );
	return { bytesPerFrame: Math.round( all / frames ), files: top( fileBytes, 25 ), functions: top( fnBytes, 40 ) };

}

// ---------------------------------------------------------------- the real loop
if ( part === 'loop' || part === 'both' ) {

	const { page, cdp } = await open( '?noAudio' );
	await page.waitForFunction( () => window.__app && window.__view && Number.isFinite( window.__app.cpuMs ), null, { timeout: 300_000 } );
	log( 'loop: booted' );
	await page.evaluate( () => window.__view( 'tsunamiFlood' ) );
	await page.waitForTimeout( 4000 );
	// Per frame: the interval, the engine CPU ms, the people whose rag is in its simulated phase, and the pool's
	// counters; each frame with a fallback tallies the pool's last fallback reason.
	const sample = ( seconds, untilGameTime ) => page.evaluate( ( [ seconds, untilGameTime ] ) => new Promise( ( resolve ) => {

		const app = window.__app, field = app.disasters.field, e = field.events.get( 'tsunami' ), pool = app.ragdollPool;
		const dts = [], cpu = [], rigs = [], reasons = {};
		const counters = () => pool ? { frames: pool.stats.frames, dispatched: pool.stats.dispatched, accepted: pool.stats.accepted, fallback: pool.stats.fallback, failures: pool.stats.failures } : null;
		const start = counters();
		const t0 = performance.now(), g0 = e ? e.time : 0, f0 = app.engine.frame;
		let last = t0, fallback = start?.fallback ?? 0;
		const tick = ( t ) => {

			dts.push( t - last ); last = t;
			cpu.push( app.cpuMs );
			let n = 0;
			for ( const p of app.people?.list ?? [] ) if ( p.knock?.rag?.rd.phase === 'sim' ) n ++;
			rigs.push( n );
			if ( pool && pool.stats.fallback > fallback ) { const r = String( pool.stats.lastFallback ).replace( /dt=[^,]*, /, '' ); reasons[ r ] = ( reasons[ r ] || 0 ) + pool.stats.fallback - fallback; fallback = pool.stats.fallback; }
			const done = t - t0 > seconds * 1000 || ( e && untilGameTime && e.time >= untilGameTime ) || ( e && ! field.events.has( 'tsunami' ) );
			if ( done ) {

				const end = counters(), delta = start && Object.fromEntries( Object.keys( end ).map( ( k ) => [ k, end[ k ] - start[ k ] ] ) );
				resolve( { dts, cpu, rigs, wall: ( t - t0 ) / 1000, game: e ? e.time - g0 : null, engineFrames: app.engine.frame - f0, dpr: app.engine.renderScale, canvas: [ app.engine.canvas?.width, app.engine.canvas?.height ], pool: pool ? { size: pool.size, workers: pool.workers.length, disabled: !! pool.disabled, error: pool.error ?? null, delta, reasons, waitMs: pool.stats.waitMs, snapshotMs: pool.stats.snapshotMs } : null } );

			} else requestAnimationFrame( tick );

		};
		requestAnimationFrame( tick );

	} ), [ seconds, untilGameTime ] );
	const phase = async ( name, seconds, untilGameTime ) => {

		await cdp.send( 'HeapProfiler.startSampling', { samplingInterval: HEAP_INTERVAL, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } );
		await cdp.send( 'Profiler.start' );
		const f = await sample( seconds, untilGameTime );
		const { profile } = await cdp.send( 'Profiler.stop' );
		const { profile: heap } = await cdp.send( 'HeapProfiler.stopSampling' );
		const frames = Math.max( 1, f.engineFrames );
		const r = { wall: + f.wall.toFixed( 1 ), game: f.game === null ? null : + f.game.toFixed( 1 ), engineFps: + ( f.engineFrames / f.wall ).toFixed( 1 ), pageFps: + ( f.dts.length / f.wall ).toFixed( 1 ), frame: stat( f.dts ), cpuMs: stat( f.cpu ), simRigs: stat( f.rigs ), pool: f.pool, dpr: f.dpr, canvas: f.canvas, load: load(), profile: aggregate( profile, frames ), allocation: allocation( heap, frames ) };
		const gc = r.profile.files.find( ( x ) => x.k === '(garbage collector)' )?.msPerFrame ?? 0;
		log( `loop ${ name }: engine fps ${ r.engineFps }, engine cpu ms ${ JSON.stringify( r.cpuMs ) }, game s per wall s ${ r.game === null ? '-' : ( r.game / r.wall ).toFixed( 2 ) }, busy ms/frame ${ r.profile.busyMsPerFrame }, gc ms/frame ${ gc }, alloc bytes/frame ${ r.allocation.bytesPerFrame }, rigs in sim ${ JSON.stringify( r.simRigs ) }, pool ${ JSON.stringify( r.pool?.delta ) } ${ JSON.stringify( r.pool?.reasons ) }, canvas ${ r.canvas }, load ${ r.load[ 0 ] }` );
		return r;

	};
	result.loop = {};
	result.loop.idle = await phase( 'idle', 12 );
	await page.evaluate( ( [ hgt, seed ] ) => window.__app.disasters.start( 'tsunami', { intensity: hgt, warningLead: 3, seed } ), [ HEIGHT, SEED ] );
	await page.evaluate( () => window.__view( 'tsunamiFlood' ) );
	const arrival = await page.evaluate( () => window.__app.disasters.field.events.get( 'tsunami' ).arrival );
	log( 'loop: tsunami started, arrival at game s', arrival );
	result.loop.approach = await phase( 'approach', 300, arrival );
	result.loop.flood = await phase( 'flood', 40, arrival + 25 );
	save();
	await page.close();

}

// ---------------------------------------------------------------- driven frames, one page, four states
if ( part === 'bench' || part === 'both' ) {

	const { page, cdp } = await open( '?noAudio&bench' );
	await page.waitForFunction( () => window.__bench && window.__app, null, { timeout: 300_000 } );
	log( 'bench: booted' );
	await page.evaluate( async () => { await window.__app.engine.stop(); window.__bench.setSize(); } );
	const bench = async ( name ) => {

		await cdp.send( 'Profiler.start' );
		const r = await page.evaluate( async ( views ) => {

			const app = window.__app;
			const run = await window.__bench.run( { views, warm: 20, frames: 60, top: 16 } );
			let stats = null;
			for ( const k of Object.keys( app ) ) { const s = app[ k ]?.stats; if ( s && typeof s.draws === 'number' ) { stats = { owner: k, draws: s.draws, triangles: Math.round( s.triangles ?? 0 ) }; break; } }
			const e = app.disasters.field.events.get( 'tsunami' );
			return { run, stats, eventTime: e ? e.time : null, arrival: e ? e.arrival : null };

		}, VIEWS );
		const { profile } = await cdp.send( 'Profiler.stop' );
		r.profile = aggregate( profile, VIEWS.length * 80 );
		r.load = load();
		log( `bench ${ name }: ${ VIEWS.map( ( v ) => `${ v } gpu ${ r.run[ v ].gpu } (median ${ r.run[ v ].gpuMedian }) cpu ${ r.run[ v ].cpu }` ).join( ' | ' ) } | last view draws ${ r.stats?.draws } tris ${ r.stats?.triangles } | busy ms/frame ${ r.profile.busyMsPerFrame } | event t ${ r.eventTime } | load ${ r.load[ 0 ] }` );
		return r;

	};
	result.bench = {};
	result.bench.noEvent1 = await bench( 'no event 1' );
	await page.evaluate( ( [ hgt, seed ] ) => window.__app.disasters.start( 'tsunami', { intensity: hgt, warningLead: 3, seed } ), [ HEIGHT, SEED ] );
	await page.evaluate( () => window.__bench._frames( 40, 1 / 40 ) );
	result.bench.started = await bench( 'event started' );
	save();
	const at = await page.evaluate( async () => {

		const app = window.__app, field = app.disasters.field, e = field.events.get( 'tsunami' );
		const t0 = performance.now(); let frames = 0;
		while ( field.events.has( 'tsunami' ) && e.time < e.arrival + 8 ) { await window.__bench._frames( 40, 1 / 40 ); frames += 40; }
		return { time: e.time, arrival: e.arrival, running: field.events.has( 'tsunami' ), frames, wallMsPerFrame: ( performance.now() - t0 ) / Math.max( 1, frames ) };

	} );
	log( 'bench: driven to the flood', JSON.stringify( at ) );
	result.bench.driven = at;
	result.bench.flood = await bench( 'flood on land' );
	save();
	await page.evaluate( async () => { window.__app.disasters.stop(); await window.__bench._frames( 40, 1 / 40 ); } );
	result.bench.noEvent2 = await bench( 'no event 2 (stopped)' );
	await page.close();

}

result.loadEnd = load();
save();
log( 'RESULT written', out );
await browser.close();
