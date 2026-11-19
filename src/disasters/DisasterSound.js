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
//   breaks   trees failing and landing, building parts and whole buildings letting go, bodies striking (the change of
//            a body's velocity between frames: the physics has no contact events for disaster bodies), queued where
//            they happen and played when their sound reaches the listener (343 m/s), at most MAX_VOICES at once.
// Outputs: the mixer's disaster bus (app.audio, none with ?noAudio), the camera shake's input (this.listener and
// app.cameraShake.kick) and the wet lens (app.post.lens.splash). Nothing here writes to the simulation.
//
// Cost: at most 19 field samples a frame, a scan of the trees and the buildings' parts while an event runs or debris
// still falls, one position difference per live body; no allocation per frame (scratch arrays, bound callbacks).

import { GRAVITY } from '../physics/Loads.js';
import { mulberry32 } from '../util/Noise.js';

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

		const [ f1, a1 ] = AIR[ i ];
		if ( a1 * km < CUTOFF_LOSS ) continue;
		const [ f0, a0 ] = AIR[ i - 1 ];
		const k = Math.log( CUTOFF_LOSS / ( a0 * km ) ) / Math.log( a1 / a0 );
		return Math.exp( Math.log( f0 ) + k * Math.log( f1 / f0 ) );

	}

	const [ f8, a8 ] = AIR[ AIR.length - 1 ];
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

// ---------------------------------------------------------------- shake and lens couplings (declared, docs)
const ARRIVAL_NEAR = 30; // m: the breaking front's crash fires as it comes this close ...
const ARRIVAL_REARM = 60; // m: ... and again only after it has been beyond this ...
const ARRIVAL_REARM_S = 10; // s: ... for this long
const STRIKE_FLUX = RHO_SEA * 2 * 5 * 5; // N/m: momentum flux rho h u^2 of a 2 m surge at 5 m/s ...
const STRIKE_KICK = 0.02; // rad: ... kicks the camera this much within ...
const STRIKE_NEAR = 15; // m
const IMPACT_KICK = 0.004; // rad for 10 kJ at 10 m, as sqrt(E) / r (ground vibration from dropped weights, Mayne et al. 1984)
const IMPACT_RANGE = 80; // m: no kick beyond
const IMPACT_DV = 2.5; // m/s: a body's velocity changing by more than this in one frame struck something ...
const IMPACT_DV_MAX = 60; // m/s: ... unless it changed by more than this (a placement, not a collision)
const IMPACT_ENERGY = 2000; // J: lighter strikes are not heard
const IMPACT_REST = 0.4; // s between two strikes of one body
const SPRAY_REACH = 1.5; // m: the flood's surface this close below the lens throws water onto it ...
const SPRAY_SPEED = 2; // m/s: ... when it runs faster than this
const LENS_REST = 1.5; // s between two wettings
const COUPLE_FULL = 4, COUPLE_NONE = 10; // m above the ground or water: the ground's shake reaches the camera fully, then not
const GUST_TAU = 1.5, GUST_SIGMA = 0.25; // s, turbulence intensity of the gusts on the event's wind

const NO_SCAN = - 1;

export class DisasterSound {

