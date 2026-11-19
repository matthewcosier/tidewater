import { Vector3 } from '../engine/index.js';
import { AIR_DENSITY, SEA_WATER_DENSITY, GRAVITY } from '../physics/Loads.js';
import { frontRate } from './SurfaceRate.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

// The bridge returns actual v + omega cross r. No attitude differencing or
// invented spin. Position supplied here is the actual centre of mass.
export function nativeAngularVelocity(physics,id,p,v){
 const x=physics.disaster_contact(id,new Float32Array([p.x+1,p.y,p.z]),new Float32Array([0,1,0]));
 const z=physics.disaster_contact(id,new Float32Array([p.x,p.y,p.z+1]),new Float32Array([0,1,0]));
 return x.length>=3&&z.length>=3?new Vector3(v.y-z[1],((z[0]-v.x)-(x[2]-v.z))*.5,x[1]-v.y):new Vector3();
}
export function worldBoxInertia(mass,half,q){
 const h=Array.isArray(half)?half:[half.x,half.y,half.z],diag=[mass*(h[1]**2+h[2]**2)/3,mass*(h[0]**2+h[2]**2)/3,mass*(h[0]**2+h[1]**2)/3];
 return worldPrincipalInertia(diag,q);
}
export function worldPrincipalInertia(diag,q){
 const axes=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)].map(v=>v.applyQuaternion(q).toArray()),out=new Float64Array(9);
 for(let a=0;a<3;a++)for(let i=0;i<3;i++)for(let j=0;j<3;j++)out[i*3+j]+=diag[a]*axes[a][i]*axes[a][j];return out;
}
export function boxLoadPoints(half){
 const h=Array.isArray(half)?half:[half.x,half.y,half.z],points=[];
 for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){const p=[0,0,0];p[axis]=sign*h[axis]*.65;points.push({local:p,half:h.map(x=>x*.35),areaWeight:1/6,volumeWeight:1/6});}return points;
}
// stemShare and crownShare split the body's buoyant volume. The crown's branch wood floats like the
// stem (TreeMass.js): with no crown volume a floating tree's top sank and stood it on end.
// stemCdA and crownCdA (m²) give each point its own drag area, the same in air and in water (TreeFailure.js
// crownDragArea, stemDragArea): the standing tree's aerodynamics carried onto the body, so the load does not jump at release.
export function treeLoadPoints(height,radius,crownRadius,{crownY=height*.32,crownHalfHeight=height*.12,stemShare=1,crownShare=0,stemCdA,crownCdA}={}){
 const points=[];
 for(let i=0;i<5;i++)points.push({local:[0,(i-2)*height/5,0],half:[radius,height/10,radius],areaWeight:.2/5,volumeWeight:stemShare/5,cda:stemCdA===undefined?undefined:stemCdA/5});
 for(const [x,z]of [[-1,0],[1,0],[0,-1],[0,1]])points.push({local:[x*crownRadius,crownY,z*crownRadius],half:[crownRadius*.5,crownHalfHeight,crownRadius*.5],areaWeight:.8/4,volumeWeight:crownShare/4,cda:crownCdA===undefined?undefined:crownCdA/4});
 return points;
}

