import { BufferAttribute } from '../geometry/BufferAttribute.js';
import { StorageBuffer } from '../gpu/Texture.js';
import { ShaderModule } from '../gpu/Shader.js';
import { GPU } from '../gpu/GPU.js';
import { Matrix4 } from '../math/index.js';

// Loose pieces of shared batches drawn by the GPU: a broken building's walls and roof, a pier's
// deck members, an imported terminal's fragments, a prop that a flood carries off.
//
// A piece's vertices stay at rest in its batch. Each vertex carries a `piece` attribute (uint32 x 2):
// x is the slot of its piece (0: no piece, drawn as it is in the buffer), y the blend weight toward
// slot x + 1 as f32 bits (a jointed member's span blends its two section frames, MemberSkin.js;
// rigid pieces weigh 0). The weight's sign bit asks for the blended normal to be renormalised, as
// the member skin always did. Slots are written into a span's vertices once, the first time it moves.
//
// A slot is one rigid transform, rest -> drawn, in the geometry's own frame: this frame's and the
// last drawn frame's, as 3x4 rows (6 x vec4f, 96 bytes) in one storage buffer. The vertex stage of
// every pass that draws the batch reads it (MeshShader.js, HAS_PIECE): the main pass, the depth and
// shadow cascades, the refraction and colour passes, and the motion vectors of the temporal pass
// (this frame's transform against the last drawn one). The material vertex hooks see the moved
// position and normal, as they saw the CPU-written ones.
//
// It replaced a CPU rewrite of every vertex and normal of a moved piece, plus the previous positions
// for the motion vectors, uploaded every frame it moved (Structures.drawSpans, MemberSkin.drawMember,
// Props.draw): in a 10 m tsunami flood about 16 ms of the main thread a frame. A frame now uploads
// 96 bytes per moved slot (docs/render-performance.md, "Loose pieces drawn by the GPU").
//
// Frames: a span's frame (an imported mesh's world matrix) is rigid. The imported terminals' frames
// have scale 1 to 4e-15, so a slot's 3x3 is a rotation and turns normals as the CPU's normal matrix
// did. A scaled frame would need the cofactor of the 3x3 for its normals.
//
// Once per rendered frame: uploadPieces() before the frame's commands run (a GPU.onSubmit hook from
// MeshRenderer), commitPieces() after the submission (GeometryMotion.commitGeometryMotion): this
// frame's transforms become the last drawn ones, so a piece that stopped writes no motion next frame.

const ROWS = 6; // vec4f per slot: three rows of this frame's transform, three of the last drawn frame's
const FLOATS = ROWS * 4;
const BYTES = FLOATS * 4; // 96 bytes per slot
const NORMALISE = 0x80000000; // weight sign bit: renormalise the normal after the blend
const MERGE_GAP = 8; // slots: unchanged slots sent with their neighbours rather than a write per run
const IDENTITY = [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0 ];
const _w = new Float32Array( 1 ), _bits = new Uint32Array( _w.buffer );
const _framed = new Matrix4();
const _rows = new Float32Array( 12 );

// position attribute -> piece attribute. The village draws one batch through several material views:
// separate BufferGeometry objects sharing one position attribute (GeometryMotion.js keeps the previous
// positions the same way), so every view draws the same pieces.
const attributes = new WeakMap();

const P = {
	capacity: 0,
	used: 1, // slot 0 is no piece
	data: null, // Float32Array: FLOATS per slot, the CPU copy of the storage buffer
	buffer: null, // StorageBuffer: array<vec4f>
	owner: [], // slot -> piece attribute of the batch whose vertices name it
	claim: [], // first slot -> { attr, start, count, slot, width } of the span that holds it
	free: [ null, [], [] ], // by width: released first slots, taken before new ones
	releasing: null, // Uint8Array: restored, handed back at the next commit unless claimed again
	releaseList: [],
	reserved: 0, // slots reserved at load for the spans saved then
	moved: null, // Uint8Array: set since the last commit
	movedList: null, // Uint32Array: those slots
	movedCount: 0,
	dirty: null, // Uint8Array: to upload
	lo: Infinity, hi: - 1, // dirty slot range
	away: null, // Uint8Array: this frame's transform is not the identity
};

