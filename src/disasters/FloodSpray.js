import { Vector3 } from '../engine/index.js';
import { GPU, StorageBuffer, UniformBlock, ShaderModule, ComputeKernel, Readback, commonModule } from '../engine/webgpu.js';
import { GRAVITY, G } from '../engine/render/Frame.js';
import { SPRAY_FLOOD_TAG } from '../fx/Spray.js';
import { FOAM_TURBID } from './FloodLook.js';

// White water, spray and mist thrown by a flood (docs/disasters.md "Spray and mist").
//
// A tsunami runs ashore as a turbulent bore: a wall of white water with spray thrown ahead of it and above it, and a
// haze of fine drops hanging over it and over every fast, shallow sheet behind it (Tohoku 2011: the front crossing the
// Sendai plain, the water going over the Miyako seawall; Khao Lak 2004). Three things throw water into the air:
//   the breaking face: the roller of a bore lifts spray of the order of its own jump (Chanson 2009, Eur. J. Mech. B 28)
//   an obstacle: fast flow stopped by rising ground or a wall climbs its stagnation head, u^2 / 2g (Bernoulli)
//   the leading edge: the thin, fast snout of a surge running over dry ground
// and one model turns each into particles: a source is a strength (0..1) and a jump (m, the height of the water
// that breaks or stops); see emission().
//
// The emitter is one compute dispatch of CANDIDATES points a frame, only while a flood grid is live. The candidates
// are laid out log-polar around the camera (ANGLES x RINGS, NEAR to FAR m, jittered every frame), so each stands for
// r^2 x dtheta x dln r of ground: about 1 m^2 at 10 m, 100 m^2 at 100 m, a hectare at 1 km. Detail follows the eye
// with no second system: near the camera many small sprites and clear drops, far away a few big ones of the same
// total area. Each candidate reads the flood's look (Water.js disasterLookAt: five bilinear samples of the packed
// solver state) and two terrain heights, and writes at most MAX_SPRAY + MAX_MIST + MAX_DROPS particles.
//
// The particles live in the spray system's own flood region (fx/Spray.js: floodCapacity slots after the surf's ring
// and the CPU part), not in the ring the shore breakers feed. The breakers steer the shared head to turn that ring
// over about every 2 s; flood mist lives up to MIST_LIFE[ 1 ] s, so in one ring each emitter would overwrite the
// other's live sprites. The region has its own head, read back (4 bytes a frame) to steer the emission so the region
// never wraps inside the longest life in flight (the breakers' own rule, Breakers._budget).
//
// Units: metres, seconds, m/s. Sea level is y = 0. Randomness: the spray system's per-frame hash plus the event's seed.

const clamp = ( x, a, b ) => Math.min( b, Math.max( a, x ) );
const smoothstep = ( a, b, x ) => { const t = clamp( ( x - a ) / ( b - a ), 0, 1 ); return t * t * ( 3 - 2 * t ); };
const f = ( x ) => { const s = String( x ); return /[.e]/.test( s ) ? s : s + '.0'; };

