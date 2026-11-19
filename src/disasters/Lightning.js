import { STREAM, uniform } from './EventRandom.js';

// Lightning of the tornado's parent storm (docs/tornado-visuals.md, "Design: the storm"). World
// metres and seconds. Two kinds of flash: 'cloud' (inside the deck, a glow that lights the base from
// within) and 'ground' (a channel from the base to the ground). Each flash is one to three luminance
// pulses (return strokes or in-cloud flickers). Every draw comes from the event's seed through its own
// EventRandom stream: flash k's gap, kind, place and pulses are hashes of ( seed, k ), so a fixed
// seed replays the storm's lightning and a fresh event never repeats one.
//
// Every admitted pulse is recorded as a stroke (`strokes`, `onStroke`): thunder and anything else
// that reacts to lightning listens there and never re-derives the schedule.
export const LIGHTNING = Object.freeze( {
	// Severe storms flash tens of times a minute, above 60 a minute in the strongest (Williams et al.
	// 1999, Atmos. Res. 51). Declared: one flash every 2.5 s on average at full strength (24 a minute:
	// the flashes a viewer under the storm sees), exponential gaps cut to 0.5-9 s.
	meanInterval: 2.5, // s between flashes at full strength
	minGap: 0.5, // s
	maxGap: 9, // s
	minStrength: 0.15, // storm strength 0..1 below which the gaps stop growing (a weak storm still flashes)
	// Intracloud flashes outnumber ground flashes 3-10 to 1 in severe storms (Rakov and Uman 2003,
	// Lightning: Physics and Effects, ch. 2). Declared at the violent end for the eye: three in ten.
	groundShare: 0.3,
	// A ground flash has 3-5 return strokes 40-60 ms apart (Rakov and Uman 2003, ch. 4). Here at most
	// three pulses, and no closer than the safety spacing below.
	pulseGap: [ 0.14, 0.24 ], // s between the pulses of one flash
	decay: 0.06, // s, time constant of a pulse's light (a return stroke's continuing luminosity: tens of ms)
	// Safety (WCAG 2.2, 2.3.1 Three Flashes or Below Threshold): no more than three flashes in any
	// one second. Every pulse is a flash for this rule. A pulse is admitted only if the third pulse
	// before it began more than `window` s earlier (0.05 s of margin on the 1 s period) and the last one
	// at least `minSpacing` earlier, on both the storm's clock and the wall clock, so neither a paused
	// nor a hurried simulation can break it. A pulse that fails is dropped: never drawn, never recorded.
	window: 1.05, // s
	maxInWindow: 3,
	minSpacing: 0.12, // s
	// Reduced motion (prefers-reduced-motion: reduce): a flash is one slow glow, 0.6 s up and 1.4 s
	// down at a fifth of the peak, and its later pulses are not drawn.
	glowRise: 0.6, // s
	glowFall: 1.4, // s
	glowPeak: 0.2,
	// Where: ground strokes fall within this many wall-cloud radii of the tornado or of the rain
	// core's centre; cloud flashes within `cloudReach` m of the point midway between them.
	groundReach: 1.2, // wall-cloud radii
	cloudReach: 4000, // m
	channelNodes: 9, // nodes of a ground channel, base to ground
	channelWander: 0.16, // sideways step of the channel per node, as a fraction of the node spacing times sqrt(nodes)
} );

const RECORDS = 64; // strokes kept for listeners that poll
const ACTIVE = 4; // pulses that can be alight at once (60 ms decay, 0.12 s spacing: two overlap at most)
const PENDING = 8; // pulses waiting for their time

// One JS reading of the system's reduced-motion setting, kept current by its change event.
let motionQuery = null;
export function prefersReducedMotion() {

	if ( ! globalThis.matchMedia ) return false;
	motionQuery ??= globalThis.matchMedia( '(prefers-reduced-motion: reduce)' );
	return motionQuery.matches;

}

// Light of one pulse `age` s after it began, as a fraction of its peak. Full motion: an instant rise
// and an exponential fall. Reduced motion: a smooth rise and fall with no step.
export function pulseLight( age, reduced ) {

	if ( age < 0 ) return 0;
	if ( ! reduced ) return Math.exp( - age / LIGHTNING.decay );
	const up = Math.min( 1, age / LIGHTNING.glowRise ), down = Math.min( 1, Math.max( 0, ( age - LIGHTNING.glowRise ) / LIGHTNING.glowFall ) );
	return LIGHTNING.glowPeak * up * up * ( 3 - 2 * up ) * ( 1 - down * down * ( 3 - 2 * down ) );

}

const pulseLife = ( reduced ) => reduced ? LIGHTNING.glowRise + LIGHTNING.glowFall : LIGHTNING.decay * 8;

export class StormLightning {

