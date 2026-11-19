import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { Colliders } from '../src/world/Colliders.js';
import { Scene } from '../src/engine/index.js';
import { Material } from '../src/engine/webgpu.js';
import { Player } from '../src/player/Player.js';
import { Evacuation } from '../src/evacuation/Evacuation.js';
import { prepareEvacuationRoute, routeObservation } from '../src/evacuation/Route.js';
import { DisasterField } from '../src/disasters/Field.js';

const terrain=new TerrainData();new CoastalRoute(terrain);const route=prepareEvacuationRoute(terrain);
const canvasContext=new Proxy({getImageData:()=>({data:new Uint8ClampedArray(1024*1024*4)})},{get:(o,k)=>k in o?o[k]:()=>{}});
// The headless geometry check stubs only the canvas rasterizer; GPU/browser
// rendering and the actual sign appearance are exercised by the browser suite.
globalThis.document={createElement:()=>({getContext:()=>canvasContext})};
const colliders=new Colliders(),scene=new Scene(),material=new Material();
const app={terrainData:terrain,colliders,scene,village:{materials:{wood:material,hard:material,stone:material}}};
const evac=new Evacuation(app);evac.build();

test('surveyed timber route is continuous, on natural high ground, with safe stair rises and genuine road clearance',()=>{
 assert.equal(route.length,138);
 assert.ok(route.width>=3.5);
 assert.ok(route.maxRiser<=.180001);
 assert.ok(route.nominalRunSeconds<25);
 assert.ok(route.refuge.ground>35);
 assert.ok(route.refuge.y>40);
 assert.ok(route.bridge.y-.38-route.bridge.roadHeight>=5);
 assert.ok(evac.drawCalls<=6,`${evac.drawCalls} merged draw calls`);
 assert.ok(evac.triangles<30000,`${evac.triangles} triangles`);
 for(const p of route.points){
  assert.ok(p.y>terrain.heightAt(p.x,p.z)+.2);
  for(const side of [-1.3,0,1.3]){
   const floor=colliders.groundHeightAt(p.x+side,p.z,p.y+.01);
   assert.ok(Math.abs(floor-p.y)<1e-6,`Deck supports full running width at ${p.z}`);
  }
 }
 assert.ok(terrain.inClearZone(route.x,-150));
 assert.ok(terrain.inClearZone(route.refuge.x,route.refuge.z));
});

test('the production walking controller climbs every real step on foot within the normal warning',()=>{
 const input={down:key=>key==='KeyW'||key==='ShiftLeft',hit:()=>false};
 const player=new Player({camera:{},input,terrain,colliders,query:{allocate:()=>0},boat:null});
 player.position.set(route.entry.x,terrain.heightAt(route.entry.x,route.entry.z),route.entry.z);
 player.yaw=0;player.grounded=true;player.waterH=player.waterMean=0;
 let seconds=0,maxRise=0;
 while(seconds<50&&player.position.z>route.refuge.z){const y=player.position.y;player.updateWalk(1/60);maxRise=Math.max(maxRise,player.position.y-y);seconds+=1/60;}
 assert.ok(seconds<30,`Actual controller completed in ${seconds.toFixed(2)} s`);
 assert.equal(player.mode,'walk');
 assert.ok(player.grounded);
 assert.ok(maxRise<.4);
 assert.ok(Math.abs(player.position.y-route.refuge.y)<.01);
 assert.equal(routeObservation(route,player,null).atRefuge,true);
 const lifted={position:player.position.clone(),mode:'walk'};lifted.position.y+=8;
 assert.equal(routeObservation(route,lifted,null).atRefuge,false,'Airborne proximity does not count as reaching the platform');
});

function routeEvent(intensity){
 const field=new DisasterField((x,z)=>terrain.heightAt(x,z));
 const e=field.start('tsunami',{x:58,z:-46,intensity,warningLead:3,duration:65,seed:3});
 let entrancePeak=0,refugePeak=0,entranceWet=0;
 const steps=Math.ceil((e.warning+e.approach+e.duration)/.1);
 for(let i=0;i<steps&&field.events.has('tsunami');i++){
  field.advance(.1);
  entrancePeak=Math.max(entrancePeak,field.waterAt(route.entry.x,route.entry.z));
  refugePeak=Math.max(refugePeak,field.waterAt(route.refuge.x,route.refuge.z));
  entranceWet=Math.max(entranceWet,field.acceleration(route.entry,{x:0,y:0,z:0},{mass:75,area:.7,volume:.075,height:1.8,supported:true,dt:.1},{}).wet);
 }
 return {field,entrancePeak,refugePeak,entranceWet};
}

