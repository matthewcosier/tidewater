import { tempOutput } from './output-path.mjs';
import './headless.mjs';
import { writePNG } from './headless.mjs';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { worldHarness } from './world-harness.mjs';
import { SceneRenderer } from '../src/engine/render/SceneRenderer.js';
import { Material } from '../src/engine/render/Material.js';
import { FullscreenPass } from '../src/engine/render/FullscreenPass.js';
import { RenderTarget, Texture } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { setFrameCamera, FrameUniforms } from '../src/engine/render/Frame.js';
import { TemporalUpscale } from '../src/post/TemporalUpscale.js';
import { TornadoVolume } from '../src/disasters/TornadoVolume.js';
import { volumeNoise } from '../src/disasters/TornadoNoise.js';
import { condensationX } from '../src/disasters/TornadoFunnel.js';

const OUT = process.argv[ 2 ] || tempOutput( 'tidewater-tornado-volume-gpu' );
mkdirSync( OUT, { recursive: true } );
const W = 640, H = 360;
const { E, GPU, scene, camera, mr } = await worldHarness( { width: W, height: H, sun: [ 0.45, 0.55, 0.35 ] } );
const errors = [];
GPU.device.addEventListener( 'uncapturederror', ( e ) => errors.push( e.error.message ) );
const renderer = new SceneRenderer( mr, scene, camera );
renderer.setSize( W, H );
const rt = renderer.sceneRT, taa = new TemporalUpscale( () => rt.texture, rt.depthTexture, rt.textures[ 1 ], camera, rt.textures[ 2 ] );
taa.setSize( W, H );
const ldr = new RenderTarget( W, H, { colors: [ 'rgba8unorm' ] } );
const show = new FullscreenPass( { label: 'tornado-volume-display', colorFormats: [ 'rgba8unorm' ], bindings: { hdr: { texture: () => taa.texture } }, code: `fn fragment(in:FSIn)->vec4f{return vec4f(linearToSrgb(clamp(textureLoad(hdr,vec2i(in.pos.xy),0).rgb,vec3f(0.0),vec3f(1.0))),1.0);}` } );

// storm-dimmed frame light (defaults x the storm factors)
const G = FrameUniforms.fields;
G.sunColor.value.setRGB( 0.15, 0.15, 0.15 );
G.skyIrradiance.value.setRGB( 0.3 * 0.6, 0.4 * 0.6, 0.6 * 0.6 );
G.horizonColor.value.setRGB( 0.6 * 0.6, 0.7 * 0.6, 0.8 * 0.6 );
// the clear horizon beyond the storm: a far backdrop at the horizon colour
const horizon = [ 0.6 * 0.6, 0.7 * 0.6, 0.8 * 0.6 ];
const backdrop = new E.Mesh( new E.PlaneGeometry( 40000, 16000 ), new Material( { name: 'storm-horizon-backdrop', lit: false, side: 'double', color: new E.Color( ...horizon ) } ) );
backdrop.position.set( 0, 0, - 9000 );
scene.add( backdrop );

const { data, size, channels } = volumeNoise();
const volume = new TornadoVolume( { scene, sceneRenderer: renderer }, new Texture( { label: 'tornado-volume-noise', width: size, height: size, depth: size, dimension: '3d', format: channels === 4 ? 'rgba8unorm' : 'r8unorm', data, sampler: 'linearRepeat' } ) );
volume.mesh.visible = true;
// the default tornado, as TornadoVisuals.updateStorm sets it (65 m/s: VG = 65 / 0.6382, kappa = g / VG^2)
const rc = 100 * 0.18 / 1.1209, base = 650, VG = 65 / 0.6382, u = volume.material.uniforms;
u.shape.value.set( rc, base, 9.81 / ( VG * VG ), 0 );
u.trail.value.set( 0, 0, 2.5, 55 );
u.wall.value.set( 1000, 850, 1750, 3000 );
u.storm.value.set( 1, 1, 100, 1 );

camera.position.set( 0, 40, 500 );
camera.lookAt( 0, 300, 0 );
camera.updateProjectionMatrix();
const prevVP = new E.Matrix4(), prevCam = new E.Vector3();
let hasPrev = false;
function frame( clock ) {

	u.base.value.set( 0, 0, 0, clock );
	GPU.beginFrame();
	G.frameIndex.value ++;
	camera.updateMatrixWorld();
	taa.advance();
	const [ jx, jy ] = taa.jitter();
	setFrameCamera( camera, W, H, { jitterX: - jx, jitterY: jy, prevViewProj: hasPrev ? prevVP : null, prevCameraPos: hasPrev ? prevCam : null } );
	G.outputResolution.value.set( W, H );
	prevVP.copy( G.viewProjNoJitter.value );
	prevCam.copy( G.cameraPos.value );
	hasPrev = true;
	renderer.render();
	taa.render();
	show.render( { colorViews: [ ldr.texture ] } );
	taa.clearViewOffset();
	taa.endFrame();
	GPU.submit();

}
for ( let f = 0; f < 24; f ++ ) frame( 10 + f / 30 );
const img = new Uint8Array( ( await readTexture( ldr.texture ) ).data );
writePNG( `${ OUT }/tornado-volume-500m.png`, W, H, img );

