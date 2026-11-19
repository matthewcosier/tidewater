// The upload a frame makes for loose pieces of a real village house (docs/render-performance.md,
// "Loose pieces drawn by the GPU"). Terrain, the authored Village, its structure() records, the
// house's own components and the native WASM bodies are real; the GPU is a stand-in that counts the
// bytes written, reached through the real MeshRenderer: the attribute uploads of every material view
// that draws the house's batch, then its submit hooks, then the frame's motion commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';
import { TerrainData } from '../src/world/TerrainData.js';
import { Village } from '../src/world/Village.js';
import { Colliders } from '../src/world/Colliders.js';
import { Scene, Vector3, Quaternion } from '../src/engine/index.js';
import { StorageBuffer } from '../src/engine/gpu/Texture.js';
import { GPU } from '../src/engine/gpu/GPU.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { STRUCTURES, StructuralDamage, commitGeometryMotion } from '../src/disasters/Structures.js';
import { PROPS, PropPhysics } from '../src/physics/Props.js';

await init( { module_or_path: await readFile( new URL( '../public/rally/rally_physics_bg.wasm', import.meta.url ) ) } );
const canvas = new Proxy( { measureText: () => ( { width: 100 } ), getImageData: () => ( { data: new Uint8ClampedArray( 1024 * 1024 * 4 ) } ) }, { get: ( o, k ) => k in o ? o[ k ] : () => {} } );
const oldDocument = globalThis.document, oldWrite = StorageBuffer.prototype.write;
globalThis.document = { createElement: () => ( { getContext: () => canvas } ) };
StorageBuffer.prototype.write = function ( data ) { this.pendingData = data; };
const scene = new Scene(), terrain = new TerrainData(), colliders = new Colliders();
try {

	new Village( { scene, terrain, colliders } );

} finally { globalThis.document = oldDocument; StorageBuffer.prototype.write = oldWrite; }

// A GPU that keeps nothing and counts every byte written to it.
let written = 0;
Object.assign( globalThis, { GPUBufferUsage: { VERTEX: 32, INDEX: 16, COPY_DST: 8, COPY_SRC: 4, STORAGE: 128, UNIFORM: 64, INDIRECT: 256 }, GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 } } );
GPU.device = { createBuffer: ( { size } ) => ( { size, destroy() {} } ), createBindGroupLayout: ( x ) => x, createBindGroup: ( x ) => x };
GPU.queue = { writeBuffer( buffer, offset, data, dataOffset = 0, size ) { written += size ?? ( data.byteLength - dataOffset * ( data.BYTES_PER_ELEMENT || 1 ) ); }, submit() {} };
GPU.samplers = {};

const sim = new RallyPhysics();
sim.reset( 100, 100, 100, 0 );
const app = { terrainData: terrain, colliders, rally: { physics: sim, refreshIslandColliders() {}, requestIslandColliders() {} } };
const damage = new StructuralDamage( app, { runSeed: 1, field: null } );
// The first progressive house with a roof: its walls, openings and roof come apart piece by piece.
const house = damage.records.find( ( r ) => r.progressive && r.spans.some( ( s ) => /roofMetal|thatch/.test( s.member?.material ) ) );
house.components ??= damage.components( house );
const PIECES = 12;
for ( const c of house.components.slice( 0, PIECES ) ) assert.ok( damage.spawnPiece( { r: house, c, vx: 0, vy: 0, vz: 0 } ), `${ house.name } ${ c.kind } gets a body` );
const bodies = [ ...damage.bodies.values() ];
const rest = bodies.map( ( b ) => ( { p: b.position.clone(), q: b.quaternion.clone() } ) );
const spans = bodies.reduce( ( n, b ) => n + b.spans.length, 0 ), vertices = bodies.reduce( ( n, b ) => n + b.spans.reduce( ( m, s ) => m + s.count, 0 ), 0 );
const geometries = new Set( house.spans.map( ( s ) => s.geo.attributes.position ) );
const views = [];
scene.traverse( ( o ) => { if ( o.isMesh && geometries.has( o.geometry.attributes.position ) ) views.push( o ); } );

const mr = new MeshRenderer(), axis = new Vector3( 0.3, 1, 0.2 ).normalize(), turn = new Quaternion();
// The solver's pose records (Structures.sync): id, position, orientation, two more floats.
function poses( k ) {

	const out = new Float32Array( bodies.length * 10 );
	bodies.forEach( ( b, i ) => {

		const p = rest[ i ].p, q = turn.setFromAxisAngle( axis, 0.04 * k ).multiply( rest[ i ].q );
		out.set( [ b.id, p.x + 0.35 * k, p.y + 0.02 * k * k, p.z - 0.1 * k, q.x, q.y, q.z, q.w, 0, 0 ], i * 10 );

	} );
	return out;

}

