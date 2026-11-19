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
	assert.ok( siren.gain.gain.value > 0, `audible at the default volume: gain ${ siren.gain.gain.value }` );
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
			out.ux = wet ? state.ux ?? - state.speed : 0;
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
		// the person holding the camera, standing on the ground (1 m) under it: the default camera's lens is at their eye
		player: { mode: 'walk', position: { x: 0, y: 1, z: 0 } },
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

test( 'breaking things: each failure is heard once where it happens, at most 12 voices live and the loudest kept', async () => {

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

// A field with an event running and nothing in it: the decisions under test are the bodies' and the mixer's.
const quietField = () => ( { events: new Map( [ [ 'earthquake', { kind: 'earthquake' } ] ] ), ambient: null, sample( x, y, z, out ) { out.wx = out.wy = out.wz = out.ax = out.ay = out.az = out.shake = out.height = out.ux = out.uz = 0; return out; }, waterAt: () => - 5 } );

// The rigid-body solver's clock as rally-physics/src/lib.rs advance() runs it: the frame's seconds (at most 0.1) go into
// an accumulator that is spent in whole fixed steps of 1/120 s, at most 12 a frame, so a frame holds zero, one, two or
// more steps. The body records are synced to the pose after the last step (Bodies.sync); disaster_motion() reports the
// solver's own position and linear velocity, seven floats a body.
function fixedStepSolver( bodies, stepBody ) {

	const DT = 1 / 120;
	let remainder = 0, time = 0;
	return {
		physics: {
			disaster_motion() {

				const out = new Float32Array( bodies.length * 7 );
				bodies.forEach( ( b, k ) => out.set( [ b.id, b.position.x, b.position.y, b.position.z, b.v.x, b.v.y, b.v.z ], k * 7 ) );
				return out;

			},
		},
		advance( seconds ) {

			remainder += Math.min( Math.max( seconds, 0 ), 0.1 );
			let steps = 0;
			while ( remainder >= DT && steps < 12 ) {

				for ( const b of bodies ) stepBody( b, DT, time );
				time += DT;
				remainder -= DT;
				steps ++;

			}
			if ( remainder >= DT ) remainder %= DT;
			return steps;

		},
	};

}

test( 'a body at a steady speed, stepped in whole solver steps under uneven frames, strikes nothing; stopped dead in one solver step it strikes once', async () => {

	const { DisasterSound } = await import( '../src/disasters/DisasterSound.js' );
	const { mulberry32 } = await import( '../src/util/Noise.js' );
	const rates = [ [ '50 Hz', () => 1 / 50 ], [ '60 Hz with 1 ms of jitter', ( r ) => 1 / 60 + ( r() - 0.5 ) * 0.002 ], [ '144 Hz', () => 1 / 144 ] ];
	// a 400 kg body: 10 m/s along x (stopping dead at 2 s of solver time when `stop`), or accelerated smoothly from rest
	// at 12 m/s^2 by the wind
	const run = ( frameDt, motion, frames ) => {

		const body = { id: 200001, mass: 400, position: { x: - 30, y: 1, z: 4 }, v: { x: motion === 'wind' ? 0 : 10, y: 0, z: 0 } };
		const solver = fixedStepSolver( [ body ], ( b, h, t ) => {

			if ( motion === 'stop' && t >= 2 ) b.v.x = 0;
			if ( motion === 'wind' ) b.v.x += 12 * h;
			b.position.x += b.v.x * h;

		} );
		const mixer = countingMixer(), kicks = { n: 0 };
		const A = app( quietField(), { audio: mixer, rally: { physics: solver.physics }, cameraShake: { kick() { kicks.n ++; }, reseed() {} } } );
		A.disasters.bodies.bodies.set( body.id, body );
		const ds = new DisasterSound( A ), rand = mulberry32( 5 );
		for ( let i = 0; i < frames; i ++ ) {

			const dt = frameDt( rand );
			solver.advance( dt );
			ds.update( dt, camera() );

		}
		return { heard: mixer.played.length + ds.queue.n, kicks: kicks.n };

	};
	const report = ( motion, frames ) => rates.map( ( [ name, f ] ) => [ name, run( f, motion, frames ) ] );
	const steady = report( 'steady', 600 ), wind = report( 'wind', 300 ), stop = report( 'stop', 300 );
	const text = ( rows ) => rows.map( ( [ name, n ] ) => `${ name }: ${ n.heard } heard, ${ n.kicks } camera kicks` ).join( '; ' );
	assert.ok( steady.every( ( [ , n ] ) => n.heard === 0 && n.kicks === 0 ), `strikes heard at 50, 60 (with 1 ms jitter) and 144 Hz from a body at a steady 10 m/s are each 0: ${ text( steady ) }` );
	assert.ok( wind.every( ( [ , n ] ) => n.heard === 0 && n.kicks === 0 ), `strikes heard from a body the wind accelerates smoothly are each 0: ${ text( wind ) }` );
	assert.ok( stop.every( ( [ , n ] ) => n.heard === 1 && n.kicks === 1 ), `the body stopped dead in one solver step is one strike, heard and felt once at each rate: ${ text( stop ) }` );

} );

// The allowance for continuous load (DisasterSound CONTINUOUS_ACCEL, 50 m/s^2 times the frame): a frame can hold the
// solver's twelve catch-up steps (0.1 s), over which the flood's drag alone changes a carried car's velocity by 4.5 m/s
test( 'in a frame holding twelve solver steps a car carried by the flood at the strongest steady load is not a strike, and a 400 kg body stopped dead from 8 m/s is', async () => {

	const { DisasterSound } = await import( '../src/disasters/DisasterSound.js' );
	// 0.1 s frames (twelve 1/120 s steps each); a 1,500 kg car pushed at 45 m/s^2 (the solver's cap on an applied
	// acceleration) for 1 s and dragged back as hard for 1 s; a 400 kg body at 8 m/s stopped dead at 1 s
	const run = ( kind ) => {

		const body = kind === 'carried' ? { id: 200002, mass: 1500, position: { x: - 30, y: 1, z: 4 }, v: { x: 0, y: 0, z: 0 } } : { id: 200003, mass: 400, position: { x: - 30, y: 1, z: 4 }, v: { x: 8, y: 0, z: 0 } };
		const solver = fixedStepSolver( [ body ], ( b, h, t ) => {

			if ( kind === 'carried' ) b.v.x += ( t < 1 ? 45 : - 45 ) * h;
			else if ( t >= 1 ) b.v.x = 0;
			b.position.x += b.v.x * h;

		} );
		const mixer = countingMixer(), kicks = { n: 0 };
		const A = app( quietField(), { audio: mixer, rally: { physics: solver.physics }, cameraShake: { kick( a ) { if ( a > 0 ) kicks.n ++; }, reseed() {} } } );
		A.disasters.bodies.bodies.set( body.id, body );
		const ds = new DisasterSound( A );
		for ( let i = 0; i < 25; i ++ ) {

			solver.advance( 0.1 );
			ds.update( 0.1, camera() );

		}
		return { heard: mixer.played.length + ds.queue.n, kicks: kicks.n };

	};
	const carried = run( 'carried' ), stopped = run( 'stopped' );
	assert.ok( carried.heard === 0 && carried.kicks === 0, `the carried car (4.5 m/s a frame of steady load) strikes nothing: ${ carried.heard } heard, ${ carried.kicks } kicks` );
	assert.ok( stopped.heard === 1 && stopped.kicks === 1, `the body stopped dead from 8 m/s in a 0.1 s frame is one strike: ${ stopped.heard } heard, ${ stopped.kicks } kicks` );

} );

test( 'water running past the lens at a steady speed shakes the camera without a kick, keeps the lens wet without new drops on a clock, and its backwash is heard as the flow turns back, not on a clock', async () => {

	const { DisasterSound } = await import( '../src/disasters/DisasterSound.js' );
	const { CameraShake } = await import( '../src/core/CameraShake.js' );
	const { LensDroplets } = await import( '../src/post/LensDroplets.js' );
	// 21 s of the same flow at the listener (the lens 0.7 m above a 1 m flood): the first second is the flow arriving
	// (the front's crash and its surge may kick once), the next 20 s are steady
	const run = ( speed, ux ) => {

		const shake = new CameraShake( { reducedMotion: false } );
		shake.reseed( 11 );
		const kick = shake.kick.bind( shake );
		let kicks = 0, rot = 0, drops = 0;
		shake.kick = ( a, hz ) => {

			kicks ++;
			kick( a, hz );

		};
		const lens = new LensDroplets(), mixer = countingMixer();
		const ds = new DisasterSound( app( floodField( { front: - 1e9, depth: 1, speed, ux } ), { audio: mixer, cameraShake: shake, post: { lens } } ) );
		let seed = null, backwash = 0;
		for ( let i = 0; i < 21 * 60; i ++ ) {

			ds.update( 1 / 60, camera() );
			const o = shake.step( 1 / 60, ds.listener, 0, - 1 );
			lens.update( 1 / 60, false );
			if ( i === 59 ) {

				kicks = 0;
				seed = lens.seed.value;
				backwash = mixer.played.filter( ( p ) => p.bank === 'surf_backwash' ).length;

			}
			if ( i >= 60 ) {

				rot = Math.max( rot, Math.abs( o.pitch ), Math.abs( o.yaw ), Math.abs( o.roll ) );
				if ( lens.seed.value !== seed ) drops ++;
				seed = lens.seed.value;

			}

		}
		const backwashLater = mixer.played.filter( ( p ) => p.bank === 'surf_backwash' ).length - backwash;
		return { kicks, rot, drops, wet: lens.wet.value, backwash, backwashLater, flux: 1025 * speed * speed };

	};
	const slow = run( 3 ), fast = run( 5 ), back = run( 3, 3 );
	const text = [ slow, fast ].map( ( r ) => `${ ( r.flux / 1000 ).toFixed( 1 ) } kN/m: ${ r.kicks } kicks, ${ ( r.rot * 180 / Math.PI ).toFixed( 3 ) } deg, ${ r.drops } new drop patterns, wet ${ r.wet.toFixed( 2 ) }` ).join( '; ' );
	assert.ok( slow.kicks === 0 && fast.kicks === 0, `kicks in 20 s of steady flow are 0: ${ text }` );
	assert.ok( slow.rot > 0 && fast.rot > slow.rot, `the shake amplitude is above zero and rises with the flux: ${ text }` );
	assert.ok( slow.drops === 0 && fast.drops === 0 && slow.wet > 0.3 && fast.wet > 0.3, `the running water keeps the lens wet with the same drops, none thrown on afresh on a clock: ${ text }` );
	assert.ok( back.backwash === 1 && back.backwashLater === 0, `the backwash is heard once as the flow turns back and not again while it runs back steadily: ${ back.backwash } at the turn, ${ back.backwashLater } in the next 20 s` );

} );

// A camera kick only for an event the physics produced: the water's hold on whoever holds the camera rises from zero
// as the water climbs them, so its rate is the water's own and a surface that wavers is not a surge.
test( 'a flood whose surface wavers across the lens\'s reach in steady flow kicks nothing; the water rising fast past a person standing in it does', async () => {

	const { DisasterSound } = await import( '../src/disasters/DisasterSound.js' );
	// a person standing on the ground (1 m), the lens at eye height (2.7 m), 1.5 m above 0.2 m of water: the edge of the
	// lens's reach. Kicks are counted after the first second (the water arriving).
	const run = ( depthAt, speed, seconds = 21 ) => {

		const state = { front: - 1e9, depth: depthAt( 0 ), speed };
		let kicks = 0, late = 0;
		const ds = new DisasterSound( app( floodField( state ), { cameraShake: { kick( a ) { if ( a > 0 ) kicks ++; }, reseed() {} } } ) );
		for ( let i = 0; i < seconds * 60; i ++ ) {

			state.depth = depthAt( i / 60 );
			if ( i === 60 ) late = kicks;
			ds.update( 1 / 60, camera() );

		}
		return kicks - late;

	};
	const waver3 = run( ( t ) => 0.2 + 0.03 * Math.sin( 2 * Math.PI * 0.5 * t ), 5 );
	const waver5 = run( ( t ) => 0.2 + 0.05 * Math.sin( 2 * Math.PI * 0.3 * t ), 6 );
	assert.ok( waver3 === 0 && waver5 === 0, `kicks in 20 s are 0 (surface wavering 3 cm at 0.5 Hz, flow 5 m/s): ${ waver3 }; (5 cm at 0.3 Hz, 6 m/s): ${ waver5 }` );
	// the control: the water rising from 5 cm to 0.6 m in under 0.3 s at 5 m/s past the same person is an event
	const surge = run( ( t ) => ( t < 3 ? 0.05 : Math.min( 0.6, 0.05 + ( t - 3 ) * 2 ) ), 5, 6 );
	assert.ok( surge >= 1, `the water rising 0.55 m in 0.3 s at 5 m/s past a person standing in it kicks the camera: ${ surge } kicks` );
	// a new holder is not a surge: standing in 0.6 m at 5 m/s, then aboard a boat, then swimming, then standing, each a second
	const state = { front: - 1e9, depth: 0.6, speed: 5 }, modes = [ 'walk', 'boat', 'swim', 'walk', 'deck', 'jetski-thrown' ];
	let swaps = 0, late = 0;
	const owner = new DisasterSound( app( floodField( state ), { cameraShake: { kick( a ) { if ( a > 0 ) swaps ++; }, reseed() {} } } ) );
	for ( let i = 0; i < 13 * 60; i ++ ) {

		owner.app.player.mode = modes[ Math.floor( i / 60 ) % modes.length ];
		if ( i === 60 ) late = swaps;
		owner.update( 1 / 60, camera() );

	}
	assert.equal( swaps - late, 0, `changing who holds the camera in mid-flood (on foot, a boat, swimming, on foot, a deck, thrown in) kicks nothing: ${ swaps - late } kicks in 12 s` );

} );

test( 'a thin backwash whose depth wavers across the wet line is heard once, and again only after the water stops running back', async () => {

	const { DisasterSound } = await import( '../src/disasters/DisasterSound.js' );
	// water running back at 3 m/s against the wave's heading, 5 cm deep give or take 2 cm, for 20 s; then it stops and
	// runs back again
	const state = { front: - 1e9, depth: 0.05, speed: 3, ux: 3 }, mixer = countingMixer();
	const ds = new DisasterSound( app( floodField( state ), { audio: mixer } ) );
	const heard = () => mixer.played.filter( ( p ) => p.bank === 'surf_backwash' ).length;
	for ( let i = 0; i < 20 * 60; i ++ ) {

		state.depth = 0.05 + 0.02 * Math.sin( 2 * Math.PI * 0.5 * i / 60 );
		ds.update( 1 / 60, camera() );
		mixer.voices = 0;

	}
	const wavering = heard();
	state.depth = 0.3;
	state.ux = 0;
	for ( let i = 0; i < 60; i ++ ) ds.update( 1 / 60, camera() );
	state.ux = 3;
	for ( let i = 0; i < 60; i ++ ) ds.update( 1 / 60, camera() );
	assert.ok( wavering === 1 && heard() === 2, `the backwash is heard once while its depth wavers across 5 cm (${ wavering } in 20 s) and once more after the water stopped and ran back again (${ heard() - wavering })` );

} );

test( 'a camera held on a deck above deep moving water is not shaken by it; a person standing in it is, as the water climbs their legs', async () => {

	const { DisasterSound } = await import( '../src/disasters/DisasterSound.js' );
	const { CameraShake } = await import( '../src/core/CameraShake.js' );
	// 8 m of harbour running at 2 m/s: the bed at -7 m, the surface at 1 m (floodField's surface is 1 m plus `depth`)
	const flowWith = ( extra, cam, ground = - 7, depth = 0, speed = 2 ) => {

		const ds = new DisasterSound( app( floodField( { front: - 1e9, depth, speed } ), { terrainData: { heightAt: () => ground }, ...extra } ) );
		for ( let i = 0; i < 3; i ++ ) ds.update( 1 / 60, cam );
		return ds;

	};
	const low = camera( 0, 2.3, 0 ); // a third-person camera 1.3 m over the water, within the lens's old reach
	const deck = flowWith( { player: { mode: 'deck', position: { x: 0, y: 2, z: 0 } } }, low ).listener.flow;
	const pier = flowWith( { player: { mode: 'walk', position: { x: 0, y: 2, z: 0 } } }, low ).listener.flow;
	const helm = flowWith( { player: { mode: 'boat', position: { x: 0, y: 1.4, z: 0 } } }, low ).listener.flow;
	const free = flowWith( { freeCam: true }, camera( 0, 2.5, 0 ) ).listener.flow;
	const report = `deck ${ deck.toFixed( 0 ) }, pier ${ pier.toFixed( 0 ) }, helm ${ helm.toFixed( 0 ) }, free camera ${ free.toFixed( 0 ) } N/m`;
	assert.ok( deck === 0 && pier === 0 && helm === 0 && free === 0, `the flow input is 0 with 8 m of water at 2 m/s under a deck 1 m above the surface: ${ report }` );
	// a person standing in 0.5 m of the same flow (the ground at 0.5 m) is shaken, by the water on their legs
	const standing = flowWith( {}, camera( 0, 2.12, 0 ), 0.5 );
	standing.app.player.position.y = 0.5;
	for ( let i = 0; i < 3; i ++ ) standing.update( 1 / 60, camera( 0, 2.12, 0 ) );
	const wading = standing.listener.flow;
	const shake = new CameraShake( { reducedMotion: false } );
	shake.reseed( 5 );
	let rot = 0;
	for ( let i = 0; i < 180; i ++ ) {

		standing.update( 1 / 60, camera( 0, 2.12, 0 ) );
		const o = shake.step( 1 / 60, standing.listener, 0, - 1 );
		rot = Math.max( rot, Math.abs( o.pitch ), Math.abs( o.roll ) );

	}
	assert.ok( Math.abs( wading - 1025 * 0.5 * 4 ) < 1 && rot > 0, `a person standing in 0.5 m of the same flow is shaken: ${ wading.toFixed( 0 ) } N/m (rho h u^2 with h 0.5 m is 2050), ${ ( rot * 180 / Math.PI ).toFixed( 4 ) } deg` );
	// the water climbing a person from their feet: the input rises from zero with no step and stops at leg height
	const climb = [];
	const person = flowWith( {}, camera( 0, 2.12, 0 ), 0.5, - 0.5, 4 );
	person.app.player.position.y = 0.5;
	for ( let d = 0; d <= 1.2001; d += 0.01 ) {

		person.app.disasters.field.sample = ( x, y, z, out ) => Object.assign( out, { wx: 0, wy: 0, wz: 0, ax: 0, ay: 0, az: 0, shake: 0, height: 0.5 + d, ux: - 4, uz: 0 } );
		person.update( 1 / 60, camera( 0, 2.12, 0 ) );
		climb.push( person.listener.flow );

	}
	const step = Math.max( ...climb.slice( 1 ).map( ( f, k ) => f - climb[ k ] ) );
	assert.ok( climb[ 0 ] === 0 && step <= 1025 * 0.0101 * 16 && climb.at( - 1 ) === climb[ 100 ] && climb.at( - 1 ) > 0, `the input rises from 0 as the water climbs the legs, by at most rho u^2 x 1 cm a centimetre (${ step.toFixed( 0 ) } N/m), and holds at leg height: ${ climb[ 0 ] }, ${ climb[ 50 ].toFixed( 0 ) } at 0.5 m, ${ climb[ 100 ].toFixed( 0 ) } at 1.0 m, ${ climb.at( - 1 ).toFixed( 0 ) } N/m at 1.2 m` );
	// a swimmer in the harbour is held by the water, no more than a person standing in it to their legs' height; a car by its wetted depth
	const swim = flowWith( { player: { mode: 'swim', position: { x: 0, y: 0.84, z: 0 } } }, camera( 0, 1.16, 0 ) ).listener.flow;
	const car = flowWith( { player: { mode: 'rally', position: { x: 0, y: 0.5, z: 0 } }, rally: { active: true, model: { root: { position: { x: 0, y: 0.5, z: 0 } } } } }, camera( - 5, 2.5, 0 ), 0.5 ).listener.flow;
	assert.ok( swim > 0 && swim <= climb.at( - 1 ) / 4 + 1 && car > 0, `a swimmer and a car in the flow are held by it: swimmer ${ swim.toFixed( 0 ) } N/m at 2 m/s, car ${ car.toFixed( 0 ) } N/m in 0.5 m at 2 m/s` );
	// the front arriving close by shakes a camera held near the ground or water, not one 40 m above it
	const arrival = ( y ) => {

		const state = { front: 1e9, depth: 2, speed: 6 };
		let kicks = 0;
		const ds = new DisasterSound( app( floodField( state ), { freeCam: true, cameraShake: { kick( a ) { if ( a > 0 ) kicks ++; }, reseed() {} } } ) );
		for ( let i = 0; i < 30; i ++ ) ds.update( 1 / 60, camera( 0, y, 0 ) );
		state.front = - 40;
		for ( let i = 0; i < 60; i ++ ) ds.update( 1 / 60, camera( 0, y, 0 ) );
		return kicks;

	};
	const near = arrival( 4 ), high = arrival( 45 );
	assert.ok( near >= 1 && high === 0, `the front's arrival kicks a camera held 1 m over the flood (${ near }) and not one 42 m above it (${ high })` );

} );

test( 'two tsunamis in a row without a restore each arrive with a crash', async () => {

	const { DisasterSound } = await import( '../src/disasters/DisasterSound.js' );
	const state = { front: 1e9, depth: 2, speed: 6 };
	const field = floodField( state );
	const mixer = countingMixer();
	const ds = new DisasterSound( app( field, { audio: mixer } ) );
	const frames = ( seconds ) => {

		for ( let i = 0; i < Math.round( seconds * 60 ); i ++ ) ds.update( 1 / 60, camera() );

	};
	const wave = () => {

		for ( const front of [ 1500, 900, 500, 260, 130, 60, 30, 14, - 30 ] ) {

			state.front = front;
			frames( 0.5 );

		}
		frames( 2 );

	};
	frames( 1 );
	wave();
	// the water drains away, the first event is stopped, and a second tsunami is started at once (no Restore)
	state.front = 1e9;
	frames( 3 );
	field.events.clear();
	frames( 1 );
	field.events.set( 'tsunami', { kind: 'tsunami', direction: 180, firstImpact: false } );
	frames( 1 );
	wave();
	const crashes = mixer.played.filter( ( p ) => p.bank === 'surf_crash' ).length;
	assert.equal( crashes, 2, `crashes heard are 2 (one for each tsunami's arrival): ${ crashes }` );

} );

test( 'the first break after a launch is heard, or counted as dropped', async () => {

	const { DisasterSound, snapLevel } = await import( '../src/disasters/DisasterSound.js' );
	// a mixer whose recordings load on request and arrive 10 frames later (SoundScape._want: the first request starts the
	// fetch and returns nothing); a shot asked for before its recording is there plays nothing
	const mixer = countingMixer();
	mixer.frame = 0;
	mixer.loadAt = new Map();
	const want = ( bank ) => {

		if ( ! mixer.loadAt.has( bank ) ) mixer.loadAt.set( bank, mixer.frame + 10 );
		return mixer.frame >= mixer.loadAt.get( bank );

	};
	mixer.disasterWant = ( bank ) => {

		want( bank );

	};
	const shot = mixer.disasterShot.bind( mixer );
	mixer.disasterShot = ( bank, ...rest ) => ( want( bank ) ? shot( bank, ...rest ) : null );
	const field = quietField();
	field.events.clear();
	const A = app( field, { audio: mixer } );
	const trees = [];
	for ( let i = 0; i < 20; i ++ ) trees.push( { r: { x: 20 + i * 8, y: 2, z: 0, H: 12 }, mode: undefined, phase: undefined, piece: { mass: 500 } } );
	A.disasters.bodies.trees = trees;
	const ds = new DisasterSound( A );
	const frame = () => {

		ds.update( 1 / 60, camera() );
		mixer.frame ++;

	};
	frame();
	// the event is launched, and two frames later the first ten trees snap; a second later the next ten
	field.events.set( 'earthquake', { kind: 'earthquake' } );
	frame();
	frame();
	for ( const t of trees.slice( 0, 10 ) ) {

		t.mode = 'snap';
		t.phase = 'hinge';

	}
	for ( let i = 0; i < 60; i ++ ) frame();
	for ( const t of trees.slice( 10 ) ) {

		t.mode = 'snap';
		t.phase = 'hinge';

	}
	for ( let i = 0; i < 120; i ++ ) frame();
	const heard = mixer.played.length, dropped = ds.queue.dropped;
	assert.equal( heard + dropped, trees.length, `heard + dropped equals the breaks pushed: ${ heard } heard, ${ dropped } dropped, ${ trees.length } pushed (snaps at ${ snapLevel( 500 ).toFixed( 0 ) } dB at 10 m)` );
	const first = mixer.played.filter( ( p ) => p.x < 100 ).length;
	assert.ok( first > 0, `the recordings asked for at the launch are there for the first breaks: ${ first } of the first ten heard` );

} );

test( 'a tsunami on the real island is heard coming: silent before its launch, louder as its breaking front nears and loudest as the flood reaches the listener; the water draining there is no front', async () => {

	const { TerrainData } = await import( '../src/world/TerrainData.js' );
	const { DisasterField, DEFAULTS } = await import( '../src/disasters/Field.js' );
	const { DisasterSound } = await import( '../src/disasters/DisasterSound.js' );
	const island = new TerrainData();
	const ground = ( x, z ) => island.heightAt( x, z );
	const field = new DisasterField( ground );
	// the browser scenario's control run (test/tsunami-coast.mjs): Surge 2 m at the fishing village, seed 7
	const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, x: 40, z: - 115, intensity: 2, warningLead: 6, radius: 180, duration: 90, seed: 7 } );
	// the listener stands on the beach the wave comes at: walk out along the approach ray from the village to the sea,
	// then back to the first ground 0.3 m above it
	const a = e.direction * Math.PI / 180, cx = Math.cos( a ), cz = Math.sin( a );
	let s = 0;
	while ( s < e.launchDistance && ground( e.x - cx * s, e.z - cz * s ) > - 0.5 ) s += 2;
	while ( s > 0 && ground( e.x - cx * s, e.z - cz * s ) < 0.3 ) s -= 2;
	const x = e.x - cx * s, z = e.z - cz * s, y = ground( x, z ) + 1.7;
	const A = app( field );
	A.terrainData = island;
	const ds = new DisasterSound( A );
	const STEP = 0.1, rows = [];
	let wetFor = 0, peakDepth = 0, dryAgain = 0;
	while ( e.time < e.arrival + 90 ) {

		field.advance( STEP );
		ds.update( STEP, camera( x, y, z ) );
		const depth = Math.max( 0, field.waterAt( x, z ) - ground( x, z ) );
		peakDepth = Math.max( peakDepth, depth );
		rows.push( { t: e.time, launched: !! e.launched, depth, level: ds.state.level, front: ds.state.front, rate: ds.atRate } );
		if ( depth > 0.1 ) wetFor += STEP;
		if ( wetFor > 8 && depth < 0.5 * peakDepth ) dryAgain += STEP;
		if ( dryAgain > 5 ) break;

	}
	const median = ( v ) => v.slice().sort( ( p, q ) => p - q )[ Math.floor( v.length / 2 ) ];
	const before = rows.filter( ( r ) => ! r.launched );
	const tA = rows.find( ( r ) => r.depth > 0.1 )?.t;
	assert.ok( tA !== undefined, `the flood reached the listener at (${ x.toFixed( 0 ) }, ${ z.toFixed( 0 ) }), ${ s } m out from the village (peak depth ${ peakDepth.toFixed( 2 ) } m)` );
	const earlier = rows.filter( ( r ) => r.t >= tA - 30 && r.t < tA - 15 ).map( ( r ) => r.level ), later = rows.filter( ( r ) => r.t >= tA - 15 && r.t < tA ).map( ( r ) => r.level );
	const peak = rows.reduce( ( p, q ) => ( q.level > p.level ? q : p ) );
	const draining = rows.filter( ( r ) => r.depth > 0.1 && r.rate < - 0.08 );
	const report = `before launch at most ${ Math.max( ...before.map( ( r ) => r.level ) ).toFixed( 1 ) } LUFS; approach ${ median( earlier ).toFixed( 1 ) } then ${ median( later ).toFixed( 1 ) } LUFS; loudest ${ peak.level.toFixed( 1 ) } LUFS at ${ ( peak.t - tA ).toFixed( 1 ) } s from the flood reaching the listener (peak depth ${ peakDepth.toFixed( 2 ) } m); ${ draining.length } draining rows, fronts there ${ [ ...new Set( draining.map( ( r ) => r.front ) ) ].slice( 0, 6 ) }`;
	console.log( `real island: ${ report }` );
	assert.ok( Math.max( ...before.map( ( r ) => r.level ) ) < - 60, `silent before the launch: ${ report }` );
	assert.ok( median( later ) - median( earlier ) > 3, `louder over the last 15 s before the flood reaches the listener than the 15 s before: ${ report }` );
	assert.ok( peak.t >= tA - 5 && peak.t <= tA + 10, `loudest as the flood reaches the listener: ${ report }` );
	assert.ok( draining.length > 0 && draining.every( ( r ) => r.front > 0 ), `the water draining at the listener is not called the front: ${ report }` );

} );

