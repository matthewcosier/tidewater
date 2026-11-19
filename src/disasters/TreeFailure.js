// Tree failure under wind, flood and shaking: whether a tree bends, snaps or uproots, where on the
// stem it breaks, and how it falls about its hinge. World metres, y up; forces N; moments N m;
// tilt theta in rad from vertical; time s. Pure functions over plain numbers: no allocation.
//
// Reference: the EF scale damage indicators (Wind Science and Engineering Center 2006, used by the
// US National Weather Service). DI 28 hardwood trees: DOD 3 "uprooted" expected at 91 mph (41 m/s),
// DOD 4 "trunks snapped" at 110 mph (49 m/s). DI 27 softwoods: 91 mph and 104 mph (47 m/s). We take
// 41 m/s uproot and 48 m/s snap for the island broadleaves. Palms are far more wind-firm: sabal and
// coconut palms had the highest survival of any urban trees through Category 3 hurricanes (Duryea
// et al. 2007, Arboriculture & Urban Forestry 33(2): 83-97); declared 52 m/s uproot, 58 m/s snap.
// Each capacity is the moment the tree's own crown drag makes at that expected wind, so the
// uncertain crown drag area cancels and a tree of any size fails at the EF wind on average. Root
// plate and stem capacities scatter independently per event (lognormal, CAPACITY_COV.tree 0.35,
// Nicoll et al. 2006), so the mode a tree takes is whichever gives first.
import { capacityFactor, uniform, CAPACITY_COV, STREAM } from './EventRandom.js';
import { AIR_DENSITY, SEA_WATER_DENSITY, GRAVITY } from '../physics/Loads.js';

export const FAILURE_WIND = Object.freeze( {
	canopy: { uproot: 41, snap: 48 }, // m/s, EF DI 27/28 expected values
	palms: { uproot: 52, snap: 58 }, // m/s, declared from the hurricane survival surveys above
} );
// Porous crowns reconfigure in strong wind: CdA at 20-30 m/s is about 0.3 to 0.5 of the still-air
// value (Vollsinger et al. 2005, Can. J. For. Res. 35: 1238). Declared 0.35 on the crown ellipse.
const CROWN_CD = .35;
const STEM_CD = 1.2; // circular cylinder at high Reynolds number, the stem in flood flow
// Stem taper: top diameter 40% of the base (declared). With a crown load the bending stress
// (hc - z) / d(z)^3 peaks at z = (3 a hc - 1) / (2 a), a = TAPER / H: about 0.3 H for a broadleaf,
// where hurricane-snapped stems commonly break. A near-untapered palm peaks at the base clamp.
const TAPER = Object.freeze( { canopy: .6, palms: .15 } );
// Root plate resistance falls away after the peak and is largely gone by about 20 deg (Coutts
// 1986, Annals of Botany 58: 199-211); torn stem fibres hold for only a few degrees. Declared.
const RESIDUAL_ANGLE = Object.freeze( { uproot: .35, snap: .1 } ); // rad
export const RELEASE_TILT = Math.PI / 3; // rad: a near tree becomes a rigid body past 60 deg
export const CROWN_SUPPORT = .3; // crushed crown props the top this fraction of the crown radius off the ground (declared)

export function crownArea( mass ) { return Math.PI * mass.crownRadius * mass.crownHalfHeight; }

// One set of aerodynamics for a tree standing, swinging about its hinge and fallen: the crown's
// streamlined drag area and the stem's cylinder drag area (CdA, m²), in air and in water alike. The
// released body's load points carry the same areas (Bodies.release, RigidLoads.treeLoadPoints), so
// the wind on a tree does not jump when the solver takes it over. Before this the body took Cd 1.1
// on H x 0.8 m² spread over its points while the standing crown took 0.35 on its ellipse.
export function crownDragArea( mass ) { return CROWN_CD * crownArea( mass ); }
// The stem of a piece of length `length` (m): its whole projected side, 2 r per metre.
export function stemDragArea( mass, length = mass.length ?? mass.height ) { return STEM_CD * 2 * mass.radius * Math.max( 0, length ); }

// Horizontal crown drag (N) at speed u (m/s) through the crown, signed.
export function crownForce( mass, u ) { return .5 * AIR_DENSITY * crownDragArea( mass ) * u * Math.abs( u ); }