	// wallClock: seconds, monotonic (tests pass their own)
	constructor( wallClock = () => performance.now() / 1000 ) {

		this.wallClock = wallClock;
		this.clock = 0; // s, the storm's own clock: every simulated second since the page loaded, never reset
		this.seed = null;
		this.flashIndex = 0;
		this.nextFlash = Infinity; // event time of the next flash, s
		this.reduced = false;
		// the three most recent admitted pulses, on both clocks (the safety limiter's whole state)
		this.recentClock = new Float64Array( LIGHTNING.maxInWindow ).fill( - 1e9 );
		this.recentWall = new Float64Array( LIGHTNING.maxInWindow ).fill( - 1e9 );
		this.pending = Array.from( { length: PENDING }, () => ( { at: 0, flash: 0, index: 0, kind: 'cloud', x: 0, y: 0, z: 0, peak: 1, live: false } ) );
		this.active = Array.from( { length: ACTIVE }, () => ( { start: 0, kind: 'cloud', x: 0, y: 0, z: 0, peak: 1, flash: 0, live: false } ) );
		this.strokes = Array.from( { length: RECORDS }, () => ( { id: 0, flash: 0, index: 0, kind: 'cloud', x: 0, y: 0, z: 0, time: 0, clock: 0, peak: 0 } ) );
		this.count = 0; // strokes recorded since the page loaded
		this.dropped = 0; // pulses the safety limiter refused
		this.listeners = [];
		// what the frame draws: the brightest pulse alight now
		this.level = 0; // 0..1 light of all pulses alight (capped at 1)
		this.kind = 'cloud';
		this.x = 0;
		this.y = 0;
		this.z = 0;
		this.channel = new Float32Array( LIGHTNING.channelNodes * 2 ); // x, z of each node, base first
		this.channelBase = 0; // m, world height of the channel's top
		this.channelGround = 0; // m, world height of its foot
		this.channelFlash = - 1;

	}

	// fn( stroke ) for every admitted pulse: { id, flash, index, kind: 'cloud' | 'ground', x, y, z (m, world),
	// time (s, the disaster clock), clock (s, the storm's clock), peak (0..1) }. The record is reused
	// after 64 more strokes: copy what must outlive that. Returns the function that removes the listener.
	onStroke( fn ) {

		this.listeners.push( fn );
		return () => {

			const i = this.listeners.indexOf( fn );
			if ( i >= 0 ) this.listeners.splice( i, 1 );

		};

	}

	// The i-th most recent stroke (0: the latest), or null.
	recent( i ) {

		return i < Math.min( this.count, RECORDS ) ? this.strokes[ ( this.count - 1 - i ) % RECORDS ] : null;

	}

	// dt: simulated s this frame (0 while paused). e: the active tornado event or undefined.
	// storm: { strength 0..1, x, z (the tornado, m), coreX, coreZ (rain core centre, m), wallRadius m,
	// deckY (world height of the storm base, m), time (the disaster clock, s) }. groundAt( x, z ): m.
	update( dt, e, storm, groundAt, reduced = prefersReducedMotion() ) {

		if ( Number.isFinite( dt ) && dt > 0 ) this.clock += dt;
		this.reduced = reduced;
		if ( e && storm.strength > 0 && Number.isFinite( dt ) && dt > 0 ) {

			if ( this.seed !== e.seed ) {

				this.seed = e.seed;
				this.flashIndex = 0;
				this.nextFlash = e.time + this.gap( 0, storm.strength );

			}
			let spawned = 0;
			while ( e.time >= this.nextFlash && spawned ++ < 2 ) {

				this.spawn( this.flashIndex, storm, groundAt );
				this.flashIndex ++;
				this.nextFlash += this.gap( this.flashIndex, storm.strength );

			}
			if ( e.time >= this.nextFlash ) this.nextFlash = e.time; // a long frame never queues a burst

		} else if ( ! e ) {

			// no tornado: nothing waits, nothing more is drawn or recorded (pulses alight fade on their own)
			for ( const p of this.pending ) p.live = false;
			this.seed = null;
			this.nextFlash = Infinity;

		}
		const wall = this.wallClock();
		for ( const p of this.pending ) {

			if ( ! p.live || p.at > this.clock ) continue;
			p.live = false;
			if ( reduced && p.index > 0 ) continue; // one glow per flash
			if ( this.admit( wall ) ) this.strike( p, storm, wall );
			else this.dropped ++;

		}
		// the light this frame
		let level = 0, best = 0;
		const life = pulseLife( reduced );
		for ( const a of this.active ) {

			if ( ! a.live ) continue;
			const age = this.clock - a.start;
			if ( age > life ) { a.live = false; continue; }
			const l = a.peak * pulseLight( age, reduced );
			level += l;
			if ( l > best ) { best = l; this.kind = a.kind; this.x = a.x; this.y = a.y; this.z = a.z; }

		}
		this.level = Math.min( 1, level );
		return this.level;

	}