// One frame as App.renderFrame runs it: the pieces' poses, every draw's vertex buffers, the submit.
function frame( k, move = true ) {

	if ( move ) damage.sync( poses( k ) );
	written = 0;
	GPU.frame ++;
	mr._beginFrame();
	for ( const o of views ) {

		const vl = mr._cachedLayout( o, o.geometry, Array.isArray( o.material ) ? o.material[ 0 ] : o.material );
		for ( const b of vl.buffers ) mr._attributeBuffer( o.geometry, b.attr );

	}

	GPU.encoder = { finish: () => ( {} ) };
	GPU.submit();
	commitGeometryMotion();
	return written;

}

test( 'A frame in which pieces of a real house move uploads one transform per piece, not their vertices', () => {

	frame( 0, false ); // the batch's first upload
	assert.equal( frame( 0, false ), 0, 'an intact village uploads nothing' );
	frame( 1 ); // the pieces' first move
	const steady = [ 2, 3, 4, 5 ].map( ( k ) => frame( k ) );
	// 96 bytes a span: this frame's and the last drawn frame's transform as 3x4 float rows
	const bound = 96 * spans;
	for ( const bytes of steady ) assert.ok( bytes <= bound, `${ PIECES } moving pieces of ${ house.name } (${ spans } spans, ${ vertices } vertices) uploaded ${ bytes } bytes in a frame; one transform per span is ${ bound } bytes` );
	frame( 6, false );
	assert.equal( frame( 6, false ), 0, 'pieces at rest again upload nothing' );

} );

// Bytes the V8 heap sampler sees allocated under the drawing of loose pieces (inclusive: every function
// they call), per frame. The house's pieces (Structures.drawSpans), the Harbour pier's jointed members
// (MemberSkin.drawMember, through Structures.sync) and village props (PropPhysics.draw).
// V8 boxes the doubles of code it has not optimised yet: about 2.5 KB a frame here over the first
// 50 frames, none after 100. The game draws these every frame, so the frames sampled come after
// WARM frames, the steady state a flood pays for.
const WARM = 200;
const DRAWING = [ [ 'drawSpans', 'Structures.js' ], [ 'drawMember', 'MemberSkin.js' ], [ 'draw', 'Props.js' ] ];
function drawingBytes( node, inside = false ) {

	const f = node.callFrame, here = inside || DRAWING.some( ( [ name, file ] ) => f.functionName === name && f.url.endsWith( file ) );
	let bytes = here ? node.selfSize : 0;
	for ( const c of node.children ) bytes += drawingBytes( c, here );
	return bytes;

}

test( 'Drawing a frame of moving pieces, members and props allocates nothing', async () => {

	damage.bodyBudget = 100000;
	const pier = damage.records.find( ( r ) => r.name === 'Harbour pier' );
	assert.ok( damage.fracture( pier ), 'the Harbour pier fractures into jointed members' );
	const sections = pier.members.flatMap( ( m ) => m.sections ), props = PROPS.all.filter( ( r ) => r.spans?.length && r.m0 ).slice( 0, 30 );
	const start = sections.map( ( b ) => b.position.clone() );
	const memberPoses = ( k ) => {

		const out = new Float32Array( sections.length * 10 );
		sections.forEach( ( b, i ) => out.set( [ b.id, start[ i ].x + 0.2 * k, start[ i ].y, start[ i ].z, b.restQuaternion.x, b.restQuaternion.y, b.restQuaternion.z, b.restQuaternion.w, 0, 0 ], i * 10 ) );
		return out;

	};
	const all = ( k ) => {

		const a = poses( k ), b = memberPoses( k ), out = new Float32Array( a.length + b.length );
		out.set( a );
		out.set( b, a.length );
		return out;

	};
	const prop = PropPhysics.prototype.draw, owner = {};
	const run = ( k, list ) => {

		damage.sync( list );
		for ( const r of props ) {

			r.m.makeTranslation( 0.1 * k, 0, 0 ).multiply( r.m0 );
			prop.call( owner, r );

		}

		commitGeometryMotion();

	};
	const lists = Array.from( { length: 40 }, ( _, k ) => all( k + 10 ) ); // made before sampling
	for ( let k = 0; k < 8; k ++ ) run( k, all( k ) ); // the first claims of every span
	for ( let k = 0; k < WARM; k ++ ) run( ( k % lists.length ) + 10, lists[ k % lists.length ] );
	const session = new Session();
	session.connect();
	await session.post( 'HeapProfiler.enable' );
	await session.post( 'HeapProfiler.startSampling', { samplingInterval: 64 } );
	for ( let k = 0; k < lists.length; k ++ ) run( k + 10, lists[ k ] );
	const { profile } = await session.post( 'HeapProfiler.stopSampling' );
	session.disconnect();
	const perFrame = drawingBytes( profile.head ) / lists.length;
	assert.ok( perFrame === 0, `drawing ${ bodies.length } house pieces, ${ sections.length } pier sections and ${ props.length } props allocated about ${ Math.round( perFrame ) } bytes a frame (sampled over ${ lists.length } frames after ${ WARM })` );

} );
