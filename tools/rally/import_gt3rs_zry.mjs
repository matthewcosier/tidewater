// Build the GT3RS ZRY game car (public/rally/gt3rs_zry.glb) from its studio Blender model.
// Run: node tools/rally/import_gt3rs_zry.mjs <car.blend> <side-graphic.png> [--reuse]
// Needs Blender 5.2 (BLENDER=<path to blender>, else `blender` on PATH) and the build-time
// simplifier, which the game does not ship: npm install --no-save meshoptimizer@1.3.0
// tools/rally/gt3rs_zry_export.py reads the blend (never writes it) and dumps the visible car in game
// axes; this script reduces it to the game budget, rigs the wheels like the COSIER GLB
// (tools/rally/import_gt3rs.mjs) and writes a plain GLB: metres, +Y up, +Z forward, origin on the
// road midway between the axles. It writes public/rally/gt3rs_zry.glb and packs it into
// assets/distribution/rally/gt3rs_zry.glb.br; the Blender dump goes to <system temp>/tidewater-gt3rs-zry,
// and --reuse skips Blender and reuses that dump.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice( 2 ).filter( a => ! a.startsWith( '--' ) );
if ( args.length < 2 ) throw new Error( 'Usage: node tools/rally/import_gt3rs_zry.mjs <car.blend> <side-graphic.png> [--reuse]' );
const [ blend, graphic ] = args.map( a => resolve( a ) );
let MeshoptSimplifier;
try {
	( { MeshoptSimplifier } = await import( 'meshoptimizer' ) );
} catch {
	throw new Error( 'Install the build-time simplifier first: npm install --no-save meshoptimizer@1.3.0' );
}
await MeshoptSimplifier.ready;

const work = join( tmpdir(), 'tidewater-gt3rs-zry' );
mkdirSync( work, { recursive: true } );
if ( ! process.argv.includes( '--reuse' ) || ! existsSync( join( work, 'zry.json' ) ) ) {
	const exporter = fileURLToPath( new URL( './gt3rs_zry_export.py', import.meta.url ) );
	execFileSync( process.env.BLENDER || 'blender', [ '-b', blend, '--factory-startup', '-P', exporter, '--', work, graphic ], { stdio: 'inherit' } );
}
const dump = JSON.parse( readFileSync( join( work, 'zry.json' ), 'utf8' ) );
const bin = readFileSync( join( work, 'zry.bin' ) );
const vinylPNG = readFileSync( join( work, 'zry_vinyl.png' ) );
const view = ( Type, offset, count ) => new Type( bin.buffer, bin.byteOffset + offset, count );

// Reduction by kind of part: geometric error in metres, and how hard the corner normals hold
// (highlights on the paint and glass move only where the eye cannot follow).
const SETTINGS = {
	skin: { error: 0.0030, normal: 0.35, fraction: 0.004 },
	body: { error: 0.0045, normal: 0.12, fraction: 0.01 },
	wheel: { error: 0.0015, normal: 0.25, fraction: 0.02 },
	wing: { error: 0.0025, normal: 0.25, fraction: 0.02 },
	cabin: { error: 0.0050, normal: 0.06, fraction: 0.01 },
};
const SKIN = /^(BodyPaint|BodyPaintVinyl|GlassClear)$/;
// What turns about the axle keeps its roundness: the tyre, rim barrel, lip and disc at a finer error.
// Badges and scripts are a few millimetres proud; at the panel error they melt into the paint.
const LETTERING = /script|lettering|badge|crest|emblem|logo/i;
const ROUND = /Cup tyre|rim barrel|stepped flange|inner barrel|brake disc|rotor carrier/, ROUND_ERROR = 0.0006;
// Moulded tyre lettering, shoulder sipes, sidewall beads and the lock ring's printing are below a
// pixel from the chase camera; the budget goes to the paint, the wheels' silhouette and the lamps.
const UNSEEN = /sidewall [A-Z0-9]|sidewall moulded checker|angled shoulder sipes|mould bead|lock ring print/;
const NODE = { body: 'BodyStatic', glass: 'GlassPanels', cabin: 'InteriorAssembly', wing: 'RearWing' };

