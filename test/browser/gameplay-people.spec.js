import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const OUT=process.env.PW_OUT||'test-results';
test.use({video:{mode:'on',size:{width:1440,height:900}}});
async function ready(page,query=''){
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
 await page.goto(`/?scale=${process.env.PW_STANDARD==='1'?'1':'.6'}&noAudio`+query);await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
 await page.getByRole('button',{name:'Click to explore',exact:true}).click();await page.getByRole('button',{name:'Skip',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__app.beach.people.length),{timeout:30000}).toBe(26);
 if(process.env.PW_STANDARD==='1'){
  await page.getByRole('button',{name:'Performance',exact:true}).click();
  await page.getByRole('radiogroup',{name:'Resolution',exact:true}).getByRole('radio',{name:'Standard',exact:true}).click();
  await page.getByRole('button',{name:'Collapse (H)',exact:true}).click();
 }
}
test('Walking into a real vortex releases locomotion to articulated physics without a timed airborne get-up',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let origin;
 await test.step('Given I am walking at the ordinary island arrival point',async()=>{
  await ready(page);origin=await page.evaluate(()=>window.__app.player.position.toArray());expect(await page.evaluate(()=>window.__app.player.mode)).toBe('walk');
  await page.getByRole('button',{name:'Disasters',exact:true}).click();await page.getByLabel('Disaster type').selectOption('tornado');await page.getByLabel('Target location').selectOption('custom');
  await page.getByLabel('Target X (m)').fill(String(origin[0]-20));await page.getByLabel('Target Z (m)').fill(String(origin[2]));
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('120');await page.getByLabel('Radius (m)').fill('180');await page.getByLabel('Duration (s)').fill('40');await page.getByLabel('Speed (m/s)',{exact:true}).fill('0');
 });
 await test.step('When I start the vortex through its controls and keep the forward key held',async()=>{
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();
  await page.keyboard.press('Escape');await page.locator('canvas').first().click({position:{x:700,y:420}});await page.keyboard.down('KeyW');
 });
 await test.step('Then the rendered character uses fourteen jointed physical bodies and stays physical while airborne',async()=>{
  const rows=await page.evaluate(async()=>{const a=window.__app,rows=[],start=a.disasters.field.time,end=performance.now()+90000;while(performance.now()<end){await new Promise(requestAnimationFrame);const p=a.player,r=p.rag,s=a.disasters.field.sample(p.position.x,p.position.y,p.position.z);rows.push({worldTime:a.disasters.field.time-start,mode:p.mode,from:p.ragFrom,phase:r.phase,simTime:r.t,position:p.position.toArray(),updraft:s.wy,supported:r.supported,parts:r.bodies.length,joints:r.joints?.length??0,mass:r.bodies.reduce((m,b)=>m+b.m,0),energy:r.bodies.reduce((e,b)=>e+.5*b.m*(b.v.x**2+b.v.y**2+b.v.z**2),0),caps:r.stats?.capped,solver:r.stats?{...r.stats}:null,limits:r.stats?{swing:r.stats.swing,hinge:r.stats.hinge,twist:r.stats.twist}:null,body:r.bodies.map(b=>({p:[b.x.x,b.x.y,b.x.z],v:[b.v.x,b.v.y,b.v.z],w:[b.w.x,b.w.y,b.w.z]}))});if(a.disasters.field.time-start>=13)break;}return rows;});
  await page.keyboard.up('KeyW');await test.info().attach('ordinary-walking-vortex-frames',{body:JSON.stringify(rows),contentType:'application/json'});await writeFile(test.info().outputPath('ordinary-walking-vortex-frames.json'),JSON.stringify(rows));await page.screenshot({path:`${OUT}/walking-vortex.png`});
  expect(rows.some(r=>r.updraft>18),'the actual character must meet the visible event').toBe(true);
  const physical=rows.filter(r=>r.mode==='ragdoll'&&r.from==='walk');expect(physical.length,'Walking cannot remain a run animation inside the capture region').toBeGreaterThan(10);
  expect(physical.every(r=>r.parts===14&&r.joints===13&&r.mass===75&&r.body.flatMap(b=>[...b.p,...b.v,...b.w]).every(Number.isFinite))).toBe(true);
  expect(rows.at(-1).worldTime,'observe thirteen actual simulation seconds, including legitimate landings and later recaptures').toBeGreaterThanOrEqual(13);
  expect(rows.filter(r=>!r.supported&&r.phase==='getup'),'elapsed time cannot start a get-up in open air').toEqual([]);
  const steps=physical.filter(r=>r.solver?.frames>0);expect(steps.length).toBeGreaterThan(0);
  expect(steps.every(r=>r.solver.maxIntegratedAngle<=.100001&&r.solver.maxNearTravelRatio<=.150001),'actual post-force motion must stay within the integration geometry bounds').toBe(true);
  expect(steps.every(r=>r.solver.capped===r.solver.protectionCount&&r.solver.droppedTime===0&&r.solver.protectionBoundExceeded===0),'every emergency intervention and all accepted time must be accounted').toBe(true);
  expect(steps.every(r=>Math.abs(r.solver.protectionEnergy-r.solver.protectionTranslationEnergy-r.solver.protectionRotationEnergy)<1e-4)).toBe(true);expect(errors).toEqual([]);
 });

 await test.step('When I stop the vortex with its controls then the physical body settles and ordinary control returns',async()=>{
  await page.keyboard.press('Escape');if(!await page.getByRole('button',{name:'Stop all disasters',exact:true}).isVisible())await page.getByRole('button',{name:'Disasters',exact:true}).click();await page.getByRole('button',{name:'Stop all disasters',exact:true}).click();
  const rows=await page.evaluate(async()=>{const a=window.__app,rows=[],end=performance.now()+25000;while(performance.now()<end){await new Promise(requestAnimationFrame);const p=a.player,r=p.rag;rows.push({mode:p.mode,phase:r.phase,position:p.position.toArray(),stats:{...r.stats},spin:Math.max(0,...r.bodies.map(b=>Math.hypot(b.w.x,b.w.y,b.w.z)))});if(['walk','swim','ferry'].includes(p.mode))break;}return rows;});
  await writeFile(test.info().outputPath('vortex-stopped-recovery.json'),JSON.stringify(rows));await test.info().attach('vortex-stopped-recovery',{body:JSON.stringify(rows),contentType:'application/json'});await page.screenshot({path:`${OUT}/vortex-stopped-recovery.png`});
  expect(['walk','swim','ferry']).toContain(rows.at(-1).mode);expect(rows.every(r=>r.position.every(Number.isFinite))).toBe(true);expect(errors).toEqual([]);
 });
});

