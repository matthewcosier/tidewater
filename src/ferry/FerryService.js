// The Tidewater Spirit's scheduled service between Tidewater and Joey Island. The timetable
// loads her at one berth (ramp down, gangway out), casts her off with the prolonged blast, and
// the autopilot sails her across on her own controls (throttles, wheel, bow and stern
// thrusters): out along the berth's axis, across the strait at service speed, a swing to
// stern-to well off the far harbour's mouth, then dynamic positioning down the berth's axis:
// heading held, the thrusters walking her sideways onto the line, the levers backing her in at
// a crawl onto her marks, where the lines come on through the same capture a helmsman uses
// (Ferry.onMarks). Anyone taking her helm has her; when they leave it, the service carries on
// from wherever she is.
import { HULL, surgeResistance, fullThrust } from './FerryShip.js';

const NONE = [];
const wrap = a => Math.atan2( Math.sin( a ), Math.cos( a ) );
const clamp = ( v, lo, hi ) => Math.max( lo, Math.min( hi, v ) );

export const GATE = 85;
export const SWEEP = 60;
const BRAKE = 0.5;
const SWING = [ 0, 0.3 ];
// m out along the berth she leaves before turning for the crossing: her stern clear of the jetty
// head (terminal z 78) by 5 m. At 60 m out her stern still lay alongside it, and the turn kicked
// it into the marina walkway (test/ferry-fleet.mjs sweep, with the 100 kN thrusters).
export const CLEAR = GATE;
const DEPART = 6;
const YAW_BRAKE = 0.012;
const TURN = 2;               // m/s while she is still more than 40 degrees off her course
export const CRUISE = 12;     // m/s service speed (about 23 knots), a little under her 12.5 m/s top at service rating
const HOLD = 90;              // m of the berth, and under HOLD_SPEED, where she comes in on positioning
const HOLD_SPEED = 2;
const CREEP = 4.5;
// m to port of her marks she aims for: her port side lies a metre off the jetty's fender face,
// and the winches haul her the rest of the way once the lines are on
const MARK = - 0.3;
const JETTY = 80;             // m out from her marks where her stern passes the jetty head (terminal z 78)
const RAMP_TIME = 12;         // s, as Ferry.js

export const FLEET = [
	{ name: 'Tidewater Spirit', home: 0, platform: 1 },
	{ name: 'Sealion Spirit', home: 1, platform: 2, livery: [ 0.62, 0.22, 0.06 ] },
];
// Passing (COLREGS rule 9, keep to the starboard side of a channel, and rule 14, head-on ships
// both alter to starboard and pass port to port). A game choice, declared: SAFE is two ship
// lengths centre to centre (82 m of water between the hulls), and test/ferry-fleet.mjs shows the
// pair never come closer over two round trips.
export const SAFE = 100;      // m, the closest the autopilot lets two ships come
const LANE = 80;              // m, each ship's track to starboard of the line between the gates
const TAPER = 150;            // m from her departure over which she eases out onto it
const TAPER_IN = 260;         // m short of the far gate over which she eases back onto its line, so
                              // she meets the gate near its axis and her swing stays short
const LOOK = 150;             // m ahead along her lane she steers for
const AWARE = 450;            // m, inside which a closing ship holds her full lane and eases her
const MEET = 900;             // m, inside which she turns out of her harbour at TURN
const PARTNER = 20;

export class Autopilot {

	constructor() { this.leg = 'depart'; this.from = null; this.to = null; this.lat = 0; this.along = 0; }

	// A passage from wherever she is to berth `to` ({ x, z, yaw }); `from` is the berth she has
	// just left (she runs straight out along it first), or null.
	route( ship, to, from = null ) {

		this.to = to; this.from = from;
		this.sx = ship.position.x; this.sz = ship.position.z;
		const near = Math.hypot( ship.position.x - to.x, ship.position.z - to.z ) < HOLD && ship.speed < HOLD_SPEED && Math.abs( wrap( to.yaw - ship.yaw ) ) < 0.8;
		this.leg = from && Math.hypot( ship.position.x - from.x, ship.position.z - from.z ) < CLEAR ? 'depart' : near ? 'back' : 'cross';

	}

