import { uniform, freshSeed, STREAM } from './EventRandom.js';


export const FUNNEL = Object.freeze( {
	g: 9.81, // m/s^2
	// Burgers-Rott vortex v( r ) = VG ( 1 - exp( -x^2 ) ) / x, x = r / rc (Rott 1958; Davies-Jones
	// 2015, Atmos. Res. 158). Peak 0.6382 VG at x = 1.1209, central deficit rho VG^2 ln 2, which is
	// 1.70 rho vmax^2 (test/tornado-funnel.mjs integrates the profile independently).
	burgersPeak: 0.6382,
	peakRadius: 1.1209,
	genesis: [ 20, 40 ], // s
	// Golden and Purcell (1978, Mon. Wea. Rev. 106): organising, mature, shrinking and decay (rope)
	// stages. After the mature stage the ground wind falls smoothly to zero at the configured duration,
	// over a shrinking stage of 10-20 % of the duration and the rope-out of 15-25 % (declared).
	shrinking: [ 0.10, 0.20 ], // fraction of the duration spent shrinking before the rope-out
	ropeOut: [ 0.15, 0.25 ], // fraction of the duration spent roping out
	// Lifting condensation level of significant-tornado supercells: most below 1000 m, median
	// about 800 m (Rasmussen and Blanchard 1998, Wea. Forecasting 13; Thompson et al. 2003).
	lcl: [ 750, 1000 ], // m AGL, the main storm base
	// Wall clouds hang 100-300 m below the base and are 1.5-3 km across (NWS SKYWARN Advanced
	// Spotters' Field Guide, NOAA PA 92055).
	lowering: [ 150, 300 ], // m
	wallRadius: [ 750, 1500 ], // m
	// Debris clouds are tens to a little over 100 m tall (Wurman et al. DOW observations; Bodine et
	// al. 2014, J. Appl. Meteor. Climatol. 53): declared 40-150 m.
	debrisHeight: [ 40, 150 ], // m
	deckRadius: 3000, // m, the dark base drawn around the tornado (beyond it the shared clouds carry on)
	deckThickness: 900, // m
	drawnWidth: 1.8,
	sunStorm: 0.15,
	skyStorm: 0.6,
	stormCover: 0.85, // shared cloud coverage at full storm (0..1)
	stormRise: 8, // s, time constant of the darkening when the tornado starts
	stormFall: 15, // s, time constant of the clearing after it ends
} );

// Lifecycle draws use the track stream at indices 32+ (tornadoMotionParams uses 0-22), so they
// never shift the track and a fixed seed replays both.
const LIFE = 32;
const smooth = ( x ) => {

	x = Math.max( 0, Math.min( 1, x ) );
	return x * x * ( 3 - 2 * x );

};
const lerp = ( range, u ) => range[ 0 ] + ( range[ 1 ] - range[ 0 ] ) * u;

// Inverse of the Burgers-Rott deficit profile: the x = r / rc at which the deficit fraction
// F = dp / ( rho VG^2 ) equals f. F is approximated by ln2 / sqrt( 1 + x^2 / ln2 + ( 2 ln2 x^2 )^2 ),
// which has the exact centre ( ln2 - x^2 / 2 ) and far field ( 1 / ( 2 x^2 ) ) and stays within
// 15% in radius in between (test/tornado-funnel.mjs). Solved as a quadratic in x^2. No
// condensation (0) at or beyond the central deficit.
export function condensationX( f ) {

	if ( ! ( f < Math.LN2 ) ) return 0;
	const a = 1 / Math.LN2, b = 4 * Math.LN2 * Math.LN2;
	const q = Math.LN2 / Math.max( f, 1e-9 ), c = q * q - 1;
	return Math.sqrt( ( - a + Math.sqrt( a * a + 4 * b * c ) ) / ( 2 * b ) );

}

// Tip height of the condensation funnel above the ground (m; <= 0 means it touches down): air
// lifted dry-adiabatically saturates at the base H, so near the ground condensation needs a
// pressure drop of rho g ( H - h ) (hydrostatic). vmax is the live vortex wind, so the tip comes
// down as the vortex strengthens; presence (0..1, default 1) only lifts it away after a Stop.
export function funnelTip( H, vmax, presence = 1 ) {

	const VG = vmax / FUNNEL.burgersPeak;
	return H - presence * Math.LN2 * VG * VG / FUNNEL.g;

}

