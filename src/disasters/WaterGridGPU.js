
import { STILL_SPEED } from './WaterGrid.js';

const WORKGROUP = 64;
const PARAM_BYTES = 128; // 32 x 4-byte fields, a multiple of 16
const SLOT = 256; // bytes per parameter slot (minUniformBufferOffsetAlignment): one slot per substep, one for the frame
export const MAX_SUBSTEPS = 12; // solver steps per grid per frame; past it the frame's excess is dropped (stats.droppedTime) and SimulationPacing slows the clock
const STEP_MARGIN = 0.9; // of the CFL step: the rate is read back a frame late, and a front does not speed up 10% in one frame
const FLAG_FRICTION = 1, FLAG_SPONGE = 2, FLAG_INFLOW = 4;

const CODE = /* wgsl */`
struct Params {
	n : u32, pn : u32, flags : u32, pad : u32,
	dt : f32, k : f32, dx : f32, alpha : f32,
	x0 : f32, z0 : f32, px : f32, pz : f32,
	pdx : f32, elapsed : f32, launchDistance : f32, ffSpeed : f32,
	ex : f32, ez : f32, c : f32, s : f32,
	sigma : f32, radius : f32, halfLength : f32, ffLength : f32,
	troughLead : f32, drawdown : f32, intensity : f32, farField : f32,
	calmRate : f32, calmSoak : f32, pad1 : f32, pad2 : f32,
}
@group( 0 ) @binding( 0 ) var<uniform> P : Params;
@group( 0 ) @binding( 1 ) var<storage, read_write> U : array<vec4f>; // [0, N): ( h, qx, qz, bed ); [N, 2N): stage copy
@group( 0 ) @binding( 2 ) var<storage, read_write> S : array<vec4f>; // [0, N): x slopes; [N, 2N): z slopes ( sEta, sH, sUn, sUt )
@group( 0 ) @binding( 3 ) var<storage, read_write> F : array<vec4f>; // [0, N): face ( p, p + 1 ); [N, 2N): face ( p, p + n ) ( f, delta, t, press )
@group( 0 ) @binding( 4 ) var<storage, read_write> PK : array<vec4f>; // [0, N) state, [N, 2N) previous, [2N, 3N) pixels: ( surface, ux, uz, depth )
@group( 0 ) @binding( 5 ) var<storage, read> PP : array<vec4f>; // the parent's PK (its pixels third is read)
@group( 0 ) @binding( 6 ) var<storage, read_write> R : array<atomic<u32>>; // max CFL rate, float bits

const G = 9.81; // m/s^2
const DRY = 1e-3; // m: WaterGrid DRY
const THETA = 1.3; // WaterGrid THETA
const WET = 1e-5; // m: the CPU's thin-water test
const TROUGH_FLOOR = 0.05; // WaterGrid TROUGH_FLOOR

// WaterGrid limited()
fn limited( a : f32, b : f32 ) -> f32 {
	if ( a > 0.0 && b > 0.0 ) { return min( min( THETA * a, 0.5 * ( a + b ) ), THETA * b ); }
	if ( a < 0.0 && b < 0.0 ) { return max( max( THETA * a, 0.5 * ( a + b ) ), THETA * b ); }
	return 0.0;
}

// ( h, eta, u, v ) of a cell: WaterGrid.residual's first loop.
fn cell( p : u32 ) -> vec4f {
	let c = U[ p ];
	var u = 0.0;
	var v = 0.0;
	if ( c.x > WET ) { u = c.y / c.x; v = c.z / c.x; }
	return vec4f( c.x, c.x + c.w, u, v );
}

// One axis's limited slopes ( sEta, sH, sUn, sUt ) of cell p: WaterGrid.sweep's first loop, first order at the
// domain edge and next to thin water, decided per cell.
fn slopeAxis( p : u32, along : u32, stride : u32, axis : u32 ) -> vec4f {
	if ( along == 0u || along == P.n - 1u ) { return vec4f( 0.0 ); }
	let C = cell( p );
	let L = cell( p - stride );
	let Q = cell( p + stride );
	if ( C.x < DRY || L.x < DRY || Q.x < DRY ) { return vec4f( 0.0 ); }
	// A step in the free surface (WaterGrid.sweep): a neighbour's surface below this cell's ground, or its ground above
	// this cell's surface.
	let bc = U[ p ].w;
	if ( L.y < bc - DRY || Q.y < bc - DRY || C.y < U[ p - stride ].w - DRY || C.y < U[ p + stride ].w - DRY ) { return vec4f( 0.0 ); }
	var cn = C.z; var ct = C.w; var ln = L.z; var lt = L.w; var qn = Q.z; var qt = Q.w;
	if ( axis == 1u ) { cn = C.w; ct = C.z; ln = L.w; lt = L.z; qn = Q.w; qt = Q.z; }
	return vec4f( limited( C.y - L.y, Q.y - C.y ), limited( C.x - L.x, Q.x - C.x ), limited( cn - ln, qn - cn ), limited( ct - lt, qt - ct ) );
}

@compute @workgroup_size( ${ WORKGROUP } ) fn slopes( @builtin( global_invocation_id ) id : vec3u ) {
	let n = P.n;
	let N = n * n;
	let p = id.x;
	if ( p >= N ) { return; }
	S[ p ] = slopeAxis( p, p % n, 1u, 0u );
	S[ N + p ] = slopeAxis( p, p / n, n, 1u );
}

// The central-upwind flux at the face between l and r: WaterGrid.sweep's second loop. Returns ( f, delta, t,
// press ): l loses k f, k delta, k t; r gains k f, k ( delta + press ), k t.
fn face( l : u32, r : u32, sl : vec4f, sr : vec4f, axis : u32 ) -> vec4f {
	let A = cell( l );
	let B = cell( r );
	var unL = A.z; var utL = A.w; var unR = B.z; var utR = B.w;
	if ( axis == 1u ) { unL = A.w; utL = A.z; unR = B.w; utR = B.z; }
	let hL = A.x + 0.5 * sl.y;
	let hR = B.x - 0.5 * sr.y;
	let eL = A.y + 0.5 * sl.x;
	let eR = B.y - 0.5 * sr.x;
	let bs = max( eL - hL, eR - hR );
	// Hydrostatic reconstruction: depth above the higher face bed.
	let aL = max( eL - bs, 0.0 );
	let aR = max( eR - bs, 0.0 );
	var uL = 0.0; var vL = 0.0; var uR = 0.0; var vR = 0.0;
	if ( hL > WET ) { uL = unL + 0.5 * sl.z; vL = utL + 0.5 * sl.w; }
	if ( hR > WET ) { uR = unR - 0.5 * sr.z; vR = utR - 0.5 * sr.w; }
	let cL = sqrt( G * aL );
	let cR = sqrt( G * aR );
	let ap = max( max( 0.0, uL + cL ), uR + cR );
	let am = min( min( 0.0, uL - cL ), uR - cR );
	let span = ap - am;
	var f = 0.0; var delta = 0.0; var t = 0.0;
	if ( span > 1e-12 ) {
		let qL = aL * uL;
		let qR = aR * uR;
		let w = ap * am;
		f = ( ap * qL - am * qR + w * ( aR - aL ) ) / span;
		delta = ( ap * qL * uL - am * ( qR * uR + 0.5 * G * ( aR * aR - aL * aL ) ) + w * ( qR - qL ) ) / span;
		t = ( ap * qL * vL - am * qR * vR + w * ( aR * vR - aL * vL ) ) / span;
	}
	return vec4f( f, delta, t, 0.5 * G * ( aL * aL - aR * aR ) );
}

// Each face once, so the water it moves leaves one cell and enters the other exactly.
@compute @workgroup_size( ${ WORKGROUP } ) fn faces( @builtin( global_invocation_id ) id : vec3u ) {
	let n = P.n;
	let N = n * n;
	let p = id.x;
	if ( p >= N ) { return; }
	if ( p % n < n - 1u ) { F[ p ] = face( p, p + 1u, S[ p ], S[ p + 1u ], 0u ); }
	if ( p / n < n - 1u ) { F[ N + p ] = face( p, p + n, S[ N + p ], S[ N + p + n ], 1u ); }
}

// dt L( U ) at cell p: its four faces and the centred bed term -k g h sEta per axis (WaterGrid.sweep).
fn residual( p : u32, h : f32 ) -> vec3f {
	let n = P.n;
	let N = n * n;
	let k = P.k;
	var d = vec3f( 0.0 ); // dh, dqx, dqz
	if ( p % n < n - 1u ) { let f = F[ p ]; d -= k * vec3f( f.x, f.y, f.z ); }
	if ( p % n > 0u ) { let f = F[ p - 1u ]; d += k * vec3f( f.x, f.y + f.w, f.z ); }
	if ( p / n < n - 1u ) { let f = F[ N + p ]; d -= k * vec3f( f.x, f.z, f.y ); }
	if ( p / n > 0u ) { let f = F[ N + p - n ]; d += k * vec3f( f.x, f.z, f.y + f.w ); }
	d.y -= k * G * h * S[ p ].x;
	d.z -= k * G * h * S[ N + p ].x;
	return d;
}

// WaterGrid.stepSecond stage one: U1 = U0 + dt L( U0 ), clamped positive, thin water stopped.
@compute @workgroup_size( ${ WORKGROUP } ) fn update1( @builtin( global_invocation_id ) id : vec3u ) {
	let N = P.n * P.n;
	let p = id.x;
	if ( p >= N ) { return; }
	let c = U[ p ];
	let d = residual( p, c.x );
	U[ N + p ] = c;
	let next = max( c.x + d.x, 0.0 );
	var q = c.yz + d.yz;
	if ( next < WET ) { q = vec2f( 0.0 ); }
	U[ p ] = vec4f( next, q, c.w );
}

// Stage two: U = ( U0 + U1 + dt L( U1 ) ) / 2, clamped positive.
@compute @workgroup_size( ${ WORKGROUP } ) fn update2( @builtin( global_invocation_id ) id : vec3u ) {
	let N = P.n * P.n;
	let p = id.x;
	if ( p >= N ) { return; }
	let c = U[ p ];
	let o = U[ N + p ];
	let d = residual( p, c.x );
	U[ p ] = vec4f( max( 0.5 * ( o.x + c.x + d.x ), 0.0 ), 0.5 * ( o.yz + c.yz + d.yz ), c.w );
}

// WaterGrid nWaveEta and nWaveSpeed (the event's numbers are in P).
fn nWaveEta( along : f32, cross : f32, depth : f32 ) -> f32 {
	let x = max( 0.0, abs( cross ) - P.halfLength ) / P.radius;
	let lateral = exp( -2.0 * x * x );
	var back = along;
	if ( along < 0.0 ) { back = min( 0.0, along + P.ffLength ); }
	let b = back / P.sigma;
	let crest = exp( -0.5 * b * b );
	let t = ( along - P.troughLead * P.sigma ) / P.sigma;
	let trough = exp( -0.5 * t * t );
	return max( ( TROUGH_FLOOR - 1.0 ) * depth, P.intensity * ( crest - P.drawdown * trough ) * lateral );
}
fn nWaveSpeed( depth : f32, h : f32 ) -> f32 {
	let simple = 2.0 * ( sqrt( G * h ) - sqrt( G * depth ) );
	if ( P.farField == 0.0 || h <= depth ) { return simple; }
	return P.ffSpeed * ( h - depth ) / h;
}
// WaterGrid.inflowAt: the far-field wall's state on the edge band while it covers the cell.
fn inflow( c : ptr<function, vec4f>, i : u32, j : u32, edge : u32 ) -> bool {
	let rest = max( 0.0, -( *c ).w );
	if ( !( rest > 0.3 ) ) { return false; }
	let crest = P.launchDistance - P.ffSpeed * ( P.elapsed + P.dt );
	let x = P.x0 + f32( i ) * P.dx - ( P.ex - P.c * crest );
	let z = P.z0 + f32( j ) * P.dx - ( P.ez - P.s * crest );
	let eta = nWaveEta( x * P.c + z * P.s, -x * P.s + z * P.c, rest );
	if ( abs( eta ) < 0.0001 ) { return false; }
	let goal = rest + eta;
	let u = nWaveSpeed( rest, goal );
	var keep = 0.0;
	if ( edge >= 2u ) { let a = 1.0 - ( f32( edge ) - 2.0 ) / 6.0; keep = exp( -P.dt * 3.0 * a * a ); }
	( *c ).x = goal + ( ( *c ).x - goal ) * keep;
	( *c ).y = goal * u * P.c + ( ( *c ).y - goal * u * P.c ) * keep;
	( *c ).z = goal * u * P.s + ( ( *c ).z - goal * u * P.s ) * keep;
	return true;
}

// WaterGrid.sources without the wind: Manning friction, then on an un-nested grid the inflow band or the sponge.
@compute @workgroup_size( ${ WORKGROUP } ) fn sources( @builtin( global_invocation_id ) id : vec3u ) {
	let n = P.n;
	let p = id.x;
	if ( p >= n * n ) { return; }
	let i = p % n;
	let j = p / n;
	let dt = P.dt;
	var c = U[ p ];
	if ( c.x < WET ) { U[ p ] = vec4f( c.x, 0.0, 0.0, c.w ); return; }
	if ( ( P.flags & ${ FLAG_FRICTION }u ) != 0u ) {
		var rough = 0.02;
		if ( c.w > 0.0 ) { rough = 0.035; }
		let speed2 = c.y * c.y + c.z * c.z;
		if ( speed2 > 0.0 ) {
			let d = c.x; // the cell's own depth (WaterGrid.sources: the 2 cm floor let films outrun Manning)
			let drag = 1.0 + dt * G * rough * rough * sqrt( speed2 ) / ( d * d * pow( d, 1.0 / 3.0 ) );
			c.y /= drag;
			c.z /= drag;
		}
	}
	if ( ( P.flags & ${ FLAG_SPONGE }u ) != 0u ) {
		let edge = min( min( i, j ), min( n - 1u - i, n - 1u - j ) );
		if ( edge < 8u ) {
			var held = false;
			if ( ( P.flags & ${ FLAG_INFLOW }u ) != 0u ) { held = inflow( &c, i, j, edge ); }
			if ( !held ) {
				let a = 1.0 - f32( edge ) / 8.0;
				let damp = exp( -dt * 0.7 * a * a );
				let rest = max( 0.0, -c.w );
				c.x = rest + ( c.x - rest ) * damp;
				c.y *= damp;
				c.z *= damp;
			}
			if ( held ) { U[ p ] = c; return; }
		}
	}
	// WaterGrid.calmCell: the hand-back after the drain (Field.js tsunamiOver).
	if ( P.calmRate > 0.0 ) {
		if ( c.w > 0.0 ) {
			let next = max( 0.0, c.x - P.calmSoak * dt );
			var keep = 0.0;
			if ( next > WET ) { keep = next / c.x; }
			c = vec4f( next, c.yz * keep, c.w );
		} else {
			let rest = -c.w;
			let keep = exp( -dt * P.calmRate );
			c = vec4f( rest + ( c.x - rest ) * keep, c.yz * keep, c.w );
		}
	}
	U[ p ] = c;
}


// WaterGrid.nestToParent: the edge band (NEST_BAND 8 cells) relaxes to the parent's blended field, copied outright
// on the outer NEST_HARD 2. The CPU clamps the parent coordinate to pn - 1.000001, which is pn - 1 in f32, so the
// base cell is clamped to pn - 2 instead (same weights).
@compute @workgroup_size( ${ WORKGROUP } ) fn nestEdge( @builtin( global_invocation_id ) id : vec3u ) {
	let n = P.n;
	let p = id.x;
	if ( p >= n * n ) { return; }
	let i = p % n;
	let j = p / n;
	let edge = min( min( i, j ), min( n - 1u - i, n - 1u - j ) );
	if ( edge >= 8u ) { return; }
	let pn = P.pn;
	let top = f32( pn - 1u );
	let u = clamp( ( P.x0 + f32( i ) * P.dx - P.px ) / P.pdx, 0.0, top );
	let v = clamp( ( P.z0 + f32( j ) * P.dx - P.pz ) / P.pdx, 0.0, top );
	let pi = min( u32( floor( u ) ), pn - 2u );
	let pj = min( u32( floor( v ) ), pn - 2u );
	let fx = u - f32( pi );
	let fz = v - f32( pj );
	let b = 2u * pn * pn + pj * pn + pi;
	let s = mix( mix( PP[ b ], PP[ b + 1u ], fx ), mix( PP[ b + pn ], PP[ b + pn + 1u ], fx ), fz );
	var c = U[ p ];
	let goal = max( 0.0, s.x - c.w );
	var keep = 0.0;
	if ( edge >= 2u ) { let a = 1.0 - ( f32( edge ) - 2.0 ) / 6.0; keep = exp( -P.dt * 3.0 * a * a ); }
	c.x = goal + ( c.x - goal ) * keep;
	c.y = goal * s.y + ( c.y - goal * s.y ) * keep;
	c.z = goal * s.z + ( c.z - goal * s.z ) * keep;
	if ( c.x < WET ) { c.y = 0.0; c.z = 0.0; }
	U[ p ] = c;
}

// WaterGrid.pack in fixed-step mode: previous <- state, state <- ( surface, u, v, h ), wet over 2 mm.
@compute @workgroup_size( ${ WORKGROUP } ) fn packState( @builtin( global_invocation_id ) id : vec3u ) {
	let N = P.n * P.n;
	let p = id.x;
	if ( p >= N ) { return; }
	PK[ N + p ] = PK[ p ];
	let c = U[ p ];
	var o = vec4f( min( 0.0, c.w ), 0.0, 0.0, c.x );
	if ( c.x > 0.002 ) { o = vec4f( c.x + c.w, c.y / c.x, c.z / c.x, c.x ); }
	PK[ p ] = o;
}

// WaterGrid.blend: the field shown and sampled between the last two steps.
@compute @workgroup_size( ${ WORKGROUP } ) fn blendPixels( @builtin( global_invocation_id ) id : vec3u ) {
	let N = P.n * P.n;
	let p = id.x;
	if ( p >= N ) { return; }
	PK[ 2u * N + p ] = mix( PK[ N + p ], PK[ p ], clamp( P.alpha, 0.0, 1.0 ) );
}

// WaterGrid.stableStep's rate (1/s) for second order; positive floats order as their bits. Clear R first.
@compute @workgroup_size( ${ WORKGROUP } ) fn cflRate( @builtin( global_invocation_id ) id : vec3u ) {
	let p = id.x;
	if ( p >= P.n * P.n ) { return; }
	let c = U[ p ];
	if ( c.x <= WET ) { return; }
	let speed = sqrt( G * c.x );
	let u = abs( c.y ) / c.x;
	let v = abs( c.z ) / c.x;
	let r = max( ( u + v + 2.0 * speed ) / P.dx, 2.0 * ( max( u, v ) + speed ) / P.dx );
	atomicMax( &R[ 0 ], bitcast<u32>( r ) );
}
`;

