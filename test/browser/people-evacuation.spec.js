import { test, expect } from '@playwright/test';
import { SCENARIO_TIMEOUT_MS, untilGameTimeCheck, untilAshore } from './gameTime.js';
const within=async(page,check,budget,what)=>{const r=await untilGameTimeCheck(page,check,budget);expect(r.value,`${what} within ${budget} game s (waited ${r.elapsed.toFixed(1)} s)`).toBeTruthy();};
const ashore=async page=>{const r=await untilAshore(page);expect(r.value,`the bore ashore within ${r.budget.toFixed(0)} game s, ${r.planned.toFixed(0)} s planned (waited ${r.elapsed.toFixed(1)} s)`).toBeTruthy();};

// Actual local product and real controls. Each browser context has isolated game
// state; only the external Google Fonts stylesheet is replaced.
async function ready(page) {
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
 await page.goto('/?scale=0.5&noAudio');
 await expect(page.getByRole('status',{name:'Loading Tidewater'})).toBeHidden({timeout:120000});
 await page.keyboard.press('Enter');await page.getByRole('button',{name:'Skip',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__app.beach.people.length),{timeout:60000}).toBe(26);
}
async function start(page,lead) {
 await page.getByRole('button',{name:'Disasters',exact:true}).click();
 await page.getByLabel('Disaster type').selectOption('tsunami'); { const advanced = page.locator( 'details.disaster-advanced:not([open]) > summary' ); if ( await advanced.isVisible() ) await advanced.click(); }
 await page.getByLabel('Target location').selectOption('pier');
 await page.getByRole('spinbutton',{name:'Intensity',exact:true}).fill('25');
 await page.getByLabel('Warning lead time (s)').fill(String(lead));
 await page.getByLabel('Duration (s)').fill('90');
 await page.getByRole('button',{name:'Start disaster',exact:true}).click();
 await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();
}
const observations=page=>page.evaluate(()=>window.__app.beach.people.map(p=>({id:p.id,role:p.role,world:p.world.toArray(),phase:p.evacuation?.phase??null,reason:p.evacuation?.reason??null,grounded:p.evacuation?.grounded??false,routeContacts:p.evacuation?.routeContacts??0,knock:p.knock?.kind??null,feet:p.world.y,support:window.__app.colliders.groundHeightAt(p.world.x,p.world.z,p.world.y+.12)})));

test('Beach people hear the warning at every distance and physically climb the signed route',async({page})=>{
 test.setTimeout(SCENARIO_TIMEOUT_MS);let ids;
 await test.step('Given west and east beach camps, swimmers, waders and pier fishers on the real island',async()=>{
  await ready(page);
  ids=await page.evaluate(()=>{const p=window.__app.beach.people;return {west:p.find(p=>p.role==='camp'&&p.world.x<10).id,east:p.find(p=>p.role==='camp'&&p.world.x>65).id,wade:p.find(p=>p.role==='wade').id};});
  // About one beach person in five ignores the warning on purpose (EvacuationAI.js ignorerOf, drawn from the event's seed):
  // merged9 failed 'every swimmer ashore' on a filmer or seabed walker. This scenario is about the people who heed it, so it
  // replays the first seed in which the named representatives, every swimmer and every fisher heed it (rule 6: a test fixes a
  // seed through the internal one-shot hook; tsunami-people.spec.js covers the ignorers).
  const seed=await page.evaluate(ids=>{const A=window.__app,watch=A.beach.people.filter(p=>Object.values(ids).includes(p.id)||p.role==='swim'||p.role==='fish').map(p=>p.id);let s=1;while(watch.some(id=>A.disasters.ignorerOf(s,id)))s++;A.disasters.nextSeed=s;return s;},ids);
  console.log(`people-evacuation heeding seed ${seed}`);
 });
 await test.step('When I start the tsunami with its normal ninety second warning',async()=>{await start(page,90);});
 await test.step('Then all twenty-six beach people interrupt their activities, including people outside camera detail range',async()=>{
  await expect.poll(async()=>{const p=await observations(page);return p.filter(p=>p.phase!==null).length;},{timeout:15000}).toBe(26);
  const initial=await observations(page);
  expect(initial.filter(p=>p.role==='swim'||p.role==='fish').every(p=>p.phase!==null)).toBe(true);
 });
 await test.step('Then camp and wading representatives reach physical refuge while swimmers and fishers leave the water and pier before launch',async()=>{
  let last;try{await within(page,async()=>{const people=last=await observations(page);return Object.values(ids).every(id=>people.find(p=>p.id===id)?.phase==='refuge');},160,'every camp and wading representative at refuge');}finally{await test.info().attach('beach-physical-observations',{body:JSON.stringify(last,null,2),contentType:'application/json'});}
  let shore;try{await within(page,async()=>{shore=await observations(page);return shore.filter(p=>p.role==='swim').every(p=>p.feet>.2&&p.world[2]<-50&&['approach','climb','refuge'].includes(p.phase))&&shore.filter(p=>p.role==='fish').every(p=>p.world[2]<0&&p.feet>1&&p.phase!=='blocked');},60,'swimmers ashore and fishers off the pier');}finally{await test.info().attach('shore-and-pier-observations',{body:JSON.stringify(shore,null,2),contentType:'application/json'});}
  const fish=shore.filter(p=>p.role==='fish');
  expect(fish.every(p=>p.world[2]<0&&p.feet>1&&p.phase!=='blocked'),'Both fishers leave the actual pier toward shore').toBe(true);
  const reached=(await observations(page)).filter(p=>Object.values(ids).includes(p.id));
  for(const p of reached){expect(p.routeContacts).toBeGreaterThan(100);expect(p.grounded).toBe(true);expect(p.feet).toBeGreaterThan(35);expect(Math.abs(p.support-p.feet)).toBeLessThan(.15);}
  const field=await page.evaluate(()=>{const a=window.__app,e=a.disasters.field.events.get('tsunami');return {launched:e.launched,left:e.warning-e.time,ai:a.people.evacuation.state()};});
  expect(field.launched).toBe(false);expect(field.left).toBeGreaterThan(0);expect(field.ai.maxPlansPerUpdate).toBeLessThanOrEqual(1);
  await test.info().attach('evacuation-performance',{body:JSON.stringify(field,null,2),contentType:'application/json'});
  await page.getByLabel('Target X (m)').fill('47');await page.getByLabel('Target Z (m)').fill('-246');
  await page.getByRole('button',{name:'View target',exact:true}).click();
  await page.getByRole('button',{name:'Close disaster controls'}).click();
  await page.screenshot({path:test.info().outputPath( 'refuge.png' )});
 });
});