test('An ordinary sprint into a beach player transfers momentum into stable jointed motion',async({page})=>{
 let target,seen;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await test.step('Given I start beside the beach games with an adult frisbee player in sight',async()=>{
  await ready(page);target=await page.evaluate(()=>{const a=window.__app,p=a.beach.people.filter(p=>p.role==='frisbee'&&p.brain.type!=='kid').sort((a,b)=>a.world.x-b.world.x)[0];return p?{id:p.id,at:p.world.toArray()}:null;});expect(target).not.toBeNull();await page.locator('canvas').first().click({position:{x:700,y:420}});
 });
 await test.step('When I use ordinary walking and sprint keys to approach and bump them',async()=>{
  // Steering chooses real key presses from read-only observed relative position.
  // No player, NPC, velocity, clock, or contact state is assigned by the test.
  const held=new Set(),approach=[];let retreat=false,contacts=0;await page.keyboard.down('ShiftLeft');
  for(let i=0;i<400;i++){
   const s=await page.evaluate(id=>{const a=window.__app,p=a.player,n=a.beach.people.find(n=>n.id===id);return{at:p.position.toArray(),yaw:p.yaw,npc:n.world.toArray(),knock:n.knock?.kind,log:a.people.contact.log.filter(x=>x.id===id),cooldown:(n.bumpUntil||0)-a.people.t,mode:p.mode};},target.id);approach.push(s);
   if(s.knock==='tumble'){seen=s;break;}
   if(s.log.length>contacts){contacts=s.log.length;retreat=true;}
   const dx=s.npc[0]-s.at[0],dz=s.npc[2]-s.at[2],distance=Math.hypot(dx,dz),keys=new Set();
   // A glancing approach can produce a legitimate stagger. Walk back into
   // clear space, wait for recovery, then make another ordinary running pass.
   if(retreat&&distance>4.5&&s.cooldown<=0)retreat=false;
   const direction=retreat?-1:1,f=direction*(-dx*Math.sin(s.yaw)-dz*Math.cos(s.yaw)),r=direction*(dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw));
   if(!retreat||distance<4.6){if(Math.abs(f)>.12)keys.add(f>0?'KeyW':'KeyS');if(Math.abs(r)>.12)keys.add(r>0?'KeyD':'KeyA');}
   for(const k of held)if(!keys.has(k)){await page.keyboard.up(k);held.delete(k);}for(const k of keys)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}await page.waitForTimeout(100);
  }
  for(const k of held)await page.keyboard.up(k);await page.keyboard.up('ShiftLeft');await writeFile(test.info().outputPath('ordinary-sprint-approach.json'),JSON.stringify(approach));expect(seen,'ordinary input must make an actual contact, otherwise this is not a ragdoll test').toBeTruthy();
 });
 await test.step('Then the affected person has physical joints, finite pose and bounded contact motion',async()=>{
  const frames=await page.evaluate(async id=>{const a=window.__app,rows=[],end=performance.now()+5500;while(performance.now()<end){await new Promise(requestAnimationFrame);const p=a.beach.people.find(p=>p.id===id),r=p.knock?.rag?.rd;if(!r)continue;rows.push({phase:r.phase,parts:r.bodies.length,joints:r.joints.length,mass:r.mass,player:a.player.position.toArray(),world:p.world.toArray(),wear:p.wear?.map(w=>{const wanted=w.g.matrix.clone().fromArray(p.model.world,w.h*16).multiply(w.L).elements;return {name:w.n,error:Math.max(...wanted.map((v,i)=>Math.abs(v-w.g.matrix.elements[i])))};}),energy:r.bodies.reduce((e,b)=>{const axis=a.player.position.clone().set(b.ax.x,b.ax.y,b.ax.z).applyQuaternion(b.q),along=axis.x*b.w.x+axis.y*b.w.y+axis.z*b.w.z;return e+.5*b.m*(b.v.x**2+b.v.y**2+b.v.z**2)+.5*((b.w.x**2+b.w.y**2+b.w.z**2-along**2)/b.iPerp+along**2/b.iAx);},0),spin:Math.max(...r.bodies.map(b=>Math.hypot(b.w.x,b.w.y,b.w.z))),caps:r.stats.capped,limits:{swing:r.stats.swing,hinge:r.stats.hinge,twist:r.stats.twist},body:r.bodies.map(b=>[b.x.x,b.x.y,b.x.z,b.v.x,b.v.y,b.v.z,b.w.x,b.w.y,b.w.z])});}return rows;},target.id);
  await test.info().attach('ordinary-sprint-contact-frames',{body:JSON.stringify({target,seen,frames}),contentType:'application/json'});await writeFile(test.info().outputPath('ordinary-sprint-contact-frames.json'),JSON.stringify({target,seen,frames}));await page.screenshot({path:`${OUT}/npc-sprint-contact.png`});
  expect(frames.length).toBeGreaterThan(5);expect(frames.every(r=>r.parts===14&&r.joints===13&&r.mass===72&&r.body.flat().every(Number.isFinite))).toBe(true);
  expect(Math.max(...frames.map(r=>Math.hypot(r.player[0]-target.at[0],r.player[2]-target.at[2])))).toBeLessThan(35);
  expect(Math.max(...frames.map(r=>r.energy))).toBeLessThan(5000);
  expect(Math.max(...frames.map(r=>r.spin)),'ordinary contact cannot produce runaway limb spin').toBeLessThan(50);
  expect(Math.max(...frames.map(r=>r.caps)),'ordinary contact must not depend on emergency numerical guards').toBe(0);
  expect(frames.every(r=>r.wear?.length>0),'the contacted person must actually wear the observed head prop').toBe(true);
  expect(Math.max(...frames.flatMap(r=>r.wear.map(w=>w.error))),'worn props must follow the rendered head through falling and getting up').toBeLessThan(1e-4);
  expect(Math.max(...frames.flatMap(r=>Object.values(r.limits))),'physical joints stay near their authored limits').toBeLessThan(8);
  expect(frames.some(r=>r.phase==='getup'||r.phase==='idle'),'the body must settle and begin recovery').toBe(true);expect(errors).toEqual([]);
 });
});

