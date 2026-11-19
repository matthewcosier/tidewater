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
	deckRadius: 3000, // m, the dark base the storm volume draws round the tornado (beyond it the same deck is a plane in the sky pass: StormSky.js)
	deckThickness: 900, // m
	drawnWidth: 1.8,
	// The storm's overcast, light and rain live in StormModel.js (STORM). These are its times, a declared
	// compression of a real storm: a deck edge 16 km out takes 11-27 min to cross at a gust front's
	// 10-25 m/s, and the trailing cloud takes 30-60 min to break up (docs/tornado-visuals.md).
	stormArrival: 0.5, // share of the genesis in which the overcast crosses the sky, so it leads the funnel
	stormArrivalMax: 20, // s, the longest crossing (and the one used before a life cycle is known)
	stormClear: 90, // s over which the overcast breaks up after the vortex has gone
	stormRefill: 10, // s for the breaks to close when a tornado starts during a clearing
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

// The storm's arrival and clearing. `shield` (0..1) is how far the overcast has crossed the sky: it
// grows over `arrival` seconds while a tornado is active and never retreats. `breaks` (0..1) is how
// far the overcast has broken up: it grows over stormClear once no tornado is active, closes again
// over stormRefill if another starts, and when it reaches 1 the storm is gone and both return to 0.
// Nothing steps: start, stop, restore and a restart during the clearing all move these from where
// they are. `value` (0..1, also app.storm) is the storm's presence for callers that want one number.
// The shared cloud cover is the player's setting: the storm draws its own overcast (StormSky.js) and
// never writes it.
export class StormState {

	constructor() {

		this.value = 0;
		this.shield = 0;
		this.breaks = 0;
		this.arrival = FUNNEL.stormArrivalMax; // s, set by StormSky from the event's genesis

	}

	update( dt, active, app ) {

		if ( Number.isFinite( dt ) && dt > 0 ) {

			if ( active ) {

				this.shield = Math.min( 1, this.shield + dt / this.arrival );
				this.breaks = Math.max( 0, this.breaks - dt / FUNNEL.stormRefill );

			} else if ( this.shield > 0 ) {

				this.breaks += dt / FUNNEL.stormClear;
				if ( this.breaks >= 1 ) {

					this.shield = 0;
					this.breaks = 0;

				}

			}

		}
		this.value = this.shield * ( 1 - smooth( this.breaks ) );
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
