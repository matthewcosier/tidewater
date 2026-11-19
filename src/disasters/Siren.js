// The tsunami warning: an outdoor motor siren, synthesised (docs/disasters.md, "Sound and camera"). It replaced two
// sine oscillators swept 420 to 720 Hz, which sounded like a test tone, not a siren.
//
// The model: one motor drives two rotors, a 10-port and a 12-port chamber (the pairing of dual-tone outdoor sirens, a
// 6:5 interval), 480 and 576 Hz at full speed (declared, inside the 400 to 600 Hz band of outdoor sirens). Each rotor
// chops the air through its ports, so each sounds a harmonic series (one periodic wave, odd harmonics strongest as for a
// near-square opening). The motor runs up with a 4 s time constant and coasts down with 7 s when the power is cut; the
// wail cycles the power 7 s on and 4 s off, so the pitch rises, holds and falls. The horn turns once every 16 s and is
// about 10 dB quieter off its axis: the slow swell heard from a fixed place. Loudness grows as the rotor speed to the
// power 1.5 (more air through the ports).
//
// When it sounds: in soundings of 3 minutes, the length of the civil-defence signals (FEMA CPG 1-17, Outdoor Warning
// Systems Guide: the Attack signal is a 3 to 5 minute wavering tone; Hawaii sounds its tsunami sirens for 3 minutes),
// with 2 minutes of silence between soundings (declared). It warns of a wave on its way or arriving: from Start (the
// warning) to the end of the incoming wave train (the event's `trainEnd`, Field.js planApproach). The first sounding
// begins at Start; another begins only before the train's end; at the train's end the power is cut, inside a sounding
// or not. A tsunami lives on until its water has gone back, ten to twenty minutes after a large wave: the evacuation
// and the warning banner hold for that (people wait on high ground until the water has gone), the siren does not, as
// it would wail over a draining bay with nothing new to warn of. At the end of a sounding the power is cut and the
// rotor runs down; its sources stop once it has coasted below 2 % of full speed (about 27 s from full).
//
// Contract (test/disaster-sound.mjs, test/browser/disasters.spec.js): created only by the Start gesture (arm()), its own
// context; two oscillator sources while sounding and none after stop, pause or reset; `gain` is the volume and mute
// level (volume x 0.18, zero when muted by the panel, by M or by the game's mute); the motor and the horn act on a gain
// before it, so the level a listener sets never swings with the wail.

export const SIREN = Object.freeze( {
	ports: [ 10, 12 ], // ports on each rotor: the two tones sit 12:10 = 6:5 apart
	fullRevs: 48, // rotor revolutions per second at full speed: 480 Hz on 10 ports (declared)
	upTau: 4, // s: run-up time constant with the power on
	downTau: 7, // s: run-down time constant with the power cut (the rotor coasting)
	on: 7, // s of power in each wail cycle
	off: 4, // s without power in each wail cycle
	turn: 16, // s for one turn of the horn (declared)
	offAxis: 0.32, // gain behind the horn: -9.9 dB
	// output gain at the top of the Disaster sound volume row: 0.045 at its default (VOLUME_DEFAULT), where the disaster
	// bus plays at the game's own calibration (a gain of 1, DisasterSound busGain), so the siren keeps that ratio to the
	// other disaster sounds at every position of the row
	level: 0.06,
	sounding: 180, // s of event time in one sounding
	gap: 120, // s of silence between soundings
	stopSpeed: 0.02, // fraction of full speed below which a run-down rotor is silent
} );

// event time (s) at which the incoming wave train of `event` ends: its planned `trainEnd`, else the crest estimate plus
// the train's length; an event with neither (a bare test event) has no end to its warning
export function trainEnd( event ) {

	if ( Number.isFinite( event?.trainEnd ) ) return event.trainEnd;
	return Number.isFinite( event?.arrival ) ? event.arrival + ( Number.isFinite( event.duration ) ? event.duration : 0 ) : Infinity;

}

// is a warning warranted for `event`: its wave is still on its way or arriving
export function warningWarranted( event ) {

	return !! event && event.time < trainEnd( event );

}

// sine amplitudes of harmonics 1..11 of the port frequency (declared): odd harmonics strongest, as from a near-square
// opening, the even ones from the ports' asymmetry
const HARMONICS = [ 1, 0.42, 0.55, 0.16, 0.3, 0.08, 0.17, 0.05, 0.1, 0.03, 0.06 ];

// rotor speed (0..1 of full) after dt seconds from s with the power on or off
export function motorStep( s, powered, dt ) {

	const target = powered ? 1 : 0;
	const tau = powered ? SIREN.upTau : SIREN.downTau;
	return target + ( s - target ) * Math.exp( - Math.max( 0, dt ) / tau );

}

// is the motor powered `t` seconds after the siren started (the wail)
export function wailPowered( t ) {

	return t % ( SIREN.on + SIREN.off ) < SIREN.on;

}

// gain of the turning horn at `turns` turns from facing the listener (1 on axis, SIREN.offAxis behind)
export function hornGain( turns ) {

	const facing = 0.5 + 0.5 * Math.cos( 2 * Math.PI * turns );
	return SIREN.offAxis + ( 1 - SIREN.offAxis ) * facing * facing;

}

