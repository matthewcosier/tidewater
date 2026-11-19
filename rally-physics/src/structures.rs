//! Compliant material connections between actual contact bodies.
//! Compliance is m/N and rad/(N m). Failure is evaluated after every 120 Hz step.
//! Removed elastic energy is recorded as fracture dissipation; no launch impulse.
//!
//! Breaking adds no energy (docs/disaster-damage.md, "A structure breaks without throwing its pieces").
//! A piece's collision box is the fitted box of its triangles, so the boxes of pieces that were built
//! touching overlap, by up to 4 m on the harbour pier. The solver separates overlapping boxes: with no
//! load at all the pier broke 291 of its 305 connections in a second and its sections left at 34 m/s.
//! So a piece does not collide with a thing it began inside until it has first come clear of it:
//! another piece of its own structure (`BeganInside`, refused in `filter_pairs`), or a standing box or
//! post (`InsideStanding`, its contact points dropped in `modify_contacts`). Nothing else is exempt.
use avian3d::collision::collider::contact_query;
use avian3d::parry::shape::TypedShape;
use avian3d::prelude::*;
use avian3d::dynamics::solver::islands::WakeBody;
use bevy::ecs::system::SystemParam;
use bevy::prelude::*;
use std::collections::HashSet;
use wasm_bindgen::prelude::*;
use crate::RallyPhysics;
use crate::disasters::IslandStatic;