test('Ferry passengers retain real support or physical motion when flood separates the gangway',async({page})=>{
 test.setTimeout(240000);const errors=[];page.on('pageerror',e=>errors.push(e.message));let aboard;
 await test.step('Given the actual ferry service is boarding through its connected gangway',async()=>{
  // The shipped short timetable changes only the layover wait; vessel dynamics,
  // crowd paths, water and contacts are the ordinary production systems.
  await ready(page,'&ferryTimetable=short');
  await expect.poll(()=>page.evaluate(()=>window.__app.ferry.crowd.people.filter(p=>p.path?.some(v=>v[0]==='T')&&p.path.some(v=>v[0]==='S')).length),{timeout:45000}).toBeGreaterThan(0);
  aboard=await page.evaluate(()=>window.__app.ferry.ship.position.toArray());
  await page.getByRole('button',{name:'Disasters',exact:true}).click();await page.getByLabel('Disaster type').selectOption('tsunami'); { const advanced = page.locator( 'details.disaster-advanced:not([open]) > summary' ); if ( await advanced.isVisible() ) await advanced.click(); }await page.getByLabel('Target location').selectOption('custom');await page.getByLabel('Target X (m)').fill(String(aboard[0]));await page.getByLabel('Target Z (m)').fill(String(aboard[2]));
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('25');await page.getByLabel('Radius (m)').fill('180');await page.getByLabel('Duration (s)').fill('60');await page.getByLabel('Warning lead time (s)').fill('3');await page.getByRole('button',{name:'View target',exact:true}).click();
 });
 await test.step('When I start the wave through the disaster controls',async()=>{
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();
 });
 await test.step('Then separated-route passengers cannot keep following a moving endpoint across unsupported water',async()=>{
  const rows=await page.evaluate(async()=>{const a=window.__app,rows=[],end=performance.now()+65000;let afterFailure=null;while(performance.now()<end){await new Promise(requestAnimationFrame);const f=a.ferry,c=f.crowd;if(f.ship.mooringFailed&&afterFailure===null)afterFailure=performance.now();rows.push({time:a.disasters.field.time,wallMs:performance.now(),frame:a.engine.frame,camera:{p:a.camera.position.toArray(),q:a.camera.quaternion.toArray(),fov:a.camera.fov,aspect:a.camera.aspect},structures:[...a.disasters.structures.bodies.values()].map(b=>({id:b.id,p:b.position.toArray(),q:b.quaternion.toArray()})),ship:f.ship.position.toArray(),failed:!!f.ship.mooringFailed,gangway:f.gangway,moored:f.ship.moored,people:c.people.map(p=>{const r=p.knock?.rag?.rd,ground=a.player.groundAt(p.world.x,p.world.z,p.world.y+.45),shore=p.terminal?.toWorld([11.12,7,9.7]),deck=f.ship.toWorld(p.world.clone().set(9.32,7,-15.5));const connected=!!(shore&&f.ship.moored&&!f.castingOff&&f.gangway===0&&f.at?.terminal===p.terminal&&Math.hypot(shore.x-deck.x,shore.z-deck.z)<4&&Math.abs(shore.y-deck.y)<.45);return{id:p.id,world:p.world.toArray(),state:p.state,local:p.local?.toArray(),path:p.path?.slice(0,2),s:p.s,knock:p.knock?.kind,phase:r?.phase,parts:r?.bodies.length??0,joints:r?.joints.length??0,support:ground,connected,velocity:r?.pelvis?[r.pelvis.v.x,r.pelvis.v.y,r.pelvis.v.z]:p._bv?.toArray()};}),rigs:a.people.contact.tumbles.state()});if(afterFailure&&performance.now()-afterFailure>10000)break;}return rows;});
  // Retain authored identity and rest bounds once, then match them to each
  // frame's read-only poses. Large imported pieces can be distinguished from
  // stretched connectors without inferring their identity from a screenshot.
  const structureMetadata=await page.evaluate(()=>[...window.__app.disasters.structures.bodies.values()].map(b=>{
   const member=b.member,spans=member?.spans??b.spans,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
   for(const span of spans)for(let i=0;i<span.pos.length;i++) {const axis=i%3;lo[axis]=Math.min(lo[axis],span.pos[i]);hi[axis]=Math.max(hi[axis],span.pos[i]);}
   return {id:b.id,name:b.name,kind:b.kind,origin:b.origin.toArray(),half:b.half.toArray(),restQuaternion:b.restQuaternion?.toArray()??[0,0,0,1],mass:b.mass,restBounds:{lo,hi},vertices:spans.reduce((n,s)=>n+s.count,0),member:member?{material:member.material,length:member.length,center:member.center.toArray(),axes:member.axes.map(v=>v.toArray()),sections:member.sections.map(s=>s.id)}:null};
  }));
  await writeFile(test.info().outputPath('ferry-structural-identities.json'),JSON.stringify(structureMetadata,null,2));
  await test.info().attach('ferry-flood-support-frames',{body:JSON.stringify(rows),contentType:'application/json'});await writeFile(test.info().outputPath('ferry-flood-support-frames.json'),JSON.stringify(rows));await page.screenshot({path:`${OUT}/ferry-flood-support.png`});
  const render=await page.evaluate(()=>({render:[window.__app.sceneRenderer.width,window.__app.sceneRenderer.height],scale:window.__app.settings.renderScale,viewport:[innerWidth,innerHeight]}));
  await writeFile(test.info().outputPath('ferry-render.json'),JSON.stringify(render));
  if(process.env.PW_STANDARD==='1')expect(render.render).toEqual([1440,900]);
  expect(rows.some(r=>r.failed),'the wave must really displace the moored ferry').toBe(true);
  const unsupported=rows.flatMap(r=>r.people.filter(p=>p.connected===false&&p.path?.length===2&&p.path[0][0]!==p.path[1][0]&&p.s>0&&!p.knock&&p.world[1]-p.support>.55));expect(unsupported,'people on a removed bridge must enter physical motion, not route interpolation').toEqual([]);
  const physical=rows.flatMap(r=>r.people.filter(p=>p.phase==='sim'));expect(physical.length).toBeGreaterThan(0);expect(physical.every(p=>p.parts===14&&p.joints===13&&p.world.concat(p.velocity||[]).every(Number.isFinite))).toBe(true);expect(errors).toEqual([]);
 });
});

