// The vertical velocity of the flood's surface, from the shallow-water grid the flood is solved on
// (docs/disasters.md, "Trees and floating debris").
//
// A floating body rides the surface, and the surface moves: it rises metres in a second as a bore arrives and falls
// as the flood drains back. The grid holds, per cell, the surface height eta (m), the depth h (m) and the
// depth-averaged velocity u (m/s): no vertical velocity. With drag toward a water velocity of zero in y, a floating
// tree could not follow a surface that dropped away under it and was left in the air (the 25 m flood, 3.2 s clear of
// the water while never thrown upward faster than 1 m/s).
//
// Following the water, the surface moves at its material rate, w = d(eta)/dt + u . grad(eta), and over a fixed bed
// continuity gives d(eta)/dt = -div(h u). So
//
//   w = -div(h u) + u . grad(eta)   (m/s, up)
//
// from one snapshot of the grid, with no history kept per body. Below the surface the vertical velocity of a
// depth-averaged flow falls linearly to zero at the bed; the caller scales by the height above the bed.
//
// The differences are taken across the four cells WaterGrid.sample reads at (x, z), weighted as the sampler weights
// them, so the rate is the derivative of the surface the bodies are floated on. A dry cell carries no flux and has
// no surface: its pixel holds the bed or sea level, not water, so a difference of eta across a wet and a dry cell is
// left out (at a front the rise comes from the flux that arrives, the first term).
//
// This is a property of the sampler and belongs in it: WaterGrid.sample can return it beside ux and uz from the
// same four cells, and Field.sample can then carry it (adding the far-field wall's own rate, which this leaves out).

const DRY = 0.002; // m: the depth under which the solver treats a cell as dry (WaterGrid.js)

// grid: a WaterGrid (pixels of [surface m, ux m/s, uz m/s, depth m] per cell, n cells a side of dx m from x, z).
// Returns 0 off the grid, where it is dry, and for a grid with no cells to read.
export function surfaceRate( grid, x, z ) {

	const P = grid?.pixels;
	if ( ! P ) return 0;
	const n = grid.n, dx = grid.dx, u = ( x - grid.x ) / dx, v = ( z - grid.z ) / dx;
	if ( ! ( u >= 0 && v >= 0 && u <= n - 1 && v <= n - 1 ) ) return 0;
	const i = Math.min( n - 2, Math.floor( u ) ), j = Math.min( n - 2, Math.floor( v ) ), fx = u - i, fz = v - j, tx = 1 - fx, tz = 1 - fz;
	// The sampler's four cells: a (i, j), b (i + 1, j), c (i, j + 1), d (i + 1, j + 1).
	const a = ( j * n + i ) * 4, b = a + 4, c = a + n * 4, d = c + 4;
	const ha = P[ a + 3 ], hb = P[ b + 3 ], hc = P[ c + 3 ], hd = P[ d + 3 ];
	const wa = ha > DRY, wb = hb > DRY, wc = hc > DRY, wd = hd > DRY;
	if ( ! ( wa || wb || wc || wd ) ) return 0;
	// div(h u): the flux leaving, per unit area (m/s).
	const divergence = ( ( hb * P[ b + 1 ] - ha * P[ a + 1 ] ) * tz + ( hd * P[ d + 1 ] - hc * P[ c + 1 ] ) * fz
		+ ( hc * P[ c + 2 ] - ha * P[ a + 2 ] ) * tx + ( hd * P[ d + 2 ] - hb * P[ b + 2 ] ) * fx ) / dx;
	// grad(eta) between wet cells, and u as the sampler interpolates it.
	const slopeX = ( ( wa && wb ? P[ b ] - P[ a ] : 0 ) * tz + ( wc && wd ? P[ d ] - P[ c ] : 0 ) * fz ) / dx;
	const slopeZ = ( ( wa && wc ? P[ c ] - P[ a ] : 0 ) * tx + ( wb && wd ? P[ d ] - P[ b ] : 0 ) * fx ) / dx;
	const ux = ( P[ a + 1 ] * tx + P[ b + 1 ] * fx ) * tz + ( P[ c + 1 ] * tx + P[ d + 1 ] * fx ) * fz;
	const uz = ( P[ a + 2 ] * tx + P[ b + 2 ] * fx ) * tz + ( P[ c + 2 ] * tx + P[ d + 2 ] * fx ) * fz;
	const rate = - divergence + ux * slopeX + uz * slopeZ;
	return Number.isFinite( rate ) ? rate : 0;

}