// Floats per drag record sent to the solver (set_disaster_drag, rally-physics/src/disasters.rs): the body's id, the
// load point in the body's axes from its origin (m), rho Cd A / 2 for the point's share in this fluid (kg/m), a linear
// damping (kg/s) and the fluid's velocity at the point (m/s, world axes).
export const DRAG_RECORD=9;
// A list of drag records. It grows by doubling, never per frame: Disasters.loads owns one, every body's load writes
// its points into it and it is sent once a frame.
export function dragList(records=64){return {data:new Float32Array(records*DRAG_RECORD),n:0};}
function dragPoint(list,id,local,quadratic,linear,ux,uy,uz){
 if(list.n+DRAG_RECORD>list.data.length){const grown=new Float32Array(list.data.length*2);grown.set(list.data);list.data=grown;}
 const d=list.data,n=list.n;
 d[n]=id;d[n+1]=local[0];d[n+2]=local[1];d[n+3]=local[2];d[n+4]=quadratic;d[n+5]=linear;d[n+6]=ux;d[n+7]=uy;d[n+8]=uz;
 list.n=n+DRAG_RECORD;
}
// For a caller with no list of its own (a test, a tool): one body's records, read from out.drag.
const OWN=dragList(24);
const NO_OFFSET=[0,0,0];
// Scratch for one call. The load runs for every awake body every frame (340 in a 25 m flood at the pier) and used
// to build about thirty vectors, two 6 x 6 matrices and a closure per body per frame.
const offset=new Vector3(),com=new Vector3(),arm=new Vector3(),at=new Vector3(),pointSample={},centreSample={},front={};
// The body's axes in world space (the rotation's columns), for the projected drag area.
const axes=new Float64Array(9);
// Drag area (m²) of a box along a relative flow (dx, dy, dz): each face's area times the share of the flow it meets,
// faces = [ area normal to the body's x, to its y, to its z ]. A thin slab edge-on to the flow takes its edge, not its
// plan (10 to 30 times the edge for a deck bay). No flow: the body's own area.
function projected(faces,dx,dy,dz,area){
 const l=Math.hypot(dx,dy,dz);if(!(l>1e-6))return area;
 return (Math.abs(axes[0]*dx+axes[1]*dy+axes[2]*dz)*faces[0]+Math.abs(axes[3]*dx+axes[4]*dy+axes[5]*dz)*faces[1]+Math.abs(axes[6]*dx+axes[7]*dy+axes[8]*dz)*faces[2])/l;
}
// m/s²: the bound on what is sent as a force held over the frame. It is safe on the three terms left there because
// none of them is stiff. Buoyancy is at most g x 1025 / the body's density (20 m/s² for pine at 500 kg/m³, the
// lightest material on the island) and changes only as the body moves through its own height. The crushed crown's
// spring carries half the tree's weight at its crush depth and its period is well above a frame. Ground shaking is
// the earthquake's acceleration, a few g at most. Drag is not on this list and has no bound: it goes to the solver.
const HELD_BOUND=45;

/** The environmental load on a rigid disaster body for one frame, in two parts.
 *
 * Drag, in air and in water, is stiff: water at 11 m/s puts 870 m/s² on a 26 kg crate. Sent as a force held over the
 * frame it had to be bounded to 45 m/s², so the water could not hold a body a contact had thrown (a crate left a
 * metre of water at 8 to 11 m/s and climbed 4.5 m), and without the bound the held force kept pushing a body a
 * contact had already turned (bodies at 4,000 m/s). So drag is not a force here. Each load point's share goes to the
 * solver as a record (`context.drag`, DRAG_RECORD floats: where the point is, rho Cd A / 2 for its wet or dry share,
 * the fluid's velocity there) and the solver relaxes the point's velocity toward the fluid's every substep, implicitly
 * (rally-physics/src/disasters.rs, fluid_drag). The water's velocity has its vertical part (SurfaceRate.js): at the
 * surface, the surface's rate averaged across the front over the length of a real hydraulic jump, read once per body at
 * its centre, falling to zero at the bed in proportion to the height above it. The wet share is this
 * frame's (at most 25 ms of game time old). The water acts on a body through buoyancy and this drag and nothing else:
 * the solver's pressure is hydrostatic, so a term for the water's own vertical acceleration (tried: rho V Dw/Dt, read
 * frame to frame off the numerical shock) adds a force the solver's water never feels, and it kept history per body.
 *
 * Buoyancy, a crushed crown's spring and ground shaking are returned as a force and a torque about the centre of
 * mass (N, N m), held over the frame and bounded together to HELD_BOUND so the bound makes no torque of its own.
 * A fallen tree's crown on the ground (body.crownGround) is a soft support at its centre, not a rigid ball (the
 * rigid crown was a fulcrum: a felled tree's root end was thrown up at 5 to 12 m/s): a spring up from the crushed
 * depth here, and its damping in every direction as a record with a linear coefficient and the ground's velocity, zero.
 *
 * `out` is `context.out` when the caller gives one (Disasters.loads reuses one object), else a new object.
 */
