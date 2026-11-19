// Disaster sound and camera shake decisions (docs/disasters.md, "Sound and camera"): the level at the listener against
// distance and against each driving quantity, the speed-of-sound delay, the bound on live voices, the warning siren's
// motor and its contract, and the camera shake against its inputs. Levels are numbers in the mixer's units (dB SPL,
// LUFS) read from the decisions, never audio output. Modules are imported inside each test, so one missing module
// fails its own tests only.
import test from 'node:test';
import assert from 'node:assert/strict';

// A Web Audio double for the siren's own context: parameters take their target at once.
function fakeContext() {

	const param = ( v ) => ( { value: v, setTargetAtTime( x ) { this.value = x; }, setValueAtTime( x ) { this.value = x; } } );
	const ctx = { state: 'running', currentTime: 0, destination: { connect() {} }, oscillators: [] };
	ctx.createGain = () => ( { gain: param( 1 ), connect( n ) { return n; }, disconnect() {} } );
	ctx.createOscillator = () => {

		const o = { type: 'sine', frequency: param( 440 ), wave: null, stopped: false, connect( n ) { return n; }, disconnect() {}, start() {}, stop() { this.stopped = true; }, setPeriodicWave( w ) { this.wave = w; this.type = 'custom'; } };
		ctx.oscillators.push( o );
		return o;

	};
	ctx.createPeriodicWave = ( real, imag ) => ( { real: Array.from( real ), imag: Array.from( imag ) } );
	ctx.resume = async () => {};
	return ctx;

}

function armedSiren( TsunamiSiren ) {

	const app = { qs: new URLSearchParams(), audio: null, disasters: { globalMuted: false } };
	const siren = new TsunamiSiren( app );
	siren.ctx = fakeContext();
	siren.enabled = true;
	return siren;

}

test( 'the warning siren is a motor siren: two rotors 6:5 apart with harmonics, run up from rest, wailed by its power, swelling as its horn turns', async () => {

	const { TsunamiSiren } = await import( '../src/disasters/Siren.js' );
	const siren = armedSiren( TsunamiSiren );
	const ctx = siren.ctx, event = { time: 0 }, rows = [];
	for ( let i = 0; i <= 900; i ++ ) {

		ctx.currentTime = i * 0.05;
		event.time = ctx.currentTime;
		siren.update( event, false );
		rows.push( { t: ctx.currentTime, f: siren.nodes.map( ( o ) => o.frequency.value ), horn: siren.horn?.gain.value ?? 1 } );

	}
	const low = rows.map( ( r ) => Math.min( ...r.f ) ), top = Math.max( ...low );
	const ratio = rows[ 140 ].f[ 1 ] / rows[ 140 ].f[ 0 ];
	assert.ok( Math.abs( ratio - 1.2 ) < 0.01, `the two rotors sound a 6:5 interval: ratio ${ ratio.toFixed( 4 ) }` );
	const harmonics = siren.nodes.map( ( o ) => ( o.wave?.imag ?? [] ).slice( 2 ).filter( ( v ) => Math.abs( v ) > 0.1 ).length );
	assert.ok( harmonics.every( ( n ) => n >= 3 ), `each rotor carries harmonics above its fundamental (counts over 0.1: ${ harmonics })` );
	assert.ok( low[ 10 ] < 0.25 * top, `it runs up from rest: ${ low[ 10 ].toFixed( 0 ) } Hz at 0.5 s against ${ top.toFixed( 0 ) } Hz at speed` );
	assert.ok( top > 400 && top < 600, `full speed sits in the 400 to 600 Hz band of outdoor sirens: ${ top.toFixed( 0 ) } Hz` );
	// the wail: after the run-up the pitch falls by over a quarter as the motor coasts, then rises again
	const later = low.slice( 240 );
	const fall = 1 - Math.min( ...later ) / Math.max( ...later );
	assert.ok( fall > 0.25, `the pitch falls by ${ ( fall * 100 ).toFixed( 0 ) } % in the wail (over 25 %)` );
	const horn = rows.slice( 240 ).map( ( r ) => r.horn / Math.max( 1e-6, ( Math.min( ...r.f ) / top ) ** 1.5 ) );
	const swing = Math.min( ...horn ) / Math.max( ...horn );
	assert.ok( swing < 0.4, `the turning horn is quieter off its axis: ${ ( 20 * Math.log10( swing ) ).toFixed( 1 ) } dB` );

} );