	constructor( app ) {

		this.app = app;
		// the camera shake's input, refreshed every frame (src/core/CameraShake.js)
		this.listener = { active: false, ax: 0, ay: 0, az: 0, shake: 0, coupling: 0, wind: 0 };
		this.state = { sources: 0, nodes: 0, voices: 0, queued: 0, dropped: 0, front: Infinity, depth: 0, rush: - Infinity, roar: - Infinity, rumble: - Infinity, vortex: - Infinity, vortexCutoff: 20000, gale: - Infinity, quake: - Infinity, level: - Infinity, ms: 0, msMax: 0 };
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
		this.armed = true;
		this.awayT = 0;
		this.kickT = - 1e9;
		this.wetT = - 1e9;
		this.backT = 0;
		this.audioT = 0;
		this.live = false;
		this.treePhase = new Uint8Array( 0 );
		this.partsSeen = new Int32Array( 0 );
		this.broken = new Uint8Array( 0 );
		this.heard = new WeakSet();
		this.bodies = new Map(); // body id -> [ px, py, pz, vx, vy, vz, last strike s, frame stamp, frames seen ]
		this.frame = 0;
		this.dtGame = 0;
		this.lx = 0;
		this.ly = 0;
		this.lz = 0;
		this.order = new Int16Array( MAX_PENDING );
		this.orderLevel = new Float32Array( MAX_PENDING );
		this.dueCount = 0;
		this.trackBody = ( b ) => this.track( b );
		this.pruneBody = ( e, id, map ) => {

			if ( e[ 7 ] !== this.frame ) map.delete( id );

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
		this.broken.fill( 0 );
		this.heard = new WeakSet();
		this.bodies.clear();
		this.armed = true;
		this.awayT = 0;
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
		const L = this.listener, st = this.state;
		L.active = active;
		if ( ! active ) L.ax = L.ay = L.az = L.shake = L.wind = 0;
		st.rush = st.roar = st.rumble = st.vortex = st.gale = st.quake = - Infinity;
		st.front = Infinity;
		st.depth = 0;
		if ( active ) this.listen( field, p, dt );
		if ( live ) this.scan( field );
		this.play();
		const ms = performance.now() - t0;
		st.ms = st.ms * 0.95 + ms * 0.05;
		st.msMax = Math.max( st.msMax * 0.999, ms );

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

		// the flood running past the lens: its surface within reach below the camera, moving fast
		if ( depth > WET && speed > SPRAY_SPEED && surface > p.y - SPRAY_REACH ) {

			this.wetLens( clamp( ( speed - SPRAY_SPEED ) / 4, 0.4, 1 ) );
			if ( this.clock - this.kickT > 2 ) this.strike( RHO_SEA * depth * speed * speed );

		}

		// the backwash: the flood running back against the wave's heading, dragging sand and stones
		if ( this.heading !== null && depth > WET ) {

			const a = this.heading * Math.PI / 180, along = ux * Math.cos( a ) + uz * Math.sin( a );
			this.backT -= dt;
			if ( along < - 1 && this.backT <= 0 ) {

				this.backT = 1.2 + 1.2 * this.rand();
				const L10 = 80 + 20 * Math.log10( - along / 2 ) + 10 * Math.log10( Math.min( depth, 2 ) / 0.5 );
				this.hear( KIND.backwash, p.x - Math.cos( a ) * 8, surface, p.z - Math.sin( a ) * 8, L10 );

			}

		}

	}

	strike( flux ) {

		this.kickT = this.clock;
		this.app.cameraShake?.kick( STRIKE_KICK * Math.min( 1, flux / STRIKE_FLUX ), 5 );

	}

	wetLens( strength ) {

		if ( this.clock - this.wetT < LENS_REST ) return;
		const lens = this.app.post?.lens;
		if ( ! lens?.splash ) return;
		this.wetT = this.clock;
		lens.splash( strength, this.rand() * 97 );

	}

	hear( kind, x, y, z, L10 ) {

		return this.queue.push( kind, x, y, z, L10, this.clock, this.lx, this.ly, this.lz );

	}

	// what broke since the last frame: trees, building parts, whole buildings, bodies striking
	scan( field ) {

		const D = this.app.disasters;
		const trees = D.bodies?.trees;
		if ( trees ) {

			if ( this.treePhase.length !== trees.length ) this.treePhase = new Uint8Array( trees.length );
			for ( let k = 0; k < trees.length; k ++ ) {

				const t = trees[ k ];
				const code = t.phase === 'hinge' ? 1 : t.phase === 'rest' ? 2 : t.phase === 'body' ? 3 : 0;
				const was = this.treePhase[ k ];
				if ( code === was ) continue;
				this.treePhase[ k ] = code;
				const r = t.r;
				if ( ! r ) continue;
				const mass = t.piece?.mass ?? t.mass?.mass ?? 400;
				if ( was === 0 && code > 0 ) {

					// it failed: a trunk snapping at its cut, or the root plate tearing out of the soil
					if ( t.mode === 'snap' ) this.hear( KIND.snap, r.x, ( r.y ?? 0 ) + ( t.cut ?? 0 ), r.z, snapLevel( mass ) );
					else this.hear( KIND.tear, r.x, r.y ?? 0, r.z, snapLevel( mass ) - 2 );

				} else if ( was === 1 && code === 2 ) {

					// it landed: its centre of mass fell about half its height
					const energy = mass * GRAVITY * 0.5 * Math.max( 3, r.H ?? 6 );
					this.hear( KIND.treefall, r.x, ( r.y ?? 0 ) + 1, r.z, energyLevel( energy ) );
					this.impactKick( energy, r.x, ( r.y ?? 0 ) + 1, r.z );

				}

			}

		}

		const records = D.structures?.records;
		if ( records ) {

			if ( this.partsSeen.length !== records.length ) {

				this.partsSeen = new Int32Array( records.length );
				this.broken = new Uint8Array( records.length );

			}

			for ( let i = 0; i < records.length; i ++ ) {

				const r = records[ i ];
				if ( r.progressive && r.components ) {

					const failed = r.failedCount | 0;
					if ( failed < this.partsSeen[ i ] ) this.partsSeen[ i ] = failed;
					if ( failed === this.partsSeen[ i ] ) continue;
					this.partsSeen[ i ] = failed;
					for ( const c of r.components ) {

						if ( ! c.failed || this.heard.has( c ) ) continue;
						this.heard.add( c );
						const at = c.center;
						const x = at?.[ 0 ] ?? at?.x, y = at?.[ 1 ] ?? at?.y, z = at?.[ 2 ] ?? at?.z;
						this.hear( PART_KIND[ c.kind ] ?? KIND.part, x, y, z, partLevel( c.mass ?? 200 ) );

					}

				} else {

					const b = r.broken ? 1 : 0;
					if ( b && ! this.broken[ i ] && r.center ) {

						this.hear( KIND.collapse, r.center.x, r.center.y ?? 0, r.center.z, COLLAPSE_LEVEL );
						this.impactKick( 2e5, r.center.x, r.center.y ?? 0, r.center.z );

					}

					this.broken[ i ] = b;

				}

			}

		}

		if ( this.dtGame > 0 ) {

			D.bodies?.bodies?.forEach( this.trackBody );
			D.structures?.bodies?.forEach( this.trackBody );
			if ( this.frame % 120 === 0 ) this.bodies.forEach( this.pruneBody );

		}

	}

	// a body's velocity from its position frame to frame; a sudden change is a strike
	track( b ) {

		const p = b?.position;
		if ( ! p || ! finite( p.x + p.y + p.z ) ) return;
		let e = this.bodies.get( b.id );
		if ( ! e ) {

			e = new Float64Array( 9 );
			e[ 0 ] = p.x;
			e[ 1 ] = p.y;
			e[ 2 ] = p.z;
			e[ 6 ] = - 1e9;
			e[ 7 ] = this.frame;
			this.bodies.set( b.id, e );
			return;

		}

		const dt = this.dtGame;
		const vx = ( p.x - e[ 0 ] ) / dt, vy = ( p.y - e[ 1 ] ) / dt, vz = ( p.z - e[ 2 ] ) / dt;
		if ( e[ 8 ] >= 1 ) {

			const dv = Math.hypot( vx - e[ 3 ], vy - e[ 4 ], vz - e[ 5 ] );
			const energy = 0.5 * ( b.mass ?? 0 ) * dv * dv;
			if ( dv > IMPACT_DV && dv < IMPACT_DV_MAX && energy > IMPACT_ENERGY && this.clock - e[ 6 ] > IMPACT_REST ) {

				e[ 6 ] = this.clock;
				const water = this.app.disasters.field.waterAt?.( p.x, p.z );
				const kind = finite( water ) && p.y < water + 0.5 ? KIND.splash : KIND.impact;
				this.hear( kind, p.x, p.y, p.z, energyLevel( energy ) );
				this.impactKick( energy, p.x, p.y, p.z );

			}

		}

		e[ 0 ] = p.x;
		e[ 1 ] = p.y;
		e[ 2 ] = p.z;
		e[ 3 ] = vx;
		e[ 4 ] = vy;
		e[ 5 ] = vz;
		e[ 7 ] = this.frame;
		e[ 8 ] ++;

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
				A.setDisasterGain( muted ? 0 : Math.min( 2, ( siren?.volume ?? 0.25 ) / 0.25 ) );
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
		const [ bank, rate ] = VOICE[ P.kind[ k ] ];
		const pick = Math.floor( this.rand() * 64 );
		A.disasterShot( bank, P.x[ k ], P.y[ k ], P.z[ k ], lufs, rate * ( 0.94 + 0.12 * this.rand() ), airCutoff( d ), pick );

	}

}
