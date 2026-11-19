// What a disaster sounds like at the camera, and what it does to the camera, read from the simulation
// (docs/disasters.md, "Sound and camera"). Before this the only disaster sound was the warning siren and nothing
// moved the camera.
//
// Frame: world metres, y up. Time: game seconds on this module's own clock (it stops while the disasters are paused,
// and slow motion stretches every delay with the picture). Levels: dB SPL at the listener, turned into the mixer's
// loudness as LUFS = SPL - 100 (declared: the mixer's reference, a wave breaking 10 m away at -15 LUFS, MIX.crash, is
// taken as 85 dB SPL).
//
// Per frame (update(dt, camera), called after every camera owner has set its pose and before the shake is added):
//   flood    two bearings of a ring of 24 bearings by 9 distances (6 m to 1.6 km) sampled from DisasterField.sample.
//            Each cell's turbulent dissipation (rho C_D |u|^3 per square metre, weighted by how hard the water breaks)
//            is radiated at 2e-6 efficiency and integrated over the cell (1/r^2 spreading, air absorption) into three
//            beds: the rush past the listener, the roar of the breaking front, the far rumble. The nearest breaking
//            cell is the front: its arrival crashes once, kicks the camera and wets the lens.
//   tornado  the vortex roar from the tornado's wind and its distance; the event's own wind at the camera, with gusts.
//   quake    the ground rumble from the acceleration at the camera's ground.
//   breaks   trees failing and landing, building parts and whole buildings letting go, bodies striking (a change of a
//            body's own velocity in the rigid-body solver, read from physics.disaster_motion(): the physics has no
//            contact events for disaster bodies, and a velocity taken from the synced pose over the frame's interval
//            jumps whenever a frame holds a different number of the solver's 1/120 s steps), queued where they happen
//            and played when their sound reaches the listener (343 m/s), at most MAX_VOICES at once.
// Outputs: the mixer's disaster bus (app.audio, none with ?noAudio), the camera shake's input (this.listener and
// app.cameraShake.kick) and the wet lens (app.post.lens.splash). Nothing here writes to the simulation. Nothing here
// runs on a clock: a one-shot or a kick comes from something the physics did (a break, a strike, the front arriving, a
// surge at the lens, the flow turning back), and the beds and the steady shake follow continuous quantities.
//
// Cost: at most 19 field samples a frame, a scan of the trees and the buildings' parts while an event runs or debris
// still falls, one solver velocity per live body. Allocation: none of the module's own per frame (scratch outputs,
// fixed arrays, bound callbacks, index reads); a new body's record (six numbers) once. What it calls does allocate:
// DisasterField.sample builds a centre object per event per sample (Field.center in Field.sampleRaw), field.center
// one for the tornado, and the solver's disaster_motion() a fresh Float32Array, one a frame while bodies are tracked.

import { GRAVITY } from '../physics/Loads.js';
import { mulberry32 } from '../util/Noise.js';
import { VOLUME_DEFAULT } from './Siren.js';

const clamp = ( v, a, b ) => ( v < a ? a : v > b ? b : v );
const smooth = ( a, b, x ) => {

	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );

};
const finite = ( v ) => typeof v === 'number' && Number.isFinite( v );

export const SPEED_OF_SOUND = 343; // m/s: dry air at 20 °C
export const SPL_TO_LUFS = - 100; // dB: mixer loudness = SPL - 100 (declared calibration, see the header)
export const BED_CEILING = - 9; // LUFS (91 dB): the loudest a bed plays; the master limiter's threshold is -4 dB
export const SHOT_CEILING = - 6; // LUFS (94 dB): the loudest a one-shot plays
export const SHOT_FLOOR = - 62; // LUFS: quieter one-shots at the listener are not played
export const BED_FLOOR = - 66; // LUFS: a bed below this fades out and is stopped (SoundScape.disasterBed)
export const MAX_VOICES = 12; // live disaster one-shots (4 nodes each); SoundScape LIMITS.dis holds the same bound
export const MAX_PENDING = 32; // queued breaks waiting for their sound to arrive; the quietest is dropped when full

// ISO 9613-1 air absorption at 20 °C and 70 % relative humidity: [ Hz, dB/km ]
const AIR = [ [ 125, 0.45 ], [ 250, 1.3 ], [ 500, 2.8 ], [ 1000, 4.7 ], [ 2000, 9.9 ], [ 4000, 29.7 ], [ 8000, 105 ] ];
const CUTOFF_LOSS = 3; // dB: a sound is low-passed where its path's absorption reaches this

// Hz: the frequency the air takes 3 dB from over d metres (4 kHz at 100 m, 1 kHz at 640 m, under 300 Hz at 2 km).
// Above 8 kHz the classical absorption grows as f^2, so short paths extrapolate on that law (to 18 kHz).
export function airCutoff( d ) {

	const km = Math.max( 1, finite( d ) ? d : 1 ) / 1000;
	if ( AIR[ 0 ][ 1 ] * km >= CUTOFF_LOSS ) return AIR[ 0 ][ 0 ];
	for ( let i = 1; i < AIR.length; i ++ ) {

		const f1 = AIR[ i ][ 0 ], a1 = AIR[ i ][ 1 ];
		if ( a1 * km < CUTOFF_LOSS ) continue;
		const f0 = AIR[ i - 1 ][ 0 ], a0 = AIR[ i - 1 ][ 1 ];
		const k = Math.log( CUTOFF_LOSS / ( a0 * km ) ) / Math.log( a1 / a0 );
		return Math.exp( Math.log( f0 ) + k * Math.log( f1 / f0 ) );

	}

	const f8 = AIR[ AIR.length - 1 ][ 0 ], a8 = AIR[ AIR.length - 1 ][ 1 ];
	return Math.min( 18000, f8 * Math.sqrt( CUTOFF_LOSS / ( a8 * km ) ) );

}

// dB: the broadband loss of a path of d metres (the 1 kHz figure)
export function airLoss( d ) {

	return 4.7 * Math.max( 0, d ) / 1000;

}

export function pointLevel( L10, d ) {

	const r = Math.max( 1, d );
	return L10 - 20 * Math.log10( r / 10 ) - airLoss( r );

}

export const arrivalDelay = ( d ) => Math.max( 0, d ) / SPEED_OF_SOUND; // s
export const toLufs = ( spl, ceiling = BED_CEILING ) => ( finite( spl ) ? Math.min( ceiling, spl + SPL_TO_LUFS ) : - Infinity );
const toSpl = ( intensity ) => ( intensity > 0 ? 10 * Math.log10( intensity / 1e-12 ) : - Infinity ); // W/m^2 -> dB
const dbAdd = ( a, b ) => ( a === - Infinity ? b : b === - Infinity ? a : 10 * Math.log10( 10 ** ( a / 10 ) + 10 ** ( b / 10 ) ) );