test( 'the warning siren sounds in three-minute soundings while a warning is warranted, never for the whole event', async () => {

	const { TsunamiSiren } = await import( '../src/disasters/Siren.js' );
	const siren = armedSiren( TsunamiSiren );
	const water = { stats: { inundatedArea: 0 } };
	siren.app.disasters.field = { water };
	const ctx = siren.ctx, event = { time: 0, launched: false, arrival: 120 }, rows = [];
	for ( let i = 0; i <= 13000; i ++ ) {

		const t = i * 0.05;
		ctx.currentTime = t;
		event.time = t;
		event.launched = t > 30;
		// land under water from 150 s to 420 s; the event itself runs on (its length is not fixed)
		water.stats.inundatedArea = t > 150 && t < 420 ? 50000 : 0;
		siren.update( event, false );
		rows.push( { t, sources: siren.state.sources, sounding: siren.sounding } );

	}
	const starts = rows.filter( ( r, i ) => r.sounding && ( i === 0 || ! rows[ i - 1 ].sounding ) ).map( ( r ) => Math.round( r.t ) );
	assert.deepEqual( starts, [ 0, 300 ], `a sounding at Start, one more after the 2 minute gap while the land is flooded, none once the warning is no longer warranted: starts ${ starts }` );
	const at = ( t ) => rows[ Math.round( t / 0.05 ) ].sources;
	assert.ok( at( 100 ) === 2 && at( 400 ) === 2, 'two sources while sounding' );
	assert.ok( at( 260 ) === 0 && at( 560 ) === 0 && at( 640 ) === 0, `silent between and after soundings, once the rotor has run down: ${ at( 260 ) }, ${ at( 560 ) }, ${ at( 640 ) }` );
	assert.ok( at( 190 ) === 2, 'still sounding as it runs down just after a sounding ends' );

} );

test( 'the warning siren keeps its contract: no source before the gesture, two while it sounds, none after stop or pause, muted level zero', async () => {

	const { TsunamiSiren } = await import( '../src/disasters/Siren.js' );
	const app = { qs: new URLSearchParams(), audio: null, disasters: { globalMuted: false } };
	const unarmed = new TsunamiSiren( app );
	unarmed.update( { time: 1 }, false );
	assert.equal( unarmed.state.sources, 0, 'no source before the Start gesture arms it' );
	const siren = armedSiren( TsunamiSiren );
	siren.update( { time: 1 }, false );
	assert.equal( siren.state.sources, 2, 'two sources while it sounds' );
	const first = siren.nodes.slice();
	siren.update( { time: 1.1 }, false );
	assert.deepEqual( siren.nodes, first, 'no new sources on later updates' );
	assert.ok( siren.gain.gain.value > 0.01, `audible at the default volume: gain ${ siren.gain.gain.value }` );
	siren.muted = true;
	siren.update( { time: 1.2 }, false );
	assert.equal( siren.gain.gain.value, 0, 'muted: gain 0' );
	siren.update( { time: 1.3 }, true );
	assert.equal( siren.state.sources, 0, 'paused: no source' );
	assert.ok( first.every( ( o ) => o.stopped ), 'paused: both sources stopped' );
	siren.muted = false;
	siren.update( { time: 1.4 }, false );
	assert.equal( siren.state.sources, 2, 'resumed: two sources again' );
	siren.update( null, false );
	assert.equal( siren.state.sources, 0, 'no event: no source' );

} );