// Wheel frames: the carrier sits on the hub at the physics track; Camber turns local +X onto the
// measured axle (negative camber); Roll spins about it. Parts are stored in the Camber frame.
const wheels = {};
for ( const [ name, h ] of Object.entries( dump.hubs ) ) {
	const sign = name.endsWith( 'L' ) ? - 1 : 1; // L is the negative-X side
	const ax = h.axis.map( v => v * sign ); // inboard-to-outboard flipped to point along +X
	const angle = Math.atan2( ax[ 1 ], ax[ 0 ] ); // rotation about +Z taking +X onto the axle
	wheels[ name ] = { hub: h.hub, angle, quaternion: [ 0, 0, Math.sin( angle / 2 ), Math.cos( angle / 2 ) ], h };
}
function toWheel( name, P, N ) {
	const { hub, angle } = wheels[ name ], c = Math.cos( - angle ), s = Math.sin( - angle );
	for ( let i = 0; i < P.length; i += 3 ) {
		const x = P[ i ] - hub[ 0 ], y = P[ i + 1 ] - hub[ 1 ];
		P[ i ] = c * x - s * y; P[ i + 1 ] = s * x + c * y; P[ i + 2 ] -= hub[ 2 ];
		const nx = N[ i ], ny = N[ i + 1 ];
		N[ i ] = c * nx - s * ny; N[ i + 1 ] = s * nx + c * ny;
	}
}

// The studio panels are full of vertices where separate triangle fans touch, which the simplifier
// locks unless it may be permissive. Permissive collapses keep material borders and creases sharper
// than 25 degrees (lock 2: they may slide along the seam, never across it).
const CREASE = Math.cos( 40 * Math.PI / 180 );
function seams( P, N, vmat ) {
	const remap = MeshoptSimplifier.generatePositionRemap( P, 3 ), lock = new Uint8Array( P.length / 3 );
	for ( let i = 0; i < lock.length; i ++ ) {
		const r = remap[ i ];
		if ( r === i ) continue;
		const dot = N[ i * 3 ] * N[ r * 3 ] + N[ i * 3 + 1 ] * N[ r * 3 + 1 ] + N[ i * 3 + 2 ] * N[ r * 3 + 2 ];
		const paint = PAINT.test( dump.materials[ vmat[ i ] ].name ) && PAINT.test( dump.materials[ vmat[ r ] ].name );
		if ( vmat[ i ] !== vmat[ r ] || ( ! paint && dot < CREASE ) ) lock[ i ] = lock[ r ] = 2;
	}
	return lock;
}

const buckets = new Map();
const bucket = ( node, material ) => {
	const key = node + '/' + material;
	if ( ! buckets.has( key ) ) buckets.set( key, { node, material, parts: [] } );
	return buckets.get( key );
};
let sourceTris = 0, keptTris = 0;
const perKind = {}, report = [];
const PAINT = /^BodyPaint/;
const parts = dump.objects.filter( o => ! ( o.target === 'wheel' && UNSEEN.test( o.name ) ) ).map( o => {
	let at = o.offset;
	const P = new Float32Array( view( Float32Array, at, o.verts * 3 ) ); at += o.verts * 12;
	const N = new Float32Array( view( Float32Array, at, o.verts * 3 ) ); at += o.verts * 12;
	const I = new Uint32Array( view( Uint32Array, at, o.tris * 3 ) ); at += o.tris * 12;
	const TM = view( Uint16Array, at, o.tris ); at += o.tris * 2; at += ( 4 - at % 4 ) % 4;
	const TG = view( Uint8Array, at, o.tris );
	sourceTris += o.tris;
	// one material per vertex (the exporter split them), so a triangle's material is its first vertex's
	const vmat = new Uint16Array( o.verts ), vglass = new Uint8Array( o.verts );
	for ( let t = 0; t < o.tris; t ++ ) for ( let k = 0; k < 3; k ++ ) { vmat[ I[ t * 3 + k ] ] = TM[ t ]; vglass[ I[ t * 3 + k ] ] = TG[ t ]; }
	const skin = [ ...new Set( TM ) ].some( m => SKIN.test( dump.materials[ m ].name ) );
	return { o, P, N, I, vmat, vglass, kind: o.target === 'body' && skin ? 'skin' : o.target };
} );