const ENTRIES = [ 'slopes', 'faces', 'update1', 'update2', 'sources', 'nestEdge', 'packState', 'blendPixels', 'cflRate' ];
const kits = new WeakMap(); // device -> { layout, pipelines, dummy }

function kit( device ) {

	let k = kits.get( device );
	if ( k ) return k;
	const storage = ( binding, type ) => ( { binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } } );
	const layout = device.createBindGroupLayout( { label: 'waterGridGPU', entries: [
		{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: PARAM_BYTES } },
		storage( 1, 'storage' ), storage( 2, 'storage' ), storage( 3, 'storage' ), storage( 4, 'storage' ),
		storage( 5, 'read-only-storage' ), storage( 6, 'storage' ),
	] } );
	const module = device.createShaderModule( { label: 'waterGridGPU', code: CODE } );
	const pipelineLayout = device.createPipelineLayout( { bindGroupLayouts: [ layout ] } );
	const pipelines = {};
	for ( const entryPoint of ENTRIES ) pipelines[ entryPoint ] = device.createComputePipeline( { label: `waterGridGPU.${ entryPoint }`, layout: pipelineLayout, compute: { module, entryPoint } } );
	// A grid without a parent binds this in the parent's slot (the nest pass never runs on it).
	const dummy = device.createBuffer( { size: 16, usage: GPUBufferUsage.STORAGE } );
	k = { layout, pipelines, dummy };
	kits.set( device, k );
	return k;

}

