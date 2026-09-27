import * as THREE from '../engine/index.js';

// Over-the-shoulder boom for the on-foot modes (walk, swim, the fishing boat's deck, the ferry).
// Each mode first places the camera at the eyes as in first person (so the look, the ship-frame
// stabilisation and W along the view heading are all theirs); this then swings it back along
// the view from a point SHOULDER to the right of the head, and pulls it in against whatever is
// behind: the island's colliders, the terrain and, aboard the ferry, her boxes
// (FerryDeck.boomHit), plus the vertical cylinders (piles, posts, lamps, rocks) and the camera-only
// capsules (Colliders.boom: pier braces and stringers). Rotation is the view's own, with no lag;
// only the pivot height is eased (stairs, jumps, the swim bob). The boom snaps in at once against
// walls and the ground, pulls in quickly (not in one frame) past thin posts and braces while they are
// well clear of the lens (at once when one would sit within BOOM.lens of it), and eases back out.
//
//   boom.apply( player, dt, wheel );   // after the mode set the first-person camera
//   boom.reset();                      // first person / not on foot

// lens: a brace or post nearer the lens than this (m) fills the frame with its hard edge, so the boom comes in at once
export const BOOM = { min: 1.5, max: 8, start: 3.5, shoulder: 0.4, lift: 0.12, pad: 0.25, near: 0.25, lens: 0.9 };
// the swim camera's clearance from the water surface (m): over it at the surface, under it diving
export const WATERLINE = { above: 0.55, below: 0.45 };

const _p = new THREE.Vector3(), _sh = new THREE.Vector3(), _off = new THREE.Vector3(), _dir = new THREE.Vector3(), _s = new THREE.Vector3(), _eye = new THREE.Vector3();

// ray against vertical cylinders (side and top) and capsules; nearest hit before `best`
export function thinHit( C, o, d, best ) {

	for ( const c of C.cylinders || [] ) {

		const ox = o.x - c.x, oz = o.z - c.z, r = c.radius + 0.06;
		const a = d.x * d.x + d.z * d.z, b = ox * d.x + oz * d.z, q = ox * ox + oz * oz - r * r;
		if ( q <= 0 ) continue; // the pivot is inside it (in plan): nothing to pull in against
		if ( a > 1e-8 ) {

			const h = b * b - a * q;
			if ( h >= 0 ) {

				const t = ( - b - Math.sqrt( h ) ) / a;
				if ( t > 0 && t < best ) {

					const y = o.y + d.y * t;
					if ( y >= c.yMin && y <= c.yMax ) best = t;

				}

			}

		}

		if ( d.y < - 1e-6 && o.y > c.yMax ) {

			const t = ( c.yMax - o.y ) / d.y;
			if ( t < best ) {

				const x = ox + d.x * t, z = oz + d.z * t;
				if ( x * x + z * z <= r * r ) best = t;

			}

		}

	}

	for ( const c of C.boom || [] ) {

		// cheap reject: the ray's box to best against the capsule's box
		const ex = o.x + d.x * best, ey = o.y + d.y * best, ez = o.z + d.z * best;
		if ( Math.max( o.x, ex ) < c.lo.x || Math.min( o.x, ex ) > c.hi.x || Math.max( o.y, ey ) < c.lo.y || Math.min( o.y, ey ) > c.hi.y || Math.max( o.z, ez ) < c.lo.z || Math.min( o.z, ez ) > c.hi.z ) continue;
		const t = capsule( o, d, c.a, c.b, c.radius );
		if ( t > 0 && t < best ) best = t;

	}

	return best;

}

// ray (unit d) against the capsule a -> b, radius r: entry distance or -1
function capsule( o, d, pa, pb, r ) {

	const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
	const oax = o.x - pa.x, oay = o.y - pa.y, oaz = o.z - pa.z;
	const baba = bax * bax + bay * bay + baz * baz, bard = bax * d.x + bay * d.y + baz * d.z;
	const baoa = bax * oax + bay * oay + baz * oaz, rdoa = d.x * oax + d.y * oay + d.z * oaz;
	const oaoa = oax * oax + oay * oay + oaz * oaz;
	const a = baba - bard * bard;
	let b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba;
	let h = b * b - a * c;
	if ( h < 0 || a < 1e-9 ) return - 1;
	const t = ( - b - Math.sqrt( h ) ) / a, y = baoa + t * bard;
	if ( y > 0 && y < baba ) return t;
	// the end caps
	const cx = y <= 0 ? oax : o.x - pb.x, cy = y <= 0 ? oay : o.y - pb.y, cz = y <= 0 ? oaz : o.z - pb.z;
	b = d.x * cx + d.y * cy + d.z * cz;
	c = cx * cx + cy * cy + cz * cz - r * r;
	h = b * b - c;
	return h > 0 ? - b - Math.sqrt( h ) : - 1;

}

export class ThirdPersonCamera {

	constructor() {

		this.want = BOOM.start;  // zoom (scroll wheel), BOOM.min .. BOOM.max
		this.dist = BOOM.start;  // current boom length after collisions
		this.y = null;           // eased pivot height

	}

	reset() {

		this.y = null;

	}