test( 'a sound is heard late by its distance over 343 m/s and quieter by 6 dB a doubling plus the air', async () => {

	const S = await import( '../src/disasters/DisasterSound.js' );
	assert.ok( Math.abs( S.arrivalDelay( 700 ) - 700 / 343 ) < 1e-9, `700 m: ${ S.arrivalDelay( 700 ) } s` );
	let last = Infinity;
	for ( let d = 10; d <= 2560; d *= 2 ) {

		const L = S.pointLevel( 92, d );
		const step = last - L;
		const expected = 20 * Math.log10( 2 ) + S.airLoss( d ) - S.airLoss( d / 2 );
		if ( last < Infinity ) assert.ok( Math.abs( step - expected ) < 1e-6, `${ d } m: ${ step.toFixed( 3 ) } dB below ${ d / 2 } m (spreading 6.02 dB plus the air's ${ ( expected - 6.0206 ).toFixed( 3 ) } dB)` );
		last = L;

	}
	const c100 = S.airCutoff( 100 ), c640 = S.airCutoff( 640 ), c2k = S.airCutoff( 2000 );
	assert.ok( c100 > 3500 && c100 < 4500, `100 m keeps about 4 kHz: ${ c100.toFixed( 0 ) } Hz` );
	assert.ok( c640 > 900 && c640 < 1100, `640 m keeps about 1 kHz: ${ c640.toFixed( 0 ) } Hz` );
	assert.ok( c2k < 400, `2 km keeps only the lows: ${ c2k.toFixed( 0 ) } Hz` );
	// the queue: an event 686 m away plays 2.0 game seconds after it happened, not before
	const q = new S.BreakQueue();
	assert.ok( q.push( S.KIND.collapse, 686, 0, 0, S.COLLAPSE_LEVEL, 0, 0, 0, 0 ), 'a building collapse 686 m away is audible' );
	const due = [];
	const sink = { playBreak( queue, i ) { due.push( queue.due[ i ] ); } };
	q.drain( 1.99, sink );
	assert.equal( due.length, 0, 'nothing heard at 1.99 s' );
	q.drain( 2.0001, sink );
	assert.equal( due.length, 1, 'heard at 2.0 s' );
	assert.ok( ! q.push( S.KIND.snap, 5000, 0, 0, S.snapLevel( 500 ), 0, 0, 0, 0 ), 'a tree snapping 5 km away is below the floor and never queued' );

} );

// An analytic flood around a listener at the origin: dry ground 1 m above the sea ahead of a front at x = front,
// water `depth` deep running toward the listener at `speed` behind it.
function floodField( state ) {

	return {
		events: new Map( [ [ 'tsunami', { kind: 'tsunami', direction: 180, firstImpact: false } ] ] ),
		paused: false,
		ambient: () => ( { x: 0, z: 0 } ),
		sample( x, y, z, out ) {

			out.wx = out.wy = out.wz = out.ax = out.ay = out.az = out.shake = 0;
			const wet = x >= state.front;
			out.height = wet ? 1 + state.depth : 0;
			out.ux = wet ? - state.speed : 0;
			out.uz = 0;
			return out;

		},
		waterAt( x ) { return x >= state.front ? 1 + state.depth : 0; },
	};

}

function app( field, extra = {} ) {

	return {
		disasters: { field, paused: false, restored: false, runSeed: 7, globalMuted: false, siren: { muted: false, volume: 0.25 }, bodies: { trees: [], bodies: new Map() }, structures: { records: [], bodies: new Map() } },
		terrainData: { heightAt: () => 1 },
		audio: null, cameraShake: null, post: null,
		...extra,
	};

}

const camera = ( x = 0, y = 2.7, z = 0 ) => ( { position: { x, y, z } } );