// The studio panels are thin closed shells: white paint outside, the dark composite return a millimetre
// or two behind it. Reduced independently, either surface may cross the other and the dark side shows
// through the white. Surfaces that sit just behind paint are never seen, so they step back by SINK
// (along the paint's inward normal) before reduction; shut-line walls only grow a little deeper.
const REACH = 0.004, SINK = 0.0035;
const cellKey = ( x, y, z ) => ( ( Math.floor( x / REACH ) + 2048 ) * 4096 + Math.floor( y / REACH ) + 2048 ) * 4096 + Math.floor( z / REACH ) + 2048;
const exterior = parts.filter( p => p.kind === 'skin' || p.kind === 'body' || p.kind === 'wing' );
const paintGrid = new Map();
for ( const p of exterior ) for ( let i = 0; i < p.vmat.length; i ++ ) {
	if ( ! PAINT.test( dump.materials[ p.vmat[ i ] ].name ) ) continue;
	const key = cellKey( p.P[ i * 3 ], p.P[ i * 3 + 1 ], p.P[ i * 3 + 2 ] );
	if ( ! paintGrid.has( key ) ) paintGrid.set( key, [] );
	paintGrid.get( key ).push( p, i );
}
let sunk = 0;
for ( const p of exterior ) {
	const { P, N } = p, move = new Float32Array( P.length );
	for ( let i = 0; i < p.vmat.length; i ++ ) {
		if ( PAINT.test( dump.materials[ p.vmat[ i ] ].name ) || /^Glass|Lamp/.test( dump.materials[ p.vmat[ i ] ].name ) ) continue;
		const x = P[ i * 3 ], y = P[ i * 3 + 1 ], z = P[ i * 3 + 2 ];
		let best = REACH * REACH, q = null, j = - 1;
		for ( let a = - 1; a <= 1; a ++ ) for ( let b = - 1; b <= 1; b ++ ) for ( let c = - 1; c <= 1; c ++ ) {
			const list = paintGrid.get( cellKey( x + a * REACH, y + b * REACH, z + c * REACH ) );
			if ( list ) for ( let k = 0; k < list.length; k += 2 ) {
				const Q = list[ k ].P, m = list[ k + 1 ];
				const d = ( Q[ m * 3 ] - x ) ** 2 + ( Q[ m * 3 + 1 ] - y ) ** 2 + ( Q[ m * 3 + 2 ] - z ) ** 2;
				if ( d < best ) { best = d; q = list[ k ]; j = m; }
			}
		}
		if ( ! q ) continue;
		const nx = q.N[ j * 3 ], ny = q.N[ j * 3 + 1 ], nz = q.N[ j * 3 + 2 ];
		const behind = ( x - q.P[ j * 3 ] ) * nx + ( y - q.P[ j * 3 + 1 ] ) * ny + ( z - q.P[ j * 3 + 2 ] ) * nz;
		if ( behind > - 0.0002 ) continue; // level with the paint: the seam itself and what stands proud of it
		move[ i * 3 ] = - nx * SINK; move[ i * 3 + 1 ] = - ny * SINK; move[ i * 3 + 2 ] = - nz * SINK;
	}
	// every copy of a position (split normals, materials) moves together, so nothing tears
	const remap = MeshoptSimplifier.generatePositionRemap( P, 3 );
	for ( let i = 0; i < p.vmat.length; i ++ ) {
		const r = remap[ i ];
		if ( move[ r * 3 ] || move[ r * 3 + 1 ] || move[ r * 3 + 2 ] ) { if ( r !== i ) { move[ i * 3 ] = move[ r * 3 ]; move[ i * 3 + 1 ] = move[ r * 3 + 1 ]; move[ i * 3 + 2 ] = move[ r * 3 + 2 ]; } }
		else if ( move[ i * 3 ] || move[ i * 3 + 1 ] || move[ i * 3 + 2 ] ) { move[ r * 3 ] = move[ i * 3 ]; move[ r * 3 + 1 ] = move[ i * 3 + 1 ]; move[ r * 3 + 2 ] = move[ i * 3 + 2 ]; }
	}
	for ( let i = 0; i < p.vmat.length; i ++ ) {
		const r = remap[ i ];
		if ( move[ r * 3 ] || move[ r * 3 + 1 ] || move[ r * 3 + 2 ] ) { P[ i * 3 ] += move[ r * 3 ]; P[ i * 3 + 1 ] += move[ r * 3 + 1 ]; P[ i * 3 + 2 ] += move[ r * 3 + 2 ]; sunk ++; }
	}
}

