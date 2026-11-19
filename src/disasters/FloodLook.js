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
	const t = smoothstep( RISEN_BED[ 0 ], RISEN_BED[ 1 ], bed );
	const land = smoothstep( - 1.0, 0.5, bed ) * smoothstep( RISEN[ 0 ] + ( RISEN_LAND[ 0 ] - RISEN[ 0 ] ) * t, RISEN[ 1 ] + ( RISEN_LAND[ 1 ] - RISEN[ 1 ] ) * t, h + Math.min( bed, 0 ) );
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
export const CARRIED_LACE = 0.25;
// The snout's foam fades in over this bed band (m). It switched on at -0.5 m: a line along that contour.
export const SNOUT_BED = [ - 1.0, - 0.2 ];
// A face with 6-24 m of water behind it is not white from top to toe (the 320 m wall inside the grids drew as a
// chalk cliff): dark water torn into the streaks, FACE_TALL_COVER of it white between them (declared).
export const FACE_TALL = [ 6, 24 ]; // m
export const FACE_TALL_COVER = 0.25;
// Foam off the face gathers into rafts and streaks along the flow, with clear water between them. Carried foam was
// drawn as an even veil (CARRIED_LACE of it everywhere), and any even low cover passes only the foam texture's
// brightest filaments: white scribbles across the brown. The cover asked for is the share of the surface that is
// white, taken from the high ground of the streak pattern n (0..1, three scales): RAFT_SOFT is the width of a raft's
// torn edge in pattern units, RAFT_DENSE the cover inside the thinnest rafts (declared).
export const RAFT_SOFT = 0.12, RAFT_DENSE = 0.8;
export const RAFT_SCALES = [ 0.5, 0.3, 0.2 ], RAFT_BAND = [ 0.3, 0.7 ]; // weights of the 70, 17 and 4 m streaks; the pattern values spread to 0..1
// A raft is a bubble mat with holes, not a sheet: the cover in the holes of the foam pattern is RAFT_THIN of the
// raft's (drawn evenly, the front on the sand was a band of flat paint). The pattern's place is bent by up to
// RAFT_WARP m over RAFT_WARP_GRAIN m, so a raft's edge does not follow the streak pattern's lattice (declared).
export const RAFT_THIN = 0.3, RAFT_WARP = 6, RAFT_WARP_GRAIN = 9; // m
export function raft( cover, n ) {

	const t = 1 + RAFT_SOFT - cover * ( 1 + 2 * RAFT_SOFT );
	return smoothstep( t - RAFT_SOFT, t + RAFT_SOFT, n ) * ( RAFT_DENSE + ( 1 - RAFT_DENSE ) * cover );

}
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
// (0.80, 0.74, 0.64 as first set: once the flood's foam drew as solid rafts it read as snow on the dark body. The froth
// of the Tohoku and Palu fronts is tan, loaded with the same silt as the water.)
export const FOAM_TURBID = [ 0.62, 0.55, 0.45 ]; // foam albedo tint over sediment-laden water: tan (declared)
export function whitewater( breaking, froude, h, speed, bed, drop, streakV, crest, carried = 0 ) {

	const face = breaking * crest * ( 1 - smoothstep( FACE_TALL[ 0 ], FACE_TALL[ 1 ], h ) * ( 1 - FACE_TALL_COVER ) * ( 1 - streakV ) );
	// (and a real face ahead, TRAIL_JUMP: green 1 drew a 2 m flood 65 % white, every thin sheet thinning to its edge)
	const trail = smoothstep( 0.25, 0.7, drop ) * smoothstep( TRAIL_JUMP[ 0 ], TRAIL_JUMP[ 1 ], drop * Math.max( h, 0.2 ) ) * smoothstep( BORE_FR_LO, BORE_FR_HI, froude ) * TRAIL_COVER;
	const lace = carried * ( CARRIED_LACE + ( 1 - CARRIED_LACE ) * Math.max( streakV, smoothstep( 0.5, 1, carried ) ) ) * crest;
	// (broken by the streak pattern: a turbulent edge, not a white ribbon)
	const snout = smoothstep( 0.5, 2.5, speed ) * ( 1 - smoothstep( SNOUT_DEPTH[ 0 ], SNOUT_DEPTH[ 1 ], h ) ) * ( h >= 0.002 ? 1 : 0 ) * smoothstep( SNOUT_BED[ 0 ], SNOUT_BED[ 1 ], bed ) * SNOUT_COVER * ( 0.6 + 0.4 * streakV );
	return sat( Math.max( face, trail, snout, lace ) );

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

	const t = smoothstep( COVER_BED[ 0 ], COVER_BED[ 1 ], bed );
	const lo = COVER_SEA[ 0 ] + ( COVER_LAND[ 0 ] - COVER_SEA[ 0 ] ) * t, hi = COVER_SEA[ 1 ] + ( COVER_LAND[ 1 ] - COVER_SEA[ 1 ] ) * t;
	const excess = depth > 0.002 ? Math.abs( surface - Math.max( bed, 0 ) ) : Math.abs( Math.min( 0, surface ) );
	return Math.max( smoothstep( lo, hi, excess ), ( 1 - smoothstep( 0.002, SEABED_FILM, depth ) ) * ( 1 - smoothstep( DRAINED_BED[ 0 ], DRAINED_BED[ 1 ], bed ) ) );

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


// The cover that ends the rest sea's shore waves (floodCover): how far the water must stand from rest, over the sea
// (a surge or a drawdown) and over the land (any flood), the bed band the thresholds cross in, and the bed band the
// drained term ends in. RISEN: how far over its rest level water must stand to count as the flood's (turbidity).
export const COVER_SEA = [ 0.4, 2.0 ], COVER_LAND = [ 0.1, 0.6 ]; // m
export const COVER_BED = [ - 2.0, 0.0 ], DRAINED_BED = [ - 0.05, 0.0 ]; // m
export const RISEN = [ 0.02, 0.25 ]; // m
// Over the land any water is the flood's: the band narrows to RISEN_LAND as the bed rises through RISEN_BED. Held to
// the sea's band, the thin sheet at the flood's own edge lost its sediment and drew as a pale band of clear water.
export const RISEN_LAND = [ 0.005, 0.04 ], RISEN_BED = [ 0.0, 0.3 ]; // m

// Turbulence at the free surface, 0 smooth to 1 boiling. The surface breaks up once the velocity fluctuations under
// it reach about 0.3 m/s (Brocchini and Peregrine 2001, J. Fluid Mech. 449); they are 5-10 % of the mean speed in
// open-channel flow (Nezu and Nakagawa 1993), so it wrinkles from 0.3 m/s and is fully broken by 3-4 m/s.
// (As first built: the speed over 0.3-4 m/s times 0.35 + 0.65 of the Froude term. A 2 m/s current through 3 m of water
// over the beach came out at 0.18 and drew as a mirror of the sky. What deforms the surface is the turbulent energy
// against gravity over the eddy's size, q^2 / ( g L ) (the same paper): q follows the speed, 10-20 % of it over the
// rough ground of a flooded town, and L the depth, so the slope variance follows the Froude number squared in any
// regime. The variance is the speed term times the Froude term, and the value here is its square root, because the
// chop's slopes scale with it: 0.6 for that current, 0.9 for 2 m/s through a metre of water in a street, and nothing
// under Froude 0.05, so the open sea keeps its own surface. Declared, the violent end.)
export const TURB_SPEED = [ 0.2, 2.5 ]; // m/s
export const TURB_FROUDE = [ 0.05, 0.7 ];
export function floodTurbulence( froude, speed, breaking ) {

	return sat( Math.max( breaking, Math.sqrt( smoothstep( TURB_SPEED[ 0 ], TURB_SPEED[ 1 ], speed ) * smoothstep( TURB_FROUDE[ 0 ], TURB_FROUDE[ 1 ], froude ) ) ) );

}

// Chop the 8 m solver cannot hold (WGSL floodChop): value noise with its gradient on CHOP_OCTAVES fixed wavelengths
// from CHOP_L0 (m), a factor CHOP_STEP apart (fixed, not scaled by the local depth: dividing world coordinates by a
// depth that varies scrambles the pattern), weighted to the CHOP_SPAN octaves around CHOP_DEPTH depths (the largest
// eddies and the boils they raise scale with the depth, Nezu and Nakagawa 1993). CHOP_SLOPE per octave gives a mean
// square slope of 0.06 at full turbulence (CHOP_VAR is the noise gradient's variance; a gale-driven sea is 0.075 at
// 14 m/s, Cox and Munk 1954; declared, the violent end). Dragged along the flow for CHOP_T s in two phases, the
// octaves drifting against each other at CHOP_DRIFT cells/s so it boils in place too.
export const CHOP_L0 = 0.5, CHOP_STEP = 2.8, CHOP_OCTAVES = 6, CHOP_DEPTH = 2.5, CHOP_SPAN = 1.6;
// (The noise was value noise, CHOP_SLOPE 0.37 on a gradient variance of 0.347: its slope is zero along every lattice
// line, and the sun's glint and the facets drew as a grid of squares half a metre across. Gradient noise has no such
// lines; its slope variance is 0.2615 for gradients uniform in a square, and CHOP_SLOPE keeps the same slope per octave.)
export const CHOP_SLOPE = 0.426, CHOP_VAR = 0.2615, CHOP_T = 3, CHOP_DRIFT = 0.35;
// The eddies' energy cascades down, so every wavelength under the largest keeps CHOP_FINE of the slope. With the band
// alone, water 4 m deep carried only 4-30 m swells: glossy plastic up close, and one blown-out sheet of sun glint.
// The mean square slope at full turbulence is then 0.06-0.09 (declared).
export const CHOP_FINE = 0.45;
// (MATTE was 8, 0.06 loses half: a current at turbulence 0.6 kept four fifths of the mirror, clouds and houses clear in
// it. Slopes deviating by 0.15 throw the reflected ray over 17 degrees of sky either way: 15, 0.067 loses all.)
export const MATTE = 15; // slope variance below a pixel to the share of the mirror reflection lost to the sky's mean
// How much of the sky a rough water surface reflects toward a viewer at cos (the cosine from the mean surface's
// normal) when its slopes deviate by sigma: the mean Fresnel reflectance over the facets the viewer sees (the fit of
// Bruneton, Neyret and Holzschuch 2010, "Real-time realistic ocean lighting using seamless transitions from geometry
// to BRDF"). With sigma 0 it is Schlick's flat water. A pixel takes it in full once the chop below it has a slope
// variance of 1 / MEAN_FRESNEL_FULL (at 250 the change from mirror to body fell inside a few metres of a slowing
// current and drew as the outline of a slick).
export const MEAN_FRESNEL_FULL = 60;
export function meanFresnel( cos, sigma ) {

	return 0.02 + 0.98 * Math.pow( Math.max( 1 - cos, 1e-4 ), 5 * Math.exp( - 2.69 * sigma ) ) / ( 1 + 22.7 * Math.pow( sigma, 1.5 ) );

}
export const MEAN_FRESNEL_WGSL = ( cos, sigma ) => `( 0.02 + 0.98 * pow( max( 1.0 - ${ cos }, 1e-4 ), 5.0 * exp( -2.69 * ${ sigma } ) ) / ( 1.0 + 22.7 * ${ sigma } * sqrt( ${ sigma } ) ) )`;
// Flotsam: dark flecks FLECK_SIZE m across where the water is loaded, FLECK_DARK darker, drawn within FLECK_PX m of pixel footprint
// (as first built, 0.3 m flecks spread evenly over a fifth of the surface read as a printed pattern: flotsam gathers,
// so they are smaller, fewer, and stand only in drifts FLECK_DRIFT m across)
export const FLECK_SIZE = 0.14, FLECK_DARK = 0.5, FLECK_PX = 0.12, FLECK_DRIFT = 5;
// The sediment load is uneven, plumes of paler and darker water (the Tohoku aerial footage): the body's albedo varies
// by up to PLUME_MAX either way over patches PLUME_GRAIN m across, dragged along the flow with the chop (declared).
export const PLUME = 1.6, PLUME_MAX = 0.5, PLUME_GRAIN = [ 31, 9 ]; // gain on the noise about its mean; m

// The film at the flood's edge. The drawn sheet carries the wet corners' level across a partly wet cell to where the
// real ground rises through it. Where a dry corner lies BELOW that level (a front advancing over flat ground: the
// water has not reached it yet) the level stood proud to the cell's edge and ended in a step, 14 cm for a 0.3 m sheet
// on a 2 % slope: the stepped edge with a dark rim against the sand. The sheet's thickness is capped toward such
// corners: hw the wet corners' mean depth (m), open their bilinear weight (0..1). No cap with none (the rest shoreline
// and water against rising ground are unchanged), full depth to the middle of the cell, nothing at the corner.
// (The cap reached nothing only at open 1, which is the lines between dry grid points: the film's outline was a
// staircase of 8 m steps. It now ends at TAPER_END, a contour of the corners' weights that crosses the cell, and the
// weight is pushed toward dry by up to TAPER_ROUGH with the ground's small relief, which neither the 8 m solver nor
// the 1 m terrain holds and which decides where a front runs first: two grains of value noise, TAPER_GRAIN m across,
// fixed to the ground. The edge wanders a few metres across the cell, in lobes and fingers.)
export const TAPER = 1.5, TAPER_OPEN = 0.4, TAPER_END = 0.8, TAPER_ROUGH = 0.5;
export const TAPER_GRAIN = [ 2.3, 0.7 ]; // m
export function sheetCap( hw, open ) {

	if ( open <= 0 ) return Infinity;
	return hw * TAPER * ( 1 - smoothstep( TAPER_OPEN, TAPER_END, open ) ) / Math.max( open, 0.05 );

}
export const FILM_FADE = 0.03; // m: the film fades in over its first 3 cm (the sediment hides the ground by about 15)
// The silt a tsunami leaves (a sheet of sand and mud 1-30 cm thick, Jaffe and Gelfenbaum 2007): the wet ground's
// tint, linear albedo, and how much of it shows where the ground is soaked (declared).
export const SILT = [ 0.13, 0.11, 0.085 ], SILT_COVER = 0.45;

// The flood's history on the inner grid, one step per solver step (HISTORY_STEP s), four values a cell:
//   foam    born on the breaking face and at the leading edge, carried along the flow, decaying with FOAM_LIFE (clean
//           sea foam lasts about 3.5 s, Monahan and Zietlow 1969; water loaded with fines and surfactants holds it
//           many times longer, Callaghan, Deane and Stokes 2013; the Tohoku streaks are minutes old; declared);
//           left on the ground it pops within FOAM_STRAND
//   wet     1 on land under water, drying with WET_DRY once the water has left (wet ground stays dark for tens of
//           minutes to hours: declared, the fast end, so the player sees it dry). Never set over the sea's own bed.
//   load    sediment the water carries (turbidity where it is picked up), so water that has run over the land is
//           still brown when it runs back to sea; it settles with LOAD_LIFE
//   turb    the surface turbulence (floodTurbulence), outliving the front by TURB_LIFE (boils behind a bore)
// Semi-Lagrangian along the packed velocity (what stood upstream one step ago is here now), then the larger of what
// arrived, decayed, and what this cell makes itself. Pure and allocation free once sized; Water.js uploads `data` into
// rows 2n..3n-1 of the disaster texture, and keeps calling dry() after the grids are gone until nothing is left.
export const HIST_FOAM = 0, HIST_WET = 1, HIST_LOAD = 2, HIST_TURB = 3;
export const HISTORY_STEP = 0.1; // s
// A step is taken HISTORY_BANDS bands of rows at a time, one band a frame (Water.js): the whole 257 x 257 grid in one
// call took 3 ms on the main thread, a hitch on every sixth frame.
export const HISTORY_BANDS = 8;
// (FOAM_LIFE was 20 s: twenty seconds behind the front the bay was bare of foam from the air. 40 s, the long end.)
export const FOAM_LIFE = 40, FOAM_STRAND = 6, TURB_LIFE = 6, LOAD_LIFE = 180, WET_DRY = 300; // s (e-folding)
export const EDGE_SPEED = [ 1, 3 ]; // m/s: a leading edge this fast foams
export const EDGE_FOAM = 0.7;
export const HISTORY_LIVE = 0.01; // below this everywhere the history is off
const HISTORY_FLOOR = 1e-4;
export class FloodHistory {

	constructor() {

		this.n = 0;
		this.x = 0;
		this.z = 0;
		this.dx = 8;
		this.data = new Float32Array( 0 );
		this.prev = new Float32Array( 0 );
		this.live = false;
		this.pending = false; // `live` so far in a step taken in bands

	}

	// Take the grid's size, place of texel 0 (m) and spacing (m). A new place clears the history (true); the same
	// place keeps it: a second wave runs over ground that is still wet.
	begin( n, x, z, dx ) {

		if ( this.n === n && this.x === x && this.z === z && this.dx === dx ) return false;
		this.n = n;
		this.x = x;
		this.z = z;
		this.dx = dx;
		if ( this.data.length !== n * n * 4 ) {

			this.data = new Float32Array( n * n * 4 );
			this.prev = new Float32Array( n * n * 4 );

		} else this.data.fill( 0 );
		this.live = false;
		return true;

	}

	// P: the grid's packed state (WaterGrid.pack), n cells a side of dx m; dt s since the last step.
	// j0, j1: the rows to step (j1 excluded), for a step spread over several calls: the first band (j0 <= 1) takes the
	// copy every band reads what stood upstream from, the last (j1 >= n - 1) settles `live`. One call with neither is
	// a whole step, and banded calls with the same P end on the same values.
	step( P, n, dx, dt, j0 = 1, j1 = n - 1 ) {

		const H = this.data, S = this.prev;
		j0 = Math.max( 1, j0 );
		j1 = Math.min( n - 1, j1 );
		if ( j0 <= 1 ) S.set( H );
		dt = Math.min( dt, 0.5 );
		const kFoam = Math.exp( - dt / FOAM_LIFE ), kStrand = Math.exp( - dt / FOAM_STRAND ), kTurb = Math.exp( - dt / TURB_LIFE ), kLoad = Math.exp( - dt / LOAD_LIFE ), kDry = Math.exp( - dt / WET_DRY );
		const row = n * 4, back = dt / dx;
		let live = j0 <= 1 ? false : this.pending;
		for ( let j = j0; j < j1; j ++ ) for ( let i = 1; i < n - 1; i ++ ) {

			const k = ( j * n + i ) * 4, h = P[ k + 3 ];
			if ( h <= 0.002 ) {

				// dry: stranded foam pops, the ground dries, the water's own state went with it
				if ( S[ k ] === 0 && S[ k + 1 ] === 0 && S[ k + 2 ] === 0 && S[ k + 3 ] === 0 ) continue;
				// (the silt the water dropped stays on the bed, and the water that returns stirs it up: with the load zeroed
				// here, the shallows a drawdown had bared drew as a strip of clear turquoise along the brown bay)
				const foam = S[ k ] * kStrand, wet = S[ k + 1 ] * kDry, silt = S[ k + 2 ] * kLoad;
				H[ k ] = foam < HISTORY_LIVE ? 0 : foam;
				H[ k + 1 ] = wet < HISTORY_LIVE ? 0 : wet;
				H[ k + 2 ] = silt < HISTORY_LIVE ? 0 : silt;
				H[ k + 3 ] = 0;
				if ( H[ k ] > 0 || H[ k + 1 ] > 0 || H[ k + 2 ] > 0 ) live = true;
				continue;

			}
			const u = P[ k + 1 ], v = P[ k + 2 ], speed = Math.hypot( u, v ), bed = P[ k ] - h;
			let foam = S[ k ], load = S[ k + 2 ], turb = S[ k + 3 ];
			if ( speed > 0.02 ) {

				const fi = Math.min( n - 1.001, Math.max( 0, i - u * back ) ), fj = Math.min( n - 1.001, Math.max( 0, j - v * back ) );
				const i0 = Math.floor( fi ), j0 = Math.floor( fj ), tx = fi - i0, tz = fj - j0, a = ( j0 * n + i0 ) * 4;
				const w00 = ( 1 - tx ) * ( 1 - tz ), w10 = tx * ( 1 - tz ), w01 = ( 1 - tx ) * tz, w11 = tx * tz;
				foam = S[ a ] * w00 + S[ a + 4 ] * w10 + S[ a + row ] * w01 + S[ a + row + 4 ] * w11;
				load = S[ a + 2 ] * w00 + S[ a + 6 ] * w10 + S[ a + row + 2 ] * w01 + S[ a + row + 6 ] * w11;
				turb = S[ a + 3 ] * w00 + S[ a + 7 ] * w10 + S[ a + row + 3 ] * w01 + S[ a + row + 7 ] * w11;

			}
			let breaking = 0, froude = 0, edge = 0;
			if ( speed > 0.05 ) {

				// (classifyBore's breaking without the depth ratio, which only its jump needs: this runs on every moving cell)
				froude = speed / Math.sqrt( G * Math.max( h, H_MIN ) );
				const face = froude > BORE_FR_LO ? boreFace( P, n, k, dx ) : 0;
				if ( face > FACE_LO ) breaking = smoothstep( BORE_FR_LO, BORE_FR_HI, froude ) * smoothstep( FACE_LO, FACE_HI, face ) * smoothstep( H_MIN, 0.15, h );
				// the leading edge: fast water with dry ground next along its heading
				if ( speed > EDGE_SPEED[ 0 ] && h > 0.03 && P[ k + ( Math.abs( u ) >= Math.abs( v ) ? ( u > 0 ? 4 : - 4 ) : ( v > 0 ? row : - row ) ) + 3 ] <= 0.002 ) edge = EDGE_FOAM * smoothstep( EDGE_SPEED[ 0 ], EDGE_SPEED[ 1 ], speed );

			}
			// (a face half way to breaking is already white: the roller is full of air before it is fully formed)
			foam = Math.min( 1, Math.max( foam * kFoam, breaking * 2, edge ) );
			turb = Math.max( turb * kTurb, floodTurbulence( froude, speed, breaking ) );
			// (and no faster than the bed's own silt settles: clear water running in over it is coloured by it)
			load = Math.max( load * kLoad, S[ k + 2 ] * kLoad, turbidity( h, speed, bed ) );
			// (stored down to HISTORY_FLOOR: cut at HISTORY_LIVE, the thin leading tail the advection spreads each step was
			// lost and a patch drifted 14 m in 5 s on water running at 4 m/s)
			H[ k ] = foam < HISTORY_FLOOR ? 0 : foam;
			H[ k + 1 ] = bed > 0 ? 1 : 0;
			H[ k + 2 ] = load < HISTORY_FLOOR ? 0 : load;
			H[ k + 3 ] = turb < HISTORY_FLOOR ? 0 : turb;
			if ( foam > HISTORY_LIVE || bed > 0 || load > HISTORY_LIVE || turb > HISTORY_LIVE ) live = true;

		}
		this.pending = live;
		if ( j1 >= n - 1 ) this.live = live;

	}

	// The grids are gone: what the water left pops and dries, dt s at a time. False once nothing is left.
	dry( dt ) {

		const H = this.data, kStrand = Math.exp( - dt / FOAM_STRAND ), kDry = Math.exp( - dt / WET_DRY ), kLoad = Math.exp( - dt / LOAD_LIFE );
		let live = false;
		for ( let k = 0; k < H.length; k += 4 ) {

			if ( H[ k ] === 0 && H[ k + 1 ] === 0 && H[ k + 2 ] === 0 && H[ k + 3 ] === 0 ) continue;
			const foam = H[ k ] * kStrand, wet = H[ k + 1 ] * kDry, silt = H[ k + 2 ] * kLoad;
			H[ k ] = foam < HISTORY_LIVE ? 0 : foam;
			H[ k + 1 ] = wet < HISTORY_LIVE ? 0 : wet;
			H[ k + 2 ] = silt < HISTORY_LIVE ? 0 : silt;
			H[ k + 3 ] = 0;
			if ( H[ k ] > 0 || H[ k + 1 ] > 0 || H[ k + 2 ] > 0 ) live = true;

		}
		this.live = live;
		return live;

	}

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
	let rt = smoothstep( ${ f( RISEN_BED[ 0 ] ) }, ${ f( RISEN_BED[ 1 ] ) }, bed );
	let land = smoothstep( -1.0, 0.5, bed ) * smoothstep( mix( ${ f( RISEN[ 0 ] ) }, ${ f( RISEN_LAND[ 0 ] ) }, rt ), mix( ${ f( RISEN[ 1 ] ) }, ${ f( RISEN_LAND[ 1 ] ) }, rt ), h + min( bed, 0.0 ) );
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
fn floodStreakRaw( p: vec2f, dir: vec2f ) -> f32 {
	var a = atan2( dir.y, dir.x );
	if ( a < 0.0 ) { a += ${ f( Math.PI ) }; }
	let t = a / ${ f( Math.PI ) } * ${ f( STREAK_SECTORS ) };
	let k = floor( t ) % ${ f( STREAK_SECTORS ) };
	let w = t - floor( t );
	let v = mix( floodSectorNoise( p, k ), floodSectorNoise( p, ( k + 1.0 ) % ${ f( STREAK_SECTORS ) } ), w );
	return v;
}
fn floodStreakCover( v: f32 ) -> f32 {
	return smoothstep( ${ f( STREAK_LO ) }, ${ f( STREAK_HI ) }, v );
}
fn floodStreak( p: vec2f, dir: vec2f ) -> f32 {
	return floodStreakCover( floodStreakRaw( p, dir ) );
}
// FloodLook.raft over the raw streak pattern at three scales (v)
fn floodRaft( cover: f32, v: vec3f ) -> f32 {
	let n = clamp( ( dot( v, vec3f( ${ RAFT_SCALES.map( f ).join( ', ' ) } ) ) - ${ f( RAFT_BAND[ 0 ] ) } ) / ${ f( RAFT_BAND[ 1 ] - RAFT_BAND[ 0 ] ) }, 0.0, 1.0 );
	let t = ${ f( 1 + RAFT_SOFT ) } - cover * ${ f( 1 + 2 * RAFT_SOFT ) };
	return smoothstep( t - ${ f( RAFT_SOFT ) }, t + ${ f( RAFT_SOFT ) }, n ) * ( ${ f( RAFT_DENSE ) } + ${ f( 1 - RAFT_DENSE ) } * cover );
}
fn floodWhitewater( breaking: f32, froude: f32, h: f32, speed: f32, bed: f32, drop: f32, streakV: f32, crest: f32, carried: f32 ) -> f32 {
	let face = breaking * crest * ( 1.0 - smoothstep( ${ f( FACE_TALL[ 0 ] ) }, ${ f( FACE_TALL[ 1 ] ) }, h ) * ${ f( 1 - FACE_TALL_COVER ) } * ( 1.0 - streakV ) );
	let trail = smoothstep( 0.25, 0.7, drop ) * smoothstep( ${ f( TRAIL_JUMP[ 0 ] ) }, ${ f( TRAIL_JUMP[ 1 ] ) }, drop * max( h, 0.2 ) ) * smoothstep( ${ f( BORE_FR_LO ) }, ${ f( BORE_FR_HI ) }, froude ) * ${ f( TRAIL_COVER ) };
	let lace = carried * ( ${ f( CARRIED_LACE ) } + ${ f( 1 - CARRIED_LACE ) } * max( streakV, smoothstep( 0.5, 1.0, carried ) ) ) * crest;
	let snout = smoothstep( 0.5, 2.5, speed ) * ( 1.0 - smoothstep( ${ f( SNOUT_DEPTH[ 0 ] ) }, ${ f( SNOUT_DEPTH[ 1 ] ) }, h ) ) * step( 0.002, h ) * smoothstep( ${ f( SNOUT_BED[ 0 ] ) }, ${ f( SNOUT_BED[ 1 ] ) }, bed ) * ${ f( SNOUT_COVER ) } * ( 0.6 + 0.4 * streakV );
	return clamp( max( max( max( face, trail ), snout ), lace ), 0.0, 1.0 );
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
const FLOOD_SNOUT_DEPTH_HI = ${ f( SNOUT_DEPTH[ 1 ] ) };
const FLOOD_COVER_SEA = vec2f( ${ f( COVER_SEA[ 0 ] ) }, ${ f( COVER_SEA[ 1 ] ) } );
const FLOOD_COVER_LAND = vec2f( ${ f( COVER_LAND[ 0 ] ) }, ${ f( COVER_LAND[ 1 ] ) } );
const FLOOD_COVER_BED = vec2f( ${ f( COVER_BED[ 0 ] ) }, ${ f( COVER_BED[ 1 ] ) } );
const FLOOD_DRAINED_BED = vec2f( ${ f( DRAINED_BED[ 0 ] ) }, ${ f( DRAINED_BED[ 1 ] ) } );
const FLOOD_FILM_FADE = ${ f( FILM_FADE ) };
const FLOOD_MATTE = ${ f( MATTE ) };
const FLOOD_FLECK_DARK = ${ f( FLECK_DARK ) };
const FLOOD_SILT = vec3f( ${ SILT.map( f ).join( ', ' ) } );
const FLOOD_SILT_COVER = ${ f( SILT_COVER ) };
// FloodLook.floodTurbulence
fn floodTurbulence( froude: f32, speed: f32, breaking: f32 ) -> f32 {
	return clamp( max( breaking, sqrt( smoothstep( ${ f( TURB_SPEED[ 0 ] ) }, ${ f( TURB_SPEED[ 1 ] ) }, speed ) * smoothstep( ${ f( TURB_FROUDE[ 0 ] ) }, ${ f( TURB_FROUDE[ 1 ] ) }, froude ) ) ), 0.0, 1.0 );
}
// FloodLook.sheetCap (open > 0)
fn floodSheetCap( hw: f32, open: f32 ) -> f32 {
	return hw * ${ f( TAPER ) } * ( 1.0 - smoothstep( ${ f( TAPER_OPEN ) }, ${ f( TAPER_END ) }, open ) ) / max( open, 0.05 );
}
// The dry corners' weight at p, pushed toward dry by the ground's small relief (FloodLook.js TAPER_ROUGH, TAPER_GRAIN)
fn floodSheetOpen( open: f32, p: vec2f ) -> f32 {
	return min( open + ( floodNoise( p * ${ f( 1 / TAPER_GRAIN[ 0 ] ) } ) * 0.6 + floodNoise( p * ${ f( 1 / TAPER_GRAIN[ 1 ] ) } + vec2f( 7.0, 3.0 ) ) * 0.4 ) * ${ f( TAPER_ROUGH ) }, 1.0 );
}
// Gradient noise with its analytic gradient, quintic fade: ( value, d/dx, d/dy ). One integer hash a corner, split
// into the gradient's two components (uniform in a square): this runs up to twelve times a flooded pixel.
fn floodHashG( ix: i32, iz: i32 ) -> vec2f {
	var h = ( bitcast<u32>( ix ) * 0x27d4eb2du ) ^ ( bitcast<u32>( iz ) * 0x165667b1u );
	h = ( h ^ ( h >> 15u ) ) * 0x2c1b3c6du;
	h = h ^ ( h >> 12u );
	return vec2f( f32( h & 0xffffu ), f32( h >> 16u ) ) * ( 1.0 / 32767.5 ) - 1.0;
}
fn floodNoiseD( q: vec2f ) -> vec3f {
	let i = floor( q );
	let t = q - i;
	let u = t * t * t * ( t * ( t * 6.0 - 15.0 ) + 10.0 );
	let du = 30.0 * t * t * ( t * ( t - 2.0 ) + 1.0 );
	let ix = i32( i.x );
	let iz = i32( i.y );
	let ga = floodHashG( ix, iz );
	let gb = floodHashG( ix + 1, iz );
	let gc = floodHashG( ix, iz + 1 );
	let gd = floodHashG( ix + 1, iz + 1 );
	let va = dot( ga, t );
	let vb = dot( gb, t - vec2f( 1.0, 0.0 ) );
	let vc = dot( gc, t - vec2f( 0.0, 1.0 ) );
	let vd = dot( gd, t - vec2f( 1.0, 1.0 ) );
	let k4 = va - vb - vc + vd;
	let g = ga + u.x * ( gb - ga ) + u.y * ( gc - ga ) + u.x * u.y * ( ga - gb - gc + gd ) + du * ( u.yx * k4 + vec2f( vb, vc ) - va );
	return vec3f( va + u.x * ( vb - va ) + u.y * ( vc - va ) + u.x * u.y * k4, g );
}
// The streak pattern's place, bent by RAFT_WARP m over RAFT_WARP_GRAIN m (FloodLook.js): the rafts' edges followed
// the pattern's own lattice, a staircase from the air where the flow runs along a sector's axis.
fn floodWarp( q: vec2f ) -> vec2f {
	let w = q * ${ f( 1 / RAFT_WARP_GRAIN ) };
	return q + ( vec2f( floodNoise( w + vec2f( 3.0, 7.0 ) ), floodNoise( w + vec2f( 41.0, 13.0 ) ) ) - 0.5 ) * ${ f( 2 * RAFT_WARP ) };
}
const FLOOD_RAFT_THIN = ${ f( RAFT_THIN ) };
// The flood's chop at p for flow (m/s), depth h (m) and a pixel footprint (m), at full turbulence: surface slopes
// (xy), the slope variance of the octaves a pixel cannot resolve (z), and the shade of its body (w): darker by its
// flotsam, darker or paler by the plumes of its load. FloodLook.js CHOP_*, FLECK_*, PLUME_*.
fn floodChop( p: vec2f, flow: vec2f, h: f32, footprint: f32, time: f32 ) -> vec4f {
	let rot = array<vec2f, ${ CHOP_OCTAVES }>( ${ Array.from( { length: CHOP_OCTAVES }, ( _, o ) => `vec2f( ${ f( Math.cos( o * 2.399 ) ) }, ${ f( Math.sin( o * 2.399 ) ) } )` ).join( ', ' ) } );
	let ph = fract( time / ${ f( CHOP_T ) } );
	let w1 = abs( 2.0 * ph - 1.0 );
	// (two uncorrelated phases blended lose variance mid-cycle: keep it constant)
	let norm = inverseSqrt( w1 * w1 + ( 1.0 - w1 ) * ( 1.0 - w1 ) );
	let pa = p - flow * ( ${ f( CHOP_T ) } * ph );
	let pb = p - flow * ( ${ f( CHOP_T ) } * fract( ph + 0.5 ) ) + vec2f( 37.0, 59.0 );
	let own = min( ${ f( CHOP_DEPTH ) } * max( h, 0.2 ), ${ f( CHOP_L0 * Math.pow( CHOP_STEP, CHOP_OCTAVES - 1 ) ) } );
	var sl = vec2f( 0.0 );
	var unres = 0.0;
	var lam = ${ f( CHOP_L0 ) };
	for ( var o = 0; o < ${ CHOP_OCTAVES }; o ++ ) {
		let w = max( clamp( 1.0 - abs( log2( lam / own ) ) * ${ f( 1 / ( Math.log2( CHOP_STEP ) * CHOP_SPAN ) ) }, 0.0, 1.0 ), select( 0.0, ${ f( CHOP_FINE ) }, lam < own ) );
		if ( w > 0.0 ) {
			let res = smoothstep( 1.0, 3.0, lam / footprint );
			let amp = ${ f( CHOP_SLOPE ) } * w;
			if ( res > 0.0 ) {
				let cs = rot[ o ];
				let drift = vec2f( time * ${ f( CHOP_DRIFT ) }, f32( o ) * 13.7 );
				let ga = floodNoiseD( vec2f( pa.x * cs.x + pa.y * cs.y, pa.y * cs.x - pa.x * cs.y ) / lam + drift ).yz;
				let gb = floodNoiseD( vec2f( pb.x * cs.x + pb.y * cs.y, pb.y * cs.x - pb.x * cs.y ) / lam + drift ).yz;
				let g = mix( ga, gb, w1 ) * norm;
				sl += vec2f( g.x * cs.x - g.y * cs.y, g.x * cs.y + g.y * cs.x ) * ( amp * res );
			}
			unres += amp * amp * ${ f( CHOP_VAR ) } * ( 1.0 - res * res );
		}
		lam *= ${ f( CHOP_STEP ) };
	}
	var fleck = 0.0;
	if ( footprint < ${ f( FLECK_PX ) } ) {
		let na = smoothstep( 0.76, 0.88, floodNoise( pa * ${ f( 1 / FLECK_SIZE ) } + vec2f( 11.0, 3.0 ) ) ) * smoothstep( 0.55, 0.72, floodNoise( pa * ${ f( 1 / FLECK_DRIFT ) } + vec2f( 5.0, 17.0 ) ) );
		let nb = smoothstep( 0.76, 0.88, floodNoise( pb * ${ f( 1 / FLECK_SIZE ) } + vec2f( 11.0, 3.0 ) ) ) * smoothstep( 0.55, 0.72, floodNoise( pb * ${ f( 1 / FLECK_DRIFT ) } + vec2f( 5.0, 17.0 ) ) );
		fleck = mix( na, nb, w1 ) * smoothstep( ${ f( FLECK_PX ) }, ${ f( FLECK_PX * 0.4 ) }, footprint );
	}
	// (the plumes of its load, FloodLook.js PLUME: about the noise's mean, the two phases kept at one contrast as the chop)
	let pla = floodNoise( pa * ${ f( 1 / PLUME_GRAIN[ 0 ] ) } ) * 0.6 + floodNoise( pa * ${ f( 1 / PLUME_GRAIN[ 1 ] ) } + vec2f( 3.0, 29.0 ) ) * 0.4;
	let plb = floodNoise( pb * ${ f( 1 / PLUME_GRAIN[ 0 ] ) } ) * 0.6 + floodNoise( pb * ${ f( 1 / PLUME_GRAIN[ 1 ] ) } + vec2f( 3.0, 29.0 ) ) * 0.4;
	let plume = clamp( ( mix( pla, plb, w1 ) - 0.5 ) * norm * ${ f( PLUME ) }, ${ f( - PLUME_MAX ) }, ${ f( PLUME_MAX ) } );
	return vec4f( sl, unres, fleck * ${ f( FLECK_DARK ) } - plume );
}
`;