test( 'a tsunami is heard coming: its roar rises as the breaking front nears and is loudest as the flood reaches the listener; a long wave at sea and no flood are silent', async () => {

	const { DisasterSound } = await import( '../src/disasters/DisasterSound.js' );
	const state = { front: 1e9, depth: 2, speed: 6 };
	const ds = new DisasterSound( app( floodField( state ) ) );
	const sweep = () => {

		for ( let i = 0; i < 16; i ++ ) ds.update( 1 / 60, camera() );
		return { level: ds.state.level, front: ds.state.front };

	};
	const silent = sweep();
	assert.ok( silent.level < - 66, `no flood: silent (${ silent.level })` );
	const rows = [];
	for ( const front of [ 1500, 900, 500, 260, 130, 60, 30, 14, 4, - 30 ] ) {

		state.front = front;
		rows.push( { staged: front, ...sweep() } );

	}
	const report = rows.map( ( r ) => `${ r.staged } m: ${ r.level.toFixed( 1 ) } LUFS (front heard at ${ r.front } m)` ).join( ', ' );
	for ( let i = 1; i < rows.length - 1; i ++ ) assert.ok( rows[ i ].level >= rows[ i - 1 ].level - 0.5, `rises as the front nears: ${ report }` );
	assert.ok( rows.at( - 2 ).level - rows[ 0 ].level >= 15, `at least 15 dB louder at the listener than 1.5 km off: ${ report }` );
	const peak = rows.reduce( ( a, b ) => ( b.level > a.level ? b : a ) );
	assert.ok( peak.staged <= 14, `loudest as the flood reaches the listener (peak with the front at ${ peak.staged } m): ${ report }` );
	assert.ok( rows.every( ( r ) => r.level <= - 9 + 4.8 + 1e-9 ), `three beds each under the -9 LUFS ceiling: ${ report }` );
	for ( const r of rows ) assert.ok( r.front >= r.staged && r.front <= Math.max( 2 * r.staged, 6 ), `the front is placed within one ring of where it is: ${ report }` );
	// the sea drawing back (the water at every cell falling 0.2 m/s) has no breaking face: at least 9 dB under the same
	// flow standing or rising, and no front (a 2.5 m/s flow, so no bed reaches its ceiling and hides the difference)
	const drain = { front: - 2000, depth: 1.5, speed: 2.5 };
	const drawdown = new DisasterSound( app( floodField( drain ) ) );
	const steady = new DisasterSound( app( floodField( { front: - 2000, depth: 1.5, speed: 2.5 } ) ) );
	for ( let i = 0; i < 48; i ++ ) {

		drain.depth = Math.max( 0.3, 1.5 - 0.2 * i / 60 );
		drawdown.update( 1 / 60, camera( 0, 6, 0 ) );
		steady.update( 1 / 60, camera( 0, 6, 0 ) );

	}
	assert.ok( steady.state.level - drawdown.state.level >= 9, `draining water is quieter than the same flow standing: ${ drawdown.state.level.toFixed( 1 ) } against ${ steady.state.level.toFixed( 1 ) } LUFS` );
	assert.ok( drawdown.state.front > 1600, `draining water is no front: ${ drawdown.state.front }` );
	// the same water as a long wave at sea: 40 m deep at 0.6 m/s is not breaking, so it makes no roar
	Object.assign( state, { front: 50, depth: 40, speed: 0.6 } );
	const sea = sweep();
	assert.ok( sea.level < - 66, `a long wave at sea is silent: ${ sea.level }` );

} );

test( 'a tornado two kilometres off is a low rumble and a roar close in; its own wind at the camera drives the gale, the ambient wind does not', async () => {

	const { DisasterField } = await import( '../src/disasters/Field.js' );
	const { tornadoMotionParams } = await import( '../src/disasters/TornadoMotion.js' );
	const { DisasterSound } = await import( '../src/disasters/DisasterSound.js' );
	const field = new DisasterField( () => 0 );
	field.ambient = () => ( { x: 6, z: 0 } );
	field.start( 'tornado', { x: 0, z: 0, speed: 0, direction: 0, intensity: 65, radius: 100, duration: 60 } );
	const e = field.events.get( 'tornado' );
	e.seed = 0;
	e.motion = tornadoMotionParams( 0, 0 );
	for ( let i = 0; i < 30; i ++ ) field.advance( 0.1 );
	const c = field.center( e );
	const rows = [];
	for ( const d of [ 30, 100, 500, 2000 ] ) {

		const ds = new DisasterSound( app( field ) );
		for ( let i = 0; i < 4; i ++ ) ds.update( 1 / 60, camera( c.x + d, 2, c.z ) );
		rows.push( { d, vortex: ds.state.vortex, cutoff: ds.state.vortexCutoff, gale: ds.state.gale, wind: ds.listener.wind } );

	}
	const report = rows.map( ( r ) => `${ r.d } m: ${ r.vortex.toFixed( 1 ) } LUFS below ${ r.cutoff.toFixed( 0 ) } Hz, gale ${ r.gale.toFixed( 1 ) } at ${ r.wind.toFixed( 1 ) } m/s` ).join( '; ' );
	for ( let i = 1; i < rows.length; i ++ ) assert.ok( rows[ i ].vortex < rows[ i - 1 ].vortex, `quieter with distance: ${ report }` );
	assert.ok( rows[ 1 ].vortex > - 20, `a roar at 100 m: ${ report }` );
	assert.ok( rows[ 3 ].vortex < - 38 && rows[ 3 ].cutoff < 400, `a low rumble at 2 km: ${ report }` );
	assert.ok( rows[ 0 ].gale > rows[ 2 ].gale, `the gale at the camera follows the vortex's wind: ${ report }` );
	assert.ok( rows[ 3 ].wind < 3, `at 2 km the event's own wind is near calm (the ambient 6 m/s is not counted): ${ report }` );
	field.stop?.();
	const calm = new DisasterField( () => 0 );
	calm.ambient = () => ( { x: 25, z: 0 } );
	const ds = new DisasterSound( app( calm ) );
	for ( let i = 0; i < 4; i ++ ) ds.update( 1 / 60, camera( 0, 2, 0 ) );
	assert.ok( ds.state.vortex === - Infinity && ds.state.gale === - Infinity, `no event: no tornado sound in a 25 m/s ambient wind (${ ds.state.vortex }, ${ ds.state.gale })` );

} );

