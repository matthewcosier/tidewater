// Camera shake from what would shake a person holding the camera (docs/disasters.md, "Sound and camera"): the ground's
// acceleration in an earthquake, a disaster's wind above gale force, the flood's front striking, a heavy impact close
// by. Nothing moved the camera before, whatever the ground did.
//
// It is an offset, never a pose: apply() adds it after every camera owner (player, free camera, vehicles, aviation,
// glider, chairlift) has set this frame's pose and before the camera's motion is taken for reprojection
// (src/App.js renderFrame, updateCameraVelocity); restore() puts back the exact pose, quaternion and Euler after the
// frame is drawn, so no owner ever reads or stores it. Frame: world metres for the translation, the camera's own axes
// for the rotation (pitch about x, yaw about y, roll about z, radians). Time: game seconds (slow motion slows it).
//
// Mappings (declared, each with its reason in docs/disasters.md):
//   ground  tilt TILT_PER_G rad per g of horizontal push (along it: pitch for the push ahead, roll for the push across),
//           and the ground's displacement through a damped mount at MOUNT_HZ (the field's own acceleration, double
//           integrated, the slow drift taken out), scaled by the input's coupling (1 held at the ground, 0 high above it)
//   wind    BUFFET rad times (v^2 - GALE^2) / GALE^2 above gale force, as band-limited noise (1.1 to 4.7 Hz, seeded)
//   kicks   damped rings (kick()), for the flood's strike and heavy impacts
// The sum is soft-clipped (tanh) to ROT_CEILING per axis and POS_CEILING, so the horizon stays readable. The system's
// reduced-motion setting (prefers-reduced-motion: reduce) turns it off.

import { GRAVITY } from '../physics/Loads.js';
import { mulberry32 } from '../util/Noise.js';

export const ROT_CEILING = 0.026; // rad (1.5°) per axis
export const POS_CEILING = 0.12; // m
const TILT_PER_G = 0.04; // rad per g of horizontal ground acceleration (2.3° at 1 g)
const YAW_SHARE = 0.25; // of the across-push tilt that turns the camera
const MOUNT_HZ = 0.5; // Hz: the mount's natural frequency (slower ground motion is not followed)
const MOUNT_DAMPING = 0.7; // damping ratio of the mount
const MOUNT_STEP = 1 / 240; // s: integration step of the mount
const GALE = 17.2; // m/s: Beaufort 8, the lower bound of a gale
const BUFFET = 0.012; // rad at twice the gale's dynamic pressure
const KICKS = 8; // concurrent kicks
const KICK_TAU = 0.5; // s: a kick's decay

const softClip = ( v, c ) => c * Math.tanh( v / c );

export class CameraShake {

