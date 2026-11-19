// Same picture, old against new, on real data (docs/render-performance.md, "Loose pieces drawn by the
// GPU"). Real pieces of a village house (drawSpans), the Harbour pier's jointed members bending and
// severed (drawMember), the village's props (PropPhysics.draw) and imported terminal fragments with
// their frames (drawSpans), at poses up to 300 m from where they stood: where the vertex stage draws
// each vertex and normal equals where the frozen CPU rewrite put them (test/reference/PreGpuPieces.js),
// run on a copy of each batch. Checked twice: the CPU mirror of the vertex stage (drawnPosition), and
// the vertex stage's own WGSL (piecePose) on the GPU (headless Dawn) over the same buffers.
//
// Bound: |new - old| <= 2^-21 (2 |rest| + |old| + 1) per coordinate, with |.| the vertex's largest
// coordinate (a rotation mixes them). The old rewrite rounded each coordinate once to float32 from a
// float64 product. The new rounds the transform to float32, 2^-24 relative per entry, and its
// translation is at most |old| + |rest| (a piece turned far from its origin); the GPU then forms the
// four-term product in float32, three more roundings. Their sum stays under 1.5 |rest| + 0.5 |old| in
// units of 2^-21. Normals are unit vectors: within 2e-6.
import './headless.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Village } from '../src/world/Village.js';
import { Colliders } from '../src/world/Colliders.js';
import { Scene, Vector3, Quaternion, Matrix4, BufferGeometry, BufferAttribute } from '../src/engine/index.js';
import { StorageBuffer } from '../src/engine/gpu/Texture.js';
import { GPU } from '../src/engine/gpu/GPU.js';
import { ComputeKernel } from '../src/engine/gpu/Compute.js';
import { readBuffer } from '../src/engine/gpu/Readback.js';
import { StructuralDamage, drawSpans, structure, STRUCTURES, commitGeometryMotion } from '../src/disasters/Structures.js';
import { Builder } from '../src/world/village/GeoBuilder.js';
import { drawMember } from '../src/disasters/MemberSkin.js';
import { PROPS, PropPhysics } from '../src/physics/Props.js';
import { pieceModule, drawnPosition, drawnNormal, uploadPieces } from '../src/engine/render/PieceMotion.js';
import * as old from './reference/PreGpuPieces.js';
import { importedTerminalFixture } from './helpers/imported-terminal.mjs';

await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );
const canvas = new Proxy( { measureText: () => ( { width: 100 } ), getImageData: () => ( { data: new Uint8ClampedArray( 1024 * 1024 * 4 ) } ) }, { get: ( o, k ) => k in o ? o[ k ] : () => {} } );
const oldDocument = globalThis.document, oldWrite = StorageBuffer.prototype.write;
globalThis.document = { createElement: () => ( { getContext: () => canvas } ) };
StorageBuffer.prototype.write = function ( data ) { this.pendingData = data; };
const terrain = new TerrainData(), colliders = new Colliders();
try {

	new Village( { scene: new Scene(), terrain, colliders } );

} finally { globalThis.document = oldDocument; StorageBuffer.prototype.write = oldWrite; }

const adapter = await navigator.gpu.requestAdapter();
const noGPU = adapter ? false : 'no WebGPU adapter on this machine';
if ( adapter ) await GPU.init( { headless: true } );
const sim = new RallyPhysics();
sim.reset( 100, 100, 100, 0 );
const app = { terrainData: terrain, colliders, rally: { physics: sim, refreshIslandColliders() {}, requestIslandColliders() {} } };
const damage = new StructuralDamage( app, { runSeed: 1, field: null } );
damage.bodyBudget = 100000; // every piece and member here gets a body

// The frozen rewrite draws into a copy of each batch, taken at rest.
const copies = new Map();
function copyOf( geo ) {

	let c = copies.get( geo );
	if ( ! c ) {

		c = new BufferGeometry().setAttribute( 'position', new BufferAttribute( geo.attributes.position.array.slice(), 3 ) );
		if ( geo.attributes.normal ) c.setAttribute( 'normal', new BufferAttribute( geo.attributes.normal.array.slice(), 3 ) );
		copies.set( geo, c );

	}

	return c;

}

const copySpans = ( spans ) => spans.map( ( s ) => ( { ...s, geo: copyOf( s.geo ), skinWeights: undefined } ) );
const poses = [
	{ t: new Vector3( 0.4, 0.02, - 0.3 ), q: new Quaternion().setFromAxisAngle( new Vector3( 0.2, 1, 0.1 ).normalize(), 0.3 ) },
	{ t: new Vector3( 38, - 3.5, 12 ), q: new Quaternion().setFromAxisAngle( new Vector3( 1, 0.3, - 0.4 ).normalize(), 1.9 ) },
	{ t: new Vector3( 300, - 8, - 150 ), q: new Quaternion().setFromAxisAngle( new Vector3( - 0.5, 0.2, 1 ).normalize(), 2.9 ) },
];