test( 'an earthquake rumbles with the ground acceleration at the listener and is silent before its waves arrive', async () => {

	const { DisasterField } = await import( '../src/disasters/Field.js' );
	const { DisasterSound } = await import( '../src/disasters/DisasterSound.js' );
	const level = ( intensity, time ) => {

		const field = new DisasterField( () => 0 );
		field.start( 'earthquake', { x: 0, z: 0, intensity, radius: 400, speed: 100, duration: 30, frequency: 2 } );
		const steps = Math.round( time / 0.05 );
		for ( let i = 0; i < steps; i ++ ) field.advance( 0.05 );
		const ds = new DisasterSound( app( field ) );
		for ( let i = 0; i < 4; i ++ ) ds.update( 1 / 60, camera( 150, 1.7, 0 ) );
		return { quake: ds.state.quake, a: ds.listener.shake };

	};
	const before = level( 0.7, 1 ), weak = level( 0.15, 4 ), strong = level( 0.6, 4 );
	assert.equal( before.quake, - Infinity, `silent before the waves reach 150 m at 100 m/s (1.5 s): ${ before.quake }` );
	const rise = strong.quake - weak.quake, expected = 20 * Math.log10( strong.a / weak.a );
	assert.ok( strong.quake > weak.quake && Math.abs( rise - expected ) < 0.5, `louder with the acceleration: ${ weak.quake.toFixed( 1 ) } at ${ weak.a.toFixed( 2 ) } m/s2, ${ strong.quake.toFixed( 1 ) } at ${ strong.a.toFixed( 2 ) } m/s2 (20 log10 of the ratio is ${ expected.toFixed( 1 ) } dB)` );

} );

// A mixer double that counts live disaster voices: the decision under test is which breaks DisasterSound plays.
function countingMixer() {

	return { enabled: true, muted: false, voices: 0, played: [], beds: new Map(), get disasterVoices() { return this.voices; }, get disasterSources() { return this.voices + this.beds.size; }, get disasterNodes() { return 0; }, setDisasterGain() {}, disasterBed( key, bank, lufs ) { if ( lufs > - 66 ) this.beds.set( key, lufs ); else this.beds.delete( key ); }, disasterShot( bank, x, y, z, lufs ) { this.voices ++; this.played.push( { bank, x, lufs } ); return {}; } };

}

