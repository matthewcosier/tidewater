import { MOVING_TAGS } from '../world/Colliders.js';
// Broad-phase cells reference the live island boxes/cylinders. Removed turbine
// sections and disabled disaster structures cannot leave invisible obstacles.
// Boxes that move every frame (Colliders MOVING_TAGS: cars, loose pieces of a house) keep their pooled box, so the
// count never changes and the cells are never rebuilt for them: a glider flown low over the terminal yard met a car
// only in the cell it was filed in. They stay out of the cells and are read where they are now (at most a few dozen).
export class GliderCollision{
 constructor(colliders){this.colliders=colliders;this.cells=new Map();this.moving=[];this.boxCount=-1;this.cylinderCount=-1;this.refresh();}
 refresh(){const c=this.colliders;if(c.boxes.length===this.boxCount&&c.cylinders.length===this.cylinderCount)return;this.boxCount=c.boxes.length;this.cylinderCount=c.cylinders.length;this.cells.clear();this.moving.length=0;for(const b of c.boxes)if(MOVING_TAGS.has(b.tag))this.moving.push(b);for(const shape of [...c.boxes,...c.cylinders]){if(MOVING_TAGS.has(shape.tag)&&shape.center)continue;const x=shape.center?.x??shape.x,z=shape.center?.z??shape.z,r=shape.radius;for(let ix=Math.floor((x-r)/32);ix<=Math.floor((x+r)/32);ix++)for(let iz=Math.floor((z-r)/32);iz<=Math.floor((z+r)/32);iz++){const key=ix+':'+iz,list=this.cells.get(key)||[];list.push(shape);this.cells.set(key,list);}}}
 at(x,y,z){const list=this.cells.get(Math.floor(x/32)+':'+Math.floor(z/32))||[];for(const c of list)if(this.inside(c,x,y,z))return c.tag||'island structure';for(const c of this.moving)if(this.inside(c,x,y,z))return c.tag;return null;}
 inside(c,x,y,z){if(c.disasterDisabled)return false;if(c.center){if(!c.solid||y<c.bottom||y>c.top)return false;const dx=x-c.center.x,dz=z-c.center.z;return Math.abs(dx*c.cos-dz*c.sin)<=c.half.x&&Math.abs(dx*c.sin+dz*c.cos)<=c.half.z;}return y>=c.yMin&&y<=c.yMax&&Math.hypot(x-c.x,z-c.z)<c.radius;}
}
