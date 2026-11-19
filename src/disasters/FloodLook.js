// How the flood looks, read from the solver's packed state (WaterGrid.pack: surface eta (m), u, v (m/s), depth h (m)).
// One model, two twins: the JS functions below (tests, the renderer's debug stat) and FLOOD_LOOK_WGSL (the water
// shader, per pixel, through Water.js). Both are generated from the same constants; change them here only.
// Design and sources: docs/disasters.md "Rendering the flood".
//
// Bore. A tsunami runs ashore as a bore: a moving hydraulic jump. Its strength is the bore Froude number
// Fr1 = c / sqrt( g h1 ), c the front speed, h1 the depth ahead. Chanson (2009, Eur. J. Mech. B/Fluids 28,
// "Current knowledge in hydraulic jumps and related phenomena"): undular (smooth, no roller) below Fr1 ~ 1.3-1.5,
// a breaking roller beyond, fully breaking by ~2. The renderer only sees the local state behind the front (h2, u2),
// so it inverts the bore relations for a front running into still water or a dry bed:
//   mass  c h1 = ( c - u2 ) h2,  momentum  c = sqrt( g h1 ) sqrt( r ( r + 1 ) / 2 ),  r = h2 / h1
//   =>   Fr2 = u2 / sqrt( g h2 ) = sqrt( ( r + 1 ) / 2 ) ( r - 1 ) / r            (monotonic in r)
// so the local Froude number gives r, the bore Froude number and the jump height h2 ( 1 - 1 / r ). Steady fast flow
// with no face is not a bore: the surface must fall along the flow (the front face), FACE_LO..FACE_HI (m/m).
//
// Turbidity. Water that has run over the land carries soil, sand and debris (2004 and 2011 flows were brown-black,
// suspended sediment of order 1-10 kg/m^3; Jaffe and Gelfenbaum 2007, Sediment. Geol. 200). At those loads the
// column is opaque within centimetres, so the value only sets the colour: 0 is the ocean's own water, 1 is the
// brown-grey flood. Over the sea the flow stirs the bed once it is fast and shallow enough (u ~ 0.5-3 m/s, the
// suspension threshold of fine sand, Soulsby 1997), and deep water stays clear.

export const G = 9.81; // m/s^2
export const H_MIN = 0.02; // m: thinner sheets carry no face (the solver's wet threshold is 0.002 m)
export const FACE_LO = 0.02, FACE_HI = 0.10; // m/m: front face slope along the flow; a long wave is < 0.01
export const FACE_FILL = [ 0.1, 0.4 ];
export const UNDULAR_FR = 1.3, BREAKING_FR = 2.0; // bore Froude numbers (Chanson 2009)
export const LIP_THROW = 0.35; // the curling lip leans forward by this fraction of the jump (game choice, Breakers.js lip)
export const LIP_RISE = 0.1; // the roller stands above the conjugate depth by this fraction of the jump (game choice)
export const COAST_BED_LO = - 8, COAST_BED_HI = 6; // m
export const RATIO_ITERATIONS = 4; // fixed-point steps for r( Fr2 ); contraction < 0.5, error < 1 % after 4

const ratioForBoreFroude = ( F ) => ( Math.sqrt( 1 + 8 * F * F ) - 1 ) / 2;
const localFroude = ( r ) => Math.sqrt( ( r + 1 ) / 2 ) * ( r - 1 ) / r;
// Local (behind the front) Froude numbers at the undular and the fully breaking bore.
export const BORE_FR_LO = localFroude( ratioForBoreFroude( UNDULAR_FR ) ); // 0.316
export const BORE_FR_HI = localFroude( ratioForBoreFroude( BREAKING_FR ) ); // 0.751

const sat = ( x ) => Math.min( 1, Math.max( 0, x ) );
const smoothstep = ( a, b, x ) => {

	const t = sat( ( x - a ) / ( b - a ) );
	return t * t * ( 3 - 2 * t );

};

// Depth ratio r = h2 / h1 of the bore whose local Froude number is fr (the same iteration as the WGSL).
export function boreRatio( fr ) {

	let r = 1 + 2 * fr;
	for ( let i = 0; i < RATIO_ITERATIONS; i ++ ) r = 1 + fr * r * Math.sqrt( 2 / ( r + 1 ) );
	return r;

}