// Reduce one part's source triangles at its kind's error (times `scale`).
function reduce( { o, P, N, vmat, kind }, source, scale ) {
	const set = SETTINGS[ kind ];
	if ( source.length / 3 <= 12 ) return source;
	const attributes = new Float32Array( N ), weights = [ set.normal, set.normal, set.normal ], flags = [ 'ErrorAbsolute', 'Permissive' ];
	const target = Math.min( source.length, 3 * Math.max( 20, Math.floor( source.length / 3 * set.fraction ) ) );
	const error = kind === 'wheel' && ROUND.test( o.name ) ? ROUND_ERROR : LETTERING.test( o.name ) ? 0.0005 : set.error;
	let [ I ] = MeshoptSimplifier.simplifyWithAttributes( source, P, 3, attributes, 3, weights, seams( P, N, vmat ), target, error * scale, flags );
	return I;
}

// Islands: connected pieces of a part, on positions (a vertex split by normal or material is one point).
for ( const p of parts ) {
	const remap = MeshoptSimplifier.generatePositionRemap( p.P, 3 ), up = Int32Array.from( remap );
	const find = i => { while ( up[ i ] !== i ) { up[ i ] = up[ up[ i ] ]; i = up[ i ]; } return i; };
	for ( let t = 0; t < p.I.length; t += 3 ) { const a = find( p.I[ t ] ), b = find( p.I[ t + 1 ] ), c = find( p.I[ t + 2 ] ); up[ b ] = a; up[ find( c ) ] = a; }
	p.island = new Int32Array( p.vmat.length );
	for ( let i = 0; i < p.island.length; i ++ ) p.island[ i ] = find( i );
}

