import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const hud=page=>page.getByRole('status',{name:'Glider instruments'});
const value=async(page,key)=>Number(await hud(page).getAttribute(`data-${key}`));
async function ready(page){
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
 await page.goto(`/?scale=${process.env.PW_GLIDER_SCALE||'0.5'}&noAudio`);
 await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
 await page.keyboard.press('Enter');await page.getByRole('button',{name:'Skip',exact:true}).click();
 if(process.env.PW_GLIDER_SCALE==='1'){
  await page.getByRole('button',{name:'Performance',exact:true}).click();
  await page.getByRole('radiogroup',{name:'Resolution',exact:true}).getByRole('radio',{name:'Standard',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>({width:window.__app.sceneRenderer.width,height:window.__app.sceneRenderer.height,mode:window.__app.engine.resolution.mode}))).toEqual({width:1440,height:900,mode:'standard'});
  await page.getByRole('button',{name:'Collapse (H)',exact:true}).click();
 }
 await page.getByRole('button',{name:'Hang glider',exact:true}).click();
}
test('Hang glider: inspect the mountain station, run into wind, bank and reset using real controls',async({page})=>{
 const errors=[],captures=[];page.on('pageerror',e=>errors.push(e.message));
 const capture=async(path)=>{await page.screenshot({path});const render=await page.evaluate(()=>({width:window.__app.sceneRenderer.width,height:window.__app.sceneRenderer.height,mode:window.__app.engine.resolution.mode}));captures.push({path,output:page.viewportSize(),render});console.log('Glider capture resolution',captures.at(-1));await writeFile(test.info().outputPath('glider-capture-metadata.json'),JSON.stringify(captures,null,2));};
 await test.step('Given a fresh island and its mountain launch station',async()=>{await ready(page);});
 await test.step('When I visit the summit and launch the glider',async()=>{
  await page.getByRole('button',{name:'Visit summit',exact:true}).click();
  await capture(test.info().outputPath('glider-station.png'));
  await page.getByRole('button',{name:'Launch glider',exact:true}).click();
 });
 await test.step('Then a real ground run precedes unpowered flight',async()=>{
  await expect(hud(page)).toHaveAttribute('data-phase','airborne',{timeout:30000});
  expect(await value(page,'run')).toBeGreaterThan(4);
  expect(await value(page,'altitude')).toBeGreaterThan(270);
  expect(await value(page,'lift')).toBeGreaterThan(500);
  expect(await value(page,'thrust')).toBe(0);
  await capture(test.info().outputPath('glider-launch.png'));
 });
 let heading;
 await test.step('When I shift my weight to the right',async()=>{
  heading=await value(page,'heading');await page.keyboard.down('ArrowRight');await page.waitForTimeout(1800);await page.keyboard.up('ArrowRight');
 });
 await test.step('Then the glider banks and its heading changes under aerodynamic lift',async()=>{
  expect(await value(page,'bank')).toBeGreaterThan(10);
  expect(((await value(page,'heading')-heading+540)%360)-180).toBeGreaterThan(5);
 });
 await test.step('When I reset and leave the glider then island walking control returns',async()=>{
  await page.getByRole('button',{name:'Reset glider',exact:true}).click();
  await expect(hud(page)).toHaveAttribute('data-phase','ready');
  await page.getByRole('button',{name:'Leave glider',exact:true}).click();
  await expect(hud(page)).toBeHidden();
  expect(await page.evaluate(()=>window.__app.player.mode)).toBe('walk');expect(errors).toEqual([]);
 });
});