const lin = ( v ) => ( v /= 255, v <= 0.04045 ? v / 12.92 : ( ( v + 0.055 ) / 1.055 ) ** 2.4 );
const lum = ( x, y ) => { const i = ( y * W + x ) * 4; return 0.2126 * lin( img[ i ] ) + 0.7152 * lin( img[ i + 1 ] ) + 0.0722 * lin( img[ i + 2 ] ); };
const project = ( x, y, z ) => {

	const v = new E.Vector3( x, y, z ).project( camera );
	return [ Math.round( ( v.x * 0.5 + 0.5 ) * W ), Math.round( ( 0.5 - v.y * 0.5 ) * H ) ];

};
const block = ( [ x, y ] ) => { let s = 0; for ( let j = - 2; j <= 2; j ++ ) for ( let i = - 2; i <= 2; i ++ ) s += lum( x + i, y + j ); return s / 25; };
const blocks = [];
// inside the funnel: the axis and half its condensation radius either side (TornadoFunnel's JS twin of funnelX)
for ( const k of [ 0.3, 0.5, 0.7 ] ) for ( const o of [ - 0.5, 0, 0.5 ] ) blocks.push( block( project( o * rc * condensationX( 9.81 / ( VG * VG ) * base * ( 1 - k ) ), base * k, 0 ) ) );
const mean = blocks.reduce( ( a, b ) => a + b, 0 ) / 9;
const shading = ( Math.max( ...blocks ) - Math.min( ...blocks ) ) / mean;
let step = 0, sum = 0, deck = 0, n = 0;
const srgb = ( x, y ) => { const i = ( y * W + x ) * 4; return ( 0.2126 * img[ i ] + 0.7152 * img[ i + 1 ] + 0.0722 * img[ i + 2 ] ) / 255; };
for ( let y = Math.round( H * 0.3 ); y < H * 0.75; y ++ ) for ( let x = 2; x < W - 3; x ++ ) {

	const a = srgb( x, y );
	step += ( Math.abs( srgb( x + 1, y ) - a ) + Math.abs( srgb( x, y + 1 ) - a ) ) / 2;
	sum += a;

}
// the storm base straight overhead of the view: the top quarter
for ( let y = 2; y < H / 4; y ++ ) for ( let x = 2; x < W - 3; x ++ ) { deck += lum( x, y ); n ++; }
// funnel column at 20 % of its height, against the clear sky beside it
const h20 = base * 0.2, [ cx, cy ] = project( 0, h20, 0 ), ppm = ( project( 10, h20, 0 )[ 0 ] - cx ) / 10; // px per m
const skyRef = ( block( [ Math.round( W * 0.2 ), cy ] ) + block( [ Math.round( W * 0.8 ), cy ] ) ) / 2;
const differs = ( x ) => Math.abs( lum( x, cy ) - skyRef ) > 0.06 * skyRef;
let left = cx, right = cx;
while ( left > 2 && differs( left - 1 ) ) left --;
while ( right < W - 3 && differs( right + 1 ) ) right ++;
const funnelWidth = ( right - left + 1 ) / ppm, funnelDark = block( [ cx, cy ] ) / skyRef;
const roughness = step / sum, horizonLum = 0.2126 * horizon[ 0 ] + 0.7152 * horizon[ 1 ] + 0.0722 * horizon[ 2 ];
const baseRatio = deck / n / horizonLum;
console.log( JSON.stringify( { blocks: blocks.map( ( b ) => + b.toFixed( 4 ) ), shading: + shading.toFixed( 3 ), roughness: + roughness.toFixed( 4 ), baseRatio: + baseRatio.toFixed( 3 ), funnelWidth: + funnelWidth.toFixed( 1 ), funnelDark: + funnelDark.toFixed( 3 ), errors: errors.length } ) );
const inside = ( im ) => {

	const v = [];
	for ( let k = 0.3; k <= 0.6001; k += 0.05 ) {

		const hk = base * k, [ x0, y0 ] = project( 0, hk, 0 ), half = Math.abs( project( 0.4 * rc * condensationX( 9.81 / ( VG * VG ) * base * ( 1 - k ) ), hk, 0 )[ 0 ] - x0 );
		for ( let x = x0 - half; x <= x0 + half; x ++ ) { const i = ( y0 * W + x ) * 4; v.push( 0.2126 * lin( im[ i ] ) + 0.7152 * lin( im[ i + 1 ] ) + 0.0722 * lin( im[ i + 2 ] ) ); }

	}
	return v;

};
const before = inside( img );
for ( let f = 0; f < 24; f ++ ) frame( 10.8 + f / 30 );
const img2 = new Uint8Array( ( await readTexture( ldr.texture ) ).data );
writePNG( `${ OUT }/tornado-volume-500m-later.png`, W, H, img2 );
const after = inside( img2 );
const twist = before.reduce( ( a, b, i ) => a + Math.abs( b - after[ i ] ), 0 ) / before.reduce( ( a, b ) => a + b, 0 );
const lum2 = ( x, y ) => { const i = ( y * W + x ) * 4; return 0.2126 * lin( img2[ i ] ) + 0.7152 * lin( img2[ i + 1 ] ) + 0.0722 * lin( img2[ i + 2 ] ); };
let left2 = cx, right2 = cx;
while ( left2 > 2 && Math.abs( lum2( left2 - 1, cy ) - skyRef ) > 0.06 * skyRef ) left2 --;
while ( right2 < W - 3 && Math.abs( lum2( right2 + 1, cy ) - skyRef ) > 0.06 * skyRef ) right2 ++;
const width2 = ( right2 - left2 + 1 ) / ppm;
console.log( JSON.stringify( { twist: + twist.toFixed( 4 ), samples: before.length, funnelWidthLater: + width2.toFixed( 1 ) } ) );
G.sunColor.value.setRGB( 0.6, 0.6, 0.6 );
camera.position.set( 0, 250, 2000 );
camera.lookAt( 0, 250, 0 );
camera.updateProjectionMatrix();
hasPrev = false;
for ( let f = 0; f < 24; f ++ ) frame( 12 + f / 30 );
const img3 = new Uint8Array( ( await readTexture( ldr.texture ) ).data );
writePNG( `${ OUT }/tornado-volume-2km.png`, W, H, img3 );
const lum3 = ( x, y ) => { const i = ( y * W + x ) * 4; return 0.2126 * lin( img3[ i ] ) + 0.7152 * lin( img3[ i + 1 ] ) + 0.0722 * lin( img3[ i + 2 ] ); };
const blk3 = ( x, y ) => { let s = 0; for ( let j = - 1; j <= 1; j ++ ) for ( let i = - 1; i <= 1; i ++ ) s += lum3( x + i, y + j ); return s / 9; };
const far = [];
for ( let k = 0.3; k <= 0.6001; k += 0.05 ) {

	const [ x0, y0 ] = project( 0, base * k, 0 );
	far.push( blk3( x0, y0 ) / ( ( blk3( Math.round( W * 0.15 ), y0 ) + blk3( Math.round( W * 0.85 ), y0 ) ) / 2 ) );

}
const farStripe = Math.max( ...far );
console.log( JSON.stringify( { farAxisOverSky: far.map( ( r ) => + r.toFixed( 3 ) ), farStripe: + farStripe.toFixed( 3 ) } ) );
assert.deepEqual( errors, [], 'the volume compiles and draws without GPU validation errors' );
assert.ok( shading >= 0.25, `funnel blocks ${ blocks.map( ( b ) => b.toFixed( 4 ) ) }: shading ${ shading.toFixed( 3 ) }, a flat fill` );
assert.ok( roughness <= 0.03, `storm base pixel roughness ${ roughness.toFixed( 4 ) }: an unresolved dither` );
assert.ok( baseRatio >= 0.12, `storm base ${ ( baseRatio * 100 ).toFixed( 1 ) } % of the clear horizon: a black void` );
assert.ok( funnelWidth >= 40, `funnel ${ funnelWidth.toFixed( 1 ) } m wide at ${ h20.toFixed( 0 ) } m (${ right - left + 1 } px): a thread, not a column` );
assert.ok( funnelDark <= 0.6, `funnel axis ${ ( funnelDark * 100 ).toFixed( 0 ) } % of the sky beside it: a white rope, not a dark column` );
assert.ok( twist >= 0.05, `striations inside the funnel change ${ ( twist * 100 ).toFixed( 1 ) } % in 0.8 s (2 rad of spin): the column reads as smoke, not a turning vortex` );
assert.ok( Math.abs( width2 - funnelWidth ) <= 0.25 * funnelWidth, `silhouette ${ funnelWidth.toFixed( 1 ) } m then ${ width2.toFixed( 1 ) } m: the outline must hold while the striations turn` );
assert.ok( farStripe <= 0.8, `from 2 km the funnel axis reaches ${ ( farStripe * 100 ).toFixed( 0 ) } % of the sky beside it (rows ${ far.map( ( r ) => r.toFixed( 2 ) ) }): pale stripes, not a dark column` );
console.log( 'tornado volume GPU: ok' );
process.exit( 0 );
