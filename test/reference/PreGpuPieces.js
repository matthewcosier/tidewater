// Frozen CPU drawing of loose pieces, before the GPU drew them from their slot transforms
// (src/engine/render/PieceMotion.js): drawSpans (Structures.js), drawMember (MemberSkin.js) and
// PropPhysics.draw (Props.js) as they were, each rewriting the vertex and normal ranges of a moved
// piece. Only the previous-position bookkeeping (markGeometryMotion) is left out: it never changed
// the drawn vertices. The equivalence tests run these on a copy of the batch.
import { Vector3, Matrix4, Matrix3, Quaternion } from '../../src/engine/index.js';
const m=new Matrix4(),normal=new Matrix3(),one=new Vector3(1,1,1);
export function drawSpans(body,position,rotation){
 m.compose(position,rotation,one);m.multiply(new Matrix4().makeTranslation(-body.origin.x,-body.origin.y,-body.origin.z));const worldMatrix=m.clone();
 for(const s of body.spans){m.copy(worldMatrix);if(s.inverse)m.premultiply(s.inverse);normal.getNormalMatrix(m);const e=m.elements,ne=normal.elements;const p=s.geo.attributes.position,n=s.geo.attributes.normal,a=s.start*3;
  for(let i=0;i<s.pos.length;i+=3){const x=s.pos[i],y=s.pos[i+1],z=s.pos[i+2];p.array[a+i]=e[0]*x+e[4]*y+e[8]*z+e[12];p.array[a+i+1]=e[1]*x+e[5]*y+e[9]*z+e[13];p.array[a+i+2]=e[2]*x+e[6]*y+e[10]*z+e[14];if(n&&s.nrm){const x=s.nrm[i],y=s.nrm[i+1],z=s.nrm[i+2];n.array[a+i]=ne[0]*x+ne[3]*y+ne[6]*z;n.array[a+i+1]=ne[1]*x+ne[4]*y+ne[7]*z;n.array[a+i+2]=ne[2]*x+ne[5]*y+ne[8]*z;}}
  p.addUpdateRange(a,s.pos.length);p.needsUpdate=true;if(n){n.addUpdateRange(a,s.pos.length);n.needsUpdate=true;}
 }
}
const leftMatrix=new Matrix4(),rightMatrix=new Matrix4(),localLeft=new Matrix4(),localRight=new Matrix4(),rotation=new Quaternion(),inverseRest=new Quaternion();
function sectionTransform(out,body){
 rotation.copy(body.quaternion).multiply(inverseRest.copy(body.restQuaternion).invert());out.makeRotationFromQuaternion(rotation);const e=out.elements,p=body.origin;
 e[12]=body.position.x-e[0]*p.x-e[4]*p.y-e[8]*p.z;e[13]=body.position.y-e[1]*p.x-e[5]*p.y-e[9]*p.z;e[14]=body.position.z-e[2]*p.x-e[6]*p.y-e[10]*p.z;return out;
}
function weights(member,span){
 if(span.referenceWeights)return span.referenceWeights;
 const p=span.pos,c=member.center,a=member.axes[0],L=member.length;
 // An indexed attachment can have any vertex count. Its whole primitive uses
 // one section frame, including vertices that do not form a packed triple.
 if(span.rigidAttachment){let along=0;for(let i=0;i<p.length;i+=3)along+=(p[i]-c.x)*a.x+(p[i+1]-c.y)*a.y+(p[i+2]-c.z)*a.z;return span.referenceWeights={owner:along>0?1:0};}
 const blend=new Float64Array(span.count),side=new Uint8Array(span.count/3);
 for(let i=0;i<p.length;i+=3)blend[i/3]=Math.max(0,Math.min(1,((p[i]-c.x)*a.x+(p[i+1]-c.y)*a.y+(p[i+2]-c.z)*a.z)/L+.5));
 for(let i=0;i<p.length;i+=9){let sum=0;for(let j=0;j<9;j+=3)sum+=(p[i+j]-c.x)*a.x+(p[i+j+1]-c.y)*a.y+(p[i+j+2]-c.z)*a.z;side[i/9]=sum>0?1:0;}
 return span.referenceWeights={blend,side};
}
// A continuous skin driven by two real rigid section frames. It is a reduced
// flexible member, not a volumetric soft body. After its material joint breaks,
// each tessellated triangle belongs to one real section and can separate.
// Rest weights and affine section transforms avoid allocating vector objects for
// each vertex; their interpolation is identical to the section-frame definition.
export function drawMember(member){
 const left=member.sections[0],right=member.sections.at(-1),rigid=left===right;
 sectionTransform(leftMatrix,left);if(!rigid)sectionTransform(rightMatrix,right);
 for(const s of member.spans){
  const la=s.inverse?localLeft.multiplyMatrices(s.inverse,leftMatrix).elements:leftMatrix.elements;
  const ra=rigid?la:s.inverse?localRight.multiplyMatrices(s.inverse,rightMatrix).elements:rightMatrix.elements;
  const position=s.geo.attributes.position,normal=s.geo.attributes.normal,base=s.start*3,P=s.pos,N=s.nrm,A=position.array,B=normal?.array,W=rigid?null:weights(member,s);
  for(let i=0;i<P.length;i+=3){const x=P[i],y=P[i+1],z=P[i+2],t=rigid?0:W.owner??(member.severed?W.side[Math.floor(i/9)]:W.blend[i/3]);
   let px=la[0]*x+la[4]*y+la[8]*z+la[12],py=la[1]*x+la[5]*y+la[9]*z+la[13],pz=la[2]*x+la[6]*y+la[10]*z+la[14];
   if(t){px+=(ra[0]*x+ra[4]*y+ra[8]*z+ra[12]-px)*t;py+=(ra[1]*x+ra[5]*y+ra[9]*z+ra[13]-py)*t;pz+=(ra[2]*x+ra[6]*y+ra[10]*z+ra[14]-pz)*t;}
   A[base+i]=px;A[base+i+1]=py;A[base+i+2]=pz;
   if(B&&N){const x=N[i],y=N[i+1],z=N[i+2];let nx=la[0]*x+la[4]*y+la[8]*z,ny=la[1]*x+la[5]*y+la[9]*z,nz=la[2]*x+la[6]*y+la[10]*z;
    if(t){nx+=(ra[0]*x+ra[4]*y+ra[8]*z-nx)*t;ny+=(ra[1]*x+ra[5]*y+ra[9]*z-ny)*t;nz+=(ra[2]*x+ra[6]*y+ra[10]*z-nz)*t;}const inv=1/(Math.hypot(nx,ny,nz)||1);B[base+i]=nx*inv;B[base+i+1]=ny*inv;B[base+i+2]=nz*inv;
   }
  }
  position.addUpdateRange(base,P.length);position.needsUpdate=true;if(normal){normal.addUpdateRange(base,P.length);normal.needsUpdate=true;}
 }
}
const _d = new Matrix4(), _inv = new Matrix4(), _n = new Matrix3();
export function drawProp( p ) {
		_d.multiplyMatrices( p.m, _inv.copy( p.m0 ).invert() );
		_n.getNormalMatrix( _d );
		const e = _d.elements, ne = _n.elements;
		for ( const s of p.spans ) {


			const pos = s.geo.attributes.position, nrm = s.geo.attributes.normal;
			const a = s.start * 3, n = s.count * 3;
			if ( ! s.pos ) {

				s.pos = pos.array.slice( a, a + n );
				s.nrm = nrm.array.slice( a, a + n );

			}
			const P = pos.array, N = nrm.array, P0 = s.pos, N0 = s.nrm;
			for ( let k = 0; k < n; k += 3 ) {

				const x = P0[ k ], y = P0[ k + 1 ], z = P0[ k + 2 ];
				P[ a + k ] = e[ 0 ] * x + e[ 4 ] * y + e[ 8 ] * z + e[ 12 ];
				P[ a + k + 1 ] = e[ 1 ] * x + e[ 5 ] * y + e[ 9 ] * z + e[ 13 ];
				P[ a + k + 2 ] = e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z + e[ 14 ];
				const nx = N0[ k ], ny = N0[ k + 1 ], nz = N0[ k + 2 ];
				N[ a + k ] = ne[ 0 ] * nx + ne[ 3 ] * ny + ne[ 6 ] * nz;
				N[ a + k + 1 ] = ne[ 1 ] * nx + ne[ 4 ] * ny + ne[ 7 ] * nz;
				N[ a + k + 2 ] = ne[ 2 ] * nx + ne[ 5 ] * ny + ne[ 8 ] * nz;

			}
			pos.addUpdateRange( a, n );
			nrm.addUpdateRange( a, n );
			pos.needsUpdate = true;
			nrm.needsUpdate = true;
	}
}