	// Her lane across the strait: LANE m to starboard of the line from where she began the
	// passage to the far gate, eased in and out over TAPER m at each end so she still meets the
	// gate on its axis. Sets the point she steers for (ax, az); returns her speed factor. A ship
	// closing inside AWARE holds the full lane and both ease off, so a late departure that meets
	// her near one end still passes clear (the defect: tracks between the gates crossed like an
	// X, and the pair passed starboard to starboard).
	lane( ship, g, rivals ) {

		const p = ship.position, tx0 = g.x - this.sx, tz0 = g.z - this.sz, L = Math.hypot( tx0, tz0 ) || 1;
		const tx = tx0 / L, tz = tz0 / L;
		const along = ( p.x - this.sx ) * tx + ( p.z - this.sz ) * tz;
		const ahead = Math.min( L, Math.max( along, 0 ) + LOOK );
		let lane = clamp( Math.min( ahead / TAPER, ( L - ahead ) / TAPER_IN ), 0, 1 ), ease = 1;
		this.meet = false;
		for ( const r of rivals ) {

			const o = r.ship;
			if ( ! o || o === ship ) continue;
			const rx = o.position.x - p.x, rz = o.position.z - p.z, range = Math.hypot( rx, rz );
			const closing = rx * ( o.velocity.x - ship.velocity.x ) + rz * ( o.velocity.z - ship.velocity.z ) < 0;
			if ( range < MEET ) this.meet = true;
			// she is ahead of us (inside 60 degrees of the bow): a meeting, so hold the lane
			const ahead60 = rx * Math.sin( ship.yaw ) + rz * Math.cos( ship.yaw ) > 0.5 * range;
			if ( range < AWARE && closing && ahead60 && L - along > SWEEP ) lane = 1;
			if ( range < 2 * SAFE && closing ) ease = Math.min( ease, clamp( ( range - SAFE ) / SAFE, 0.35, 1 ) );

		}
		// starboard of a heading (tx, tz) is (-tz, tx): FerryShip's frame has +X to port
		this.ax = this.sx + tx * ahead - tz * LANE * lane;
		this.az = this.sz + tz * ahead + tx * LANE * lane;
		return ease;

	}

	gate( b, d = GATE ) { return { x: b.x + Math.sin( b.yaw ) * d, z: b.z + Math.cos( b.yaw ) * d }; }