const scale = ( a, o ) => Math.max( Math.abs( a[ o ] ), Math.abs( a[ o + 1 ] ), Math.abs( a[ o + 2 ] ) );
// Every vertex of the spans, new (the CPU mirror) against old (the copy), with the worst ratio to the bound.
const p = { x: 0, y: 0, z: 0 }, n = { x: 0, y: 0, z: 0 };
function compare( label, spans, oldSpans, gpu ) {

	let worst = 0, worstNormal = 0, count = 0;
	for ( let k = 0; k < spans.length; k ++ ) {

		const s = spans[ k ], o = oldSpans[ k ], P = o.geo.attributes.position.array, N = o.geo.attributes.normal?.array, R = s.geo.attributes.position.array;
		for ( let i = 0; i < s.count; i ++ ) {

			const v = s.start + i;
			drawnPosition( s.geo, v, p );
			const now = [ p.x, p.y, p.z ], bound = 2 ** - 21 * ( 2 * scale( R, v * 3 ) + scale( P, v * 3 ) + 1 );
			for ( let c = 0; c < 3; c ++ ) worst = Math.max( worst, Math.abs( now[ c ] - P[ v * 3 + c ] ) / bound );
			if ( N ) {

				drawnNormal( s.geo, v, n );
				worstNormal = Math.max( worstNormal, Math.hypot( n.x - N[ v * 3 ], n.y - N[ v * 3 + 1 ], n.z - N[ v * 3 + 2 ] ) );

			}

			gpu?.push( s.geo, v, P, N );
			count ++;

		}

	}

	assert.ok( count > 0, `${ label }: no vertices compared` );
	assert.ok( worst <= 1, `${ label }: a drawn coordinate is ${ worst.toFixed( 2 ) } x the float32 bound from the CPU rewrite (${ count } vertices)` );
	assert.ok( worstNormal <= 2e-6, `${ label }: a drawn normal is ${ worstNormal.toExponential( 2 ) } from the CPU rewrite's` );
	return count;

}

// The vertex stage's own WGSL over the same vertices: rest position and normal, the piece attribute,
// and the slot transforms as uploaded for this frame.
class GPUCheck {

	constructor() {

		this.rest = [];
		this.slots = [];
		this.expected = [];

	}

	push( geo, v, P, N ) {

		const a = geo.attributes, piece = a.piece.array;
		this.rest.push( a.position.array[ v * 3 ], a.position.array[ v * 3 + 1 ], a.position.array[ v * 3 + 2 ], a.normal?.array[ v * 3 ] ?? 0, a.normal?.array[ v * 3 + 1 ] ?? 1, a.normal?.array[ v * 3 + 2 ] ?? 0 );
		this.slots.push( piece[ v * 2 ], piece[ v * 2 + 1 ] );
		this.expected.push( P[ v * 3 ], P[ v * 3 + 1 ], P[ v * 3 + 2 ], N ? N[ v * 3 ] : NaN, N ? N[ v * 3 + 1 ] : NaN, N ? N[ v * 3 + 2 ] : NaN );

	}