// ---- solid trunks, cars and room between people (docs/people.md, Solid trunks, cars and room)
// The player's own keys steer: each step reads where the player is and holds W A S D toward the target, as a player
// would. The game is only read; page.evaluate stages the start (a place, a free-camera view), never the walk.
const PLAYER_R=0.3,BODY_R=0.27,TOL=0.05;   // m: the player's walker (Player.js RADIUS), a townsperson's (Contact.js BODY_R), contact give
async function steer(page,target,ms){
 const held=new Set(),end=Date.now()+ms;
 while(Date.now()<end){
  const s=await page.evaluate(()=>{const p=window.__app.player;return{at:p.position.toArray(),yaw:p.yaw};});
  const dx=target[0]-s.at[0],dz=target[1]-s.at[2],keys=new Set();
  const f=-dx*Math.sin(s.yaw)-dz*Math.cos(s.yaw),r=dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw);
  if(Math.hypot(dx,dz)>.15){if(Math.abs(f)>.05)keys.add(f>0?'KeyW':'KeyS');if(Math.abs(r)>.05)keys.add(r>0?'KeyD':'KeyA');}
  for(const k of held)if(!keys.has(k)){await page.keyboard.up(k);held.delete(k);}
  for(const k of keys)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}
  await page.waitForTimeout(80);
 }
 for(const k of held)await page.keyboard.up(k);
}
// every frame from now: the player's centre against a trunk's axis, or how far it is outside a car's drawn body
// (in the car's own frame; negative inside), the closest and the last
async function track(page,spec){
 await page.evaluate(spec=>{
  const a=window.__app,P=a.player,V=a.camera.position.constructor,l=new V(),r=window.__track={min:Infinity,last:Infinity,frames:0,stop:false};
  const loop=()=>{
   if(r.stop)return;r.frames++;const p=P.position;let d=Infinity;
   if(spec.trunk)d=Math.hypot(p.x-spec.trunk[0],p.z-spec.trunk[1]);
   if(spec.car!==undefined){const c=a.ferry.traffic.cars.find(c=>c.id===spec.car),g=c.group,b=spec.box;l.copy(p).sub(g.position).applyQuaternion(g.quaternion.clone().invert());d=Math.max(b[0]-l.x,l.x-b[1],b[2]-l.z,l.z-b[3]);}
   r.min=Math.min(r.min,d);r.last=d;requestAnimationFrame(loop);};
  requestAnimationFrame(loop);},spec);
}
const tracked=page=>page.evaluate(()=>{const r=window.__track;r.stop=true;return{min:r.min,last:r.last,frames:r.frames};});
// a traffic car's drawn body in its own frame: [ min x, max x, min z, max z ] (Traffic.parts, as Traffic.extent reads them)
const bodyOf=()=>`(tr,name)=>{let b=[1e9,-1e9,1e9,-1e9];for(const m of tr.parts.get(name)){m.geometry.computeBoundingBox();const g=m.geometry.boundingBox;b=[Math.min(b[0],g.min.x),Math.max(b[1],g.max.x),Math.min(b[2],g.min.z),Math.max(b[3],g.max.z)];}return b;}`;

