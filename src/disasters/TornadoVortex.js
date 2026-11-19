import { tornadoLifecycle } from './TornadoFunnel.js';

// The tornado's wind: one axisymmetric vortex, the same one the condensation funnel is drawn from.
// SI units: metres, seconds, m/s. r is the distance from the vortex axis, z the height above the
// local ground (or the sea surface). DisasterField's tornado block calls tornadoVortex(e) once per
// event time and addTornadoWind(...) per sample; nothing here allocates after the first call.
// Design note and sources: docs/disasters.md, "Tornado: one vortex and one life".
//
// Tangential wind: Burgers-Rott, v = VG ( 1 - exp( -x^2 ) ) / x, x = r / rc (Rott 1958; Davies-Jones
// 2015, Atmos. Res. 158), peak vmax = 0.6382 VG at r = 1.1209 rc. The radius of maximum wind is the
// panel radius x 0.18 (the field's old core), so the funnel (TornadoFunnel.js, TornadoVolume.js) and
// the wind share one core radius and one vmax. The vortex column is upright and its swirl holds up to
// the wall-cloud base; above it the parent circulation takes over (decays over one base height).
//
// Secondary circulation: an axisymmetric, incompressible streamfunction psi( r, z ) = Q( r ) F( z ),
// u = -( 1 / r ) dpsi / dz (radial), w = ( 1 / r ) dpsi / dr, so continuity
// ( 1 / r ) d( r u ) / dr + dw / dz = 0 holds exactly at every point (test/tornado-field.mjs checks
// it by finite differences and by the flux through cylinders and discs).
// - Q( r ) = ( W0 rw^2 / 2 ) ( 1 - exp( -r^2 / rw^2 ) ) T( r ): a Gaussian updraft of radius rw = 2 rc, so
//   it spans the core and still carries 73 % of its axis value at the radius of maximum wind. rw is a
//   declared game choice, not a sourced value: with rw = rc the rising air was confined so close to the
//   axis that no sheet debris was lofted from roof height (test/tornado-lofting.mjs). The inflow has the
//   Burgers-Rott radial shape on rw.
// - F( z ) = B( z / delta ) exp( -z / H ), B( s ) = 1 - ( 1 + s ) exp( -s ): no flow through the
//   ground and no slip at it (u, w -> 0 as z -> 0; w grows as z^2, so it is under 1 m/s at 1 m), an
//   inflow jet at about delta above the ground, the updraft peaking aloft (a few delta up), and
//   outflow above the peak where F falls off over H. Near-surface inflow layers are shallow, tens of
//   metres at most, and feed the corner flow where the strongest winds are (Lewellen 1993, in The
//   Tornado, AGU Geophys. Monogr. 79; Lewellen et al. 2000, J. Atmos. Sci. 57; Davies-Jones, Trapp and
//   Bluestein 2001, Meteor. Monogr. 28(50); Kosiba and Wurman 2013, Wea. Forecasting 28).
// - T( r ) = exp( -( r / R )^8 ), R the panel radius: the tornado's own circulation hands over to the
//   ambient wind across R with no edge (declared; within 2 % of pure Burgers-Rott inside 0.6 R, 0.37 at R,
//   below 1e-7 at 1.6 R). Its derivative appears in w as gentle sinking in
//   the outer ring, the air that feeds the inflow layer from above.
export const VORTEX = Object.freeze( {
	burgersPeak: 0.6382, // vmax / VG for Burgers-Rott
	peakRadius: 1.1209, // r / rc at the peak
	rmaxPerRadius: 0.18,
	// Inflow-jet height over the core radius, and its floor: the surface layer of a real tornado is
	// rough and turbulent, so the jet never sits below a few metres. Declared: 0.5 rc, at least 8 m.
	inflowDepth: 0.5,
	updraftRadius: 2, // rw over rc: declared game choice (with 1, no debris was lofted from roof height)
	minInflowDepth: 8, // m
	// Peak updraft over vmax. LES corner flows reach updrafts of the order of the swirl (Lewellen et al.
	// 2000); declared at the violent end of that band: 1.0.
	updraftRatio: 1.0,
	// The updraft decays above over H = the debris-cloud height drawn from the seed (40-150 m, Bodine et
	// al. 2014), and never less than six inflow depths, so the column stays taller than its inflow layer.
	minLiftDepths: 6,
	taperPower: 8, // n in T = exp( -( r / R )^n )
	reach: 2, // panel radii: beyond, T < 1e-80 and the vortex adds nothing (bounds the per-sample work)
	// Lofted debris falls before the event is over. The slowest-falling rigid piece the game frees is a
	// tumbling sheet panel, 6 kg/m^2 (docs/disasters.md, loose panels), Cd 1.2: about 8.9 m/s. The
	// event lasts until a piece of that kind held where the updraft fades to its fall speed has
	// landed, plus the 2 s the dust plume takes to be exported.
	fallSpeed: 8.9, // m/s
	plumeTail: 2, // s
} );

const smallB = 1e-3; // below this z / delta, B uses its series s^2 / 2 - s^3 / 3 (no cancellation)
const B = ( s ) => s < smallB ? s * s * ( 0.5 - s / 3 ) : 1 - ( 1 + s ) * Math.exp( - s );
const profile = ( z, delta, H ) => B( z / delta ) * Math.exp( - z / H );

