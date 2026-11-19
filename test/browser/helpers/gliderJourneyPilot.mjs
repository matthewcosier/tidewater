// Test-only pilot: observations in, discrete physical key commands out.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=v=>Math.atan2(Math.sin(v),Math.cos(v));
function rotate(q,v){const [x,y,z,w]=q;const tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);return[v[0]+w*tx+y*tz-z*ty,v[1]+w*ty+z*tx-x*tz,v[2]+w*tz+x*ty-y*tx];}
export function createPilot(options={}) {
 let stage='departure',lastTime=0,lastSpeed=13,pitchAccumulator=0,rollAccumulator=0,orbitTurns=0,oldTheta,baseX,baseZ,wasInWindow=false;
 const cfg={orbitX:-180,orbitZ:-80,radius:80,exitHeight:105,exitArm:150,speed:13,bankLimit:.55,headingGain:.5,yawDamping:.8,bankGain:.3,rollDamping:.8,baseX:-30,baseZ:90,baseGlide:2,aimBeyond:25,finalRadius:30,lineGain:35,finalBankLimit:.3,flareHeight:1.5,finalSpeed:11.5,fastSpeed:15,stallSpeed:8.02,minSpeedRatio:1.3,exitTheta:-2.78,exitWindow:.35,practiceEast:-2.5,practiceNorth:25.5,gateBack:20,gateHeight:20.5,heightGate:true,finalTurnBank:.55,finalTurnError:.5,...options};
 const quant=(value,axis)=>{if(axis==='pitch'){pitchAccumulator+=value;const r=pitchAccumulator>.5?1:pitchAccumulator<-.5?-1:0;pitchAccumulator-=r;return r;}rollAccumulator+=value;const r=rollAccumulator>.5?1:rollAccumulator<-.5?-1:0;rollAccumulator-=r;return r;};
 return {get stage(){return stage;},decide(s){
  if(s.phase==='running'||(s.metrics.airTime||0)<1){pitchAccumulator=rollAccumulator=0;lastTime=s.time;lastSpeed=s.metrics.speed;return{roll:0,pitch:0,flare:false,stage:'departure'};}
  const p=s.position,v=s.velocity,m=s.metrics,wind=m.windVector||[2.442,0,6.56],time=s.time,dt=clamp(time-lastTime,.02,.5);lastTime=time;
  const forward=rotate(s.quaternion,[0,0,1]),up=rotate(s.quaternion,[0,1,0]),right=rotate(s.quaternion,[1,0,0]);
  const heading=Math.atan2(forward[0],forward[2]),bank=Math.atan2(-right[1],up[1]);
  const speed=Math.hypot(v[0]-wind[0],v[1]-wind[1],v[2]-wind[2]),speedDot=(speed-lastSpeed)/dt;lastSpeed=speed;
  let target,groundDir;
  if(stage==='departure') {target=[-115,-550];if((m.airTime||0)>7)stage='transit';}
  if(stage==='transit'){target=[-225,-130];if(p[2]>-170)stage='orbit';}
  if(stage==='orbit') {
   const dx=p[0]-cfg.orbitX,dz=p[2]-cfg.orbitZ,r=Math.hypot(dx,dz),theta=Math.atan2(dz,dx);
   if(oldTheta!==undefined)orbitTurns+=Math.abs(wrap(theta-oldTheta))/(2*Math.PI);oldTheta=theta;
   // clockwise map orbit: northeast-side exit points southeast then turns into wind.
   const radial=clamp((r-cfg.radius)/40,-1.5,1.5);
   groundDir=[-dz/r-radial*dx/r,dx/r-radial*dz/r];
   const inWindow=Math.abs(wrap(theta-cfg.exitTheta))<cfg.exitWindow,leave=p[1]<cfg.exitArm&&(inWindow&&p[1]<cfg.exitHeight||wasInWindow&&!inWindow);wasInWindow=inWindow;
   if(leave){stage='base';const w=Math.max(1,Math.hypot(wind[0],wind[2]));const out=cfg.gateBack+cfg.baseGlide*Math.max(0,p[1]-cfg.gateHeight);baseX=-92+cfg.practiceEast+wind[0]/w*out;baseZ=-91+cfg.practiceNorth+wind[2]/w*out;}
  }
  const sx=-92+cfg.practiceEast,sz=-91+cfg.practiceNorth,wn=Math.max(1,Math.hypot(wind[0],wind[2])),gateAlong=(p[0]-sx)*wind[0]/wn+(p[2]-sz)*wind[2]/wn-cfg.gateBack;
  if(stage==='final'&&(gateAlong<=0||cfg.heightGate&&p[1]<=cfg.gateHeight))stage='practice';
  if(stage==='base'){const w=Math.max(1,Math.hypot(wind[0],wind[2])),out=cfg.gateBack+cfg.baseGlide*Math.max(0,p[1]-cfg.gateHeight);baseX=-92+cfg.practiceEast+wind[0]/w*out;baseZ=-91+cfg.practiceNorth+wind[2]/w*out;}
  if(stage==='base') {target=[baseX??cfg.baseX,baseZ??cfg.baseZ];groundDir=null;if(Math.hypot(p[0]-target[0],p[2]-target[1])<cfg.finalRadius){stage='final';}}
  if(stage==='final'||stage==='practice') {const ux=-wind[0]/Math.hypot(wind[0],wind[2]),uz=-wind[2]/Math.hypot(wind[0],wind[2]),nx=-uz,nz=ux,cross=(p[0]-sx)*nx+(p[2]-sz)*nz;groundDir=[ux-nx*clamp(cross/cfg.lineGain,-.8,.8),uz-nz*clamp(cross/cfg.lineGain,-.8,.8)];target=null;}
  if(target&&!groundDir){const dx=target[0]-p[0],dz=target[1]-p[2],r=Math.max(1,Math.hypot(dx,dz));groundDir=[dx/r,dz/r];}
  const gl=Math.hypot(...groundDir);groundDir=groundDir.map(a=>a/gl);
  const along=wind[0]*groundDir[0]+wind[2]*groundDir[1],cross=wind[0]*groundDir[1]-wind[2]*groundDir[0],gs=along+Math.sqrt(Math.max(4,speed*speed-cross*cross));
  const desiredHeading=Math.atan2(groundDir[0]*gs-wind[0],groundDir[1]*gs-wind[2]);
  const headingError=wrap(desiredHeading-heading),onFinal=stage==='final'||stage==='practice',limit=stage==='final'&&Math.abs(headingError)>cfg.finalTurnError?cfg.finalTurnBank:onFinal?cfg.finalBankLimit:cfg.bankLimit,bankTarget=clamp(cfg.headingGain*headingError-cfg.yawDamping*s.omega[1],-limit,limit);
  // Matches WING and BAR in src/glider/GliderPhysics.js: 107 kg, Cl = 0.30 + 4.4 a, trim 0.15 rad,
  // full pull-in 0.01, push-out 0.33, full shift banks 0.47 rad.
  const roll=clamp((bankTarget+cfg.bankGain*(bankTarget-bank)+cfg.rollDamping*s.omega[2])/.47,-1,1);
  const wl=Math.max(1,Math.hypot(wind[0],wind[2])),aimX=-92-wind[0]/wl*cfg.aimBeyond,aimZ=-91-wind[2]/wl*cfg.aimBeyond;
  const toBeach=Math.hypot(p[0]-aimX,p[2]-aimZ),path=clamp(((p[1]-cfg.gateHeight)/Math.max(10,gateAlong)-.2)/.2,0,1);
  const minSpeed=cfg.minSpeedRatio*cfg.stallSpeed;
  const targetSpeed=stage==='final'?(toBeach<25?cfg.finalSpeed:cfg.fastSpeed+(minSpeed+.4-cfg.fastSpeed)*path):cfg.speed;
  const trimAlpha=(2*107*9.81/(1.225*Math.exp(-Math.max(0,p[1])/8500)*15.8*targetSpeed**2)-.30)/4.4;
  const guardAlpha=(2*107*9.81/(1.225*Math.exp(-Math.max(0,p[1])/8500)*15.8*minSpeed**2)-.30)/4.4-.06*Math.max(0,minSpeed-speed);
  const alphaTarget=clamp(Math.min(guardAlpha,trimAlpha+.035*(speed-targetSpeed)+.028*speedDot),.01,.28);
  const pitch=alphaTarget<.15?(alphaTarget-.15)/.14:(alphaTarget-.15)/.18;
  const flare=stage==='practice'&&m.agl<cfg.flareHeight;
  return {roll:quant(roll,'roll'),pitch:stage==='practice'?0:quant(pitch,'pitch'),flare,stage,orbitTurns,target,desiredHeading,bankTarget,alphaTarget,speed};
 }};
}