test('Walking into a palm stops the player at its bark',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let palm;
 await test.step('Given I am on foot 4 m from a palm with open ground round it',async()=>{
  await ready(page);
  palm=await page.evaluate(()=>{
   const a=window.__app,P=a.player.position,T=a.rally.trunks,t=a.terrainData;let best=null;
   for(let k=0;k<T.length;k+=5){
    const x=T[k],z=T[k+1],d=Math.hypot(x-P.x,z-P.z);if(d<5||d>60||T[k+2]<0.17||t.heightAt(x,z)<1.2)continue;
    let clear=true;for(let j=0;j<T.length;j+=5)if(j!==k&&Math.hypot(T[j]-x,T[j+1]-z)<6)clear=false;
    if(clear&&(!best||d<best.d))best={d,x,z,r:T[k+2],sx:x+(P.x-x)/d*4,sz:z+(P.z-z)/d*4};
   }
   if(best)a.player.debugPlace(best.sx,t.heightAt(best.sx,best.sz),best.sz,'walk');return best;});
  expect(palm,'a palm with 6 m of open ground round it near the arrival point').not.toBeNull();
  await page.locator('canvas').first().click({position:{x:700,y:420}});await page.waitForTimeout(500);
 });
 await test.step('When I walk straight at its trunk with the movement keys for five seconds',async()=>{
  await track(page,{trunk:[palm.x,palm.z]});await steer(page,[palm.x,palm.z],5000);
 });
 await test.step('Then I stop against its bark and my body never passes into the trunk',async()=>{
  const r=await tracked(page);await page.screenshot({path:`${OUT}/palm-stop.png`});
  expect(r.last,`I ended ${r.last.toFixed(2)} m from the trunk's axis: I never reached the palm`).toBeLessThan(palm.r+PLAYER_R+0.3);
  expect(r.min,`my centre came within ${r.min.toFixed(2)} m of the axis of a palm ${palm.r.toFixed(2)} m in radius (body ${PLAYER_R} m)`).toBeGreaterThanOrEqual(palm.r+PLAYER_R-TOL);
  expect(errors).toEqual([]);
 });
});