// Height (m) of the updraft's peak for the profile F above, from dF/dz = 0:
// ( s e^-s ) H / delta = 1 - ( 1 + s ) e^-s, solved by bisection (once per event).
function peakHeight( delta, H ) {

	const a = H / delta, f = ( s ) => B( s ) - a * s * Math.exp( - s );
	let lo = 1e-6, hi = 60;
	for ( let i = 0; i < 60; i ++ ) {

		const mid = 0.5 * ( lo + hi );
		if ( f( mid ) < 0 ) lo = mid; else hi = mid;

	}
	return 0.5 * ( lo + hi ) * delta;

}

// Height above zPeak (m) where W0 F( z ) has fallen to speed, or zPeak if the updraft never reaches it.
function fadeHeight( W0, speed, zPeak, delta, H ) {

	if ( W0 * profile( zPeak, delta, H ) <= speed ) return zPeak;
	let lo = zPeak, hi = zPeak + 60 * H;
	for ( let i = 0; i < 60; i ++ ) {

		const mid = 0.5 * ( lo + hi );
		if ( W0 * profile( mid, delta, H ) > speed ) lo = mid; else hi = mid;

	}
	return 0.5 * ( lo + hi );

}

// The vortex of event e at e.time, cached on the event (one solve per frame however many samples).
// intensity: the configured vortex wind with the seeded pulses (DisasterField.tornadoIntensity), m/s.
// Keys: vmax, VG (m/s), rc, rmax, R, delta, H, zPeak, base (m), W0 (m/s), strength (0..1), life
// (the shared tornadoLifecycle record), end (s, when the event is over).
export function tornadoVortex( e, intensity, peakFactor ) {

	let v = e.vortex;
	if ( ! v || v.seed !== e.seed || v.radius !== e.radius || v.duration !== e.duration || v.intensity !== e.intensity ) {

		v = e.vortex = { seed: e.seed, radius: e.radius, duration: e.duration, intensity: e.intensity, at: NaN, life: {}, vmax: 0, VG: 0, W0: 0, strength: 0 };
		const life = tornadoLifecycle( e, v.life );
		v.R = e.radius;
		v.rmax = e.radius * VORTEX.rmaxPerRadius;
		v.rc = v.rmax / VORTEX.peakRadius;
		v.delta = Math.max( VORTEX.inflowDepth * v.rc, VORTEX.minInflowDepth );
		v.H = Math.max( life.debrisHeight, VORTEX.minLiftDepths * v.delta );
		v.base = life.base;
		v.zPeak = peakHeight( v.delta, v.H );
		v.Fpeak = profile( v.zPeak, v.delta, v.H );
		// the strongest updraft the event can blow: the configured wind at the largest seeded pulse
		const W0max = VORTEX.updraftRatio * e.intensity * peakFactor / v.Fpeak;
		v.lofted = fadeHeight( W0max, VORTEX.fallSpeed, v.zPeak, v.delta, v.H );
		v.end = e.duration + v.lofted / VORTEX.fallSpeed + VORTEX.plumeTail;
		e.end = v.end;

	}
	if ( v.at === e.time ) return v;
	const life = tornadoLifecycle( e, v.life );
	v.strength = life.strength;
	v.vmax = intensity * life.strength;
	v.VG = v.vmax / VORTEX.burgersPeak;
	v.W0 = VORTEX.updraftRatio * v.vmax / v.Fpeak;
	v.at = e.time;
	return v;

}

// Adds the vortex wind (m/s) at offset dx, dz from the axis (r = hypot), height z above the ground,
// to out.wx, out.wy, out.wz. Every term is a closed form: no division by r (each ( 1 - e^-s ) / s is
// taken through expm1), so the axis is exact.
export function addTornadoWind( v, dx, dz, r, z, out ) {

	if ( ! ( v.vmax > 0 ) || r > VORTEX.reach * v.R ) return out;
	z = Math.max( 0, z );
	const s = r * r / ( v.rc * v.rc ), g = s > 1e-8 ? - Math.expm1( - s ) / s : 1 - 0.5 * s;
	const sw = s / ( VORTEX.updraftRadius * VORTEX.updraftRadius ), gw = sw > 1e-8 ? - Math.expm1( - sw ) / sw : 1 - 0.5 * sw;
	const q2 = r * r / ( v.R * v.R ), q4 = q2 * q2, q8 = q4 * q4, T = Math.exp( - q8 ); // taperPower 8
	const aloft = z > v.base ? Math.exp( - ( z - v.base ) / v.base ) : 1;
	const swirl = v.VG / v.rc * g * T * aloft; // tangential wind over r, 1/s
	const zeta = z / v.delta, ez = Math.exp( - zeta ), eh = Math.exp( - z / v.H ), b = B( zeta );
	const F = b * eh, dF = ( zeta * ez / v.delta - b / v.H ) * eh;
	const radial = - 0.5 * v.W0 * gw * T * dF; // radial wind over r, 1/s (negative: inflow)
	out.wx += - dz * swirl + dx * radial;
	out.wz += dx * swirl + dz * radial;
	// w = ( 1 / r ) dpsi / dr: the Gaussian core, less the sinking the taper's slope adds ( n / 2 ) g q^n
	out.wy += v.W0 * T * F * ( Math.exp( - sw ) - 4 * gw * q8 );
	return out;

}