test('a real severe shallow-water event exposes the entrance and leaves measured high ground dry without a safety flag',()=>{
 const {field,entrancePeak,refugePeak,entranceWet}=routeEvent(10);
 assert.ok(entrancePeak>route.entry.y,`Actual entrance peak ${entrancePeak} exceeds deck ${route.entry.y}`);
 assert.ok(entranceWet>.5,'Standing at the entrance receives real fluid loading');
 assert.ok(refugePeak<route.refuge.ground,`Actual refuge water ${refugePeak} below natural ground ${route.refuge.ground}`);
 const obs=routeObservation(route,{position:route.refuge,mode:'walk'},field);
 assert.equal(obs.refugeWaterDepth,0);
 const overtopped={events:new Map(),waterAt:()=>route.refuge.y+2};
 assert.equal(routeObservation(route,{position:route.refuge,mode:'walk'},overtopped).refugeWaterDepth,2,'A higher physical flood is reported as flooded, never made immune');
});

test('a 25 m wave tops the refuge now that Joey Island no longer shelters the village, and the water there is real',()=>{
 const {refugePeak}=routeEvent(25);
 assert.ok(refugePeak>route.refuge.ground+2,`a 25 m wave's water at the refuge ${refugePeak.toFixed(1)} m must top its ${route.refuge.ground} m ground`);
 assert.ok(refugePeak<route.refuge.ground+3*25,`run-up stays bounded: ${refugePeak.toFixed(1)} m at the refuge`);
});

test('passing beside or beyond the refuge does not misleadingly report zero distance',()=>{
 const p={position:{x:route.refuge.x+8,y:route.refuge.y+2,z:route.refuge.z-7},mode:'walk'};
 const state=routeObservation(route,p,null);
 assert.equal(state.atRefuge,false);
 assert.ok(state.remainingDistance>10,'Signed refuge is still more than 10 m away');
});

test('an overloaded boardwalk section fails even when the village has spent every rigid-body slot',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {default:init,RallyPhysics}=await import('../public/rally/rally_physics.js');
 const {StructuralDamage}=await import('../src/disasters/Structures.js');
 await init({module_or_path:await readFile(new URL('../public/rally/rally_physics_bg.wasm',import.meta.url))});
 const sim=new RallyPhysics();sim.reset(100,100,100,0);
 // Water 4 m over the low entrance sections (z above -128 m) flowing inland at 6 m/s; the rest stays dry.
 const flooded=z=>z>-128,level=z=>flooded(z)?route.entry.y+4:-100; // m
 const field={terrain:(x,z)=>terrain.heightAt(x,z),waterAt:(x,z)=>level(z),sample:(x,y,z)=>({height:level(z),ux:0,uz:flooded(z)?-6:0,wx:0,wy:0,wz:0,ax:0,ay:0,az:0,shake:0})};
 const damage=new StructuralDamage({terrainData:terrain,colliders,rally:{physics:sim,refreshIslandColliders(){},requestIslandColliders(){}}},{field,runSeed:7});
 damage.bodyBudget=damage.bodies.size; // every rigid-body slot already holds a village piece
 const debris=[];damage.onDebris(e=>debris.push(e));
 for(let t=0;t<2;t+=1/30)damage.update(1/30);
 const wet=evac.records.filter(r=>flooded(r.center.z)),dry=evac.records.filter(r=>!flooded(r.center.z));
 assert.ok(wet.length>=3,`${wet.length} sections under the flood`);
 const summary=wet.map(r=>`${r.name}: broken ${r.broken}, utilization ${r.utilization.toFixed(1)}`).join('; ');
 assert.ok(wet.every(r=>r.broken&&r.utilization>1),`every section 4 m under a 6 m/s flow fails: ${summary} (deferred ${damage.deferred})`);
 assert.ok(wet.every(r=>r.colliders.every(c=>!c.solid&&!c.walkable)),'a failed section keeps no walkable or solid collider');
 for(const r of wet)for(const s of r.spans){const a=s.geo.attributes.position.array,x=a[s.start*3],y=a[s.start*3+1];for(let i=s.start*3;i<(s.start+s.count)*3;i+=3)assert.ok(a[i]===x&&a[i+1]===y,`${r.name}: its skin is carried off with its pieces, not left standing`);}
 assert.ok(debris.length>=wet.length&&debris.every(e=>e.vz<0),`each failed section reaches the debris hook moving with the flow (${debris.length} events)`);
 assert.ok(dry.length>0&&dry.every(r=>!r.broken),'dry sections above the flood stand');
});