test('Walking into a queued car stops the player, and a car coming aboard waits for the player standing in its road',async({page})=>{
 test.setTimeout(420000);const errors=[];page.on('pageerror',e=>errors.push(e.message));let queued,road;
 await test.step('Given I am on foot 4 m beside a car waiting in the terminal queue',async()=>{
  // the shipped short timetable changes only the layover wait: the queue, the boarding and the cars are the service's own
  await ready(page,'&ferryTimetable=short');
  await expect.poll(()=>page.evaluate(()=>window.__app.ferry.traffic?.cars.filter(c=>c.state==='queue'&&!c.path&&c.terminal===window.__app.terminal).length??0),{timeout:90000}).toBeGreaterThanOrEqual(2);
  queued=await page.evaluate(body=>{
   const a=window.__app,tr=a.ferry.traffic,t=a.terminal,box=eval(body);
   // a car in the outer marshalling lane (the larger x), so 4 m outboard of it is open paving
   const cars=tr.cars.filter(c=>c.terminal===t&&c.state==='queue'&&!c.path),outer=Math.max(...cars.map(c=>c.at[0])),car=cars.filter(c=>c.at[0]===outer).sort((p,q)=>p.at[2]-q.at[2])[0];
   const p=t.toWorld([car.at[0]+4,car.at[1],car.at[2]]),c=car.group.position;a.player.debugPlace(p.x,p.y+0.5,p.z,'walk');
   return{id:car.id,name:car.name,box:box(tr,car.name),target:[c.x,c.z]};},bodyOf());
  await page.locator('canvas').first().click({position:{x:700,y:420}});await page.waitForTimeout(500);
 });
 await test.step('When I walk straight at its middle with the movement keys for five seconds',async()=>{
  await track(page,{car:queued.id,box:queued.box});await steer(page,queued.target,5000);
 });
 await test.step('Then I stop against its body and my body never passes into it',async()=>{
  const r=await tracked(page);await page.screenshot({path:`${OUT}/queued-car-stop.png`});
  expect(r.last,`I ended ${r.last.toFixed(2)} m from its body: I never reached the car`).toBeLessThan(PLAYER_R+0.3);
  expect(r.min,`my centre came within ${r.min.toFixed(2)} m of the ${queued.name}'s body (inside it when negative; my body is ${PLAYER_R} m)`).toBeGreaterThanOrEqual(PLAYER_R-TOL);
 });
 await test.step('Given a car is driving aboard and I am 2 m beside its road, ahead of it',async()=>{
  // the first car of a loading to drive aboard (no car ahead of it on its road), just set off from the queue
  const first=`c=>c.state==='board'&&c.path&&c.v>1&&c.s<6&&c.terminal===window.__app.terminal&&!window.__app.ferry.traffic.cars.some(o=>o!==c&&o.state==='board'&&o.path&&o.seq<c.seq)`;
  await expect.poll(()=>page.evaluate(first=>window.__app.ferry.traffic.cars.some(eval(first)),first),{timeout:240000,intervals:[250]}).toBe(true);
  road=await page.evaluate(first=>{
   const a=window.__app,tr=a.ferry.traffic,car=tr.cars.find(eval(first));
   const V=a.camera.position.constructor,o=new V(),n=new V(),P=car.path;
   tr.roadPoint(car,P.pts,P.seg,P.len,12,o);tr.roadPoint(car,P.pts,P.seg,P.len,13,n);
   const hx=n.x-o.x,hz=n.z-o.z,h=Math.hypot(hx,hz);a.player.debugPlace(o.x-hz/h*2,o.y+0.5,o.z+hx/h*2,'walk');
   return{id:car.id,name:car.name,half:tr.extent(car.name).half,nose:tr.extent(car.name).max.z,target:[o.x,o.z]};},first);
  await page.locator('canvas').first().click({position:{x:700,y:420}});
 });
 await test.step('When I step into its road with the movement keys and stand there',async()=>{
  await page.evaluate(id=>{
   const a=window.__app,tr=a.ferry.traffic,car=tr.cars.find(c=>c.id===id),P=a.player,rows=window.__road=[];
   // where I am against its road from its middle on (sampled every 0.25 m, as Traffic.personInWay samples it): the
   // closest the road comes to me, and how far along it from the car's middle that is
   const V=a.camera.position.constructor,rp=new V();
   const loop=()=>{if(window.__roadStop)return;const p=P.position,R=car.path;let across=Infinity,ahead=null;
    for(let d=0;R&&d<=25;d+=0.25){if(!tr.roadPoint(car,R.pts,R.seg,R.len,d,rp))break;const h=Math.hypot(p.x-rp.x,p.z-rp.z);if(Math.abs(p.y-rp.y)<2&&h<across){across=h;ahead=d;}}
    rows.push({t:performance.now(),v:car.v,by:car.by||null,ahead,across,state:car.state});requestAnimationFrame(loop);};
   requestAnimationFrame(loop);},road.id);
  await steer(page,road.target,1800);await page.waitForTimeout(6000);
 });
 await test.step('Then the car stops short of me and waits while I stand in its road',async()=>{
  const rows=await page.evaluate(()=>{window.__roadStop=true;return window.__road;});await page.screenshot({path:`${OUT}/car-waits-for-me.png`});
  await writeFile(test.info().outputPath('car-waits-frames.json'),JSON.stringify({road,rows}));
  // in its road: ahead of its middle and within its half width and my body of its line
  const inRoad=rows.filter(r=>r.ahead!==null&&r.across<road.half+PLAYER_R);
  expect(inRoad.length,'I stood in the car\'s road').toBeGreaterThan(60);
  const since=inRoad[0].t,late=inRoad.filter(r=>r.t-since>2500);
  expect(late.length,'I stood in its road for over 2.5 s').toBeGreaterThan(30);
  const fastest=Math.max(...late.map(r=>r.v));
  // a driver who has seen someone in the road may creep up to a few metres short of them, never above a walking pace
  expect(fastest,`the car still moved at ${fastest.toFixed(2)} m/s 2.5 s after I stepped into its road`).toBeLessThan(1.4);
  const end=inRoad.filter(r=>r.t>inRoad.at(-1).t-2000);
  const crept=Math.max(...end.map(r=>r.ahead))-Math.min(...end.map(r=>r.ahead));
  expect(crept,`the car came ${crept.toFixed(2)} m closer in the last 2 s I stood in its road: it holds short of me`).toBeLessThanOrEqual(0.5);
  expect(late.some(r=>r.by==='person'),'the car waits for me (Traffic names a person in its road)').toBe(true);
  const gap=Math.min(...inRoad.map(r=>r.ahead-road.nose));
  expect(gap,`its nose came within ${gap.toFixed(2)} m of my centre (my body is ${PLAYER_R} m)`).toBeGreaterThanOrEqual(PLAYER_R);
  expect(errors).toEqual([]);
 });
});