test('Hang glider: descend a real beach approach and flare for a controlled landing',async({page})=>{
 await test.step('Given a fresh island and the beach approach preset',async()=>{await ready(page);await page.getByRole('button',{name:'Practice beach approach',exact:true}).click();});
 await test.step('When I glide toward the sand and flare below 1.5 metres',async()=>{
  await expect.poll(()=>value(page,'distance')).toBeGreaterThan(20);
  await expect.poll(()=>value(page,'agl'),{timeout:30000,intervals:[60]}).toBeLessThan(1.5);
  await page.keyboard.down('Space');
 });
 await test.step('Then physical touchdown records low sink, finite travel and no engine thrust',async()=>{
  await expect(hud(page)).toHaveAttribute('data-phase','landed',{timeout:15000});await page.keyboard.up('Space');
  expect(await value(page,'distance')).toBeGreaterThan(25);expect(await value(page,'impact-speed')).toBeLessThan(1.4);expect(await value(page,'landing-speed')).toBeLessThan(8);expect(await value(page,'thrust')).toBe(0);
  await expect(hud(page)).toContainText('Running landing');expect(await value(page,'landing-speed')).toBeLessThanOrEqual(3.5);
  await expect(hud(page)).toContainText('Beach landing complete');await page.screenshot({path:test.info().outputPath('glider-beach.png')});
 });
});

test('Hang glider: premature flare produces a stall and hard landing, then reset restores the wing',async({page})=>{
 await test.step('Given a fresh glider on approach high above the sand',async()=>{await ready(page);await page.getByRole('button',{name:'Practice beach approach',exact:true}).click();});
 await test.step('When I push the control bar out too early, at about 4 m over the sand',async()=>{
  // A push-out at the 22 m start stalls over the sea and ditches, which is right but is not this
  // scenario. 4 m is the early flare test/glider-flight.mjs shows crashing at about 5.8 m/s.
  await expect.poll(()=>value(page,'distance')).toBeGreaterThan(20);
  await expect.poll(()=>value(page,'agl'),{timeout:30000,intervals:[60]}).toBeLessThan(4);
  await page.keyboard.down('Space');
 });
 await test.step('Then the wing stalls and the hard impact cannot be scored as a landing',async()=>{
  await expect(hud(page)).toHaveAttribute('data-stall','true',{timeout:12000});
  await expect(hud(page)).toHaveAttribute('data-phase','crashed',{timeout:30000});await page.keyboard.up('Space');expect(await value(page,'impact-speed')).toBeGreaterThan(2.6);
  await expect(hud(page)).toContainText('Ground impact');await expect(hud(page)).not.toContainText('STALL · pull in');
 });
 await test.step('When I reset with R then the summit launch is ready again',async()=>{await page.keyboard.press('r');await expect(hud(page)).toHaveAttribute('data-phase','ready');expect(await value(page,'altitude')).toBeGreaterThan(300);});
});

test('Hang glider: pilot instruments and loads respond to the shared island wind controls',async({page})=>{
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 await test.step('Given a glider airborne in the prevailing island wind',async()=>{await ready(page);await click('Launch glider');await expect(hud(page)).toHaveAttribute('data-phase','airborne',{timeout:20000});});
 await test.step('When I change the shared ambient wind through the wind farm controls',async()=>{
  await click('Wind farm');await page.getByText('Shared island wind',{exact:true}).click();await page.getByLabel('Ambient wind (m/s)',{exact:true}).fill('11');await click('Apply wind');await click('Close wind farm');
 });
 await test.step('Then the glider samples that wind and its aerodynamic pressure changes',async()=>{
  await expect.poll(()=>value(page,'wind')).toBeGreaterThan(10.9);expect(await value(page,'q')).toBeGreaterThan(110);expect(await value(page,'thrust')).toBe(0);
  expect(await page.evaluate(()=>window.__app.player.mode)).toBe('glider');
 });
});