// Bore Froude number Fr1 for a local Froude number (exact inversion, for tests and the doc).
export function boreFroude( fr ) {

	let lo = 1, hi = 1e4;
	for ( let i = 0; i < 80; i ++ ) {

		const mid = ( lo + hi ) / 2;
		if ( localFroude( mid ) < fr ) lo = mid; else hi = mid;

	}
	const r = ( lo + hi ) / 2;
	return Math.sqrt( r * ( r + 1 ) / 2 );

}

export function boreFace( P, n, k, dx ) {

	const u = P[ k + 1 ], v = P[ k + 2 ], speed = Math.hypot( u, v );
	if ( speed <= 1e-6 ) return 0;
	const gx = ( P[ k + 4 ] - P[ k ] ) / dx, gz = ( P[ k + n * 4 ] - P[ k ] ) / dx;
	const hx = ( P[ k + 7 ] - P[ k + 3 ] ) / dx, hz = ( P[ k + n * 4 + 3 ] - P[ k + 3 ] ) / dx;
	const fill = - ( ( P[ k + 7 ] * P[ k + 5 ] - P[ k + 3 ] * u ) + ( P[ k + n * 4 + 3 ] * P[ k + n * 4 + 2 ] - P[ k + 3 ] * v ) ) / dx;
	return Math.max( 0, Math.min( - ( u * gx + v * gz ), - ( u * hx + v * hz ) ) / speed ) * smoothstep( FACE_FILL[ 0 ], FACE_FILL[ 1 ], fill );

}

export function classifyBore( h, speed, face, out = {} ) {

	const fr = speed / Math.sqrt( G * Math.max( h, H_MIN ) );
	const r = boreRatio( fr );
	out.froude = fr;
	out.jump = h * ( 1 - 1 / r );
	out.breaking = smoothstep( BORE_FR_LO, BORE_FR_HI, fr ) * smoothstep( FACE_LO, FACE_HI, face ) * smoothstep( H_MIN, 0.15, h );
	return out;

}

// h depth (m), speed (m/s), bed: ground height under the water (m, sea level 0). 0 clear sea, 1 brown flood.
export function turbidity( h, speed, bed ) {

	if ( h <= 0.002 ) return 0;
	const land = smoothstep( - 1.0, 0.5, bed );
	const stirred = smoothstep( 0.5, 3.0, speed ) * smoothstep( 30, 8, h );
	return sat( Math.max( land, stirred ) );

}

// Channel c of a packed grid at fractional texel (fi, fj), clamped to the grid: WaterGrid.sample's bilinear blend, as
// disasterLerp( wetOnly false ) in Water.js.
function sampleGrid( P, n, fi, fj, c ) {

	const i = Math.min( n - 2, Math.max( 0, Math.floor( fi ) ) ), j = Math.min( n - 2, Math.max( 0, Math.floor( fj ) ) );
	const fx = sat( fi - i ), fz = sat( fj - j ), k = ( j * n + i ) * 4 + c;
	const a = P[ k ], b = P[ k + 4 ], d = P[ k + n * 4 ], e = P[ k + n * 4 + 4 ];
	return ( a * ( 1 - fx ) + b * fx ) * ( 1 - fz ) + ( d * ( 1 - fx ) + e * fx ) * fz;

}

