import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
// Step-1 probe (not a scenario, never committed): what the running game does today.
const OUT=process.env.PW_OUT||'test-results';
async function ready(page,query=''){
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
 await page.goto('/?scale=.6&noAudio'+query);await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
 await page.getByRole('button',{name:'Click to explore',exact:true}).click();await page.getByRole('button',{name:'Skip',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__app.beach.people.length),{timeout:30000}).toBe(26);
}
// in-page per-frame tracker of the player against a target: min distance to a trunk axis, or frames inside a car footprint
async function track(page,spec){await page.evaluate(spec=>{const a=window.__app,P=a.player;window.__probe={min:Infinity,inside:0,frames:0,mode:[]};const V=a.camera.position.constructor,l=new V();
 const loop=()=>{if(!window.__probe||window.__probe.stop)return;const r=window.__probe;r.frames++;const p=P.position;
  if(spec.trunk){const d=Math.hypot(p.x-spec.trunk[0],p.z-spec.trunk[1]);r.min=Math.min(r.min,d);}
  if(spec.car!==undefined){const c=a.ferry.traffic.cars.find(c=>c.id===spec.car);if(c){const g=c.group;l.copy(p).sub(g.position).applyQuaternion(g.quaternion.clone().invert());const b=spec.box;const d=Math.max(b[0]-l.x,l.x-b[1],b[2]-l.z,l.z-b[3]);r.min=Math.min(r.min,d);if(d<0)r.inside++;}}
  if(spec.panel){const pn=a.props.panels?.find?.(x=>x.id===spec.panel)||window.__probePanel;r.broken=!!pn.broken;const b=pn.box;const dx=p.x-b.center.x,dz=p.z-b.center.z,lx=dx*b.cos-dz*b.sin;r.min=Math.min(r.min,Math.abs(lx));}
  r.mode.push(P.mode);if(r.mode.length>5)r.mode.shift();requestAnimationFrame(loop);};requestAnimationFrame(loop);},spec);}
async function steer(page,target,ms,sprint=false){const held=new Set();if(sprint)await page.keyboard.down('ShiftLeft');const end=Date.now()+ms;
 while(Date.now()<end){const s=await page.evaluate(()=>{const p=window.__app.player;return{at:p.position.toArray(),yaw:p.yaw};});
  const dx=target[0]-s.at[0],dz=target[1]-s.at[2],keys=new Set();const f=-dx*Math.sin(s.yaw)-dz*Math.cos(s.yaw),r=dx*Math.cos(s.yaw)-dz*Math.sin(s.yaw);
  if(Math.abs(f)>.05)keys.add(f>0?'KeyW':'KeyS');if(Math.abs(r)>.05)keys.add(r>0?'KeyD':'KeyA');
  for(const k of held)if(!keys.has(k)){await page.keyboard.up(k);held.delete(k);}for(const k of keys)if(!held.has(k)){await page.keyboard.down(k);held.add(k);}await page.waitForTimeout(80);}
 for(const k of held)await page.keyboard.up(k);if(sprint)await page.keyboard.up('ShiftLeft');}