export class WaterGridGPU {

	// grid: the host WaterGrid (geometry, bed, flags, inflow bookkeeping). parent: the ring's WaterGridGPU when the
	// host grid is nested (its PK pixels drive the nest pass).
	constructor( device, grid, { parent = null } = {} ) {

		this.device = device;
		this.grid = grid;
		this.parent = parent;
		const n = grid.n, N = n * n;
		this.n = n;
		this.N = N;
		this.groups = Math.ceil( N / WORKGROUP );
		const S = GPUBufferUsage.STORAGE, SRC = GPUBufferUsage.COPY_SRC, DST = GPUBufferUsage.COPY_DST;
		this.U = device.createBuffer( { label: 'waterGrid.U', size: N * 32, usage: S | SRC | DST } );
		this.S = device.createBuffer( { label: 'waterGrid.S', size: N * 32, usage: S } );
		this.F = device.createBuffer( { label: 'waterGrid.F', size: N * 32, usage: S } );
		this.PK = device.createBuffer( { label: 'waterGrid.PK', size: N * 48, usage: S | SRC | DST } );
		this.R = device.createBuffer( { label: 'waterGrid.R', size: 16, usage: S | SRC | DST } );
		this.uniform = device.createBuffer( { label: 'waterGrid.params', size: SLOT * ( MAX_SUBSTEPS + 1 ), usage: GPUBufferUsage.UNIFORM | DST } );
		this.params = new ArrayBuffer( SLOT * ( MAX_SUBSTEPS + 1 ) );
		this.views = Array.from( { length: MAX_SUBSTEPS + 1 }, ( _, slot ) => ( { u32: new Uint32Array( this.params, slot * SLOT, PARAM_BYTES / 4 ), f32: new Float32Array( this.params, slot * SLOT, PARAM_BYTES / 4 ) } ) );
		const { layout, dummy } = kit( device );
		this.bindGroup = device.createBindGroup( { layout, entries: [
			{ binding: 0, resource: { buffer: this.uniform, size: PARAM_BYTES } },
			{ binding: 1, resource: { buffer: this.U } },
			{ binding: 2, resource: { buffer: this.S } },
			{ binding: 3, resource: { buffer: this.F } },
			{ binding: 4, resource: { buffer: this.PK } },
			{ binding: 5, resource: { buffer: parent ? parent.PK : dummy } },
			{ binding: 6, resource: { buffer: this.R } },
		] } );
		this.scratch = new Float32Array( N * 4 );
		// Readback (CPU consumers): two MAP_READ buffers, each the pixels third of PK then the rate; a frame whose
		// buffers are both still mapping skips its copy, and the host keeps the last field it has (one or two frames late).
		this.staging = [ 0, 1 ].map( () => ( { buffer: device.createBuffer( { label: 'waterGrid.readback', size: N * 16 + 16, usage: GPUBufferUsage.MAP_READ | DST } ), busy: false } ) );
		this.rate = 0; // 1/s: the last CFL rate read back (0 until the first readback: stepSize() asks the host grid then)
		this.lag = 0; // s of game time not yet stepped (WaterGrid.advanceFixed's lag)
		this.readbacks = 0;
		// Host writes (a launch, an impulse) replace the GPU state through upload(); a readback copied before that
		// carries the old sea and must not land on the host after it (it put the calm sea back over a just-launched
		// wave for a frame). Each upload starts a new epoch and a readback from an older one is dropped.
		this.epoch = 0;
		this.upload();

	}