export function rigidEnvironmentalLoad(field,physics,body,context,out=context.out??{}){
 const {position,velocity,supported=false}=context,list=context.drag??OWN;
 if(!context.drag)list.n=0;
 const first=list.n,mass=body.mass,q=body.quaternion,id=body.id,c=body.centerOfMass??NO_OFFSET;
 offset.set(c[0],c[1],c[2]);com.copy(offset).applyQuaternion(q).add(position);
 // How far each body axis reaches upward: the second row of the rotation matrix.
 const upX=Math.abs(2*(q.x*q.y+q.w*q.z)),upY=Math.abs(1-2*(q.x*q.x+q.z*q.z)),upZ=Math.abs(2*(q.y*q.z-q.w*q.x));
 // A structure piece's drag area is its solid's, projected along the flow (body.faces, Structures.js); others keep body.area.
 const faces=body.faces;if(faces){axes[0]=1-2*(q.y*q.y+q.z*q.z);axes[1]=2*(q.x*q.y+q.w*q.z);axes[2]=2*(q.x*q.z-q.w*q.y);axes[3]=2*(q.x*q.y-q.w*q.z);axes[4]=1-2*(q.x*q.x+q.z*q.z);axes[5]=2*(q.y*q.z+q.w*q.x);axes[6]=2*(q.x*q.z+q.w*q.y);axes[7]=2*(q.y*q.z-q.w*q.x);axes[8]=1-2*(q.x*q.x+q.y*q.y);}
 let fx=0,fy=0,fz=0,tx=0,ty=0,tz=0,raw=0,wetVolume=0,read=false;
 if(supported){const s=field.sample(com.x,com.y,com.z,centreSample);fx+=mass*s.ax;fy+=mass*s.ay;fz+=mass*s.az;}
 const points=body.loadPoints??(body.boxPoints??=boxLoadPoints(body.half));
 for(let i=0;i<points.length;i++){
  const p=points[i],half=p.half,local=p.local;
  arm.set(local[0],local[1],local[2]).sub(offset).applyQuaternion(q);at.copy(com).add(arm);
  const s=field.sample(at.x,at.y,at.z,pointSample),ground=field.terrain(at.x,at.z);
  const extent=Math.max(.005,half[0]*upX+half[1]*upY+half[2]*upZ),wet=s.height>ground+.02?clamp((s.height-at.y+extent)/(2*extent),0,1):0;
  const share=p.volumeWeight??p.areaWeight;wetVolume+=body.volume*share*wet;
  // A point with its own drag area (a tree's stem and crown) takes it in both fluids; others share the body's area by weight.
  const own=p.cda!==undefined,area=own?p.cda:body.area*p.areaWeight;
  const air=.5*AIR_DENSITY*(faces&&!own?projected(faces,s.wx-velocity.x,s.wy-velocity.y,s.wz-velocity.z,body.area)*p.areaWeight:area)*(1-wet)*(own?1:body.dragCoefficient??1.1);
  if(air>0){dragPoint(list,id,local,air,0,s.wx,s.wy,s.wz);raw+=air*((s.wx-velocity.x)**2+(s.wy-velocity.y)**2+(s.wz-velocity.z)**2);}
  if(wet>0){
   if(!read){frontRate(field.gridAt?.(com.x,com.z),com.x,com.z,front);read=true;}
   const rise=front.rate*clamp((at.y-ground)/Math.max(.05,s.height-ground),0,1);
   const water=.5*SEA_WATER_DENSITY*(faces&&!own?projected(faces,s.ux-velocity.x,rise-velocity.y,s.uz-velocity.z,body.area)*p.areaWeight:area)*wet*(own?1:body.waterDragCoefficient??1);
   dragPoint(list,id,local,water,0,s.ux,rise,s.uz);raw+=water*((s.ux-velocity.x)**2+(rise-velocity.y)**2+(s.uz-velocity.z)**2);
   const lift=SEA_WATER_DENSITY*GRAVITY*body.volume*share*wet;fy+=lift;tx-=arm.z*lift;tz+=arm.x*lift;
  }
 }
 const crown=body.crownGround;
 if(crown){
  arm.set(0,crown.y,0).sub(offset).applyQuaternion(q);at.copy(com).add(arm);
  const crush=field.terrain(at.x,at.z)+crown.rest-at.y;
  if(crush>0){const lift=crown.stiffness*crush;fy+=lift;tx-=arm.z*lift;tz+=arm.x*lift;dragPoint(list,id,crown.local??=[0,crown.y,0],0,crown.damping,0,0,0);}
 }
 // One scale for the force and the torque, so the bound cannot manufacture a separate torque.
 const linear=Math.hypot(fx,fy,fz),scale=Math.min(1,HELD_BOUND*mass/Math.max(linear,1e-12));
 out.fx=fx*scale;out.fy=fy*scale;out.fz=fz*scale;out.tx=tx*scale;out.ty=ty*scale;out.tz=tz*scale;
 out.rawDragForce=raw;out.rawAcceleration=linear/mass;out.limited=scale<1;out.wet=body.volume>0?wetVolume/body.volume:0;out.drag=list;out.dragFirst=first;
 // The solver refuses a whole batch for one bad number: a body with one keeps none of its records.
 let finite=Number.isFinite(out.fx+out.fy+out.fz+out.tx+out.ty+out.tz);
 for(let i=first;finite&&i<list.n;i++)finite=Number.isFinite(list.data[i]);
 if(!finite){list.n=first;throw new Error('Non-finite rigid environmental load');}
 return out;
}