test('Hang glider: hike the connected summit stairs using normal player walking',async({page},testInfo)=>{
 test.setTimeout(360000);
 await test.step('Given a fresh island walker and the summit hiking guide',async()=>{await ready(page);await page.getByRole('button',{name:'Guide summit hike',exact:true}).click();});
 await test.step('When I hold the walking controls along the actual path and stairs',async()=>{
  await page.keyboard.down('Shift');await page.keyboard.down('w');
  const guide=page.getByRole('status',{name:'Summit trail guide'});const observedModes=new Set();let ticks=0,thresholdCapture=false,slowed=false;await expect.poll(async()=>{
   const state=await page.evaluate(()=>{const a=window.__app,l=a.glider.station.site.station,p=a.player.position,dx=p.x-l.x,dz=p.z-l.z,c=Math.cos(l.yaw),s=Math.sin(l.yaw);return{index:a.glider.trailIndex,remaining:a.glider.trail.length-a.glider.trailIndex,position:p.toArray(),mode:a.player.mode,grounded:a.player.grounded,cross:dx*c-dz*s,along:dx*s+dz*c};});
   observedModes.add(state.mode);if(++ticks%50===0)console.log('Hike checkpoint',state);
   if(!slowed&&state.position[1]>304&&Math.abs(state.cross)<3&&state.along>-20&&state.along<0){slowed=true;await page.keyboard.up('Shift');}
   if(!thresholdCapture&&state.mode==='walk'&&state.grounded&&Math.abs(state.cross)<.15&&state.along>=-11.8&&state.along<=-10.6){
    await page.keyboard.up('w');await page.keyboard.up('Shift');await page.waitForTimeout(200);
    const pose=await page.evaluate(()=>{const a=window.__app,l=a.glider.station.site.station,p=a.player.position,dx=p.x-l.x,dz=p.z-l.z,c=Math.cos(l.yaw),s=Math.sin(l.yaw);return{width:a.sceneRenderer.width,height:a.sceneRenderer.height,resolution:a.engine.resolution.mode,feet:p.toArray(),mode:a.player.mode,grounded:a.player.grounded,cross:dx*c-dz*s,along:dx*s+dz*c};});
    expect(pose.mode).toBe('walk');expect(pose.grounded).toBe(true);expect(Math.abs(pose.cross)).toBeLessThan(.15);expect(pose.along).toBeGreaterThanOrEqual(-11.8);expect(pose.along).toBeLessThanOrEqual(-10.6);
    thresholdCapture=true;await page.screenshot({path:testInfo.outputPath('summit-doorway-walking-height.png')});await writeFile(testInfo.outputPath('summit-doorway-render.json'),JSON.stringify(pose,null,2));await page.keyboard.down('w');
   }
   return await guide.getAttribute('data-arrived');},{timeout:300000,intervals:[100]}).toBe('true');
  expect(thresholdCapture).toBe(true);expect([...observedModes]).toEqual(['walk']);
  await page.keyboard.up('w');await page.keyboard.up('Shift');
 });
 await test.step('Then the normal walking controller reaches the station without activating flight',async()=>{
  const state=await page.evaluate(()=>{const a=window.__app;return{mode:a.player.mode,position:a.player.position.toArray(),active:a.glider.active,grounded:a.player.grounded};});
  expect(state.mode).toBe('walk');expect(state.position[1]).toBeGreaterThan(305);expect(state.active).toBe(false);expect(state.grounded).toBe(true);
  const doorway=await page.evaluate(()=>{const a=window.__app,c=Math.cos(Math.atan2(-.35,-.94)),s=Math.sin(Math.atan2(-.35,-.94));let cuts=0;
   for(const mesh of a.glider.station.group.children){const g=mesh.geometry,v=g?.attributes,ix=g?.index?.array;if(!v?.tint||!ix)continue;for(let j=0;j<ix.length;j+=3){const ids=[ix[j],ix[j+1],ix[j+2]];if(!ids.every(k=>Math.abs(v.tint.array[k*3]-.16)<.001))continue;const p=ids.map(k=>Array.from(v.position.array.subarray(k*3,k*3+3)));for(let k=0;k<3;k++){const x=p[k],y=p[(k+1)%3];if((x[1]-306.6)*(y[1]-306.6)>=0)continue;const t=(306.6-x[1])/(y[1]-x[1]),wx=x[0]+(y[0]-x[0])*t+34,wz=x[2]+(y[2]-x[2])*t+500,cross=wx*c-wz*s,along=wx*s+wz*c;if(Math.abs(cross)<6.4&&along>-7.85&&along<-.3)cuts++;}}}
   const origin=a.player.position.clone();origin.y+=1.62;const up=origin.clone().set(0,1,0);return{cuts,headroom:a.colliders.raycast(origin,up,2)};
  });expect(doorway.cuts).toBe(0);expect(doorway.headroom).toBe(2);
  await page.screenshot({path:test.info().outputPath('glider-hike.png')});
 });
});

