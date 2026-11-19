import { Vector3 } from '../engine/index.js';

// A loose building part's collision box, trimmed so it starts clear of what stands beside it.
//
// A part's box is the oriented bounding box of its spans (MaterialMembers.memberFrame): a wall group, a roof's rafters
// and battens, a window and its frame. Those boxes overlap where the parts met in the building (corners, eaves, the
// sheets on the rafters), by up to 2 m for a rafter truss or a wall that wraps a corner (three houses by the pier,
// measured at spawn). The solver then pushed overlapping parts apart: with no wind and no water at all, parts left
// their houses at up to 14 m/s, and in the 25 m tsunami a wall left the water at 18 m/s and flew 6 m above it. A part
// torn off a building is beside its neighbours, not inside them, so the box is trimmed on the side that overlaps,
// along its own axis nearest the separating direction, until it is clear. Only the collider changes: the part is
// drawn whole from its spans (Structures.drawSpans), and its mass stays the part's (ColliderDensity in props.rs).
//
// Boxes are { center: Vector3, quaternion, half: Vector3 } in metres. Runs once per spawned part, never per frame.

// m: no trim takes a box under 10 cm thick. A 298 kg wall shrunk to a 4 cm plate between falling parts was squeezed out
// and rose 5.2 m with no load at all (test/flood-debris.mjs): a thin heavy box is a solver hazard, a small overlap is not.
export const MIN_HALF = .05;
// The shrink about the centre stops at half the part's size: past that the collider no longer stands for the part.
const MIN_SCALE = .5;
const SKIN = .01; // m left between a trimmed box and its neighbour, so the first contact is a touch, not an overlap

function axesOf( q ) {

	return [ new Vector3( 1, 0, 0 ).applyQuaternion( q ), new Vector3( 0, 1, 0 ).applyQuaternion( q ), new Vector3( 0, 0, 1 ).applyQuaternion( q ) ];

}

// Depth (m) and direction of the smallest overlap of two oriented boxes over the 15 separating axes; depth <= 0 when apart.
export function boxOverlap( a, b ) {

	const A = axesOf( a.quaternion ), B = axesOf( b.quaternion ), d = b.center.clone().sub( a.center );
	const ha = [ a.half.x, a.half.y, a.half.z ], hb = [ b.half.x, b.half.y, b.half.z ];
	let depth = Infinity, axis = null;
	const test = n => {

		const l = n.length();
		if ( l < 1e-6 ) return;
		n.multiplyScalar( 1 / l );
		const ra = ha[ 0 ] * Math.abs( A[ 0 ].dot( n ) ) + ha[ 1 ] * Math.abs( A[ 1 ].dot( n ) ) + ha[ 2 ] * Math.abs( A[ 2 ].dot( n ) );
		const rb = hb[ 0 ] * Math.abs( B[ 0 ].dot( n ) ) + hb[ 1 ] * Math.abs( B[ 1 ].dot( n ) ) + hb[ 2 ] * Math.abs( B[ 2 ].dot( n ) );
		const o = ra + rb - Math.abs( d.dot( n ) );
		if ( o < depth ) { depth = o; axis = d.dot( n ) < 0 ? n.negate() : n; }

	};
	for ( const n of A ) test( n.clone() );
	for ( const n of B ) test( n.clone() );
	for ( const x of A ) for ( const y of B ) test( x.clone().cross( y ) );
	return { depth, axis }; // axis points from a toward b

}

// Trim box (center and half are changed in place) until it overlaps none of `others`, a few passes at most. Each
// overlap is removed from the side facing the neighbour, along the box's own axis most aligned with the separating
// direction; an axis that would go under MIN_HALF passes the cut to the next. What the trims leave, a shrink about the
// centre clears, down to half its size. Returns the overlap left (m): 0 when clear.
export function clearOf( box, others, passes = 4 ) {

	const axes = axesOf( box.quaternion ), half = box.half;
	let left = 0;
	for ( let pass = 0; pass < passes; pass ++ ) {

		left = 0;
		for ( const other of others ) {

			const { depth, axis } = boxOverlap( box, other );
			if ( ! ( depth > 0 ) ) continue;
			const order = [ 0, 1, 2 ].sort( ( i, j ) => Math.abs( axes[ j ].dot( axis ) ) - Math.abs( axes[ i ].dot( axis ) ) );
			let cut = false;
			for ( const i of order ) {

				const c = Math.abs( axes[ i ].dot( axis ) );
				if ( c < .2 ) break;
				const trim = ( depth + SKIN ) / c, h = half.getComponent( i );
				if ( h - trim / 2 < MIN_HALF ) continue;
				// The far face stays where it was; the face toward the neighbour moves back by trim.
				half.setComponent( i, h - trim / 2 );
				box.center.addScaledVector( axes[ i ], - Math.sign( axes[ i ].dot( axis ) ) * trim / 2 );
				cut = true;
				break;

			}
			if ( ! cut ) left = Math.max( left, depth );

		}
		if ( ! left && others.every( o => ! ( boxOverlap( box, o ).depth > 0 ) ) ) return 0;

	}
	// A trim along the box's own axes cannot always remove an overlap across an edge (a separating direction between
	// its axes): the box then shrinks about its centre, as little as clears it (bisection, to 1% of its size).
	const worst = () => others.reduce( ( w, o ) => Math.max( w, boxOverlap( box, o ).depth ), 0 );
	if ( ! ( worst() > 0 ) ) return 0;
	const full = half.clone(), keep = ( h, k ) => Math.max( Math.min( h, MIN_HALF ), h * k );
	let lo = MIN_SCALE, hi = 1;
	const fit = k => { half.set( keep( full.x, k ), keep( full.y, k ), keep( full.z, k ) ); return ! ( worst() > 0 ); };
	if ( ! fit( lo ) ) return worst(); // still overlapping at half size: the overlap left is small next to the part
	for ( let i = 0; i < 7; i ++ ) { const mid = ( lo + hi ) / 2; if ( fit( mid ) ) lo = mid; else hi = mid; }
	fit( lo );
	return 0;

}
