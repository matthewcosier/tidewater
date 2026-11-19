import {GRAVITY as G,AIR_DENSITY,dynamicPressure} from '../physics/Loads.js';
import {add,sub,mul,dot,cross,length,unit,rotate,inverseRotate,poseQ,advanceQ,attitude,clamp,finiteState} from '../aviation/Math.js';
import {LAUNCH,BEACH,launchPoint,launchLocal} from './Site.js';
export const STEP=1/120;
// Practice approach start relative to the beach centre (Site.js BEACH), metres. See approach().
const APPROACH = Object.freeze( { east: - 2.5, north: 25.5, height: 15 } );
// Beach landing message zone around the beach centre, m. Sand covers most of it; the coastal road
// crosses it, so a touchdown is named by the surface under the pilot first (landingMessage).
const BEACH_ZONE = 45;
function landingMessage( p, env ) {

	const road = env.roadAt?.( p[ 0 ], p[ 2 ] );
	if ( road ) return `Landed on the ${ road.kind } road`;
	if ( Math.hypot( p[ 0 ] - BEACH.x, p[ 2 ] - BEACH.z ) < BEACH_ZONE ) return 'Beach landing complete';
	return 'Controlled landing complete';

}
// Recreational flexible wing: Wills Wing Falcon 3 170 planform (15.8 m², 10.2 m span, about 22 kg) with
// an 85 kg pilot in harness, 107 kg all-up. Coefficients and inertias are declared design assumptions;
// NASA supplies the equations, not these numbers. Real bands this polar is held to (test/glider-flight.mjs;
// Wills Wing Falcon 3 published speeds and the USHPA/BHPA training figures for the class): stall 28-30 km/h,
// trim 36-40 km/h, min sink 0.9-1.2 m/s, best glide 10-12:1, VNE about 80 km/h. Before 2026-10-05 the wing
// (118 kg, cl0 0.22, cd0 0.039, e 0.72, stall at 0.25 rad) stalled at 34.5 km/h and trimmed at 46 km/h:
// faster than a pilot can run, so a calm ramp launch left below stall and dropped 17.7 m.
export const WING=Object.freeze({mass:107,area:15.8,span:10.2,chord:1.55,cl0:.30,clAlpha:4.4,cd0:.034,efficiency:.78,stallAlpha:.30,trimAlpha:.15,inertia:[85,170,230],pilotMass:85,maxShift:.38,maxRunForce:440,maxRunSpeed:7.0,maxAirSpeed:42,maxLoad:5.5});
export function coefficients(alpha,separationAlpha=alpha){
 const a=clamp(alpha,-Math.PI/2,Math.PI/2),attached=WING.cl0+WING.clAlpha*a;
 const share=x=>{const b=clamp((Math.abs(clamp(x,-Math.PI/2,Math.PI/2))-WING.stallAlpha)/.20,0,1);return b*b*(3-2*b);};
 const separated=share(separationAlpha),vortex=Math.max(0,share(a)-separated),flowing=1-separated-vortex;
 const cl=attached*flowing+attached*Math.cos(a)*vortex+1.05*Math.sin(2*a)*separated,induced=cl*cl/(Math.PI*(WING.span**2/WING.area)*WING.efficiency);
 return{cl,induced,cd:WING.cd0+induced+attached*Math.sin(a)*vortex+1.3*Math.sin(a)**2*separated,stall:Math.abs(a)>WING.stallAlpha};
}
export function loads(relative,q,altitude=0,separationAlpha){
 const speed=length(relative),body=inverseRotate(q,relative),alpha=Math.atan2(-body[1],body[2]),beta=Math.atan2(body[0],Math.max(.01,Math.hypot(body[1],body[2])));
 const density=AIR_DENSITY*Math.exp(-Math.max(0,altitude)/8500),pressure=dynamicPressure(speed,density),c=coefficients(alpha,separationAlpha??alpha),lift=pressure*WING.area*c.cl,drag=pressure*WING.area*c.cd;
 const v=unit(relative),right=rotate(q,[1,0,0]),liftAxis=unit(cross(v,right));
 return{force:add(mul(liftAxis,lift),mul(v,-drag)),speed,alpha,beta,density,q:pressure,lift,drag,...c};
}
export function equilibrium(alpha=WING.trimAlpha,altitude=0){const c=coefficients(alpha),gamma=-Math.atan2(c.cd,c.cl),rho=AIR_DENSITY*Math.exp(-Math.max(0,altitude)/8500),speed=Math.sqrt(2*WING.mass*G/(rho*WING.area*Math.hypot(c.cl,c.cd)));return{speed,gamma,alpha,pitch:alpha+gamma,ratio:c.cl/c.cd};}
// Weight-shift bar and launch rules: declared game tuning, held to the real outcomes in
// test/glider-flight.mjs. Defects they replace (2026-10-05): full pull-in asked -0.08 rad (Cl -0.12)
// and crashed in 3.8 s; full bank asked 49 degrees and overshot to 62; a 1 s tap set up a porpoise
// with four stalls; the run left the ramp at 8.6 m/s in calm air and 3 m/s in a tailwind.
export const BAR=Object.freeze({
 ease:.4,          // s for the bar to travel from neutral to a stop: a pilot moves a bar, not a switch
 pullAlpha:.01,    // rad at full pull-in: Cl 0.34, about 17.7 m/s (64 km/h), lift stays positive
 pushAlpha:.33,    // rad at full push-out: just past the stall, as a held push-out is on a real wing
 flareAlpha:.62,   // rad (36 degrees): the full push-out, a deep stall that brakes. Flared above
                   // holdOffHeight it stalls the wing high and drops it, as an early flare does
 holdOffHeight:2,  // m of foot clearance below which Space rounds out and holds off instead: the push-out
                   // follows the lift that sinks the feet at holdOffRate x height, so the wing bleeds
                   // speed just above the sand and stalls at the last moment. A straight push to the
                   // stall from 1.5 m ballooned the 30 km/h wing to 3 m and dropped it at 6.3 m/s
 holdOffRate:1.5,  // 1/s: wanted sink is this times the foot height above holdOffFloor, capped at
                   // holdOffSink (0.8 m/s from 0.83 m up, 0.3 m/s at 0.5 m)
 holdOffGain:4,
                   // round-out levelled too slowly and touched down still sinking at 7 m/s over the ground)
 holdOffSink:.8,
                   // it dived from 2 m at 2.4 m/s and met the ground before it could level)
 holdOffFloor:.24,
 holdOffLook:.6,   // s: the pilot judges the hold-off height over the ground this far ahead on the track
                   // (declared: a pilot looks well ahead during the hold-off, not straight down)
 holdOffRise:1.5,  // m/s: the hold-off follows rising ground up to this rate; steeper is a face the
 pushOutRatio:1.1, // x stall speed: the hold-off has bled the airspeed to here when the push-out settle begins
 pushOutPitch:.9,  // rad (52 degrees) keel pitch above the horizon at full stretch; the pilot hangs plumb,
 pushOutSink:.3,
 pushOutRate:2,    // 1/s: the settle's wanted descent per metre above pushOutFinal (0.16 m/s from 0.24 m)
 pushOutGain:6,    // 1/s: extra lift per m/s of settle error, as a share of g (the hold-off's 4 left the wing
 pushOutFinal:.16, // m of foot clearance the settle levels at before the full shove. The shove brakes a
                   // calm 8 m/s wing to a jog in about 0.75 s, and the feet must still be off the sand then:
                   // from 0.12 m the calm final touched at 3.8-4.1 m/s over the ground (a stumble), from
                   // 0.16 m at 3.49; higher drops the stalled wing harder (0.18 m: 1.43-1.44 m/s, sw-e.log)
 pushOutShove:1.02, // x stall speed: the full shove, the last moment before the stall (1.0 touched before the
                   // shove had braked the calm final; 1.03 met the 1.4 m/s bound at 0.2 s late, sw-e.log)
 pushOutGround:3,  // m/s ahead over the ground: a pilot flares to stop over the ground; slower than this
                   // there is nothing to stop, so no push-out (5.5 m/s headwind: 3.5 m/s at the trigger)
 pushOutEase:4,    // m/s ahead: below this the shove eases in proportion, so a headwind does not blow the
 separationLag:16,
 runningLanding:3.5, // m/s ground speed at touchdown
 flareStiffness:1600, // N·m/rad: the arms shove the bar out, 3.3 x the weight-shift trim stiffness
 roundOutAuthority:1.9, // x the q-scaled bar authority (q / 95 Pa): the floor on it while the round-out
 roundOutTau:.65,  // s to touch at the present closing rate (height / sink, the looming cue tau that pilots
 roundOutTauBand:.2, // s: the floor builds from nothing at roundOutTau to whole this much sooner to touch,
                   // so a pilot pushes harder the faster the ground comes up
 flareShift:.62,   // m: arms at full stretch move the pilot this far aft of the hang point (the trim
                   // limit is WING.maxShift 0.38 m); the faster rotation is what stops the balloon
 bankMax:.47,      // rad (27 degrees) at full sideways shift: training turns are flown at 25-30 degrees
 pathDamping:.30,  // rad of AoA per g of along-path acceleration: the sail's speed stability plus a
                   // pilot easing the bar against the phugoid, so a tap settles in about two periods
 pathLimit:.06,    // rad: that damping never moves the trim further than this
 rollDamping:480,  // N·m·s per rad/s of roll rate: about 0.8 of critical with 400 N·m/rad and 230 kg·m²
 runAlpha:.05,     // rad of AoA to the relative wind while the run builds speed: nose down for low drag,
                   // as pilots are taught; at BAR.liftoff x stall the pilot rotates to LAUNCH_ALPHA
 maxTailwind:1.5,  // m/s down the ramp: beyond this the launch is refused (never launch downwind)
 maxCrosswind:5,   // m/s across the ramp: about 45 degrees off a 7 m/s breeze
 liftoff:1.15      // x stall airspeed the run must reach before the wing takes the pilot's weight
});
const CL_MAX=(()=>{let best=0;for(let a=0;a<.8;a+=.001)best=Math.max(best,coefficients(a).cl);return best;})();
// Angle of attack (rad) of that maximum lift: the most a round-out can ask of the sail before it stalls.
const ALPHA_CL_MAX = ( () => {

	let best = 0, at = 0;
	for ( let a = 0; a < .8; a += .001 ) {

		const cl = coefficients( a ).cl;
		if ( cl > best ) {

			best = cl;
			at = a;

		}

	}
	return at;

} )();
// Launch angle of attack (rad, about 0.21): the pilot holds the nose to the relative wind so the wing
// carries exactly the weight at BAR.liftoff x stall (Cl = Cl max / 1.15²). The run used to hold the
// keel 0.05 rad above the ramp slope whatever the air did, so in 7 m/s up the face the wing "left" at
// a third of its weight and the pilot's feet hit the deck stairs (glider.spec, 2026-10-05).
const LAUNCH_ALPHA=(()=>{const want=CL_MAX/BAR.liftoff**2;let a=0;while(a<.8&&coefficients(a).cl<want)a+=.001;return a;})();
// Wing-level stall airspeed (m/s) at a height, from the polar's largest lift coefficient.
export function stallSpeed(altitude=0){return Math.sqrt(2*WING.mass*G/(AIR_DENSITY*Math.exp(-Math.max(0,altitude)/8500)*WING.area*CL_MAX));}
const metrics=()=>({speed:0,lift:0,drag:0,q:0,alpha:0,bank:0,heading:0,stall:false,wind:0,windVector:[0,0,0],sink:0,energy:0,dragWork:0,airWork:0,controlWork:0,run:0,thrust:0,load:0,agl:0,distance:0,impactSpeed:0,landingSpeed:0,airTime:0,limits:0});
export class GliderPhysics{
 constructor(){this.reset();}
 reset(){this.position=launchPoint(0,-3,1.5);this.velocity=[0,0,0];this.quaternion=poseQ(LAUNCH.yaw,.08);this.omega=[0,0,0];this.phase='ready';this.reason='Launch into wind, then bank around toward the bay';this.controls={pitch:0,roll:0,flare:false};this.bar={pitch:0,roll:0};this.metrics=metrics();this.accumulator=0;this.time=0;this.distance=0;this.run=0;this.damageAge=0;this.lastPosition=[...this.position];this.start=[...this.position];}
 // A ramp launch only goes into wind: the ramp cannot turn, so tail and strong cross winds are refused.
 launch(env={}){
  if(this.phase!=='ready')return'Reset the glider before another launch';
  const p=launchPoint(0,0,3),s=env.sample?.(p[0],p[1],p[2])||{},ax=Math.sin(LAUNCH.yaw),az=Math.cos(LAUNCH.yaw);
  const head=-((s.wx||0)*ax+(s.wz||0)*az),cross=Math.abs((s.wx||0)*az-(s.wz||0)*ax);
  let refusal=null;
  if(head<-BAR.maxTailwind)refusal=`Tailwind ${(-head).toFixed(1)} m/s down the ramp · wait for wind up the north face`;
  else if(cross>BAR.maxCrosswind)refusal=`Crosswind ${cross.toFixed(1)} m/s across the ramp · wait for the wind to come straight up the slope`;
  if(refusal){this.reason=refusal;return refusal;}
  this.phase='running';this.reason='Running down the launch ramp';return null;}
	approach( env = {}, from = APPROACH ) {
		this.reset();
		const trim = equilibrium( WING.trimAlpha, from.height );
		const yaw = LAUNCH.yaw;
		this.position = [ BEACH.x + from.east, from.height, BEACH.z + from.north ];
		const wind = env.sample?.( ...this.position ) || {};
		const along = [ 0, trim.speed * Math.sin( trim.gamma ), trim.speed * Math.cos( trim.gamma ) ];
		this.velocity = add( rotate( poseQ( yaw ), along ), [ wind.wx || 0, wind.wy || 0, wind.wz || 0 ] );
		this.quaternion = poseQ( yaw, trim.pitch );
		this.phase = 'airborne';
		this.reason = 'Beach approach: level wings; flare gently below 2 m';
		this.start = [ ...this.position ];
		this.lastPosition = [ ...this.position ];
	}
 update(dt,env={}){this.accumulator+=clamp(Number.isFinite(dt)?dt:0,0,.2);while(this.accumulator>=STEP){this.step(STEP,env);this.accumulator-=STEP;}}
 crash(reason,water=false){this.phase=water?'ditched':'crashed';this.reason=reason;this.damageAge=0;}
 step(h,env={}){
  this.time+=h;const m=this.metrics,p=this.position,c=this.controls,s=env.sample?.(...p)||{},wind=[s.wx||0,s.wy||0,s.wz||0],air=sub(this.velocity,wind),a=loads(air,this.quaternion,p[1],this.separation);
  Object.assign(m,{speed:a.speed,lift:a.lift,drag:a.drag,q:a.q,alpha:a.alpha,stall:a.stall,wind:length(wind),windVector:wind,thrust:0,load:a.lift/(WING.mass*G),energy:.5*WING.mass*dot(this.velocity,this.velocity)+WING.mass*G*p[1]});
  const att=attitude(this.quaternion);m.heading=att.heading;m.bank=att.bank;m.sink=-this.velocity[1];
  const lagRate = 2 * Math.max( 1, a.speed ) / ( BAR.separationLag * WING.chord );
  const was = this.separation ?? a.alpha;
  this.separation = this.pushOut ? was + ( a.alpha - was ) * Math.min( 1, h * lagRate ) : a.alpha;
  const ground=env.terrainAt?.(p[0],p[2])??-1000,water=env.waterAt?.(p[0],p[2])??0;m.agl=p[1]-1.45-Math.max(ground,water);
  if(this.phase==='ready'||this.phase==='landed')return;
  if(this.phase==='crashed'||this.phase==='ditched'){
   this.damageAge+=h;const afloat=this.phase==='ditched';const target=afloat?water-.10-Math.min(1.0,this.damageAge*.02):ground+1.15;
   const current=[s.ux||0,0,s.uz||0];this.velocity=add(current,mul(sub(this.velocity,current),Math.exp(-h*(afloat?2.2:5))));this.velocity[1]+=(target-p[1])*h*12-this.velocity[1]*Math.min(1,h*5);this.position=add(p,mul(this.velocity,h));return;
  }
  let force=add(a.force,[0,-WING.mass*G,0]);const before=[...this.velocity];
  if(this.phase==='running'){
   const along=launchLocal(p)[1],tangent=unit(rotate(poseQ(LAUNCH.yaw),[0,LAUNCH.grade,1])),speed=Math.max(0,dot(this.velocity,tangent));
   const leg=WING.maxRunForce*clamp((WING.maxRunSpeed-speed)/1.5,0,1);force=add(force,mul(tangent,leg));const next=Math.max(0,speed+dot(force,tangent)/WING.mass*h);this.run+=next*h;
   this.position=launchPoint(0,-3+this.run,1.5);this.velocity=mul(tangent,next);const relative=sub(this.velocity,wind),forward=relative[0]*Math.sin(LAUNCH.yaw)+relative[2]*Math.cos(LAUNCH.yaw);
   const rotateUp=a.speed>=BAR.liftoff*stallSpeed(p[1]);
   this.quaternion=poseQ(LAUNCH.yaw,Math.atan2(relative[1],Math.max(.5,forward))+(rotateUp?LAUNCH_ALPHA:BAR.runAlpha));m.run=this.run;m.controlWork+=leg*(speed+next)*.5*h;
   if((this.run>5&&a.speed>=BAR.liftoff*stallSpeed(p[1])&&a.lift>=WING.mass*G)||along>LAUNCH.length-3){this.phase='airborne';this.reason='Unpowered flight · the beach lies south of the mountain';}
   return;
  }
  m.airTime+=h;
  // Fore/aft weight shift sets the trim angle; the bar eases toward the keys over BAR.ease. Roll is a
  // bounded pendulum torque toward a bank set by the sideways shift. Yaw weathercocks into the
  // air-relative velocity. No kinematic velocity steering or thrust is applied.
  const barStep=h/BAR.ease,bar=this.bar;
  bar.pitch+=clamp(clamp(c.pitch,-1,1)-bar.pitch,-barStep,barStep);
  bar.roll+=clamp(clamp(c.roll,-1,1)-bar.roll,-barStep,barStep);
  const set=bar.pitch<0?WING.trimAlpha+bar.pitch*(WING.trimAlpha-BAR.pullAlpha):WING.trimAlpha+bar.pitch*(BAR.pushAlpha-WING.trimAlpha);
  const airSpeed=Math.max(1,a.speed),pathAcceleration=(force[0]*air[0]+force[1]*air[1]+force[2]*air[2])/(airSpeed*WING.mass);
  let alphaTarget=c.flare?BAR.flareAlpha:set+clamp(BAR.pathDamping*pathAcceleration/G,-BAR.pathLimit,BAR.pathLimit),authority=clamp(a.q/95,.12,3);
  let roundOut = 0; // 0..1: how much of BAR.roundOutAuthority the arms hold this step
  if(c.flare&&m.agl<BAR.holdOffHeight){
   const look = BAR.holdOffLook;
   const aheadX = p[ 0 ] + this.velocity[ 0 ] * look;
   const aheadZ = p[ 2 ] + this.velocity[ 2 ] * look;
   const groundAhead = Math.max( env.terrainAt?.( aheadX, aheadZ ) ?? - 1000, env.waterAt?.( aheadX, aheadZ ) ?? 0 );
   const groundRise = clamp( ( groundAhead - Math.max( ground, water ) ) / look, 0, BAR.holdOffRise );
   const wantedSink = Math.min( BAR.holdOffSink, BAR.holdOffRate * Math.max( 0, m.agl - BAR.holdOffFloor ) ); // m/s
   const sinkError = - this.velocity[ 1 ] + groundRise - wantedSink; // m/s the feet close on the sand faster than wanted
   const need = WING.mass * ( G + BAR.holdOffGain * sinkError ), cl = need / Math.max( 1, a.q * WING.area );
   alphaTarget=clamp((cl-WING.cl0)/WING.clAlpha,BAR.pullAlpha,BAR.flareAlpha);
   const ahead = this.velocity[ 0 ] * Math.sin( att.heading ) + this.velocity[ 2 ] * Math.cos( att.heading );
   if ( a.speed < BAR.pushOutRatio * stallSpeed( p[ 1 ] ) && ahead > BAR.pushOutGround ) this.pushOut = true;
   // The arms hold the keel at a pitch, so the torque below works on pitch, not on the angle of attack.
   if ( this.pushOut ) {

    // Full stretch: the keel at pushOutPitch, eased by the ground speed left to stop (pushOutEase).
    const shove = a.alpha - ( att.pitch - BAR.pushOutPitch * clamp( ahead / BAR.pushOutEase, 0, 1 ) ); // rad AoA
    if ( a.speed < BAR.pushOutShove * stallSpeed( p[ 1 ] ) ) this.shove = true;
    if ( ! this.shove ) {

     // The settle: push only as far as gives the lift that holds the wanted descent. The lift is the sail's
     // own (with its lagging vortex), so a push that starts a climb is eased back at once: never a climb.
     // The arms keep the round-out floor they reached (a weight shift, not q-scaled): on the q-scaled bar
     // alone the settle met its height still sinking.
     const wantSink = clamp( BAR.pushOutRate * ( m.agl - BAR.pushOutFinal ), 0, BAR.pushOutSink ); // m/s
     const settle = - this.velocity[ 1 ] + groundRise - wantSink; // m/s the feet close faster than wanted
     const clLevel = WING.mass * ( G + BAR.pushOutGain * settle ) / Math.max( 1, a.q * WING.area );
     const clNow = a.lift / Math.max( 1, a.q * WING.area );
     alphaTarget = Math.min( shove, a.alpha + ( clLevel - clNow ) / WING.clAlpha );
     roundOut = this.roundOut || 0;

    } else alphaTarget = shove;

   }
   const closing = - this.velocity[ 1 ] + groundRise; // m/s the feet close on the sand ahead
   const toTouch = closing > 0 ? m.agl / closing : Infinity; // s
   if ( ! this.pushOut ) {

    this.roundOut = Math.max( this.roundOut || 0, clamp( ( BAR.roundOutTau - toTouch ) / BAR.roundOutTauBand, 0, 1 ) );
    roundOut = this.roundOut;
    // A round-out asks the sail for at most its maximum lift: past it the strong push stalled the
    // wing mid-round-out (Space 0.2 s late: 1 of 62 stumbled at 1.9 without this, none with it).
    if ( roundOut > 0 ) alphaTarget = Math.min( alphaTarget, ALPHA_CL_MAX );

   }
  }
  if ( ! c.flare ) {

   this.pushOut = false;
   this.shove = false;
   this.roundOut = 0;

  }
  const bankTarget=bar.roll*BAR.bankMax;
  const maxMoment=WING.pilotMass*G*WING.maxShift;
  const pitchMoment=WING.pilotMass*G*(c.flare?BAR.flareShift:WING.maxShift);
  const pitchStiffness = c.flare ? BAR.flareStiffness : 480; // N·m/rad
  const pitchAuthority = Math.max( authority, BAR.roundOutAuthority * roundOut );
  const torque=[clamp((a.alpha-alphaTarget)*pitchStiffness*pitchAuthority-this.omega[0]*105,-pitchMoment,pitchMoment),clamp(a.beta*400*authority-this.omega[1]*150,-230,230),clamp((att.bank-bankTarget)*400-this.omega[2]*BAR.rollDamping,-maxMoment,maxMoment)];
  this.omega=this.omega.map((v,i)=>v+torque[i]/WING.inertia[i]*h);this.quaternion=advanceQ(this.quaternion,this.omega,h);
  const acceleration=mul(force,1/WING.mass);this.velocity=add(before,mul(acceleration,h));this.position=add(p,mul(add(before,this.velocity),h*.5));
  const midpoint=mul(add(before,this.velocity),.5);m.airWork+=dot(a.force,midpoint)*h;m.dragWork+=a.drag*a.speed*h;
  const travel=length(sub(this.position,p));this.distance+=travel;m.distance=this.distance;
  if(a.speed>WING.maxAirSpeed||Math.abs(m.load)>WING.maxLoad){m.limits++;this.crash('Airframe overload · reset to the summit');}
  // Sweep pilot and wing tips so a fast descending glider cannot tunnel through
  // a ridge or a wave. Landing requires low relative sink, speed and bank.
  const probes=[[0,-1.45,0],[-4.8,0,-1],[4.8,0,-1]];let hit=null;
  for(const local of probes){const arm=local===probes[0]?local:rotate(this.quaternion,local);for(let j=1;j<=Math.max(1,Math.ceil(travel/.5));j++){const f=j/Math.max(1,Math.ceil(travel/.5)),point=add(add(p,mul(sub(this.position,p),f)),arm),g=env.terrainAt?.(point[0],point[2])??-1000,w=env.waterAt?.(point[0],point[2])??0;const obstacle=env.obstacleAt?.(...point);if(obstacle||point[1]<Math.max(g,w)){hit={point,g,w,obstacle,tip:local[0]!==0};break;}}if(hit)break;}
  if(hit){
   m.impactSpeed=Math.max(0,-this.velocity[1]);m.landingSpeed=Math.hypot(this.velocity[0],this.velocity[2]);
   if(hit.obstacle){this.crash(`Impact with ${hit.obstacle}`);this.velocity=mul(this.velocity,.2);}
   else if(hit.w>hit.g+.08){this.crash('Water contact · glider and pilot are floating',true);this.position[1]=hit.w+1.2;}
   else{
    const slope=Math.hypot((env.terrainAt(hit.point[0]+1,hit.point[2])-env.terrainAt(hit.point[0]-1,hit.point[2]))*.5,(env.terrainAt(hit.point[0],hit.point[2]+1)-env.terrainAt(hit.point[0],hit.point[2]-1))*.5);
    const footed=!hit.tip&&m.impactSpeed<2.6&&Math.abs(att.bank)<.23&&slope<.30&&a.speed<18,soft=footed&&m.landingSpeed<=BAR.runningLanding;
    this.position[1]=Math.max(this.position[1],hit.g+1.45);
    if(soft){this.phase='landed';this.reason=landingMessage(this.position,env);this.velocity=[0,0,0];this.omega=[0,0,0];}
    else if(footed)this.crash(`Stumbled · feet down at ${m.landingSpeed.toFixed(1)} m/s over the ground, faster than a running landing`);
    else this.crash(`Ground impact · ${m.impactSpeed.toFixed(1)} m/s descent`);
   }
  }
  if(!finiteState(this)){this.reset();this.crash('Simulation limit reached · reset to fly again');m.limits++;}
 }
}