// ---- the emission model: one for every source (JS for the tests, WGSL for the kernel, the same constants)
// Thrown to this many jump heights. Declared, the violent end of the band: the spray region over a breaking roller
// reaches one to two roller heights (Chanson 2009), and a flow stopped by a wall throws far above its stagnation head.
export const THROW_HEIGHTS = 1.5;
export const RADIUS_PER_JUMP = 0.3; // m of sprite radius per m of jump: a sprite is a cloud of drops, a third of the wall
export const SPRAY_RADIUS = [ 0.12, 14 ]; // m: under 12 cm it is drops, not a cloud; over 14 m one sprite fills the view
export const SPRAY_LIFE = [ 0.7, 7 ]; // s: the ballistic flight up and back, clamped
export const CURTAIN_HEIGHTS = 3; // jump heights of curtain standing on the face: the face, and 1.5 thrown over it, rounded up
export const FACE_CELLS = 1.5; // grid cells: the width on the ground of the band the classifier calls breaking
export const COVER = 0.9; // live sprite area over the curtain's area: the face is covered about once over (at 1.2 it was a solid white ribbon)
// Mist: what is left of the spray, bigger, fainter, longer lived, drifting with the wind.
export const MIST_RADIUS = 2.5; // x the spray sprite's radius
export const MIST_RADIUS_MAX = 36; // m
export const MIST_LIFE_SCALE = 2; // x the spray sprite's life
export const MIST_LIFE = [ 2.5, 9 ]; // s
export const MIST_COVER = 1.2; // mist sprite area over the curtain's area (a sprite is about 10 % opaque: a haze; at 2 a fog bank hid the wave)
// Sources.
export const WET = 0.03; // m: shallower water throws nothing
export const HIT_STEP = 3; // m: the ground's rise is taken over this distance along the flow
export const HIT_RISE = [ 0.25, 0.7 ]; // m/m: a beach (under 1 in 8) is run up, not hit; a bank, a berm or a wall is
export const HIT_SPEED = [ 2, 6 ]; // m/s
export const EDGE_SPEED = [ 1, 3 ]; // m/s: slower than this the edge creeps
export const EDGE_STRENGTH = 0.7;
export const EDGE_HEAD = 0.25; // of the stagnation head, added to the snout's depth as its jump
export const SHEET_SPEED = [ 4, 9 ]; // m/s: fast shallow flow smokes (mist only)
export const SHEET_DEPTH = [ 3, 0.5 ]; // m: deeper than 3 m the surface is too far from the bed's turbulence
export const SHEET_COVER = 0.2; // mist sprite area over the sheet's own area
// Candidates and detail by distance.
export const ANGLES = 64, RINGS = 64, CANDIDATES = ANGLES * RINGS;
export const NEAR = 4, FAR = 2500; // m from the camera
export const PIXEL_FLOOR = 0.003; // rad: a sprite is never smaller than this at its distance (about 3 px at 900 lines)
export const NEAR_CAP = 0.3; // a sprite's radius never exceeds this much of its distance (one sprite never walls off the view)
export const MAX_SPRAY = 6, MAX_MIST = 3, MAX_DROPS = 12; // particles a candidate writes in one frame
export const DROPS_PER_SPRAY = 6; // clear drops and ligaments thrown with each cloud, near the camera
export const DROP_RANGE = 90; // m: beyond it a drop is far under a pixel
export const SPRAY_RANGE = 2600; // m: flood sprites fade out by this distance (the surf's fade out by 320 m)
export const MIST_OPACITY = 1.8; // x the surf mist's 6 %: a haze over a front is seen through few, large sprites (at 3 it read as cloud)
// Budget.
export const BUDGET_MIN = 0.02, BUDGET_GAIN = 0.04; // the emission scale's floor, and how fast it is steered (per frame)
export const LINGER = MIST_LIFE[ 1 ] * 1.25 + 1; // s after the last live frame until every sprite thrown has died

// A source of strength (0..1) and jump (m) on a grid of `cell` m. floor and cap (m) bound the sprite radius by its
// distance from the eye. Fills out.radius (m), out.launch (m/s, straight up: reaches THROW_HEIGHTS x jump), out.life
// (s, the flight up and back) and out.rate (sprites per m^2 of breaking ground per second): chosen so the live
// sprites cover the curtain COVER times, which gives fewer, bigger, longer-lived sprites as the wave grows.
export function emission( jump, strength, cell, floor = 0, cap = Infinity, out = {} ) {

	const J = Math.max( jump, 0 );
	out.launch = Math.sqrt( 2 * GRAVITY * THROW_HEIGHTS * J );
	out.life = clamp( 2 * out.launch / GRAVITY, SPRAY_LIFE[ 0 ], SPRAY_LIFE[ 1 ] );
	out.radius = Math.max( SPRAY_RADIUS[ 0 ], Math.min( Math.max( RADIUS_PER_JUMP * J, floor ), SPRAY_RADIUS[ 1 ], cap ) );
	// the curtain over 1 m2 of breaking ground: CURTAIN_HEIGHTS jumps tall, on 1 / ( FACE_CELLS x cell ) m of face
	const curtain = CURTAIN_HEIGHTS * J / ( FACE_CELLS * cell );
	out.rate = strength * COVER * curtain / ( Math.PI * out.radius * out.radius * out.life );
	return out;

}

