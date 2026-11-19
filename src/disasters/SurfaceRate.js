// The vertical velocity of the flood's water, from the shallow-water grid the flood is solved on
// (docs/disasters.md, "Trees and floating debris"; docs/disaster-damage.md, "A structure breaks without throwing its
// pieces").
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
// from one snapshot of the grid, with no history kept per body.
//
// Read over the four cells around a point, that rate is the mesh's, not the water's. The solver holds a bore as a
// shock two or three cells wide (8 m cells on the island, WaterGrid.js), and the face of a 10 m or a 25 m wave rose
// there at 10 to 31 m/s. Drag carried a piece up at that rate, the rate fell faster than drag could slow it, and the
// piece left the water ballistic (an 80 kg masonry part, 2.45 m above the water in a 25 m flood). Real water rises over
// the length of the jump: about six times the depth behind it for Froude numbers 4.5 to 13, and four to five and a half
// times for weaker jumps (Peterka 1958, USBR Engineering Monograph 25; Chow 1959, Open-Channel Hydraulics, chapter 15).
// A moving bore is a jump in its own frame, so the same lengths hold. So the rate is averaged across the front, along
// the surface's slope, over L = 6 y2 and at least two cells, y2 the depth behind the front. Not along the flow: its
// direction is undefined where water piles against a hill or a wall. Not along the body's own velocity: tried, it threw
// more. The average of a derivative over a segment is the difference of its ends over the length:
//
//   w = -( q_n( +L/2 ) - q_n( -L/2 ) ) / L + u_n ( eta( +L/2 ) - eta( -L/2 ) ) / L
//
// with n along the slope and q = h u. Integrated over the front's passage it still gives the surface's whole rise;
// only its peak is lowered. Nothing is read across the slope: a difference across it at the grid's spacing cuts the
// shock wherever the front is oblique to the slope read, and brings the mesh's rate back. A dry end carries no flux and
// no surface, so a difference of eta across it is left out, as across a wet and a dry cell (at a front onto dry ground
// the rise comes from the flux that arrives, the first term). An end off the grid reads the point itself.
//
// Below the surface the vertical velocity of a depth-averaged flow falls to zero at the bed; the caller scales by the
// height above the bed (RigidLoads.js). Blending instead from the bed's own rate, u . grad( b ), at the bed (exact
// kinematics for a flow that follows its bed) was tried on the island and threw more: with the bed's gradient read over
// one 8 m cell, a harbour wall or a terrace under a 20 m/s flow carried a wall part up at 20 m/s; read over the same
// span as the surface, it still raised the pieces led clear by the water from 4 to 7 in the 10 m wave and the 25 m wave
// each (free climbs over 0.5 m: 3 to 9 at 10 m). The depth-averaged bed under a body is the solver's 8 m one, not the
// ground the body rests on.

const DRY = 0.002; // m: the depth under which the solver treats a cell as dry (WaterGrid.js)
const JUMP = 6; // the length of a hydraulic jump over the depth behind it (Peterka 1958; Chow 1959, ch. 15)
const LEAST = 2; // cells: the shortest span averaged over, the width the solver holds a shock in
const BEHIND = 400; // m: how far up the slope the top of a front is looked for
// The least surface slope that names a direction (1 mm per m); flatter, a wider span is read. Spans in cells, nearest
// first: a body still ahead of a front reads the front's direction from up to 16 cells (128 m) off.
const LEVEL = 1e-3;
const SPANS = [ 1, 4, 16 ];
// Where the surface rises up the slope more steeply than this, a front begins (1 cm per m). A long wave's surface
// slopes about 1 mm per m; a bore's face, held in two or three cells, 0.1 to 0.5.
const STEEP = 0.01;
// The top of the front: where a cell's rise falls under this share of the steepest cell's.
const TOP = 0.1;

const c = {}, e = {}, f = {}; // scratch reads

// Bilinear read of the grid's pixels at (x, z), weighted as WaterGrid.sample weights them: eta (m, over the wet cells
// only), h (m), qx, qz (m²/s), ux, uz (m/s); wet when a cell of the four is; on when (x, z) is on the grid.
function read( grid, x, z, o ) {

	const P = grid.pixels, n = grid.n, dx = grid.dx, u = ( x - grid.x ) / dx, v = ( z - grid.z ) / dx;
	o.eta = o.h = o.qx = o.qz = o.ux = o.uz = 0;
	o.wet = false;
	o.on = u >= 0 && v >= 0 && u <= n - 1 && v <= n - 1;
	if ( ! o.on ) return o;
	const i = Math.min( n - 2, Math.floor( u ) ), j = Math.min( n - 2, Math.floor( v ) ), fx = u - i, fz = v - j;
	let weight = 0;
	for ( let k = 0; k < 4; k ++ ) {

		const p = ( ( j + ( k >> 1 ) ) * n + i + ( k & 1 ) ) * 4, w = ( k & 1 ? fx : 1 - fx ) * ( k >> 1 ? fz : 1 - fz ), h = P[ p + 3 ];
		o.h += w * h;
		o.ux += w * P[ p + 1 ];
		o.uz += w * P[ p + 2 ];
		o.qx += w * h * P[ p + 1 ];
		o.qz += w * h * P[ p + 2 ];
		if ( h > DRY ) {

			o.eta += w * P[ p ];
			weight += w;

		}

	}
	if ( weight > 0 ) {

		o.eta /= weight;
		o.wet = true;

	}
	return o;

}