	// Host state -> GPU: the CPU launch and impulses write onto the host arrays, then upload once.
	upload() {

		const { grid, scratch: a, N } = this;
		this.epoch ++;
		for ( let k = 0; k < N; k ++ ) {

			a[ k * 4 ] = grid.h[ k ];
			a[ k * 4 + 1 ] = grid.qx[ k ];
			a[ k * 4 + 2 ] = grid.qz[ k ];
			a[ k * 4 + 3 ] = grid.bed[ k ];

		}
		this.device.queue.writeBuffer( this.U, 0, a );
		this.device.queue.writeBuffer( this.PK, 0, grid.state );
		this.device.queue.writeBuffer( this.PK, N * 16, grid.previous );
		this.device.queue.writeBuffer( this.PK, N * 32, grid.pixels );

	}

	writeParams( dt, alpha = 1, slot = 0, elapsed = this.grid.inflow?.elapsed ?? 0 ) {

		// Preallocated views per slot: no allocation in the frame (build rule 5).
		const { grid, parent } = this, inflow = grid.inflow, e = inflow?.e, { u32, f32 } = this.views[ slot ];
		const sponge = grid.sponge && ! grid.nest;
		u32[ 0 ] = grid.n;
		u32[ 1 ] = parent ? parent.n : 0;
		u32[ 2 ] = ( grid.friction ? FLAG_FRICTION : 0 ) | ( sponge ? FLAG_SPONGE : 0 ) | ( sponge && inflow ? FLAG_INFLOW : 0 );
		f32[ 4 ] = dt; f32[ 5 ] = dt / grid.dx; f32[ 6 ] = grid.dx; f32[ 7 ] = alpha;
		f32[ 28 ] = grid.calm ? grid.calm.rate : 0; f32[ 29 ] = grid.calm ? grid.calm.soak : 0; // the hand-back (WaterGrid.calmCell)
		f32[ 8 ] = grid.x; f32[ 9 ] = grid.z;
		f32[ 10 ] = parent ? parent.grid.x : 0; f32[ 11 ] = parent ? parent.grid.z : 0; f32[ 12 ] = parent ? parent.grid.dx : 1;
		if ( e ) {

			f32[ 13 ] = elapsed; f32[ 14 ] = e.launchDistance; f32[ 15 ] = e.farField?.speed ?? 0;
			f32[ 16 ] = e.x; f32[ 17 ] = e.z; f32[ 18 ] = inflow.c; f32[ 19 ] = inflow.s;
			f32[ 20 ] = e.crestWidth ?? e.width; f32[ 21 ] = e.radius; f32[ 22 ] = e.crestHalfLength ?? 0; f32[ 23 ] = e.farField?.length ?? 0;
			f32[ 24 ] = e.troughLead ?? 2.2; f32[ 25 ] = e.drawdown ?? 0; f32[ 26 ] = e.intensity; f32[ 27 ] = e.farField ? 1 : 0; // 2.2: WaterGrid TROUGH_LEAD

		}
		this.device.queue.writeBuffer( this.uniform, slot * SLOT, this.params, slot * SLOT, PARAM_BYTES );

	}