// The mist thrown with a source's spray: fills out.radius (m), out.life (s), out.rate (per m^2 per s).
export function mist( e, out = {} ) {

	out.radius = Math.min( MIST_RADIUS * e.radius, MIST_RADIUS_MAX );
	out.life = clamp( MIST_LIFE_SCALE * e.life, MIST_LIFE[ 0 ], MIST_LIFE[ 1 ] );
	out.rate = e.rate > 0 ? e.rate * ( MIST_COVER / COVER ) * ( e.radius * e.radius * e.life ) / ( out.radius * out.radius * out.life ) : 0;
	return out;

}

// What throws water at a point of the flood: depth (m), speed (m/s), the bore's breaking (0..1) and jump (m)
// (FloodLook.classifyBore), crest (the far wall's crest band, 1 elsewhere), rise (m/m, the ground's rise along the
// flow over HIT_STEP), dryAhead (the next grid cell along the flow is dry). The strongest thrower wins, by the water
// it lifts (strength x jump). Fills out.kind (0 none, 1 face, 2 obstacle, 3 leading edge), out.strength, out.jump and
// out.sheet (0..1, mist over fast shallow flow).
export function source( depth, speed, breaking, jump, crest, rise, dryAhead, out = {} ) {

	out.kind = 0;
	out.strength = out.jump = out.sheet = 0;
	if ( ! ( depth > WET ) ) return out;
	const head = speed * speed / ( 2 * GRAVITY ); // m: the height the flow climbs when it is stopped
	const deep = smoothstep( WET, 0.4, depth ); // a film has no water to throw
	const face = breaking * crest;
	const hit = smoothstep( HIT_RISE[ 0 ], HIT_RISE[ 1 ], rise ) * smoothstep( HIT_SPEED[ 0 ], HIT_SPEED[ 1 ], speed ) * deep;
	const edge = dryAhead ? EDGE_STRENGTH * smoothstep( EDGE_SPEED[ 0 ], EDGE_SPEED[ 1 ], speed ) : 0;
	const edgeJump = depth + EDGE_HEAD * head;
	if ( face * jump > 0 ) { out.kind = 1; out.strength = face; out.jump = jump; }
	if ( hit * head > out.strength * out.jump ) { out.kind = 2; out.strength = hit; out.jump = head; }
	if ( edge * edgeJump > out.strength * out.jump ) { out.kind = 3; out.strength = edge; out.jump = edgeJump; }
	out.sheet = smoothstep( SHEET_SPEED[ 0 ], SHEET_SPEED[ 1 ], speed ) * smoothstep( SHEET_DEPTH[ 0 ], SHEET_DEPTH[ 1 ], depth ) * deep;
	return out;

}

// More sprites than `cap` from one candidate in one frame become `cap` bigger ones of the same total area.
export function resolve( expected, radius, cap, max, out = {} ) {

	out.radius = Math.min( radius * Math.max( 1, Math.sqrt( expected / cap ) ), max );
	out.count = Math.min( expected, cap );
	return out;

}

// Ring r of the candidate layout: its radius (m) at jitter j (0..1) and the ground one candidate there stands for (m^2).
const DTHETA = 2 * Math.PI / ANGLES, DLNR = Math.log( FAR / NEAR ) / RINGS;
export const candidateRadius = ( ring, j = 0.5 ) => NEAR * Math.exp( ( ring + j ) * DLNR );
export const candidateArea = ( r ) => r * r * DTHETA * DLNR;

// One step of the budget: k the emission scale now, rate the particles per second the region's head moved at, target
// the rate that fills the region once per longest life. The breakers' rule: the square root damps the loop.
export function steer( k, rate, target ) {

	const want = rate > 1 ? k * Math.sqrt( target / rate ) : 1;
	return clamp( k + ( want - k ) * BUDGET_GAIN, BUDGET_MIN, 1 );

}