// Share (0..1) of the crown below a water surface `depth` metres above the stem base, by height
// over the crown's vertical extent (centre crownY, half height crownHalfHeight; declared linear).
export function crownWet( mass, depth ) {
	const low = mass.crownY - mass.crownHalfHeight;
	return Math.min( 1, Math.max( 0, ( depth - low ) / ( 2 * mass.crownHalfHeight ) ) );
}

// Where a broadleaf breaks: the peak-stress height of a tapered stem under a crown load, scattered
// by +-8% of the height for knots and defects, clamped to 15-70% of the height.
export function snapHeight( record, mass, kind, seed, index ) {
	const H = mass.height, a = TAPER[ kind ] / H, hc = mass.crownY;
	const peak = a > 0 ? ( 3 * a * hc - 1 ) / ( 2 * a ) : 0;
	const jitter = ( uniform( seed ?? 0, STREAM.tree, 3 * index + 2 ) - .5 ) * .16 * H;
	return Math.min( .7 * H, Math.max( .15 * H, peak + jitter ) );
}

// The overturning moment (N m) about height z of a standing tree's crown and stem in still-air
// terms at wind speed u (m/s): the moment its capacities are anchored to.
function airMoment( mass, u, z ) {
	const H = mass.height, stem = Math.max( 0, H - Math.max( 0, z ) );
	return .5 * AIR_DENSITY * u * u * ( crownDragArea( mass ) * Math.max( 0, mass.crownY - z ) + stemDragArea( mass, stem ) * stem * .5 );
}

// Nominal capacities (N m) anchored to the EF winds, and this event's scatter factors. Each is the
// moment the tree's own crown and stem drag make at that wind, so the uncertain drag areas cancel.
export function treeCapacity( mass, kind, cut, seed, index, out ) {
	const wind = FAILURE_WIND[ kind ];
	out.uproot = airMoment( mass, wind.uproot, 0 ) * capacityFactor( seed, STREAM.tree, 3 * index, CAPACITY_COV.tree );
	out.snap = airMoment( mass, wind.snap, cut ) * capacityFactor( seed, STREAM.tree, 3 * index + 1, CAPACITY_COV.tree );
	return out;
}

// The horizontal overturning moment about height z on the stem of a standing tree, from the field
// sample s at its base and a water surface `depth` metres over the base: the wind on the dry crown
// and dry stem, the water on the wetted stem and the submerged share of the crown (the same drag
// areas in both, with each fluid's density), and shaking (s.shake, m/s², on the whole tree at its
// centre of mass, any direction). The wind and the water push along their own directions, so the
// moment is their vector sum: out.moment (N m), out.x and out.z (the unit direction the tree is
// pushed over, 0 when nothing pushes), out.air and out.water (N m, each part's own moment).
export function standingLoad( mass, s, depth, z, out ) {
	const H = mass.height, r = mass.radius, wx = s.wx, wz = s.wz, ux = s.ux ?? 0, uz = s.uz ?? 0;
	const wind = Math.hypot( wx, wz ), flow = Math.hypot( ux, uz ), wet = Math.min( Math.max( depth, z ), H ), crown = crownWet( mass, depth );
	const crownArm = Math.max( 0, mass.crownY - z ), qa = .5 * AIR_DENSITY * wind * wind, qw = .5 * SEA_WATER_DENSITY * flow * flow;
	// Wetted stem from z to the surface; dry stem from there to the top. Each acts at its own centroid.
	const wetStem = wet - Math.max( 0, z ), dryStem = H - Math.max( wet, z );
	const air = qa * ( crownDragArea( mass ) * ( 1 - crown ) * crownArm + STEM_CD * 2 * r * dryStem * ( ( wet + H ) * .5 - z ) );
	const water = qw * ( crownDragArea( mass ) * crown * crownArm + STEM_CD * 2 * r * wetStem * wetStem * .5 );
	const mx = ( wind > 1e-9 ? air * wx / wind : 0 ) + ( flow > 1e-9 ? water * ux / flow : 0 ), mz = ( wind > 1e-9 ? air * wz / wind : 0 ) + ( flow > 1e-9 ? water * uz / flow : 0 );
	const push = Math.hypot( mx, mz );
	out.air = air; out.water = water; out.x = push > 0 ? mx / push : 0; out.z = push > 0 ? mz / push : 0;
	out.moment = push + mass.mass * ( s.shake ?? 0 ) * Math.max( 0, mass.comY - z );
	return out;
}
const STANDING = {};
export function standingMoment( mass, s, depth, z ) { return standingLoad( mass, s, depth, z, STANDING ).moment; }