// ---------------------------------------------------------------- flood
const RHO_SEA = 1025; // kg/m^3
const BED_DRAG = 0.003; // bottom drag coefficient of a shallow flow (declared)
const EFFICIENCY = 2e-6; // radiated sound over dissipated power (declared: a 2 m flood at 6 m/s over a hectare 30 m off reads about 90 dB)
const WET = 0.05; // m: shallower water is not counted
const FRONT_SPEED = 2; // m/s: a breaking front runs faster than this ...
const FRONT_DEPTH = 0.1; // m: ... in water at least this deep ...
const FRONT_FROUDE = 0.5; // ... and at a Froude number over this, with its water rising
// Water that is draining (its depth falling between two sweeps of its cell) has no breaking face to entrain air: the
// sea drawing back before the wave and the backwash. It counts at this share of the same flow standing or rising
// (declared, -10 dB). Without it the drawdown at launch read -12.6 LUFS 50 m off the boardwalk, as loud as the bore.
const RECEDING_SHARE = 0.1;
const DRAINING = - 0.08, STEADY = - 0.01; // m/s: depth falling faster than DRAINING counts as draining, slower as standing
export const RING_BEARINGS = 24;
export const RING_RADII = [ 6, 12, 25, 50, 100, 200, 400, 800, 1600 ]; // m
const EAR = 1.7; // m: the ear above the water at the listener's feet, the inner limit of the spreading integral
const RINGS = RING_RADII.length, CELLS = RING_BEARINGS * RINGS;
// each cell's share of a uniform source's intensity at the listener: the integral of 1/(4 pi r^2) over the cell,
// dtheta / (4 pi) ln(r_out / r_in) between the geometric midpoints of the rings, times its air loss
const RING_GAIN = new Float64Array( RINGS );
for ( let i = 0; i < RINGS; i ++ ) {

	const inner = i === 0 ? EAR : Math.sqrt( RING_RADII[ i - 1 ] * RING_RADII[ i ] );
	const outer = i === RINGS - 1 ? RING_RADII[ i ] * Math.SQRT2 : Math.sqrt( RING_RADII[ i ] * RING_RADII[ i + 1 ] );
	RING_GAIN[ i ] = ( 2 * Math.PI / RING_BEARINGS ) / ( 4 * Math.PI ) * Math.log( outer / inner ) * 10 ** ( - airLoss( RING_RADII[ i ] ) / 10 );

}
const NEAR_RINGS = 2, FAR_RING = 7; // rings 0-1: the rush past the listener; 2-6: the roar; 7-8: the far rumble
const COS = new Float64Array( RING_BEARINGS ), SIN = new Float64Array( RING_BEARINGS );
for ( let b = 0; b < RING_BEARINGS; b ++ ) {

	COS[ b ] = Math.cos( 2 * Math.PI * b / RING_BEARINGS );
	SIN[ b ] = Math.sin( 2 * Math.PI * b / RING_BEARINGS );

}

// W/m^2 of sound radiated per square metre of flood `depth` m deep running at `speed` m/s: zero for still or thin
// water, and for a long wave at sea (Froude number under 0.35: it does not break, so it does not roar)
export function floodPower( depth, speed ) {

	if ( ! ( depth > WET ) || ! ( speed > 0 ) ) return 0;
	const froude = speed / Math.sqrt( GRAVITY * depth );
	return EFFICIENCY * RHO_SEA * BED_DRAG * speed * speed * speed * smooth( 0.35, 0.8, froude );

}

// ---------------------------------------------------------------- tornado, wind, quake (declared levels, docs)
// dB SPL at r metres from a vortex whose wind is `wind` m/s: 85 dB at 100 m for 65 m/s, as the fifth power of the
// wind, a point source beyond the core
export function vortexLevel( wind, r, core ) {

	if ( ! ( wind > 1 ) ) return - Infinity;
	return pointLevel( 85 + 20 + 50 * Math.log10( wind / 65 ), Math.max( r, core, 1 ) );

}

// LUFS of the event's own wind `v` m/s at the camera: -36 at 7 m/s (MIX.wind), 40 log10 of the speed
export function galeLevel( v ) {

	return v > 3 ? Math.min( BED_CEILING, - 36 + 40 * Math.log10( v / 7 ) ) : - Infinity;

}

// dB SPL of the ground rumble at an acceleration of `a` m/s^2: 70 dB at 1 m/s^2, silent below 0.1 (the threshold of feeling)
export function quakeLevel( a ) {

	return a > 0.1 ? 70 + 20 * Math.log10( a ) : - Infinity;

}

export const snapLevel = ( mass ) => 92 + 10 * Math.log10( Math.max( 20, mass ) / 500 ); // a trunk snapping
export const partLevel = ( mass ) => 84 + 10 * Math.log10( Math.max( 5, mass ) / 200 ); // a building part letting go
export const COLLAPSE_LEVEL = 100; // a whole timber building coming down
export const energyLevel = ( energy ) => 78 + 10 * Math.log10( Math.max( 1, energy ) / 1e4 ); // a landing or strike of `energy` J

// what each kind of event plays: [ bank, playback rate ]
export const KIND = Object.freeze( { snap: 0, tear: 1, treefall: 2, part: 3, masonry: 4, glass: 5, sheet: 6, collapse: 7, impact: 8, splash: 9, crash: 10, backwash: 11 } );
const VOICE = [ [ 'dis_crack', 1 ], [ 'dis_tear', 0.9 ], [ 'dis_treefall', 0.95 ], [ 'dis_collapse', 1 ], [ 'dis_collapse', 0.85 ], [ 'dis_glass', 1 ], [ 'dis_crack', 1.15 ], [ 'dis_collapse', 0.8 ], [ 'dis_impact', 1 ], [ 'big_splash', 0.9 ], [ 'surf_crash', 0.55 ], [ 'surf_backwash', 0.75 ] ];
const PART_KIND = { opening: KIND.glass, roofCover: KIND.sheet, masonry: KIND.masonry, wall: KIND.part, roofFrame: KIND.part };

// Breaks waiting for their sound to reach the listener: fixed arrays, no allocation per event.
export class BreakQueue {