// Never seen: pieces no camera outside the car finds, looking through the glass. The wheels, lamps,
// bumper ends and wing (which turn, steer or break away) see but do not hide.
function visibility( tri, opaque, occludes ) {
	const n = opaque.length, visible = new Uint8Array( n ), W = 1024;
	const depth = new Float32Array( W * W ), id = new Int32Array( W * W );
	const views = [], centre = [ 0, 0.62, 0 ];
	for ( let i = 0, m = 160; i < m; i ++ ) { // a Fibonacci sphere at two distances
		const y = 1 - 2 * ( i + 0.5 ) / m, r = Math.sqrt( 1 - y * y ), a = i * Math.PI * ( 3 - Math.sqrt( 5 ) );
		for ( const d of [ 6.5, 3.6 ] ) views.push( { eye: [ centre[ 0 ] + d * r * Math.cos( a ), centre[ 1 ] + d * y, centre[ 2 ] + d * r * Math.sin( a ) ], at: centre, fov: 40 } );
	}
	for ( let i = 0; i < 48; i ++ ) for ( const h of [ 0.35, 1.6, 2.6 ] ) { // standing close, peering in
		const a = i / 48 * Math.PI * 2, ex = 1.95 * Math.cos( a ), ez = 3.2 * Math.sin( a );
		for ( const at of [ [ 0, 0.55, 0 ], [ 0, 0.9, 0 ], [ ex * 0.45, 0.45, ez * 0.6 ] ] ) views.push( { eye: [ ex, h, ez ], at, fov: 75 } );
	}
	const s = new Float64Array( 9 );
	const raster = ( t, view, write ) => {
		for ( let c = 0; c < 3; c ++ ) {
			const x = tri[ t * 9 + c * 3 ] - view.eye[ 0 ], y = tri[ t * 9 + c * 3 + 1 ] - view.eye[ 1 ], z = tri[ t * 9 + c * 3 + 2 ] - view.eye[ 2 ];
			const vx = x * view.r[ 0 ] + y * view.r[ 1 ] + z * view.r[ 2 ], vy = x * view.u[ 0 ] + y * view.u[ 1 ] + z * view.u[ 2 ], vz = x * view.f[ 0 ] + y * view.f[ 1 ] + z * view.f[ 2 ];
			if ( vz < 0.05 ) return false;
			s[ c * 3 ] = ( vx / vz * view.k + 1 ) * W / 2; s[ c * 3 + 1 ] = ( 1 - vy / vz * view.k ) * W / 2; s[ c * 3 + 2 ] = 1 / vz;
		}
		const x0 = s[ 0 ], y0 = s[ 1 ], w0 = s[ 2 ], x1 = s[ 3 ], y1 = s[ 4 ], w1 = s[ 5 ], x2 = s[ 6 ], y2 = s[ 7 ], w2 = s[ 8 ];
		const area = ( x1 - x0 ) * ( y2 - y0 ) - ( x2 - x0 ) * ( y1 - y0 );
		const minX = Math.max( 0, Math.floor( Math.min( x0, x1, x2 ) ) ), maxX = Math.min( W - 1, Math.ceil( Math.max( x0, x1, x2 ) ) );
		const minY = Math.max( 0, Math.floor( Math.min( y0, y1, y2 ) ) ), maxY = Math.min( W - 1, Math.ceil( Math.max( y0, y1, y2 ) ) );
		if ( minX > maxX || minY > maxY ) return false;
		let hit = false, covered = false;
		const sign = area < 0 ? - 1 : 1, a = Math.abs( area );
		if ( a > 1e-9 ) for ( let py = minY; py <= maxY; py ++ ) for ( let px = minX; px <= maxX; px ++ ) {
			const sx = px + 0.5, sy = py + 0.5;
			const b0 = sign * ( ( x1 - sx ) * ( y2 - sy ) - ( x2 - sx ) * ( y1 - sy ) );
			const b1 = sign * ( ( x2 - sx ) * ( y0 - sy ) - ( x0 - sx ) * ( y2 - sy ) );
			const b2 = sign * ( ( x0 - sx ) * ( y1 - sy ) - ( x1 - sx ) * ( y0 - sy ) );
			if ( b0 < 0 || b1 < 0 || b2 < 0 ) continue;
			covered = true;
			const w = ( b0 * w0 + b1 * w1 + b2 * w2 ) / a, i = py * W + px;
			if ( w >= depth[ i ] * 0.9997 ) {
				hit = true;
				if ( write && w > depth[ i ] ) { depth[ i ] = w; id[ i ] = t; }
			}
		}
		if ( ! covered ) { // smaller than a pixel: test its centre
			const px = Math.min( W - 1, Math.max( 0, Math.floor( ( x0 + x1 + x2 ) / 3 ) ) ), py = Math.min( W - 1, Math.max( 0, Math.floor( ( y0 + y1 + y2 ) / 3 ) ) );
			if ( ( w0 + w1 + w2 ) / 3 >= depth[ py * W + px ] * 0.9997 ) hit = true;
		}
		return hit;
	};
	for ( const view of views ) {
		const f = view.at.map( ( v, i ) => v - view.eye[ i ] ), fl = Math.hypot( ...f );
		for ( let i = 0; i < 3; i ++ ) f[ i ] /= fl;
		let r = [ - f[ 2 ], 0, f[ 0 ] ];
		if ( Math.hypot( ...r ) < 1e-6 ) r = [ 1, 0, 0 ];
		const rl = Math.hypot( ...r ); r = r.map( v => v / rl );
		const u = [ r[ 1 ] * f[ 2 ] - r[ 2 ] * f[ 1 ], r[ 2 ] * f[ 0 ] - r[ 0 ] * f[ 2 ], r[ 0 ] * f[ 1 ] - r[ 1 ] * f[ 0 ] ];
		Object.assign( view, { f, r, u, k: 1 / Math.tan( view.fov * Math.PI / 360 ) } );
		depth.fill( 0 ); id.fill( - 1 );
		for ( let t = 0; t < n; t ++ ) if ( occludes[ t ] ) raster( t, view, true );
		for ( let i = 0; i < id.length; i ++ ) if ( id[ i ] >= 0 ) visible[ id[ i ] ] = 1;
		for ( let t = 0; t < n; t ++ ) if ( ! visible[ t ] && ! occludes[ t ] && raster( t, view, false ) ) visible[ t ] = 1;
	}
	return visible;
}