// The falling part's hinge (mass = the piece's treeMassProperties, from the hinge at t.cut). The
// fall plane is fixed at failure; u is the wind and flow the water speed along the fall direction
// (m/s); depth is the water surface over the hinge (m, 0 or less when dry). Each fluid drags the
// crown and the stem with the velocity relative to the moving part (the same drag areas and the same
// isotropic point drag the released body takes, so nothing jumps at release), which both pushes the
// tree over and damps its swing. Gravity on the piece and buoyancy on its wetted wood (green wood is
// lighter than sea water, so a drowned tree is pushed back up) act at their arms. The residual root
// plate or fibre moment fades with tilt. Before the water entered here a tree the flood had failed
// stood at 0 deg for ever: the residual held it and the hinge saw only the wind.
// Backward Euler on the drag (linearised in omega), so a deep fast flow cannot make the swing ring
// at h = 1/120 s; the swing only goes forward (the fallen side cannot lift the tree back).
const HINGE_SEGMENTS = 8; // stem strips for the wetted and dry drag and the buoyancy (declared)
const HINGE = { moment: 0, stiffness: 0 };
// Drag of one part (drag area cda, m², at distance l, m, from the hinge) in a fluid of `density`
// moving at `speed` along the fall direction, on the swing w (rad/s) at tilt cos c, sin sn.
function swingDrag( density, cda, speed, l, w, c, sn ) {
	if ( cda <= 0 ) return;
	const k = .5 * density * cda, rel = Math.hypot( speed - w * l * c, w * l * sn );
	HINGE.moment += k * rel * ( speed * c - w * l ) * l;
	HINGE.stiffness += k * rel * l * l;
}
// Wetted share of a part centred `y` metres above the hinge with vertical half extent e (m).
function wetShare( depth, y, e ) { return depth > 0 ? Math.min( 1, Math.max( 0, ( depth - y + e ) / ( 2 * e ) ) ) : 0; }
export function hingeStep( t, mass, u, h, flow = 0, depth = 0 ) {
	const lever = mass.crownY - t.cut, arm = mass.comY - t.cut, c = Math.cos( t.theta ), sn = Math.sin( t.theta ), w = t.omega;
	const inertia = t.hingeInertia ??= mass.principalInertia[ 0 ] + mass.mass * arm * arm;
	const residual = t.capacity * Math.max( 0, 1 - t.theta / RESIDUAL_ANGLE[ t.mode ] );
	HINGE.moment = mass.mass * GRAVITY * arm * sn - residual; HINGE.stiffness = 0;
	// The crown: its centre moves at w lever (cos, -sin) in the fall plane; part of it may be under water.
	const crown = wetShare( depth, lever * c, mass.crownHalfHeight * c + mass.crownRadius * sn ), cda = crownDragArea( mass );
	swingDrag( AIR_DENSITY, cda * ( 1 - crown ), u, lever, w, c, sn );
	swingDrag( SEA_WATER_DENSITY, cda * crown, flow, lever, w, c, sn );
	HINGE.moment -= SEA_WATER_DENSITY * GRAVITY * mass.crownVolume * crown * lever * sn;
	// The stem in strips from the hinge: drag on each strip's side, buoyancy on its wetted wood.
	const dl = mass.length / HINGE_SEGMENTS, side = STEM_CD * 2 * mass.radius * dl, wood = mass.stemVolume / HINGE_SEGMENTS;
	for ( let i = 0; i < HINGE_SEGMENTS; i ++ ) {
		const l = ( i + .5 ) * dl, wet = wetShare( depth, l * c, .5 * dl * c + mass.radius * sn );
		swingDrag( AIR_DENSITY, side * ( 1 - wet ), u, l, w, c, sn );
		swingDrag( SEA_WATER_DENSITY, side * wet, flow, l, w, c, sn );
		HINGE.moment -= SEA_WATER_DENSITY * GRAVITY * wood * wet * l * sn;
	}
	t.omega = Math.max( 0, w + HINGE.moment * h / ( inertia + h * HINGE.stiffness ) );
	t.theta += t.omega * h;
}
