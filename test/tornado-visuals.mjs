import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DisasterField} from '../src/disasters/Field.js';
import {TornadoParticles,TornadoVisuals} from '../src/disasters/TornadoVisuals.js';
import {tornadoLifecycle} from '../src/disasters/TornadoFunnel.js';

import {Scene,Vector3} from '../src/engine/index.js';

// The mature stage: the vortex is at strength once its seeded genesis is over (TornadoFunnel.tornadoLifecycle).
function field(seed=3){const f=new DisasterField(()=>0),e=f.start('tornado',{x:0,z:0,intensity:90,radius:100,speed:0,duration:90,seed});e.time=tornadoLifecycle(e,{}).genesis+3;return f;}

// The corner flow, read from the parcels the game draws: dust born in the surface layer is drawn in by the inflow,
// lifted where it meets the updraft core and thrown out by the outflow above the updraft's peak (8 seeds).
test('Visible dust is drawn in by the surface inflow, lifted in the core and thrown out aloft by the real vortex',()=>{
 for(let seed=1;seed<=8;seed++){
  const f=field(seed),e=f.events.get('tornado'),p=new TornadoParticles(f,{dust:1,flecks:0});p.update(1/60,e);
  const a=p.dust[0],r0=Math.hypot(a.p.x,a.p.z),y0=a.p.y;
  let angle=Math.atan2(a.p.z,a.p.x),travel=0,inner=r0,top=y0;
  for(let i=0;i<240;i++){p.update(1/60,e);const next=Math.atan2(a.p.z,a.p.x);travel+=Math.atan2(Math.sin(next-angle),Math.cos(next-angle));angle=next;inner=Math.min(inner,Math.hypot(a.p.x,a.p.z));top=Math.max(top,a.p.y);}
  const out=Math.hypot(a.p.x,a.p.z);
  assert.ok(inner<r0-1,`seed ${seed}: born ${r0.toFixed(1)} m out at ${y0.toFixed(1)} m, it came no closer than ${inner.toFixed(1)} m: no inflow`);
  assert.ok(top>y0+20,`seed ${seed}: lifted only from ${y0.toFixed(1)} to ${top.toFixed(1)} m in 4 s`);
  assert.ok(out>inner+5,`seed ${seed}: drawn in to ${inner.toFixed(1)} m and still ${out.toFixed(1)} m out after 4 s: not thrown out aloft`);
  assert.ok(Math.abs(travel)>2*Math.PI,`seed ${seed}: turned ${travel.toFixed(2)} rad round the axis in 4 s`);
  assert.equal(p.samples,241);assert.ok(Object.values(a.p).every(Number.isFinite));
 }
});

test('Small visible debris uses force/mass and gravity, and reset removes all emission',()=>{
 const f=field(),e=f.events.get('tornado'),p=new TornadoParticles(f,{dust:0,flecks:2});p.update(0,e);
 const [light,heavy]=p.flecks;
 // in the core, at the height of the surface inflow jet where the updraft has come up to strength
 for(const a of [light,heavy]){a.p={x:10,y:8,z:0};a.age=0;a.life=20;a.area=.007;a.v={x:0,y:0,z:0};}
 light.mass=.02;heavy.mass=.5;
 for(let i=0;i<90;i++)p.update(1/60,e);
 assert.ok(light.p.y>heavy.p.y+.5,'equal exposed area responds according to mass');
 const swirl=a=>(a.p.x*a.v.z-a.p.z*a.v.x)/Math.hypot(a.p.x,a.p.z);
 assert.ok(swirl(light)>swirl(heavy),`tangential momentum is force-integrated, not a prescribed orbit: ${swirl(light).toFixed(1)} against ${swirl(heavy).toFixed(1)} m/s`);
 assert.ok(p.samples>0);p.clear();assert.equal(p.event,null);assert.equal(p.snapshot().dust,0);assert.equal(p.snapshot().flecks,0);
});


test('The rendering adapter freezes event motion when paused and clears all parcels on stop',()=>{
 const f=field(),app={scene:new Scene(),camera:{position:new Vector3(0,50,120)},sceneRenderer:{opaqueCopy:{depthTexture:null}}};
 const visual=new TornadoVisuals(app,f);visual.update(.1);visual.update(.1);
 const before=JSON.stringify(visual.snapshot());f.paused=true;visual.update(.1);
 assert.equal(JSON.stringify(visual.snapshot()),before);
 assert.equal(visual.volumeMaterial.uniforms.flow.value.x,f.events.get('tornado').time,'density uses the frozen event clock');
 f.stop();visual.update(.1);assert.equal(visual.group.visible,false);assert.equal(visual.stats.dust,0);assert.equal(visual.stats.flecks,0);
});