// The one life of event e at e.time, written into out (allocation-free; same keys every call). The
// wind field (TornadoVortex.js) and the funnel (TornadoVisuals.updateStorm) both read strength.
// genesis, shrinkStart, ropeStart: s. strength (the ground vortex wind over its configured value),
// wall, ropeOut: 0..1. base, lcl, wallRadius, debrisHeight: m. tiltX, tiltZ: unit vector the rope's
// lower end trails toward.
export function tornadoLifecycle( e, out ) {

	// the first reader of a fresh event draws its seed (as tornadoMotion does), so the life and the track share it
	e.seed ??= freshSeed();
	const seed = e.seed, u = ( k ) => uniform( seed, STREAM.track, LIFE + k );
	const duration = e.duration;
	const genesis = Math.min( lerp( FUNNEL.genesis, u( 0 ) ), duration * 0.5 );
	const rope = Math.max( Math.min( 6, duration * 0.4 ), duration * lerp( FUNNEL.ropeOut, u( 1 ) ) );
	const ropeStart = Math.max( genesis, duration - rope );
	// the mature stage keeps at least half the time between genesis and rope-out
	const shrinkStart = ropeStart - Math.min( duration * lerp( FUNNEL.shrinking, u( 7 ) ), 0.5 * ( ropeStart - genesis ) );
	const t = e.time;
	out.genesis = genesis;
	out.shrinkStart = shrinkStart;
	out.ropeStart = ropeStart;
	// organising: up from zero over the genesis; mature: 1; shrinking and rope-out: down to zero at
	// the duration, with no step at either end (smoothstep)
	out.strength = t < genesis ? smooth( t / genesis ) : t < shrinkStart ? 1 : smooth( ( duration - t ) / ( duration - shrinkStart ) );
	out.wall = genesis > 0 ? smooth( t / ( genesis * 0.5 ) ) : 1;
	out.ropeOut = duration > ropeStart ? smooth( ( t - ropeStart ) / ( duration - ropeStart ) ) : ( t >= duration ? 1 : 0 );
	const lcl = lerp( FUNNEL.lcl, u( 3 ) );
	out.lcl = lcl;
	out.base = lcl - lerp( FUNNEL.lowering, u( 4 ) );
	out.wallRadius = lerp( FUNNEL.wallRadius, u( 5 ) );
	out.debrisHeight = lerp( FUNNEL.debrisHeight, u( 6 ) );
	// The ground circulation lags the parent cloud as the vortex weakens and stretches: the rope's
	// lower end trails behind the motion, give or take 35 deg.
	const trail = e.direction * Math.PI / 180 + Math.PI + ( u( 2 ) - 0.5 ) * 1.2;
	out.tiltX = Math.cos( trail );
	out.tiltZ = Math.sin( trail );
	return out;

}

// Multipliers for the shared sun colour and sky irradiance at storm strength s (0..1).
export function stormLight( s, out ) {

	out.sun = 1 - ( 1 - FUNNEL.sunStorm ) * s;
	out.sky = 1 - ( 1 - FUNNEL.skyStorm ) * s;
	return out;

}

// The storm blends in over stormRise and out over stormFall (no snap), drives the shared cloud
// coverage from the player's own value toward stormCover, and hands that value back exactly once
// the sky has cleared. app.storm (0..1) is read by App.applyAtmosphereReadback for the sun and sky.
export class StormState {

	constructor() {

		this.value = 0;
		this.coverBase = null;

	}

	update( dt, active, app ) {

		if ( Number.isFinite( dt ) && dt > 0 ) {

			const tau = active ? FUNNEL.stormRise : FUNNEL.stormFall;
			this.value += ( ( active ? 1 : 0 ) - this.value ) * ( 1 - Math.exp( - dt / tau ) );
			if ( ! active && this.value < 0.002 ) this.value = 0;

		}
		const cover = app.clouds?.coverage;
		if ( cover ) {

			if ( this.value > 0 ) {

				if ( this.coverBase === null ) this.coverBase = cover.value;
				cover.value = this.coverBase + ( Math.max( this.coverBase, FUNNEL.stormCover ) - this.coverBase ) * this.value;

			} else if ( this.coverBase !== null ) {

				cover.value = this.coverBase;
				this.coverBase = null;

			}

		}
		app.storm = this.value;
		return this.value;

	}

}

// WGSL twin of condensationX (keep the two identical).
export const FUNNEL_WGSL = /* wgsl */`
const FUNNEL_LN2 = 0.6931472;
fn funnelX( f: f32 ) -> f32 {
	if ( f >= FUNNEL_LN2 ) { return 0.0; }
	let a = 1.0 / FUNNEL_LN2;
	let b = 4.0 * FUNNEL_LN2 * FUNNEL_LN2;
	let q = FUNNEL_LN2 / max( f, 1e-9 );
	let c = q * q - 1.0;
	return sqrt( ( - a + sqrt( a * a + 4.0 * b * c ) ) / ( 2.0 * b ) );
}
`;