	constructor( size = MAX_PENDING ) {

		this.size = size;
		this.n = 0;
		this.dropped = 0;
		this.due = new Float64Array( size ); // game s at which the sound reaches the listener
		this.x = new Float64Array( size );
		this.y = new Float64Array( size );
		this.z = new Float64Array( size );
		this.L10 = new Float32Array( size );
		this.est = new Float32Array( size ); // dB SPL at the listener when queued (which to drop when full)
		this.kind = new Uint8Array( size );

	}

	push( kind, x, y, z, L10, now, lx, ly, lz ) {

		if ( ! finite( x + y + z + L10 + now ) ) return false;
		const d = Math.hypot( x - lx, y - ly, z - lz );
		const est = pointLevel( L10, d );
		if ( toLufs( est, SHOT_CEILING ) < SHOT_FLOOR ) return false;
		let i = this.n;
		if ( i >= this.size ) {

			let q = 0;
			for ( let k = 1; k < this.n; k ++ ) if ( this.est[ k ] < this.est[ q ] ) q = k;
			this.dropped ++;
			if ( this.est[ q ] >= est ) return false;
			i = q;

		} else this.n ++;
		this.due[ i ] = now + arrivalDelay( d );
		this.x[ i ] = x;
		this.y[ i ] = y;
		this.z[ i ] = z;
		this.L10[ i ] = L10;
		this.est[ i ] = est;
		this.kind[ i ] = kind;
		return true;

	}

	// hands every event whose sound has arrived (due <= now) to sink.playBreak( queue, i ), then compacts
	drain( now, sink ) {

		let w = 0;
		for ( let r = 0; r < this.n; r ++ ) {

			if ( this.due[ r ] <= now ) {

				sink.playBreak( this, r );
				continue;

			}

			if ( w !== r ) {

				this.due[ w ] = this.due[ r ];
				this.x[ w ] = this.x[ r ];
				this.y[ w ] = this.y[ r ];
				this.z[ w ] = this.z[ r ];
				this.L10[ w ] = this.L10[ r ];
				this.est[ w ] = this.est[ r ];
				this.kind[ w ] = this.kind[ r ];

			}

			w ++;

		}

		this.n = w;

	}

	clear() {

		this.n = 0;

	}

}

// ---------------------------------------------------------------- shake, lens and strike couplings (declared, docs)
const ARRIVAL_NEAR = 30; // m: the breaking front's crash fires as it comes this close ...
const ARRIVAL_REARM = 60; // m: ... and, within one event, again only after it has been beyond this ...
const ARRIVAL_REARM_S = 10; // s: ... for this long; a new event re-arms it at once
const STRIKE_FLUX = RHO_SEA * 2 * 5 * 5; // N/m: momentum flux rho h u^2 of a 2 m surge at 5 m/s ...
const STRIKE_KICK = 0.02; // rad: ... kicks the camera this much within ...
const STRIKE_NEAR = 15; // m
// A surge at the lens: the momentum flux of the water at the camera rising faster than SURGE_RATE (declared: a 1 m bore
// at 4 m/s, 16 kN/m, arriving within about a second), measured over SURGE_WINDOW, longer than the one or two frames by
// which the water's readback can lag, so a late readback is not a surge. Re-armed once the rise falls under half the rate.
const SURGE_RATE = 15000; // N/m per s
const SURGE_WINDOW = 0.25; // s
const IMPACT_KICK = 0.004; // rad for 10 kJ at 10 m, as sqrt(E) / r (ground vibration from dropped weights, Mayne et al. 1984)
const IMPACT_RANGE = 80; // m: no kick beyond
const IMPACT_DV = 2.5; // m/s: a body's own (solver) velocity changing by more than this over a frame struck something ...
// ... beyond what the strongest continuous load can change it by over the frame: the flood's drag on a car broadside,
// 0.5 x 1025 kg/m^3 x C_d 1.0 x 4 m^2 x (6 m/s)^2 / 1500 kg, about 50 m/s^2 (declared). Without it a frame that holds
// the solver's twelve catch-up steps (0.1 s) would hear a car carried by the flood as a strike.
const CONTINUOUS_ACCEL = 50; // m/s^2
const IMPACT_DV_MAX = 60; // m/s: ... unless it changed by more than this (a placement, not a collision)
const IMPACT_ENERGY = 2000; // J: lighter strikes are not heard
const IMPACT_REST = 0.4; // s between two strikes of one body (a rate limit on that body's own strikes, not a clock)
const SPRAY_REACH = 1.5; // m: the flood's surface this close below the lens throws water onto it ...
const SPRAY_SPEED = 2; // m/s: ... when it runs faster than this, for as long as it does
const BACKWASH_ON = - 1, BACKWASH_OFF = - 0.5; // m/s along the wave's heading: the flow has turned back past the first, and runs back no more above the second
const COUPLE_FULL = 4, COUPLE_NONE = 10; // m above the ground or water: the ground's shake reaches the camera fully, then not
const GUST_TAU = 1.5, GUST_SIGMA = 0.25; // s, turbulence intensity of the gusts on the event's wind
// The ceiling of all disaster sound together: every disaster sound passes one saturation on the mixer's disaster bus
// (SoundScape._disBus), as a microphone and the ear saturate (declared), so their sum is never more than
// BUS_SATURATION of full scale ahead of the row's gain, whatever the event: y = S tanh( x / S ), within 2.5 % of x up to
// half of full scale, so quieter sound passes as it is. Each bed is also held to BED_CEILING and each one-shot to
// SHOT_CEILING at the same place (SoundScape.disasterBed, disasterShot). Without it the arrival of a flood at the
// listener peaked at +7.4 dBFS before the master limiter (+1.3 dBFS after it, clipping) at a bus gain of 1.
export const BUS_SATURATION = 2; // of full scale
export const SAT_RANGE = 16; // the saturation's input range (x full scale, +24 dB): louder input holds the curve's end
export function saturationCurve( n ) {

	const curve = new Float32Array( n );
	for ( let i = 0; i < n; i ++ ) {

		const x = ( 2 * i / ( n - 1 ) - 1 ) * SAT_RANGE;
		curve[ i ] = BUS_SATURATION * Math.tanh( x / BUS_SATURATION ) / SAT_RANGE;

	}

	return curve;

}