export const TRAIL_LENGTH = 12; // m: the aerated wake behind a breaking bore face, about one roller length (4-6 jump heights of a 2-3 m bore, Chanson 2009; declared). Green 1-2 at 24 m drew a 2 m flood 59-65 % white
export const STREAK_LENGTH = 70, STREAK_WIDTH = 14; // m (declared, 20-80 m streaks in the Kesennuma footage)
export const STREAK_SECTORS = 6;
export const STREAK_LO = 0.46, STREAK_HI = 0.72; // noise values to streak cover: about a third of the area streaked
export const STREAK_CAP = 0.2; // foam cover of a streak off the face: lace over brown water, never a white sheet
const hash2 = ( ix, iz ) => {

	let h = Math.imul( ix, 0x27d4eb2d ) ^ Math.imul( iz, 0x165667b1 );
	h = Math.imul( h ^ ( h >>> 15 ), 0x2c1b3c6d );
	h ^= h >>> 12;
	return ( h >>> 0 ) / 4294967296;

};
function valueNoise( x, z ) {

	const ix = Math.floor( x ), iz = Math.floor( z ), fx = x - ix, fz = z - iz;
	const ux = fx * fx * ( 3 - 2 * fx ), uz = fz * fz * ( 3 - 2 * fz );
	const a = hash2( ix, iz ), b = hash2( ix + 1, iz ), c = hash2( ix, iz + 1 ), d = hash2( ix + 1, iz + 1 );
	return ( a + ( b - a ) * ux ) * ( 1 - uz ) + ( c + ( d - c ) * ux ) * uz;

}
const sectorNoise = ( x, z, k ) => {

	const a = k * Math.PI / STREAK_SECTORS, c = Math.cos( a ), s = Math.sin( a );
	return valueNoise( ( x * c + z * s ) / STREAK_LENGTH, ( z * c - x * s ) / STREAK_WIDTH + k * 17 );

};
// 0..1 streak cover at world (x, z) for unit flow (dirX, dirZ)
export function streak( x, z, dirX, dirZ ) {

	let a = Math.atan2( dirZ, dirX );
	if ( a < 0 ) a += Math.PI;
	const t = a / Math.PI * STREAK_SECTORS, k = Math.floor( t ) % STREAK_SECTORS, w = t - Math.floor( t );
	const v = sectorNoise( x, z, k ) * ( 1 - w ) + sectorNoise( x, z, ( k + 1 ) % STREAK_SECTORS ) * w;
	return smoothstep( STREAK_LO, STREAK_HI, v );

}

// Whitewater: the foam cover (0..1) the water shader adds over the flood. breaking, froude: classifyBore; h depth (m);
// speed (m/s); bed (m); drop: how much of the depth is gone TRAIL_LENGTH ahead along the flow (0..1); streakV: the
// flow-aligned pattern (0..1); crest: 1, or the far-field wall's crest band (Water.js disasterFarCrest).
export const TRAIL_COVER = 0.6; // the wake just behind the face: churned, mostly white (declared)
export const TRAIL_JUMP = [ 0.4, 1.2 ]; // m: depth lost ahead that makes a roller's wake, not a sheet thinning out (declared)
export const SNOUT_COVER = 0.5;
export const SNOUT_DEPTH = [ 0.03, 0.12 ];
export const TRAIL_NEAR = 4; // m: about one jump height behind a 2-3 m bore's toe (declared)
export const TRAIL_FAR_WEIGHT = 0.5;
export function wakeDrop( h, s, nearH, nearS, farH, farS ) {

	const one = ( hA, sA ) => sat( Math.min( h - hA, hA > 0.002 ? s - sA : h - hA ) / Math.max( h, 0.2 ) );
	return Math.max( one( nearH, nearS ), TRAIL_FAR_WEIGHT * one( farH, farS ) );

}
export const STREAK_T = 6; // s: the streaks are dragged along the flow for this long, then blended out (two-phase flow map)
export const FOAM_TURBID = [ 0.80, 0.74, 0.64 ]; // foam albedo tint over sediment-laden water: beige-grey (declared)
export function whitewater( breaking, froude, h, speed, bed, drop, streakV, crest ) {

	const face = breaking * crest;
	// (and a real face ahead, TRAIL_JUMP: green 1 drew a 2 m flood 65 % white, every thin sheet thinning to its edge)
	const trail = smoothstep( 0.25, 0.7, drop ) * smoothstep( TRAIL_JUMP[ 0 ], TRAIL_JUMP[ 1 ], drop * Math.max( h, 0.2 ) ) * smoothstep( BORE_FR_LO, BORE_FR_HI, froude ) * TRAIL_COVER;
	const churn = smoothstep( 0.6, 1.6, froude ) * smoothstep( 0.05, 0.4, h );
	// (broken by the streak pattern: a turbulent edge, not a white ribbon)
	const snout = smoothstep( 0.5, 2.5, speed ) * ( 1 - smoothstep( SNOUT_DEPTH[ 0 ], SNOUT_DEPTH[ 1 ], h ) ) * ( h >= 0.002 ? 1 : 0 ) * ( bed >= - 0.5 ? 1 : 0 ) * SNOUT_COVER * ( 0.6 + 0.4 * streakV );
	return sat( Math.max( face, trail, snout ) + churn * streakV * STREAK_CAP * crest );

}