const result=page=>page.evaluate(()=>{const r=window.__probe;r.stop=true;return{min:r.min,inside:r.inside,frames:r.frames,broken:r.broken,mode:r.mode};});
// every upright person, every frame: capsule pairs overlapping by more than 5 cm, and anyone standing inside a solid
async function watch(page,seconds){return page.evaluate(async seconds=>{
 const a=window.__app,V=a.camera.position.constructor,q=new V(),l=new V(),out={frames:0,overlapFrames:0,pairFrames:0,solidFrames:0,trunkFrames:0,carFrames:0,deckFrames:0,maxPeople:0,examples:[],states:{},kinds:{}};
 const traffic=a.ferry.traffic,boxes={};for(const [name,parts] of traffic.parts){let b=[1e9,-1e9,1e9,-1e9];for(const m of parts){m.geometry.computeBoundingBox();const g=m.geometry.boundingBox;b=[Math.min(b[0],g.min.x),Math.max(b[1],g.max.x),Math.min(b[2],g.min.z),Math.max(b[3],g.max.z)];}boxes[name]=b;}
 const T=a.rally.trunks,end=performance.now()+seconds*1000,R=0.27,tol=0.05;
 const up=p=>p.world&&p.posture!=='sit'&&!(p.knock&&p.knock.kind!=='nudge'&&p.knock.kind!=='stagger');
 const who=p=>[p.id,p.kind||p.role||'',p.state||p.mode||''].join(':');const cap={},ex=(kind,p,extra)=>{const key=kind+':'+who(p).split(':').slice(1).join(':');out.kinds[key]=(out.kinds[key]||0)+1;cap[key]=(cap[key]||0)+1;if(cap[key]<=8||cap[key]%200===0)out.examples.push({f:out.frames,kind,who:who(p),at:[p.world.x,p.world.y,p.world.z].map(v=>+v.toFixed(2)),local:p.local?[p.local.x,p.local.y,p.local.z].map(v=>+v.toFixed(2)):null,...extra});};
 while(performance.now()<end){await new Promise(requestAnimationFrame);out.frames++;const L=a.people.list.filter(up);out.maxPeople=Math.max(out.maxPeople,L.length);let ov=0,so=0,tr=0,ca=0,de=0;
  for(let i=0;i<L.length;i++){const P=L[i],p=P.world;const st=who(P).split(':').slice(1).join(':');out.states[st]=(out.states[st]||0)+1;
   for(let j=i+1;j<L.length;j++){const o=L[j].world,d=Math.hypot(p.x-o.x,p.z-o.z);if(Math.abs(p.y-o.y)<1&&d<2*R-tol){ov++;ex('pair',P,{other:who(L[j]),d:+d.toFixed(2)});}}
   q.copy(p);a.colliders.resolveCapsule(q,R,1.7,0.4);const m=Math.hypot(q.x-p.x,q.z-p.z);if(m>tol){so++;ex('solid',P,{by:+m.toFixed(2)});}
   for(let k=0;k<T.length;k+=5){if(p.y+1.7<T[k+3]||p.y+0.4>T[k+4])continue;const d=Math.hypot(p.x-T[k],p.z-T[k+1]);if(d<T[k+2]+R-tol){tr++;ex('trunk',P,{d:+d.toFixed(2),r:+T[k+2].toFixed(2)});}}
   for(const c of traffic.cars){const g=c.group;if(!c.world||Math.abs(g.position.y-p.y)>2||(g.position.x-p.x)**2+(g.position.z-p.z)**2>49)continue;l.copy(p).sub(g.position).applyQuaternion(g.quaternion.clone().invert());const b=boxes[c.name];const d=Math.max(b[0]-R-l.x,l.x-b[1]-R,b[2]-R-l.z,l.z-b[3]-R);if(d<-tol){ca++;ex('car',P,{car:c.id,carState:c.state,v:+c.v.toFixed(2),d:+d.toFixed(2)});}}
   const deck=a.ferry.deck;if(deck){q.copy(p);if(deck.resolveCapsule(q,R,1.7,0.4)&&Math.hypot(q.x-p.x,q.z-p.z)>tol){de++;ex('deck',P,{by:+Math.hypot(q.x-p.x,q.z-p.z).toFixed(2)});}}
  }
  if(ov){out.overlapFrames++;out.pairFrames+=ov;}if(so)out.solidFrames++;if(tr)out.trunkFrames++;if(ca)out.carFrames++;if(de)out.deckFrames++;}
 return out;},seconds);}

