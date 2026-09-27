import { Vector3, Quaternion, Euler, Matrix4 } from '../engine/index.js';

// The Tidewater Spirit's dynamics: a 50 m, 450 t catamaran (17.8 m beam) in three degrees of freedom (surge,
// sway, yaw) plus a gentle swell. Twin engines drive through lever lag; rudders in the
// propeller wash give steerage at low speed; a thruster at each end (as double-ended ferries
// carry) turns her on the spot or, pushing together, walks her sideways, so she can be docked
// stern-to in a narrow slot. The hull footprint grounds
// on the terrain and strikes world structures; every blow is reported with its energy.
const MASS = 450000;                     // kg
const YAW_INERTIA = MASS * ( 50 * 50 + 16 * 16 ) / 12;
const THRUST = 220000;                   // N ahead, both engines; astern gives 60 %
const TOP_SPEED = 8.2;                   // m/s, about 16 knots
const SURGE_DRAG = THRUST / ( TOP_SPEED * TOP_SPEED );
const SWAY_DRAG = SURGE_DRAG * 40;
const RUDDER_MAX = 35 * Math.PI / 180;
const RUDDER_RATE = 12 * Math.PI / 180;  // rad/s, hydraulic steering gear
const LEVER_LAG = 1.8;                   // s for the engines to answer the levers
const RUDDER_ARM = 23;                   // m from the centre to the rudders
const THRUSTER = 40000;                  // N, each of the bow and stern thrusters, for creeping onto a berth
const THRUSTER_ARM = 20;                 // m from the centre to each
const KEEL = - 2.5;                      // draught below the waterline
const WINCH_SPEED = 0.3;                 // m/s, the most the mooring winches haul her
const WINCH_TURN = 0.012;                // rad/s, the most they swing her
const WINCH_TIME = 1.2;                  // s, how they ease off as she comes onto her marks
// Keel sample points in the ship frame (+Z bow): along both demi-hulls.
const KEELS = [];
for ( const x of [ - 6.7, 6.7 ] ) for ( let k = 0; k <= 8; k ++ ) KEELS.push( new Vector3( x, KEEL, - 24 + k * 5.5 ) );
// Her figures, for the autopilot's feed forward (FerryService.js).
export const HULL = { MASS, YAW_INERTIA, THRUST, SURGE_DRAG, SWAY_DRAG, THRUSTER, THRUSTER_ARM };

const _v = new Vector3(), _w = new Vector3(), _e = new Euler( 0, 0, 0, 'YXZ' );

export class FerryShip {

	constructor( { x, z, yaw } ) {

		this.position = new Vector3( x, 0, z );
		this.yaw = yaw;
		this.u = 0; this.v = 0; this.r = 0;          // surge, sway (m/s), yaw rate (rad/s)
		this.lever = 0;                              // -1 full astern .. 1 full ahead (the driver's)
		this.power = 0;                              // what the engines deliver, lagging the lever
		this.wheel = 0;                              // -1 .. 1 (the helm wheel)
		this.rudder = 0;                             // rad
		this.thruster = 0;                           // -1 .. 1, bow to port .. starboard
		this.stern = 0;                              // -1 .. 1, the stern thruster: stern to port .. starboard
		this.heave = 0; this.pitch = 0; this.roll = 0;
		this.time = 0;
		this.quaternion = new Quaternion();
		this.matrix = new Matrix4();
		this.inverse = new Matrix4();
		this.velocity = new Vector3();               // world, m/s
		this.impacts = [];                            // { energy, point } since the last read
		this.grounded = false;
		this.moored = false;                         // lines on: held on `berth`
		this.berth = null;
		this.settled = false;                        // on her marks exactly
		this.pose();

	}

	// Lines on: from now the winches hold her on the berth pose { x, z, yaw }, hauling her
	// the last metre or so in; the engines, rudders and swell do nothing to her.
	moor( berth ) {

		this.berth = { x: berth.x, z: berth.z, yaw: berth.yaw };
		this.moored = true;
		this.settled = false;
		this.lever = 0; this.power = 0; this.thruster = 0; this.stern = 0;

	}