// the Disaster sound volume row's default position (0..1; Controls.js value 75): every disaster sound plays at the game's
// own calibration there (DisasterSound busGain 1), and the row's top is 4/3 of it
export const VOLUME_DEFAULT = 0.75;

export class TsunamiSiren {

	constructor( app ) {

		this.app = app;
		this.muted = false;
		this.volume = VOLUME_DEFAULT;
		this.nodes = [];
		this.ctx = null;
		this.level = 0;
		this.enabled = false;
		this.gain = null; // the volume and mute level (read by the panel status and the browser scenario)
		this.horn = null; // the motor's loudness times the horn's swell
		this.speed = 0; // rotor speed, 0..1 of full
		this.runTime = 0; // s since this start (the wail's clock)
		this.lastT = null; // context time of the last motor step
		this.event = null; // the event the soundings belong to
		this.soundingFrom = 0; // event time (s) the current or last sounding began
		this.sounding = false; // within a sounding (powered by the wail), not in the gap after it

	}

	async arm() {

		this.enabled = true;
		if ( this.app.qs?.has( 'noAudio' ) ) return;
		const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
		if ( ! AC ) return;
		try {

			this.ctx ??= new AC();
			await this.ctx.resume();

		} catch {

			this.blocked = true;

		}

	}

	start() {

		const c = this.ctx;
		if ( ! c || c.state !== 'running' || this.nodes.length ) return;
		this.gain = c.createGain();
		this.gain.gain.value = 0;
		this.gain.connect( c.destination );
		this.horn = c.createGain();
		this.horn.gain.value = 0;
		this.horn.connect( this.gain );
		const real = new Float32Array( HARMONICS.length + 1 ), imag = new Float32Array( HARMONICS.length + 1 );
		imag.set( HARMONICS, 1 );
		const wave = c.createPeriodicWave( real, imag );
		for ( let i = 0; i < SIREN.ports.length; i ++ ) {

			const o = c.createOscillator();
			o.setPeriodicWave( wave );
			o.frequency.value = 1; // Hz: the rotor at rest; the motor winds it up from here
			o.connect( this.horn );
			o.start();
			this.nodes.push( o );

		}

		// a motor siren starts from rest every time it is switched on
		this.speed = 0;
		this.runTime = 0;
		this.lastT = c.currentTime;

	}

	update( event, paused = false ) {

		const on = !! event && ! paused && this.enabled;
		const mute = this.muted || !! this.app.audio?.muted || !! this.app.disasters?.globalMuted;
		// the volume and mute level, kept current whether or not a sounding is on (the panel and the bus read the same row)
		this.level = mute ? 0 : this.volume * SIREN.level;
		if ( ! on ) {

			this.stop();
			if ( ! event ) this.event = null;
			return;

		}

		// the schedule, on the event's own clock: a sounding at Start, then another after each gap while warranted
		if ( event !== this.event || ! ( event.time >= this.soundingFrom ) ) {

			this.event = event;
			this.soundingFrom = event.time;

		}

		const warranted = warningWarranted( event );
		if ( event.time - this.soundingFrom >= SIREN.sounding + SIREN.gap && warranted ) this.soundingFrom = event.time;
		const into = event.time - this.soundingFrom;
		// powered within a sounding while the wave is coming; after the train the rotor runs down and stays silent
		this.sounding = into < SIREN.sounding && warranted;
		if ( ! this.sounding && ( ! this.nodes.length || this.speed < SIREN.stopSpeed ) ) {

			this.stop();
			return;

		}

		this.start();
		if ( ! this.ctx ) return;
		const t = this.ctx.currentTime;
		if ( this.gain ) this.gain.gain.setTargetAtTime( this.level, t, 0.08 );
		// the motor steps on the context's clock, so the several updates a frame (the step and the panel refresh) wind
		// it once; under 5 ms apart is the same frame
		const dt = Math.min( 0.25, Math.max( 0, t - ( this.lastT ?? t ) ) );
		if ( this.nodes.length === 0 || ( dt < 0.005 && this.runTime > 0 ) ) return;
		this.lastT = t;
		this.runTime += dt;
		this.speed = motorStep( this.speed, this.sounding && wailPowered( into ), dt );
		const revs = Math.max( 1 / SIREN.ports[ 0 ], SIREN.fullRevs * this.speed );
		for ( let i = 0; i < this.nodes.length; i ++ ) this.nodes[ i ].frequency.setTargetAtTime( revs * SIREN.ports[ i ], t, 0.05 );
		this.horn?.gain.setTargetAtTime( this.speed ** 1.5 * hornGain( into / SIREN.turn ), t, 0.08 );

	}

	stop() {

		for ( const node of this.nodes ) {

			try {

				node.stop();
				node.disconnect();

			} catch { /* already stopped */ }

		}

		this.nodes.length = 0;
		this.horn?.disconnect();
		this.horn = null;
		this.gain?.disconnect();
		this.gain = null;
		this.level = 0;
		this.speed = 0;
		this.lastT = null;

	}

	get state() {

		return { context: this.ctx?.state ?? 'unavailable', sources: this.nodes.length, level: this.level, muted: this.muted || !! this.app.audio?.muted || !! this.app.disasters?.globalMuted };

	}

}
