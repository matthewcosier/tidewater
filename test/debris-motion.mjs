import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BufferGeometry,BufferAttribute,Mesh,Vector3,Quaternion} from '../src/engine/index.js';
import {Material} from '../src/engine/render/Material.js';
import {MeshRenderer} from '../src/engine/render/MeshRenderer.js';
import * as structures from '../src/disasters/Structures.js';
import {drawnGeometry} from './helpers/drawn-pieces.mjs';

// The GPU draws a moving piece from its rest vertices and its slot's transforms (this frame's and the
// last drawn one): drawnGeometry reads where the vertex stage puts each vertex.
test('A moving batched fragment retains its previous rendered vertices for temporal reprojection',()=>{
 const vertices=new Float32Array([0,0,0,1,0,0,0,1,0]);
 const geo=new BufferGeometry().setAttribute('position',new BufferAttribute(vertices.slice(),3));
 const span=structures.saveSpan({geo,start:0,count:3}),body={origin:new Vector3(),spans:[span]};
 structures.drawSpans(body,new Vector3(3,0,0),new Quaternion());
 assert.deepEqual(drawnGeometry(geo,true),vertices,'first movement starts from the intact structure');
 const first=drawnGeometry(geo);
 assert.deepEqual(first,new Float32Array([3,0,0,4,0,0,3,1,0]),'the piece is drawn where it moved');
 structures.commitGeometryMotion();
 structures.drawSpans(body,new Vector3(7,2,0),new Quaternion());
 assert.deepEqual(drawnGeometry(geo,true),first,'second frame reprojects to the actual first frame, not the current shape');
 const mesh=new Mesh(geo,new Material());
 const layout=MeshRenderer.prototype._layout.call({},mesh,geo,mesh.material);
 assert.ok(layout.layout.some(a=>a.name==='piece'),'the real renderer must draw the pieces from their transforms');
 assert.ok(layout.buffers.length<=8&&layout.layout.length<=16);
 structures.commitGeometryMotion();
 assert.deepEqual(drawnGeometry(geo,true),drawnGeometry(geo),'a paused following frame has no continuing object velocity');
 assert.deepEqual(geo.attributes.position.array,vertices,'the batch keeps the rest vertices while the piece moves');
 structures.restoreSpans([span]);
 assert.deepEqual(drawnGeometry(geo),vertices,'Restore retains exact authored vertices');
 structures.commitGeometryMotion();
 assert.deepEqual(drawnGeometry(geo,true),vertices,'Restore also settles history for the following frame');
});

test('Late structures keep one baseline even when registration repeats after movement',()=>{
 const geo=new BufferGeometry().setAttribute('position',new BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0]),3));
 const record={name:'Summit ramp',spans:[{geo,start:0,count:3}],colliders:[{solid:true,walkable:true}]};
 const owner=Object.create(structures.StructuralDamage.prototype);owner.records=[];
 owner.addRecords([record]);geo.attributes.position.array[0]=99;owner.addRecords([record]);
 assert.equal(owner.records.length,1);
 structures.restoreSpans(record.spans);assert.equal(geo.attributes.position.array[0],0);
 assert.equal(record.initialColliders[0].solid,true);
 assert.equal(record.initialColliders[0].walkable,true);
 structures.commitGeometryMotion();
});


test('A loose prop moving in a shared material batch retains rendered vertex history', async()=>{
 const { PropPhysics }=await import('../src/physics/Props.js');
 const { Matrix4 }=await import('../src/engine/index.js');
 const original=new Float32Array([0,0,0,1,0,0,0,1,0]);
 const geo=new BufferGeometry().setAttribute('position',new BufferAttribute(original.slice(),3))
  .setAttribute('normal',new BufferAttribute(new Float32Array([0,0,1,0,0,1,0,0,1]),3));
 const prop={m0:new Matrix4(),m:new Matrix4().makeTranslation(2,0,0),spans:[{geo,start:0,count:3}]};
 PropPhysics.prototype.draw.call({},prop);
 assert.deepEqual(drawnGeometry(geo,true),original,'Loose props also need object motion rather than just camera motion');
 structures.commitGeometryMotion();const atTwo=drawnGeometry(geo);
 assert.deepEqual(atTwo,new Float32Array([2,0,0,3,0,0,2,1,0]));
 prop.m.makeTranslation(4,1,0);PropPhysics.prototype.draw.call({},prop);
 assert.deepEqual(drawnGeometry(geo,true),atTwo,'the second prop pose reprojects to its last rendered pose');
 structures.commitGeometryMotion();
});

test('Village material views inherit motion history registered through their shared position attribute',()=>{
 const position=new BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0]),3);
 const shared=new BufferGeometry().setAttribute('position',position),view=new BufferGeometry().setAttribute('position',position);
 const span=structures.saveSpan({geo:shared,start:0,count:3});
 structures.drawSpans({origin:new Vector3(),spans:[span]},new Vector3(2,0,0),new Quaternion());
 const mesh=new Mesh(view,new Material()),renderer=new MeshRenderer();
 const layout=renderer._cachedLayout(mesh,view,mesh.material);
 assert.ok(layout.layout.some(a=>a.name==='piece'),'the actual material view must draw the pieces moved on its backing batch');
 assert.equal(view.getAttribute('piece'),shared.getAttribute('piece'),'all views read one piece attribute');
 assert.deepEqual(drawnGeometry(view),drawnGeometry(shared),'every view draws the piece where it moved');
 structures.commitGeometryMotion();
});
