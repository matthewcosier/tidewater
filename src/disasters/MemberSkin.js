import {Matrix4,Quaternion} from '../engine/index.js';
import {pieceSlot,setPieceTransform,setPieceWeights,pieceWeightKind} from '../engine/render/PieceMotion.js';
const leftMatrix=new Matrix4(),rightMatrix=new Matrix4(),localLeft=new Matrix4(),localRight=new Matrix4(),rotation=new Quaternion(),inverseRest=new Quaternion();
function sectionTransform(out,body){
 rotation.copy(body.quaternion).multiply(inverseRest.copy(body.restQuaternion).invert());out.makeRotationFromQuaternion(rotation);const e=out.elements,p=body.origin;
 e[12]=body.position.x-e[0]*p.x-e[4]*p.y-e[8]*p.z;e[13]=body.position.y-e[1]*p.x-e[5]*p.y-e[9]*p.z;e[14]=body.position.z-e[2]*p.x-e[6]*p.y-e[10]*p.z;return out;
}
function weights(member,span){
 if(span.skinWeights)return span.skinWeights;
 const p=span.pos,c=member.center,a=member.axes[0],L=member.length;
 // An indexed attachment can have any vertex count. Its whole primitive uses
 // one section frame, including vertices that do not form a packed triple.
 if(span.rigidAttachment){let along=0;for(let i=0;i<p.length;i+=3)along+=(p[i]-c.x)*a.x+(p[i+1]-c.y)*a.y+(p[i+2]-c.z)*a.z;return span.skinWeights={owner:along>0?1:0};}
 const blend=new Float64Array(span.count),side=new Uint8Array(span.count/3);
 for(let i=0;i<p.length;i+=3)blend[i/3]=Math.max(0,Math.min(1,((p[i]-c.x)*a.x+(p[i+1]-c.y)*a.y+(p[i+2]-c.z)*a.z)/L+.5));
 for(let i=0;i<p.length;i+=9){let sum=0;for(let j=0;j<9;j+=3)sum+=(p[i+j]-c.x)*a.x+(p[i+j+1]-c.y)*a.y+(p[i+j+2]-c.z)*a.z;side[i/9]=sum>0?1:0;}
 return span.skinWeights={blend,side};
}
// A continuous skin driven by two real rigid section frames. It is a reduced
// flexible member, not a volumetric soft body. After its material joint breaks,
// each tessellated triangle belongs to one real section and can separate.
// The GPU draws it (engine/render/PieceMotion.js): each span holds two consecutive
// slots, the two section transforms, and each vertex its rest weight toward the
// second; the weights are written when the skin changes kind (bending, severed),
// the transforms each time the member moves. The blend is the section-frame
// definition: p = L x + ( R x - L x ) t, the normal renormalised after it.
const RIGID=0,OWNER=1,SEVERED=2,BLEND=3;
export function drawMember(member){
 const left=member.sections[0],right=member.sections.at(-1),rigid=left===right;
 sectionTransform(leftMatrix,left);if(!rigid)sectionTransform(rightMatrix,right);
 for(const s of member.spans){
  const slot=pieceSlot(s,2),kind=rigid?RIGID:s.rigidAttachment?OWNER:member.severed?SEVERED:BLEND;
  if(pieceWeightKind(slot)!==kind){const W=rigid?null:weights(member,s);setPieceWeights(s,slot,i=>rigid?0:W.owner??(member.severed?W.side[Math.floor(i/3)]:W.blend[i]),kind);}
  setPieceTransform(slot,leftMatrix,s.inverse,s.frame);setPieceTransform(slot+1,rigid?leftMatrix:rightMatrix,s.inverse,s.frame);
 }
}