	steer( ship, rivals = NONE ) {

		const p = ship.position, to = this.to;
		if ( this.leg === 'depart' ) {

			// straight out along the berth's axis, held on it by the thrusters until she has way on
			const f = this.from, out = ( p.x - f.x ) * Math.sin( f.yaw ) + ( p.z - f.z ) * Math.cos( f.yaw );
			// slowly: at service speed her 170 m turning circle swung each ship wide of her lane, so
			// the pair crossed like an X and passed starboard to starboard
			this.position( ship, f, DEPART, MARK );
			if ( out > CLEAR ) { this.leg = 'cross'; this.sx = p.x; this.sz = p.z; }

		} else if ( this.leg === 'cross' ) {

			const g = this.gate( to ), d = Math.hypot( g.x - p.x, g.z - p.z );
			const ease = this.lane( ship, g, rivals ), course = Math.atan2( this.ax - p.x, this.az - p.z );
			// turn first, at TURN with the bow thruster biting, then build way to service speed
			// (only while the other ship is within MEET: on a long strait they meet mid-way, and a
			// crawl through her turn out of Joey cost 25 s for nothing)
			const slowTurn = this.meet ? TURN : CRUISE;
			const turning = slowTurn + ( CRUISE - slowTurn ) * clamp( ( 0.7 - Math.abs( wrap( course - ship.yaw ) ) ) / 0.26, 0, 1 );
			// she plans to come to rest on the gate: the braking curve to it, never slower than a crawl
			const stop = Math.max( 0.8, Math.sqrt( 2 * BRAKE * Math.max( 0, d - 2 ) ) );
			this.helm( ship, course, Math.min( CRUISE, stop, turning ) * ease );
			if ( d < SWEEP ) this.leg = 'swing';

		} else if ( this.leg === 'swing' ) {

			// a sweeping turn onto the berth's axis heading out, so she lies stern-to well off the
			// harbour's mouth, then her way comes off
			const err = Math.abs( wrap( to.yaw - ship.yaw ) );
			const g = this.gate( to ), sn = Math.sin( ship.yaw ), cs = Math.cos( ship.yaw ), ex = g.x - p.x, ez = g.z - p.z;
			const ahead = ex * sn + ez * cs, abeam = ex * cs - ez * sn, drift = ship.velocity.x * cs - ship.velocity.z * sn;
			const want = clamp( 0.2 * abeam, - 0.8, 0.8 );
			const sway = HULL.SWAY_DRAG * want * Math.abs( want ) + 40000 * want + HULL.MASS * 0.4 * ( want - drift );
			this.helm( ship, to.yaw, clamp( 0.15 * ahead, - 1, 1 ) * ( SWING[ 0 ] + SWING[ 1 ] * Math.min( 1, err / 0.8 ) ) / SWING[ 1 ], sway );
			// square to the axis within 3 degrees: at 7 degrees off, her stern's port corner stood 2.9 m
			// wide, and backing past the jetty head it grazed the marina walkway
			if ( err < 0.05 ) this.leg = 'back';

		} else {

			// dynamic positioning down the axis: astern at up to CREEP, easing to a crawl on her
			// marks, and holding off while she is not yet on the line or square to it
			const fx = Math.sin( to.yaw ), fz = Math.cos( to.yaw ), px = p.x - to.x, pz = p.z - to.z;
			const along = px * fx + pz * fz, lat = px * fz - pz * fx;
			const off = Math.max( Math.abs( lat - MARK ) - 0.4, 0 ), skew = Math.abs( wrap( to.yaw - ship.yaw ) );
			const ready = clamp( 1.5 - off / Math.max( 0.3, 0.08 * ( along - JETTY ) ), 0, 1 ) * clamp( 2 - skew / 0.03, 0, 1 );
			// a braking curve of 0.175 m/s2, what the levers' 110 kN per m/s gain gives without lag (at
			// 0.25 m/s2 she ran 2 m past her marks at 1 m/s); past them she comes ahead again, where the
			// old crawl kept pushing her astern into the linkspan
			const creep = along > 0 ? Math.min( CREEP, Math.sqrt( 0.35 * along ), 0.12 * along + 0.05 ) : 0.12 * along;
			this.position( ship, to, - creep * ready, MARK );
			this.lat = lat; this.along = along;

		}

	}

	// Dynamic positioning on berth b's axis: her heading held on the berth's and her way along
	// the axis at `speed` (+ out, - in) by the levers, while the thrusters walk her sideways onto
	// the line `mark` m to port of it (both the same way) and hold the heading (opposite ways).
	position( ship, b, speed, mark ) {

		const fx = Math.sin( b.yaw ), fz = Math.cos( b.yaw ), px = ship.position.x - b.x, pz = ship.position.z - b.z;
		const side = px * fz - pz * fx, drift = ship.velocity.x * fz - ship.velocity.z * fx;
		// up to 0.8 m/s sideways: both 100 kN thrusters walk her at about 0.95 m/s (0.5 m/s on 40 kN)
		const want = clamp( 0.12 * ( mark - side ), - 0.8, 0.8 );
		const sway = HULL.SWAY_DRAG * want * Math.abs( want ) + 40000 * want + HULL.MASS * 0.4 * ( want - drift );
		const err = wrap( b.yaw - ship.yaw ), rate = clamp( 0.15 * err, - 0.03, 0.03 );
		const turn = 3.0e8 * rate * Math.abs( rate ) + 1.2e6 * rate + HULL.YAW_INERTIA * 0.6 * ( rate - ship.r );
		ship.thruster = clamp( ( - sway - turn / HULL.THRUSTER_ARM ) / 2 / HULL.THRUSTER, - 1, 1 );
		ship.stern = clamp( ( - sway + turn / HULL.THRUSTER_ARM ) / 2 / HULL.THRUSTER, - 1, 1 );
		ship.wheel = ship.u > 1.5 ? clamp( - 2.5 * err + 30 * ship.r, - 1, 1 ) : 0;
		this.throttle( ship, speed );

	}