// The Disaster sound volume row (Controls.js, Siren.volume 0..1): the bus gain is the row's value times BUS_TOP and
// the siren's level the value times SIREN.level, so every step moves both and they keep their ratio. BUS_TOP is the
// loudest safe level: BUS_SATURATION x BUS_TOP = 0.70, -3.1 dBFS before the limiter, the most any event can put
// through the bus at the top of the row. The default (VOLUME_DEFAULT) sits below it.
export const BUS_TOP = 0.35;
export const busGain = ( volume ) => BUS_TOP * clamp( finite( volume ) ? volume : VOLUME_DEFAULT, 0, 1 );
// The scan's work a frame (docs/disasters.md, Perf): trees and building parts looked at, each from a cursor. On the
// island's counts (4,000 trees, 10,950 parts) a tree's failure is noticed within 4 frames and a part's within 4 when
// every building is losing parts at once: at most 67 ms at 60 Hz, added to the sound's travel time (under the 125 ms by
// which sound must lag the picture before it is noticed, ITU-R BT.1359).
const TREE_SCAN = 1024;
const PART_SCAN = 3072;
export const SCAN_ITEMS = TREE_SCAN + PART_SCAN;
// every recording an event can play, asked for when it is launched (the warning lead gives the fetch and the decode)
const BANKS = [ 'dis_rush', 'dis_roar', 'dis_rumble', 'dis_vortex', 'dis_quake', 'wind', 'dis_crack', 'dis_tear', 'dis_treefall', 'dis_collapse', 'dis_glass', 'dis_impact', 'big_splash', 'surf_crash', 'surf_backwash' ];
const EVENT_KINDS = [ 'earthquake', 'tsunami', 'tornado' ];

const NO_SCAN = - 1;

export class DisasterSound {

	constructor( app ) {

		this.app = app;
		// the camera shake's input, refreshed every frame (src/core/CameraShake.js)
		// flow: the flood's momentum flux rho h u^2 at the lens (N/m), flowX / flowZ its direction
		this.listener = { active: false, ax: 0, ay: 0, az: 0, shake: 0, coupling: 0, wind: 0, flow: 0, flowX: 0, flowZ: 0 };
		this.state = { sources: 0, nodes: 0, voices: 0, queued: 0, dropped: 0, front: Infinity, depth: 0, rush: - Infinity, roar: - Infinity, rumble: - Infinity, vortex: - Infinity, vortexCutoff: 20000, gale: - Infinity, quake: - Infinity, level: - Infinity, ms: 0, msMax: 0, msListen: 0, msScan: 0, msPlay: 0 };
		this.queue = new BreakQueue();
		this.clock = 0;
		this.cells = new Float64Array( CELLS ); // W/m^2 at the listener from each cell
		this.front = new Uint8Array( CELLS ); // 1: the cell's water is a breaking front
		this.flux = new Float32Array( CELLS ); // N/m: momentum flux rho h u^2 of a front cell
		this.lastDepth = new Float32Array( CELLS ).fill( NaN ); // m: each cell's depth at its last sweep ...
		this.lastT = new Float64Array( CELLS ); // s: ... and when
		this.atDepth = NaN; // m: the depth at the listener last frame ...
		this.atRate = 0; // m/s: ... and how fast it rises (+) or drains (-), averaged over 0.5 s
		this.spoke = 0;
		this.flooding = false;
		this.s = {}; // field.sample scratch (the listener)
		this.c = {}; // field.sample scratch (the ring)
		this.seed = null;
		this.rand = mulberry32( 1 );
		this.gust = 1;
		this.heading = null; // deg: the tsunami's heading, kept for its backwash
		this.armed = true; // the arrival crash: once per front's arrival (a new tsunami, or its front gone away, re-arms it)
		this.awayT = 0;
		this.kickT = - 1e9; // s: the last flood strike (one event is not kicked twice: the arrival and its surge at the lens)
		this.fluxRef = 0; // N/m: the momentum flux at the lens at the start of the surge window ...
		this.fluxT = 0; // s: ... and when
		this.surgeArmed = true;
		this.spraying = false; // the flood running past the lens keeps it wet, with the same drops, while this holds
		this.backwash = false; // the flow at the listener is running back against the wave
		this.seen = new Array( EVENT_KINDS.length ).fill( null ); // the event objects last seen, per kind: a new one is a launch
		this.preloaded = true; // the recordings were asked for since the last launch
		this.audioT = 0;
		this.live = false;
		this.treePhase = new Uint8Array( 0 );
		this.treeCursor = 0;
		this.partsDirty = new Uint8Array( 0 ); // a building's failed count changed: its parts are to be looked at
		this.partRecord = 0; // the parts cursor: building ...
		this.partIndex = 0; // ... and part
		this.visits = 0; // trees and parts looked at this frame
		this.partsSeen = new Int32Array( 0 );
		this.broken = new Uint8Array( 0 );
		this.heard = new WeakSet();
		this.bodies = new Map(); // body id -> [ vx, vy, vz (the solver's, m/s), last strike s, frame stamp, frames seen ]
		this.frame = 0;
		this.dtGame = 0;
		this.lx = 0;
		this.ly = 0;
		this.lz = 0;
		this.order = new Int16Array( MAX_PENDING );
		this.orderLevel = new Float32Array( MAX_PENDING );
		this.dueCount = 0;
		this.pruneBody = ( e, id, map ) => {

			if ( e[ 4 ] !== this.frame ) map.delete( id );

		};

	}

	// the run's seed (Disasters.runSeed, fresh per event): gusts, slice picks and the shake's noise
	reseed( seed ) {

		if ( seed === this.seed || ! finite( seed ) ) return;
		this.seed = seed;
		this.rand = mulberry32( ( seed ^ 0x5bd1e995 ) >>> 0 );
		this.app.cameraShake?.reseed( seed );

	}

	reset() {

		this.queue.clear();
		this.cells.fill( 0 );
		this.front.fill( 0 );
		this.flux.fill( 0 );
		this.lastDepth.fill( NaN );
		this.atDepth = NaN;
		this.atRate = 0;
		this.treePhase.fill( 0 );
		this.partsSeen.fill( 0 );
		this.partsDirty.fill( 0 );
		this.treeCursor = this.partRecord = this.partIndex = 0;
		this.broken.fill( 0 );
		this.heard = new WeakSet();
		this.bodies.clear();
		this.armed = true;
		this.awayT = 0;
		this.kickT = - 1e9;
		this.fluxRef = 0;
		this.fluxT = this.clock;
		this.surgeArmed = true;
		this.spraying = false;
		this.backwash = false;
		this.gust = 1;
		this.heading = null;
		this.flooding = false;

	}