test('Hang glider: a disaster-damaged launch ramp refuses flight and restore repairs the station',async({page})=>{
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 await test.step('Given the summit launch and an earthquake centred on the station',async()=>{
  await ready(page);await click('Visit summit');await click('Disasters');await page.getByLabel('Disaster type').selectOption('earthquake');
  await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('2');await page.getByLabel('Target X (m)').fill('-34');await page.getByLabel('Target Z (m)').fill('-500');await page.getByLabel('Radius (m)').fill('40');await page.getByLabel('Duration (s)').fill('30');
 });
 await test.step('When I start the earthquake and try to launch from the damaged ramp',async()=>{
  await click('Start disaster');await expect.poll(()=>page.evaluate(()=>window.__app.glider.station.launchRecord.broken),{timeout:30000}).toBe(true);
  await click('Hang glider');await click('Launch glider');
 });
 await test.step('Then the station refuses launch with an actionable reason',async()=>{
  await expect(page.getByRole('alert',{name:'Glider message'})).toContainText('Launch ramp damaged');
  expect(await page.evaluate(()=>window.__app.glider.flight.phase)).toBe('ready');
 });
 await test.step('When I restore the island then the same summit structure and launch work again',async()=>{
  await click('Disasters');await click('Restore island');await click('Hang glider');await click('Launch glider');
  await expect(hud(page)).toHaveAttribute('data-phase','airborne',{timeout:20000});
  expect(await page.evaluate(()=>window.__app.glider.station.launchRecord.broken)).toBe(false);expect(await page.evaluate(()=>window.__app.player.mode)).toBe('glider');
 });
});

