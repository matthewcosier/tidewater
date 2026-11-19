import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { SCENARIO_TIMEOUT_MS, untilGameTimeCheck } from './gameTime.js';

async function ready(page,audio=false) {
 await page.route('https://fonts.googleapis.com/**', r => r.fulfill({contentType:'text/css', body:''}));
 const scale=process.env.PW_RENDER_SCALE??'0.5';
 await page.goto(`/?scale=${scale}${audio?'':'&noAudio'}`);
 await expect(page.getByRole('status', {name:'Loading Tidewater'})).toBeHidden({timeout:120000});
 await page.getByRole('button',{name:'Click to explore',exact:true}).click();
 await page.getByRole('button', {name:'Skip', exact:true}).click();
 await page.getByRole('button', {name:'Disasters', exact:true}).click();
}
const geometry = page => page.evaluate(()=>window.__app.disasters.structures.records.map(r=>({name:r.name,broken:r.broken,progressive:!!r.progressive,position:[r.center.x,r.center.z],vertices:r.spans.flatMap(s=>Array.from(s.geo.attributes.position.array.slice(s.start*3,s.start*3+9))),colliders:r.colliders.map(c=>[c.solid??null,c.walkable??null,c.yMin??null,c.yMax??null])})));
const physics = page => page.evaluate(()=>Array.from(window.__app.rally.physics.disaster_motion()));
const status = page => page.getByRole('status', {name:'Disaster simulation'});
// Surge 2 m at the village, replayed from one seed through the internal one-shot hook (Disasters.start
// consumes window.__app.disasters.nextSeed for the event and the run's capacity scatter; no UI shows or
// sets it, test/disaster-next-seed.mjs). A tsunami is drawn per event, so without it the run-up, the
// heading and which houses fail change every run.
const TSUNAMI_SEED=7;
// The structures' own exposure rule (src/disasters/Structures.js update: depth > 0.08 m over the footprint
// base and a surface above 0.1 m): a building the water never reached in that sense stands above the run-up.
const WETTED=0.08; // m
// Structures.js activates the member model at utilization (load / scattered anchor capacity) above 0.5.
const ACTIVATES=0.5;