	// Wheel, throttles and bow thruster toward a heading and a speed through the water.
	// `sway` (N, + to port) is a sideways push both thrusters share, on top of the turn.
	helm( ship, yaw, speed, sway = 0 ) {

		const err = wrap( yaw - ship.yaw ), u = ship.u;
		const slow = clamp( 1.5 - Math.abs( u ) / 3, 0, 1 );
		ship.wheel = u > 0.3 || ship.power > 0.05 ? clamp( - 2.5 * err + 30 * ship.r, - 1, 1 ) : 0;
		const e = Math.abs( err ), rate = Math.sign( err ) * Math.min( 0.12, Math.sqrt( 2 * YAW_BRAKE * e ), 0.5 * e );
		const turn = 60 * ( ship.r - rate ) * slow, walk = - sway / 2 / HULL.THRUSTER;
		const t = clamp( turn, - 1, 1 ), spare = 1 - Math.abs( t ), w = clamp( walk, - spare, spare );
		ship.thruster = t + w;
		ship.stern = - t + w;
		this.throttle( ship, speed );

	}

	// The levers for a speed through the water: her drag at that speed (the hull's own curve), fed
	// forward, and 110 kN more per m/s of difference. That is the old law's half a lever per m/s on
	// the old 220 kN engines, kept in newtons so the bigger engines (2026-10-05) don't double the
	// gain and set her hunting on the berth.
	throttle( ship, speed ) {

		const force = surgeResistance( speed ) + 0.5 * HULL.THRUST * ( speed - ship.u );
		ship.lever = clamp( force / fullThrust( Math.abs( ship.u ), ship.boostLevel, force >= 0 ), - 1, 1 );

	}

}

export class FerryService {

	constructor( ferry, { short = false, enabled = true } = {} ) {

		this.ferry = ferry;
		this.enabled = enabled;
		this.pilot = new Autopilot();
		this.load = short ? 5 : 60;         // s with her ramp down at each berth
		this.phase = 'layover';            // layover (ramp up) | loading | casting | sailing
		this.wait = short ? 4 : 60;        // s until the next thing on the timetable
		this.next = ferry.berths.find( b => b !== ferry.at ); // where she sails next: the far berth from where she lies
		this.yielded = false;
		this.partner = 0;                  // s spent loaded, waiting to sail with the other ship
		this.ready = false;                // loaded and free to go (her partner reads this)
		this.sailedAt = 0; this.time = 0; this.lastCrossing = 0;

	}

	get steering() { return this.enabled && this.phase === 'sailing' && ! this.ferry.driven; }

