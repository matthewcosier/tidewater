import { ArticulatedMass } from './ArticulatedMass.js';
// Passive, fixed-pose velocity constraints for the articulated capsules.
// Position corrections retain their separate job of repairing geometric error.
// Common-anchor impulses conserve total linear/angular momentum. Passivity
// belongs to the complete implicit viscosity/contact solve with its accumulated
// impulses, not to each response increment in isolation.
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const add=(a,b,s=1)=>({x:a.x+s*b.x,y:a.y+s*b.y,z:a.z+s*b.z});
const scale=(a,s)=>({x:a.x*s,y:a.y*s,z:a.z*s});
const length=a=>Math.hypot(a.x,a.y,a.z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rotate(q,v){const t=scale(cross(q,v),2);return add(add(v,t,q.w),cross(q,t));}
function velocityAt(b,r){return add(b.v,cross(b.w,r));}
// The substep runs these as twins of the helpers above that write into storage they are given: the same operations
// on the same operands in the same order, so every result is the same double (test/articulated-flood.mjs holds the
// solver to the allocating one bit for bit). Each reads all its inputs before it writes, so o may be an input. In a
// 10 m tsunami flood the allocating helpers made 22 MB a frame of garbage on the main thread (jointCoordinates,
// cross, rotate, limits: CPU and allocation profile of the real loop, tools/flood-profile.mjs).
const crossTo=(a,b,o)=>{const x=a.y*b.z-a.z*b.y,y=a.z*b.x-a.x*b.z,z=a.x*b.y-a.y*b.x;o.x=x;o.y=y;o.z=z;return o;};
const addTo=(a,b,s,o)=>{const x=a.x+s*b.x,y=a.y+s*b.y,z=a.z+s*b.z;o.x=x;o.y=y;o.z=z;return o;};
const scaleTo=(a,s,o)=>{const x=a.x*s,y=a.y*s,z=a.z*s;o.x=x;o.y=y;o.z=z;return o;};
const zeroTo=o=>{o.x=0;o.y=0;o.z=0;return o;};
function rotateTo(q,v,o){const tx=(q.y*v.z-q.z*v.y)*2,ty=(q.z*v.x-q.x*v.z)*2,tz=(q.x*v.y-q.y*v.x)*2,ax=v.x+q.w*tx,ay=v.y+q.w*ty,az=v.z+q.w*tz,x=ax+1*(q.y*tz-q.z*ty),y=ay+1*(q.z*tx-q.x*tz),z=az+1*(q.x*ty-q.y*tx);o.x=x;o.y=y;o.z=z;return o;}
function atanGradientTo(y,x,gy,gx,o){const d=x*x+y*y;if(!(d>1e-14))return zeroTo(o);const s=-y,k=1/d,ax=gy.x*x+s*gx.x,ay=gy.y*x+s*gx.y,az=gy.z*x+s*gx.z;o.x=ax*k;o.y=ay*k;o.z=az*k;return o;}
// dn(t) of the ball twist: scale(cross(a2,add(t,n,-dot(n,t))),1/len)
function dnTo(a2,t,n,len,o){const s=-dot(n,t);addTo(t,n,s,o);crossTo(a2,o,o);return scaleTo(o,1/len,o);}
const J=Array.from({length:16},()=>({x:0,y:0,z:0}));
function coordinate(record,kind,angle,min,max){record.kind=kind;record.angle=angle;record.min=min;record.max=max;}
// Storage for up to three coordinates of one joint (plane, twist, flex or cone, twist).
export function coordinateRecords(){return Array.from({length:3},()=>({kind:'',angle:0,min:0,max:0,n:{x:0,y:0,z:0}}));}
// A joint's coordinates against their limits, written into out (coordinateRecords()); returns how many.
export function jointCoordinatesTo(p,c,out){
 const a2=rotateTo(c.q,c.ax,J[0]);
 if(c.hinge){
  const h1=rotateTo(p.q,c.hP,J[1]),h2=rotateTo(c.q,c.hC,J[2]),d=clamp(dot(a2,h1),-1,1),e=Math.asin(d);
  scaleTo(crossTo(a2,h1,J[3]),1/Math.sqrt(Math.max(1e-12,1-d*d)),out[0].n);coordinate(out[0],'plane',e,-c.cone,c.cone);
  const d1=dot(h1,a2),d2=dot(h2,a2),y=dot(crossTo(h1,h2,J[3]),a2),x=dot(h1,h2)-d1*d2;
  const gy=addTo(crossTo(h2,crossTo(a2,h1,J[4]),J[4]),crossTo(a2,crossTo(h1,h2,J[5]),J[5]),1,J[4]),gx=addTo(crossTo(h2,h1,J[5]),crossTo(a2,h1,J[6]),-d2,J[5]);
  atanGradientTo(y,x,gy,gx,out[1].n);coordinate(out[1],'twist',Math.atan2(y,x),-c.twist,c.twist);
  const a1=rotateTo(p.q,p.ax,J[6]),fy=dot(crossTo(a1,a2,J[7]),h1),fx=dot(a1,a2);
  atanGradientTo(fy,fx,crossTo(a2,crossTo(h1,a1,J[8]),J[8]),crossTo(a2,a1,J[9]),out[2].n);coordinate(out[2],'flex',Math.atan2(fy,fx),c.hinge[0],c.hinge[1]);
  return 3;
 }
 const a1=rotateTo(p.q,c.aN,J[1]),crossAxis=crossTo(a1,a2,J[2]),s=length(crossAxis),th=Math.atan2(s,dot(a1,a2));
 if(s>1e-8)scaleTo(crossAxis,1/s,out[0].n);else zeroTo(out[0].n);coordinate(out[0],'cone',th,-Infinity,c.cone);
 const sum=addTo(a1,a2,1,J[3]),len=length(sum);if(len<1e-3)return 1;const n=scaleTo(sum,1/len,J[4]),b1=rotateTo(p.q,c.bN,J[5]),b2=rotateTo(c.q,c.bC,J[6]),d1=dot(b1,n),d2=dot(b2,n);
 const y=dot(crossTo(b1,b2,J[7]),n),x=dot(b1,b2)-d1*d2;
 const gy=addTo(crossTo(b2,crossTo(n,b1,J[8]),J[8]),dnTo(a2,crossTo(b1,b2,J[9]),n,len,J[9]),1,J[8]);
 const gx=addTo(addTo(crossTo(b2,b1,J[10]),dnTo(a2,b1,n,len,J[11]),-d2,J[10]),addTo(crossTo(b2,n,J[12]),dnTo(a2,b2,n,len,J[13]),1,J[12]),-d1,J[10]);
 atanGradientTo(y,x,gy,gx,out[1].n);coordinate(out[1],'twist',Math.atan2(y,x),-c.twist,c.twist);
 return 2;
}
// The same coordinates in fresh storage (tests and tools).
export function jointCoordinates(p,c){const out=coordinateRecords();out.length=jointCoordinatesTo(p,c,out);return out;}
// Constrained point response for frame-boundary contacts. The 39 ball-anchor
// rows share one factorization at this fixed pose. A unit point impulse is
// projected through all joints before its effective inverse mass is measured;
// the contact therefore cannot treat a connected forearm as an isolated mass.
const UNITS=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}];
const limitCoordinates=coordinateRecords(),_A=({x:0,y:0,z:0}),_B=({x:0,y:0,z:0});
// Three response columns in one buffer, as ArticulatedMass.solve3 returns them.
function block(N){const data=new Float64Array(3*N),list=[data.subarray(0,N),data.subarray(N,2*N),data.subarray(2*N)];list.data=data;return list;}
function component(list,k,n){return list[0][k]*n.x+list[1][k]*n.y+list[2][k]*n.z;}
// Project only the body components needed by the row, not a temporary
// full-rig vector. Directions are evaluated every call (friction mutates them).
function relativePointTo(A,B,k,r,n,o){const vx=component(B,k,n)-component(A,k,n),vy=component(B,k+1,n)-component(A,k+1,n),vz=component(B,k+2,n)-component(A,k+2,n),wx=component(B,k+3,n)-component(A,k+3,n),wy=component(B,k+4,n)-component(A,k+4,n),wz=component(B,k+5,n)-component(A,k+5,n);o.x=vx+(wy*r.z-wz*r.y);o.y=vy+(wz*r.x-wx*r.z);o.z=vz+(wx*r.y-wy*r.x);return o;}
// One rig's response at the substep's fixed pose. reset() starts a substep: it refactors the rig at its pose and
// forgets every cached response. A rig keeps one (Ragdoll.simulate), so its buffers, caches and limit rows are
// allocated once and reused; articulatedContact() makes a fresh one for every other caller.
export class ArticulatedResponse{
 constructor(rig){const N=rig.bodies.length*6;this.rig=rig;this.bodies=rig.bodies;this.N=N;this.momentum=new Float64Array(N);this.velocity=new Float64Array(N);this.force=new Float64Array(3*N);this.points=new WeakMap();this.blocks=[];this.used=0;this.angleEpoch=new Float64Array(rig.bodies.length).fill(-1);this.angles=[];this.angleBlocks=[];this.rows=[];this.rowCount=0;this.rowsBuilt=false;this.epoch=0;this.defer=false;}
 reset(viscosityStep=0,deferWriteback=false){const rig=this.rig;this.factor=rig._articulatedMass?rig._articulatedMass.update(viscosityStep):(rig._articulatedMass=new ArticulatedMass(rig,viscosityStep));this.defer=deferWriteback;this.epoch++;this.used=0;this.rowsBuilt=false;this.rowCount=0;this.factor.solve(this.factor.momentum(this.momentum),this.velocity);this.publish();return this;}
 // The substep solver may keep its velocity state in this packed buffer while
 // iterating contacts. It publishes before any body-based observer or wall solve.
 // External frame-boundary callers retain immediate object velocity updates.
 publish(){const bodies=this.bodies,velocity=this.velocity;for(let i=0,k=0;i<bodies.length;i++,k+=6){const b=bodies[i];b.v.x=velocity[k];b.v.y=velocity[k+1];b.v.z=velocity[k+2];b.w.x=velocity[k+3];b.w.y=velocity[k+4];b.w.z=velocity[k+5];}}
 readBodies(){const bodies=this.bodies,velocity=this.velocity;for(let i=0,k=0;i<bodies.length;i++,k+=6){const b=bodies[i];velocity[k]=b.v.x;velocity[k+1]=b.v.y;velocity[k+2]=b.v.z;velocity[k+3]=b.w.x;velocity[k+4]=b.w.y;velocity[k+5]=b.w.z;}}
 point(b,r){let entry=this.points.get(r);if(!entry)this.points.set(r,entry={epoch:-1,list:null});if(entry.epoch!==this.epoch){const N=this.N,force=this.force;force.fill(0);for(let axis=0;axis<3;axis++){const j=UNITS[axis],k=axis*N+b.index*6;force[k]=j.x;force[k+1]=j.y;force[k+2]=j.z;force[k+3]=r.y*j.z-r.z*j.y;force[k+4]=r.z*j.x-r.x*j.z;force[k+5]=r.x*j.y-r.y*j.x;}entry.list=this.factor.solve3(force,b.index,this.blocks[this.used]??=block(N));this.used++;entry.epoch=this.epoch;}return entry.list;}
 // Exact zero does no physical work. Negative releases and tiny corrections
 // still use the complete connected response, with the original sum order.
 apply(list,x,y,z){
  if(x===0&&y===0&&z===0)return;
  const X=list[0],Y=list[1],Z=list[2],N=this.N,velocity=this.velocity;
  if(this.defer){for(let k=0;k<N;k++)velocity[k]+=X[k]*x+Y[k]*y+Z[k]*z;return;}
  const bodies=this.bodies;for(let i=0,k=0;i<bodies.length;i++,k+=6){const b=bodies[i];b.v.x+=X[k]*x+Y[k]*y+Z[k]*z;b.v.y+=X[k+1]*x+Y[k+1]*y+Z[k+1]*z;b.v.z+=X[k+2]*x+Y[k+2]*y+Z[k+2]*z;b.w.x+=X[k+3]*x+Y[k+3]*y+Z[k+3]*z;b.w.y+=X[k+4]*x+Y[k+4]*y+Z[k+4]*z;b.w.z+=X[k+5]*x+Y[k+5]*y+Z[k+5]*z;}
 }
 angular(p,c){const i=c.index;if(this.angleEpoch[i]!==this.epoch){const N=this.N,force=this.force;force.fill(0);for(let j=0;j<3;j++){force[j*N+p.index*6+3+j]=1;force[j*N+c.index*6+3+j]=-1;}this.angles[i]=this.factor.solve3(force,c.index,this.angleBlocks[i]??=block(N));this.angleEpoch[i]=this.epoch;}return this.angles[i];}
 // Limit directions are fixed for this pose. Project their complete connected
 // responses once instead of combining all three axes on every iteration.
 applyLimit(response,J){
  if(J===0)return;
  const N=this.N,velocity=this.velocity;
  if(this.defer){for(let k=0;k<N;k++)velocity[k]+=response[k]*J;return;}
  const bodies=this.bodies;for(let i=0,k=0;i<bodies.length;i++,k+=6){const b=bodies[i];b.v.x+=response[k]*J;b.v.y+=response[k+1]*J;b.v.z+=response[k+2]*J;b.w.x+=response[k+3]*J;b.w.y+=response[k+4]*J;b.w.z+=response[k+5]*J;}
 }
 writeback(){if(this.defer)this.publish();}
 pointVelocity(b,r,out){if(!this.defer)this.readBodies();const velocity=this.velocity,k=b.index*6;out.x=velocity[k]+(velocity[k+4]*r.z-velocity[k+5]*r.y);out.y=velocity[k+1]+(velocity[k+5]*r.x-velocity[k+3]*r.z);out.z=velocity[k+2]+(velocity[k+3]*r.y-velocity[k+4]*r.x);return out;}
 relativeSpeed(a,ra,b,rb,n){if(!this.defer)this.readBodies();const velocity=this.velocity,A=a.index*6,B=b.index*6;return (velocity[B]+(velocity[B+4]*rb.z-velocity[B+5]*rb.y)-velocity[A]-(velocity[A+4]*ra.z-velocity[A+5]*ra.y))*n.x+(velocity[B+1]+(velocity[B+5]*rb.x-velocity[B+3]*rb.z)-velocity[A+1]-(velocity[A+5]*ra.x-velocity[A+3]*ra.z))*n.y+(velocity[B+2]+(velocity[B+3]*rb.y-velocity[B+4]*rb.x)-velocity[A+2]-(velocity[A+3]*ra.y-velocity[A+4]*ra.x))*n.z;}
 report(){if(this.defer)this.publish();let anchorResidual=0;for(const c of this.rig.joints){const p=c.parent,at=scale(add(add(p.x,rotate(p.q,c.rP)),add(c.x,rotate(c.q,c.o))),.5),u=add(velocityAt(c,add(at,c.x,-1)),velocityAt(p,add(at,p.x,-1)),-1);anchorResidual=Math.max(anchorResidual,Math.abs(u.x),Math.abs(u.y),Math.abs(u.z));}return {anchorResidual,limits:(this.rowsBuilt?this.rows.slice(0,this.rowCount):[]).map(row=>({body:row.c.name,n:{...row.n},allow:row.allow,impulse:row.impulse,speed:dot(add(row.c.w,row.p.w,-1),row.n)}))};}
 wPos(b,r,n){const list=this.point(b,r),k=b.index*6,vx=component(list,k,n),vy=component(list,k+1,n),vz=component(list,k+2,n),wx=component(list,k+3,n),wy=component(list,k+4,n),wz=component(list,k+5,n);return (vx+(wy*r.z-wz*r.y))*n.x+(vy+(wz*r.x-wx*r.z))*n.y+(vz+(wx*r.y-wy*r.x))*n.z;}
 impulse(b,r,x,y,z){if(x===0&&y===0&&z===0)return;this.apply(this.point(b,r),x,y,z);}
 pairMass(a,ra,b,rb,n){const A=this.point(a,ra),B=this.point(b,rb),P=relativePointTo(A,B,b.index*6,rb,n,_A),Q=relativePointTo(A,B,a.index*6,ra,n,_B);return (P.x+-1*Q.x)*n.x+(P.y+-1*Q.y)*n.y+(P.z+-1*Q.z)*n.z;}
 pairImpulse(a,ra,b,rb,x,y,z){if(x===0&&y===0&&z===0)return;this.apply(this.point(a,ra),-x,-y,-z);this.apply(this.point(b,rb),x,y,z);}
 limits(h){
  const N=this.N,velocity=this.velocity,defer=this.defer;let maximumChange=0;
  if(!this.rowsBuilt){this.rowsBuilt=true;let count=0;for(const c of this.rig.joints){const m=jointCoordinatesTo(c.parent,c,limitCoordinates);for(let i=0;i<m;i++){
   const p=c.parent,{n,angle,min,max}=limitCoordinates[i];
   const len=length(n);if(len<1e-8)continue;
   if(Number.isFinite(max)){const row=this.rows[count]??=limitRow(N);count++;row.p=p;row.c=c;row.n.x=n.x;row.n.y=n.y;row.n.z=n.z;row.allow=Math.max(0,(max-angle)/h);row.impulse=0;row.ready=false;}
   if(Number.isFinite(min)){const row=this.rows[count]??=limitRow(N);count++;row.p=p;row.c=c;row.n.x=n.x*-1;row.n.y=n.y*-1;row.n.z=n.z*-1;row.allow=Math.max(0,(angle-min)/h);row.impulse=0;row.ready=false;}
  }}this.rowCount=count;}
  for(let i=0;i<this.rowCount;i++){const row=this.rows[i],{p,c,n,allow}=row,kp=p.index*6+3,kc=c.index*6+3,speed=defer?(velocity[kc]-velocity[kp])*n.x+(velocity[kc+1]-velocity[kp+1])*n.y+(velocity[kc+2]-velocity[kp+2])*n.z:dot(add(c.w,p.w,-1),n);if(!row.impulse&&speed<=allow)continue;
   if(!row.ready){row.ready=true;const list=this.angular(p,c),response=row.response;for(let k=0;k<N;k++)response[k]=component(list,k,n);row.eff=(response[kp]-response[kc])*n.x+(response[kp+1]-response[kc+1])*n.y+(response[kp+2]-response[kc+2])*n.z;}
   const total=Math.max(0,row.impulse+(speed-allow)/row.eff),J=total-row.impulse;row.impulse=total;maximumChange=Math.max(maximumChange,Math.abs(J));this.applyLimit(row.response,J);
  }
  return maximumChange;
 }
}
function limitRow(N){return {p:null,c:null,n:{x:0,y:0,z:0},allow:0,impulse:0,ready:false,eff:0,response:new Float64Array(N)};}
export function articulatedContact(rig,{viscosityStep=0,deferWriteback=false}={}){return new ArticulatedResponse(rig).reset(viscosityStep,deferWriteback);}