	async run( label ) {

		uploadPieces();
		const count = this.slots.length / 2;
		const rest = new StorageBuffer( { label: 'rest', count: count * 6, type: 'f32', data: new Float32Array( this.rest ) } );
		const slots = new StorageBuffer( { label: 'slots', count: count * 2, type: 'u32', data: new Uint32Array( this.slots ) } );
		const out = new StorageBuffer( { label: 'out', count: count * 6, type: 'f32' } );
		const kernel = new ComputeKernel( {
			label: 'piece pose check',
			modules: [ pieceModule ],
			bindings: { rest: { storage: rest, access: 'read' }, slots: { storage: slots, access: 'read' }, poseOut: { storage: out, access: 'read_write' } },
			workgroupSize: [ 64, 1, 1 ],
			code: /* wgsl */`
@compute @workgroup_size( WG_X, WG_Y, WG_Z )
fn main( @builtin( global_invocation_id ) g: vec3u ) {
	let i = g.x;
	if ( i >= ${ count }u ) { return; }
	let pose = piecePose( vec2u( slots[ i * 2u ], slots[ i * 2u + 1u ] ), vec3f( rest[ i * 6u ], rest[ i * 6u + 1u ], rest[ i * 6u + 2u ] ), vec3f( rest[ i * 6u + 3u ], rest[ i * 6u + 4u ], rest[ i * 6u + 5u ] ) );
	poseOut[ i * 6u ] = pose.position.x;
	poseOut[ i * 6u + 1u ] = pose.position.y;
	poseOut[ i * 6u + 2u ] = pose.position.z;
	poseOut[ i * 6u + 3u ] = pose.normal.x;
	poseOut[ i * 6u + 4u ] = pose.normal.y;
	poseOut[ i * 6u + 5u ] = pose.normal.z;
}`,
		} );
		kernel.dispatch( kernel.groups( count ) );
		GPU.submit();
		const got = new Float32Array( await readBuffer( out, count * 24 ) );
		let worst = 0, worstNormal = 0;
		for ( let i = 0; i < count; i ++ ) {

			const bound = 2 ** - 21 * ( 2 * scale( this.rest, i * 6 ) + scale( this.expected, i * 6 ) + 1 );
			for ( let c = 0; c < 3; c ++ ) worst = Math.max( worst, Math.abs( got[ i * 6 + c ] - this.expected[ i * 6 + c ] ) / bound );
			if ( ! Number.isNaN( this.expected[ i * 6 + 3 ] ) ) worstNormal = Math.max( worstNormal, Math.hypot( got[ i * 6 + 3 ] - this.expected[ i * 6 + 3 ], got[ i * 6 + 4 ] - this.expected[ i * 6 + 4 ], got[ i * 6 + 5 ] - this.expected[ i * 6 + 5 ] ) );

		}

		assert.ok( worst <= 1, `${ label } on the GPU: a drawn coordinate is ${ worst.toFixed( 2 ) } x the float32 bound from the CPU rewrite (${ count } vertices)` );
		assert.ok( worstNormal <= 2e-6, `${ label } on the GPU: a drawn normal is ${ worstNormal.toExponential( 2 ) } from the CPU rewrite's` );
		for ( const b of [ rest, slots, out ] ) b.destroy();
		this.rest.length = this.slots.length = this.expected.length = 0;

	}

}

test( 'Pieces of a real village house are drawn where the CPU rewrite put them, at every pose', { skip: noGPU }, async () => {

	const house = damage.records.find( ( r ) => r.progressive && r.spans.some( ( s ) => /roofMetal|thatch/.test( s.member?.material ) ) );
	house.components ??= damage.components( house );
	for ( const c of house.components.slice( 0, 16 ) ) assert.ok( damage.spawnPiece( { r: house, c, vx: 0, vy: 0, vz: 0 } ) );
	const bodies = [ ...damage.bodies.values() ];
	for ( const pose of poses ) {

		const gpu = new GPUCheck();
		for ( const b of bodies ) {

			const at = b.origin.clone().add( pose.t ), copy = { origin: b.origin, spans: copySpans( b.spans ) };
			drawSpans( b, at, pose.q );
			old.drawSpans( copy, at, pose.q );
			compare( `${ house.name } ${ b.name }`, b.spans, copy.spans, gpu );

		}

		await gpu.run( house.name );

	}

} );