/// Overlap (m) past which two things began inside each other. Shallower is one resting on the other, which
/// the solver holds at about 5 mm, and those collide from the first step (a sheet stays on its rafter).
pub const TOUCH: f32 = 0.01;
/// A loose piece of a structure (a jointed section, a torn-off part, a proxy) and the structure it is from.
#[derive(Component)]
pub struct Piece { structure: u32 }
/// A piece that has not been through a step: the standing shapes it is inside are not copied yet.
#[derive(Component)]
pub struct NewPiece;
/// A standing box or post, as a world pose. The standing bodies are rebuilt whenever a building changes,
/// so what a piece began inside is kept as the shape, not as the body.
pub struct Standing { shape: Collider, at: Vec3, q: Quat, half: Vec3, round: bool }
impl Standing {
    fn new(shape: Collider, at: Vec3, q: Quat) -> Option<Self> {
        let (half, round) = match shape.shape_scaled().as_typed_shape() {
            TypedShape::Cuboid(c) => (Vec3::new(c.half_extents.x, c.half_extents.y, c.half_extents.z), false),
            TypedShape::Cylinder(c) => (Vec3::new(c.radius, c.half_height, c.radius), true),
            _ => return None,
        };
        Some(Self { shape, at, q, half, round })
    }
    /// Whether a world point lies in the shape, within TOUCH.
    fn holds(&self, point: Vec3) -> bool {
        let l = self.q.inverse() * (point - self.at);
        l.y.abs() <= self.half.y + TOUCH && if self.round { l.x.hypot(l.z) <= self.half.x + TOUCH }
            else { l.x.abs() <= self.half.x + TOUCH && l.z.abs() <= self.half.z + TOUCH }
    }
}
/// The standing shapes a piece began inside and has not come clear of.
#[derive(Component, Default)]
pub struct InsideStanding(Vec<Standing>);
/// Pairs of pieces of one structure that began inside each other and have not come clear.
#[derive(Resource, Default)]
pub struct BeganInside(HashSet<(Entity, Entity)>);
fn pair(a: Entity, b: Entity) -> (Entity, Entity) { if a < b { (a, b) } else { (b, a) } }
/// How deep two shapes overlap (m); 0 when they are apart.
fn depth(a: &Collider, pa: Vec3, qa: Quat, b: &Collider, pb: Vec3, qb: Quat) -> f32 {
    contact_query::contact(a, pa, qa, b, pb, qb, 0.0).ok().flatten().map_or(0.0, |c| c.penetration.max(0.0))
}
fn intersects(a: &Collider, pa: Vec3, qa: Quat, b: &Collider, pb: Vec3, qb: Quat) -> bool {
    contact_query::intersection_test(a, pa, qa, b, pb, qb).unwrap_or(false)
}
/// Each box or post of a standing collider with its world pose (a cell of standing shapes is one compound).
fn each_standing(collider: &Collider, at: Vec3, q: Quat, f: &mut impl FnMut(Standing)) {
    match collider.shape_scaled().as_typed_shape() {
        TypedShape::Compound(c) => for (iso, shape) in c.shapes() {
            if let Some(s) = Standing::new(Collider::from(shape.clone()), at + q * Vec3::from(iso.translation), (q * Quat::from(iso.rotation)).normalize()) { f(s); }
        },
        _ => if let Some(s) = Standing::new(collider.clone(), at, q) { f(s); },
    }
}
/// Lists two pieces of one structure as begun inside each other when they overlap deeper than TOUCH.
fn began_inside(world: &mut World, a: Entity, b: Entity) {
    let of = |e| Some((world.get::<Piece>(e)?.structure, world.get::<Collider>(e)?.clone(), world.get::<Position>(e)?.0, world.get::<Rotation>(e)?.0));
    let (Some(x), Some(y)) = (of(a), of(b)) else { return; };
    if x.0 != y.0 || depth(&x.1, x.2, x.3, &y.1, y.2, y.3) <= TOUCH { return; }
    world.resource_mut::<BeganInside>().0.insert(pair(a, b));
}
/// The solver's two questions about a piece. A pair of pieces on the list makes no contact. A contact
/// point of a piece against the standing shapes is dropped while it lies in a shape the piece began inside.
#[derive(SystemParam)]
pub struct BreakupHooks<'w, 's> {
    inside: Res<'w, BeganInside>,
    standing: Query<'w, 's, &'static InsideStanding>,
    island: Query<'w, 's, (), With<IslandStatic>>,
}
impl CollisionHooks for BreakupHooks<'_, '_> {
    fn filter_pairs(&self, a: Entity, b: Entity, _: &mut Commands) -> bool { !self.inside.0.contains(&pair(a, b)) }
    fn modify_contacts(&self, contacts: &mut ContactPair, _: &mut Commands) -> bool {
        // The point of each contact on the standing shape's own surface says which standing shape it is with: the
        // midpoint does not when a rail or a post stands wholly inside a large piece (a porch rail in a wall's
        // 5 m box pushed the wall at 0.5 m/s). The normal runs from the first shape to the second.
        let (piece, side) = if self.island.contains(contacts.collider2) { (contacts.collider1, -0.5) } else if self.island.contains(contacts.collider1) { (contacts.collider2, 0.5) } else { return true; };
        let Ok(list) = self.standing.get(piece) else { return true; };
        if list.0.is_empty() { return true; }
        for manifold in &mut contacts.manifolds {
            let normal = manifold.normal;
            manifold.points.retain(|p| { let on = p.point + normal * (side * p.penetration); !list.0.iter().any(|s| s.holds(on)) });
        }
        contacts.manifolds.retain(|m| !m.points.is_empty());
        !contacts.manifolds.is_empty()
    }
}
/// A piece's first step: copy every standing box and post it is more than TOUCH inside. It runs in the step,
/// not when the piece is named, because the game rebuilds the standing shapes between the two (a house's
/// shell becomes one slab per wall on its first failure).
pub fn copy_standing_shapes(mut commands: Commands, mut fresh: Query<(Entity, &Position, &Rotation, &Collider, &mut InsideStanding), With<NewPiece>>,
    standing: Query<(&Position, &Rotation, &Collider), With<IslandStatic>>) {
    for (entity, p, q, shape, mut list) in &mut fresh {
        let reach = shape.aabb(p.0, *q);
        for (sp, sq, cell) in &standing {
            if !cell.aabb(sp.0, *sq).intersects(&reach) { continue; }
            each_standing(cell, sp.0, sq.0, &mut |s| {
                if s.shape.aabb(s.at, s.q).intersects(&reach) && depth(shape, p.0, q.0, &s.shape, s.at, s.q) > TOUCH { list.0.push(s); }
            });
        }
        commands.entity(entity).remove::<NewPiece>();
    }
}
/// Each step: a listed pair whose boxes no longer intersect leaves the list, and a copied standing shape
/// the piece no longer intersects is forgotten. One box test per entry; a pair asleep is skipped.
pub fn pieces_come_clear(mut inside: ResMut<BeganInside>, bodies: Query<(&Position, &Rotation, &Collider, Has<Sleeping>)>,
    mut standing: Query<(&Position, &Rotation, &Collider, &mut InsideStanding), Without<Sleeping>>) {
    if !inside.0.is_empty() {
        inside.0.retain(|&(a, b)| {
            let (Ok(x), Ok(y)) = (bodies.get(a), bodies.get(b)) else { return false; };
            (x.3 && y.3) || intersects(x.2, x.0.0, x.1.0, y.2, y.0.0, y.1.0)
        });
    }
    for (p, q, shape, mut list) in &mut standing {
        if list.0.is_empty() { continue; }
        list.0.retain(|s| intersects(shape, p.0, q.0, &s.shape, s.at, s.q));
    }
}