test( 'the shaken pose never outlives its frame: the frame is drawn inside the shake, and the pose comes back when a pass throws', async () => {

	const { CameraShake } = await import( '../src/core/CameraShake.js' );
	const { PerspectiveCamera } = await import( '../src/engine/index.js' );
	const cam = new PerspectiveCamera( 60, 1.5, 0.1, 1000 );
	cam.position.set( 3, 1.2, - 4 );
	cam.rotation.set( - 0.2, 1.1, 0, 'YXZ' );
	cam.updateMatrixWorld();
	const pose = () => [ cam.position.x, cam.position.y, cam.position.z, cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w, cam.rotation.x, cam.rotation.y, cam.rotation.z, ...cam.matrixWorld.elements ];
	const before = pose();
	const shake = new CameraShake( { reducedMotion: false } );
	shake.reseed( 3 );
	const input = { active: true, ax: 6, ay: - 6, az: 4, coupling: 1, wind: 40, flow: 30000, flowX: 1, flowZ: 0 };
	let moved = false;
	assert.throws( () => shake.frame( cam, null, () => {

		shake.apply( cam, 1 / 60, input );
		moved = pose().some( ( v, k ) => v !== before[ k ] );
		throw new Error( 'a render pass failed' );

	}, 1 / 60 ), /a render pass failed/ );
	assert.ok( moved, 'the shake moved the camera inside the frame' );
	assert.deepEqual( pose(), before, 'after the exception the pose is exactly the one its owners set' );

} );