export const SEABED_BARE = [ 0.1, - 0.3 ]; // m: ground below which bared bed is fully wet (the static beach band covers above)
export const SEABED_FILM = 0.05; // m: water deeper than this over the bed is the sea, not a wet film (from the solver's 2 mm dry depth: green 2 drew a 1.5 mm film 0.995)
export function seabedWetness( ground, surface, depth ) {

	return smoothstep( SEABED_BARE[ 0 ], SEABED_BARE[ 1 ], ground ) * ( 1 - smoothstep( 0.002, SEABED_FILM, depth ) ) * ( 1 - smoothstep( 0.3, 0.6, surface - ground ) );

}

// The flood's cover over the rest sea's shore waves (Water.js disasterLookAt o.cover, its CPU twin): 1 ends the swash
// sheet, the surf foam and the surf medium, which the ocean keys to the rest depth (the sea at its mean level).
// bed: the ground (m), surface: the grid's free surface (bed + depth, m), depth: the grid's water depth (m).
export function floodCover( bed, surface, depth ) {

	if ( bed >= 0 ) return smoothstep( 0.1, 0.6, depth );
	return Math.max( smoothstep( 0.4, 2.0, Math.abs( depth > 0.002 ? surface : Math.min( 0, surface ) ) ), 1 - smoothstep( 0.002, SEABED_FILM, depth ) );

}

// The look of a whole packed grid (forward differences, the per-pixel stencil at the grid's own spacing).
// Debug and test use only: one pass over n^2 cells, never per frame.
const scratch = {};
export function gridLook( P, n, dx, x0 = 0, z0 = 0 ) {

	const s = { boreCells: 0, coastBore: 0, maxFroude: 0, maxJump: 0, turbidLand: 0, turbidDeep: 0, wwFlood: 0 };
	let land = 0, deep = 0, flood = 0;
	for ( let j = 0; j < n - 1; j ++ ) for ( let i = 0; i < n - 1; i ++ ) {

		const k = ( j * n + i ) * 4, h = P[ k + 3 ];
		if ( h <= 0.002 ) continue;
		const u = P[ k + 1 ], v = P[ k + 2 ], speed = Math.hypot( u, v );
		classifyBore( h, speed, boreFace( P, n, k, dx ), scratch );
		s.maxFroude = Math.max( s.maxFroude, scratch.froude );
		const bed = P[ k ] - h;
		if ( scratch.breaking > 0.5 ) {

			s.boreCells ++;
			s.maxJump = Math.max( s.maxJump, scratch.jump );
			if ( bed >= COAST_BED_LO && bed <= COAST_BED_HI ) s.coastBore ++;

		}
		const t = turbidity( h, speed, bed );
		if ( bed > 0.5 && h > 0.3 ) {

			s.turbidLand += t;
			land ++;
			if ( scratch.breaking <= 0.1 ) {

				const dirX = speed > 1e-6 ? u / speed : 0, dirZ = speed > 1e-6 ? v / speed : 0;
				const nI = i + dirX * TRAIL_NEAR / dx, nJ = j + dirZ * TRAIL_NEAR / dx, fI = i + dirX * TRAIL_LENGTH / dx, fJ = j + dirZ * TRAIL_LENGTH / dx;
				const drop = wakeDrop( h, P[ k ], sampleGrid( P, n, nI, nJ, 3 ), sampleGrid( P, n, nI, nJ, 0 ), sampleGrid( P, n, fI, fJ, 3 ), sampleGrid( P, n, fI, fJ, 0 ) );
				s.wwFlood += whitewater( scratch.breaking, scratch.froude, h, speed, bed, drop, streak( x0 + i * dx, z0 + j * dx, dirX, dirZ ), 1 );
				flood ++;

			}

		} else if ( h > 30 ) {

			s.turbidDeep += t;
			deep ++;

		}

	}
	s.turbidLand = land ? s.turbidLand / land : 0;
	s.turbidDeep = deep ? s.turbidDeep / deep : 0;
	s.landCells = land;
	s.wwFlood = flood ? s.wwFlood / flood : 0;
	s.wwFloodCells = flood;
	return s;

}