// Every frame, every upright person in the ferry's crowd (foot passengers and drivers, ashore and aboard): pairs whose
// bodies overlap by more than TOL, and anyone inside a solid of the terminal or of her decks. A passenger sidling
// along a row of seats to theirs goes chest first, half a chest's depth (0.15 m) clear of the seats, and the step
// down onto the seat is the seat's own (test/walker-routes.mjs holds the routes to the same rule).
async function crowdFrames(page,seconds){
 return page.evaluate(async({seconds,R,tol})=>{
  const a=window.__app,crowd=a.ferry.crowd,deck=a.ferry.deck,ship=a.ferry.ship,V=a.camera.position.constructor,q=new V(),o=new V(),l=new V(),out={frames:0,overlap:0,solid:0,most:0,kinds:{},examples:[]},SIDLE=0.15;
  const up=p=>p.world&&p.posture!=='sit'&&!(p.knock&&p.knock.kind!=='nudge'&&p.knock.kind!=='stagger');
  // where someone is in the frame they walk in (hers aboard, the terminal's ashore), and what they are doing
  const where=p=>{const w=p.world;if(p.aboard){ship.toLocal(w,l);return'S '+[l.x,l.y,l.z].map(v=>v.toFixed(2)).join(' ');}const t=p.terminal,c=Math.cos(t.yaw),s=Math.sin(t.yaw);t.toWorld([0,0,0],o);const dx=w.x-o.x,dz=w.z-o.z;return t.name+' '+[dx*c-dz*s,w.y-o.y,dx*s+dz*c].map(v=>v.toFixed(2)).join(' ');};
  const doing=p=>({id:p.id,who:p.kind+':'+p.state,at:where(p),lat:+(p.lat||0).toFixed(2),v:+(p.walkV||0).toFixed(2),held:+(p.held||0).toFixed(2),next:p.path?.slice(0,3).map(w=>w.map(v=>typeof v==='number'?+v.toFixed(2):v).join(' ')),seat:!!p.seat});
  const note=(kind,p,extra)=>{const key=kind+' '+p.kind+':'+p.state;out.kinds[key]=(out.kinds[key]||0)+1;if(out.kinds[key]<=10||out.kinds[key]%100===0)out.examples.push({f:out.frames,kind,...doing(p),...extra});};
  const end=performance.now()+seconds*1000;
  while(performance.now()<end){
   await new Promise(requestAnimationFrame);out.frames++;const L=crowd.people.filter(up);out.most=Math.max(out.most,L.length);let ov=0,so=0;
   for(let i=0;i<L.length;i++){
    const p=L[i].world;
    for(let j=i+1;j<L.length;j++){const w=L[j].world,d=Math.hypot(p.x-w.x,p.z-w.z);if(Math.abs(p.y-w.y)<1&&d<2*R-tol){ov++;note('pair',L[i],{other:doing(L[j]),d:+d.toFixed(2)});}}
    // the last two legs of a seated passenger's way: the sidle (half a chest clear) and the step onto the seat (exempt)
    const n=L[i].seat&&L[i].path?L[i].path.length:9;if(n<=2)continue;const r=n===3?SIDLE:R;
    let by=0;q.copy(p);a.colliders.resolveCapsule(q,r,1.7,0.4);by=Math.hypot(q.x-p.x,q.z-p.z);
    if(deck){q.copy(p);if(deck.resolveCapsule(q,r,1.7,0.4))by=Math.max(by,Math.hypot(q.x-p.x,q.z-p.z));}
    if(by>tol){so++;note('solid',L[i],{by:+by.toFixed(2)});}
   }
   if(ov)out.overlap++;if(so)out.solid++;
  }
  return out;},{seconds,R:BODY_R,tol:TOL});
}