	update( dt, camera ) {

		const t0 = performance.now();
		const D = this.app.disasters, field = D?.field;
		const p = camera?.position;
		if ( ! field || ! p || ! finite( p.x + p.y + p.z ) ) return;
		dt = clamp( finite( dt ) ? dt : 0, 0, 0.1 );
		const events = field.events.size > 0;
		// heard while an event runs and, after it, while its water is still on the island (a tsunami's surges and
		// backwash outlast nothing but Restore); silent while paused
		const active = ( events || ( !! field.water && ! D.restored ) ) && ! D.paused;
		// after an event, until Restore: debris still falls and buildings still let go
		const live = ( events || ! D.restored ) && ! D.paused;
		if ( D.restored && ! events && this.live ) this.reset();
		this.live = events || ! D.restored;
		this.dtGame = live ? dt : 0;
		this.clock += this.dtGame;
		this.frame ++;
		this.lx = p.x;
		this.ly = p.y;
		this.lz = p.z;
		this.reseed( D.runSeed );
		// a launch: an event object not seen before (Start, or a second event of a kind without a Restore) starts its
		// own per-event state and asks for the recordings it may play. The pending breaks stay: they happened, and their
		// sound is still on its way.
		for ( let k = 0; k < EVENT_KINDS.length; k ++ ) {

			const e = field.events.get( EVENT_KINDS[ k ] ) ?? null;
			if ( e === this.seen[ k ] ) continue;
			this.seen[ k ] = e;
			if ( ! e ) continue;
			this.preloaded = false;
			if ( EVENT_KINDS[ k ] === 'tsunami' ) {

				this.armed = true;
				this.awayT = 0;
				this.surgeArmed = true;

			}

		}

		const L = this.listener, st = this.state;
		L.active = active;
		if ( ! active ) L.ax = L.ay = L.az = L.shake = L.wind = L.flow = 0;
		st.rush = st.roar = st.rumble = st.vortex = st.gale = st.quake = - Infinity;
		st.front = Infinity;
		st.depth = 0;
		// each part's own worst frame (decaying), so a slow frame is traced to its part or shown to be outside them
		const t1 = performance.now();
		if ( active ) this.listen( field, p, dt );
		const t2 = performance.now();
		if ( live ) this.scan( field );
		const t3 = performance.now();
		this.play();
		const t4 = performance.now(), ms = t4 - t0;
		st.ms = st.ms * 0.95 + ms * 0.05;
		st.msMax = Math.max( st.msMax * 0.999, ms );
		st.msListen = Math.max( st.msListen * 0.999, t2 - t1 );
		st.msScan = Math.max( st.msScan * 0.999, t3 - t2 );
		st.msPlay = Math.max( st.msPlay * 0.999, t4 - t3 );

	}

	// the physics at the listener: flood ring, tornado, quake, wind
	listen( field, p, dt ) {

		const L = this.listener, st = this.state, terrain = this.app.terrainData;
		const s = field.sample( p.x, p.y, p.z, this.s );
		const ground = terrain?.heightAt( p.x, p.z ) ?? 0;
		const surface = finite( s.height ) ? s.height : 0;
		const depth = surface - ground;
		const ux = finite( s.ux ) ? s.ux : 0, uz = finite( s.uz ) ? s.uz : 0, speed = Math.hypot( ux, uz );
		st.depth = depth > WET ? depth : 0;
		// the flood at the lens, its surface within reach below the camera: its momentum flux rho h u^2 is the shake's
		// continuous input (CameraShake: the turbulent part of its drag on the person holding the camera)
		L.flow = depth > WET && surface > p.y - SPRAY_REACH ? RHO_SEA * depth * speed * speed : 0;
		L.flowX = speed > 0 ? ux / speed : 0;
		L.flowZ = speed > 0 ? uz / speed : 0;
		// the ground: acceleration at the camera's place, coupled while the camera is held near the ground or water
		const water = Math.max( ground, finite( this.app.cameraWaterHeight ) ? this.app.cameraWaterHeight : surface );
		L.coupling = 1 - smooth( COUPLE_FULL, COUPLE_NONE, p.y - water );
		L.ax = finite( s.ax ) ? s.ax : 0;
		L.ay = finite( s.ay ) ? s.ay : 0;
		L.az = finite( s.az ) ? s.az : 0;
		L.shake = finite( s.shake ) ? s.shake : 0;
		// the event's own wind (the ambient wind is the island's weather, not the disaster)
		const amb = field.ambient?.();
		const wx = ( finite( s.wx ) ? s.wx : 0 ) - ( amb?.x ?? 0 ), wz = ( finite( s.wz ) ? s.wz : 0 ) - ( amb?.z ?? 0 ), wy = finite( s.wy ) ? s.wy : 0;
		L.wind = Math.hypot( wx, wy, wz );
		// gusts: an Ornstein-Uhlenbeck factor on the wind, from the run's seed
		const decay = Math.exp( - dt / GUST_TAU );
		const u1 = Math.max( 1e-9, this.rand() ), u2 = this.rand();
		const normal = Math.sqrt( - 2 * Math.log( u1 ) ) * Math.cos( 2 * Math.PI * u2 );
		this.gust = clamp( 1 + ( this.gust - 1 ) * decay + GUST_SIGMA * Math.sqrt( 1 - decay * decay ) * normal, 0.3, 1.8 );
		st.gale = L.wind > 3 ? Math.min( BED_CEILING, galeLevel( L.wind ) + 20 * Math.log10( this.gust ) ) : - Infinity;
		st.quake = toLufs( quakeLevel( L.shake ) );
		// the tornado's vortex
		let rumble = - Infinity;
		const tor = field.events.get( 'tornado' );
		if ( tor && field.center && field.tornadoIntensity && field.envelope ) {

			const c = field.center( tor ), wind = field.tornadoIntensity( tor ) * field.envelope( tor );
			const r = Math.hypot( p.x - c.x, p.z - c.z ), spl = vortexLevel( wind, r, ( tor.radius ?? 100 ) * 0.18 );
			st.vortex = toLufs( spl );
			st.vortexCutoff = airCutoff( r );
			rumble = spl - 6;

		}

		// the flood ring, two bearings a frame
		const tsunami = field.events.get( 'tsunami' );
		if ( tsunami ) this.heading = tsunami.direction ?? 0;
		// the ring while a tsunami runs or its water is still above sea level somewhere (the solver's highest surface);
		// a calm grid left by an earlier event costs nothing
		const flooded = tsunami || ( !! field.water && ( field.water.stats?.maxSurface ?? 1 ) > 0.05 );
		if ( flooded ) {

			this.flooding = true;
			for ( let k = 0; k < 2; k ++ ) this.sweep( field, p, terrain );

		} else if ( this.flooding ) {

			this.cells.fill( 0 );
			this.front.fill( 0 );
			this.flooding = false;

		}

		let near = 0, mid = 0, far = 0, midR = 0, farR = 0, nearest = Infinity, nearestCell = - 1;
		for ( let i = 0; i < CELLS; i ++ ) {

			const ring = i % RINGS, I = this.cells[ i ];
			if ( ring < NEAR_RINGS ) near += I;
			else if ( ring < FAR_RING ) {

				mid += I;
				midR += I * RING_RADII[ ring ];

			} else {

				far += I;
				farR += I * RING_RADII[ ring ];

			}

			if ( this.front[ i ] && RING_RADII[ ring ] < nearest ) {

				nearest = RING_RADII[ ring ];
				nearestCell = i;

			}

		}

		// the flood at the listener's own feet is the front when it runs fast and is not draining
		const wetHere = Math.max( 0, depth );
		if ( Number.isFinite( this.atDepth ) && dt > 0 ) this.atRate += ( ( wetHere - this.atDepth ) / dt - this.atRate ) * Math.min( 1, dt / 0.5 );
		this.atDepth = wetHere;
		if ( depth > FRONT_DEPTH && speed > FRONT_SPEED && this.atRate >= STEADY ) nearest = 0;
		st.front = nearest;
		st.rush = toLufs( toSpl( near ) );
		st.roar = toLufs( toSpl( mid ) );
		st.roarCutoff = mid > 0 ? airCutoff( midR / mid ) : 20000;
		st.rumble = toLufs( dbAdd( toSpl( far ), rumble ) );
		st.rumbleCutoff = far > 0 ? airCutoff( farR / far ) : 20000;
		if ( flooded ) this.flood( p, depth, ux, uz, speed, surface, nearestCell, dt );

	}