	// s from flash k - 1 to flash k
	gap( k, strength ) {

		const u = uniform( this.seed, STREAM.lightning, k * 8 );
		const mean = LIGHTNING.meanInterval / Math.max( LIGHTNING.minStrength, Math.min( 1, strength ) );
		return Math.min( LIGHTNING.maxGap, Math.max( LIGHTNING.minGap, - mean * Math.log( 1 - u ) ) );

	}

	spawn( k, storm, groundAt ) {

		const u = ( i ) => uniform( this.seed, STREAM.lightning, k * 8 + i );
		const ground = u( 1 ) < LIGHTNING.groundShare;
		const angle = 2 * Math.PI * u( 2 ), r = Math.sqrt( u( 3 ) );
		let x, z, y;
		if ( ground ) {

			// half the ground strokes fall round the rain core, half round the tornado
			const core = u( 4 ) < 0.5, reach = LIGHTNING.groundReach * storm.wallRadius;
			x = ( core ? storm.coreX : storm.x ) + Math.cos( angle ) * r * reach;
			z = ( core ? storm.coreZ : storm.z ) + Math.sin( angle ) * r * reach;
			y = Math.max( 0, groundAt( x, z ) );
			// The channel, base to ground: a sideways random walk (tortuosity), pinned to the strike point.
			const n = LIGHTNING.channelNodes, step = ( storm.deckY - y ) / ( n - 1 ) * LIGHTNING.channelWander * Math.sqrt( n );
			let ox = 0, oz = 0;
			for ( let i = n - 1; i >= 0; i -- ) {

				this.channel[ i * 2 ] = x + ox;
				this.channel[ i * 2 + 1 ] = z + oz;
				ox += ( uniform( this.seed, STREAM.lightning, 4096 + k * 32 + i * 2 ) - 0.5 ) * 2 * step;
				oz += ( uniform( this.seed, STREAM.lightning, 4096 + k * 32 + i * 2 + 1 ) - 0.5 ) * 2 * step;

			}
			this.channelBase = storm.deckY;
			this.channelGround = y;
			this.channelFlash = k;

		} else {

			x = ( storm.x + storm.coreX ) / 2 + Math.cos( angle ) * r * LIGHTNING.cloudReach;
			z = ( storm.z + storm.coreZ ) / 2 + Math.sin( angle ) * r * LIGHTNING.cloudReach;
			y = storm.deckY + 300; // m: inside the deck

		}
		const pulses = ground ? ( u( 5 ) < 0.4 ? 1 : u( 5 ) < 0.75 ? 2 : 3 ) : ( u( 5 ) < 0.6 ? 1 : 2 );
		let at = this.clock;
		for ( let j = 0; j < pulses; j ++ ) {

			const slot = this.pending.find( ( p ) => ! p.live );
			if ( ! slot ) break;
			slot.live = true;
			slot.at = at;
			slot.flash = k;
			slot.index = j;
			slot.kind = ground ? 'ground' : 'cloud';
			slot.x = x;
			slot.y = y;
			slot.z = z;
			slot.peak = j === 0 ? 1 : 0.5 + 0.4 * u( 6 + j % 2 ); // later strokes are weaker
			at += LIGHTNING.pulseGap[ 0 ] + ( LIGHTNING.pulseGap[ 1 ] - LIGHTNING.pulseGap[ 0 ] ) * u( 6 + j % 2 );

		}

	}

	// The safety limiter: true if a pulse may begin now, on the storm's clock and the wall clock.
	admit( wall ) {

		const c = this.recentClock, w = this.recentWall, last = LIGHTNING.maxInWindow - 1;
		// index 0 is the oldest of the three most recent pulses
		if ( this.clock - c[ 0 ] <= LIGHTNING.window || wall - w[ 0 ] <= LIGHTNING.window ) return false;
		if ( this.clock - c[ last ] < LIGHTNING.minSpacing || wall - w[ last ] < LIGHTNING.minSpacing ) return false;
		for ( let i = 0; i < last; i ++ ) { c[ i ] = c[ i + 1 ]; w[ i ] = w[ i + 1 ]; }
		c[ last ] = this.clock;
		w[ last ] = wall;
		return true;

	}

	strike( p, storm, wall ) {

		let slot = this.active[ 0 ];
		for ( const a of this.active ) if ( ! a.live || a.start < slot.start ) { slot = a; if ( ! a.live ) break; }
		slot.live = true;
		slot.start = this.clock;
		slot.kind = p.kind;
		slot.x = p.x;
		slot.y = p.y;
		slot.z = p.z;
		slot.peak = p.peak;
		slot.flash = p.flash;
		const s = this.strokes[ this.count % RECORDS ];
		s.id = this.count;
		s.flash = p.flash;
		s.index = p.index;
		s.kind = p.kind;
		s.x = p.x;
		s.y = p.y;
		s.z = p.z;
		s.time = storm.time;
		s.clock = this.clock;
		s.peak = p.peak;
		this.count ++;
		for ( let i = 0; i < this.listeners.length; i ++ ) this.listeners[ i ]( s );

	}

}