test('probe palm',async({page})=>{
 await ready(page);
 const s=await page.evaluate(()=>{const a=window.__app,P=a.player.position,T=a.rally.trunks,t=a.terrainData;let best=null;
  for(let k=0;k<T.length;k+=5){const x=T[k],z=T[k+1],d=Math.hypot(x-P.x,z-P.z);if(d<5||d>60||T[k+2]<0.17||t.heightAt(x,z)<1.2)continue;
   // clear approach 4 m on the side toward the player
   const ux=(P.x-x)/d,uz=(P.z-z)/d,sx=x+ux*4,sz=z+uz*4;let clear=true;for(let j=0;j<T.length;j+=5){if(j!==k&&Math.hypot(T[j]-x,T[j+1]-z)<6)clear=false;}
   if(!clear)continue;if(!best||d<best.d)best={d,x,z,r:T[k+2],sx,sz};}
  a.player.debugPlace(best.sx,a.terrainData.heightAt(best.sx,best.sz),best.sz,'walk');return best;});
 console.log('palm',JSON.stringify(s));await page.locator('canvas').first().click({position:{x:700,y:420}});await page.waitForTimeout(500);
 await track(page,{trunk:[s.x,s.z]});await steer(page,[s.x,s.z],5000);const r=await result(page);
 await page.screenshot({path:`${OUT}/probe-palm.png`});console.log('PALM',JSON.stringify({...r,r:s.r}));
});
test('probe queued car',async({page})=>{
 await ready(page,'&ferryService=off');
 await expect.poll(()=>page.evaluate(()=>window.__app.ferry.traffic?.cars.filter(c=>c.state==='queue'&&!c.path&&c.terminal===window.__app.terminal).length??0),{timeout:60000}).toBeGreaterThanOrEqual(4);
 const s=await page.evaluate(()=>{const a=window.__app,tr=a.ferry.traffic,t=a.terminal;const car=tr.cars.filter(c=>c.terminal===t&&c.state==='queue'&&!c.path&&c.at[0]===4.0).sort((a,b)=>a.at[2]-b.at[2])[0];
  let b=[1e9,-1e9,1e9,-1e9];for(const m of tr.parts.get(car.name)){m.geometry.computeBoundingBox();const g=m.geometry.boundingBox;b=[Math.min(b[0],g.min.x),Math.max(b[1],g.max.x),Math.min(b[2],g.min.z),Math.max(b[3],g.max.z)];}
  const p=t.toWorld([car.at[0]+4,car.at[1],car.at[2]]),c=car.group.position;a.player.debugPlace(p.x,p.y+0.5,p.z,'walk');return{id:car.id,name:car.name,box:b,target:[c.x,c.z],at:p.toArray()};});
 console.log('car',JSON.stringify(s));await page.locator('canvas').first().click({position:{x:700,y:420}});await page.waitForTimeout(500);
 await track(page,{car:s.id,box:s.box});await steer(page,s.target,5000);const r=await result(page);
 await page.screenshot({path:`${OUT}/probe-queued-car.png`});console.log('CAR',JSON.stringify(r));
});
test('probe crowd watch',async({page})=>{
 test.setTimeout(400000);
 await ready(page,'&ferryTimetable=short');
 await expect.poll(()=>page.evaluate(()=>window.__app.ferry.crowd?.state().people.filter(p=>p.kind==='foot').length??0),{timeout:90000}).toBeGreaterThanOrEqual(4);
 await page.evaluate(()=>{const app=window.__app,w=app.terminal.toWorld([22,11.5,-14]);app.setFreeCam(true);app.fly.setPose(w,app.terminal.yaw+Math.PI-0.45,-0.25);app.fly.velocity.set(0,0,0);});
 const shots=(async()=>{for(const t of [20,45,70]){await page.waitForTimeout(t===20?20000:25000);await page.screenshot({path:`${OUT}/probe-crowd-${t}s.png`});}})();
 const w=await watch(page,80);await shots;await writeFile(`${OUT}/probe-crowd.json`,JSON.stringify(w));
 console.log('CROWD',JSON.stringify({...w,examples:w.examples.slice(0,25)}));
 const cars=await page.evaluate(()=>window.__app.ferry.traffic.state().filter(c=>c.state==='parked').length);console.log('PARKED',cars);
});
test('probe parked aboard',async({page})=>{
 test.setTimeout(400000);
 await ready(page,'&ferryTimetable=short');
 await expect.poll(()=>page.evaluate(()=>window.__app.ferry.traffic?.cars.filter(c=>c.state==='parked'&&c.ferry===window.__app.fleet[0]).length??0),{timeout:240000,intervals:[1000]}).toBeGreaterThanOrEqual(1);
 const s=await page.evaluate(()=>{const a=window.__app,tr=a.ferry.traffic,ship=a.fleet[0].ship;const car=tr.cars.find(c=>c.state==='parked'&&c.ferry===a.fleet[0]);
  let b=[1e9,-1e9,1e9,-1e9];for(const m of tr.parts.get(car.name)){m.geometry.computeBoundingBox();const g=m.geometry.boundingBox;b=[Math.min(b[0],g.min.x),Math.max(b[1],g.max.x),Math.min(b[2],g.min.z),Math.max(b[3],g.max.z)];}
  const V=a.camera.position.constructor,l=car.local.clone();l.x-=Math.sign(l.x)*3.2;const w=ship.toWorld(l,new V()),c=car.group.position;a.player.debugPlace(w.x,w.y+0.3,w.z,'walk');return{id:car.id,box:b,target:[c.x,c.z],local:car.local.toArray()};});
 console.log('aboard',JSON.stringify(s));await page.locator('canvas').first().click({position:{x:700,y:420}});await page.waitForTimeout(800);
 await track(page,{car:s.id,box:s.box});await steer(page,s.target,4000);const r=await result(page);
 await page.screenshot({path:`${OUT}/probe-aboard-car.png`});console.log('ABOARD',JSON.stringify(r));
});
test('probe beach watch',async({page})=>{
 test.setTimeout(300000);
 await ready(page);await page.evaluate(()=>window.__view('beach'));
 const shots=(async()=>{await page.waitForTimeout(30000);await page.screenshot({path:`${OUT}/probe-beach-30s.png`});})();
 const w=await watch(page,60);await shots;await writeFile(`${OUT}/probe-beach.json`,JSON.stringify(w));
 console.log('BEACH',JSON.stringify({...w,examples:w.examples.slice(0,25)}));
});
test('probe fence',async({page})=>{
 await ready(page);
 const s=await page.evaluate(async()=>{const a=window.__app,P=a.player.position;let best=null;
  for(const p of [...a.props.grid.values()].flat()){if(p.type!=='fence'||!p.box||p.broken)continue;const b=p.box,d=Math.hypot(b.center.x-P.x,b.center.z-P.z);if(b.half.z<0.8)continue;if(!best||d<best.d)best={d,p};}
  const b=best.p.box,nx=b.cos,nz=-b.sin;window.__probePanel=best.p;const sx=b.center.x+nx*5,sz=b.center.z+nz*5;a.player.debugPlace(sx,b.center.y,sz,'walk');a.props.wakePanel(best.p);
  return{id:best.p.id,target:[b.center.x,b.center.z],at:[sx,sz],awake:a.props.awake.has(best.p.id)};});
 console.log('fence',JSON.stringify(s));await page.locator('canvas').first().click({position:{x:700,y:420}});await page.waitForTimeout(300);
 await track(page,{panel:s.id});await steer(page,s.target,3000,true);const r=await result(page);
 await page.screenshot({path:`${OUT}/probe-fence.png`});console.log('FENCE',JSON.stringify(r));
});
test('probe cost',async({page})=>{
 test.setTimeout(400000);
 await ready(page,'&ferryTimetable=short');
 await page.evaluate(()=>{const app=window.__app,w=app.terminal.toWorld([22,11.5,-14]);app.setFreeCam(true);app.fly.setPose(w,app.terminal.yaw+Math.PI-0.45,-0.25);app.fly.velocity.set(0,0,0);});
 await expect.poll(()=>page.evaluate(()=>window.__app.ferry.traffic?.cars.filter(c=>c.state==='board').length??0),{timeout:240000,intervals:[1000]}).toBeGreaterThanOrEqual(1);
 const r=await page.evaluate(async()=>{const a=window.__app,rows=[];const end=performance.now()+20000;while(performance.now()<end){await new Promise(requestAnimationFrame);rows.push([a.ferry.peopleMs,a.people.state().cpu.ms,1000/a.fps,a.ferry.crowd.people.length,a.ferry.traffic.cars.length]);}
  const mean=i=>rows.reduce((s,r)=>s+r[i],0)/rows.length;return{frames:rows.length,trafficCrowdMs:mean(0),peopleCpuMs:mean(1),frameMs:mean(2),crowd:mean(3),cars:mean(4)};});
 console.log('COST',JSON.stringify(r));
});