	castOff() { this.moored = false; this.settled = false; }

	get speed() { return Math.hypot( this.u, this.v ); }

	// Heading unit vectors in the world (the ship's +Z bow and +X side).
	forward( out = new Vector3() ) { return out.set( Math.sin( this.yaw ), 0, Math.cos( this.yaw ) ); }

	step( dt, world ) {

		this.time += dt;
		if ( this.moored ) { this.hold( dt ); return; }
		// Engines and steering gear chase the controls.
		this.power += ( this.lever - this.power ) * ( 1 - Math.exp( - dt / LEVER_LAG ) );
		const target = this.wheel * RUDDER_MAX;
		this.rudder += Math.max( - RUDDER_RATE * dt, Math.min( RUDDER_RATE * dt, target - this.rudder ) );
		const thrust = this.power * THRUST * ( this.power < 0 ? 0.6 : 1 );
		// Water flowing past the rudders: the ship's own way plus the propeller wash.
		const wash = this.u * Math.abs( this.u ) + Math.max( 0, this.power ) * 30;
		// Frame: +Z bow, +X port. A positive wheel (starboard) swings the bow to -X (yaw falls):
		// about a 100 m turning radius flat out, a crawl of a turn when manoeuvring.
		const rudderForce = 1500 * this.rudder * wash;
		// The thrusters: the same way together walk her sideways, opposite ways turn her in place.
		const bow = THRUSTER * this.thruster, aft = THRUSTER * this.stern;
		const surge = thrust - SURGE_DRAG * this.u * Math.abs( this.u ) - 900 * this.u;
		const sway = rudderForce * 0.35 - bow - aft - SWAY_DRAG * this.v * Math.abs( this.v ) - 40000 * this.v;
		const turn = - rudderForce * RUDDER_ARM - ( bow - aft ) * THRUSTER_ARM - 3.0e8 * this.r * Math.abs( this.r ) - 1.2e6 * this.r;
		this.u += surge / MASS * dt;
		this.v += sway / MASS * dt;
		this.r += turn / YAW_INERTIA * dt;
		this.yaw += this.r * dt;
		const f = this.forward( _v ), s = _w.set( f.z, 0, - f.x );
		this.velocity.set( f.x * this.u + s.x * this.v, 0, f.z * this.u + s.z * this.v );
		this.position.addScaledVector( this.velocity, dt );
		// The swell: centimetres of heave, fractions of a degree, more of it under way.
		const t = this.time, lively = 1 + Math.min( 1, this.speed / 6 );
		this.heave = ( 0.06 * Math.sin( t * 0.7 ) + 0.03 * Math.sin( t * 1.3 + 1 ) ) * lively;
		this.pitch = 0.004 * Math.sin( t * 0.6 ) * lively - this.u * 0.0012;
		this.roll = 0.006 * Math.sin( t * 0.5 + 2 ) * lively + this.r * 0.35;
		this.position.y = this.heave;
		this.pose();
		if ( world ) this.collide( dt, world );

	}

	// Made fast: the winches ease her onto her marks (at most WINCH_SPEED, slowing as she
	// arrives), the swell dies out of her, and once there she does not move at all.
	hold( dt ) {

		const b = this.berth, p = this.position, x = p.x, z = p.z, yaw = this.yaw;
		const k = 1 - Math.exp( - dt / WINCH_TIME );
		const dx = b.x - x, dz = b.z - z, d = Math.hypot( dx, dz );
		const turn = Math.atan2( Math.sin( b.yaw - yaw ), Math.cos( b.yaw - yaw ) );
		const step = Math.min( d * k, WINCH_SPEED * dt ), swing = Math.sign( turn ) * Math.min( Math.abs( turn ) * k, WINCH_TURN * dt );
		if ( d > 1e-9 ) { p.x += dx / d * step; p.z += dz / d * step; }
		this.yaw += swing;
		const calm = Math.exp( - dt * 1.5 );
		this.heave *= calm; this.pitch *= calm; this.roll *= calm;
		this.settled = d < 0.002 && Math.abs( turn ) < 0.0002 && Math.abs( this.heave ) < 0.002 && Math.abs( this.pitch ) + Math.abs( this.roll ) < 0.0002;
		// on her marks: the berth's heading taken the short way round (her yaw is not wrapped, and a
		// full turn here would read as a huge yaw rate and fling cars on her deck)
		if ( this.settled ) { p.x = b.x; p.z = b.z; this.yaw += turn - swing; this.heave = this.pitch = this.roll = 0; }
		p.y = this.heave;
		this.velocity.set( ( p.x - x ) / dt, 0, ( p.z - z ) / dt );
		this.r = ( this.yaw - yaw ) / dt;
		this.u = 0; this.v = 0;
		this.lever = 0; this.power = 0; this.thruster = 0; this.stern = 0;
		this.pose();

	}