const seen = parts.map( p => new Set( p.kind === 'wheel' ? p.island : [] ) );
{
	// a draft at twice the error is enough to judge which islands are ever seen
	const first = parts.map( p => reduce( p, p.I, 2 ) );
	let n = 0;
	for ( const I of first ) n += I.length / 3;
	const tri = new Float32Array( n * 9 ), owner = new Int32Array( n * 2 ), opaque = new Uint8Array( n ), occludes = new Uint8Array( n );
	let k = 0;
	parts.forEach( ( p, pi ) => {
		const I = first[ pi ];
		for ( let t = 0; t < I.length; t += 3, k ++ ) {
			let cy = 0, cz = 0;
			for ( let c = 0; c < 3; c ++ ) for ( let d = 0; d < 3; d ++ ) tri[ k * 9 + c * 3 + d ] = p.P[ I[ t + c ] * 3 + d ];
			for ( let c = 0; c < 3; c ++ ) { cy += p.P[ I[ t + c ] * 3 + 1 ] / 3; cz += p.P[ I[ t + c ] * 3 + 2 ] / 3; }
			const name = dump.materials[ p.vmat[ I[ t ] ] ].name;
			owner[ k * 2 ] = pi; owner[ k * 2 + 1 ] = p.island[ I[ t ] ];
			opaque[ k ] = ! /^Glass/.test( name );
			const breaks = p.kind === 'wheel' || p.kind === 'wing' || /Lamp|LED/.test( name ) || ( cy < 0.62 && Math.abs( cz ) > 1.85 );
			occludes[ k ] = opaque[ k ] && ! breaks;
		}
	} );
	const t0 = Date.now(), visible = visibility( tri, opaque, occludes );
	for ( let t = 0; t < n; t ++ ) if ( visible[ t ] ) seen[ owner[ t * 2 ] ].add( owner[ t * 2 + 1 ] );
	console.log( `visibility: ${ n } triangles from ${ 160 * 2 + 48 * 9 } viewpoints in ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 1 ) } s` );
}

let culledTris = 0;
const culledParts = [];
parts.forEach( ( p, pi ) => {
	const { o, P, N, vmat, vglass, kind } = p;
	const keep = [];
	for ( let t = 0; t < p.I.length; t += 3 ) if ( seen[ pi ].has( p.island[ p.I[ t ] ] ) ) keep.push( p.I[ t ], p.I[ t + 1 ], p.I[ t + 2 ] );
	culledTris += ( p.I.length - keep.length ) / 3;
	if ( ! keep.length ) { culledParts.push( o.name ); return; }
	const I = reduce( p, new Uint32Array( keep ), 1 );
	const node = o.target === 'wheel' ? `Wheel${ o.corner.startsWith( 'Front' ) ? 'Front' : 'Rear' }${ o.corner.endsWith( 'right' ) ? 'L' : 'R' }` : null;
	if ( node ) toWheel( node, P, N );
	perKind[ kind ] = ( perKind[ kind ] || 0 ) + I.length / 3;
	report.push( { name: o.name, kind, source: o.tris, kept: I.length / 3 } );
	keptTris += I.length / 3;
	const split = new Map();
	for ( let t = 0; t < I.length; t += 3 ) {
		const v = I[ t ], m = vmat[ v ];
		const target = node ? node + ( o.part === 'fixed' ? 'Camber' : 'Roll' ) : NODE[ vglass[ v ] ? 'glass' : o.target ];
		const key = target + '/' + m;
		if ( ! split.has( key ) ) split.set( key, { target, m, list: [] } );
		split.get( key ).list.push( I[ t ], I[ t + 1 ], I[ t + 2 ] );
	}
	for ( const { target, m, list } of split.values() ) bucket( target, m ).parts.push( { P, N, I: list } );
} );