	// Record one solver step of dt s (WaterGrid.step's maths, without the host bookkeeping) and submit it.
	encodeStep( dt ) {

		this.writeParams( dt );
		const { pipelines } = kit( this.device ), encoder = this.device.createCommandEncoder( { label: 'waterGridGPU.step' } );
		const pass = encoder.beginComputePass();
		this.recordStep( pass, pipelines, 0 );
		pass.end();
		this.device.queue.submit( [ encoder.finish() ] );

	}

	// The step's nine dispatches (WaterGrid.step: stepSecond's two stages, sources, nestToParent, pack) with the
	// parameters in `slot`.
	recordStep( pass, pipelines, slot ) {

		pass.setBindGroup( 0, this.bindGroup, [ slot * SLOT ] );
		const run = name => {

			pass.setPipeline( pipelines[ name ] );
			pass.dispatchWorkgroups( this.groups );

		};
		run( 'slopes' ); run( 'faces' ); run( 'update1' );
		run( 'slopes' ); run( 'faces' ); run( 'update2' );
		run( 'sources' );
		if ( this.grid.nest && this.parent ) run( 'nestEdge' );
		run( 'packState' );

	}

	// The step (s) this frame takes: 0.45 / rate as WaterGrid.stableStep, from the GPU rate read back a frame late
	// (with STEP_MARGIN), or from the host grid before the first readback (its state is the uploaded one).
	stepSize() {

		const rate = this.rate > 0 ? this.rate : null;
		return rate ? STEP_MARGIN * 0.45 / Math.max( 1, rate ) : this.grid.stableStep();

	}