export const COAST_BAND = [ COAST_BED_LO, COAST_BED_HI ];
export const LAND_BAND = [ 0.5, 80 ]; // m: bed above the beach toe, up to the village's highest street (declared)
let mark = null, stack = null;
const fs = {};
export function boreFront( P, n, dx, x0, z0, band = COAST_BAND, groundAt = null, out = {}, opts = null ) {

	const N = n * n;
	if ( ! mark || mark.length < N ) {

		mark = new Int32Array( N );
		stack = new Int32Array( N );

	}
	mark.fill( 0, 0, N );
	for ( let j = 0; j < n - 1; j ++ ) for ( let i = 0; i < n - 1; i ++ ) {

		const c = j * n + i, k = c * 4, h = P[ k + 3 ];
		if ( h <= 0.002 ) continue;
		const bed = P[ k ] - h;
		if ( bed < band[ 0 ] || bed > band[ 1 ] ) continue;
		const u = P[ k + 1 ], v = P[ k + 2 ], speed = Math.hypot( u, v );
		const gx = ( P[ k + 4 ] - P[ k ] ) / dx, gz = ( P[ k + n * 4 ] - P[ k ] ) / dx;
		if ( opts?.edge ) {

			if ( h < 0.05 || speed < 1 ) continue;
			const dry = ( q ) => P[ q * 4 + 3 ] <= 0.002;
			if ( ! ( ( u > 0 && dry( c + 1 ) ) || ( u < 0 && i > 0 && dry( c - 1 ) ) || ( v > 0 && dry( c + n ) ) || ( v < 0 && j > 0 && dry( c - n ) ) ) ) continue;

		} else {

			if ( classifyBore( h, speed, boreFace( P, n, k, dx ), fs ).breaking <= 0.5 ) continue;

		}
		if ( groundAt ) {

			// heading down into the sea (the ground 16 m ahead below the berm toe and lower than 16 m behind): a
			// backwash or a reflection, not the face the player watches come in
			const x = x0 + i * dx, z = z0 + j * dx, ax = u / speed * 2 * dx, az = v / speed * 2 * dx;
			const ahead = groundAt( x + ax, z + az );
			if ( ahead < 0.5 && ahead < groundAt( x - ax, z - az ) ) continue;

		}
		mark[ c ] = 1;

	}
	// label each run (ids from 2), keep the largest (or the nearest to opts.near)
	let id = 1, best = 0, bestId = 0, bestScore = - Infinity;
	for ( let c = 0; c < N; c ++ ) {

		if ( mark[ c ] !== 1 ) continue;
		id ++;
		let top = 0, size = 0, cx = 0, cz = 0;
		stack[ top ++ ] = c;
		mark[ c ] = id;
		while ( top > 0 ) {

			const q = stack[ -- top ], i = q % n;
			size ++;
			cx += x0 + i * dx;
			cz += z0 + Math.floor( q / n ) * dx;
			if ( i > 0 && mark[ q - 1 ] === 1 ) { mark[ q - 1 ] = id; stack[ top ++ ] = q - 1; }
			if ( i < n - 1 && mark[ q + 1 ] === 1 ) { mark[ q + 1 ] = id; stack[ top ++ ] = q + 1; }
			if ( q >= n && mark[ q - n ] === 1 ) { mark[ q - n ] = id; stack[ top ++ ] = q - n; }
			if ( q < N - n && mark[ q + n ] === 1 ) { mark[ q + n ] = id; stack[ top ++ ] = q + n; }

		}
		const score = opts?.near ? - Math.hypot( cx / size - opts.near[ 0 ], cz / size - opts.near[ 1 ] ) : size;
		if ( score > bestScore ) {

			bestScore = score;
			best = size;
			bestId = id;

		}

	}
	if ( ! best ) return null;
	let sx = 0, sz = 0, su = 0, sv = 0, sb = 0, crest = - Infinity;
	for ( let c = 0; c < N; c ++ ) {

		if ( mark[ c ] !== bestId ) continue;
		const k = c * 4, h = P[ k + 3 ], speed = Math.hypot( P[ k + 1 ], P[ k + 2 ] );
		sx += x0 + ( c % n ) * dx;
		sz += z0 + Math.floor( c / n ) * dx;
		if ( speed > 1e-6 ) {

			su += P[ k + 1 ] / speed;
			sv += P[ k + 2 ] / speed;

		}
		sb += P[ k ] - h;
		crest = Math.max( crest, P[ k ] );

	}
	const dl = Math.hypot( su, sv ) || 1;
	out.x = sx / best;
	out.z = sz / best;
	out.dirX = su / dl;
	out.dirZ = sv / dl;
	out.crest = crest;
	out.bed = sb / best;
	out.cells = best;
	// the face's width across the heading
	let lo = Infinity, hi = - Infinity;
	for ( let c = 0; c < N; c ++ ) {

		if ( mark[ c ] !== bestId ) continue;
		const across = ( x0 + ( c % n ) * dx - out.x ) * - out.dirZ + ( z0 + Math.floor( c / n ) * dx - out.z ) * out.dirX;
		lo = Math.min( lo, across );
		hi = Math.max( hi, across );

	}
	out.length = hi - lo + dx;
	return out;

}