// Batches: compact each bucket's vertices; vinyl faces get planar UVs into the side graphic.
const V = dump.vinyl;
function vinylUV( x, y, z ) {
	const X = V.mid - z, Y = - x, Z = y; // back to the film's car axes
	let u = ( X - V.u0 ) / V.du;
	const v = ( Z - ( V.z0 + V.rise * u ) ) / V.dz;
	if ( Y > 0 ) u = 1 - u; // the car's right side reads front to back too
	return [ ( u + V.mu ) / ( 1 + 2 * V.mu ), 1 - ( v + V.mv ) / ( 1 + 2 * V.mv ) ];
}
const batches = [];
for ( const b of buckets.values() ) {
	const material = dump.materials[ b.material ];
	const pos = [], nor = [], idx = [], uv = [];
	for ( const part of b.parts ) {
		const remap = new Map();
		for ( const i of part.I ) {
			let j = remap.get( i );
			if ( j === undefined ) {
				j = pos.length / 3; remap.set( i, j );
				pos.push( part.P[ i * 3 ], part.P[ i * 3 + 1 ], part.P[ i * 3 + 2 ] );
				nor.push( part.N[ i * 3 ], part.N[ i * 3 + 1 ], part.N[ i * 3 + 2 ] );
				if ( material.texture ) uv.push( ...vinylUV( part.P[ i * 3 ], part.P[ i * 3 + 1 ], part.P[ i * 3 + 2 ] ) );
			}
			idx.push( j );
		}
	}
	batches.push( { node: b.node, material: b.material, pos: new Float32Array( pos ), nor: new Float32Array( nor ), uv: uv.length ? new Float32Array( uv ) : null, idx: pos.length / 3 > 65535 ? new Uint32Array( idx ) : new Uint16Array( idx ) } );
}

// ------------------------------------------------------------------ GLB
const json = { asset: { version: '2.0', generator: 'Tidewater tools/rally/import_gt3rs_zry.mjs (generated, do not edit by hand)' },
	scene: 0, scenes: [ { nodes: [] } ], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [], materials: [],
	extensionsUsed: [ 'KHR_materials_clearcoat' ] };