	// One frame (WaterGrid.advanceFixed on the GPU): whole steps from the lag, at most MAX_SUBSTEPS, then the blend,
	// the CFL rate and the readback copy, in one submit. Returns the steps taken.
	advance( dt ) {

		const grid = this.grid;
		if ( ! Number.isFinite( dt ) || dt <= 0 ) return 0;
		grid.stats.droppedTime += Math.max( 0, dt - grid.maxInterval );
		this.lag += Math.min( dt, grid.maxInterval );
		const step = this.stepSize();
		let steps = Math.floor( this.lag / step );
		if ( steps > MAX_SUBSTEPS ) {

			grid.stats.droppedTime += ( steps - MAX_SUBSTEPS ) * step;
			this.lag -= ( steps - MAX_SUBSTEPS ) * step;
			steps = MAX_SUBSTEPS;

		}
		let elapsed = grid.inflow?.elapsed ?? 0;
		for ( let s = 0; s < steps; s ++ ) {

			this.writeParams( step, 1, s, elapsed );
			elapsed += step;

		}
		this.lag -= steps * step;
		this.writeParams( step, this.lag / step, MAX_SUBSTEPS, elapsed );
		const { pipelines } = kit( this.device ), encoder = this.device.createCommandEncoder( { label: 'waterGridGPU.frame' } );
		encoder.clearBuffer( this.R );
		const pass = encoder.beginComputePass();
		for ( let s = 0; s < steps; s ++ ) this.recordStep( pass, pipelines, s );
		pass.setBindGroup( 0, this.bindGroup, [ MAX_SUBSTEPS * SLOT ] );
		pass.setPipeline( pipelines.blendPixels );
		pass.dispatchWorkgroups( this.groups );
		pass.setPipeline( pipelines.cflRate );
		pass.dispatchWorkgroups( this.groups );
		pass.end();
		const [ a, b ] = this.staging, free = a.busy ? ( b.busy ? null : b ) : a;
		if ( free ) {

			encoder.copyBufferToBuffer( this.PK, this.N * 32, free.buffer, 0, this.N * 16 );
			encoder.copyBufferToBuffer( this.R, 0, free.buffer, this.N * 16, 16 );

		}
		this.device.queue.submit( [ encoder.finish() ] );
		if ( free ) this.readback( free );
		if ( grid.inflow ) grid.inflow.elapsed = elapsed;
		grid.time += steps * step;
		grid.stats.steps += steps;
		grid.stats.lastSubsteps = steps;
		grid.stats.maxSubsteps = Math.max( grid.stats.maxSubsteps ?? 0, steps );
		return steps;

	}