	// one bearing of the ring: each cell's sound at the listener and whether it is a breaking front
	sweep( field, p, terrain ) {

		const b = this.spoke;
		this.spoke = ( b + 1 ) % RING_BEARINGS;
		for ( let ring = 0; ring < RINGS; ring ++ ) {

			const r = RING_RADII[ ring ], x = p.x + COS[ b ] * r, z = p.z + SIN[ b ] * r, i = b * RINGS + ring;
			const s = field.sample( x, 0, z, this.c );
			const depth = ( finite( s.height ) ? s.height : 0 ) - ( terrain?.heightAt( x, z ) ?? 0 );
			const speed = Math.hypot( finite( s.ux ) ? s.ux : 0, finite( s.uz ) ? s.uz : 0 );
			// m/s: how fast the water at the cell rises (+) or drains (-) since its last sweep
			const last = this.lastDepth[ i ], wet = Math.max( 0, depth );
			const rate = Number.isFinite( last ) && this.clock > this.lastT[ i ] ? ( wet - last ) / ( this.clock - this.lastT[ i ] ) : 0;
			this.lastDepth[ i ] = wet;
			this.lastT[ i ] = this.clock;
			this.cells[ i ] = floodPower( depth, speed ) * RING_GAIN[ ring ] * ( RECEDING_SHARE + ( 1 - RECEDING_SHARE ) * smooth( DRAINING, STEADY, rate ) );
			const isFront = rate > 0 && depth > FRONT_DEPTH && speed > FRONT_SPEED && speed / Math.sqrt( GRAVITY * depth ) > FRONT_FROUDE;
			this.front[ i ] = isFront ? 1 : 0;
			this.flux[ i ] = isFront ? RHO_SEA * depth * speed * speed : 0;

		}

	}

	// the front's arrival, the strike on the camera, the wet lens, the backwash
	flood( p, depth, ux, uz, speed, surface, nearestCell, dt ) {

		const st = this.state;
		const front = st.front;
		if ( front > ARRIVAL_REARM ) {

			this.awayT += dt;
			if ( this.awayT >= ARRIVAL_REARM_S ) this.armed = true;

		} else this.awayT = 0;
		if ( this.armed && front <= ARRIVAL_NEAR ) {

			this.armed = false;
			let x = p.x, z = p.z, d = 0, flux = RHO_SEA * Math.max( 0, depth ) * speed * speed;
			if ( nearestCell >= 0 ) {

				const b = Math.floor( nearestCell / RINGS ), ring = nearestCell % RINGS;
				d = RING_RADII[ ring ];
				x = p.x + COS[ b ] * d;
				z = p.z + SIN[ b ] * d;
				flux = Math.max( flux, this.flux[ nearestCell ] );

			}

			// the crash: 6 dB over the flood's loudest bed at the listener, placed at the front
			const atListener = Math.max( st.rush, st.roar ) - SPL_TO_LUFS + 6;
			if ( finite( atListener ) ) this.hear( KIND.crash, x, surface + 1, z, atListener + 20 * Math.log10( Math.max( 1, d ) / 10 ) + airLoss( d ) );
			if ( d <= STRIKE_NEAR ) this.strike( flux );
			if ( d <= 12 ) this.wetLens( 1 );

		}

		// the flood running past the lens: a kick only for a surge (the flux at the lens rising faster than SURGE_RATE over
		// SURGE_WINDOW), never for steady water, which shakes the camera continuously (listener.flow); its spray keeps the
		// lens wet, with the same drops, for as long as it runs
		const flux = this.listener.flow;
		if ( this.clock - this.fluxT >= SURGE_WINDOW ) {

			const rise = ( flux - this.fluxRef ) / ( this.clock - this.fluxT );
			if ( rise > SURGE_RATE && this.surgeArmed ) {

				this.surgeArmed = false;
				if ( this.clock - this.kickT > SURGE_WINDOW ) this.strike( flux );

			} else if ( rise < 0.5 * SURGE_RATE ) this.surgeArmed = true;
			this.fluxRef = flux;
			this.fluxT = this.clock;

		}

		if ( flux > 0 && speed > SPRAY_SPEED ) this.spray( clamp( ( speed - SPRAY_SPEED ) / 4, 0.4, 1 ) );
		else this.spraying = false;

		// the backwash: heard as the flow at the listener turns back against the wave's heading, dragging sand and stones
		// (the water running back stays in the rush bed, at the draining share)
		const a = ( this.heading ?? 0 ) * Math.PI / 180, along = ux * Math.cos( a ) + uz * Math.sin( a );
		if ( this.heading !== null && depth > WET && along < BACKWASH_ON ) {

			if ( ! this.backwash ) {

				this.backwash = true;
				const L10 = 80 + 20 * Math.log10( - along / 2 ) + 10 * Math.log10( Math.min( depth, 2 ) / 0.5 );
				this.hear( KIND.backwash, p.x - Math.cos( a ) * 8, surface, p.z - Math.sin( a ) * 8, L10 );

			}

		} else if ( ! ( depth > WET ) || along > BACKWASH_OFF ) this.backwash = false;

	}

