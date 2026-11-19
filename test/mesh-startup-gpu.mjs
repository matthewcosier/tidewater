// Exercise real Metal/Dawn pipelines, material uniforms and colour target readback.
import './headless.mjs';
import assert from 'node:assert/strict';
import { GPU } from '../src/engine/gpu/GPU.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { setFrameCamera } from '../src/engine/render/Frame.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { Material } from '../src/engine/render/Material.js';
import { Mesh, PlaneGeometry, OrthographicCamera, Scene } from '../src/engine/index.js';

await GPU.init( { headless: true } );
GPU.device.pushErrorScope( 'validation' );
new SunShadows( { size: 8 } );
const renderer = new MeshRenderer();
const scene = new Scene();
const camera = new OrthographicCamera( -2, 2, 1, -1, 0.1, 10 );
camera.position.z = 3;
const geometry = new PlaneGeometry( 1.8, 1.8 );
const red = new Material( { name: 'red paint', lit: false, color: 0xff0000 } );
const green = new Material( { name: 'green paint', lit: false, color: 0x00ff00 } );
const left = new Mesh( geometry, red ), right = new Mesh( geometry, green );
left.position.x = -1; right.position.x = 1; scene.add( left, right );
const rt = new RenderTarget( 64, 32, { colors: [ 'rgba8unorm' ], label: 'paint' } );
function draw() {
	GPU.beginFrame();
	setFrameCamera( camera, 64, 32 );
	renderer.render( scene, { kind: 'color', camera, colorFormats: rt.formats, colorViews: [ rt.texture.view() ], clearColors: [ [ 0, 0, 0, 1 ] ] } );
	GPU.submit();
}
draw();
await GPU.pipelinesReady();
const image = new Uint8Array( ( await readTexture( rt.texture ) ).data );
function pixel( x ) { return [ ...image.slice( ( 16 * 64 + x ) * 4, ( 16 * 64 + x ) * 4 + 3 ) ]; }
assert.deepEqual( pixel( 16 ), [ 255, 0, 0 ] );
assert.deepEqual( pixel( 48 ), [ 0, 255, 0 ] );
const nativeCount = () => new Set( [ ...renderer.pipelines.values() ].map( p => p.handle.pipeline ) ).size;
assert.equal( nativeCount(), 1, 'two paint colours with the same shader and render state must compile one native pipeline' );
right.material = green.clone();
draw();
assert.equal( nativeCount(), 1, 'a cloned material retains its uniform layout' );
right.material.colorWrite = false;
draw();
assert.equal( nativeCount(), 2, 'a different attachment write mask needs its own native pipeline' );
assert.equal( await GPU.device.popErrorScope(), null );
console.log( 'Two independent paint colours, one shared pipeline, separate write mask: passed.' );
process.exit( 0 );