// s: the longest life in flight for a wave of height H (m): its mist, with the life jitter the kernel applies.
export function ringSeconds( H ) {

	const life = clamp( 2 * Math.sqrt( 2 * GRAVITY * THROW_HEIGHTS * Math.max( H, 0 ) ) / GRAVITY, SPRAY_LIFE[ 0 ], SPRAY_LIFE[ 1 ] );
	return clamp( MIST_LIFE_SCALE * life, MIST_LIFE[ 0 ], MIST_LIFE[ 1 ] ) * 1.25;

}

// The WGSL twin of emission(), mist() and source(), from the same constants.
export const FLOOD_SPRAY_WGSL = /* wgsl */`
struct FloodSprayEmission { radius: f32, launch: f32, life: f32, rate: f32 }
fn floodSprayEmission( jump: f32, strength: f32, cell: f32, floorR: f32, capR: f32 ) -> FloodSprayEmission {
	var e: FloodSprayEmission;
	let J = max( jump, 0.0 );
	e.launch = sqrt( ${ f( 2 * GRAVITY * THROW_HEIGHTS ) } * J );
	e.life = clamp( 2.0 * e.launch / ${ f( GRAVITY ) }, ${ f( SPRAY_LIFE[ 0 ] ) }, ${ f( SPRAY_LIFE[ 1 ] ) } );
	e.radius = max( ${ f( SPRAY_RADIUS[ 0 ] ) }, min( min( max( ${ f( RADIUS_PER_JUMP ) } * J, floorR ), ${ f( SPRAY_RADIUS[ 1 ] ) } ), capR ) );
	let curtain = ${ f( CURTAIN_HEIGHTS ) } * J / ( ${ f( FACE_CELLS ) } * cell );
	e.rate = strength * ${ f( COVER ) } * curtain / ( PI * e.radius * e.radius * e.life );
	return e;
}
// ( radius m, life s, rate per m2 per s ) of the mist thrown with e's spray
fn floodSprayMist( e: FloodSprayEmission ) -> vec3f {
	let r = min( ${ f( MIST_RADIUS ) } * e.radius, ${ f( MIST_RADIUS_MAX ) } );
	let life = clamp( ${ f( MIST_LIFE_SCALE ) } * e.life, ${ f( MIST_LIFE[ 0 ] ) }, ${ f( MIST_LIFE[ 1 ] ) } );
	return vec3f( r, life, e.rate * ${ f( MIST_COVER / COVER ) } * ( e.radius * e.radius * e.life ) / ( r * r * life ) );
}
// ( kind: 0 none, 1 face, 2 obstacle, 3 leading edge; strength; jump m; sheet 0..1 )
fn floodSpraySource( depth: f32, speed: f32, breaking: f32, jump: f32, crest: f32, rise: f32, dryAhead: bool ) -> vec4f {
	if ( depth <= ${ f( WET ) } ) { return vec4f( 0.0 ); }
	let head = speed * speed / ${ f( 2 * GRAVITY ) };
	let deep = smoothstep( ${ f( WET ) }, 0.4, depth );
	let face = breaking * crest;
	let hit = smoothstep( ${ f( HIT_RISE[ 0 ] ) }, ${ f( HIT_RISE[ 1 ] ) }, rise ) * smoothstep( ${ f( HIT_SPEED[ 0 ] ) }, ${ f( HIT_SPEED[ 1 ] ) }, speed ) * deep;
	let edge = select( 0.0, ${ f( EDGE_STRENGTH ) } * smoothstep( ${ f( EDGE_SPEED[ 0 ] ) }, ${ f( EDGE_SPEED[ 1 ] ) }, speed ), dryAhead );
	let edgeJump = depth + ${ f( EDGE_HEAD ) } * head;
	var o = vec4f( 0.0 );
	if ( face * jump > 0.0 ) { o = vec4f( 1.0, face, jump, 0.0 ); }
	if ( hit * head > o.y * o.z ) { o = vec4f( 2.0, hit, head, 0.0 ); }
	if ( edge * edgeJump > o.y * o.z ) { o = vec4f( 3.0, edge, edgeJump, 0.0 ); }
	o.w = smoothstep( ${ f( SHEET_SPEED[ 0 ] ) }, ${ f( SHEET_SPEED[ 1 ] ) }, speed ) * smoothstep( ${ f( SHEET_DEPTH[ 0 ] ) }, ${ f( SHEET_DEPTH[ 1 ] ) }, depth ) * deep;
	return o;
}
`;