	update( dt ) {

		const ferry = this.ferry, ship = ferry.ship;
		this.time += dt;
		if ( ! this.enabled ) return;
		if ( ferry.driven ) { this.yielded = true; return; }
		if ( ferry.flood > 0 ) return;
		if ( this.yielded ) { this.yielded = false; this.resume(); }
		if ( this.phase === 'layover' ) {

			if ( ( this.wait -= dt ) <= 0 && ferry.lowerRamp( true ) ) { this.phase = 'loading'; this.wait = this.load; }

		} else if ( this.phase === 'loading' ) {

			if ( ferry.ramp >= 1 ) this.wait -= dt;
			// other people's cars and foot passengers still boarding or leaving hold her ramp down
			this.ready = this.wait <= 0 && ! ( ferry.lead || ferry ).traffic?.holding( ferry ) && ! ferry.crowd?.holding();
			// and she sails with her partner, so the pair stay in phase whatever each crossing took
			if ( this.ready && this.waiting() ) this.partner += dt;
			else if ( this.ready && ferry.castOff() ) { this.phase = 'casting'; this.ready = false; this.partner = 0; }

		} else if ( this.phase === 'casting' ) {

			if ( ! ship.moored && ! ferry.castingOff ) { this.phase = 'sailing'; this.sailedAt = this.time; this.pilot.route( ship, this.next, ferry.at ); }

		} else if ( ship.moored ) {

			this.lastCrossing = this.time - this.sailedAt;
			this.next = ferry.berths.find( b => b !== ferry.at );
			this.phase = 'loading'; this.wait = this.load;
			ferry.lowerRamp( true );

		} else this.pilot.steer( ship, ferry.rivals || NONE );

	}

	// Loaded, she waits up to PARTNER s for the other ship on the service to be loaded too (or on
	// her way out). A ship at a player's helm, sinking or off the timetable holds no one.
	waiting() {

		if ( this.partner > PARTNER ) return false;
		for ( const r of this.ferry.rivals || NONE ) {

			const s = r.service;
			if ( s && s.enabled && ! r.driven && ! ( r.flood > 0 ) && s.phase !== 'casting' && ! ( s.phase === 'loading' && s.ready ) ) return true;

		}
		return false;

	}

	// Back from a player's helm: made fast, the berth cycle goes on; under way, she makes for the
	// nearest berth.
	resume() {

		const ferry = this.ferry, ship = ferry.ship;
		if ( ship.moored ) {

			this.next = ferry.berths.find( b => b !== ferry.at );
			if ( ferry.castingOff ) this.phase = 'casting';
			else if ( ferry.rampGoal > 0 ) { this.phase = 'loading'; this.wait = this.load; }
			else { this.phase = 'layover'; this.wait = Math.max( this.wait, 10 ); }

		} else {

			this.next = ferry.nearestBerth();
			this.phase = 'sailing'; this.sailedAt = this.time;
			this.pilot.route( ship, this.next, null );

		}

	}

	// The departures board line: what she does next, and when.
	board() {

		const ferry = this.ferry, to = this.next.label;
		if ( ferry.driven ) return { text: `${ ferry.ship.moored ? 'Held at the berth' : 'Under way' }: at the helm`, eta: - 1 };
		if ( this.phase === 'sailing' ) return { text: [ 'swing', 'back', 'fill' ].includes( this.pilot.leg ) ? `Arriving at ${ to }` : `Sailing to ${ to }`, eta: - 1 };
		if ( this.phase === 'casting' ) return { text: `Departing for ${ to }`, eta: 0 };
		// her time has come but cars or foot passengers are still coming aboard: say so, don't freeze the clock
		if ( this.phase === 'loading' && this.wait <= 0 && ( ( ferry.lead || ferry ).traffic?.holding( ferry ) || ferry.crowd?.holding() ) ) return { text: `Loading vehicles for ${ to }`, eta: 0 };
		if ( this.phase === 'loading' && this.ready ) return { text: `Final boarding for ${ to }`, eta: 0 };
		const eta = ( this.phase === 'layover' ? Math.max( 0, this.wait ) + RAMP_TIME + this.load : ( 1 - ferry.ramp ) * RAMP_TIME + Math.max( 0, this.wait ) ) + RAMP_TIME;
		const m = Math.floor( eta / 60 ), s = Math.floor( eta % 60 );
		return { text: `Next sailing to ${ to } ${ m }:${ String( s ).padStart( 2, '0' ) }`, eta };

	}

}
