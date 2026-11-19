import { UniformBlock, ShaderModule, Texture } from '../engine/webgpu.js';
import { Vector4 } from '../engine/index.js';
import { FLOOD_LOOK_WGSL, gridLook } from './FloodLook.js';
export class DisasterWater {
 constructor(terrain){
  // One texture, inner grid in rows 0..n-1 and the outer ring in rows n..2n-1: a second texture took the
  // beauty pass to 33 sampled textures in the fragment stage (limit 32) and the game did not load.
  this.packed=new Float32Array(257*514*4);
  this.texture=new Texture({width:257,height:514,format:'rgba32float',label:'disaster-height-current',data:this.packed});
  this.params=new UniformBlock('DisasterWaterParams',{domain:['vec4f',new Vector4(0,0,8,0)],outer:['vec4f',new Vector4(0,0,32,0)],
   far0:['vec4f',new Vector4(0,0,1,0)],far1:['vec4f',new Vector4(0,1,0,0)],far2:['vec4f',new Vector4(0,1,0,0)],far3:['vec4f',new Vector4(0,0,0,0)]},{label:'disasterWater'});
  this.module=new ShaderModule({name:'disasterWater',deps:[terrain.module],uniforms:this.params,uniformName:'disasterWater',bindings:{disasterGridTex:{texture:()=>this.texture}},code:`
// The analytic wall: Field.farFieldAt and WaterGrid.nWaveEta / nWaveSpeed, same maths (TROUGH_FLOOR 0.05).
fn disasterFar(p:vec2f,ground:f32,inRing:bool)->vec4f {
 let f0=disasterWater.far0;let f1=disasterWater.far1;let f2=disasterWater.far2;
 if(f2.w<0.5||(f2.w>1.5&&inRing)||ground>=-0.3){return vec4f(0.0);}
 let r=p-f0.xy;let along=dot(r,f0.zw);let cross=r.y*f0.z-r.x*f0.w;
 let side=max(0.0,abs(cross)-f2.x)/f2.y;let lateral=exp(-2.0*side*side);
 let a=select(along,min(0.0,along+disasterWater.far3.x),along<0.0)/f1.y;let b=along/f1.y-f1.w;
 let depth=-ground;let eta=max(-0.95*depth,f1.x*(exp(-0.5*a*a)-f1.z*exp(-0.5*b*b))*lateral);
 if(abs(eta)<0.0001){return vec4f(0.0);}
 let h=depth+eta;let simple=2.0*(sqrt(9.81*h)-sqrt(9.81*depth));
 let u=select(simple,f2.z*eta/h,eta>0.0);
 return vec4f(eta,u*f0.z,u*f0.w,eta);
}
// The four packed texels around cell i blended at fraction f. wetOnly averages the free surface of the wet corners
// alone (the render surface, disasterSurface); otherwise it is exactly WaterGrid.sample's bilinear blend.
fn disasterLerp(i:vec2i,f:vec2f,wetOnly:bool)->vec4f {
 let a=textureLoad(disasterGridTex,i,0);let b=textureLoad(disasterGridTex,i+vec2i(1,0),0);
 let c=textureLoad(disasterGridTex,i+vec2i(0,1),0);let e=textureLoad(disasterGridTex,i+vec2i(1,1),0);
 let plain=mix(mix(a,b,f.x),mix(c,e,f.x),f.y);
 if(!wetOnly){return plain;}
 let w=vec4f((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y)*step(vec4f(0.002),vec4f(a.w,b.w,c.w,e.w));
 let sw=w.x+w.y+w.z+w.w;
 if(sw<1e-5){return plain;}
 return vec4f((a.x*w.x+b.x*w.y+c.x*w.z+e.x*w.w)/sw,plain.yzw);
}
fn disasterSampleAt(p:vec2f,wetOnly:bool)->vec4f {
 let d=disasterWater.domain;if(d.w<1.0){return vec4f(0.0);}
 var v=vec4f(0.0);var inRing=false;
 let uv=(p-d.xy)/d.z;
 if(all(uv>=vec2f(0.0))&&all(uv<=vec2f(d.w-1.0))){
  let i=min(vec2i(floor(uv)),vec2i(i32(d.w)-2));
  v=disasterLerp(i,uv-vec2f(i),wetOnly);inRing=true;
  let edge=min(min(uv.x,uv.y),min(d.w-1.0-uv.x,d.w-1.0-uv.y));
  let o=disasterWater.outer;let ov=(p-o.xy)/o.z;
  if(edge<3.0&&o.w>=1.0&&all(ov>=vec2f(0.0))&&all(ov<=vec2f(o.w-1.0))){
   let c=min(vec2i(floor(ov)),vec2i(i32(o.w)-2));
   v=mix(disasterLerp(c+vec2i(0,i32(d.w)),ov-vec2f(c),wetOnly),v,smoothstep(0.0,3.0,edge));
  }
 }else{
  let o=disasterWater.outer;let ov=(p-o.xy)/o.z;
  if(o.w>=1.0&&all(ov>=vec2f(0.0))&&all(ov<=vec2f(o.w-1.0))){
   let c=min(vec2i(floor(ov)),vec2i(i32(o.w)-2)); // outer rows follow the inner grid's
   v=disasterLerp(c+vec2i(0,i32(d.w)),ov-vec2f(c),wetOnly);inRing=true;
  }
 }
 let ground=terrainHeightAt(p);
 v+=disasterFar(p,ground,inRing);
 // (the render surface keeps its level past the last wet cell: the water mesh hides it under dry ground per vertex)
 if(!wetOnly&&v.x<=ground+0.002){return vec4f(min(0.0,v.x),0.0,0.0,0.0);}return v;
}
fn disasterSample(p:vec2f)->vec4f {return disasterSampleAt(p,false);}
fn disasterHeight(p:vec2f)->f32 {return disasterSample(p).x;}
fn disasterSlope(p:vec2f)->vec2f {let h=disasterHeight(p);return vec2f(disasterHeight(p+vec2f(0.5,0.0))-h,disasterHeight(p+vec2f(0.0,0.5))-h)*2.0;}
// The surface the water mesh draws. The physical sample drops to sea level at the first dry texel, so between a wet
// and a dry grid point (8 m inner, 32 m outer) the sheet sloped down through the ground and the waterline followed
// the grid as a stair-step. Carrying the wet corners' level across the cell puts the waterline where that level
// meets the real terrain, per vertex and then per pixel in the depth test. Queries (boats, bodies) keep disasterHeight.
fn disasterSurface(p:vec2f)->f32 {return disasterSampleAt(p,true).x;}
${FLOOD_LOOK_WGSL}
// The grid spacing at p (m): 8 m inside the inner grid, 32 m in the ring and beyond.
fn disasterCell(p:vec2f)->f32 {
 let d=disasterWater.domain;let uv=(p-d.xy)/d.z;
 return select(disasterWater.outer.z,d.z,d.w>=1.0&&all(uv>=vec2f(0.0))&&all(uv<=vec2f(d.w-1.0)));
}
fn disasterInGrids(p:vec2f)->bool {
 let d=disasterWater.domain;let o=disasterWater.outer;let uv=(p-d.xy)/d.z;let ov=(p-o.xy)/o.z;
 return (d.w>=1.0&&all(uv>=vec2f(0.0))&&all(uv<=vec2f(d.w-1.0)))||(o.w>=1.0&&all(ov>=vec2f(0.0))&&all(ov<=vec2f(o.w-1.0)));
}
fn disasterFarCrest(p:vec2f)->f32 {
 let f0=disasterWater.far0;let f1=disasterWater.far1;let f2=disasterWater.far2;
 if(f2.w<0.5){return 1.0;}
 if(f2.w>1.5){
  let d=disasterWater.domain;let o=disasterWater.outer;let uv=(p-d.xy)/d.z;let ov=(p-o.xy)/o.z;
  if((d.w>=1.0&&all(uv>=vec2f(0.0))&&all(uv<=vec2f(d.w-1.0)))||(o.w>=1.0&&all(ov>=vec2f(0.0))&&all(ov<=vec2f(o.w-1.0)))){return 1.0;}
 }
 let r=p-f0.xy;let a=dot(r,f0.zw)/f1.y;let cross=r.y*f0.z-r.x*f0.w;
 let side=max(0.0,abs(cross)-f2.x)/f2.y;let lateral=exp(-2.0*side*side);
 let g=exp(-0.5*a*a);
 let band=smoothstep(0.80,0.95,g)*step(-0.3,a);
 let tall=smoothstep(6.0,20.0,f1.x)*(1.0-smoothstep(3.0,4.0,abs(a)));
 return mix(1.0,band,tall);
}
struct DisasterLook { height: f32, slope: vec2f, flow: vec2f, depth: f32, bore: vec3f, turbid: f32, cover: f32, drop: f32, crest: f32 }
fn disasterLookAt(p:vec2f)->DisasterLook {
 var o:DisasterLook;
 let s=disasterSample(p);
 let cs=disasterCell(p);
 let ax=disasterSample(p+vec2f(cs,0.0));let az=disasterSample(p+vec2f(0.0,cs));
 o.height=s.x;o.slope=vec2f(ax.x-s.x,az.x-s.x)/cs;o.flow=s.yz;o.depth=s.w;
 let speed=length(s.yz);
 let dslope=vec2f(ax.w-s.w,az.w-s.w)/cs;
 let fill=-((ax.w*ax.y-s.w*s.y)+(az.w*az.z-s.w*s.z))/cs;
 let face=select(0.0,max(0.0,min(-dot(s.yz,o.slope),-dot(s.yz,dslope))/max(speed,1e-4)),speed>1e-4)*smoothstep(FLOOD_FACE_FILL.x,FLOOD_FACE_FILL.y,fill);
 o.bore=select(vec3f(0.0),floodClassifyBore(s.w,speed,face),s.w>0.002);
 // the bed: the grid's (eta - h) inside the grids; beyond them the far-field sample carries no sea depth (its w is the
 // wave's own height), so eta - h was 0, "land", and the open-sea wall drew 44 % turbid: the shared terrain height caps it
 let bed=min(s.x-s.w,terrainHeightAt(p));
 o.turbid=floodTurbidity(s.w,speed,bed);
 o.cover=select(max(smoothstep(0.4,2.0,abs(s.x)),select(0.0,1.0-smoothstep(0.002,FLOOD_SEABED_FILM,s.w),disasterInGrids(p))),smoothstep(0.1,0.6,s.w),bed>=0.0);
 o.drop=0.0;
 if(s.w>0.002&&speed>0.3){
  let dir=s.yz/speed;let an=disasterSample(p+dir*FLOOD_TRAIL_NEAR);let af=disasterSample(p+dir*FLOOD_TRAIL_LENGTH);
  o.drop=floodWakeDrop(s.w,s.x,an.xw,af.xw);
 }
 o.crest=disasterFarCrest(p);
 return o;
}
// Whitewater cover 0..1 (FloodLook.whitewater): the roller and lip on the face (on the far-field wall its crest band),
// the wake behind it, the snout, and foam streaks dragged along the flow (two phases STREAK_T apart, blended so the
// reset never shows, as the foam flow map in WaterSurface) over the rest of the supercritical sheet.
fn disasterWhitewater(l:DisasterLook,p:vec2f,time:f32)->f32 {
 if(l.depth<=0.002){return 0.0;}
 let speed=length(l.flow);
 var st=0.0;
 if(l.bore.y>0.6&&l.depth>0.05&&speed>1e-3){
  let dir=l.flow/speed;let fl=l.flow*FLOOD_STREAK_T;let ph=fract(time/FLOOD_STREAK_T);
  let a0=floodStreak(p-fl*ph,dir);
  let a1=floodStreak(p-fl*fract(ph+0.5)+vec2f(0.41,0.23)*FLOOD_STREAK_LENGTH,dir);
  st=mix(a0,a1,abs(2.0*ph-1.0));
 }
 return floodWhitewater(l.bore.x,l.bore.y,l.depth,speed,l.height-l.depth,l.drop,st,l.crest);
}
`});
 }
 // Debug stat (tests, Playwright): the look of the packed state this texture holds, by FloodLook.gridLook, the CPU
 // twin of the shader's classifier. On demand only: one pass over both grids (~130k cells), never per frame.
 look(){
  const n=this.grid?.n;if(!n)return {inner:null,outer:null};
  return {inner:gridLook(this.packed.subarray(0,n*n*4),n,this.grid.dx),outer:this.outerGrid?gridLook(this.packed.subarray(n*n*4),n,this.outerGrid.dx):null};
 }
 update(field){
  const grid=field.water,outer=field.outer?.n===grid?.n?field.outer:null;
  this.params.fields.domain.value.set(grid?.x??0,grid?.z??0,grid?.dx??8,grid?grid.n:0);
  this.params.fields.outer.value.set(outer?.x??0,outer?.z??0,outer?.dx??32,outer?outer.n:0);
  // The far-field wall moves every frame, the grids only every solver step: set before the version check.
  const e=field.events?.get('tsunami'),far=grid?e?.farField:null,F=this.params.fields;
  if(far){
   const crest=field.farCrest(e),a=e.direction*Math.PI/180,cx=Math.cos(a),cz=Math.sin(a);
   F.far0.value.set(e.x-cx*crest,e.z-cz*crest,cx,cz);
   F.far1.value.set(e.intensity,e.crestWidth??e.width,e.drawdown??0,e.troughLead??2.2);
   F.far2.value.set(e.crestHalfLength??0,e.radius,far.speed,e.launched?2:1);
   F.far3.value.set(far.length??0,0,0,0);
  }else F.far2.value.set(0,1,0,0);
  if(!grid)return;
  if(this.grid===grid&&this.version===grid.version&&this.outerGrid===outer&&this.outerVersion===outer?.version)return;
  const cells=grid.n*grid.n*4;
  if(this.texture.width!==grid.n){this.packed=new Float32Array(cells*2);this.texture.resize(grid.n,grid.n*2);}
  this.packed.set(grid.pixels,0);
  if(outer)this.packed.set(outer.pixels,cells);
  this.texture.upload(this.packed);
  this.grid=grid;this.version=grid.version;this.outerGrid=outer;this.outerVersion=outer?.version;
 }
}