test('probe captures',async({page})=>{
 test.setTimeout(560000);
 await ready(page,'&ferryTimetable=short');
 await page.waitForTimeout(1500);await page.screenshot({path:`${OUT}/after-arrival.png`});
 const near=await page.evaluate(()=>{const a=window.__app,P=a.player.position;const L=a.people.list.filter(p=>p.world).map(p=>({id:p.id,role:p.role||p.kind,state:p.state||p.brain?.activity?.name,d:+Math.hypot(p.world.x-P.x,p.world.z-P.z).toFixed(2),dy:+(p.world.y-P.y).toFixed(2)})).sort((x,y)=>x.d-y.d).slice(0,5);
  const U=a.people.list.filter(p=>p.world&&p.posture!=='sit'&&Math.hypot(p.world.x-P.x,p.world.z-P.z)<25),pairs=[];for(let i=0;i<U.length;i++)for(let j=i+1;j<U.length;j++){const d=Math.hypot(U[i].world.x-U[j].world.x,U[i].world.z-U[j].world.z);if(d<0.49&&Math.abs(U[i].world.y-U[j].world.y)<1)pairs.push([U[i].id,U[j].id,+d.toFixed(2)]);}return{player:[P.x,P.y,P.z].map(v=>+v.toFixed(2)),mode:a.player.mode,nearest:L,pairs};});
 console.log('ARRIVAL',JSON.stringify(near));
 await expect.poll(()=>page.evaluate(()=>window.__app.ferry.crowd?.people.filter(p=>p.kind==='foot').length??0),{timeout:90000}).toBeGreaterThanOrEqual(4);
 const cam=(frame,at,look,pitch)=>page.evaluate(({frame,at,look,pitch})=>{const a=window.__app,V=a.camera.position.constructor;if(!a.freeCam)a.setFreeCam(true);
  const ship=a.ferry.ship,T=a.ferry.crowd.people.find(p=>p.state==='queue')?.terminal||a.terminal,w=frame==='S'?ship.toWorld(new V(...at),new V()):T.toWorld(at);a.fly.setPose(w,(frame==='S'?ship.yaw:T.yaw)+look,pitch);a.fly.velocity.set(0,0,0);},{frame,at,look,pitch});
 const who=()=>page.evaluate(()=>window.__app.ferry.crowd.people.map(p=>p.terminal.name+':'+p.kind+':'+p.state).reduce((m,k)=>(m[k]=(m[k]||0)+1,m),{}));
 await cam('T',[14.6,8.6,1.2],Math.PI,-0.12);await page.waitForTimeout(15000);await page.screenshot({path:`${OUT}/after-terminal-queue.png`});console.log('QUEUE',JSON.stringify(await who()));
 await cam('T',[13.4,8.8,-6],Math.PI-0.1,-0.1);await page.waitForTimeout(1500);await page.screenshot({path:`${OUT}/after-walkway.png`});
 await expect.poll(()=>page.evaluate(()=>window.__app.ferry.crowd.people.filter(p=>p.state==='seated'&&p.at?.[0]==='S').length),{timeout:240000,intervals:[1000]}).toBeGreaterThanOrEqual(3);
 await page.waitForTimeout(4000);await cam('S',[5.0,9.3,14.2],0,-0.3);await page.waitForTimeout(400);await page.screenshot({path:`${OUT}/after-saloon.png`});console.log('SALOON',JSON.stringify(await who()));
 await expect.poll(()=>page.evaluate(()=>window.__app.ferry.crowd.people.filter(p=>p.state==='stand'&&p.at?.[0]==='S'&&p.at[2]>9).length),{timeout:120000,intervals:[1000]}).toBeGreaterThanOrEqual(1);
 const rail=await page.evaluate(()=>{const p=window.__app.ferry.crowd.people.find(p=>p.state==='stand'&&p.at?.[0]==='S'&&p.at[2]>9);return p.at.slice(1);});
 await cam('S',[Math.sign(rail[0])*7.7,11.7,rail[2]-6],Math.PI,-0.25);await page.waitForTimeout(400);await page.screenshot({path:`${OUT}/after-rail.png`});console.log('RAIL',JSON.stringify(rail));
 // the player on her sun deck walking aft into the stern rail's corner, in the third-person camera
 await page.evaluate(()=>{const a=window.__app;a.setFreeCam(false);const V=a.camera.position.constructor,w=a.ferry.ship.toWorld(new V(7.7,10.05,-23.2),new V());a.player.debugPlace(w.x,w.y+0.3,w.z,'walk');});
 await page.locator('canvas').first().click({position:{x:700,y:420}});await page.waitForTimeout(800);
 const goal=await page.evaluate(()=>{const a=window.__app,V=a.camera.position.constructor,w=a.ferry.ship.toWorld(new V(8.95,10.05,-25.4),new V());return[w.x,w.z];});
 await page.evaluate(()=>{const a=window.__app,V=a.camera.position.constructor,l=new V(),r=window.__stern={rows:[]};const loop=()=>{if(r.stop)return;a.ferry.ship.toLocal(a.player.position,l);r.rows.push([l.x,l.y,l.z,a.player.mode]);requestAnimationFrame(loop);};requestAnimationFrame(loop);});
 await steer(page,goal,3500);await page.waitForTimeout(300);await page.screenshot({path:`${OUT}/after-stern-rail-player.png`});
 const st=await page.evaluate(()=>{const r=window.__stern;r.stop=true;const last=r.rows.at(-1);return{last,maxX:Math.max(...r.rows.map(q=>q[0])),minZ:Math.min(...r.rows.map(q=>q[2])),frames:r.rows.length};});console.log('STERN',JSON.stringify(st));
});
test('probe queue view',async({page})=>{
 test.setTimeout(300000);
 await ready(page,'&ferryTimetable=short');
 await expect.poll(()=>page.evaluate(()=>window.__app.ferry.crowd?.people.filter(p=>p.state==='queue'&&!p.path).length??0),{timeout:120000}).toBeGreaterThanOrEqual(3);
 const r=await page.evaluate(async()=>{const a=window.__app,V=a.camera.position.constructor,q=a.ferry.crowd.people.filter(p=>p.state==='queue'&&!p.path),T=q[0].terminal;a.setFreeCam(true);
  const w=T.toWorld([14.9,8.75,9.4]);a.fly.setPose(w,T.yaw-0.12,-0.2);a.fly.velocity.set(0,0,0);for(let i=0;i<30;i++)await new Promise(requestAnimationFrame);
  const c=a.camera.position,d=a.camera.getWorldDirection(new V());
  return{T:T.name,cam:[c.x,c.y,c.z].map(v=>+v.toFixed(2)),dir:[d.x,d.y,d.z].map(v=>+v.toFixed(2)),q:q.map(p=>({id:p.id,spot:p.spot,at:p.at,world:[p.world.x,p.world.y,p.world.z].map(v=>+v.toFixed(2)),vis:p.group.visible,inScene:!!p.group.parent,kids:p.group.children.length,mvis:p.model.group.visible,lod:p.lod,pos:p.group.position.toArray().map(v=>+v.toFixed(2))}))};});
 console.log('QVIEW',JSON.stringify({T:r.T,cam:r.cam,dir:r.dir,n:r.q.length}));await page.screenshot({path:`${OUT}/queue-view.png`});await page.waitForTimeout(12000);await page.screenshot({path:`${OUT}/queue-view-12s.png`});
});