function grow( need ) {

	const capacity = Math.max( 1024, P.capacity * 2, need );
	const data = new Float32Array( capacity * FLOATS );
	if ( P.data ) data.set( P.data );
	else {

		data.set( IDENTITY, 0 );
		data.set( IDENTITY, 12 );

	}

	const keep = ( a, Type = Uint8Array ) => {

		const b = new Type( capacity );
		if ( a ) b.set( a );
		return b;

	};
	P.releasing = keep( P.releasing );
	P.moved = keep( P.moved );
	P.dirty = keep( P.dirty );
	P.away = keep( P.away );
	P.movedList = keep( P.movedList, Uint32Array );
	P.data = data;
	P.capacity = capacity;
	const old = P.buffer;
	// a new buffer object: every bind group that reads it is rebuilt (BindingSet compares the resource)
	P.buffer = new StorageBuffer( { label: 'piece transforms', count: capacity * ROWS, type: 'vec4f', data: old ? null : data } );
	if ( old ) {

		markRange( 0, P.used - 1 );
		if ( GPU.onSubmit ) GPU.onSubmit( null, () => old.destroy() );

	}

}

function markRange( lo, hi ) {

	for ( let s = lo; s <= hi; s ++ ) P.dirty[ s ] = 1;
	if ( lo < P.lo ) P.lo = lo;
	if ( hi > P.hi ) P.hi = hi;

}

function mark( slot ) {

	P.dirty[ slot ] = 1;
	if ( slot < P.lo ) P.lo = slot;
	if ( slot > P.hi ) P.hi = slot;

}

function isIdentity( d, o ) {

	for ( let k = 0; k < 12; k ++ ) if ( d[ o + k ] !== IDENTITY[ k ] ) return false;
	return true;

}

// The batch's piece attribute, made on first use (at load, from saveSpan) so that every pipeline
// that draws the batch is compiled with it behind the loading screen: adding it later would change
// the vertex layout, and the batch would vanish for the frames its new pipelines took to compile.
export function pieceAttribute( geometry ) {

	const position = geometry.getAttribute( 'position' );
	let attr = attributes.get( position );
	if ( ! attr ) {

		attr = geometry.getAttribute( 'piece' );
		if ( ! attr ) attr = new BufferAttribute( new Uint32Array( position.count * 2 ), 2 );
		attr.pieceRanges = new Map(); // first vertex -> { count, slot, width } of a span that moved
		attr.pieceMotion = 0; // changes whenever a piece of the batch is drawn somewhere new
		attr.piecesAway = 0; // slots of the batch drawn away from rest this frame
		attributes.set( position, attr );
		if ( ! P.buffer ) grow( 1 );

	}

	if ( geometry.getAttribute( 'piece' ) !== attr ) geometry.setAttribute( 'piece', attr );
	return attr;

}

// A material view of a batch takes the batch's piece attribute (MeshRenderer._cachedLayout).
export function inheritPieces( geometry ) {

	const position = geometry.attributes.position;
	const attr = position && attributes.get( position );
	if ( attr && geometry.attributes.piece !== attr ) geometry.setAttribute( 'piece', attr );
	return attr;

}

// A number that changes whenever a piece of the geometry's batch is drawn somewhere new: cached
// shadow depth of the batch is stale (ShadowCasters.js), as it was when its vertices were rewritten.
export function pieceMotionOf( geometry ) {

	const position = geometry.attributes.position;
	const attr = position && attributes.get( position );
	return attr ? attr.pieceMotion : 0;

}

// True while a piece of the batch is drawn away from its rest pose: the batch's rest bounds do not
// hold it (the refraction pass draws such a batch whole, RefractionPass._filter).
export function piecesAway( geometry ) {

	const position = geometry.attributes.position;
	const attr = position && attributes.get( position );
	return attr ? attr.piecesAway > 0 : false;

}

function writeSlots( attr, start, count, slot, weight ) {

	const a = attr.array;
	for ( let i = start * 2, end = ( start + count ) * 2; i < end; i += 2 ) {

		a[ i ] = slot;
		a[ i + 1 ] = weight;

	}

	attr.addUpdateRange( start * 2, count * 2 );
	attr.needsUpdate = true;

}