test( 'Jointed members of the real village are drawn where the CPU skin put them, rigid, bending and severed', { skip: noGPU }, async () => {

	// The village's jointed records (the Harbour pier, the boardwalk) are decks of rigid one-section
	// modules. Members of two sections bend: a timber frame of two 2 m panels under a metal roof, built
	// with the village's own builder and materials as test/structural-members.mjs builds it.
	const jointed = damage.records.filter( ( r ) => ! r.progressive );
	for ( const r of jointed ) assert.ok( damage.fracture( r ), `${ r.name } fractures into jointed members` );
	const B = new Builder();
	structure( 'Connected timber frame', colliders, () => {

		B.box( 'wood', - 1.05, 3, 0, 2, 3, 0.08 );
		B.box( 'wood', 1.05, 3, 0, 2, 3, 0.08 );
		B.box( 'roofMetal', 0, 4.55, 0, 4.3, 0.02, 2 );
		colliders.addBox( new Vector3( 0, 3, 0 ), new Vector3( 2.2, 1.6, 0.1 ), 0, { solid: true, walkable: true } );

	} );
	for ( const b of Object.values( B.batches ) ) b.build();
	const frame = STRUCTURES.pop();
	damage.addRecords( [ frame ] );
	assert.ok( damage.fracture( frame ), 'the timber frame fractures into jointed members' );
	const pier = damage.records.find( ( r ) => r.name === 'Harbour pier' ).members.slice( 0, 24 ), bending = frame.members.filter( ( m ) => m.sections.length === 2 );
	assert.ok( pier.length > 0, 'the Harbour pier fractures into members' );
	assert.ok( bending.length > 0, 'the timber frame has members of two sections that bend' );
	const list = [ ...pier, ...bending ];
	const turn = [ new Quaternion().setFromAxisAngle( new Vector3( 0.2, 0.7, 0.4 ).normalize(), 0.37 ), new Quaternion().setFromAxisAngle( new Vector3( 0.8, 0.1, 0.3 ).normalize(), - 0.48 ) ];
	// Bending last: the event after Restore below bends the members again, the skin the first event left.
	for ( const pose of poses ) for ( const severed of [ true, false ] ) {

		const gpu = new GPUCheck();
		for ( const member of list ) {

			member.sections.forEach( ( b, i ) => {

				b.position.copy( b.origin ).add( pose.t ).add( new Vector3( i * 0.4, 0.2, - i * 0.3 ) );
				b.quaternion.copy( turn[ i ] ).multiply( pose.q ).multiply( b.restQuaternion );

			} );
			member.severed = severed;
			const copy = { ...member, spans: copySpans( member.spans ) };
			drawMember( member );
			old.drawMember( copy );
			compare( `pier member ${ severed ? 'severed' : 'bending' }`, member.spans, copy.spans, gpu );

		}

		await gpu.run( `pier members ${ severed ? 'severed' : 'bending' }` );

	}

	// A second event after Restore: the frame's spans claim slots again (the same ones, handed back at
	// the commit) and must write their blend weights again.
	damage.reset();
	commitGeometryMotion();
	assert.ok( damage.fracture( frame ), 'the timber frame fractures again after Restore' );
	const gpu = new GPUCheck(), pose = poses[ 1 ];
	for ( const member of frame.members.filter( ( m ) => m.sections.length === 2 ) ) {

		member.sections.forEach( ( b, i ) => {

			b.position.copy( b.origin ).add( pose.t ).add( new Vector3( i * 0.4, 0.2, - i * 0.3 ) );
			b.quaternion.copy( turn[ i ] ).multiply( pose.q ).multiply( b.restQuaternion );

		} );
		const copy = { ...member, spans: copySpans( member.spans ) };
		drawMember( member );
		old.drawMember( copy );
		compare( 'timber frame bending after Restore', member.spans, copy.spans, gpu );

	}

	await gpu.run( 'timber frame bending after Restore' );
	damage.reset();

} );

test( 'The village\'s loose props are drawn where the CPU rewrite put them', { skip: noGPU }, async () => {

	const props = PROPS.all.filter( ( r ) => r.spans?.length && r.m0 ).slice( 0, 40 );
	assert.ok( props.length > 0, 'the village registers props' );
	// the old draw kept each span's rest vertices from its first draw, as the props' own spans did
	const copies = new Map( props.map( ( r ) => [ r, { m: r.m, m0: r.m0, spans: copySpans( r.spans ).map( ( s ) => ( { ...s, pos: null, nrm: null } ) ) } ] ) );
	for ( const pose of poses ) {

		const gpu = new GPUCheck();
		for ( const r of props ) {

			r.m.compose( r.position.clone().add( pose.t ), pose.q, new Vector3( 1, 1, 1 ) );
			const copy = copies.get( r );
			PropPhysics.prototype.draw.call( {}, r );
			old.drawProp( copy );
			compare( `prop ${ r.type }`, r.spans, copy.spans, gpu );
			r.m.copy( r.m0 );

		}

		await gpu.run( 'props' );

	}

} );

test( 'Imported terminal fragments with their frames are drawn where the CPU rewrite put them', { skip: noGPU }, async () => {

	const site = await importedTerminalFixture( { physics: sim } ), imported = new StructuralDamage( site, {} );
	const records = imported.records.filter( ( r ) => r.spans.some( ( s ) => s.frame ) ).slice( 0, 4 );
	assert.ok( records.some( ( r ) => r.spans.some( ( s ) => s.frame ) ), 'imported fragments carry their mesh frames' );
	for ( const pose of poses ) {

		const gpu = new GPUCheck();
		for ( const r of records ) {

			const body = { origin: r.center, spans: r.spans }, copy = { origin: r.center, spans: copySpans( r.spans ) };
			const at = r.center.clone().add( pose.t );
			drawSpans( body, at, pose.q );
			old.drawSpans( copy, at, pose.q );
			compare( r.name, body.spans, copy.spans, gpu );

		}

		await gpu.run( 'imported fragments' );

	}

} );