// The surface's slope (m per m) along (ax, az) over a half span of r m, from the wet ends only.
function slopeAlong( grid, x, z, r, ax, az ) {

	let sum = 0, halves = 0;
	read( grid, x + ax * r, z + az * r, e );
	if ( e.wet ) { sum += ( e.eta - c.eta ) / r; halves ++; }
	read( grid, x - ax * r, z - az * r, e );
	if ( e.wet ) { sum += ( c.eta - e.eta ) / r; halves ++; }
	return halves ? sum / halves : 0;

}

// The depth behind the front (m): up the slope (nx, nz) a cell at a time from (x, z). A front begins where the surface
// rises more steeply than STEEP and ends where a cell's rise falls under TOP of the steepest; the depth there is the
// depth behind. A front farther off than half the span its depth gives (3 y2) is not one the point lies across, and a
// point with none in reach is behind its front or under none: its own depth is the depth behind.
function depthBehind( grid, x, z, nx, nz ) {

	const P = grid.pixels, n = grid.n, dx = grid.dx;
	let eta = c.eta, start = - 1, steepest = 0, top = c.h;
	for ( let d = dx; d <= BEHIND; d += dx ) {

		const i = Math.round( ( x + nx * d - grid.x ) / dx ), j = Math.round( ( z + nz * d - grid.z ) / dx );
		if ( i < 0 || j < 0 || i >= n || j >= n ) break;
		const p = ( j * n + i ) * 4, h = P[ p + 3 ];
		if ( h <= DRY ) break;
		const rise = P[ p ] - eta;
		eta = P[ p ];
		if ( start < 0 ) {

			if ( rise > STEEP * dx ) { start = d - dx; steepest = rise; top = h; }
			continue;

		}
		if ( rise < TOP * steepest ) break;
		steepest = Math.max( steepest, rise );
		top = h;

	}
	return start >= 0 && start <= 3 * top ? Math.max( c.h, top ) : c.h;

}

// The water's rate at (x, z), into out: rate (m/s, up), the surface's material rate averaged across the front;
// length (m), the span averaged over;
// behind (m), the depth behind the front. All zero off the grid, where it is dry, or for a grid with no cells to read.
export function frontRate( grid, x, z, out ) {

	out.rate = out.length = out.behind = 0;
	if ( ! grid?.pixels ) return out;
	read( grid, x, z, c );
	if ( ! c.wet ) return out;
	const dx = grid.dx;
	// The slope's direction, up the surface: from the nearest span that shows one, else up the flow, else x.
	let nx = 0, nz = 0;
	for ( let s = 0; s < SPANS.length; s ++ ) {

		const r = SPANS[ s ] * dx, gx = slopeAlong( grid, x, z, r, 1, 0 ), gz = slopeAlong( grid, x, z, r, 0, 1 ), g = Math.hypot( gx, gz );
		if ( g > LEVEL ) { nx = gx / g; nz = gz / g; break; }

	}
	if ( nx === 0 && nz === 0 ) {

		const speed = Math.hypot( c.ux, c.uz );
		if ( speed > 0 ) { nx = - c.ux / speed; nz = - c.uz / speed; } else nx = 1;

	}
	const behind = depthBehind( grid, x, z, nx, nz ), L = Math.max( JUMP * behind, LEAST * dx );
	// Along the slope, over L.
	let qPlus, etaPlus, qMinus, etaMinus;
	read( grid, x + nx * L / 2, z + nz * L / 2, e );
	if ( e.on ) { qPlus = e.qx * nx + e.qz * nz; etaPlus = e.wet ? e.eta : c.eta; } else { qPlus = c.qx * nx + c.qz * nz; etaPlus = c.eta; }
	read( grid, x - nx * L / 2, z - nz * L / 2, f );
	if ( f.on ) { qMinus = f.qx * nx + f.qz * nz; etaMinus = f.wet ? f.eta : c.eta; } else { qMinus = c.qx * nx + c.qz * nz; etaMinus = c.eta; }
	const rate = - ( qPlus - qMinus ) / L + ( c.ux * nx + c.uz * nz ) * ( etaPlus - etaMinus ) / L;
	out.rate = Number.isFinite( rate ) ? rate : 0;
	out.length = L;
	out.behind = behind;
	return out;

}