// The first slot of a span's vertex range (a span: { geo, start, count }), claimed and written into
// its vertices the first time it moves. width 2: a member span, its two section frames in two
// consecutive slots. normalise: the drawn normal is renormalised (a span with a frame: its saved rest
// normals were the frame's, renormalised, and the imported fragments' clipped vertices carry shorter
// interpolated normals). A claim lasts until a Restore hands it back (restorePieces, then the next
// commit clears the vertices' slots, so a restored batch is drawn, and costs, as at load). A new
// claim over vertices another span holds (a later event that cut the building differently) first
// clears that span's vertices and hands its slots back, so a slot only ever names one span.
export function pieceSlot( span, width = 1, normalise = width === 2 ) {

	const attr = pieceAttribute( span.geo );
	const ranges = attr.pieceRanges;
	const known = ranges.get( span.start );
	if ( known && known.count === span.count && known.width === width && known.normalise === normalise ) {

		P.releasing[ known.slot ] = 0;
		return known.slot;

	}

	for ( const r of ranges.values() ) if ( r.start < span.start + span.count && span.start < r.start + r.count ) release( r );
	let slot = P.free[ width ].pop();
	if ( slot === undefined ) {

		if ( P.used + width > P.capacity ) grow( P.used + width );
		slot = P.used;
		P.used += width;
		P.reserved = Math.max( 0, P.reserved - width );

	}

	for ( let k = 0; k < width; k ++ ) {

		P.data.set( IDENTITY, ( slot + k ) * FLOATS );
		P.data.set( IDENTITY, ( slot + k ) * FLOATS + 12 );
		P.owner[ slot + k ] = attr;
		mark( slot + k );

	}

	const claim = { attr, start: span.start, count: span.count, slot, width, normalise };
	P.claim[ slot ] = claim;
	ranges.set( span.start, claim );
	writeSlots( attr, span.start, span.count, slot, normalise ? NORMALISE : 0 );
	return slot;

}

// Clear a claim's vertices (those still naming its slot) and hand its slots back.
function release( claim ) {

	const { attr, start, count, slot, width } = claim;
	const a = attr.array;
	let first = - 1, last = - 1;
	for ( let i = start * 2, end = ( start + count ) * 2; i < end; i += 2 ) if ( a[ i ] === slot ) {

		a[ i ] = 0;
		a[ i + 1 ] = 0;
		if ( first < 0 ) first = i;
		last = i;

	}

	if ( first >= 0 ) {

		attr.addUpdateRange( first, last + 2 - first );
		attr.needsUpdate = true;

	}

	for ( let k = 0; k < width; k ++ ) {

		if ( P.away[ slot + k ] ) {

			attr.piecesAway --;
			P.away[ slot + k ] = 0;

		}

		P.owner[ slot + k ] = null;

	}

	attr.pieceMotion ++;
	attr.pieceRanges.delete( start );
	P.claim[ slot ] = null;
	P.releasing[ slot ] = 0;
	P.free[ width ].push( slot );

}

// The kind of blend weights a claim's vertices hold (setPieceWeights): undefined for a new claim, so a
// span claimed again after a Restore writes its weights again even when it gets the same slot back.
export function pieceWeightKind( slot ) {

	return P.claim[ slot ]?.weightKind;

}

// Per-vertex blend weights of a member span toward its second slot: weight( i ) for vertex i of the
// span, in [ 0, 1 ]. Written when the member's skin changes kind (bending to severed), not per frame.
export function setPieceWeights( span, slot, weight, kind ) {

	const attr = pieceAttribute( span.geo );
	const a = attr.array;
	for ( let i = 0; i < span.count; i ++ ) {

		_w[ 0 ] = weight( i );
		const o = ( span.start + i ) * 2;
		a[ o ] = slot;
		a[ o + 1 ] = ( _bits[ 0 ] & 0x7fffffff ) | NORMALISE;

	}

	attr.addUpdateRange( span.start * 2, span.count * 2 );
	attr.needsUpdate = true;
	if ( P.claim[ slot ] ) P.claim[ slot ].weightKind = kind;

}

// Room for the slots of spans saved at load (saveSpan: two each, a member span's pair), so the
// storage buffer is sized before the first event and does not grow during one (a growth is a new
// buffer, a re-upload of every slot in use and a rebuild of every bind group that reads it). On the
// island (the village, its props and both terminals) 8566 saved spans reserve 17132 slots: a buffer
// of 32768 slots, 3.0 MB on the GPU and 3.3 MB of CPU copy and flags. Every record broken at once
// claims 8481. A sectioned deck span claims a pair for each 3 m deck module it crosses, so this is a
// measured bound, not a proof: a span that claims more only costs a growth.
export function reservePieces( slots ) {

	P.reserved += slots;
	if ( P.used + P.reserved > P.capacity ) grow( P.used + P.reserved );

}