	strike( flux ) {

		this.kickT = this.clock;
		this.app.cameraShake?.kick( STRIKE_KICK * Math.min( 1, flux / STRIKE_FLUX ), 5 );

	}

	// water thrown onto the lens by an event (the front arriving): new drops
	wetLens( strength ) {

		const lens = this.app.post?.lens;
		if ( ! lens?.splash ) return;
		lens.splash( strength, this.rand() * 97 );

	}

	// the flood's spray while it runs past the lens keeps it at least this wet with the drops already on it (new drops
	// only on a lens that had dried), so steady water never throws a fresh pattern on a clock
	spray( strength ) {

		const lens = this.app.post?.lens;
		if ( ! lens?.splash ) return;
		const keep = this.spraying || ( lens.wet?.value ?? 0 ) > 0.05;
		lens.splash( strength, keep ? lens.seed?.value ?? 0 : this.rand() * 97 );
		this.spraying = true;

	}

	hear( kind, x, y, z, L10 ) {

		return this.queue.push( kind, x, y, z, L10, this.clock, this.lx, this.ly, this.lz );

	}

	// what broke since the last frame: trees, building parts, whole buildings, bodies striking
	scan( field ) {

		const D = this.app.disasters;
		this.visits = 0;
		// Trees: at most TREE_SCAN a frame from a cursor that wraps, so a storm of failures costs a bounded frame
		const trees = D.bodies?.trees;
		if ( trees ) {

			const n = trees.length;
			if ( this.treePhase.length !== n ) {

				this.treePhase = new Uint8Array( n );
				this.treeCursor = 0;

			}

			for ( let v = Math.min( n, TREE_SCAN ); v > 0; v -- ) {

				const k = this.treeCursor;
				this.treeCursor = k + 1 < n ? k + 1 : 0;
				this.visits ++;
				const t = trees[ k ];
				const code = t.phase === 'hinge' ? 1 : t.phase === 'rest' ? 2 : t.phase === 'body' ? 3 : 0;
				const was = this.treePhase[ k ];
				if ( code === was ) continue;
				this.treePhase[ k ] = code;
				const r = t.r;
				if ( ! r ) continue;
				const mass = t.piece?.mass ?? t.mass?.mass ?? 400;
				// it failed: a trunk snapping at its cut, or the root plate tearing out of the soil
				if ( was === 0 && code > 0 ) {

					if ( t.mode === 'snap' ) this.hear( KIND.snap, r.x, ( r.y ?? 0 ) + ( t.cut ?? 0 ), r.z, snapLevel( mass ) );
					else this.hear( KIND.tear, r.x, r.y ?? 0, r.z, snapLevel( mass ) - 2 );

				}

				// it landed (also when it failed and landed between two visits): its centre of mass fell about half its height
				if ( was <= 1 && code === 2 ) {

					const energy = mass * GRAVITY * 0.5 * Math.max( 3, r.H ?? 6 );
					this.hear( KIND.treefall, r.x, ( r.y ?? 0 ) + 1, r.z, energyLevel( energy ) );
					this.impactKick( energy, r.x, ( r.y ?? 0 ) + 1, r.z );

				}

			}

		}

		const records = D.structures?.records;
		if ( records ) {

			const n = records.length;
			if ( this.partsSeen.length !== n ) {

				this.partsSeen = new Int32Array( n );
				this.broken = new Uint8Array( n );
				this.partsDirty = new Uint8Array( n );
				this.partRecord = 0;
				this.partIndex = 0;

			}

			for ( let i = 0; i < n; i ++ ) {

				const r = records[ i ];
				if ( r.progressive && r.components ) {

					// a building whose failed count changed has its parts looked at (from the start of it again, if
					// the cursor is part way through it: a part that failed behind the cursor is not missed)
					const failed = r.failedCount | 0;
					if ( failed === this.partsSeen[ i ] ) continue;
					this.partsSeen[ i ] = failed;
					this.partsDirty[ i ] = 1;
					if ( this.partRecord === i ) this.partIndex = 0;

				} else {

					const b = r.broken ? 1 : 0;
					if ( b && ! this.broken[ i ] && r.center ) {

						this.hear( KIND.collapse, r.center.x, r.center.y ?? 0, r.center.z, COLLAPSE_LEVEL );
						this.impactKick( 2e5, r.center.x, r.center.y ?? 0, r.center.z );

					}

					this.broken[ i ] = b;

				}

			}

			// the parts of those buildings: at most PART_SCAN looked at a frame, from a cursor
			let budget = PART_SCAN;
			for ( let tries = 0; tries < n && budget > 0; tries ++ ) {

				const i = this.partRecord;
				const comps = this.partsDirty[ i ] ? records[ i ].components : null;
				const len = comps?.length ?? 0;
				let j = this.partIndex;
				for ( ; j < len && budget > 0; j ++, budget -- ) {

					this.visits ++;
					const c = comps[ j ];
					if ( ! c?.failed || this.heard.has( c ) ) continue;
					this.heard.add( c );
					const at = c.center;
					const x = at?.[ 0 ] ?? at?.x, y = at?.[ 1 ] ?? at?.y, z = at?.[ 2 ] ?? at?.z;
					this.hear( PART_KIND[ c.kind ] ?? KIND.part, x, y, z, partLevel( c.mass ?? 200 ) );

				}

				if ( j < len ) {

					this.partIndex = j;
					break;

				}

				this.partsDirty[ i ] = 0;
				this.partIndex = 0;
				this.partRecord = i + 1 < n ? i + 1 : 0;

			}

		}

		// bodies striking: each tracked body's own velocity from the solver (one disaster_motion() a frame), never its
		// synced pose differenced over the frame (the solver moves in whole 1/120 s steps, so that velocity jumps). With no
		// solver there is no strike: nothing else can say that a body's velocity changed.
		const bodies = D.bodies?.bodies, parts = D.structures?.bodies, physics = this.app.rally?.physics;
		if ( this.dtGame > 0 && ( bodies?.size || parts?.size ) && typeof physics?.disaster_motion === 'function' ) {

			const m = physics.disaster_motion();
			for ( let i = 0; i + 6 < m.length; i += 7 ) {

				const b = bodies?.get( m[ i ] ) ?? parts?.get( m[ i ] );
				if ( b ) this.track( b, m, i );

			}

			if ( this.frame % 120 === 0 ) this.bodies.forEach( this.pruneBody );

		}

	}