pub(crate) struct Connection {
    entity: Entity, a: Entity, b: Entity, ra: Vec3, rb: Vec3,
    qa: Quat, qb: Quat, linear: f32, angular: f32, force_limit: f32, torque_limit: f32,
    damping: f32, broken: bool, force: Vec3, torque: Vec3, extension: f32, angle: f32,
    energy: f32, numerical_energy: f32, fracture: f32, dissipated: f32, utilization: f32,
}
#[derive(Clone,Copy)]
struct Body {p:Vec3,q:Quat,v:Vec3,w:Vec3,inv_m:f32,inv_i:Mat3}
fn state(world:&World,e:Entity)->Option<Body>{
    let p=world.get::<Position>(e)?.0;let q=world.get::<Rotation>(e)?.0;
    let dynamic=world.get::<RigidBody>(e)==Some(&RigidBody::Dynamic);
    let rot=Mat3::from_quat(q);
    Some(Body{p,q,v:world.get::<LinearVelocity>(e).map_or(Vec3::ZERO,|v|v.0),w:world.get::<AngularVelocity>(e).map_or(Vec3::ZERO,|v|v.0),
        inv_m:if dynamic {world.get::<ComputedMass>(e).map_or(0.0,|m|m.inverse())}else{0.0},
        inv_i:if dynamic {world.get::<ComputedAngularInertia>(e).map_or(Mat3::ZERO,|i|rot*i.inverse()*rot.transpose())}else{Mat3::ZERO}})
}
fn apply(world:&mut World,e:Entity,body:Body,j:Vec3,angular:Vec3){
    if body.inv_m<=0.0{return;}
    if let Some(mut v)=world.get_mut::<LinearVelocity>(e){v.0+=j*body.inv_m;}
    if let Some(mut w)=world.get_mut::<AngularVelocity>(e){w.0+=body.inv_i*angular;}
}
impl RallyPhysics {
    pub(crate) fn supported_connections(&self,supported:&mut std::collections::HashSet<Entity>){
        supported.extend(self.anchors.values().copied());
        for _ in 0..self.connections.len().min(64){let n=supported.len();for c in self.connections.values(){if !c.broken{
            if supported.contains(&c.a){supported.insert(c.b);}if supported.contains(&c.b){supported.insert(c.a);}
        }}if n==supported.len(){break;}}
    }
    pub(crate) fn remove_body_connections(&mut self,e:Entity){
        let ids:Vec<u32>=self.connections.iter().filter_map(|(id,c)|(c.a==e||c.b==e).then_some(*id)).collect();
        for id in ids {self.remove_structure_joint(id);}
        // The body is going: so are the pairs it began inside (its copied standing shapes go with its components).
        self.app.world_mut().resource_mut::<BeganInside>().0.retain(|&(a,b)|a!=e&&b!=e);
    }
    pub(crate) fn update_structure_connections(&mut self,dt:f32){
        let world=self.app.world_mut();
        for c in self.connections.values_mut(){
            if c.broken{continue;}
            let (Some(a),Some(b))=(state(world,c.a),state(world,c.b)) else {continue;};
            let ra=a.q*c.ra;let rb=b.q*c.rb;
            c.extension=(a.p+ra-b.p-rb).length();
            c.angle=((a.q*c.qa).inverse()*(b.q*c.qb)).to_scaled_axis().length();
            let geometric_energy=if c.linear>0.0 {0.5*c.extension*c.extension/c.linear}else{0.0}
                +if c.angular>0.0 {0.5*c.angle*c.angle/c.angular}else{0.0};
            if let Some(f)=world.get::<JointForces>(c.entity){c.force=f.force();c.torque=f.torque();}
            // Constitutive elastic energy recovered from solved reactions. The
            // solver's finite geometric constraint residual is disclosed separately.
            c.energy=0.5*(c.linear*c.force.length_squared()+c.angular*c.torque.length_squared());
            c.numerical_energy=geometric_energy-c.energy;
            c.utilization=c.force.length()/c.force_limit+c.torque.length()/c.torque_limit;
            if c.utilization>1.0 {
                c.broken=true;c.fracture+=c.energy;c.energy=0.0;
                // Removing the constraint enables ordinary contact between its former bodies, except
                // while they are still inside each other: a pair that came clear while joined and has
                // flexed back is listed again here.
                world.entity_mut(c.entity).remove::<(FixedJoint,JointCollisionDisabled)>();
                began_inside(world,c.a,c.b);
                world.commands().queue(WakeBody(c.a));world.commands().queue(WakeBody(c.b));
                continue;
            }
            // Physical, equal/opposite velocity relaxation at the actual anchor.
            // Inverse effective mass includes both angular inertias. This impulse
            // cannot increase pair kinetic energy; rate is an assumed s^-1 loss.
            let fraction=1.0-(-c.damping*dt).exp();
            let relative=(b.v+b.w.cross(rb))-(a.v+a.w.cross(ra));let speed=relative.length();
            if speed>1e-7 && fraction>0.0 {
                let n=relative/speed;let ca=ra.cross(n);let cb=rb.cross(n);
                let inv=a.inv_m+b.inv_m+ca.dot(a.inv_i*ca)+cb.dot(b.inv_i*cb);
                if inv>1e-12 {let mag=speed*fraction/inv;let j=n*mag;
                    apply(world,c.a,a,j,ra.cross(j));apply(world,c.b,b,-j,-rb.cross(j));
                    c.dissipated+=mag*speed-0.5*mag*mag*inv;
                }
            }
            let (Some(a),Some(b))=(state(world,c.a),state(world,c.b)) else {continue;};
            let relative=b.w-a.w;let speed=relative.length();
            if speed>1e-7 && fraction>0.0 {let n=relative/speed;let inv=n.dot((a.inv_i+b.inv_i)*n);
                if inv>1e-12 {let mag=speed*fraction/inv;let j=n*mag;
                    apply(world,c.a,a,Vec3::ZERO,j);apply(world,c.b,b,Vec3::ZERO,-j);
                    c.dissipated+=mag*speed-0.5*mag*mag*inv;
                }
            }
        }
        world.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sim()->RallyPhysics{let mut s=RallyPhysics::new();s.app.insert_resource(Gravity(Vec3::ZERO));s.reset(150.0,150.0,150.0,0.0);s}
    fn body(s:&mut RallyPhysics,id:u32,x:f32,half:&[f32],mass:f32){assert!(s.wake_prop(id,0,half,&[x,0.0,0.0,0.0,0.0,0.0,1.0],mass,0.0,0.0,false));}
    fn step(s:&mut RallyPhysics,n:usize){for _ in 0..n{s.advance(1.0/120.0,0.0,0.0,0.0,0.0);}}
    fn joint(s:&RallyPhysics,id:u32)->Vec<f32>{s.structure_joint_states().chunks_exact(15).find(|v|v[0]==id as f32).unwrap().to_vec()}
    #[test]
    fn structural_axial_compliance_and_elastic_work(){
        let mut s=sim();body(&mut s,1,0.0,&[0.1,0.1,0.1],2.0);
        assert!(s.add_structure_anchor(90,&[0.0,0.0,0.0,0.0,0.0,0.0,1.0]));
        assert!(s.add_structure_joint(10,90,1,&[0.0,0.0,0.0],&[0.001,0.000001,1000.0,1000.0,20.0]));
        s.set_disaster_loads(&[1.0,100.0,0.0,0.0,0.0,0.0,0.0]);step(&mut s,1200);
        let j=joint(&s,10);assert!((j[8]-0.1).abs()<0.003,"extension {:?}",j);
        assert!((j[10]-5.0).abs()<0.3,"spring work {:?}",j);
        assert!((Vec3::new(j[2],j[3],j[4]).length()-100.0).abs()<3.0,"reaction {:?}",j);
        assert!(s.disaster_supported().contains(&1.0));
    }
    #[test]
    fn structural_two_link_cantilever_matches_small_angle_beam(){
        let mut s=sim();body(&mut s,1,0.5,&[0.5,0.05,0.05],1.0);body(&mut s,2,1.5,&[0.5,0.05,0.05],1.0);
        s.add_structure_anchor(90,&[0.0,0.0,0.0,0.0,0.0,0.0,1.0]);
        // L=2m, EI=1000 N m², tip P=10N: delta=.02666667m, theta=.02rad.
        s.add_structure_joint(10,90,1,&[0.0,0.0,0.0],&[1e-8,2.0/6000.0,1e6,1e6,12.0]);
        s.add_structure_joint(11,1,2,&[1.0,0.0,0.0],&[1e-8,4.0/3000.0,1e6,1e6,12.0]);
        s.set_disaster_loads(&[2.0,0.0,10.0,0.0,0.0,0.0,5.0]);step(&mut s,2400);
        let b=state(s.app.world(),s.props[&2]).unwrap();let tip=b.p+b.q*Vec3::X*0.5;
        eprintln!("beam tip {:?} q {:?} root {:?} mid {:?}",tip,b.q,joint(&s,10),joint(&s,11));
        assert!((tip.y-0.026666667).abs()<0.0013,"tip {:?}",tip);
        assert!((b.q.to_scaled_axis().z-0.02).abs()<0.001,"rotation {:?}",b.q);
        let root=joint(&s,10);let mid=joint(&s,11);assert!((root[10]+mid[10]-0.5*10.0*0.026666667).abs()<0.008,"constitutive work root {:?} mid {:?}",root,mid);assert!((root[7].abs()-20.0).abs()<1.0,"root moment {:?}",root);
    }
    #[test]
    fn structural_selective_failure_records_strain_without_launch(){
        let mut s=sim();body(&mut s,1,0.0,&[0.1,0.1,0.1],2.0);body(&mut s,2,1.0,&[0.1,0.1,0.1],2.0);
        s.add_structure_anchor(90,&[0.0,0.0,0.0,0.0,0.0,0.0,1.0]);
        s.add_structure_joint(10,90,1,&[0.0,0.0,0.0],&[0.0001,0.001,10000.0,10000.0,3.0]);
        s.add_structure_joint(11,1,2,&[0.5,0.0,0.0],&[0.001,0.001,30.0,10000.0,3.0]);
        s.set_disaster_loads(&[2.0,100.0,0.0,0.0,0.0,0.0,0.0]);
        for _ in 0..240{step(&mut s,1);if joint(&s,11)[1]>0.0{break;}}
        let j=joint(&s,11);assert_eq!(j[1],1.0);assert!(j[11]>0.0);assert_eq!(j[10],0.0);assert_eq!(joint(&s,10)[1],0.0);
        let before=s.disaster_motion();s.update_structure_connections(1.0/120.0);let after=s.disaster_motion();
        let a=before.chunks_exact(7).find(|x|x[0]==2.0).unwrap();let b=after.chunks_exact(7).find(|x|x[0]==2.0).unwrap();assert_eq!(a,b,"broken connection adds no impulse");
        s.sleep_prop(2);assert!(s.structure_joint_states().chunks_exact(15).all(|x|x[0]!=11.0));s.sleep_prop(1);s.remove_structure_anchor(90);assert!(s.structure_joint_states().is_empty());
    }
    // Two 1 m cubes of 20 kg, the second 0.4 m into the first along x: the fitted boxes of two members built touching.
    fn overlapping(s:&mut RallyPhysics,structures:[u32;2]){body(s,1,0.0,&[0.5,0.5,0.5],20.0);body(s,2,0.6,&[0.5,0.5,0.5],20.0);assert!(s.set_structure_piece(1,structures[0])&&s.set_structure_piece(2,structures[1]));}
    fn motion(s:&RallyPhysics,id:u32)->Vec<f32>{s.disaster_motion().chunks_exact(7).find(|v|v[0]==id as f32).unwrap().to_vec()}
    fn speed(s:&RallyPhysics,id:u32)->f32{let v=motion(s,id);Vec3::new(v[4],v[5],v[6]).length()}
    fn x(s:&RallyPhysics,id:u32)->f32{motion(s,id)[1]}
    fn fastest(s:&mut RallyPhysics,steps:usize,ids:&[u32])->f32{let mut top=0f32;for _ in 0..steps{step(s,1);for id in ids{top=top.max(speed(s,*id));}}top}
    #[test]
    fn a_connection_that_breaks_between_overlapping_pieces_adds_no_speed(){
        let mut s=sim();overlapping(&mut s,[7,7]);
        s.add_structure_anchor(90,&[0.0,0.0,0.0,0.0,0.0,0.0,1.0]);
        assert!(s.add_structure_joint(10,90,1,&[0.0,0.0,0.0],&[1e-6,1e-5,1e6,1e6,5.0]));
        assert!(s.add_structure_joint(11,1,2,&[0.3,0.0,0.0],&[1e-6,1e-5,0.5,1e6,5.0]));
        let joined=fastest(&mut s,60,&[1,2]);assert!(joined<1e-3,"joined and unloaded, a piece moved at {joined} m/s");
        // 1 N on 20 kg until the 0.5 N connection breaks: under half a millimetre a second gained each step.
        s.set_disaster_loads(&[2.0,0.0,1.0,0.0,0.0,0.0,0.0]);
        let mut steps=0;while joint(&s,11)[1]==0.0{step(&mut s,1);steps+=1;assert!(steps<240,"the 0.5 N connection held 1 N for 2 s");}
        s.set_disaster_loads(&[]);let at_break=speed(&s,2);
        let after=fastest(&mut s,240,&[1,2]);
        assert!(after<at_break+0.02,"after the connection broke between two pieces 0.4 m inside each other, with no load, a piece reached {after:.3} m/s (it had {at_break:.3} m/s at the break)");
    }
    #[test]
    fn overlapping_pieces_stay_at_rest_when_their_connection_goes_and_collide_once_they_have_come_clear(){
        let mut s=sim();overlapping(&mut s,[7,7]);assert!(s.add_structure_joint(11,1,2,&[0.3,0.0,0.0],&[1e-6,1e-5,1e6,1e6,5.0]));
        step(&mut s,30);assert!(s.remove_structure_joint(11));
        let after=fastest(&mut s,240,&[1,2]);
        assert!(after<0.01,"with their connection removed and no load, two pieces 0.4 m inside each other reached {after:.3} m/s");
        assert_eq!(s.structure_overlaps(),vec![1,0],"the pair is listed while the pieces are inside each other");
        // Pulled clear, then pushed back: the second piece now stops against the first.
        s.set_disaster_loads(&[2.0,40.0,0.0,0.0,0.0,0.0,0.0]);while x(&s,2)<1.3{step(&mut s,1);}
        assert_eq!(s.structure_overlaps(),vec![0,0],"a pair that has come clear leaves the list");
        s.set_disaster_loads(&[2.0,-40.0,0.0,0.0,0.0,0.0,0.0]);step(&mut s,480);
        let into=1.0-(x(&s,2)-x(&s,1));assert!(into<0.02,"pushed back after coming clear, the second piece went {into:.3} m into the first");
        s.sleep_prop(2);assert_eq!(s.structure_overlaps(),vec![0,0]);
    }
    #[test]
    fn a_piece_inside_a_standing_box_is_not_pushed_out_and_stops_against_it_once_clear(){
        // Two standing boxes in one cell (one compound, as on the island); the piece begins 0.3 m inside the first.
        let mut s=sim();s.add_surface_boxes(&[0.0,0.0,0.0,1.0,0.5,1.0,0.0,0.6, 0.0,0.0,6.0,1.0,0.5,1.0,0.0,0.6],&[5,5]);
        body(&mut s,1,1.2,&[0.5,0.5,0.5],20.0);assert!(s.set_structure_piece(1,7));
        let after=fastest(&mut s,240,&[1]);
        assert!(after<0.01,"with no load, a piece that began 0.3 m inside a standing box reached {after:.3} m/s");
        assert_eq!(s.structure_overlaps(),vec![0,1],"the standing box is copied to the piece");
        s.clear_island_statics();s.add_surface_boxes(&[0.0,0.0,0.0,1.0,0.5,1.0,0.0,0.6, 0.0,0.0,6.0,1.0,0.5,1.0,0.0,0.6],&[5,5]);
        let rebuilt=fastest(&mut s,120,&[1]);assert!(rebuilt<0.01,"after the standing shapes were rebuilt the piece reached {rebuilt:.3} m/s");
        s.set_disaster_loads(&[1.0,40.0,0.0,0.0,0.0,0.0,0.0]);while x(&s,1)<1.8{step(&mut s,1);}
        assert_eq!(s.structure_overlaps(),vec![0,0],"a standing box the piece has left is forgotten");
        s.set_disaster_loads(&[1.0,-40.0,0.0,0.0,0.0,0.0,0.0]);step(&mut s,480);
        let into=1.0-(x(&s,1)-0.5);assert!(into<0.02,"pushed back after coming clear, the piece went {into:.3} m into the standing box");
    }
    #[test]
    fn a_rail_and_a_post_standing_inside_a_large_piece_do_not_push_it(){
        // A porch rail (a 12 cm slab) and a post, both wholly inside a 2 m piece, as a wall's fitted box holds them.
        let mut s=sim();s.add_surface_boxes(&[0.2,0.1,0.3,0.06,0.55,0.7,0.05,0.6, 0.0,0.0,9.0,1.0,0.5,1.0,0.0,0.6],&[5,5]);s.add_cylinders(&[-0.4,-0.3,0.14,-0.8,0.9]);
        body(&mut s,1,0.0,&[1.0,1.0,1.0],450.0);assert!(s.set_structure_piece(1,7));
        let after=fastest(&mut s,240,&[1]);
        assert!(after<0.01,"with no load, a piece that began around a standing rail and a post reached {after:.3} m/s");
        assert_eq!(s.structure_overlaps(),vec![0,2],"the rail and the post are copied to the piece");
    }
    #[test]
    fn pieces_of_different_structures_and_pieces_that_only_touch_collide_from_the_first_step(){
        let mut s=sim();overlapping(&mut s,[7,8]);step(&mut s,240);
        let into=1.0-(x(&s,2)-x(&s,1));assert!(into<TOUCH,"two pieces of different structures stayed {into:.3} m inside each other");
        assert_eq!(s.structure_overlaps(),vec![0,0]);
        // One structure, 5 mm into each other: a resting contact, not an overlap. Pushed together they hold.
        let mut s=sim();body(&mut s,1,0.0,&[0.5,0.5,0.5],20.0);body(&mut s,2,0.995,&[0.5,0.5,0.5],20.0);assert!(s.set_structure_piece(1,7)&&s.set_structure_piece(2,7));
        assert_eq!(s.structure_overlaps(),vec![0,0]);
        let parted=fastest(&mut s,120,&[1,2]);assert!(parted<0.1,"two pieces 5 mm into each other parted at {parted:.3} m/s");
        s.set_disaster_loads(&[2.0,-40.0,0.0,0.0,0.0,0.0,0.0]);step(&mut s,240);
        let into=1.0-(x(&s,2)-x(&s,1));assert!(into<0.02,"pushed together, two touching pieces of one structure went {into:.3} m into each other");
    }
}
#[wasm_bindgen]
impl RallyPhysics {
    /// Static connection frame without a duplicate collider. IDs share prop namespace.
    pub fn add_structure_anchor(&mut self,id:u32,pose:&[f32])->bool{
        if pose.len()!=7||pose.iter().any(|v|!v.is_finite())||self.props.contains_key(&id)||self.anchors.contains_key(&id){return false;}
        let q=Quat::from_xyzw(pose[3],pose[4],pose[5],pose[6]);if q.length_squared()<0.5{return false;}
        let p=Vec3::new(pose[0],pose[1],pose[2]);let q=q.normalize();
        let e=self.app.world_mut().spawn((RigidBody::Static,Position(p),Rotation(q),Transform::from_translation(p).with_rotation(q))).id();
        self.anchors.insert(id,e);true
    }
    pub fn remove_structure_anchor(&mut self,id:u32)->bool{
        let Some(e)=self.anchors.remove(&id)else{return false;};self.remove_body_connections(e);self.app.world_mut().despawn(e);true
    }
    /// Connection parameters: point compliance m/N, angular compliance rad/(N m),
    /// force capacity N, moment capacity N m, dissipative relaxation rate s^-1.
    pub fn add_structure_joint(&mut self,id:u32,a:u32,b:u32,anchor:&[f32],parameters:&[f32])->bool{
        if self.connections.len()>=512||self.connections.contains_key(&id)||anchor.len()!=3||parameters.len()!=5||anchor.iter().chain(parameters).any(|v|!v.is_finite())
            ||parameters[0]<0.0||parameters[1]<0.0||parameters[2]<=0.0||parameters[3]<=0.0||parameters[4]<0.0||parameters[4]>120.0{return false;}
        let lookup=|id|self.props.get(&id).or_else(||self.anchors.get(&id)).copied();
        let (Some(a),Some(b))=(lookup(a),lookup(b))else{return false;};if a==b{return false;}
        let w=self.app.world();let (Some(sa),Some(sb))=(state(w,a),state(w,b))else{return false;};
        let p=Vec3::new(anchor[0],anchor[1],anchor[2]);let ra=sa.q.inverse()*(p-sa.p);let rb=sb.q.inverse()*(p-sb.p);
        let qa=sa.q.inverse();let qb=sb.q.inverse();
        let joint=FixedJoint::new(a,b).with_local_anchor1(ra).with_local_anchor2(rb).with_local_basis1(qa).with_local_basis2(qb)
            .with_point_compliance(parameters[0]).with_angle_compliance(parameters[1]);
        let entity=self.app.world_mut().spawn((joint,JointForces::new(),JointCollisionDisabled)).id();
        self.connections.insert(id,Connection{entity,a,b,ra,rb,qa,qb,linear:parameters[0],angular:parameters[1],force_limit:parameters[2],torque_limit:parameters[3],damping:parameters[4],broken:false,force:Vec3::ZERO,torque:Vec3::ZERO,extension:0.0,angle:0.0,energy:0.0,numerical_energy:0.0,fracture:0.0,dissipated:0.0,utilization:0.0});true
    }
    pub fn remove_structure_joint(&mut self,id:u32)->bool{
        let Some(c)=self.connections.remove(&id)else{return false;};let world=self.app.world_mut();world.despawn(c.entity);began_inside(world,c.a,c.b);true
    }
    /// Name an awake loose body as a piece of structure `structure`, before its first step. From then on
    /// it does not collide with another piece of that structure it is more than TOUCH inside now, nor with
    /// a standing box or post it is inside on its first step, until it has come clear of each.
    pub fn set_structure_piece(&mut self,id:u32,structure:u32)->bool{
        let Some(&e)=self.props.get(&id)else{return false;};let world=self.app.world_mut();
        if world.get::<RigidBody>(e)!=Some(&RigidBody::Dynamic){return false;}
        let others:Vec<Entity>=world.query::<(Entity,&Piece)>().iter(world).filter(|(o,p)|*o!=e&&p.structure==structure).map(|(o,_)|o).collect();
        world.entity_mut(e).insert((Piece{structure},NewPiece,InsideStanding::default(),ActiveCollisionHooks::FILTER_PAIRS|ActiveCollisionHooks::MODIFY_CONTACTS));
        for o in others{began_inside(world,e,o);}
        true
    }
    /// Pairs of pieces, and standing shapes copied to pieces, that have not come clear yet: the work the
    /// solver does for this rule each step.
    pub fn structure_overlaps(&self)->Vec<u32>{
        let world=self.app.world();let pairs=world.resource::<BeganInside>().0.len() as u32;
        let mut shapes=0u32;for id in self.props.values(){if let Some(list)=world.get::<InsideStanding>(*id){shapes+=list.0.len() as u32;}}
        vec![pairs,shapes]
    }
    /// Fifteen values: id, broken, force3 N, moment3 Nm, extension m, angle rad,
    /// elastic energy J, fracture loss J, utilization, viscous loss J, geometric-minus-constitutive energy residual J.
    pub fn structure_joint_states(&self)->Vec<f32>{
        let mut out=Vec::with_capacity(self.connections.len()*15);
        for (id,c)in &self.connections{out.extend_from_slice(&[*id as f32,if c.broken{1.0}else{0.0},c.force.x,c.force.y,c.force.z,c.torque.x,c.torque.y,c.torque.z,c.extension,c.angle,c.energy,c.fracture,c.utilization,c.dissipated,c.numerical_energy]);}out
    }
}