// This frame's transform of a slot: matrix (Matrix4, rest -> drawn, world), and for a span with a
// frame, inverse * matrix * frame (its geometry's own frame).
export function setPieceTransform( slot, matrix, inverse = null, frame = null ) {

	const e = inverse ? _framed.multiplyMatrices( inverse, matrix ).multiply( frame ).elements : matrix.elements;
	const r = _rows;
	r[ 0 ] = e[ 0 ]; r[ 1 ] = e[ 4 ]; r[ 2 ] = e[ 8 ]; r[ 3 ] = e[ 12 ];
	r[ 4 ] = e[ 1 ]; r[ 5 ] = e[ 5 ]; r[ 6 ] = e[ 9 ]; r[ 7 ] = e[ 13 ];
	r[ 8 ] = e[ 2 ]; r[ 9 ] = e[ 6 ]; r[ 10 ] = e[ 10 ]; r[ 11 ] = e[ 14 ];
	// compared in float32, as the GPU reads it: a pose that rounds to the drawn one costs nothing
	const d = P.data, o = slot * FLOATS;
	let same = true;
	for ( let k = 0; k < 12; k ++ ) if ( d[ o + k ] !== r[ k ] ) {

		same = false;
		break;

	}

	if ( same ) return;
	d.set( r, o );
	moved( slot, d, o );

}

function moved( slot, d, o ) {

	const attr = P.owner[ slot ];
	const away = isIdentity( d, o ) ? 0 : 1;
	if ( away !== P.away[ slot ] ) {

		attr.piecesAway += away ? 1 : - 1;
		P.away[ slot ] = away;

	}

	attr.pieceMotion ++;
	if ( ! P.moved[ slot ] ) {

		P.moved[ slot ] = 1;
		P.movedList[ P.movedCount ++ ] = slot;

	}

	mark( slot );

}

// Restore: every piece whose vertices lie in [ start, start + count ) of the geometry is drawn at
// rest from this frame. The last drawn pose is kept for one frame, so the jump back writes its motion
// as the CPU rewrite did; the next commit settles it and hands the slots back.
export function restorePieces( geometry, start, count ) {

	const position = geometry.attributes.position;
	const attr = position && attributes.get( position );
	if ( ! attr ) return;
	const a = attr.array, d = P.data;
	let last = 0;
	for ( let i = start * 2, end = ( start + count ) * 2; i < end; i += 2 ) {

		const slot = a[ i ];
		if ( slot === 0 || slot === last ) continue;
		last = slot;
		const claim = P.claim[ slot ];
		if ( ! claim ) continue;
		for ( let k = 0; k < claim.width; k ++ ) {

			const o = ( slot + k ) * FLOATS;
			if ( isIdentity( d, o ) ) continue;
			d.set( IDENTITY, o );
			moved( slot + k, d, o );

		}

		if ( ! P.releasing[ slot ] ) {

			P.releasing[ slot ] = 1;
			P.releaseList.push( claim );

		}

	}

}

// Before the frame's commands run (GPU.onSubmit): the slots set or settled since the last upload.
export function uploadPieces() {

	if ( P.hi < P.lo || ! P.buffer ) return;
	const gpu = P.buffer.getGPU(), dirty = P.dirty, hi = P.hi;
	let s = P.lo;
	while ( s <= hi ) {

		if ( ! dirty[ s ] ) {

			s ++;
			continue;

		}

		let e = s, gap = 0;
		for ( let k = s + 1; k <= hi; k ++ ) {

			if ( dirty[ k ] ) {

				e = k;
				gap = 0;

			} else if ( ++ gap > MERGE_GAP ) break;

		}

		GPU.queue.writeBuffer( gpu, s * BYTES, P.data.buffer, s * BYTES, ( e - s + 1 ) * BYTES );
		dirty.fill( 0, s, e + 1 );
		s = e + 1;

	}

	P.lo = Infinity;
	P.hi = - 1;

}

// After the frame's submission: this frame's transforms become the last drawn ones. A slot that
// does not move next frame then draws no motion; one that does keeps this frame's pose as its last.
export function commitPieces() {

	const d = P.data, list = P.movedList;
	for ( let i = 0; i < P.movedCount; i ++ ) {

		const slot = list[ i ], o = slot * FLOATS;
		d.copyWithin( o + 12, o, o + 12 );
		P.moved[ slot ] = 0;
		mark( slot );

	}

	P.movedCount = 0;
	// restored pieces whose jump back has been drawn: their vertices are drawn as at load again
	for ( const claim of P.releaseList ) if ( P.releasing[ claim.slot ] && P.claim[ claim.slot ] === claim ) release( claim );
	P.releaseList.length = 0;

}