test( 'the volume row plays every disaster sound at the game\'s own calibration at its default and moves the siren with it at every step; the bus\'s last stage passes a sound under its knee unchanged and holds anything louder at or under -3 dBFS', async () => {

	const { busGain, stageCurve, STAGE_CEILING, STAGE_KNEE } = await import( '../src/disasters/DisasterSound.js' );
	const { TsunamiSiren, VOLUME_DEFAULT } = await import( '../src/disasters/Siren.js' );
	assert.equal( busGain( VOLUME_DEFAULT ), 1, `a gain of 1 on the bus at the row's default: ${ busGain( VOLUME_DEFAULT ) }` );
	// the real siren's volume and mute level at every step of the row, against the bus's gain there
	const siren = armedSiren( TsunamiSiren ), rows = [];
	for ( let v = 0; v <= 100; v ++ ) {

		siren.volume = v / 100;
		siren.update( { time: 1 + v * 0.01 }, false );
		rows.push( { v, bus: busGain( v / 100 ), siren: siren.gain.gain.value } );

	}
	assert.ok( rows[ 0 ].bus === 0 && rows[ 0 ].siren === 0, `silence at the bottom of the row: bus ${ rows[ 0 ].bus }, siren ${ rows[ 0 ].siren }` );
	for ( let i = 1; i < rows.length; i ++ ) assert.ok( rows[ i ].bus > rows[ i - 1 ].bus && rows[ i ].siren > rows[ i - 1 ].siren, `every step of the row raises the bus and the siren: ${ JSON.stringify( rows[ i - 1 ] ) } then ${ JSON.stringify( rows[ i ] ) }` );
	const ratio = rows[ 75 ].siren / rows[ 75 ].bus;
	const off = Math.max( ...rows.slice( 1 ).map( ( r ) => Math.abs( r.siren / r.bus / ratio - 1 ) ) );
	assert.ok( off < 1e-6, `the siren keeps its ratio to the bus at every step: ${ ratio.toFixed( 4 ) } at the default, off by at most ${ off }` );
	// the stage as the mixer's wave shaper applies it (input clamped to full scale, the curve interpolated), fed up to
	// 40 times full scale times the row's top
	const curve = stageCurve(), N = curve.length, through = ( x ) => {

		const u = ( Math.min( 1, Math.max( - 1, x ) ) + 1 ) * 0.5 * ( N - 1 ), i = Math.min( N - 2, Math.floor( u ) );
		return curve[ i ] + ( curve[ i + 1 ] - curve[ i ] ) * ( u - i );

	};
	let most = 0, under = 0, falls = 0, last = - Infinity;
	for ( let x = - 40 * busGain( 1 ); x <= 40 * busGain( 1 ); x += 0.0005 ) {

		const y = through( x );
		most = Math.max( most, Math.abs( y ) );
		if ( Math.abs( x ) <= STAGE_KNEE ) under = Math.max( under, Math.abs( y - x ) );
		if ( y < last - 1e-9 ) falls ++;
		last = y;

	}
	assert.ok( most <= STAGE_CEILING + 1e-6, `the bus's output never passes -3 dBFS: ${ ( 20 * Math.log10( most ) ).toFixed( 2 ) } dBFS at most` );
	assert.ok( under < 1e-6 && falls === 0, `a sound under the knee (-6 dBFS) passes unchanged (off by ${ under }) and louder input is never quieter (${ falls } falls)` );
	assert.ok( through( 0.9 ) > through( 0.7 ) && through( 0 ) === 0, `above the knee louder input is still louder: ${ through( 0.7 ).toFixed( 4 ) } at 0.7, ${ through( 0.9 ).toFixed( 4 ) } at 0.9` );

} );