	constructor( { reducedMotion } = {} ) {

		this.reduced = false;
		if ( typeof reducedMotion === 'boolean' ) this.reduced = reducedMotion;
		else {

			const mq = globalThis.matchMedia?.( '(prefers-reduced-motion: reduce)' );
			if ( mq ) {

				this.reduced = mq.matches;
				mq.addEventListener?.( 'change', ( e ) => {

					this.reduced = e.matches;

				} );

			}

		}

		this.offset = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };
		this.mount = new Float64Array( 6 ); // x, y, z displacement (m), then velocity (m/s)
		this.acc = new Float64Array( 3 ); // m/s^2: this step's ground acceleration
		this.t = 0;
		this.rand = mulberry32( 1 );
		this.noiseF = new Float64Array( 9 ); // 3 axes x 3 partials: Hz
		this.noiseP = new Float64Array( 9 ); // phases, rad
		this.kickA = new Float64Array( KICKS ); // rad
		this.kickAge = new Float64Array( KICKS ).fill( 1e9 ); // s
		this.kickF = new Float64Array( KICKS ); // Hz
		this.kickW = new Float64Array( KICKS * 3 ); // weights on pitch, yaw, roll
		this.applied = false;
		this.saved = new Float64Array( 11 ); // position x y z, quaternion x y z w, Euler x y z
		this.savedOrder = 'XYZ';
		this.reseed( 1 );

	}

	// the run's seed (fresh per event): the buffeting's partials and the kicks' axes
	reseed( seed ) {

		this.rand = mulberry32( ( ( seed | 0 ) ^ 0x2545f491 ) >>> 0 );
		for ( let i = 0; i < 9; i ++ ) {

			this.noiseF[ i ] = 1.1 + 3.6 * this.rand();
			this.noiseP[ i ] = 2 * Math.PI * this.rand();

		}

	}

	// a damped ring of `amplitude` rad at about `hz`, replacing the weakest running one
	kick( amplitude, hz = 6 ) {

		if ( ! ( amplitude > 0 ) || this.reduced ) return;
		let k = 0, weakest = Infinity;
		for ( let i = 0; i < KICKS; i ++ ) {

			const a = this.kickA[ i ] * Math.exp( - this.kickAge[ i ] / KICK_TAU );
			if ( a < weakest ) {

				weakest = a;
				k = i;

			}

		}

		this.kickA[ k ] = Math.min( amplitude, ROT_CEILING * 2 );
		this.kickAge[ k ] = 0;
		this.kickF[ k ] = hz * ( 0.85 + 0.3 * this.rand() );
		this.kickW[ k * 3 ] = 1;
		this.kickW[ k * 3 + 1 ] = ( this.rand() - 0.5 ) * 1.2;
		this.kickW[ k * 3 + 2 ] = ( this.rand() - 0.5 ) * 1.6;

	}

	// advances by dt and sets this.offset from the input; (fx, fz) is the camera's horizontal forward (unit)
	step( dt, input, fx = 0, fz = - 1 ) {

		dt = Math.min( 0.1, Math.max( 0, Number.isFinite( dt ) ? dt : 0 ) );
		this.t += dt;
		const o = this.offset;
		const on = !! input?.active && ! this.reduced;
		const k = on ? Math.min( 1, Math.max( 0, Number.isFinite( input.coupling ) ? input.coupling : 0 ) ) : 0;
		const fin = ( v ) => ( Number.isFinite( v ) ? v : 0 );
		const ax = fin( input?.ax ) * k, ay = fin( input?.ay ) * k, az = fin( input?.az ) * k;
		// the mount: x'' = a - 2 zeta w x' - w^2 x, so above MOUNT_HZ it follows the ground's displacement
		const w = 2 * Math.PI * MOUNT_HZ, m = this.mount;
		const acc = this.acc;
		acc[ 0 ] = ax;
		acc[ 1 ] = ay;
		acc[ 2 ] = az;
		for ( let left = dt; left > 1e-9; left -= MOUNT_STEP ) {

			const h = Math.min( MOUNT_STEP, left );
			for ( let i = 0; i < 3; i ++ ) {

				m[ 3 + i ] += ( acc[ i ] - 2 * MOUNT_DAMPING * w * m[ 3 + i ] - w * w * m[ i ] ) * h;
				m[ i ] += m[ 3 + i ] * h;

			}

		}

		// tilt with the push, in the camera's frame (right = forward x up)
		const ahead = ax * fx + az * fz, across = - ax * fz + az * fx;
		let pitch = - TILT_PER_G * ahead / GRAVITY;
		let roll = TILT_PER_G * across / GRAVITY;
		let yaw = YAW_SHARE * TILT_PER_G * across / GRAVITY;
		// wind buffeting above gale force
		const v = on ? fin( input.wind ) : 0;
		const buffet = BUFFET * Math.max( 0, ( v * v - GALE * GALE ) / ( GALE * GALE ) );
		if ( buffet > 0 ) {

			pitch += 0.6 * buffet * this.noise( 0 );
			yaw += buffet * this.noise( 1 );
			roll += 0.8 * buffet * this.noise( 2 );

		}

		// kicks
		for ( let i = 0; i < KICKS; i ++ ) {

			this.kickAge[ i ] += dt;
			const a = this.kickA[ i ] * Math.exp( - this.kickAge[ i ] / KICK_TAU );
			if ( a < 1e-7 ) continue;
			const s = a * Math.sin( 2 * Math.PI * this.kickF[ i ] * this.kickAge[ i ] );
			pitch += s * this.kickW[ i * 3 ];
			yaw += s * this.kickW[ i * 3 + 1 ];
			roll += s * this.kickW[ i * 3 + 2 ];

		}

		if ( this.reduced ) pitch = yaw = roll = 0;
		o.pitch = softClip( pitch, ROT_CEILING );
		o.yaw = softClip( yaw, ROT_CEILING );
		o.roll = softClip( roll, ROT_CEILING );
		const d = this.reduced ? 0 : Math.hypot( m[ 0 ], m[ 1 ], m[ 2 ] );
		const scale = d > 0 ? softClip( d, POS_CEILING ) / d : 0;
		o.x = m[ 0 ] * scale;
		o.y = m[ 1 ] * scale;
		o.z = m[ 2 ] * scale;
		return o;

	}

	// band-limited noise on one axis, -1..1: three seeded partials
	noise( axis ) {

		let n = 0;
		for ( let i = axis * 3; i < axis * 3 + 3; i ++ ) n += Math.sin( 2 * Math.PI * this.noiseF[ i ] * this.t + this.noiseP[ i ] );
		return n / 3;

	}

	// adds this frame's shake to the camera (after every owner set its pose); restore() takes it away
	apply( camera, dt, input ) {

		const q = camera.quaternion;
		// the camera's forward, (0, 0, -1) rotated by q, on the ground plane
		let fx = - 2 * ( q.x * q.z + q.w * q.y ), fz = - ( 1 - 2 * ( q.x * q.x + q.y * q.y ) );
		const fl = Math.hypot( fx, fz ) || 1;
		fx /= fl;
		fz /= fl;
		const o = this.step( dt, input, fx, fz );
		if ( Math.abs( o.pitch ) + Math.abs( o.yaw ) + Math.abs( o.roll ) < 1e-7 && Math.abs( o.x ) + Math.abs( o.y ) + Math.abs( o.z ) < 1e-6 ) return;
		const p = camera.position, r = camera.rotation, S = this.saved;
		S[ 0 ] = p.x;
		S[ 1 ] = p.y;
		S[ 2 ] = p.z;
		S[ 3 ] = q.x;
		S[ 4 ] = q.y;
		S[ 5 ] = q.z;
		S[ 6 ] = q.w;
		if ( r ) {

			S[ 7 ] = r.x;
			S[ 8 ] = r.y;
			S[ 9 ] = r.z;
			this.savedOrder = r.order;

		}

		this.applied = true;
		p.set( S[ 0 ] + o.x, S[ 1 ] + o.y, S[ 2 ] + o.z );
		// q' = q * offset, the offset an Euler (pitch x, yaw y, roll z) in YXZ order, in the camera's own frame
		const c1 = Math.cos( o.pitch / 2 ), s1 = Math.sin( o.pitch / 2 ), c2 = Math.cos( o.yaw / 2 ), s2 = Math.sin( o.yaw / 2 ), c3 = Math.cos( o.roll / 2 ), s3 = Math.sin( o.roll / 2 );
		const ox = s1 * c2 * c3 + c1 * s2 * s3, oy = c1 * s2 * c3 - s1 * c2 * s3, oz = c1 * c2 * s3 - s1 * s2 * c3, ow = c1 * c2 * c3 + s1 * s2 * s3;
		const qx = S[ 3 ], qy = S[ 4 ], qz = S[ 5 ], qw = S[ 6 ];
		q.set( qw * ox + qx * ow + qy * oz - qz * oy, qw * oy - qx * oz + qy * ow + qz * ox, qw * oz + qx * oy - qy * ox + qz * ow, qw * ow - qx * ox - qy * oy - qz * oz );
		camera.updateMatrixWorld?.();

	}

	// puts back the exact pose the owners set (the private fields, so neither the quaternion nor the Euler is
	// recomputed from the other)
	restore( camera ) {

		if ( ! this.applied ) return;
		this.applied = false;
		const S = this.saved, p = camera.position, q = camera.quaternion, r = camera.rotation;
		p.set( S[ 0 ], S[ 1 ], S[ 2 ] );
		if ( '_x' in q ) {

			q._x = S[ 3 ];
			q._y = S[ 4 ];
			q._z = S[ 5 ];
			q._w = S[ 6 ];

		} else q.set( S[ 3 ], S[ 4 ], S[ 5 ], S[ 6 ] );
		if ( r && '_x' in r ) {

			r._x = S[ 7 ];
			r._y = S[ 8 ];
			r._z = S[ 9 ];
			r._order = this.savedOrder;

		}

		camera.updateMatrixWorld?.();
		if ( camera.matrixWorldInverse ) camera.matrixWorldInverse.copy( camera.matrixWorld ).invert();

	}

}