// Where the vertex stage draws a vertex of a geometry (the CPU mirror of piecePose below): this
// frame's position, or the last drawn frame's (previous = true), and the normal. out: { x, y, z }.
export function drawnPosition( geometry, vertex, out, previous = false ) {

	return pose( geometry, vertex, out, previous, false );

}

export function drawnNormal( geometry, vertex, out ) {

	return pose( geometry, vertex, out, false, true );

}

function pose( geometry, vertex, out, previous, normal ) {

	const src = geometry.getAttribute( normal ? 'normal' : 'position' );
	const x = src.getX( vertex ), y = src.getY( vertex ), z = src.getZ( vertex );
	const piece = attributes.get( geometry.attributes.position ) || geometry.getAttribute( 'piece' );
	const slot = piece ? piece.array[ vertex * 2 ] : 0;
	if ( slot === 0 ) {

		out.x = x; out.y = y; out.z = z;
		return out;

	}

	_bits[ 0 ] = piece.array[ vertex * 2 + 1 ] & 0x7fffffff;
	const t = _w[ 0 ], renormalise = ( piece.array[ vertex * 2 + 1 ] & NORMALISE ) !== 0;
	const w = normal ? 0 : 1, rows = previous ? 12 : 0, d = P.data;
	const apply = ( s, k ) => {

		const o = s * FLOATS + rows + k * 4;
		return d[ o ] * x + d[ o + 1 ] * y + d[ o + 2 ] * z + d[ o + 3 ] * w;

	};
	let px = apply( slot, 0 ), py = apply( slot, 1 ), pz = apply( slot, 2 );
	if ( t !== 0 ) {

		px += ( apply( slot + 1, 0 ) - px ) * t;
		py += ( apply( slot + 1, 1 ) - py ) * t;
		pz += ( apply( slot + 1, 2 ) - pz ) * t;

	}

	if ( normal && renormalise ) {

		const inv = 1 / ( Math.hypot( px, py, pz ) || 1 );
		px *= inv; py *= inv; pz *= inv;

	}

	out.x = px; out.y = py; out.z = pz;
	return out;

}

// Test and tool access to the CPU copy (slot rows) and the upload state.
export function pieceState() {

	return P;

}

// The vertex stage's pose of a vertex of a piece (MeshShader.js, HAS_PIECE). Rows: slot * 6 + 0..2
// this frame, + 3..5 the last drawn frame. The blend is written as the member skin wrote it,
// a + ( b - a ) * t, and the normal renormalised as it was (a zero normal stays zero).
export const pieceModule = new ShaderModule( {
	name: 'pieceMotion',
	bindings: {
		pieceRows: { storage: () => P.buffer, access: 'read', wgslType: 'array<vec4f>' },
	},
	code: /* wgsl */`
fn piecePoint( slot: u32, rows: u32, p: vec3f ) -> vec3f {
	let i = slot * 6u + rows;
	let h = vec4f( p, 1.0 );
	return vec3f( dot( pieceRows[ i ], h ), dot( pieceRows[ i + 1u ], h ), dot( pieceRows[ i + 2u ], h ) );
}
fn pieceVector( slot: u32, rows: u32, n: vec3f ) -> vec3f {
	let i = slot * 6u + rows;
	return vec3f( dot( pieceRows[ i ].xyz, n ), dot( pieceRows[ i + 1u ].xyz, n ), dot( pieceRows[ i + 2u ].xyz, n ) );
}
struct PiecePose {
	position: vec3f,
	normal: vec3f,
	previous: vec3f,
};
fn piecePose( piece: vec2u, p: vec3f, n: vec3f ) -> PiecePose {
	var o: PiecePose;
	let t = bitcast<f32>( piece.y & 0x7fffffffu );
	o.position = piecePoint( piece.x, 0u, p );
	o.normal = pieceVector( piece.x, 0u, n );
	o.previous = piecePoint( piece.x, 3u, p );
	if ( t != 0.0 ) {
		o.position += ( piecePoint( piece.x + 1u, 0u, p ) - o.position ) * t;
		o.normal += ( pieceVector( piece.x + 1u, 0u, n ) - o.normal ) * t;
		o.previous += ( piecePoint( piece.x + 1u, 3u, p ) - o.previous ) * t;
	}
	if ( ( piece.y & 0x80000000u ) != 0u ) {
		let l = length( o.normal );
		o.normal = o.normal / select( 1.0, l, l > 0.0 );
	}
	return o;
}
`,
} );