	// Resolve one readback into the host grid: pixels in the same layout (so WaterGrid.sample, Field.sample and
	// every consumer read it unchanged), h and q from them (floods(), landWithin(), a launch and a CPU fallback),
	// and the CFL rate. Never awaited by the frame. A non-finite rate keeps the last one (WaterGrid.stableStep throws).
	readback( slot ) {

		slot.busy = true;
		const epoch = this.epoch;
		this.pending = slot.buffer.mapAsync( GPUMapMode.READ ).then( () => {

			if ( epoch !== this.epoch ) {

				slot.buffer.unmap();
				slot.busy = false;
				return;

			}
			const range = slot.buffer.getMappedRange(), grid = this.grid, N = this.N, data = new Float32Array( range, 0, N * 4 );
			grid.pixels.set( data.subarray( 0, N * 4 ) );
			let inundated = 0, minSurface = 0, maxSurface = 0, landFlow = 0, landMoving = 0, landWet = 0, seaOff = 0;
			for ( let k = 0; k < N; k ++ ) {

				const depth = data[ k * 4 + 3 ], bed = grid.bed[ k ];
				grid.h[ k ] = depth;
				grid.qx[ k ] = data[ k * 4 + 1 ] * depth;
				grid.qz[ k ] = data[ k * 4 + 2 ] * depth;
				if ( bed > 0 && depth > 0.1 ) inundated ++; // INUNDATION_DEPTH
				// WaterGrid.pack's drain state (Field.js tsunamiOver), from the same pixels every CPU consumer reads.
				// The parent's cells under the nested grid are left out (WaterGrid.nestIn: the nested grid draws there).
				if ( grid.covered?.[ k ] ) {
				} else if ( bed > 0 ) {

					if ( depth > 0.002 ) {

						const q = Math.hypot( grid.qx[ k ], grid.qz[ k ] );
						landWet ++;
						if ( q > landFlow ) landFlow = q;
						if ( depth > 0.1 && q > STILL_SPEED * depth ) landMoving ++;

					}

				} else if ( depth > 0 ) seaOff = Math.max( seaOff, Math.abs( depth + bed ) );
				minSurface = Math.min( minSurface, data[ k * 4 ] );
				maxSurface = Math.max( maxSurface, data[ k * 4 ] );

			}
			const rate = new Float32Array( range, N * 16, 1 )[ 0 ]; // the max rate's bits, read as the float they are
			if ( Number.isFinite( rate ) && rate > 0 ) this.rate = rate;
			grid.stats.inundatedArea = inundated * grid.dx * grid.dx;
			grid.stats.minSurface = minSurface;
			grid.stats.maxSurface = maxSurface;
			grid.drainStats( landFlow, landMoving, landWet, seaOff );
			grid.version ++;
			this.readbacks ++;
			slot.buffer.unmap();
			slot.busy = false;

		} ).catch( () => {

			// destroy() (the event stopped) or a lost device while this copy was mapping: the host keeps the
			// last field it has, and Field falls back to the host grid on a lost device (Field.attachGPU)
			slot.busy = false;

		} );

	}