export class FloodSpray {

	// spray: the shared particle system (fx/Spray.js, its flood region); water: DisasterWater (Water.js: the module
	// with disasterLookAt, disasterSample, disasterCell and, through it, terrainHeightAt)
	constructor( { spray, water } ) {

		this.spray = spray;
		this.water = water;
		this.uniforms = new UniformBlock( 'FloodSprayParams', {
			cameraPos: [ 'vec3f', new Vector3() ],
			gain: [ 'f32', 1 ], // emission multiplier
			budget: [ 'f32', 0.5 ], // emission scale that keeps the flood region from wrapping (see _budget)
			eventSeed: [ 'u32', 0 ], // the running event's seed: every event's spray falls differently
		}, { label: 'flood spray' } );
		const F = this.uniforms.fields;
		this.params = { spray: F.gain };
		this.cameraPos = F.cameraPos;
		// ring head of the flood region (particles reserved so far, wraps with the uint)
		this.head = new StorageBuffer( { label: 'floodSprayHead', count: 1, type: 'u32' } );
		this.kernel = null; // built on the first frame a flood grid is live
		// how the sprite shader draws flood particles: seen from across the bay, beige-grey over sediment (the foam's
		// own tint, FloodLook.FOAM_TURBID), mist as a haze
		if ( spray.params.floodMaxDistance ) {

			spray.params.floodMaxDistance.value = SPRAY_RANGE;
			spray.params.floodTint.value.set( FOAM_TURBID[ 0 ], FOAM_TURBID[ 1 ], FOAM_TURBID[ 2 ] );
			spray.params.floodMist.value = MIST_OPACITY;

		}
		this.lastLive = - Infinity; // simulation time (s) of the last frame with a flood grid
		// telemetry (docs, bench): the region's emission rate (particles/s) and the budget steering it
		this.stats = { rate: 0, budget: F.budget.value, target: 0, dispatches: 0 };

	}

	// camera: the scene camera; field: the DisasterField (or null). Called once a frame, before spray.update().
	update( camera, field ) {

		const now = G.time.value;
		const live = !! ( field && field.water );
		if ( live ) this.lastLive = now;
		// The region is simulated and drawn from the first live frame until the last sprite thrown has died; otherwise
		// the spray system runs exactly its own slots (no flood: no dispatch here, nothing more there).
		const age = now - this.lastLive;
		this.spray.setFloodLive( live || ( age >= 0 && age < LINGER ) );
		if ( ! live ) return;
		if ( ! this.kernel ) this._build();
		const e = field.events.get( 'tsunami' ), F = this.uniforms.fields;
		this.cameraPos.value.copy( camera.position );
		F.eventSeed.value = ( e?.seed ?? 0 ) >>> 0;
		this.kernel.dispatch( Math.ceil( CANDIDATES / 64 ) );
		this.stats.dispatches ++;
		this._budget( e ? e.intensity : 1 );

	}