const f = ( x ) => x.toFixed( 6 );
export const SED_ABSORB = [ 9.0, 11.0, 14.0 ], SED_SCATTER = [ 12.0, 11.5, 10.5 ];
export const FLOOD_ALBEDO = [ 0.085, 0.072, 0.056 ], WALL_ALBEDO = [ 0.012, 0.030, 0.032 ];
export const WALL_ETA = [ 4, 15 ]; // m: the flood's surface this far over the sea is the wall (a 2 m surge never)
export const SED_WGSL = { absorb: `vec3f( ${ SED_ABSORB.map( f ).join( ', ' ) } )`, scatter: `vec3f( ${ SED_SCATTER.map( f ).join( ', ' ) } )` };

export const FLOOD_LOOK_WGSL = /* wgsl */`
// FloodLook.js twin: bore classification and turbidity (same constants, same iteration)
fn floodBoreRatio( fr: f32 ) -> f32 {
	var r = 1.0 + 2.0 * fr;
	for ( var i = 0; i < ${ RATIO_ITERATIONS }; i ++ ) { r = 1.0 + fr * r * sqrt( 2.0 / ( r + 1.0 ) ); }
	return r;
}
// ( breaking 0..1, local Froude number, jump m )
fn floodClassifyBore( h: f32, speed: f32, face: f32 ) -> vec3f {
	let fr = speed / sqrt( ${ f( G ) } * max( h, ${ f( H_MIN ) } ) );
	let r = floodBoreRatio( fr );
	let breaking = smoothstep( ${ f( BORE_FR_LO ) }, ${ f( BORE_FR_HI ) }, fr ) * smoothstep( ${ f( FACE_LO ) }, ${ f( FACE_HI ) }, face ) * smoothstep( ${ f( H_MIN ) }, 0.15, h );
	return vec3f( breaking, fr, h * ( 1.0 - 1.0 / r ) );
}
fn floodTurbidity( h: f32, speed: f32, bed: f32 ) -> f32 {
	if ( h <= 0.002 ) { return 0.0; }
	let land = smoothstep( -1.0, 0.5, bed );
	let stirred = smoothstep( 0.5, 3.0, speed ) * smoothstep( 30.0, 8.0, h );
	return clamp( max( land, stirred ), 0.0, 1.0 );
}
fn floodHash( ix: i32, iz: i32 ) -> f32 {
	var h = ( bitcast<u32>( ix ) * 0x27d4eb2du ) ^ ( bitcast<u32>( iz ) * 0x165667b1u );
	h = ( h ^ ( h >> 15u ) ) * 0x2c1b3c6du;
	h = h ^ ( h >> 12u );
	return f32( h ) * ( 1.0 / 4294967296.0 );
}
fn floodNoise( q: vec2f ) -> f32 {
	let i = floor( q );
	let f = q - i;
	let u = f * f * ( 3.0 - 2.0 * f );
	let ix = i32( i.x );
	let iz = i32( i.y );
	return mix( mix( floodHash( ix, iz ), floodHash( ix + 1, iz ), u.x ), mix( floodHash( ix, iz + 1 ), floodHash( ix + 1, iz + 1 ), u.x ), u.y );
}
fn floodSectorNoise( p: vec2f, k: f32 ) -> f32 {
	let a = k * ${ f( Math.PI / STREAK_SECTORS ) };
	let c = cos( a );
	let s = sin( a );
	return floodNoise( vec2f( ( p.x * c + p.y * s ) / ${ f( STREAK_LENGTH ) }, ( p.y * c - p.x * s ) / ${ f( STREAK_WIDTH ) } + k * 17.0 ) );
}
fn floodStreak( p: vec2f, dir: vec2f ) -> f32 {
	var a = atan2( dir.y, dir.x );
	if ( a < 0.0 ) { a += ${ f( Math.PI ) }; }
	let t = a / ${ f( Math.PI ) } * ${ f( STREAK_SECTORS ) };
	let k = floor( t ) % ${ f( STREAK_SECTORS ) };
	let w = t - floor( t );
	let v = mix( floodSectorNoise( p, k ), floodSectorNoise( p, ( k + 1.0 ) % ${ f( STREAK_SECTORS ) } ), w );
	return smoothstep( ${ f( STREAK_LO ) }, ${ f( STREAK_HI ) }, v );
}
fn floodWhitewater( breaking: f32, froude: f32, h: f32, speed: f32, bed: f32, drop: f32, streakV: f32, crest: f32 ) -> f32 {
	let face = breaking * crest;
	let trail = smoothstep( 0.25, 0.7, drop ) * smoothstep( ${ f( TRAIL_JUMP[ 0 ] ) }, ${ f( TRAIL_JUMP[ 1 ] ) }, drop * max( h, 0.2 ) ) * smoothstep( ${ f( BORE_FR_LO ) }, ${ f( BORE_FR_HI ) }, froude ) * ${ f( TRAIL_COVER ) };
	let churn = smoothstep( 0.6, 1.6, froude ) * smoothstep( 0.05, 0.4, h );
	let snout = smoothstep( 0.5, 2.5, speed ) * ( 1.0 - smoothstep( ${ f( SNOUT_DEPTH[ 0 ] ) }, ${ f( SNOUT_DEPTH[ 1 ] ) }, h ) ) * step( 0.002, h ) * step( -0.5, bed ) * ${ f( SNOUT_COVER ) } * ( 0.6 + 0.4 * streakV );
	return clamp( max( max( face, trail ), snout ) + churn * streakV * ${ f( STREAK_CAP ) } * crest, 0.0, 1.0 );
}
fn floodWakeDrop1( h: f32, s: f32, a: vec2f ) -> f32 {
	return clamp( min( h - a.y, select( h - a.y, s - a.x, a.y > 0.002 ) ) / max( h, 0.2 ), 0.0, 1.0 );
}
// FloodLook.wakeDrop: a = ( surface, depth ) ahead, near then far
fn floodWakeDrop( h: f32, s: f32, nearA: vec2f, farA: vec2f ) -> f32 {
	return max( floodWakeDrop1( h, s, nearA ), ${ f( TRAIL_FAR_WEIGHT ) } * floodWakeDrop1( h, s, farA ) );
}
// FloodLook.seabedWetness
const FLOOD_SEABED_FILM = ${ f( SEABED_FILM ) };
const FLOOD_FACE_FILL = vec2f( ${ f( FACE_FILL[ 0 ] ) }, ${ f( FACE_FILL[ 1 ] ) } );
fn floodSeabedWet( ground: f32, surface: f32, depth: f32 ) -> f32 {
	return smoothstep( ${ f( SEABED_BARE[ 0 ] ) }, ${ f( SEABED_BARE[ 1 ] ) }, ground ) * ( 1.0 - smoothstep( 0.002, ${ f( SEABED_FILM ) }, depth ) ) * ( 1.0 - smoothstep( 0.3, 0.6, surface - ground ) );
}
const FLOOD_TRAIL_LENGTH = ${ f( TRAIL_LENGTH ) };
const FLOOD_TRAIL_NEAR = ${ f( TRAIL_NEAR ) };
const FLOOD_STREAK_T = ${ f( STREAK_T ) };
const FLOOD_STREAK_LENGTH = ${ f( STREAK_LENGTH ) };
const FLOOD_FOAM_TURBID = vec3f( ${ FOAM_TURBID.map( f ).join( ', ' ) } );
const FLOOD_LIP_THROW = ${ f( LIP_THROW ) };
const FLOOD_LIP_RISE = ${ f( LIP_RISE ) };
`;