test( 'a launch opens the disaster bus before any sound plays and asks for one recording a frame; the rest of the mix gives way while the disaster is loud and not when it is muted; the bus is released a few seconds after the last sound once no event runs', async () => {

	const { DisasterSound, duckGain, DUCK_DEPTH } = await import( '../src/disasters/DisasterSound.js' );
	const mixer = countingMixer(), log = [];
	let frame = 0, open = false;
	Object.assign( mixer, {
		disasterOpen() { log.push( [ frame, 'open' ] ); open = true; },
		disasterWant( bank ) { log.push( [ frame, bank ] ); },
		disasterRelease() { log.push( [ frame, 'release' ] ); open = false; },
		setDisasterDuck( g ) { this.duck = g; },
		duck: 1,
	} );
	Object.defineProperty( mixer, 'disasterNodes', { get: () => ( open ? 5 : 0 ) } );
	const state = { front: 1e9, depth: 2, speed: 6 }, field = floodField( state );
	field.events.clear();
	const A = app( field, { audio: mixer } );
	const ds = new DisasterSound( A ), step = ( n ) => {

		for ( let i = 0; i < n; i ++, frame ++ ) {

			ds.audioT = - 1e9; // the mixer's levels every frame here (in the game every ~33 ms of wall time, a cost bound)
			ds.update( 1 / 60, camera() );
			mixer.voices = 0;

		}

	};
	step( 10 );
	assert.equal( log.length, 0, 'nothing opened or asked for with no event' );
	field.events.set( 'tsunami', { kind: 'tsunami', direction: 180, firstImpact: false } );
	const launch = frame;
	step( 30 );
	const perFrame = new Map();
	for ( const [ f ] of log ) perFrame.set( f, ( perFrame.get( f ) ?? 0 ) + 1 );
	assert.ok( log[ 0 ]?.[ 0 ] === launch && log[ 0 ]?.[ 1 ] === 'open' && log.length === 16 && Math.max( 0, ...perFrame.values() ) === 1, `the bus is opened on the launch frame (${ log[ 0 ]?.join( ' ' ) } at launch ${ launch }), then one recording a frame (${ log.length - 1 } asked for, at most ${ Math.max( 0, ...perFrame.values() ) } a frame)` );
	// the flood at the listener, loud: the rest of the mix gives way; muted, it does not
	state.front = - 1e9;
	step( 120 );
	const loud = mixer.duck, level = ds.state.level;
	A.disasters.siren.muted = true;
	step( 10 );
	const muted = mixer.duck;
	A.disasters.siren.muted = false;
	assert.ok( loud < 0.89 && loud >= duckGain( 0 ) && muted === 1, `the rest of the mix gives way by up to ${ DUCK_DEPTH } dB to the flood at ${ level.toFixed( 1 ) } LUFS (${ ( 20 * Math.log10( loud ) ).toFixed( 1 ) } dB) and not while it is muted (${ muted })` );
	assert.ok( duckGain( - 40 ) === 1 && duckGain( - Infinity ) === 1 && Math.abs( 20 * Math.log10( duckGain( - 9 ) ) + DUCK_DEPTH ) < 1e-9, `nothing under -24 LUFS, ${ DUCK_DEPTH } dB at the bed ceiling: ${ duckGain( - 40 ) }, ${ duckGain( - 9 ) }` );
	// Stop and Restore: the beds fade, nothing is left to hear, and the bus goes a few seconds later
	field.events.clear();
	A.disasters.restored = true;
	step( 60 );
	const before = log.filter( ( e ) => e[ 1 ] === 'release' ).length;
	step( 240 );
	const released = log.filter( ( e ) => e[ 1 ] === 'release' );
	assert.ok( before === 0 && released.length === 1 && ! open, `the bus is released once, about 3 s after the last sound (${ before } after 1 s, ${ released.length } after 5 s)` );
	assert.equal( mixer.duck, 1, 'the rest of the mix is back at its level' );

} );