	pose() {

		this.quaternion.setFromEuler( _e.set( this.pitch, this.yaw, this.roll ) );
		this.matrix.compose( this.position, this.quaternion, _v.set( 1, 1, 1 ) );
		this.inverse.copy( this.matrix ).invert();

	}

	toWorld( local, out = new Vector3() ) { return out.copy( local ).applyMatrix4( this.matrix ); }
	toLocal( world, out = new Vector3() ) { return out.copy( world ).applyMatrix4( this.inverse ); }

	// World velocity of a point riding the ship (for walkers and cars on board).
	velocityAt( world, out = new Vector3() ) {

		const dx = world.x - this.position.x, dz = world.z - this.position.z;
		return out.set( this.velocity.x + this.r * dz, 0, this.velocity.z - this.r * dx );

	}

	// Keel against the seabed, hull against piers and quays: push her out, take the way off,
	// and record the blow's energy (half m v^2 of the speed into the obstacle).
	collide( dt, { terrain, colliders } ) {

		this.grounded = false;
		for ( const keel of KEELS ) {

			const p = this.toWorld( keel, _v );
			const floor = terrain.heightAt( p.x, p.z );
			if ( floor <= p.y ) continue;
			this.grounded = true;
			const into = Math.max( 0, this.forwardSpeedAt( keel ) );
			this.strike( into, p, 0.5 );
			// Aground: the way comes off hard, she swings about the point that touched.
			this.u *= Math.exp( - dt * 6 ); this.v *= Math.exp( - dt * 6 ); this.r *= Math.exp( - dt * 3 );

		}
		// Hull sides: sample the gunwale every 4 m and push out of solid boxes.
		for ( const x of [ - 9.0, 9.0 ] ) for ( let z = - 24; z <= 24; z += 4 ) {

			const p = this.toWorld( _w.set( x, 1.0, z ), _v );
			const before = p.clone();
			if ( ! colliders.resolveCapsule( p, 0.4, 3.0, 0 ) ) continue;
			const push = p.sub( before );
			const d = push.length();
			if ( d < 1e-4 ) continue;
			push.divideScalar( d );
			const vx = this.velocity.x, vz = this.velocity.z;
			const into = - ( vx * push.x + vz * push.z );
			this.position.x += push.x * d; this.position.z += push.z * d;
			if ( into > 0 ) {

				this.strike( into, before, 1 );
				// Lose the speed into the obstacle (in the ship frame).
				const f = this.forward( _w );
				this.u += ( push.x * f.x + push.z * f.z ) * into * 1.2;
				this.v += ( push.x * f.z - push.z * f.x ) * into * 1.2;
				this.r *= 0.5;

			}

		}
		this.pose();

	}

	forwardSpeedAt( local ) {

		// Speed of a hull point along the ship's heading (yaw adds to the ends).
		return this.u + this.r * local.x;

	}

	strike( speed, point, share ) {

		if ( speed < 0.15 ) return;
		this.impacts.push( { energy: 0.5 * MASS * speed * speed * share, speed, point: point.clone() } );

	}

	takeImpacts() { const list = this.impacts; this.impacts = []; return list; }

}