const telemetry=page=>page.evaluate(()=>{const a=window.__app,g=a.glider,f=g.flight,p=a.player;return{prompt:p.prompt?.text||null,mode:p.mode,active:g.active,phase:f.phase,player:p.position.toArray(),wing:[...f.position],windDir:a.ui?.s?.windDir,lastExit:g.lastExit||null};});
async function stageAtStairTop(page){
 // Given-only staging: the player stands on the final stair flight, facing the deck (the long
 // hike itself is covered by the summit-hike scenario above).
 await page.evaluate(()=>{const a=window.__app,p=a.player,L={x:-34,z:-500,y:306.6,yaw:Math.atan2(-.35,-.94)},s=Math.sin(L.yaw),c=Math.cos(L.yaw);p.position.set(L.x-12*s,L.y+1.8,L.z-12*c);p.velocity.set(0,0,0);p.yaw=Math.atan2(-s,-c);p.pitch=0;p.mode='walk';});
}
test('Hang glider: E at the deck clips in, W launches, the flight holds, and E after landing steps off',async({page})=>{
 test.setTimeout(240000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await test.step('Given the island boots with its one 7 m/s wind toward 70 degrees and I stand below the launch deck',async()=>{
  await ready(page);await page.getByRole('button',{name:'Close glider controls',exact:true}).click();
  expect((await telemetry(page)).windDir).toBe(70);
  await stageAtStairTop(page);
 });
 await test.step('When I walk up onto the deck',async()=>{await page.keyboard.down('w');await expect.poll(async()=>(await telemetry(page)).prompt,{timeout:15000}).toMatch(/Clip in/);await page.keyboard.up('w');});
 await test.step('Then pressing E clips me in, and W runs me off the ramp into the air',async()=>{
  await page.keyboard.press('e');await expect(hud(page)).toBeVisible();await expect(hud(page)).toHaveAttribute('data-phase','ready');
  await page.keyboard.press('w');await expect(hud(page)).toHaveAttribute('data-phase','airborne',{timeout:20000});
 });
 await test.step('When I pull in for 3 s then bank left for 4 s, the wing keeps flying for 30 s',async()=>{
  await page.keyboard.down('ArrowUp');await page.waitForTimeout(3000);await page.keyboard.up('ArrowUp');
  await page.keyboard.down('ArrowLeft');await page.waitForTimeout(4000);await page.keyboard.up('ArrowLeft');
  await expect.poll(()=>value(page,'air-time'),{timeout:60000}).toBeGreaterThan(30);
  await page.screenshot({path:test.info().outputPath('glider-30s-flight.png')});
  await expect(hud(page)).toHaveAttribute('data-stall','false');expect((await telemetry(page)).phase).toBe('airborne');
 });
 await test.step('Then after a beach approach and flare, E steps me off beside the wing',async()=>{
  await page.getByRole('button',{name:'Hang glider',exact:true}).click();await page.getByRole('button',{name:'Practice beach approach',exact:true}).click();
  await expect.poll(()=>value(page,'distance')).toBeGreaterThan(20);
  await expect.poll(()=>value(page,'agl'),{timeout:30000,intervals:[60]}).toBeLessThan(1.5);await page.keyboard.down('Space');
  // The status text carries the reason, so a crash names what it hit.
  await expect(hud(page)).toContainText('Beach landing complete',{timeout:15000});await expect(hud(page)).toHaveAttribute('data-phase','landed');await page.keyboard.up('Space');
  await page.keyboard.press('e');await expect(hud(page)).toBeHidden();
  const off=await telemetry(page);expect(off.mode).toBe('walk');expect(off.lastExit).toBe('local');
  expect(Math.hypot(off.player[0]-off.wing[0],off.player[2]-off.wing[2])).toBeLessThan(6);
  await page.screenshot({path:test.info().outputPath('glider-stepped-off.png')});expect(errors).toEqual([]);
 });
});
test('Hang glider: E in flight bails the pilot out and the empty glider flies on',async({page})=>{
 test.setTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await test.step('Given I am clipped in at the deck and airborne',async()=>{
  await ready(page);await page.getByRole('button',{name:'Close glider controls',exact:true}).click();await stageAtStairTop(page);
  await page.keyboard.down('w');await expect.poll(async()=>(await telemetry(page)).prompt,{timeout:15000}).toMatch(/Clip in/);await page.keyboard.up('w');
  await page.keyboard.press('e');await page.keyboard.press('w');await expect(hud(page)).toHaveAttribute('data-phase','airborne',{timeout:20000});
  await expect.poll(()=>value(page,'air-time')).toBeGreaterThan(3);
 });
 await test.step('When I press E in the air',async()=>{await page.keyboard.press('e');});
 await test.step('Then I fall prone from the harness as a ragdoll and the glider keeps flying without me',async()=>{
  await expect(hud(page)).toBeHidden();
  const t=await telemetry(page);expect(t.active).toBe(false);expect(t.lastExit).toBe('bail');expect(t.mode).toBe('ragdoll');
  const tilt=await page.evaluate(()=>{const r=window.__app.player.rag,h=r.head.x,p=r.pelvis.x;return Math.acos((h.y-p.y)/Math.hypot(h.x-p.x,h.y-p.y,h.z-p.z))*180/Math.PI;});
  expect(tilt,`body tilt from vertical at the bail, degrees`).toBeGreaterThan(45);
  await page.waitForTimeout(800);await page.screenshot({path:test.info().outputPath('glider-bail.png')});
  // Trim 38 km/h into the 7 m/s boot wind is about 3.5 m/s over the ground, so allow a few seconds.
  await expect.poll(async()=>{const later=await telemetry(page);return later.phase==='airborne'?Math.hypot(later.wing[0]-t.wing[0],later.wing[2]-t.wing[2]):-1;},{timeout:6000}).toBeGreaterThan(4);
  expect(errors).toEqual([]);
 });
});