const chunks = [];
let length = 0;
function addView( bytes, target ) {
	const pad = ( 4 - length % 4 ) % 4;
	if ( pad ) { chunks.push( new Uint8Array( pad ) ); length += pad; }
	json.bufferViews.push( { buffer: 0, byteOffset: length, byteLength: bytes.byteLength, ...( target ? { target } : {} ) } );
	chunks.push( new Uint8Array( bytes.buffer, bytes.byteOffset, bytes.byteLength ) ); length += bytes.byteLength;
	return json.bufferViews.length - 1;
}
function addAccessor( array, type, target, minmax ) {
	const componentType = array instanceof Float32Array ? 5126 : array instanceof Uint32Array ? 5125 : 5123;
	const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[ type ];
	const a = { bufferView: addView( array, target ), componentType, count: array.length / size, type };
	if ( minmax ) {
		a.min = [ Infinity, Infinity, Infinity ]; a.max = [ - Infinity, - Infinity, - Infinity ];
		for ( let i = 0; i < array.length; i += 3 ) for ( let k = 0; k < 3; k ++ ) { a.min[ k ] = Math.min( a.min[ k ], array[ i + k ] ); a.max[ k ] = Math.max( a.max[ k ], array[ i + k ] ); }
	}
	json.accessors.push( a );
	return json.accessors.length - 1;
}
const usedMaterials = [ ...new Set( batches.map( b => b.material ) ) ];
const materialIndex = new Map( usedMaterials.map( ( m, i ) => [ m, i ] ) );
for ( const m of usedMaterials.map( i => dump.materials[ i ] ) ) {
	const g = { name: m.name, pbrMetallicRoughness: { baseColorFactor: [ ...m.color.map( c => + c.toFixed( 5 ) ), m.alpha ?? 1 ], metallicFactor: + m.metal.toFixed( 4 ), roughnessFactor: + Math.max( 0.02, m.rough ).toFixed( 4 ) } };
	if ( m.emissive && m.emissive.some( c => c > 0 ) ) g.emissiveFactor = m.emissive.map( c => + c.toFixed( 5 ) );
	if ( m.coat > 0 ) g.extensions = { KHR_materials_clearcoat: { clearcoatFactor: + m.coat.toFixed( 3 ), clearcoatRoughnessFactor: + ( m.coatRough ?? 0.05 ).toFixed( 4 ) } };
	if ( m.alpha !== undefined && m.alpha < 1 ) g.alphaMode = 'BLEND';
	if ( ! m.single ) g.doubleSided = true;
	if ( m.texture ) {
		json.images = [ { bufferView: addView( vinylPNG ), mimeType: 'image/png' } ];
		json.samplers = [ { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 } ];
		json.textures = [ { source: 0, sampler: 0 } ];
		g.pbrMetallicRoughness.baseColorTexture = { index: 0 };
	}
	json.materials.push( g );
}
const nodeIndex = new Map();
function node( name, extra = {}, parent = null ) {
	json.nodes.push( { name, ...extra } );
	const i = json.nodes.length - 1;
	nodeIndex.set( name, i );
	if ( parent === null ) json.scenes[ 0 ].nodes.push( i );
	else ( json.nodes[ parent ].children ||= [] ).push( i );
	return i;
}
const body = node( 'BodyStatic' );
for ( const name of [ 'GlassPanels', 'InteriorAssembly', 'RearWing' ] ) node( name, {}, body );
for ( const [ name, w ] of Object.entries( wheels ) ) {
	const carrier = node( name, { translation: w.hub.map( v => + v.toFixed( 5 ) ) } );
	const camber = node( name + 'Camber', { rotation: w.quaternion }, carrier );
	node( name + 'Roll', {}, camber );
}
let triangles = 0;
const meshes = new Map();
for ( const b of batches.sort( ( a, c ) => a.node.localeCompare( c.node ) || a.material - c.material ) ) {
	if ( ! meshes.has( b.node ) ) meshes.set( b.node, [] );
	const attributes = { POSITION: addAccessor( b.pos, 'VEC3', 34962, true ), NORMAL: addAccessor( b.nor, 'VEC3', 34962 ) };
	if ( b.uv ) attributes.TEXCOORD_0 = addAccessor( b.uv, 'VEC2', 34962 );
	meshes.get( b.node ).push( { attributes, indices: addAccessor( b.idx, 'SCALAR', 34963 ), material: materialIndex.get( b.material ), mode: 4 } );
	triangles += b.idx.length / 3;
}
for ( const [ name, primitives ] of meshes ) {
	json.meshes.push( { name, primitives } );
	json.nodes[ nodeIndex.get( name ) ].mesh = json.meshes.length - 1;
}
json.buffers.push( { byteLength: length } );
const jsonBytes = Buffer.from( JSON.stringify( json ) );
const jsonPad = Buffer.alloc( ( 4 - jsonBytes.length % 4 ) % 4, 0x20 ), binPad = Buffer.alloc( ( 4 - length % 4 ) % 4 );
const header = Buffer.alloc( 12 ), jh = Buffer.alloc( 8 ), bh = Buffer.alloc( 8 );
const jsonLength = jsonBytes.length + jsonPad.length, binLength = length + binPad.length;
header.writeUInt32LE( 0x46546c67, 0 ); header.writeUInt32LE( 2, 4 ); header.writeUInt32LE( 12 + 8 + jsonLength + 8 + binLength, 8 );
jh.writeUInt32LE( jsonLength, 0 ); jh.writeUInt32LE( 0x4e4f534a, 4 ); bh.writeUInt32LE( binLength, 0 ); bh.writeUInt32LE( 0x004e4942, 4 );
const output = fileURLToPath( new URL( '../../public/rally/gt3rs_zry.glb', import.meta.url ) );
writeFileSync( output, Buffer.concat( [ header, jh, jsonBytes, jsonPad, bh, ...chunks.map( c => Buffer.from( c.buffer, c.byteOffset, c.byteLength ) ), binPad ] ) );
execFileSync( process.execPath, [ fileURLToPath( new URL( '../distribution-assets.mjs', import.meta.url ) ), 'pack', 'zry' ] );
writeFileSync( join( work, 'report.json' ), JSON.stringify( report.sort( ( a, b ) => b.kept - a.kept ), null, 1 ) );
console.log( `stepped back behind the paint: ${ sunk } vertices` );
console.log( `never seen from outside: ${ culledTris } studio triangles, ${ culledParts.length } whole parts` );
console.log( `${ sourceTris } studio triangles -> ${ triangles } game triangles in ${ batches.length } batches (${ Object.entries( perKind ).map( ( [ k, n ] ) => `${ k } ${ n }` ).join( ', ' ) })` );
for ( const [ name, w ] of Object.entries( wheels ) ) console.log( `${ name }: hub ${ w.hub.map( v => v.toFixed( 4 ) ).join( ', ' ) } m, tyre radius ${ w.h.radius.toFixed( 4 ) } m, camber ${ w.h.camber_deg.toFixed( 2 ) } deg, studio contact flat ${ w.h.flat_mm.toFixed( 1 ) } mm` );