	// Emission budget, as the breakers keep theirs: the head is read back a few frames late and the emission scale is
	// steered so the region is filled once per longest life in flight. Faster, the ring wraps and live sprites pop out.
	_budget( H ) {

		if ( ! this._rb ) {

			this._rb = new Readback( { byteLength: 4, ring: 3, label: 'floodSprayHead' } );
			// simulation time of the last 8 GPU frames a readback was asked on (a readback returns a few frames late)
			this._asked = new Int32Array( 8 ).fill( - 1 );
			this._askedT = new Float64Array( 8 );
			// two anchors ( head, time ), 1.25 s apart: the rate is taken from the older one, over 1.25 to 2.5 s
			this._anchor = new Float64Array( [ 0, - 1, 0, - 1 ] );
			this._seen = - 1;
			this._rb.onData = ( data, frame ) => {

				const slot = frame & 7;
				if ( this._asked[ slot ] !== frame ) return;
				this._headNow = new Uint32Array( data )[ 0 ];
				this._headT = this._askedT[ slot ];
				this._seen = frame;

			};

		}
		if ( this._rb.request( this.head ) ) {

			this._asked[ GPU.frame & 7 ] = GPU.frame;
			this._askedT[ GPU.frame & 7 ] = G.time.value;

		}
		if ( this._seen < 0 ) return;
		const A = this._anchor, head = this._headNow, now = this._headT;
		if ( A[ 3 ] < 0 || now < A[ 3 ] ) { A[ 0 ] = A[ 2 ] = head; A[ 1 ] = A[ 3 ] = now; return; } // first read, or the clock went back
		if ( now - A[ 3 ] >= 1.25 ) { A[ 0 ] = A[ 2 ]; A[ 1 ] = A[ 3 ]; A[ 2 ] = head; A[ 3 ] = now; }
		const dt = now - A[ 1 ];
		if ( ! ( dt > 1.0 ) ) return;
		const k = this.uniforms.fields.budget, S = this.stats;
		S.rate = ( ( head - A[ 0 ] ) >>> 0 ) / dt; // particles / s (uint wrap safe)
		S.target = this.spray.NF / ringSeconds( H );
		S.budget = k.value = steer( k.value, S.rate, S.target );

	}

