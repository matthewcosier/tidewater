
import { draw, STREAM } from '../disasters/EventSeed.js';

export const ARM_REACH = 0.7; // m from a body capsule's surface to the hold's surface: an outstretched arm
export const HOLD_RADIUS_MIN = 0.02; // m: thinner than a finger-wrap (a wire) is not a hold
export const HOLD_RADIUS_MAX = 0.35; // m: a 0.7 m trunk is about the most two arms can hug
const RHO = 1025; // kg/m³, sea water
const CD = 1.0; // drag coefficient of a person broadside to the flow (bluff body, Re ~1e6)
const WIDTH = { adult: 0.35, kid: 0.25 }; // m, the body's width across the flow
const TALL = { adult: 1.7, kid: 1.25 }; // m: the wetted height is the depth, at most the body
// The most drag a person can hold on a wet pole, N. Both hands' grip from the Mathiowetz et al.
// (1985) norms (adults about 270 to 450 N a hand, children 8 to 10 about 150 N), times 0.7 for a wet
// surface (declared). Drawn per person from the event's seed, so some hold and some do not.
const GRIP = { adult: [ 350, 700 ], kid: [ 120, 260 ] };
const ENDURANCE = [ 0.6, 1.4 ]; // x Rohmert's endurance time, drawn per person (declared spread)
const REGRAB = 3; // s before a person who lost a hold may grab another (they are tumbling)
const STATIC_LIMIT = 600; // s: below 15 % of the maximum the hold is sustainable (Rohmert)

const kind = ( person ) => person.brain?.type === 'kid' ? 'kid' : 'adult';

// Drag force of a flow of speed u and depth d on a person broadside to it, N (0.5 rho Cd A u²).
export function dragOn( person, depth, u ) {

	const k = kind( person );
	return 0.5 * RHO * CD * WIDTH[ k ] * Math.min( Math.max( depth, 0 ), TALL[ k ] ) * u * u;

}

// Rohmert's (1960) endurance curve for a static hold at a fraction f of maximum force, s.
// T (min) = -1.5 + 2.1 / f - 0.6 / f² + 0.1 / f³ for 0.15 < f <= 1: 66 s at half force, 12 s at full.
export function endurance( f ) {

	if ( f <= 0.15 ) return STATIC_LIMIT;
	if ( f >= 1 ) return 0;
	return 60 * ( - 1.5 + 2.1 / f - 0.6 / ( f * f ) + 0.1 / ( f * f * f ) );

}

// The most drag this person can hold in this event, N.
export function gripOf( person, seed ) {

	const [ lo, hi ] = GRIP[ kind( person ) ];
	return lo + ( hi - lo ) * draw( seed, person.id ?? 0, STREAM.grip );

}

// Gap (m) from a body capsule to a vertical cylinder's surface, or Infinity when the body is above or
// below the hold's reach or plainly too far to bother.
function gapTo( b, x, z, radius, yMin, yMax ) {

	if ( b.x.y < yMin || b.x.y > yMax + ARM_REACH ) return Infinity;
	const dx = b.x.x - x, dz = b.x.z - z;
	if ( Math.abs( dx ) > 2 || Math.abs( dz ) > 2 ) return Infinity;
	return Math.hypot( dx, dz ) - radius - b.r;

}

// One step for a swept rig. flow: { depth, ux, uz } under the body; holds: Colliders.cylinders (or a
// pre-filtered list); trunks: the flat palm and tree trunk set (optional). Sets or clears rd.cling
// ({ hold, body, fatigue, grip, stamina }).
export function cling( rd, person, flow, holds, seed, dt, trunks ) {

	const u = Math.hypot( flow.ux, flow.uz );
	const load = dragOn( person, flow.depth, u );
	const c = rd.cling;
	if ( c ) {

		const f = load / c.grip;
		c.fatigue += dt / Math.max( 1e-3, endurance( f ) * c.stamina );
		if ( f >= 1 || c.fatigue >= 1 ) {

			rd.cling = null;
			rd.clingSkip = c.hold;
			rd.clingWait = REGRAB;

		}
		return;

	}
	if ( rd.clingWait > 0 ) {

		rd.clingWait -= dt;
		return;

	}
	if ( ( ! holds && ! trunks ) || ! rd.bodies?.length || flow.depth <= 0 ) return;
	const grip = gripOf( person, seed );
	if ( load >= grip ) return; // too strong to grab at all
	let best = null, bestBody = null, bestGap = ARM_REACH, trunk = - 1;
	for ( let i = 0; i < ( holds?.length ?? 0 ); i ++ ) {

		const h = holds[ i ];
		if ( h === rd.clingSkip || h.radius < HOLD_RADIUS_MIN || h.radius > HOLD_RADIUS_MAX ) continue;
		for ( let j = 0; j < rd.bodies.length; j ++ ) {

			const b = rd.bodies[ j ], gap = gapTo( b, h.x, h.z, h.radius, h.yMin, h.yMax );
			if ( gap < bestGap ) {

				bestGap = gap;
				best = h;
				bestBody = b;

			}

		}

	}
	const skip = rd.clingSkip;
	for ( let i = 0; i < ( trunks?.length ?? 0 ); i += 5 ) {

		const x = trunks[ i ], z = trunks[ i + 1 ], radius = trunks[ i + 2 ];
		if ( radius < HOLD_RADIUS_MIN || radius > HOLD_RADIUS_MAX || ( skip && skip.x === x && skip.z === z ) ) continue;
		for ( let j = 0; j < rd.bodies.length; j ++ ) {

			const b = rd.bodies[ j ], gap = gapTo( b, x, z, radius, trunks[ i + 3 ], trunks[ i + 4 ] );
			if ( gap < bestGap ) {

				bestGap = gap;
				trunk = i;
				bestBody = b;

			}

		}

	}
	// a trunk won: one hold object for this grab (not per step), shaped like a collider cylinder
	if ( trunk >= 0 ) best = { x: trunks[ trunk ], z: trunks[ trunk + 1 ], radius: trunks[ trunk + 2 ], yMin: trunks[ trunk + 3 ], yMax: trunks[ trunk + 4 ], tag: 'trunk' };
	if ( ! best ) return;
	const [ lo, hi ] = ENDURANCE;
	rd.cling = { hold: best, body: bestBody, fatigue: 0, grip, stamina: lo + ( hi - lo ) * draw( seed, person.id ?? 0, STREAM.endurance ) };

}
