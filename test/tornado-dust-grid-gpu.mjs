import { tempOutput } from './output-path.mjs';
import './headless.mjs';
import {writePNG} from './headless.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {worldHarness} from './world-harness.mjs';
import {SceneRenderer} from '../src/engine/render/SceneRenderer.js';
import {Material} from '../src/engine/render/Material.js';
import {FullscreenPass} from '../src/engine/render/FullscreenPass.js';
import {RenderTarget} from '../src/engine/gpu/Texture.js';
import {readTexture} from '../src/engine/gpu/Readback.js';
import {setFrameCamera,FrameUniforms} from '../src/engine/render/Frame.js';
import {TemporalUpscale} from '../src/post/TemporalUpscale.js';
import {DisasterField} from '../src/disasters/Field.js';
import {TornadoVisuals} from '../src/disasters/TornadoVisuals.js';

const ROUGH_LIMIT=.15;
const OUT=process.argv[2]||tempOutput( 'tidewater-dust-grid-gpu' );mkdirSync(OUT,{recursive:true});
const W=480,H=270,S=3,RW=W/S,RH=H/S,{E,GPU,scene,camera,mr}=await worldHarness({width:W,height:H});
const errors=[];GPU.device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
const renderer=new SceneRenderer(mr,scene,camera);renderer.setSize(RW,RH);
const rt=renderer.sceneRT,taa=new TemporalUpscale(()=>rt.texture,rt.depthTexture,rt.textures[1],camera,rt.textures[2]);taa.setSize(W,H);
const ldr=new RenderTarget(W,H,{colors:['rgba8unorm']});
const show=new FullscreenPass({label:'dust-grid-display',colorFormats:['rgba8unorm'],bindings:{hdr:{texture:()=>taa.texture}},code:`fn fragment(in:FSIn)->vec4f{return vec4f(linearToSrgb(clamp(textureLoad(hdr,vec2i(in.pos.xy),0).rgb,vec3f(0.0),vec3f(1.0))),1.0);}`});
camera.position.set(0,0,0);camera.lookAt(0,0,-1);camera.fov=55;camera.updateProjectionMatrix();
const background=new E.Mesh(new E.PlaneGeometry(700,500),new Material({name:'dust-grid-background',lit:false,side:'double',color:0x5a6a72}));background.position.z=-180;scene.add(background);
const visual=new TornadoVisuals({scene,camera,sceneRenderer:renderer},new DisasterField(()=>0));
visual.flecks.geometry.instanceCount=0;
visual.cloudMaterial.uniforms.base.value.set(0,0,-100);visual.cloudMaterial.uniforms.flow.value.set(0,1.8,0,0);
const unit=2*100*Math.tan(camera.fov*Math.PI/360)/H;
const parcel={active:true,opacity:5,water:false,condensation:true,p:{x:-20*unit,y:0,z:-100},previous:{x:-20*unit,y:0,z:-100},size:150*unit,previousSize:150*unit,rotation:0,previousRotation:0,seed:.2,v:{x:0,y:0,z:0}};
const prevVP=new E.Matrix4(),prevCam=new E.Vector3();let hasPrev=false;
function frame(){
 GPU.beginFrame();FrameUniforms.fields.frameIndex.value++;camera.updateMatrixWorld();taa.advance();const [jx,jy]=taa.jitter();
 setFrameCamera(camera,RW,RH,{jitterX:-jx,jitterY:jy,prevViewProj:hasPrev?prevVP:null,prevCameraPos:hasPrev?prevCam:null});FrameUniforms.fields.outputResolution.value.set(W,H);
 prevVP.copy(FrameUniforms.fields.viewProjNoJitter.value);prevCam.copy(FrameUniforms.fields.cameraPos.value);hasPrev=true;
 renderer.render();taa.render();show.render({colorViews:[ldr.texture]});
 taa.clearViewOffset();taa.endFrame();GPU.submit();visual.settleMotion();
}
const bytes=async t=>new Uint8Array((await readTexture(t)).data);
const luma=(a,p)=>.2126*a[p*4]+.7152*a[p*4+1]+.0722*a[p*4+2];
const mean=a=>a.reduce((n,v)=>n+v,0)/Math.max(1,a.length);
// mean |luma - mean of its four neighbours| over the central box (the cloud's dense middle)
const box={x0:W/2-50,x1:W/2+50,y0:H/2-40,y1:H/2+40};
function roughness(img){const r=[];for(let y=box.y0;y<box.y1;y++)for(let x=box.x0;x<box.x1;x++){const p=y*W+x;r.push(Math.abs(luma(img,p)-(luma(img,p-1)+luma(img,p+1)+luma(img,p-W)+luma(img,p+W))/4));}return mean(r);}
function level(img){const r=[];for(let y=box.y0;y<box.y1;y++)for(let x=box.x0;x<box.x1;x++)r.push(luma(img,y*W+x));return mean(r);}
for(let i=0;i<16;i++)frame();
const bare=await bytes(ldr.texture);const bareRough=roughness(bare);
visual.group.visible=true;
const rough=[];let cloudLevel=0,last;
for(let f=0;f<40;f++){
 Object.assign(parcel.previous,parcel.p);parcel.previousSize=parcel.size;
 // the cloud drifts 0.7 output px a frame and its noise is advected, so the history keeps clamping
 parcel.p.x+=.7*unit;visual.cloudMaterial.uniforms.flow.value.set((f+1)*.6,1.8,22,0);
 visual.write(visual.dust,[parcel]);frame();
 if(f>=24){last=await bytes(ldr.texture);rough.push(roughness(last));cloudLevel=level(last);}
}
writePNG(`${OUT}/dust-grid-taa.png`,W,H,last);writePNG(`${OUT}/dust-grid-bare.png`,W,H,bare);
const report={width:W,height:H,renderScale:1/S,bareRoughness:bareRough,bareLevel:level(bare),cloudLevel,roughness:mean(rough),roughnessMax:Math.max(...rough),frames:rough.length,errors};
writeFileSync(`${OUT}/report.json`,JSON.stringify(report,null,1));console.log(JSON.stringify(report));
assert.deepEqual(errors,[]);
assert.ok(Math.abs(cloudLevel-report.bareLevel)>12,'the fixture must draw a dense cloud over the measured box');
assert.ok(report.roughness<ROUGH_LIMIT,`no render-grid stipple under the dust: mean |Laplacian| ${report.roughness.toFixed(3)} >= ${ROUGH_LIMIT}`);