	apply( player, dt, wheel = 0 ) {

		const cam = player.camera;
		if ( wheel ) this.want = THREE.MathUtils.clamp( this.want * ( 1 + wheel * 0.12 ), BOOM.min, BOOM.max );
		const pivot = _p.copy( cam.position );
		_eye.copy( pivot );
		if ( this.y === null ) {

			this.y = pivot.y;
			this.dist = this.want;

		}

		this.y += ( pivot.y - this.y ) * ( 1 - Math.exp( - 14 * dt ) );
		this.y = THREE.MathUtils.clamp( this.y, pivot.y - 0.45, pivot.y + 0.45 );
		pivot.y = this.y;

		// the shoulder point first (less of it if a wall is right there), then the boom straight back
		// from it: pulled in tight, the camera still looks past the head, not into the back of it
		_off.set( BOOM.shoulder, BOOM.lift, 0 ).applyQuaternion( cam.quaternion );
		const sl = _off.length();
		_dir.copy( _off ).divideScalar( sl );
		const side = Math.max( 0, Math.min( sl, this.cast( player, pivot, _dir, sl + BOOM.pad ) - BOOM.pad ) );
		const shoulder = _sh.copy( pivot ).addScaledVector( _dir, side );
		_dir.set( 0, 0, 1 ).applyQuaternion( cam.quaternion );
		const hit = this.cast( player, shoulder, _dir, this.want + BOOM.pad );
		const room = Math.max( BOOM.near, Math.min( this.want, hit - BOOM.pad ) );
		if ( room >= this.dist ) this.dist += ( room - this.dist ) * ( 1 - Math.exp( - 2.5 * dt ) );
		else if ( ! this.thin ) this.dist = room;
		else {

			const e = Math.max( room, Math.min( this.hard - BOOM.pad, this.dist + ( room - this.dist ) * ( 1 - Math.exp( - 16 * dt ) ) ) );
			this.dist = e - ( room + BOOM.pad ) < BOOM.lens ? room : e;

		}
		this.dist = Math.max( BOOM.near, this.dist );
		cam.position.copy( shoulder ).addScaledVector( _dir, this.dist );
		// swimming: the lens never straddles the surface (a pale band of water across the view). At the
		// surface it stays WATERLINE.above over the water at his point (the waves between him and the
		// lens take up the rest); diving, once his eyes are well under, it stays WATERLINE.below it.
		if ( player.mode === 'swim' ) {

			const w = player.waterH, under = ! player.floating && pivot.y < w - WATERLINE.below, y0 = cam.position.y;
			cam.position.y = under ? Math.min( cam.position.y, w - WATERLINE.below ) : Math.max( cam.position.y, w + WATERLINE.above );
			// moved off the line the boom was cast along: never up into a brace or post it missed
			if ( Math.abs( cam.position.y - y0 ) > 0.01 ) {

				_off.copy( cam.position ).sub( shoulder );
				const l = _off.length();
				if ( l > 1e-3 ) {

					_off.divideScalar( l );
					const h = this.cast( player, shoulder, _off, l + BOOM.pad );
					if ( h - BOOM.pad < l ) cam.position.copy( shoulder ).addScaledVector( _off, Math.max( BOOM.near, h - BOOM.pad ) );

				}

			}

		}
		// a non-finite boom (the eased pivot height or the length: both ease from their last value, so a NaN
		// would stay for good) never reaches the renderer: this frame from the eyes, the boom set up again
		if ( ! Number.isFinite( cam.position.x + cam.position.y + cam.position.z ) ) {

			if ( ! this.warned ) { this.warned = true; console.warn( 'Third-person camera: non-finite boom, set up again', { y: this.y, dist: this.dist } ); }
			cam.position.copy( _eye );
			this.y = null; this.dist = this.want;
			return;

		}
		// people between the lens and him fade (src/people/Fade.js); the boom stays where it is
		player.people?.occlude?.( cam.position, pivot );

	}

	// distance along dir from o to the first thing in the way (or len); this.thin: a post or brace is
	// nearer than any wall (this.hard)
	cast( player, o, dir, len ) {

		let best = len;
		const C = player.colliders;
		if ( C && C.raycast ) best = Math.min( best, C.raycast( o, dir, best ) );
		if ( player.mode === 'ferry' && player.vessel && player.vessel.boomHit ) best = Math.min( best, player.vessel.boomHit( o, dir, best ) );
		// the terrain: march the boom, then bisect the first crossing (20 cm clearance)
		const T = player.terrain;
		if ( T ) {

			const N = 10;
			let prev = 0;
			for ( let i = 1; i <= N; i ++ ) {

				const t = best * i / N;
				_s.copy( o ).addScaledVector( dir, t );
				if ( _s.y < T.heightAt( _s.x, _s.z ) + 0.2 ) {

					let lo = prev, hi = t;
					for ( let k = 0; k < 5; k ++ ) {

						const mid = ( lo + hi ) / 2;
						_s.copy( o ).addScaledVector( dir, mid );
						if ( _s.y < T.heightAt( _s.x, _s.z ) + 0.2 ) hi = mid;
						else lo = mid;

					}

					best = lo;
					break;

				}

				prev = t;

			}

		}

		this.hard = best;
		const thin = C ? thinHit( C, o, dir, best ) : best;
		this.thin = thin < best;
		return thin;

	}

}