test( 'breaking things: each failure is heard once where it happens, at most 12 voices live and the loudest kept, strikes found from the change of velocity', async () => {

	const { DisasterSound, MAX_VOICES, snapLevel } = await import( '../src/disasters/DisasterSound.js' );
	const field = { events: new Map( [ [ 'earthquake', { kind: 'earthquake' } ] ] ), ambient: null, sample( x, y, z, out ) { out.wx = out.wy = out.wz = out.ax = out.ay = out.az = out.shake = out.height = out.ux = out.uz = 0; return out; }, waterAt: () => - 5 };
	const trees = [];
	for ( let i = 0; i < 30; i ++ ) trees.push( { r: { x: 20 + i * 15, y: 2, z: 0, H: 12 }, mode: undefined, phase: undefined, piece: { mass: 500 } } );
	const mixer = countingMixer();
	const A = app( field, { audio: mixer } );
	A.disasters.bodies.trees = trees;
	const ds = new DisasterSound( A );
	ds.update( 1 / 60, camera() );
	for ( const t of trees ) {

		t.mode = 'snap';
		t.phase = 'hinge';

	}
	ds.update( 1 / 60, camera() );
	ds.update( 1 / 60, camera() );
	assert.equal( ds.queue.n, 30, `each of the 30 snapping trees queued once: ${ ds.queue.n }` );
	for ( let i = 0; i < 240; i ++ ) ds.update( 1 / 60, camera() );
	assert.ok( mixer.voices <= MAX_VOICES, `at most ${ MAX_VOICES } live voices: ${ mixer.voices }` );
	assert.equal( mixer.voices, MAX_VOICES, 'the bound is reached, not undershot' );
	const played = mixer.played.map( ( p ) => p.x ).sort( ( a, b ) => a - b );
	assert.deepEqual( played, trees.slice( 0, MAX_VOICES ).map( ( t ) => t.r.x ), `the nearest (loudest) are the ones played: ${ played }` );
	assert.ok( mixer.played.every( ( p ) => p.bank === 'dis_crack' ), 'a snapping trunk cracks' );
	assert.ok( Math.abs( mixer.played[ 0 ].lufs - ( snapLevel( 500 ) - 20 * Math.log10( 20 / 10 ) - 4.7 * 0.02 - 100 ) ) < 0.01, `level at 20 m: ${ mixer.played[ 0 ].lufs }` );
	// strikes: a 1 t body falling at 10 m/s stops on the ground; another accelerates smoothly in the wind
	const mixer2 = countingMixer();
	const B = app( field, { audio: mixer2 } );
	const falling = { id: 1, mass: 1000, position: { x: 30, y: 20, z: 0 } }, blown = { id: 2, mass: 1000, position: { x: - 30, y: 5, z: 0 } };
	B.disasters.bodies.bodies.set( 1, falling );
	B.disasters.bodies.bodies.set( 2, blown );
	const ds2 = new DisasterSound( B );
	let vBlown = 0;
	for ( let i = 0; i < 60; i ++ ) {

		if ( i < 30 ) falling.position.y -= 10 / 60;
		vBlown += 12 / 60;
		blown.position.x -= vBlown / 60;
		ds2.update( 1 / 60, camera() );

	}
	const hits = mixer2.played.length + ds2.queue.n;
	assert.equal( hits, 1, `one strike (the landing), none for the body the wind accelerates: ${ hits }` );

} );