for (const kind of ['Earthquake','Tsunami','Tornado']) test(`${kind}: control, physical effect, pause, stop and restore`, async ({page}) => {
 test.setTimeout(SCENARIO_TIMEOUT_MS);
 // Budgets are game seconds on the disaster clock (test/browser/gameTime.js): the same numbers as the old wall-clock polls.
 const within=async(check,budget,what)=>{const r=await untilGameTimeCheck(page,check,budget);expect(r.value,`${what} within ${budget} game s (waited ${r.elapsed.toFixed(1)} s)`).toBeTruthy();};
 const errors=[];let original;page.on('pageerror', e=>errors.push(e.message));
 page.on('console', m=>{if(/WGSL|shader|pipeline|GPUValidation/i.test(m.text())&&m.type()!=='debug')errors.push(m.text());});
 await test.step('Given a fresh island and the disaster controls',async()=>{
  await ready(page);
  await page.getByLabel('Disaster type').selectOption(kind.toLowerCase());
  await page.getByLabel('Target location').selectOption('village');
  { const advanced = page.locator( 'details.disaster-advanced:not([open]) > summary' ); if ( await advanced.isVisible() ) await advanced.click(); }
  if(kind==='Tsunami')await page.getByLabel('Warning lead time (s)').fill('6');
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill(kind==='Earthquake'?'1.4':kind==='Tsunami'?'2':'100');
  await page.getByLabel('Radius (m)').fill('180');
  await page.locator('[data-key="duration"]').fill('90');
  await page.getByRole('button',{name:'View target',exact:true}).click();
  original=await geometry(page);
  if(kind==='Tsunami')await page.evaluate(seed=>{window.__app.disasters.nextSeed=seed;},TSUNAMI_SEED);
 });
 await test.step('When I start the configured disaster',async()=>{
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();
  // Test-side reader, not a driver: the peak water depth over each footprint base and the peak load ratio
  // the structures model saw, every frame of the run.
  if(kind==='Tsunami')await page.evaluate(()=>{const d=window.__app.disasters,f=d.field,rs=d.structures.records,s={};const peak=window.__tsunamiPeaks=rs.map(r=>({base:r.center.y-r.half.y,depth:0,util:0,before:0}));const ts=d.bodies.trees,treePeak=window.__treePeaks=ts.map(()=>0);const tick=()=>{for(let i=0;i<rs.length;i++){const r=rs[i],p=r.center;f.sample(p.x,p.y,p.z,s);const depth=s.height>.1?s.height-peak[i].base:0;if(depth>peak[i].depth)peak[i].depth=depth;if((r.utilization??0)>peak[i].util)peak[i].util=r.utilization;if(!r.broken&&(r.utilization??0)>peak[i].before)peak[i].before=r.utilization;}for(let i=0;i<ts.length;i++){if((ts[i].load??0)>treePeak[i])treePeak[i]=ts[i].load;}if(window.__tsunamiPeaks===peak)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
 });
 if(kind==='Tsunami')await test.step('Then the surge comes ashore: furniture moves, houses above the run-up stand, damage only where the flow passes the material threshold',async()=>{
  const event=()=>page.evaluate(()=>{const e=window.__app.disasters.field.events.get('tsunami');return e&&{seed:e.seed,time:e.time,arrival:e.arrival,launched:!!e.launched,coast:!!e.coastReached};});
  const first=await event();
  expect(first.seed,'the hook fixed the event seed').toBe(TSUNAMI_SEED);
  await within(async()=>(await event()).launched,first.arrival,'the crest launched into the ring');
  const banner=page.getByRole('status',{name:'Tsunami warning'});
  await expect(banner).toContainText('Estimated crest arrival');
  await expect(banner).not.toContainText('Coastal flooding detected');
  await page.evaluate(()=>{const A=window.__app,e=A.disasters.field.events.get('tsunami'),a=e.direction*Math.PI/180,cx=Math.cos(a),cz=Math.sin(a);const eye={x:e.x+cx*60-cz*70,z:e.z+cz*60+cx*70},look={x:e.x-cx*160,z:e.z-cz*160};const y=A.terrainData.heightAt(eye.x,eye.z)+45;A.setFreeCam(true);A.camera.position.set(eye.x,y,eye.z);const dx=look.x-eye.x,dy=2-y,dz=look.z-eye.z;A.camera.lookAt(look.x,2,look.z);A.fly.setPose(A.camera.position,Math.atan2(-dx,-dz),Math.asin(dy/Math.hypot(dx,dy,dz)));A.fly.velocity.set(0,0,0);A.cameraCut();});
  await within(async()=>{const e=await event();return e.time>=e.arrival-10;},first.arrival,'10 s before the crest estimate');
  await page.screenshot({path:test.info().outputPath('tsunami-surge-approach.png')});
  await within(async()=>(await event()).coast,first.arrival+30,'the crest reached the coast');
  await within(async()=>{const e=await event();return e.time>=e.arrival+5;},first.arrival+10,'5 s after the crest estimate');
  await page.screenshot({path:test.info().outputPath('tsunami-surge-impact.png')});
  await within(async()=>{const e=await event();return e.time>=e.arrival+40;},first.arrival+60,'40 s of flooding after the arrival estimate');
  await within(async()=>Number(await status(page).getAttribute('data-moved'))>0,30,'loose beach furniture moved');
  await page.screenshot({path:test.info().outputPath('tsunami-surge-flooded.png')});
  const peaks=await page.evaluate(()=>window.__tsunamiPeaks),current=await geometry(page);
  const wetted=peaks.filter(p=>p.depth>WETTED),runUp=Math.max(...wetted.map(p=>p.base+p.depth));
  console.log(`tsunami surge seed ${TSUNAMI_SEED}: run-up ${runUp.toFixed(2)} m, ${wetted.length}/${peaks.length} footprints wetted, ${current.filter(r=>r.broken).length} broken, peak load ratio ${Math.max(...peaks.map(p=>p.util)).toFixed(2)}; broken at load/standing peak: ${current.map((r,i)=>r.broken?`${r.name} ${peaks[i].util.toFixed(2)}/${peaks[i].before.toFixed(2)}`:null).filter(Boolean).join(", ")}`);
  expect(wetted.length,'the surge reached some footprints').toBeGreaterThan(0);
  for(let i=0;i<peaks.length;i++){
   if(peaks[i].depth<=WETTED)expect(current[i],`${original[i].name} above the run-up stands untouched`).toEqual(original[i]);
   if(current[i].broken)expect(peaks[i].util,`${original[i].name} failed only past the activation load (depth ${peaks[i].depth.toFixed(2)} m)`).toBeGreaterThan(ACTIVATES);
  }
  // Trees fail on their own rule (src/disasters/Bodies.js update: damage grows only while the root-plate load
  // ratio t.load is above 1; a fallen tree keeps its last ratio), so no tree may fall that never passed 1.
  const trees=await page.evaluate(()=>window.__app.disasters.bodies.trees.map((t,i)=>({fallen:!!t.fallen,peak:window.__treePeaks[i]})));
  console.log(`tsunami surge seed ${TSUNAMI_SEED}: ${trees.filter(t=>t.fallen).length}/${trees.length} trees down, peak tree load ratio ${Math.max(0,...trees.map(t=>t.peak)).toFixed(2)}`);
  for(const [i,t] of trees.entries())if(t.fallen)expect(t.peak,`tree ${i} fell only past its root-plate capacity`).toBeGreaterThan(1);
 });
 await test.step('Then real island objects react and the event has measurable force',async()=>{
  await expect(status(page)).toHaveAttribute('data-active',kind.toLowerCase());
  await within(async()=>Number(await status(page).getAttribute('data-peak-force'))>1,45,'peak force above 1 N');
  await within(async()=>Number(await status(page).getAttribute('data-moved'))>0,60,'an island object moved');
  await within(async()=>Number(await status(page).getAttribute('data-destroyed'))>0,60,'an island object destroyed');
  await within(async()=>{const current=await geometry(page);return current.some((r,i)=>r.broken&&r.vertices.some((v,j)=>Math.abs(v-original[i].vertices[j])>.05)&&(r.progressive?r.colliders.some(c=>c[0]===false||c[2]<-1e8):r.colliders.every(c=>c[0]===false||c[2]<-1e8)));},60,'a broken structure moved its geometry and dropped its colliders');
  // A progressive building (docs/disaster-damage.md) drops only its failed parts' colliders: its standing walls keep
  // theirs (a walker is stopped by them), so it needs one dropped collider, not all of them. Whole-record
  // structures still drop every collider.
  const current=await geometry(page);if(kind!=='Tsunami')for(let i=0;i<original.length;i++)if(Math.hypot(original[i].position[0]-40,original[i].position[1]+115)>420)expect(current[i]).toEqual(original[i]);
  expect((await physics(page)).length).toBeGreaterThan(7);
  // The 25 ms disaster cap slows a loaded frame in either mode: the words must agree with the speed shown.
  const playback=(await status(page).textContent()).match(/Playback ([a-z ]+) · (\d+\.\d\d)× speed/);
  expect(playback,'status names the playback and its speed').not.toBeNull();
  expect(playback[1],`playback at ${playback[2]}× speed`).toBe(Number(playback[2])<1?'slowed under load':'real time');
  if(kind==='Tornado'&&process.env.PW_CAPTURE_MOTION==='1'){
   const sequence=[];for(let frame=0;frame<3;frame++){
    const at=await page.evaluate(()=>({time:window.__app.disasters.field.time,motion:Array.from(window.__app.rally.physics.disaster_motion()),centre:window.__app.disasters.field.center(window.__app.disasters.field.events.get('tornado'))}));sequence.push(at);
    await page.screenshot({path:test.info().outputPath( `tidewater-tornado-motion-${frame}.png` )});
    if(frame<2)await expect.poll(()=>page.evaluate(()=>window.__app.disasters.field.time),{timeout:15000}).toBeGreaterThan(at.time+.7);
   }await writeFile(test.info().outputPath( 'tidewater-tornado-motion.json' ),JSON.stringify(sequence,null,2));
   const first=sequence[0].motion,id=first.find((v,i)=>i%7===0&&v>=100000);expect(id).toBeDefined();
   const a=first.indexOf(id),last=sequence[2].motion,b=last.indexOf(id);expect(b).toBeGreaterThanOrEqual(0);expect(Math.hypot(last[b+1]-first[a+1],last[b+2]-first[a+2],last[b+3]-first[a+3])).toBeGreaterThan(.1);
  }
 });
 await test.step('When I pause the simulation then event time and body poses stay fixed',async()=>{
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  await expect(status(page)).toHaveAttribute('data-paused','true');
  const solved=await physics(page),shape=await geometry(page);
  const before=await status(page).getAttribute('data-pose');
  const t=await status(page).getAttribute('data-time');
  await page.waitForTimeout(process.env.PW_RENDER_SCALE==='1'?1800:600);
  await expect(status(page)).toHaveAttribute('data-pose',before);
  await expect(status(page)).toHaveAttribute('data-time',t);
  expect(await physics(page)).toEqual(solved);expect(await geometry(page)).toEqual(shape);
  await page.screenshot({path:test.info().outputPath( `tidewater-disaster-bdd-${kind.toLowerCase()}${process.env.PW_RENDER_SCALE==='1'?'-full':''}.png` )});
 });
 await test.step('When I resume and stop then forcing ends but damage remains',async()=>{
  await page.getByRole('button',{name:'Resume simulation',exact:true}).click();
  await page.getByRole('button',{name:'Stop all disasters',exact:true}).click();
  await expect(status(page)).toHaveAttribute('data-active','none');
  await expect.poll(async()=>Number(await status(page).getAttribute('data-destroyed'))).toBeGreaterThan(0);
 });
 await test.step('When I restore the island then structures, bodies and controls return',async()=>{
  await page.getByRole('button',{name:'Restore island',exact:true}).click();
  await expect(status(page)).toHaveAttribute('data-destroyed','0');
  await expect(status(page)).toHaveAttribute('data-moved','0');
  await expect(status(page)).toHaveAttribute('data-active','none');
  await expect(status(page)).toHaveAttribute('data-restored','true');
  expect(await geometry(page)).toEqual(original);
  expect(errors).toEqual([]);
 });
});

test('Disaster controls validate parameters and support repeat runs', async({page})=>{
 await test.step('Given the disaster panel in a fresh context',async()=>{await ready(page);});
 await test.step('When invalid intensity is entered then starting is prevented',async()=>{
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('9999');
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();
  await expect(page.getByRole('alert',{name:'Disaster validation'})).toContainText('Intensity');
  await expect(status(page)).toHaveAttribute('data-active','none');
 });
 await test.step('When a valid short event runs then it ends and can run again',async()=>{
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('0.2');
  await page.getByLabel('Duration (s)').fill('3');
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();
  await expect(status(page)).toHaveAttribute('data-active','earthquake');
  await expect(status(page)).toHaveAttribute('data-active','none',{timeout:45000});
  await page.getByRole('button',{name:'Restore island',exact:true}).click();
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();
  await expect(status(page)).toHaveAttribute('data-active','earthquake');
  await page.getByRole('button',{name:'Stop all disasters',exact:true}).click();
 });
});

test('Tsunami early warning has physical lead time and gesture-created audio respects mute, volume and lifecycle',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await test.step('Given a fresh island with audio enabled and no warning source before a gesture',async()=>{await ready(page,true);await expect(status(page)).toHaveAttribute('data-audio-sources','0');await page.getByLabel('Disaster type').selectOption('tsunami');await page.getByLabel('Target location').selectOption('pier');{ const advanced = page.locator( 'details.disaster-advanced:not([open]) > summary' ); if ( await advanced.isVisible() ) await advanced.click(); }await page.getByLabel('Warning lead time (s)').fill('6');await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('8');});
 await test.step('When I start a tsunami then a directional warning leads the wave and actual audio starts',async()=>{await page.getByRole('button',{name:'Start disaster',exact:true}).click();const warning=page.getByRole('status',{name:'Tsunami warning'});await expect(warning).toContainText('Estimated crest arrival');const heading=await page.evaluate(()=>{const e=window.__app.disasters.field.events.get('tsunami');return {drawn:e.direction,asked:e.requestedDirection};});/* The heading is drawn per event within Field.js AZIMUTH_SPREAD (8 deg) of the requested -90; the banner prints it in whole degrees (it printed the raw float, -82.9...). */expect(heading.asked).toBe(-90);expect(Math.abs(heading.drawn-heading.asked)).toBeLessThanOrEqual(8);await expect(warning).toContainText(`direction ${Math.round(heading.drawn)}°`);expect(Number(await warning.getAttribute('data-countdown'))).toBeGreaterThan(6);await expect(status(page)).toHaveAttribute('data-audio-context','running');await expect(status(page)).toHaveAttribute('data-audio-sources','2');await expect.poll(()=>page.evaluate(()=>window.__app.disasters.siren.gain?.gain.value??0),'the warning is open (its volume and mute level above zero)').toBeGreaterThan(0);const wave=await page.evaluate(()=>({launched:window.__app.disasters.field.events.get('tsunami').launched,seconds:window.__app.disasters.field.events.get('tsunami').time}));expect(wave.seconds).toBeLessThan(6);expect(wave.launched).toBe(false);});
 await test.step('When I change volume and mute then the actual gain changes',async()=>{const sirenGain=()=>page.evaluate(()=>window.__app.disasters.siren.gain?.gain.value??0);await expect.poll(sirenGain).toBeGreaterThan(0);const before=await sirenGain();await page.getByLabel('Disaster sound volume').fill('100');await expect.poll(sirenGain).toBeGreaterThan(before*1.2);await page.getByLabel('Mute disaster sound').check();await expect.poll(()=>page.evaluate(()=>window.__app.disasters.siren.gain?.gain.value??1)).toBeLessThan(.001);await page.getByLabel('Mute disaster sound').uncheck();await expect.poll(sirenGain).toBeGreaterThan(before*1.2);});
 await test.step('When I use global M then the warning also mutes, and pressing M again brings it back to its level',async()=>{const sirenGain=()=>page.evaluate(()=>window.__app.disasters.siren.gain?.gain.value??0);const before=await sirenGain();expect(before,'the warning sounds before M is pressed').toBeGreaterThan(0);await page.getByRole('button',{name:'Close disaster controls'}).click();await page.keyboard.press('m');await expect.poll(()=>page.evaluate(()=>window.__app.disasters.siren.gain?.gain.value??1)).toBeLessThan(.001);await page.keyboard.press('m');await page.getByRole('button',{name:'Disasters',exact:true}).click();await expect.poll(sirenGain,'after M again the warning is back near its level before muting').toBeGreaterThan(.9*before);});
 await test.step('When M is held while paused then repeated keydown does not toggle mute again',async()=>{
  await page.getByRole('button',{name:'Pause simulation',exact:true}).click();
  await page.getByRole('button',{name:'Close disaster controls'}).click();
  const muted=()=>page.evaluate(()=>window.__app.audio?.muted??window.__app.disasters.globalMuted??false);
  await page.keyboard.down('m');await expect.poll(muted).toBe(true);
  await page.keyboard.down('m');await expect.poll(muted).toBe(true);
  await page.keyboard.up('m');await page.keyboard.press('m');await expect.poll(muted).toBe(false);
  await page.getByRole('button',{name:'Disasters',exact:true}).click();
  await page.getByRole('button',{name:'Resume simulation',exact:true}).click();
  await expect(status(page)).toHaveAttribute('data-audio-sources','2');
 });
 await test.step('When I pause, resume, stop and restore then oscillator sources end and restart without accumulation',async()=>{await page.evaluate(()=>{window.__sirenEnded=0;window.__app.disasters.siren.nodes.forEach(o=>o.addEventListener('ended',()=>window.__sirenEnded++));});await page.getByRole('button',{name:'Pause simulation',exact:true}).click();await expect(status(page)).toHaveAttribute('data-audio-sources','0');await expect.poll(()=>page.evaluate(()=>window.__sirenEnded)).toBe(2);await page.getByRole('button',{name:'Resume simulation',exact:true}).click();await expect(status(page)).toHaveAttribute('data-audio-sources','2');await page.getByRole('button',{name:'Stop all disasters',exact:true}).click();await expect(status(page)).toHaveAttribute('data-audio-sources','0');await expect(page.getByRole('status',{name:'Tsunami warning'})).toBeHidden();await page.getByRole('button',{name:'Restore island',exact:true}).click();expect(errors).toEqual([]);});
});

// A tsunami heard coming (docs/disasters.md, "Sound and camera"). The levels are the game's own: the mixer's disaster bus
// (window.__app.audio: its live sources and gain) and the level at the listener that drives it (window.__app.disasterSound),
// read between frames on the disaster clock, never the speakers. The flood is the strongest wave from the panel, which
// reaches the player at the boardwalk (test/browser/player-flood.spec.js).
test('A tsunami is heard coming: the roar at the listener rises as the front nears, mutes with the panel and stops after Restore',async({page})=>{
 test.setTimeout(SCENARIO_TIMEOUT_MS);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let rows;
 await test.step('Given the player at the boardwalk with sound on and no disaster sound playing',async()=>{
  await ready(page,true);
  await expect.poll(()=>page.evaluate(()=>window.__app.audio?.enabled??false)).toBe(true);
  expect(await page.evaluate(()=>window.__app.audio.disasterSources??0)).toBe(0);
  await page.getByLabel('Disaster type').selectOption('tsunami');{ const advanced = page.locator( 'details.disaster-advanced:not([open]) > summary' ); if ( await advanced.isVisible() ) await advanced.click(); }
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('25');await page.getByLabel('Warning lead time (s)').fill('3');
  // Measurement only: PW_DISASTER_ROW puts the Disaster sound volume row elsewhere for the whole event (the arrival at
  // the top of the row is measured at the top, not scaled to it); the steps below assert the same decisions at any row
  const row=Number(process.env.PW_DISASTER_ROW||75);if(row!==75){await page.getByLabel('Disaster sound volume').fill(String(row));console.log(`[disaster-sound] row ${row} for the whole event`);}
 });
 await test.step('When I start the strongest tsunami with a three second warning',async()=>{
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();
  await expect.poll(()=>page.evaluate(()=>window.__app.disasters.field.events.size)).toBeGreaterThan(0);
  const seed=await page.evaluate(()=>window.__app.disasters.runSeed);test.info().annotations.push({type:'disaster-seed',description:String(seed)});console.log(`[disaster-seed] tsunami heard: ${seed}`);
 });
 await test.step('Then the roar at the listener rises as the breaking front nears and the flood passing me has live disaster sound',async()=>{
  // Read-only rows every 0.25 game s between frames until the flood has stood at the listener for 8 s (or the crest
  // estimate + 40 s): the flood depth at the camera from the field, the front distance and level the sound module
  // heard, the mixer's live disaster sources and nodes, and the module's own milliseconds a frame.
  // Measurement only (it asserts nothing and changes no sound): the peak sample before and after the master limiter,
  // from a worklet tapped beside the mixer's own path into a silent sink, for the headroom figure in docs/disasters.md.
  // Meters (measurement only, nothing asserted on them, nothing changed in the sound): each a worklet beside the mixer's own
  // path into a silent sink, read and reset every row. bus: the disaster bus's own output (its last node), the disaster
  // sound alone; pre: the whole mix into the master limiter (after the master volume), the island and the disaster; post:
  // the limiter's output, what is heard; loud: that output K-weighted (ITU-R BS.1770 shelf and high-pass) for loudness.
  // The warning siren goes to the output on its own path and is in none of them.
  await page.evaluate(async()=>{try{const A=window.__app.audio,c=A.ctx,code="registerProcessor('peak-meter',class extends AudioWorkletProcessor{constructor(){super();this.p=0;this.s=0;this.n=0;this.port.onmessage=()=>{this.port.postMessage({p:this.p,s:this.s,n:this.n});this.p=0;this.s=0;this.n=0;};}process(i){for(const ch of i[0]||[])for(let k=0;k<ch.length;k++){const v=Math.abs(ch[k]);if(v>this.p)this.p=v;this.s+=v*v;this.n++;}return true;}})";await c.audioWorklet.addModule(URL.createObjectURL(new Blob([code],{type:'application/javascript'})));const sink=c.createGain();sink.gain.value=0;sink.connect(c.destination);const meter=n=>{const m=new AudioWorkletNode(c,'peak-meter');if(n)n.connect(m);m.connect(sink);return m;};const shelf=c.createBiquadFilter();shelf.type='highshelf';shelf.frequency.value=1681.97;shelf.gain.value=4;const hp=c.createBiquadFilter();hp.type='highpass';hp.frequency.value=38.14;hp.Q.value=.5;A.limiter.connect(shelf);shelf.connect(hp);const meters={pre:meter(A.master),post:meter(A.limiter),loud:meter(hp),bus:meter(null)};let busNode=null;const read=k=>new Promise(r=>{const m=meters[k];setTimeout(()=>r(null),500);m.port.onmessage=e=>r(e.data);m.port.postMessage(0);});window.__meter=async k=>{if(k==='bus'){const n=A.disasterOut??A.disaster??null;if(n!==busNode){try{busNode?.disconnect(meters.bus);}catch(e){}busNode=n;n?.connect(meters.bus);}}return read(k);};window.__peak=async k=>{const v=await window.__meter(k);return v?20*Math.log10(Math.max(1e-9,v.p)):-999;};}catch(e){window.__peak=null;window.__meter=null;}});
  rows=await page.evaluate(async()=>{
   const a=window.__app,f=a.disasters.field,out=[],until=f.events.get('tsunami').arrival+40,wall=performance.now()+600000;let next=0,wetFor=0;
   const between=()=>new Promise(resolve=>requestAnimationFrame(()=>{const check=()=>a.simulationPending?setTimeout(check,4):resolve();check();}));
   const num=(v,d)=>Number.isFinite(v)?v:d;
   while(f.time<until&&f.events.has('tsunami')&&performance.now()<wall){await between();if(f.time<next)continue;next=f.time+.25;
    const c=a.camera.position,depth=Math.max(0,f.waterAt(c.x,c.z)-a.terrainData.heightAt(c.x,c.z)),s=a.disasterSound?.state;
    out.push({time:f.time,launched:!!f.events.get('tsunami')?.launched,depth,front:num(s?.front,99999),level:num(s?.level,-999),sources:a.audio?.disasterSources??0,nodes:a.audio?.disasterNodes??0,ms:num(s?.ms,0),msMax:num(s?.msMax,0),phases:[num(s?.msListen,0),num(s?.msScan,0),num(s?.msPlay,0)],pre:window.__peak?await window.__peak('pre'):null,post:window.__peak?await window.__peak('post'):null,bus:window.__peak?await window.__peak('bus'):null,loud:window.__meter?await window.__meter('loud'):null,rest:a.audio?.restGain??1});
    if(depth>.1&&(wetFor+=.25)>8)break;}
   return out;});
  await test.info().attach('tsunami-heard-frames',{body:JSON.stringify(rows),contentType:'application/json'});
  const passing=rows.filter(r=>r.depth>.1);
  expect(passing.length,'the flood reached the listener').toBeGreaterThan(0);
  expect(Math.max(...passing.map(r=>r.sources)),'a disaster sound other than the siren has a live source while the flood passes the listener').toBeGreaterThan(0);
  const median=v=>v.slice().sort((x,y)=>x-y)[Math.floor(v.length/2)];
  const before=rows.filter(r=>!r.launched),far=rows.filter(r=>r.front>=400&&r.front<99999);
  expect(Math.max(...before.map(r=>r.level)),'nothing is heard of the wave before it is launched').toBeLessThan(-60);
  expect(far.length,'the breaking front is heard while it is still 400 m or more away').toBeGreaterThan(0);
  // The approach: the 30 game s before the flood reaches the listener, against the run before it. Not binned by front
  // distance over the whole event: after launch the sea near the boardwalk surges in and out 50 to 100 m off, well
  // before the bore comes, and is heard as what it is.
  const tA=passing[0].time,approach=rows.filter(r=>r.time>=tA-30&&r.time<tA),earlier=approach.filter(r=>r.time<tA-15).map(r=>r.level),later=approach.filter(r=>r.time>=tA-15).map(r=>r.level);
  const prior=rows.filter(r=>r.launched&&r.time<tA-30).map(r=>r.level),arrival=Math.max(...rows.filter(r=>r.time>=tA&&r.time<tA+5).map(r=>r.level));
  const levels=`approach ${median(earlier).toFixed(1)} then ${median(later).toFixed(1)}, before it ${prior.length?median(prior).toFixed(1):'none'}, as the flood arrives ${arrival.toFixed(1)} LUFS`;
  expect(median(later)-median(earlier),`louder over the last 15 s of the approach than the 15 s before: ${levels}`).toBeGreaterThan(3);
  expect(arrival-(prior.length?median(prior):median(earlier)),`at least 10 dB louder as the flood reaches the listener than before its approach: ${levels}`).toBeGreaterThan(10);
  const peak=rows.reduce((x,y)=>y.level>x.level?y:x);
  expect(peak.depth>.1||peak.front<=50,`the loudest moment (${peak.level.toFixed(1)} LUFS at ${peak.time.toFixed(1)} s) is as the flood reaches the listener (front ${peak.front} m, depth ${peak.depth.toFixed(2)} m)`).toBe(true);
  console.log(`[disaster-sound] ${levels}; live nodes max ${Math.max(...rows.map(r=>r.nodes))}, sources max ${Math.max(...rows.map(r=>r.sources))}; module ${(rows.reduce((x,r)=>x+r.ms,0)/rows.length).toFixed(3)} ms a frame (mean of its own average), max ${Math.max(...rows.map(r=>r.msMax)).toFixed(3)} ms (its parts' worst: listen ${Math.max(...rows.map(r=>r.phases[0])).toFixed(3)}, scan ${Math.max(...rows.map(r=>r.phases[1])).toFixed(3)}, play ${Math.max(...rows.map(r=>r.phases[2])).toFixed(3)} ms)`);
  const win=rows.filter(r=>r.time>=tA-2&&r.time<tA+8),two=rows.filter(r=>r.time>=tA&&r.time<tA+2&&r.loud),ms=two.reduce((x,r)=>x+r.loud.s,0)/Math.max(1,two.reduce((x,r)=>x+r.loud.n,0)),db=v=>(20*Math.log10(Math.max(1e-9,v))).toFixed(1);
  console.log(`[disaster-sound] arrival at row ${process.env.PW_DISASTER_ROW||75}: peak over the arrival (2 s before to 8 s after) disaster bus alone ${Math.max(...win.map(r=>r.bus??-999)).toFixed(1)} dBFS, whole mix ${Math.max(...win.map(r=>r.pre??-999)).toFixed(1)} before the limiter, ${Math.max(...win.map(r=>r.post??-999)).toFixed(1)} after; loudness of what is heard over the first 2 s ${(-0.691+10*Math.log10(Math.max(1e-12,ms))).toFixed(1)} LUFS (K-weighted, ungated); the rest of the mix at ${db(Math.min(...rows.filter(r=>r.depth>.1).map(r=>r.rest)))} dB while the flood passes`);
  // Measurement only: the launch's one-off work timed on its own (opening the bus; the worst single recording request),
  // and the island's largest building in parts (the parts scan looks at 3,072 a frame)
  const once=await page.evaluate(()=>{const s=window.__app.disasterSound?.state??{},r=window.__app.disasters.structures?.records??[];return {open:s.msOpen??0,want:s.msWant??0,parts:r.reduce((m,x)=>Math.max(m,x.components?.length??0),0)};});
  console.log(`[disaster-sound] one-off: bus opened in ${once.open.toFixed(3)} ms, the slowest recording request ${once.want.toFixed(3)} ms (both outside the mixer step's worst frame); the largest building has ${once.parts} parts`);
  // Evidence only: the flood at the listener (the wet lens) with the laboratory closed, then reopened
  await page.getByRole('button',{name:'Close disaster controls',exact:true}).click();await page.screenshot({path:`${process.env.PW_OUT||'test-results'}/tsunami-heard-flood.png`});await page.getByRole('button',{name:'Disasters',exact:true}).click();
 });
 await test.step('Then the rest of the island\'s sound gives way while the flood passes me',async()=>{
  // the gain of every non-disaster sound above the water, read on the rows while the flood stood at the listener
  const passing=rows.filter(r=>r.depth>.1),least=Math.min(...passing.map(r=>r.rest));
  expect(least,`the rest of the mix gives way while the flood passes the listener: its gain at least ${least.toFixed(3)} (${(20*Math.log10(Math.max(1e-9,least))).toFixed(1)} dB)`).toBeLessThan(.89);
 });
 await test.step('When I move the disaster sound volume from the middle of its row to the top then every disaster sound gets louder, the siren in step with the rest',async()=>{
  // Each level is read once it has settled (the bus ramps over about 0.05 s): the disaster bus's live gain and the siren's level.
  const at=async v=>{await page.getByLabel('Disaster sound volume').fill(String(v));let last=-1,bus=0;await expect.poll(async()=>{bus=await page.evaluate(()=>window.__app.audio.disasterGain);const settled=Math.abs(bus-last)<=1e-4*Math.max(1,bus);last=bus;return settled;},{intervals:[150]}).toBe(true);return {bus,siren:await page.evaluate(()=>window.__app.disasters.siren.level??0)};};
  const middle=await at(50),top=await at(100);
  expect(top.bus,`the disaster bus is louder at the top of the volume row than at its middle: gain ${middle.bus.toFixed(3)} at 50, ${top.bus.toFixed(3)} at 100`).toBeGreaterThan(middle.bus*1.01);
  expect(Math.abs(top.bus/middle.bus-top.siren/middle.siren),`the siren and the other disaster sounds keep their ratio from the middle to the top: bus x${(top.bus/middle.bus).toFixed(3)}, siren x${(top.siren/middle.siren).toFixed(3)}`).toBeLessThan(.02);
  // Measurement only: the peak at the top of the row over the next 10 game s of the flood at the listener
  const peaks=await page.evaluate(async()=>{const f=window.__app.disasters.field,until=f.time+10,wall=performance.now()+120000;let pre=-999,post=-999;while(f.time<until&&performance.now()<wall&&window.__peak){await new Promise(r=>setTimeout(r,100));pre=Math.max(pre,await window.__peak('pre'));post=Math.max(post,await window.__peak('post'));}return {pre,post};});
  console.log(`[disaster-sound] volume row: bus gain ${middle.bus.toFixed(3)} at 50, ${top.bus.toFixed(3)} at 100; siren ${middle.siren.toFixed(4)} at 50, ${top.siren.toFixed(4)} at 100; peak at the top over 10 s of flood ${peaks.pre.toFixed(1)} dBFS before the limiter, ${peaks.post.toFixed(1)} after`);
  await page.getByLabel('Disaster sound volume').fill('75');
 });
 await test.step('When I mute disaster sound in the panel then the disaster bus is silent, and unmuting brings it back',async()=>{
  const bus=()=>page.evaluate(()=>window.__app.audio.disasterGain);/* the level before muting is read once the row's last move has settled (the bus ramps over about 0.05 s; read at once it was still at the top of the row in two runs of five) */let level=-1;await expect.poll(async()=>{const b=await bus(),settled=Math.abs(b-level)<=1e-4*Math.max(1,b);level=b;return settled;},{intervals:[150]}).toBe(true);expect(level,'the disaster bus is open before muting').toBeGreaterThan(0);
  await page.getByLabel('Mute disaster sound').check();await expect.poll(bus).toBeLessThan(.001);
  await page.getByLabel('Mute disaster sound').uncheck();await expect.poll(bus).toBeGreaterThan(.9*level);
  await page.screenshot({path:`${process.env.PW_OUT||'test-results'}/tsunami-heard-panel.png`});
 });
 await test.step('When I stop the disasters and restore the island then no disaster sound is left sounding',async()=>{
  await page.getByRole('button',{name:'Stop all disasters',exact:true}).click();await page.getByRole('button',{name:'Restore island',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__app.audio.disasterSources)).toBe(0);
  await expect.poll(()=>page.evaluate(()=>window.__app.audio.restGain??1),{message:'the rest of the mix is back at its level after Restore'}).toBeGreaterThan(.99);
  await expect.poll(()=>page.evaluate(()=>window.__app.audio.disasterNodes),{message:'no disaster audio node is left once nothing sounds',timeout:15000}).toBe(0);
  await expect(status(page)).toHaveAttribute('data-audio-sources','0');expect(errors).toEqual([]);
 });
});

test('Tsunami 3000 m: the wall tops the highest summit',async({page})=>{
 test.skip(process.env.PW_TSUNAMI_MEGA!=='1','opt-in: PW_TSUNAMI_MEGA=1 (about 10 min of a WebGPU slot)');
 test.setTimeout(SCENARIO_TIMEOUT_MS);
 const SUMMIT={x:-64,z:-496,y:297}; // m: the highest 16 m lattice point over the ring (test/tsunami-mega.mjs summit())
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(/WGSL|shader|pipeline|GPUValidation/i.test(m.text())&&m.type()!=='debug')errors.push(m.text());});
 await test.step('Given the disaster panel set to a 3000 m tsunami at the village',async()=>{
  await ready(page);
  await page.getByLabel('Disaster type').selectOption('tsunami');
  await page.getByLabel('Target location').selectOption('village');
  await page.getByLabel('Warning lead time (s)').fill('6');
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('3000');
  await page.evaluate(seed=>{window.__app.disasters.nextSeed=seed;},2);
 });
 await test.step('When I start it',async()=>{await page.getByRole('button',{name:'Start disaster',exact:true}).click();});
 await test.step('Then the wall comes in at full height and water covers the summit',async()=>{
  // Staged review view (not the action): 2.6 km beyond the summit, looking back up the wave's path.
  const stage=()=>page.evaluate(s=>{const A=window.__app;A.setFreeCam(true);A.camera.position.set(s.x+900,s.y+700,s.z-2400);A.camera.lookAt(s.x,s.y+400,s.z+1500);const dx=-900,dy=-300,dz=3900,yaw=Math.atan2(-dx,-dz),pitch=Math.asin(dy/Math.hypot(dx,dy,dz));A.fly.setPose(A.camera.position,yaw,pitch);A.fly.velocity.set(0,0,0);A.cameraCut();},SUMMIT);
  await stage();
  const event=()=>page.evaluate(s=>{const f=window.__app.disasters.field,e=f.events.get('tsunami');return e&&{time:e.time,arrival:e.arrival,launched:!!e.launched,over:f.waterAt(s.x,s.z)-s.y};},SUMMIT);
  const first=await event();
  await untilGameTimeCheck(page,async()=>(await event()).launched,first.arrival);
  await page.screenshot({path:test.info().outputPath('tsunami-mega-approach.png')});
  const topped=await untilGameTimeCheck(page,async()=>(await event()).over>1,first.arrival+20);
  await page.screenshot({path:test.info().outputPath('tsunami-mega-summit.png')});
  const last=await event();
  console.log(`tsunami 3000 m seed 2: ${last.over.toFixed(1)} m of water over the ${SUMMIT.y} m summit at ${last.time.toFixed(1)} s (arrival ${first.arrival.toFixed(1)} s)`);
  expect(topped.value,`water over the summit by ${(first.arrival+20).toFixed(0)} game s`).toBeTruthy();
  expect(errors).toEqual([]);
 });
});