test('People in the terminal crowd do not walk through each other or through the terminal',async({page})=>{
 test.setTimeout(420000);const errors=[];page.on('pageerror',e=>errors.push(e.message));let seen;
 await test.step('Given the ferry service is running and its foot passengers are coming through my terminal',async()=>{
  // the shipped short timetable changes only the layover wait: the crowd, its routes and the boarding are the service's own
  await ready(page,'&ferryTimetable=short');
  await expect.poll(()=>page.evaluate(()=>window.__app.ferry.crowd?.people.filter(p=>p.kind==='foot').length??0),{timeout:90000}).toBeGreaterThanOrEqual(4);
 });
 await test.step('When I take the free camera into the walkway behind the gate queue and watch the crowd for 80 s',async()=>{
  await page.locator('canvas').first().click({position:{x:700,y:420}});await page.keyboard.press('KeyF');
  await expect.poll(()=>page.evaluate(()=>window.__app.freeCam)).toBe(true);
  // inside the covered walkway at eye height behind the ticket podium, looking up it at the gate queue and the gangway
  await page.evaluate(()=>{const a=window.__app,w=a.terminal.toWorld([14.6,8.6,1.2]);a.fly.setPose(w,a.terminal.yaw+Math.PI,-0.12);a.fly.velocity.set(0,0,0);});
  const shots=(async()=>{for(const t of [20,50]){await page.waitForTimeout(t===20?20000:30000);await page.screenshot({path:`${OUT}/terminal-crowd-${t}s.png`});}})();
  seen=await crowdFrames(page,80);await shots;
  await writeFile(test.info().outputPath('terminal-crowd-frames.json'),JSON.stringify(seen));
 });
 await test.step('Then no two people overlap and nobody stands inside the terminal or her decks',async()=>{
  expect(seen.frames,'the crowd was watched frame by frame').toBeGreaterThan(300);
  expect(seen.most,'people were walking and waiting in view').toBeGreaterThanOrEqual(6);
  expect(seen.overlap,`${seen.overlap} of ${seen.frames} frames had two people overlapping by more than ${TOL} m, e.g. ${JSON.stringify(seen.examples.filter(e=>e.kind==='pair').slice(0,3))}`).toBe(0);
  expect(seen.solid,`${seen.solid} of ${seen.frames} frames had someone inside a solid, e.g. ${JSON.stringify(seen.examples.filter(e=>e.kind==='solid').slice(0,3))}`).toBe(0);
  expect(errors).toEqual([]);
 });
});