	// a body's own velocity from the solver (seven floats a body in m, from index i); a sudden change of it is a strike
	track( b, m, i ) {

		const id = m[ i ], px = m[ i + 1 ], py = m[ i + 2 ], pz = m[ i + 3 ], vx = m[ i + 4 ], vy = m[ i + 5 ], vz = m[ i + 6 ];
		if ( ! finite( px + py + pz + vx + vy + vz ) ) return;
		let e = this.bodies.get( id );
		if ( ! e ) {

			e = new Float64Array( 6 );
			e[ 3 ] = - 1e9;
			this.bodies.set( id, e );

		} else if ( e[ 5 ] >= 1 ) {

			const dv = Math.hypot( vx - e[ 0 ], vy - e[ 1 ], vz - e[ 2 ] );
			const energy = 0.5 * ( b.mass ?? 0 ) * dv * dv;
			if ( dv > IMPACT_DV + CONTINUOUS_ACCEL * this.dtGame && dv < IMPACT_DV_MAX && energy > IMPACT_ENERGY && this.clock - e[ 3 ] > IMPACT_REST ) {

				e[ 3 ] = this.clock;
				const water = this.app.disasters.field.waterAt?.( px, pz );
				const kind = finite( water ) && py < water + 0.5 ? KIND.splash : KIND.impact;
				this.hear( kind, px, py, pz, energyLevel( energy ) );
				this.impactKick( energy, px, py, pz );

			}

		}

		e[ 0 ] = vx;
		e[ 1 ] = vy;
		e[ 2 ] = vz;
		e[ 4 ] = this.frame;
		e[ 5 ] ++;

	}

	impactKick( energy, x, y, z ) {

		const r = Math.hypot( x - this.lx, y - this.ly, z - this.lz );
		if ( ! ( r < IMPACT_RANGE ) ) return;
		this.app.cameraShake?.kick( IMPACT_KICK * Math.sqrt( energy / 1e4 ) * 10 / Math.max( r, 5 ), 7 );

	}

	// the mixer: beds every ~30 Hz, breaks as their sound arrives (the loudest first, at most MAX_VOICES live)
	play() {

		const A = this.app.audio, D = this.app.disasters, st = this.state;
		this.dueCount = 0;
		if ( this.parked ) this.parked.n = 0;
		const ready = !! A?.enabled && typeof A.disasterBed === 'function';
		if ( ready && ! this.preloaded ) {

			this.preloaded = true;
			A.disasterPreload?.( BANKS );

		}

		this.queue.drain( this.clock, this );
		if ( ready ) {

			for ( let k = 0; k < this.dueCount; k ++ ) {

				// this.order holds the arrived breaks loudest first (playBreak); play them while voices are free
				const i = this.order[ k ];
				if ( A.disasterVoices >= MAX_VOICES ) {

					this.queue.dropped += this.dueCount - k;
					break;

				}

				this.voice( A, i );

			}

			const now = performance.now();
			if ( now - this.audioT >= 33 || ! this.listener.active ) {

				this.audioT = now;
				const siren = D?.siren;
				const muted = !! siren?.muted || !! D?.globalMuted;
				A.setDisasterGain( muted ? 0 : busGain( siren?.volume ) );
				const on = this.listener.active;
				A.disasterBed( 'rush', 'dis_rush', on ? st.rush : - Infinity, 1, 16000 );
				A.disasterBed( 'roar', 'dis_roar', on ? st.roar : - Infinity, 0.8, st.roarCutoff ?? 20000 );
				A.disasterBed( 'rumble', 'dis_rumble', on ? st.rumble : - Infinity, 1, Math.max( 300, st.rumbleCutoff ?? 20000 ) );
				A.disasterBed( 'vortex', 'dis_vortex', on ? st.vortex : - Infinity, 0.85, st.vortexCutoff );
				A.disasterBed( 'gale', 'wind', on ? st.gale : - Infinity, clamp( 0.8 + 0.15 * this.gust + this.listener.wind / 200, 0.7, 1.4 ), 500 + 110 * this.listener.wind );
				A.disasterBed( 'quake', 'dis_quake', on ? st.quake : - Infinity, 1, 20000 );

			}

		} else if ( this.dueCount ) this.queue.dropped += this.dueCount;

		st.level = dbAdd( dbAdd( dbAdd( st.rush, st.roar ), dbAdd( st.rumble, st.vortex ) ), dbAdd( st.gale, st.quake ) );
		st.sources = A?.disasterSources ?? 0;
		st.nodes = A?.disasterNodes ?? 0;
		st.voices = A?.disasterVoices ?? 0;
		st.queued = this.queue.n;
		st.dropped = this.queue.dropped;

	}

	// BreakQueue.drain sink: collect the arrived breaks, ordered loudest first (insertion into this.order)
	playBreak( queue, i ) {

		const d = Math.hypot( queue.x[ i ] - this.lx, queue.y[ i ] - this.ly, queue.z[ i ] - this.lz );
		const lufs = toLufs( pointLevel( queue.L10[ i ], d ), SHOT_CEILING );
		if ( lufs < SHOT_FLOOR ) return;
		// copy it out of the queue (drain compacts the queue in place) into this frame's arrivals
		const slot = this.parkSlot( queue, i );
		if ( slot < 0 ) return;
		let k = this.dueCount ++;
		while ( k > 0 && this.orderLevel[ k - 1 ] < lufs ) {

			this.order[ k ] = this.order[ k - 1 ];
			this.orderLevel[ k ] = this.orderLevel[ k - 1 ];
			k --;

		}

		this.order[ k ] = slot;
		this.orderLevel[ k ] = lufs;

	}

	parkSlot( queue, i ) {

		const P = this.parked ??= new BreakQueue( MAX_PENDING );
		if ( P.n >= P.size ) return - 1;
		const k = P.n ++;
		P.x[ k ] = queue.x[ i ];
		P.y[ k ] = queue.y[ i ];
		P.z[ k ] = queue.z[ i ];
		P.L10[ k ] = queue.L10[ i ];
		P.kind[ k ] = queue.kind[ i ];
		return k;

	}

	voice( A, k ) {

		const P = this.parked;
		const d = Math.hypot( P.x[ k ] - this.lx, P.y[ k ] - this.ly, P.z[ k ] - this.lz );
		const lufs = toLufs( pointLevel( P.L10[ k ], d ), SHOT_CEILING );
		const v = VOICE[ P.kind[ k ] ];
		const pick = Math.floor( this.rand() * 64 );
		// a recording that is not there yet (or a voice the mixer refused) plays nothing: counted as dropped, never lost silently
		if ( ! A.disasterShot( v[ 0 ], P.x[ k ], P.y[ k ], P.z[ k ], lufs, v[ 1 ] * ( 0.94 + 0.12 * this.rand() ), airCutoff( d ), pick ) ) this.queue.dropped ++;

	}

}