	// One step plus the host bookkeeping WaterGrid.step keeps (inflow clock, time, step count).
	step( dt ) {

		this.encodeStep( dt );
		const grid = this.grid;
		if ( grid.inflow ) grid.inflow.elapsed += dt;
		grid.time += dt;
		grid.stats.steps ++;

	}

	// The state ( h, qx, qz, bed ) per cell, for tests and the CPU fallback.
	readState() {

		return this.readBuffer( this.U, 0, this.N * 16 );

	}

	// The pixels ( surface, ux, uz, depth ) the renderer and the readback see, for tests.
	readPixels() {

		return this.readBuffer( this.PK, this.N * 32, this.N * 16 );

	}

	async readBuffer( source, offset, bytes ) {

		const device = this.device;
		const staging = device.createBuffer( { size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST } );
		const encoder = device.createCommandEncoder();
		encoder.copyBufferToBuffer( source, offset, staging, 0, bytes );
		device.queue.submit( [ encoder.finish() ] );
		await staging.mapAsync( GPUMapMode.READ );
		const out = new Float32Array( staging.getMappedRange().slice( 0 ) );
		staging.unmap();
		staging.destroy();
		return out;

	}

	destroy() {

		for ( const b of [ this.U, this.S, this.F, this.PK, this.R, this.uniform, ...this.staging.map( s => s.buffer ) ] ) b.destroy();

	}

}