test('Flooded or broken evacuation routes stop voluntary advance and island restore clears the evacuation',async({page})=>{
 test.setTimeout(SCENARIO_TIMEOUT_MS);let before;
 await test.step('Given a fresh beach population and intact evacuation boardwalk',async()=>{await ready(page);before=await observations(page);});
 await test.step('When I launch a severe wave after a three second warning',async()=>{await start(page,3);});
 await test.step('Then some exposed people stop their route or tumble under actual flood forces',async()=>{
  await ashore(page);
  await within(page,async()=>{const p=await observations(page);return p.filter(p=>p.phase==='blocked'||p.knock==='tumble'||p.phase==='incapacitated').length>0;},100,'someone blocked, tumbled or incapacitated');
  await within(page,async()=>await page.evaluate(()=>window.__app.evacuation.records.filter(r=>r.broken).length)>0,100,'a boardwalk section broken');
  const p=await observations(page);expect(p.some(p=>p.reason==='flooded-route'||p.reason==='broken-route'||p.knock==='tumble')).toBe(true);
  const physical=await page.evaluate(()=>window.__app.beach.people.filter(p=>p.knock).map(p=>{const a=window.__app,s=a.disasters.field.sample(p.world.x,p.world.y,p.world.z),r=p.knock.rag?.rd,b=p.knock.physical;return {id:p.id,at:p.world.toArray(),water:s.height,current:Math.hypot(s.ux,s.uz),speed:r?Math.max(...r.bodies.map(b=>Math.hypot(b.v.x,b.v.y,b.v.z))):b?.velocity.length()??0};}));
  expect(physical.some(p=>{const old=before.find(q=>q.id===p.id);return p.water>p.at[1]+.25&&p.current>.6&&p.speed>.5&&Math.hypot(p.at[0]-old.world[0],p.at[2]-old.world[2])>1;}),'The actual moving flood carries a physical NPC body').toBe(true);
  await test.info().attach('flooded-people-physical-state',{body:JSON.stringify(physical,null,2),contentType:'application/json'});
  await page.screenshot({path:test.info().outputPath( 'flood.png' )});
 });
 await test.step('When I restore the island then the original beach activities and physical route can start again',async()=>{
  await page.getByRole('button',{name:'Restore island',exact:true}).click();
  await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();
  await expect.poll(async()=>{const p=await observations(page);return p.filter(p=>p.phase!==null).length;}).toBe(0);
  expect(await page.evaluate(()=>window.__app.evacuation.records.every(r=>!r.broken))).toBe(true);
  await page.getByLabel('Warning lead time (s)').fill('90');
  await page.getByRole('button',{name:'Start disaster',exact:true}).click();
 await expect(page.getByRole('alert',{name:'Disaster validation'})).toBeEmpty();
  await expect.poll(async()=>{const p=await observations(page);return p.filter(p=>p.phase!==null).length;}).toBe(26);
 });
});