test( 'a storm of failures is scanned a bounded number of items a frame and every break is still heard once, within four frames', async () => {

	const { DisasterSound, SCAN_ITEMS } = await import( '../src/disasters/DisasterSound.js' );
	// the island's counts: 4,000 trees and 10,950 building parts (365 buildings of 30), every building losing a part
	// a frame for 30 frames while 600 trees fail and then land
	const trees = [], records = [];
	for ( let i = 0; i < 4000; i ++ ) trees.push( { r: { x: i % 200, y: 1, z: i / 200, H: 10 }, mode: 'snap', phase: undefined, piece: { mass: 400 } } );
	for ( let i = 0; i < 365; i ++ ) {

		const components = [];
		for ( let j = 0; j < 30; j ++ ) components.push( { failed: false, kind: 'wall', center: [ i, 1, j ], mass: 200 } );
		records.push( { progressive: true, components, failedCount: 0 } );

	}
	const A = app( quietField() );
	A.disasters.bodies.trees = trees;
	A.disasters.structures.records = records;
	const ds = new DisasterSound( A ), heard = new Map();
	let last = 0, frame = 0, most = 0;
	ds.hear = ( kind, x, y, z ) => {

		const key = `${ kind } ${ x } ${ y } ${ z }`;
		heard.set( key, ( heard.get( key ) ?? 0 ) + 1 );
		last = frame;
		return true;

	};
	for ( ; frame < 300; frame ++ ) {

		const f = frame - 10;
		if ( f >= 0 && f < 30 ) {

			for ( const r of records ) {

				r.components[ f ].failed = true;
				r.failedCount = f + 1;

			}
			for ( let k = f * 20; k < f * 20 + 20; k ++ ) trees[ k ].phase = 'hinge';

		}
		if ( f >= 10 && f < 40 ) for ( let k = ( f - 10 ) * 20; k < ( f - 10 ) * 20 + 20; k ++ ) trees[ k ].phase = 'rest';
		ds.update( 1 / 60, camera() );
		most = Math.max( most, ds.visits );

	}
	const twice = [ ...heard.values() ].filter( ( n ) => n > 1 ).length;
	assert.ok( most <= SCAN_ITEMS, `items looked at a frame: at most ${ most } (bound ${ SCAN_ITEMS })` );
	assert.equal( heard.size, 600 + 600 + 10950, `every snap, landing and part heard: ${ heard.size } of ${ 600 + 600 + 10950 }` );
	assert.equal( twice, 0, `none heard twice: ${ twice }` );
	assert.ok( last - 49 <= 4, `the last break heard ${ last - 49 } frames after the last change (within 4)` );

} );
