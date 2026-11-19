import {captureRig,captureTerrain,captureField,poseStamp,unchanged,applyRigResult,overlaps} from './RigSnapshot.js';

// Parallel work is speculative until the frame barrier. The main thread owns
// every live body and all cross-body impulses. A failed/invalid job simply uses
// the original serial solver for that same interval, exactly once.
export class RagdollPool {
 constructor({size=Math.min(4,Math.max(1,(globalThis.navigator?.hardwareConcurrency??2)-2)),createWorker=()=>new Worker(new URL('./RagdollWorker.js',import.meta.url),{type:'module'}),timeout=2000}={}){
  this.size=size;this.createWorker=createWorker;this.timeout=timeout;this.workers=[];this.sequence=0;
  this.stats={frames:0,dispatched:0,accepted:0,fallback:0,failures:0,waitMs:0,snapshotMs:0};
 }
 init(){
  if(this.disabled||this.workers.length)return;
  try{for(let i=0;i<this.size;i++)this.workers.push(this.createWorker());}
  catch(error){this.fail(error);}
 }
 fail(error){this.error=String(error);this.disabled=true;this.stats.failures++;for(const w of this.workers)w.terminate();this.workers=[];}
 run(worker,message){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(new Error('ragdoll worker timeout'));},this.timeout);
  const cleanup=()=>{clearTimeout(timer);worker.removeEventListener('message',done);worker.removeEventListener('error',failed);};
  const done=e=>{if(e.data.id!==message.id)return;cleanup();resolve(e.data.results);};
  const failed=e=>{cleanup();reject(new Error(e.message||'ragdoll worker error'));};
  worker.addEventListener('message',done);worker.addEventListener('error',failed);
  try{worker.postMessage(message);}catch(error){cleanup();reject(error);}
 });}
 prepare(people,dt,field){
  if(this.disabled||dt<=0)return null;
  const candidates=people.filter(p=>p.knock?.rag?.rd.phase==='sim'&&!p.knock.up&&!p.knock.sw);
  if(candidates.length<2)return null;
  this.init();if(this.disabled)return null;
  const captureStart=performance.now();
  const entries=[];
  for(const p of candidates){
   const rig=p.knock.rag.rd;if(rig.player.reef||rig.debugStep)continue;
   const excluded=[];let supported=true;
   for(const provider of rig.player.groundProviders??[]){const b=provider.simulationBounds?.();if(!b){supported=false;break;}excluded.push(b);}
   for(const modifier of rig.disasterField?.airModifiers??[]){if(modifier.workerSnapshot?.()?.kind==='windfarm')continue;const b=typeof modifier.bounds==='function'?modifier.bounds():modifier.bounds;if(!modifier.bounds){supported=false;break;}if(b)excluded.push(b);}
   if(!supported)continue;
   const xs=rig.bodies.map(b=>b.x.x),zs=rig.bodies.map(b=>b.x.z),pad=4;
   const bounds={minX:Math.min(...xs)-pad,maxX:Math.max(...xs)+pad,minZ:Math.min(...zs)-pad,maxZ:Math.max(...zs)+pad};
   if(excluded.some(b=>overlaps(b,bounds)))continue;
   const terrain=captureTerrain(rig.player.terrain,rig);if(!terrain)continue;
   const {state,near}=captureRig(rig,dt,{copy:false}),stamp=poseStamp(rig),id=entries.length;
   state.values.waterY=field?.waterAt(rig.focus.x,rig.focus.z)??0;
   entries.push({rig,state,near,stamp,excluded,rigField:rig.disasterField,fieldTime:rig.disasterField?.time,water:rig.disasterField?.water,waterVersion:rig.disasterField?.water?.version,gpuWater:rig.disasterField?.gpuWater,waterReadbacks:rig.disasterField?.gpuWater?.readbacks,outer:rig.disasterField?.outer,outerVersion:rig.disasterField?.outer?.version,gpuOuter:rig.disasterField?.gpuOuter,outerReadbacks:rig.disasterField?.gpuOuter?.readbacks,opts:JSON.stringify(scalarOptions(rig.opts)),job:{id,dt,state,terrain,field:!!rig.disasterField}});
  }
  if(entries.length<2)return null;
  const id=++this.sequence,batches=Array.from({length:Math.min(this.workers.length,entries.length)},()=>[]),cost=batches.map(()=>0);
  // Long rigs go first; solver ordering inside each individual rig is unchanged.
  for(const e of entries.slice().sort((a,b)=>(b.rig.stats?.substeps??0)-(a.rig.stats?.substeps??0))){const i=cost.indexOf(Math.min(...cost));batches[i].push(e.job);cost[i]+=e.rig.stats?.substeps||1;}
  const snapshot=captureField(field),started=performance.now();this.stats.frames++;this.stats.dispatched+=entries.length;
  this.stats.snapshotMs=started-captureStart;
  return Promise.all(batches.map((jobs,i)=>this.run(this.workers[i],{id,jobs,field:snapshot}))).then(groups=>{
   this.stats.waitMs=performance.now()-started;
   for(const result of groups.flat()){
    const entry=entries[result.id],{rig,stamp,near,excluded}=entry;
    if(result.error||excluded.some(b=>overlaps(b,result.bounds))){this.stats.fallback++;this.stats.lastFallback=result.error??'moving support or air modifier';continue;}
    rig._preparedSimulation={dt,consume:(r,step)=>{
     if(step!==dt||r.phase!=='sim'||!unchanged(r,stamp)||r.disasterField!==entry.rigField||r.disasterField?.time!==entry.fieldTime||r.disasterField?.water!==entry.water||!steady(r.disasterField?.water,entry.waterVersion,entry.gpuWater,entry.waterReadbacks,r.disasterField?.gpuWater)||r.disasterField?.outer!==entry.outer||!steady(r.disasterField?.outer,entry.outerVersion,entry.gpuOuter,entry.outerReadbacks,r.disasterField?.gpuOuter)||JSON.stringify(scalarOptions(r.opts))!==entry.opts){this.stats.fallback++;this.stats.lastFallback=`stale: dt=${step}/${dt}, phase=${r.phase}, pose=${unchanged(r,stamp)}, field=${r.disasterField===entry.rigField}, clock=${r.disasterField?.time===entry.fieldTime}, water=${r.disasterField?.water===entry.water}, grid=${steady(r.disasterField?.water,entry.waterVersion,entry.gpuWater,entry.waterReadbacks,r.disasterField?.gpuWater)}, ring=${r.disasterField?.outer===entry.outer&&steady(r.disasterField?.outer,entry.outerVersion,entry.gpuOuter,entry.outerReadbacks,r.disasterField?.gpuOuter)}`;return false;}
     applyRigResult(r,result,near);this.stats.accepted++;return true;
    }};
   }
  }).catch(error=>{this.stats.fallback+=entries.length;this.fail(error);});
 }
}
// The water a job read is the host grid as it stood at dispatch. Two things step a grid's version: the frame's own
// code (the CPU solver's step in Field.advance, a host write such as a launch or an impulse, WaterGrid.blend/pack)
// and the GPU solver's readback, which lands whenever its mapping resolves (WaterGridGPU.readback, never awaited by
// the frame). A frame that runs in one task sees a readback only after it ends; a frame waiting here at the barrier
// let it land mid-frame, and every flood result was thrown away as stale and solved again on the main thread
// (10 m tsunami, flood on land: 1,319 of 2,929 discarded, all for this, test/articulated-flood.mjs). A step the
// readbacks alone account for (the same GPU grid, as many readbacks as version steps) belongs to the next interval,
// as it would in a frame that did not wait: the job's water is the water the serial frame uses for this one. Any
// other step is a write inside the frame and the interval goes to the serial solver, once.
function steady(grid,version,gpu,readbacks,live){return grid?.version===version||!!gpu&&live===gpu&&grid.version-version===gpu.readbacks-readbacks;}
function scalarOptions(opts){return [opts.sub,opts.jointViscosity,opts.friction,opts.restitution,opts.mass];}
