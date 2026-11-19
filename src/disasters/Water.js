import { UniformBlock, ShaderModule, Texture } from '../engine/webgpu.js';
import { Vector4 } from '../engine/index.js';
import { FLOOD_LOOK_WGSL, gridLook, foamShare, FloodHistory, HISTORY_STEP, HISTORY_BANDS } from './FloodLook.js';
export class DisasterWater {
 constructor(terrain){
  // One texture, inner grid in rows 0..n-1 and the outer ring in rows n..2n-1: a second texture took the
  // beauty pass to 33 sampled textures in the fragment stage (limit 32) and the game did not load.
  // (and the flood's history in rows 2n..3n-1, FloodLook.FloodHistory: foam, wet ground, sediment load and turbulence at
  // the inner grid's cells, for the water and the terrain; uploaded on its own, when it steps)
  this.packed=new Float32Array(257*771*4);
  this.texture=new Texture({width:257,height:771,format:'rgba32float',label:'disaster-height-current',data:this.packed});
  this.history=new FloodHistory();this.historyTime=-1;this.dryClock=0;
  // the step in hand: its next row (0: none), its dt (s); the rows of each band as views for the upload, and its
  // rectangle; the main-thread cost of the last 256 bands and dry-out passes (ms), a ring the bench and the specs read
  this.historyRow=0;this.historyDt=0;this.bands=[];this.bandData=null;this.bandRect={y:0,width:0,height:0};
  this.historyMs=new Float32Array(256);this.historySamples=0;
  this.params=new UniformBlock('DisasterWaterParams',{domain:['vec4f',new Vector4(0,0,8,0)],outer:['vec4f',new Vector4(0,0,32,0)],
   far0:['vec4f',new Vector4(0,0,1,0)],far1:['vec4f',new Vector4(0,1,0,0)],far2:['vec4f',new Vector4(0,1,0,0)],far3:['vec4f',new Vector4(0,0,0,0)],
    // hist: the history's block: x, z of its texel 0 (m), its spacing (m), n (0: no history). Its own domain, so the
    // wet ground outlives the grids.
    hist:['vec4f',new Vector4(0,0,8,0)]},{label:'disasterWater'});
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
// (wetOnly: org the world place of texel i (m), cs the spacing (m), ground the terrain at the sample. It returns the
// drawn sheet: its level, the wet corners' flow, and its thickness over the ground.)
fn disasterLerp(i:vec2i,f:vec2f,wetOnly:bool,org:vec2f,cs:f32,ground:f32)->vec4f {
 let a=textureLoad(disasterGridTex,i,0);let b=textureLoad(disasterGridTex,i+vec2i(1,0),0);
 let c=textureLoad(disasterGridTex,i+vec2i(0,1),0);let e=textureLoad(disasterGridTex,i+vec2i(1,1),0);
 let plain=mix(mix(a,b,f.x),mix(c,e,f.x),f.y);
 if(!wetOnly){return plain;}
 let w=vec4f((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y)*step(vec4f(0.002),vec4f(a.w,b.w,c.w,e.w));
 let sw=w.x+w.y+w.z+w.w;
 if(sw<1e-5){return vec4f(plain.x,0.0,0.0,0.0);}
 let lvl=(a.x*w.x+b.x*w.y+c.x*w.z+e.x*w.w)/sw;let hw=(a.w*w.x+b.w*w.y+c.w*w.z+e.w*w.w)/sw;
 let flow=(a.yz*w.x+b.yz*w.y+c.yz*w.z+e.yz*w.w)/sw;
 // The film at the flood's edge (FloodLook.sheetCap): the level is carried across a partly wet cell to where the real
 // ground rises through it, but toward a dry corner that lies BELOW the level (a front advancing over flat ground) it
 // stood proud to the cell's edge and ended in a step. The sheet thins to nothing toward such corners; with none (the
 // rest shoreline, water against rising ground) it is unchanged. Four terrain heights, in partly wet cells only.
 var top=lvl;
 if(sw<0.9999){
  let bw=vec4f((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);
  let dry=vec4f(1.0)-step(vec4f(0.002),vec4f(a.w,b.w,c.w,e.w));
  let g=vec4f(terrainHeightAt(org),terrainHeightAt(org+vec2f(cs,0.0)),terrainHeightAt(org+vec2f(0.0,cs)),terrainHeightAt(org+vec2f(cs,cs)));
  let open=dot(bw*dry,step(g,vec4f(lvl-0.01)));
  // (the weight pushed toward dry by the ground's small relief, FloodLook floodSheetOpen: the outline wanders across the cell)
  if(open>0.0){top=min(lvl,ground+floodSheetCap(hw,floodSheetOpen(open,org+f*cs)));}
 }
 return vec4f(top,flow,max(top-ground,0.0));
}
fn disasterSampleAt(p:vec2f,wetOnly:bool)->vec4f {
 let d=disasterWater.domain;if(d.w<1.0){return vec4f(0.0);}
 let ground=terrainHeightAt(p);
 var v=vec4f(0.0);var inRing=false;
 let uv=(p-d.xy)/d.z;
 if(all(uv>=vec2f(0.0))&&all(uv<=vec2f(d.w-1.0))){
  let i=min(vec2i(floor(uv)),vec2i(i32(d.w)-2));
  v=disasterLerp(i,uv-vec2f(i),wetOnly,d.xy+vec2f(i)*d.z,d.z,ground);inRing=true;
  let edge=min(min(uv.x,uv.y),min(d.w-1.0-uv.x,d.w-1.0-uv.y));
  let o=disasterWater.outer;let ov=(p-o.xy)/o.z;
  if(edge<3.0&&o.w>=1.0&&all(ov>=vec2f(0.0))&&all(ov<=vec2f(o.w-1.0))){
   let c=min(vec2i(floor(ov)),vec2i(i32(o.w)-2));
   v=mix(disasterLerp(c+vec2i(0,i32(d.w)),ov-vec2f(c),wetOnly,o.xy+vec2f(c)*o.z,o.z,ground),v,smoothstep(0.0,3.0,edge));
  }
 }else{
  let o=disasterWater.outer;let ov=(p-o.xy)/o.z;
  if(o.w>=1.0&&all(ov>=vec2f(0.0))&&all(ov<=vec2f(o.w-1.0))){
   let c=min(vec2i(floor(ov)),vec2i(i32(o.w)-2)); // outer rows follow the inner grid's
   v=disasterLerp(c+vec2i(0,i32(d.w)),ov-vec2f(c),wetOnly,o.xy+vec2f(c)*o.z,o.z,ground);inRing=true;
  }
 }
 // (the ground at p is read at the top: the drawn sheet's taper needs it)
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
// The flood's history at p (FloodLook.FloodHistory: foam, wet ground, sediment load, turbulence, each 0..1), bilinear
// from rows 2n..3n-1, fading out over the block's last 3 cells; 0 outside it and with no history.
fn disasterHistory(p:vec2f)->vec4f {
 let d=disasterWater.hist;if(d.w<1.0){return vec4f(0.0);}
 let uv=(p-d.xy)/d.z;
 if(any(uv<vec2f(0.0))||any(uv>vec2f(d.w-1.0))){return vec4f(0.0);}
 let i=min(vec2i(floor(uv)),vec2i(i32(d.w)-2));let f=uv-vec2f(i);let t=i+vec2i(0,2*i32(d.w));
 let a=textureLoad(disasterGridTex,t,0);let b=textureLoad(disasterGridTex,t+vec2i(1,0),0);
 let c=textureLoad(disasterGridTex,t+vec2i(0,1),0);let e=textureLoad(disasterGridTex,t+vec2i(1,1),0);
 let edge=min(min(uv.x,uv.y),min(d.w-1.0-uv.x,d.w-1.0-uv.y));
 return mix(mix(a,b,f.x),mix(c,e,f.x),f.y)*smoothstep(0.0,3.0,edge);
}
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
struct DisasterLook { height: f32, slope: vec2f, flow: vec2f, depth: f32, bore: vec3f, turbid: f32, cover: f32, drop: f32, crest: f32, surface: f32, film: f32, front: f32, roller: f32 }
fn disasterLookAt(p:vec2f)->DisasterLook {
 var o:DisasterLook;
 let s=disasterSample(p);
 let r=disasterSampleAt(p,true);
 let ing=disasterInGrids(p);let dryk=ing&&s.w<=0.002;
 let cs=disasterCell(p);
 let ax=disasterSample(p+vec2f(cs,0.0));let az=disasterSample(p+vec2f(0.0,cs));
 o.height=s.x;let gs=vec2f(ax.x-s.x,az.x-s.x)/cs;
 // (the shading slope: none across a dry neighbour in the grids, whose packed surface is the bed's and not water's, a
 // false cliff along every edge; none in the film. The face below keeps the raw difference, as FloodLook.boreFace.)
 o.slope=select(gs*select(vec2f(1.0),vec2f(step(0.002,ax.w),step(0.002,az.w)),ing),vec2f(0.0),dryk);
 o.flow=select(s.yz,r.yz,dryk);o.depth=select(s.w,r.w,dryk);o.surface=r.x;o.film=r.w;
 let speed=length(s.yz);
 let dslope=vec2f(ax.w-s.w,az.w-s.w)/cs;
 let fill=-((ax.w*ax.y-s.w*s.y)+(az.w*az.z-s.w*s.z))/cs;
 let face=select(0.0,max(0.0,min(-dot(s.yz,gs),-dot(s.yz,dslope))/max(speed,1e-4)),speed>1e-4)*smoothstep(FLOOD_FACE_FILL.x,FLOOD_FACE_FILL.y,fill);
 o.bore=select(vec3f(0.0),floodClassifyBore(s.w,speed,face),s.w>0.002);
 // the bed: the grid's (eta - h) inside the grids; beyond them the far-field sample carries no sea depth (its w is the
 // wave's own height), so eta - h was 0, "land", and the open-sea wall drew 44 % turbid: the shared terrain height caps it
 let ground=terrainHeightAt(p);let bed=select(min(s.x-s.w,ground),ground,dryk);
 o.turbid=floodTurbidity(o.depth,length(o.flow),bed);
 let ct=smoothstep(FLOOD_COVER_BED.x,FLOOD_COVER_BED.y,bed);
 let excess=max(abs(s.x-max(s.x-s.w,0.0)),select(0.0,o.film*smoothstep(-0.3,0.0,ground),dryk));
 o.cover=max(smoothstep(mix(FLOOD_COVER_SEA.x,FLOOD_COVER_LAND.x,ct),mix(FLOOD_COVER_SEA.y,FLOOD_COVER_LAND.y,ct),excess),select(0.0,(1.0-smoothstep(0.002,FLOOD_SEABED_FILM,s.w))*(1.0-smoothstep(FLOOD_DRAINED_BED.x,FLOOD_DRAINED_BED.y,bed)),ing));
 o.drop=0.0;o.front=0.0;
 // The face's white (FloodLook.roller): in the grids the roller of a front, from the jump to the same two samples ahead
 // unweighted (FloodLook.jumpDrop), or a tall face's crest and foot; breaking alone drew nearly every pixel of a large
 // flood white. Beyond the grids the far wall's crest band keeps it (its w is the wave's height, no depth to take a ratio of).
 o.roller=select(o.bore.x,0.0,ing);
 if(s.w>0.002&&speed>0.3){
  let dir=s.yz/speed;let an=disasterSample(p+dir*FLOOD_TRAIL_NEAR);let af=disasterSample(p+dir*FLOOD_TRAIL_LENGTH);
  o.drop=floodWakeDrop(s.w,s.x,an.xw,af.xw);
  // Where on a tall face this is (FloodLook.tallFront): the surface FRONT_SPAN cells up and down the flow. Two more
  // samples, under water deeper than FACE_TALL only (a wall, or the body behind a 10 m front), inside the grids.
  if(ing&&s.w>FLOOD_FACE_TALL_LO){
   let span=FLOOD_FRONT_SPAN*cs;
   o.front=floodTallFront(s.x,disasterSample(p-dir*span).x,disasterSample(p+dir*span).x,2.0*span,(floodNoise(p*FLOOD_FRONT_TEAR.y)-0.5)*FLOOD_FRONT_TEAR.x);
  }
  if(ing){o.roller=o.bore.x*max(floodRoller(floodJumpDrop(s.w,s.x,an.xw,af.xw)),o.front);}
 }
 o.crest=disasterFarCrest(p);
 return o;
}
fn disasterWhitewater(l:DisasterLook,p:vec2f,time:f32,carried:f32)->f32 {
 if(l.depth<=0.002){return 0.0;}
 let speed=length(l.flow);
 var st=0.0;var ra=vec3f(0.0);var rb=vec3f(0.0);var wb=0.0;
 if((carried>0.01||l.bore.x>0.01||l.depth<FLOOD_SNOUT_DEPTH_HI)&&speed>0.05){
  let dir=l.flow/speed;let fl=l.flow*FLOOD_STREAK_T;let ph=fract(time/FLOOD_STREAK_T);
  // (two scales: the 70 m streaks and, a quarter their size, the strands inside them)
  // (and a third, a sixteenth their size, for the rafts below; the raw pattern of each phase is kept)
  let qa=floodWarp(p-fl*ph);ra=vec3f(floodStreakRaw(qa,dir),floodStreakRaw(qa*4.0,dir),floodStreakRaw(qa*16.0,dir));
  let qb=floodWarp(p-fl*fract(ph+0.5)+vec2f(0.41,0.23)*FLOOD_STREAK_LENGTH);rb=vec3f(floodStreakRaw(qb,dir),floodStreakRaw(qb*4.0,dir),floodStreakRaw(qb*16.0,dir));
  wb=abs(2.0*ph-1.0);
  st=mix(max(floodStreakCover(ra.x),0.8*floodStreakCover(ra.y)),max(floodStreakCover(rb.x),0.8*floodStreakCover(rb.y)),wb);
 }
 let c=floodWhitewater(l.roller,l.bore.y,l.depth,speed,l.height-l.depth,l.drop,st,l.crest,carried,l.front);
 // The cover gathered into rafts along the flow (FloodLook.raft), each phase on its own pattern and the two blended:
 // drawn evenly, a low cover passed only the foam texture's brightest filaments, white scribbles on the brown.
 // (in a thin sheet the fine streaks carry the pattern, FloodLook RAFT_SCALES_THIN: the water is seen to run)
 let thinK=1.0-smoothstep(FLOOD_RAFT_THIN_DEPTH.x,FLOOD_RAFT_THIN_DEPTH.y,l.depth);
 // The front's foam line (FloodLook.edgeLine): the sheet's last centimetres where a fast front has brought its foam,
 // drawn whole and torn by a half-metre grain, not gathered into rafts.
 let line=floodEdgeLine(l.depth,speed,carried,l.height-l.depth)*(0.55+0.45*floodNoise(p*2.1+vec2f(17.0,5.0)));
 return max(mix(floodRaft(c,ra,thinK),floodRaft(c,rb,thinK),wb),line);
}
`});
 }
 // Debug stat (tests, Playwright): the look of the packed state this texture holds, by FloodLook.gridLook, the CPU
 // twin of the shader's classifier. On demand only: one pass over both grids (~130k cells), never per frame.
 look(){
  const n=this.grid?.n;if(!n)return {inner:null,outer:null};
  return {inner:gridLook(this.packed.subarray(0,n*n*4),n,this.grid.dx),outer:this.outerGrid?gridLook(this.packed.subarray(n*n*4),n,this.outerGrid.dx):null};
 }
 // Debug stat (tests, Playwright): how much of the flood carries dense foam (FloodLook.foamShare, over the inner grid's
 // packed state and the history as they stand). On demand only: one pass over the grid, never per frame.
 foamShare(){const n=this.history.n;if(!this.grid||this.grid.n!==n)return null;return foamShare(this.grid.pixels,this.history.data,n);}
 uploadHistory(){const n=this.history.n;if(n&&n===this.texture.width)this.texture.upload(this.history.data,{y:n*2,width:n,height:n});}
 // Debug stat (tests, Playwright): the history at world x, z as the shader reads it (disasterHistory: bilinear, fading
 // over the block's last 3 cells, nothing outside it or with no history), into out: foam, wet ground, sediment load,
 // turbulence. On demand only.
 historyAt(x,z,out=[0,0,0,0]){
  out[0]=out[1]=out[2]=out[3]=0;
  const d=this.params.fields.hist.value,n=d.w,H=this.history.data;if(n<1||H.length!==n*n*4)return out;
  const u=(x-d.x)/d.z,v=(z-d.y)/d.z;if(u<0||v<0||u>n-1||v>n-1)return out;
  const i=Math.min(Math.floor(u),n-2),j=Math.min(Math.floor(v),n-2),fx=u-i,fz=v-j,k=(j*n+i)*4,row=n*4;
  const t=Math.min(1,Math.max(0,Math.min(u,v,n-1-u,n-1-v)/3)),fade=t*t*(3-2*t);
  for(let c=0;c<4;c++)out[c]=((H[k+c]*(1-fx)+H[k+4+c]*fx)*(1-fz)+(H[k+row+c]*(1-fx)+H[k+row+4+c]*fx)*fz)*fade;
  return out;
 }
 // The flood's history: one step per HISTORY_STEP s of the event's clock (the solver's cadence), from the packed state
 // alone, a band of rows a frame, each band uploading its own rows (FloodLook HISTORY_BANDS: no frame carries the whole
 // grid). A grid at a new place, or a new event's clock, starts it; ground still wet from the last wave stays wet.
 stepHistory(field,grid){
  const H=this.history,F=this.params.fields,n=grid.n;
  if(H.begin(n,grid.x,grid.z,grid.dx)||this.historyTime>field.time||F.hist.value.w<1){this.historyTime=field.time;this.historyRow=0;F.hist.value.set(grid.x,grid.z,grid.dx,n);this.uploadHistory();}
  if(this.historyRow<=0){
   if(field.time-this.historyTime<HISTORY_STEP)return;
   this.historyDt=field.time-this.historyTime;this.historyTime=field.time;this.historyRow=1;
  }
  const t0=performance.now(),rows=Math.ceil((n-2)/HISTORY_BANDS),j0=this.historyRow,j1=Math.min(n-1,j0+rows),b=Math.floor((j0-1)/rows);
  H.step(grid.pixels,n,grid.dx,this.historyDt,j0,j1);
  if(this.bandData!==H.data){this.bandData=H.data;this.bands.length=0;}
  if(!this.bands[b])this.bands[b]=H.data.subarray(j0*n*4,j1*n*4);
  if(n===this.texture.width){const r=this.bandRect;r.y=n*2+j0;r.width=n;r.height=j1-j0;this.texture.upload(this.bands[b],r);}
  this.historyRow=j1>=n-1?0:j1;
  this.historyMs[this.historySamples++%256]=performance.now()-t0;
 }
 // The grids are gone: the foam the water left pops and the ground dries, on the wall clock (the field's clock stops with
 // its last event), twice a second, until nothing is left; then the history's domain goes and every reader returns at its check.
 dryOut(){
  const F=this.params.fields;if(F.hist.value.w<1)return;
  const now=performance.now()/1000,dt=Math.min(1,now-this.dryClock);if(dt<0.5)return;
  this.dryClock=now;
  if(!this.history.dry(dt))F.hist.value.set(0,0,8,0);
  this.uploadHistory();
  this.historyMs[this.historySamples++%256]=performance.now()-now*1000;
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
  // A restored island is dry: the field's clock is back at 0 with no event (Field.reset). An event that ends on its own,
  // or is stopped, leaves the clock where it was, and the ground it wetted dries in its own time (dryOut).
  if(!grid&&F.hist.value.w>=1&&field.time===0&&!field.events?.size){this.history.data.fill(0);this.history.live=false;this.historyRow=0;this.uploadHistory();F.hist.value.set(0,0,8,0);}
  if(!grid){this.dryOut();return;}
  if(this.grid===grid&&this.version===grid.version&&this.outerGrid===outer&&this.outerVersion===outer?.version){this.stepHistory(field,grid);return;}
  const cells=grid.n*grid.n*4;
  if(this.texture.width!==grid.n){this.packed=new Float32Array(cells*3);this.texture.resize(grid.n,grid.n*3);}
  this.packed.set(grid.pixels,0);
  if(outer)this.packed.set(outer.pixels,cells);
  // (the two grids' rows; the history's rows go up when it steps)
  this.texture.upload(this.packed.subarray(0,cells*2),{width:grid.n,height:grid.n*2});
  this.grid=grid;this.version=grid.version;this.outerGrid=outer;this.outerVersion=outer?.version;
  this.stepHistory(field,grid);
 }
}