	_build() {

		const sp = this.spray;
		const code = /* wgsl */`
const FS_CANDIDATES: u32 = ${ CANDIDATES }u;
const FS_ANGLES: u32 = ${ ANGLES }u;
const FS_BASE: u32 = ${ sp.NG + sp.NC }u; // the flood region follows the surf's ring and the CPU part
const FS_SLOTS: u32 = ${ sp.NF }u; // power of two
const FS_TAG: f32 = ${ f( SPRAY_FLOOD_TAG ) };

fn floodSprayReserve( n: u32 ) -> u32 { return atomicAdd( &floodSprayHead[ 0 ], n ); }
fn floodSpraySlot( base: u32, i: u32 ) -> u32 { return FS_BASE + ( ( base + i ) & ( FS_SLOTS - 1u ) ); }

${ FLOOD_SPRAY_WGSL }

@compute @workgroup_size( WG_X, 1, 1 )
fn main( @builtin( global_invocation_id ) gid: vec3u ) {
	let id = gid.x;
	if ( id >= FS_CANDIDATES ) { return; }
	let seed = id * 7919u + floodSprayP.eventSeed * 31u;
	// this candidate's jittered log-polar cell around the camera and the ground it stands for (m2)
	let theta = ( f32( id % FS_ANGLES ) + sprayRand( seed, 1u ) ) * ${ f( DTHETA ) };
	let rr = ${ f( NEAR ) } * exp( ( f32( id / FS_ANGLES ) + sprayRand( seed, 2u ) ) * ${ f( DLNR ) } );
	let p = floodSprayP.cameraPos.xz + vec2f( cos( theta ), sin( theta ) ) * rr;
	let area = rr * rr * ${ f( DTHETA * DLNR ) };

	let l = disasterLookAt( p );
	let speed = length( l.flow );
	if ( l.depth <= ${ f( WET ) } || speed < 0.3 ) { return; }
	let dir = l.flow / speed;
	let cell = disasterCell( p );
	let ground = terrainHeightAt( p );
	let rise = max( terrainHeightAt( p + dir * ${ f( HIT_STEP ) } ) - ground, 0.0 ) / ${ f( HIT_STEP ) };
	let dryAhead = disasterSample( p + dir * cell ).w <= 0.002;
	let src = floodSpraySource( l.depth, speed, l.bore.x, l.bore.z, l.crest, rise, dryAhead );
	if ( src.y <= 0.0 && src.w <= 0.0 ) { return; }

	let isFace = src.x > 0.5 && src.x < 1.5;
	let isHit = src.x > 1.5 && src.x < 2.5;
	let surfaceY = max( l.height, ground );
	let dist = max( length( vec3f( p.x, surfaceY, p.y ) - floodSprayP.cameraPos ), 1.0 );
	// detail by distance: never under a few pixels (far sprites merge), never a wall across the view (near ones split)
	let floorR = ${ f( PIXEL_FLOOR ) } * dist;
	let capR = max( ${ f( SPRAY_RADIUS[ 0 ] ) }, ${ f( NEAR_CAP ) } * dist );
	let e = floodSprayEmission( src.z, src.y, cell, floorR, capR );
	let gain = floodSprayP.gain * floodSprayP.budget * frame.dt * area;
	let d3 = vec3f( dir.x, 0.0, dir.y );
	let t3 = vec3f( - dir.y, 0.0, dir.x );
	let up = vec3f( 0.0, 1.0, 0.0 );
	// along the face and through the band, inside the candidate's own footprint and the grid cell the look holds for
	let span = min( sqrt( area ), cell );
	// integer part: a flood particle, with the sediment in the water that threw it (0..15); fraction: random
	let tag = FS_TAG + floor( clamp( l.turbid, 0.0, 1.0 ) * 15.0 + 0.5 );

	// ---- dense spray: the white water thrown off the face, up an obstacle, off the leading edge
	let wantS = e.rate * gain;
	let nS = u32( floor( min( wantS, ${ f( MAX_SPRAY ) } ) + sprayRand( seed, 3u ) ) );
	if ( src.y > 0.0 && nS > 0u ) {
		let rS = min( e.radius * max( 1.0, sqrt( wantS / ${ f( MAX_SPRAY ) } ) ), ${ f( SPRAY_RADIUS[ 1 ] ) } );
		let base = floodSprayReserve( nS );
		for ( var j = 0u; j < nS; j++ ) {
			let h = seed + j * 29u;
			let r0 = sprayRand( h, 11u );
			let r1 = sprayRand( h, 12u );
			let r2 = sprayRand( h, 13u );
			let r3 = sprayRand( h, 14u );
			let r4 = sprayRand( h, 15u );
			// (heavy-tailed sizes: many small torn sheets, a few big ones; never a row of equal puffs)
			let size = rS * ( 0.55 + r2 * r2 * 1.1 );
			let q = p + t3.xz * ( ( r0 - 0.5 ) * span ) + dir * ( ( r1 - 0.5 ) * span );
			let y = surfaceY + size * 0.3 + r3 * src.z * 0.4;
			// thrown up to THROW_HEIGHTS jumps (heights spread evenly), ahead of the face faster than the water behind
			// it; an obstacle stops the flow and sends it up; the edge runs on
			let vUp = e.launch * sqrt( mix( 0.12, 1.0, r4 ) );
			let vFwd = select( select( speed * ( 1.0 + 0.3 * r1 ), speed * 0.25, isHit ), speed * ( 0.9 + 0.5 * r1 ), isFace );
			let v = d3 * vFwd + t3 * ( ( r0 - 0.5 ) * 0.3 * e.launch ) + up * vUp;
			sprayWrite( floodSpraySlot( base, j ), vec3f( q.x, y, q.y ), v, size, SPRAY_SPRAY, e.life * ( 0.7 + 0.6 * r3 ), tag + r2 * 0.99 );
		}
	}

	// ---- mist: the fine drops left hanging over the curtain, and the smoke off fast shallow flow; it follows the
	// air within a third of a second (Spray.js KIND.tau), so it streams and thins downwind
	// (few, large, faint sprites: mist is the biggest overdraw of the spray)
	let m = floodSprayMist( e );
	let eSheet = floodSprayEmission( 0.5 * l.depth + ${ f( EDGE_HEAD ) } * speed * speed / ${ f( 2 * GRAVITY ) }, 1.0, cell, floorR * 2.0, capR );
	let mSheet = floodSprayMist( eSheet );
	let wantFace = select( 0.0, m.z * gain, src.y > 0.0 );
	let wantSheet = src.w * ${ f( SHEET_COVER ) } / ( PI * mSheet.x * mSheet.x * mSheet.y ) * gain;
	let wantM = wantFace + wantSheet;
	let nM = u32( floor( min( wantM, ${ f( MAX_MIST ) } ) + sprayRand( seed, 4u ) ) );
	if ( nM > 0u ) {
		let merge = max( 1.0, sqrt( wantM / ${ f( MAX_MIST ) } ) );
		let base = floodSprayReserve( nM );
		for ( var j = 0u; j < nM; j++ ) {
			let h = seed + j * 17u;
			let r0 = sprayRand( h, 21u );
			let r1 = sprayRand( h, 22u );
			let r2 = sprayRand( h, 23u );
			let r3 = sprayRand( h, 24u );
			let fromFace = r0 * wantM < wantFace;
			let size = min( select( mSheet.x, m.x, fromFace ) * merge, ${ f( MIST_RADIUS_MAX ) } ) * ( 0.7 + r2 * 0.6 );
			let life = select( mSheet.y, m.y, fromFace ) * ( 0.75 + 0.5 * r3 );
			let q = p + t3.xz * ( ( r1 - 0.5 ) * span ) + dir * ( ( r2 - 0.5 ) * span );
			// through the whole curtain over the face; just over the water on a sheet
			let y = surfaceY + size * 0.25 + select( r3 * 0.6 * l.depth, r3 * ${ f( THROW_HEIGHTS ) } * src.z, fromFace );
			let v = d3 * ( speed * ( 0.5 + 0.4 * r1 ) ) + up * ( select( 0.6, e.launch * 0.3, fromFace ) * r3 );
			sprayWrite( floodSpraySlot( base, j ), vec3f( q.x, y, q.y ), v, size, SPRAY_MIST, life, tag + r1 * 0.99 );
		}
	}

	// ---- clear drops and ligaments, near the camera only: the many small ones give way first when the region fills
	let nearK = smoothstep( ${ f( DROP_RANGE ) }, ${ f( DROP_RANGE * 0.35 ) }, dist );
	let wantD = e.rate * ${ f( DROPS_PER_SPRAY ) } * nearK * gain * floodSprayP.budget;
	let nD = u32( floor( min( wantD, ${ f( MAX_DROPS ) } ) + sprayRand( seed, 5u ) ) );
	if ( src.y > 0.0 && nD > 0u ) {
		let base = floodSprayReserve( nD );
		for ( var j = 0u; j < nD; j++ ) {
			let h = seed + j * 13u;
			let r0 = sprayRand( h, 31u );
			let r1 = sprayRand( h, 32u );
			let r2 = sprayRand( h, 33u );
			let r3 = sprayRand( h, 34u );
			let r4 = sprayRand( h, 35u );
			let lig = r4 > 0.7;
			let size = select( 0.008 + r2 * r2 * 0.02, 0.02 + r2 * 0.03, lig ) * clamp( sqrt( src.z ), 0.6, 2.0 );
			let q = p + t3.xz * ( ( r0 - 0.5 ) * span ) + dir * ( ( r1 - 0.5 ) * span );
			let y = surfaceY + 0.05 + r3 * src.z * 0.5;
			let vFwd = select( select( speed * ( 1.0 + 0.5 * r1 ), speed * 0.3, isHit ), speed * ( 0.8 + 0.8 * r1 ), isFace );
			let v = d3 * vFwd + t3 * ( ( r0 - 0.5 ) * 0.6 * e.launch ) + up * ( e.launch * sqrt( mix( 0.05, 1.2, r3 ) ) );
			sprayWrite( floodSpraySlot( base, j ), vec3f( q.x, y, q.y ), v, size, select( SPRAY_DROPLET, SPRAY_LIGAMENT, lig ), 2.5, tag + r2 * 0.99 );
		}
	}
}
`;

		this.kernel = new ComputeKernel( {
			label: 'Flood Spray',
			modules: [ commonModule, sp.module, this.water.module ],
			bindings: {
				floodSprayP: { uniform: this.uniforms },
				floodSprayHead: { storage: this.head, access: 'read_write', wgslType: 'array<atomic<u32>>' },
			},
			workgroupSize: [ 64, 1, 1 ],
			code,
		} );

	}

}