test( 'the camera shake follows what would shake a person holding it, stays under its ceiling, is zero with no event, and leaves the pose exactly as it was', async () => {

	const { CameraShake, ROT_CEILING, POS_CEILING } = await import( '../src/core/CameraShake.js' );
	const { PerspectiveCamera } = await import( '../src/engine/index.js' );
	const g = 9.81;
	const run = ( input, seconds = 3, opts = {} ) => {

		const shake = new CameraShake( { reducedMotion: false, ...opts } );
		shake.reseed( 11 );
		let rot = 0, pos = 0;
		for ( let i = 0, n = Math.round( seconds * 60 ); i < n; i ++ ) {

			const t = i / 60, ph = 2 * Math.PI * 2 * t;
			const a = input.a ?? 0;
			shake.step( 1 / 60, { active: input.active ?? true, ax: a * Math.sin( ph ), ay: 0.35 * a * Math.sin( ph * 1.3 ), az: 0.8 * a * Math.cos( ph * 0.83 ), coupling: input.coupling ?? 1, wind: input.wind ?? 0 }, 0, - 1 );
			if ( input.kick && i === 70 ) shake.kick( input.kick );
			if ( t > 1 ) {

				const o = shake.offset;
				rot = Math.max( rot, Math.abs( o.pitch ), Math.abs( o.yaw ), Math.abs( o.roll ) );
				pos = Math.max( pos, Math.hypot( o.x, o.y, o.z ) );

			}

		}
		return { rot, pos, shake };

	};
	assert.equal( run( { a: 0.7 * g, active: false } ).rot, 0, 'no event: no shake' );
	const quake = [ 0.05, 0.1, 0.3, 0.7, 1.5 ].map( ( k ) => ( { k, ...run( { a: k * g } ) } ) );
	const report = quake.map( ( q ) => `${ q.k } g: ${ ( q.rot * 180 / Math.PI ).toFixed( 2 ) } deg, ${ ( q.pos * 100 ).toFixed( 1 ) } cm` ).join( '; ' );
	for ( let i = 1; i < quake.length; i ++ ) assert.ok( quake[ i ].rot > quake[ i - 1 ].rot, `stronger shaking tilts the camera more: ${ report }` );
	assert.ok( quake.every( ( q ) => q.rot <= ROT_CEILING && q.pos <= POS_CEILING ), `never past ${ ( ROT_CEILING * 180 / Math.PI ).toFixed( 1 ) } deg or ${ POS_CEILING * 100 } cm: ${ report }` );
	const mmi6 = quake[ 1 ].rot * 180 / Math.PI;
	assert.ok( mmi6 > 0.15 && mmi6 < 0.6, `0.1 g (MMI VI) tilts it 0.25 to 0.4 deg give or take: ${ report }` );
	const disp = quake[ 3 ].pos;
	assert.ok( disp > 0.025 && disp < 0.07, `a 0.7 g quake at 2 Hz moves it with the ground, about 4 cm: ${ report }` );
	assert.ok( run( { a: 0.7 * g, coupling: 0 } ).rot === 0, 'a camera high above the ground is not shaken by it' );
	const calm = run( { wind: 15 } ).rot, gale = run( { wind: 25 } ).rot, vortex = run( { wind: 70 } ).rot;
	assert.ok( calm === 0 && gale > 0 && vortex > gale && vortex <= ROT_CEILING, `wind buffets only above gale force: 15 m/s ${ calm }, 25 m/s ${ gale.toFixed( 4 ) }, 70 m/s ${ vortex.toFixed( 4 )} rad` );
	const kicked = run( { kick: 0.01 }, 1.6 );
	assert.ok( kicked.rot > 0.005, `a kick jolts the camera: ${ kicked.rot }` );
	const settled = run( { kick: 0.01 }, 4 );
	assert.ok( Math.abs( settled.shake.offset.pitch ) + Math.abs( settled.shake.offset.yaw ) + Math.abs( settled.shake.offset.roll ) < 0.0005, 'and settles within a few seconds' );
	assert.equal( run( { a: 0.7 * g, wind: 70 }, 3, { reducedMotion: true } ).rot, 0, 'reduced motion: no shake' );
	// the pose: applied after every owner set it, taken away after the frame, never stored
	const cam = new PerspectiveCamera( 60, 1.5, 0.1, 1000 );
	cam.position.set( 12.25, 3.5, - 7.125 );
	cam.rotation.set( - 0.3, 2.9, 0.05, 'YXZ' );
	cam.updateMatrixWorld();
	const pose = () => [ cam.position.x, cam.position.y, cam.position.z, cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w, cam.rotation.x, cam.rotation.y, cam.rotation.z, ...cam.matrixWorld.elements ];
	const before = pose();
	const shake = new CameraShake( { reducedMotion: false } );
	shake.reseed( 3 );
	let moved = false;
	for ( let i = 0; i < 90; i ++ ) {

		shake.apply( cam, 1 / 60, { active: true, ax: 0.7 * g * Math.sin( i * 0.2 ), ay: 0, az: 0.5 * g * Math.cos( i * 0.17 ), coupling: 1, wind: 40 } );
		if ( pose().some( ( v, k ) => v !== before[ k ] ) ) moved = true;
		shake.restore( cam );
		assert.deepEqual( pose(), before, `frame ${ i }: the pose is exactly restored` );

	}
	assert.ok( moved, 'the shake moved the camera while applied' );
	const idle = new CameraShake( { reducedMotion: false } );
	idle.apply( cam, 1 / 60, { active: false, ax: 5, ay: 0, az: 0, coupling: 1, wind: 50 } );
	assert.deepEqual( pose(), before, 'no event: the camera is not touched' );
	idle.restore( cam );

} );

test( 'water on the lens: the flood passing the camera wets it as surfacing does', async () => {

	const { LensDroplets } = await import( '../src/post/LensDroplets.js' );
	const { DisasterSound } = await import( '../src/disasters/DisasterSound.js' );
	const lens = new LensDroplets();
	const state = { front: 1e9, depth: 1.5, speed: 5 };
	const ds = new DisasterSound( app( floodField( state ), { post: { lens } } ) );
	for ( let i = 0; i < 30; i ++ ) ds.update( 1 / 60, camera( 0, 3.2, 0 ) );
	assert.equal( lens.wet.value, 0, 'dry while the flood is far off' );
	state.front = - 40;
	for ( let i = 0; i < 4; i ++ ) ds.update( 1 / 60, camera( 0, 3.2, 0 ) );
	assert.ok( lens.wet.value >= 0.4 && lens.age.value === 0, `the flood running past at 5 m/s, its surface 0.7 m below the lens, wets it: wet ${ lens.wet.value }` );
	lens.update( 1, false );
	assert.ok( lens.wet.value < 1 && lens.age.value === 1, 'and it dries as after surfacing' );

} );
