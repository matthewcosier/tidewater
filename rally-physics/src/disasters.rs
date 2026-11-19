//! External environmental loads on disaster bodies. The loads that are not stiff (buoyancy, a crushed
//! crown, ground shaking) arrive as a bounded force held over the frame and are applied by Avian at
//! every 120 Hz force step. Fluid drag is stiff, so it is integrated here, every substep (`fluid_drag`).
use avian3d::prelude::*;
use avian3d::dynamics::solver::islands::WakeBody;
use avian3d::dynamics::solver::solver_body::SolverBody;
use bevy::prelude::*;
use bevy::math::{DMat3, DVec3};
use wasm_bindgen::prelude::*;
use crate::RallyPhysics;

#[derive(Component)]
pub struct IslandStatic;
#[derive(Component)]
pub struct DisasterLoad;

/// One load point of a body in a fluid: where it is on the body, how hard the fluid grips it there and
/// how the fluid moves there. The force it stands for is (quadratic |u - v| + linear) (u - v), with v the
/// body's velocity at the point.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct DragPoint {
    /// Metres from the body origin, in the body's own axes.
    pub local: Vec3,
    /// rho Cd A / 2 for the share of the point in this fluid, kg/m.
    pub quadratic: f32,
    /// Linear damping against the same velocity difference, kg/s (a crushed crown dragging on the ground).
    pub linear: f32,
    /// Velocity of the fluid at the point, m/s, world axes.
    pub fluid: Vec3,
}
/// The load points of one body for this frame (`set_disaster_drag`) and what it touches this step
/// (`drag_contacts`): for each thing it touches or is about to, the direction from the body into it
/// (world axes), the friction coefficient of the contact, the gap to it (m) when the list was made and
/// how many steps ago the solver last reported it, with where the body was when the list was made.
#[derive(Component, Default)]
pub struct FluidDrag {
    pub points: Vec<DragPoint>,
    contacts: Vec<(Vec3, f32, f32, u8)>,
    listed_at: Vec3,
}
/// Steps a contact stays on a body's list after the solver last reported it, while the body has not
/// moved away from it (1/4 s). The solver reports no contact for a body at rest a hair off a wall, so a
/// pot the flow held there was off the list on the next step and the flow drove it 12 cm into the wall
/// in that one step. On its last step a kept contact no longer counts for the share of drag that goes in
/// before collision detection: if the thing is still there the solver then sees the body coming and
/// reports it again, and if it has gone (a body that moved on) the fluid has the body back.
const CONTACT_KEPT: u8 = 30;
/// How many of this step's substeps have had their drag (`fluid_drag_before_step`, `fluid_drag`).
#[derive(Resource, Default)]
pub struct DragSubstep(u32);
/// A contact counts as touching within this gap, m (the solver keeps a 5 mm skin).
const TOUCHING: f32 = 0.01;
/// Floats per drag record: id, local xyz, quadratic, linear, fluid xyz.
pub const DRAG_RECORD: usize = 9;
/// 512 loaded bodies of up to 24 points each (a tree has nine points in two fluids).
const MAX_DRAG_RECORDS: usize = 512 * 24;

/// Fluid drag as an implicit relaxation of the body's velocity at each load point toward the fluid's:
/// (M + h sum(k B'B)) delta = h sum(k B'(u - B twist)), k = quadratic |u - B twist| + linear, where B maps
/// the body's linear and angular velocity to the point and M is its mass and rotated inertia. For one
/// point at the centre of mass this is the exact solution of quadratic drag over the substep,
/// v / (1 + c |v| h), so the rate does not depend on the step. A relaxation cannot overshoot: a point's
/// velocity changes by no more than its speed relative to the fluid however light the body, and with the
/// fluid still the kinetic energy only falls ((I + h S)^-1 with S positive semi-definite shrinks every
/// vector). It needs no bound on the acceleration.
///
/// A fluid cannot push a body into something it already touches: the reaction there carries that part of
/// the load, and its friction holds the body against the rest of the push up to the friction coefficient
/// times that part (a crate pressed square on a wall stays; one the flow meets at a glancing angle slides
/// along it). So at each load point, along each direction into something the body touches
/// (`drag_contacts` lists them each step), the fluid can stop the point leaving and cannot drive it in,
/// and the rest of the push acts only by what exceeds that friction. In still fluid this changes
/// nothing: the relaxation is the free one. Left to the contact solver the push was not carried: its
/// contacts are springs scaled to the body's mass, solved once per pass, and of two 10 kg crates pressed
/// on a wall by a 30 m/s flow (46 000 m/s² on a free crate) one was squeezed out and carried 47 m in
/// 10 s. Three smaller rules failed the same test, the crate going over the wall each time: cancelling
/// the change of velocity at the contact points (four passes of impulses) left a turn over every
/// substep; taking out the push along the contact direction alone let the crate behind ride up a contact
/// tilted 6 degrees; and with friction but nothing to stop a point leaving, a crate the solver pushed
/// back out of an overlap drifted 1 cm off the wall and was thrown at it again at 27 m/s.
///
/// A step's drag is eight substeps' worth. The first is applied before the step's collision detection
/// (`fluid_drag_before_step`), so the speed the fluid gives a body is known when contacts are predicted:
/// a crate at rest 5 cm from a wall, met by the flow inside one step, otherwise went 13 cm into the wall
/// before any contact existed. The other seven run in the substeps, after the positions are integrated
/// and before the relax solve, the rigid pass, which removes what goes into a contact before any
/// position moves on it.
///
/// Sent as a force held over the frame (the mechanism this replaces), drag had to be bounded to 45 m/s²,
/// where water at 11 m/s puts 870 m/s² on a 26 kg crate: the water could not hold a body a contact threw.
pub fn fluid_drag(
    mut bodies: Query<(&mut SolverBody, &FluidDrag, &Rotation, &ComputedMass, &ComputedAngularInertia, &ComputedCenterOfMass), Without<Sleeping>>,
    time: Res<Time>, substeps: Res<SubstepCount>, mut done: ResMut<DragSubstep>,
) {
    // The step's first share went in before collision detection, so the last substep has none.
    done.0 += 1;
    if done.0 >= substeps.0 { return; }
    let h = time.delta_secs_f64();
    for (mut body, drag, rotation, mass, inertia, centre) in &mut bodies {
        let m = mass.value() as f64;
        if drag.points.is_empty() || !(m > 0.0 && m.is_finite()) { continue; }
        let q = body.delta_rotation.0 * rotation.0;
        let world_inertia = world_inertia(inertia, q);
        if let Some((dv, dw)) = relax_toward_fluid(&drag.points, &drag.contacts, u8::MAX, body.delta_position, q, centre.0, m, world_inertia, body.linear_velocity, body.angular_velocity, h) {
            body.linear_velocity += dv;
            body.angular_velocity += dw;
        }
    }
}
/// The first substep's share of a step's drag, before the step's collision detection (`fluid_drag`).
pub fn fluid_drag_before_step(
    mut bodies: Query<(&mut LinearVelocity, &mut AngularVelocity, &FluidDrag, &Position, &Rotation, &ComputedMass, &ComputedAngularInertia, &ComputedCenterOfMass), (With<RigidBody>, Without<Sleeping>)>,
    time: Res<Time>, substeps: Res<SubstepCount>, mut done: ResMut<DragSubstep>,
) {
    done.0 = 0;
    let h = time.delta_secs_f64() / substeps.0.max(1) as f64;
    for (mut v, mut w, drag, position, rotation, mass, inertia, centre) in &mut bodies {
        let m = mass.value() as f64;
        if drag.points.is_empty() || !(m > 0.0 && m.is_finite()) { continue; }
        let world_inertia = world_inertia(inertia, rotation.0);
        // The contacts are the last step's: the gaps are brought up to date by how far the body has moved since.
        if let Some((dv, dw)) = relax_toward_fluid(&drag.points, &drag.contacts, CONTACT_KEPT - 1, position.0 - drag.listed_at, rotation.0, centre.0, m, world_inertia, v.0, w.0, h) {
            v.0 += dv;
            w.0 += dw;
        }
    }
}
/// What each loaded body touches or is about to this step, for `fluid_drag`: per contact, the direction
/// from the body into the other side, the contact's friction and its gap (m, the closest point; the
/// solver lists contacts it expects within the step as well as those that touch). Each direction once,
/// with its smallest gap (a body lying on several triangles of the ground touches one thing). The
/// narrow phase runs once per step, so the list holds for all its substeps and for the share of the
/// next step's drag that goes in before its collision detection; a gap is brought up to date by how far
/// the body has moved toward it since. Without that a pot that reached a wall inside one step was not
/// touching it on the list, took the next step's first share at full strength and went 12 cm into the wall.
pub fn drag_contacts(mut bodies: Query<(&mut FluidDrag, &Position), Without<Sleeping>>, graph: Res<ContactGraph>) {
    for (mut drag, position) in &mut bodies {
        // Bring the kept contacts up to date by how far the body has moved; drop the old and the left behind.
        let moved = position.0 - drag.listed_at;
        for contact in &mut drag.contacts { contact.2 -= moved.dot(contact.0); contact.3 += 1; }
        drag.contacts.retain(|c| c.3 <= CONTACT_KEPT && c.2 <= TOUCHING);
        drag.listed_at = position.0;
    }
    for pair in graph.active_pairs() {
        if !pair.generates_constraints() { continue; }
        for (body, sign) in [(pair.body1, 1.0f32), (pair.body2, -1.0)] {
            let Some(Ok((mut drag, _))) = body.map(|e| bodies.get_mut(e)) else { continue; };
            for manifold in &pair.manifolds {
                let Some(gap) = manifold.points.iter().map(|p| -p.penetration).reduce(f32::min) else { continue; };
                let into = manifold.normal * sign;
                match drag.contacts.iter_mut().find(|c| c.0.dot(into) > 0.95) {
                    Some(listed) => { if listed.3 > 0 || gap < listed.2 { *listed = (into, manifold.friction, gap, 0); } }
                    None => drag.contacts.push((into, manifold.friction, gap, 0)),
                }
            }
        }
    }
}
/// The body's angular inertia in world axes, kg m².
pub fn world_inertia(inertia: &ComputedAngularInertia, q: Quat) -> Mat3 {
    let t = inertia.tensor();
    let local = Mat3::from_cols(Vec3::new(t.m00, t.m01, t.m02), Vec3::new(t.m01, t.m11, t.m12), Vec3::new(t.m02, t.m12, t.m22));
    let r = Mat3::from_quat(q);
    r * local * r.transpose()
}
/// The change of linear and angular velocity one implicit drag step of `h` seconds gives a body
/// (`fluid_drag`). `contacts` are the directions from the body into what is near it with the friction, the
/// gap when listed and the steps since the solver reported it (those past `oldest` do not count), `moved`
/// how far the body has moved since the list was made (m). None when no point is loaded or the result is
/// not finite.
#[allow(clippy::too_many_arguments)]
fn relax_toward_fluid(points: &[DragPoint], contacts: &[(Vec3, f32, f32, u8)], oldest: u8, moved: Vec3, q: Quat, centre: Vec3, mass: f64, inertia: Mat3, v: Vec3, w: Vec3, h: f64) -> Option<(Vec3, Vec3)> {
    let mut a = [[0.0f64; 6]; 6];
    let mut b = [0.0f64; 6];
    let turns = inertia.is_finite() && inertia.x_axis.x + inertia.y_axis.y + inertia.z_axis.z > 0.0;
    for i in 0..3 {
        a[i][i] = mass;
        // A body that cannot turn (no finite inertia) takes the drag on its centre of mass only.
        for j in 0..3 { a[i + 3][j + 3] = if turns { inertia.col(j)[i] as f64 } else if i == j { 1.0 } else { 0.0 }; }
    }
    let mut loaded = false;
    for p in points {
        let r = if turns { (q * (p.local - centre)).as_dvec3() } else { DVec3::ZERO };
        let (fluid, at) = (p.fluid.as_dvec3(), v.as_dvec3() + w.as_dvec3().cross(r));
        let relative = fluid - at;
        let k = (p.quadratic as f64 * relative.length() + p.linear as f64) * h;
        if !(k > 0.0) { continue; }
        loaded = true;
        // The force on the point is k (grip (u - v) + hold): `grip` says which part of the velocity
        // difference the fluid may act on, `hold` is the part with a target other than the fluid's.
        let (mut grip, mut hold) = (DMat3::IDENTITY, DVec3::ZERO);
        // The directions into what the body touches that the fluid pushes this point toward, as
        // orthonormal directions. One within about 17 degrees of the others adds nothing (two faces of
        // rough ground are one support).
        let mut carried = [DVec3::ZERO; 3];
        let (mut count, mut friction) = (0, 0.0f64);
        for (into, mu, gap, age) in contacts {
            if *age > oldest || gap - moved.dot(*into) > TOUCHING { continue; }
            let into = into.as_dvec3();
            if relative.dot(into) <= 0.0 { continue; }
            friction = friction.max(*mu as f64);
            let mut rest = into;
            for c in &carried[..count] { rest -= *c * c.dot(rest); }
            if rest.length() < 0.3 { continue; }
            carried[count] = rest.normalize();
            count += 1;
            if count == 3 { break; }
        }
        if count > 0 {
            let mut free = DMat3::IDENTITY;
            let mut pressed = 0.0f64;
            grip = DMat3::ZERO;
            for c in &carried[..count] {
                let across = DMat3::from_cols(*c * c.x, *c * c.y, *c * c.z);
                free -= across;
                let (toward, speed) = (relative.dot(*c), at.dot(*c));
                if toward <= 0.0 { grip += across; continue; }
                // Along a carried direction the fluid can stop the point leaving (its speed relaxes to
                // the fluid's, or to rest if the fluid is going in) and cannot drive it in.
                let target = fluid.dot(*c).min(speed.max(0.0));
                if speed < 0.0 { grip += across; hold += *c * (target - fluid.dot(*c)); }
                pressed += (toward - (target - speed)).powi(2);
            }
            // Coulomb friction on what the contacts carry holds the point against the rest of the push.
            let along = free * relative;
            let pressed = pressed.sqrt();
            let slip = if along.length() > friction * pressed { 1.0 - friction * pressed / along.length() } else { 0.0 };
            grip += free * slip;
        }
        // The point's velocity is v + w x r = B twist with B = [1, lever], lever = -[r]x, so the matrix
        // gains k B' grip B and the right side k B' (grip (u - B twist) + hold).
        let lever = DMat3::from_cols(DVec3::new(0.0, -r.z, r.y), DVec3::new(r.z, 0.0, -r.x), DVec3::new(-r.y, r.x, 0.0));
        let grip_lever = grip * lever;
        let turning = lever.transpose() * grip_lever;
        let push = grip * relative + hold;
        let moment = r.cross(push);
        for i in 0..3 {
            for j in 0..3 {
                a[i][j] += k * grip.col(j)[i];
                a[i][j + 3] += k * grip_lever.col(j)[i];
                a[i + 3][j + 3] += k * turning.col(j)[i];
            }
            b[i] += k * push[i];
            b[i + 3] += k * moment[i];
        }
    }
    if !loaded { return None; }
    for i in 0..6 { for j in 0..i { a[i][j] = a[j][i]; } }
    // Cholesky: the matrix is the mass matrix plus a positive semi-definite sum.
    let mut l = [[0.0f64; 6]; 6];
    for i in 0..6 { for j in 0..=i {
        let mut s = a[i][j];
        for k in 0..j { s -= l[i][k] * l[j][k]; }
        l[i][j] = if i == j { s.max(1e-18).sqrt() } else { s / l[j][j] };
    } }
    let mut y = [0.0f64; 6];
    for i in 0..6 { let mut s = b[i]; for j in 0..i { s -= l[i][j] * y[j]; } y[i] = s / l[i][i]; }
    let mut x = [0.0f64; 6];
    for i in (0..6).rev() { let mut s = y[i]; for j in i + 1..6 { s -= l[j][i] * x[j]; } x[i] = s / l[i][i]; }
    if x.iter().any(|d| !d.is_finite()) { return None; }
    Some((Vec3::new(x[0] as f32, x[1] as f32, x[2] as f32), Vec3::new(x[3] as f32, x[4] as f32, x[5] as f32)))
}

#[wasm_bindgen]
impl RallyPhysics {
    /// Records: id (-1 = local car), force xyz in N, torque xyz in Nm. Replaces previous
    /// loads, so stop cannot leave a stale force. Bad batches are rejected atomically.
    pub fn set_disaster_loads(&mut self, data: &[f32]) -> bool {
        if data.len() % 7 != 0 || data.len() > 512 * 7 || data.iter().any(|v| !v.is_finite()) { return false; }
        let world = self.app.world_mut();
        let previous: Vec<Entity> = world.query_filtered::<Entity, With<DisasterLoad>>().iter(world).collect();
        let mut retained = std::collections::HashSet::with_capacity(data.len() / 7);
        for d in data.chunks_exact(7) {
            let entity = if d[0] == -1.0 { Some(self.car) } else { self.props.get(&(d[0] as u32)).copied() };
            if let Some(entity) = entity {
                if world.get::<RigidBody>(entity) != Some(&RigidBody::Dynamic) { continue; }
                let force = Vec3::new(d[1], d[2], d[3]).clamp_length_max(2.0e6);
                let torque = Vec3::new(d[4], d[5], d[6]).clamp_length_max(2.0e6);
                if force.length_squared() + torque.length_squared() < 1.0e-6 { continue; }
                retained.insert(entity);
                // Avian wakes islands on Changed<ConstantForce/ConstantTorque>.
                // Replacing identical components every render frame therefore
                // prevents settled debris from staying asleep under steady wind.
                // Compare the actual bounded f32 loads, with no new tolerance.
                let force_changed = world.get::<ConstantForce>(entity).is_none_or(|old| old.0 != force);
                let torque_changed = world.get::<ConstantTorque>(entity).is_none_or(|old| old.0 != torque);
                if world.get::<DisasterLoad>(entity).is_none() { world.entity_mut(entity).insert(DisasterLoad); }
                if force_changed { world.entity_mut(entity).insert(ConstantForce(force)); }
                if torque_changed { world.entity_mut(entity).insert(ConstantTorque(torque)); }
                if force_changed || torque_changed { world.commands().queue(WakeBody(entity)); }
            }
        }
        for entity in previous {
            if !retained.contains(&entity) {
                world.entity_mut(entity).remove::<(DisasterLoad,ConstantForce,ConstantTorque)>();
                // Removed components do not match Avian's Changed queries. A
                // sleeping body must react when a balancing load disappears.
                world.commands().queue(WakeBody(entity));
            }
        }
        world.flush();
        true
    }
    pub fn set_prop_motion_limits(&mut self, id: u32, angular_damping: f32, max_angular_speed: f32) -> bool {
        if !angular_damping.is_finite() || angular_damping < 0.0 || !max_angular_speed.is_finite() || max_angular_speed <= 0.0 { return false; }
        let Some(entity)=self.props.get(&id).copied() else { return false; };
        let world=self.app.world_mut();
        if world.get::<RigidBody>(entity)!=Some(&RigidBody::Dynamic) { return false; }
        world.entity_mut(entity).insert((AngularDamping(angular_damping), MaxAngularSpeed(max_angular_speed)));
        true
    }
    /// Give a released tree its crown: the stem box (`half`, metres) plus a sphere of radius
    /// `crown_radius` centred `crown_y` metres up the body axis. The sphere is the crushed crown
    /// that props a fallen top off the ground; without it the trunk lay flat and the crown mesh
    /// sank into the terrain (ledger D13: flat frond starbursts and bare trunks). Call before
    /// set_prop_mass_properties, which then fixes the declared mass whatever the shape.
    pub fn set_prop_crown(&mut self, id: u32, half: &[f32], crown_y: f32, crown_radius: f32) -> bool {
        if half.len()!=3 || half.iter().any(|v| !v.is_finite() || *v<=0.0) || !crown_y.is_finite() || !crown_radius.is_finite() || crown_radius<=0.0 { return false; }
        let Some(entity)=self.props.get(&id).copied() else { return false; };
        let world=self.app.world_mut();
        if world.get::<RigidBody>(entity)!=Some(&RigidBody::Dynamic) { return false; }
        let collider=Collider::compound(vec![
            (Vec3::ZERO, Quat::IDENTITY, Collider::cuboid(half[0]*2.0, half[1]*2.0, half[2]*2.0)),
            (Vec3::new(0.0, crown_y, 0.0), Quat::IDENTITY, Collider::sphere(crown_radius)),
        ]);
        world.entity_mut(entity).insert(collider);
        world.commands().queue(WakeBody(entity));
        world.flush();
        true
    }
    pub fn set_prop_angular_velocity(&mut self, id: u32, value: &[f32]) -> bool {
        if value.len()!=3 || value.iter().any(|v|!v.is_finite()) { return false; }
        let Some(entity)=self.props.get(&id).copied() else { return false; };
        self.app.world_mut().entity_mut(entity).insert(AngularVelocity(Vec3::new(value[0],value[1],value[2])));
        true
    }
    /// Contact-point velocity (m/s) and inverse effective mass (1/kg), including
    /// the actual body's rotational inertia. Empty for non-dynamic/invalid bodies.
    pub fn disaster_contact(&self, id: u32, point: &[f32], normal: &[f32]) -> Vec<f32> {
        if point.len()!=3 || normal.len()!=3 || point.iter().chain(normal).any(|v|!v.is_finite()) {return vec![];}
        let Some(entity)=self.props.get(&id).copied() else {return vec![];};let w=self.app.world();
        if w.get::<RigidBody>(entity)!=Some(&RigidBody::Dynamic) {return vec![];}
        let (Some(p),Some(q),Some(v),Some(a),Some(m),Some(i))=(w.get::<Position>(entity),w.get::<Rotation>(entity),w.get::<LinearVelocity>(entity),w.get::<AngularVelocity>(entity),w.get::<ComputedMass>(entity),w.get::<ComputedAngularInertia>(entity)) else {return vec![];};
        let n=Vec3::new(normal[0],normal[1],normal[2]);if (n.length_squared()-1.0).abs()>0.01 {return vec![];}
        let com=p.0+q.0*w.get::<ComputedCenterOfMass>(entity).map_or(Vec3::ZERO,|c|c.0);
        let r=Vec3::new(point[0],point[1],point[2])-com;let cross=r.cross(n);let inv_i_cross=q.0*(i.inverse()*(q.0.inverse()*cross));
        let at=v.0+a.0.cross(r);vec![at.x,at.y,at.z,m.inverse()+cross.dot(inv_i_cross)]
    }
    /// Equal-and-opposite contact impulse in N s at a world point. This changes
    /// both linear and angular momentum; no persistent force is left behind.
    pub fn apply_prop_impulse(&mut self, id: u32, value: &[f32], point: &[f32]) -> bool {
        if value.len()!=3 || point.len()!=3 || value.iter().chain(point).any(|v|!v.is_finite()) {return false;}
        let j=Vec3::new(value[0],value[1],value[2]);if j.length()>2.0e4{return false;}
        let Some(entity)=self.props.get(&id).copied() else {return false;};let w=self.app.world_mut();
        if w.get::<RigidBody>(entity)!=Some(&RigidBody::Dynamic) {return false;}
        let (Some(p),Some(q),Some(m),Some(i))=(w.get::<Position>(entity),w.get::<Rotation>(entity),w.get::<ComputedMass>(entity),w.get::<ComputedAngularInertia>(entity)) else {return false;};
        let com=p.0+q.0*w.get::<ComputedCenterOfMass>(entity).map_or(Vec3::ZERO,|c|c.0);let r=Vec3::new(point[0],point[1],point[2])-com;
        let dv=j*m.inverse();let da=q.0*(i.inverse()*(q.0.inverse()*r.cross(j)));
        if let Some(mut v)=w.get_mut::<LinearVelocity>(entity){v.0+=dv;}
        if let Some(mut a)=w.get_mut::<AngularVelocity>(entity){a.0+=da;}
        w.commands().queue(WakeBody(entity));w.flush();true
    }
    /// Actual body positions and linear velocities for relative-fluid loads / observation.
    pub fn disaster_motion(&self) -> Vec<f32> {
        let world = self.app.world();
        let mut out = Vec::with_capacity((self.props.len()+1)*7);
        for (id, entity) in std::iter::once((-1.0,self.car)).chain(self.props.iter().map(|(id,e)|(*id as f32,*e))) {
            if let (Some(p),Some(v)) = (world.get::<Position>(entity),world.get::<LinearVelocity>(entity)) {
                out.extend_from_slice(&[id,p.x,p.y,p.z,v.x,v.y,v.z]);
            }
        }
        out
    }
    /// Exact car rigid-body snapshot: position3, quaternion4, linear3, angular3.
    pub fn disaster_car_state(&self) -> Vec<f32> {
        let world=self.app.world();let p=world.get::<Position>(self.car).unwrap();let q=world.get::<Rotation>(self.car).unwrap();let v=world.get::<LinearVelocity>(self.car).unwrap();let a=world.get::<AngularVelocity>(self.car).unwrap();
        vec![p.x,p.y,p.z,q.x,q.y,q.z,q.w,v.x,v.y,v.z,a.x,a.y,a.z]
    }
    pub fn restore_disaster_car(&mut self,state:&[f32]) -> bool {
        if state.len()!=13 || state.iter().any(|v|!v.is_finite()) {return false;}
        let q=Quat::from_xyzw(state[3],state[4],state[5],state[6]);if q.length_squared()<0.01{return false;}
        self.reset(state[0],state[1],state[2],0.0);let q=q.normalize();
        self.app.world_mut().entity_mut(self.car).insert((Transform::from_xyz(state[0],state[1],state[2]).with_rotation(q),Rotation::from(q),LinearVelocity(Vec3::new(state[7],state[8],state[9])),AngularVelocity(Vec3::new(state[10],state[11],state[12]))));
        self.previous=[state[0],state[1],state[2],q.x,q.y,q.z,q.w];true
    }
    /// Ground support from solved upward contact normals, propagated through stacks.
    /// Proximity to terrain alone never makes a floating/airborne body supported.
    pub fn disaster_supported(&self) -> Vec<f32> {
        let world=self.app.world();let graph=world.resource::<ContactGraph>();
        let pairs:Vec<_>=graph.active_pairs().iter().chain(graph.sleeping_pairs()).filter(|p|p.is_touching()).collect();
        let mut supported=std::collections::HashSet::<Entity>::new();
        for pair in &pairs {for e in [pair.body1.unwrap_or(pair.collider1),pair.body2.unwrap_or(pair.collider2)] {if world.get::<RigidBody>(e)!=Some(&RigidBody::Dynamic){supported.insert(e);}}}
        for _ in 0..8 {let count=supported.len();for pair in &pairs {let a=pair.body1.unwrap_or(pair.collider1);let b=pair.body2.unwrap_or(pair.collider2);for m in &pair.manifolds {if m.total_normal_impulse()<=0.0 {continue;}if m.normal.y < -0.3 && supported.contains(&b){supported.insert(a);}if m.normal.y > 0.3 && supported.contains(&a){supported.insert(b);}}}if supported.len()==count{break;}}
        self.supported_connections(&mut supported);
        std::iter::once((-1.0,self.car)).chain(self.props.iter().map(|(id,e)|(*id as f32,*e))).filter_map(|(id,e)|supported.contains(&e).then_some(id)).collect()
    }
    /// The fluid at every loaded body's load points for this frame, integrated every substep by
    /// `fluid_drag`. Records of nine floats: id, the point in the body's axes from its origin (m), the
    /// quadratic coefficient rho Cd A / 2 (kg/m), a linear damping (kg/s), the fluid's velocity (m/s).
    /// A body's records are consecutive. Replaces the whole list, so a stopped event leaves no stale
    /// fluid; a bad batch is refused whole. A sleeping body stays asleep while its records are
    /// identical and wakes when they change or go.
    pub fn set_disaster_drag(&mut self, data: &[f32]) -> bool {
        if data.len() % DRAG_RECORD != 0 || data.len() > MAX_DRAG_RECORDS * DRAG_RECORD || data.iter().any(|v| !v.is_finite())
            || data.chunks_exact(DRAG_RECORD).any(|d| d[4] < 0.0 || d[5] < 0.0) { return false; }
        let world = self.app.world_mut();
        let previous: Vec<Entity> = world.query_filtered::<Entity, With<FluidDrag>>().iter(world).collect();
        let mut retained = std::collections::HashSet::new();
        let mut points: Vec<DragPoint> = Vec::new();
        let mut records = data.chunks_exact(DRAG_RECORD).peekable();
        while let Some(first) = records.peek().map(|d| d[0]) {
            points.clear();
            while let Some(d) = records.next_if(|d| d[0] == first) {
                if d[4] > 0.0 || d[5] > 0.0 {
                    points.push(DragPoint { local: Vec3::new(d[1], d[2], d[3]), quadratic: d[4], linear: d[5], fluid: Vec3::new(d[6], d[7], d[8]) });
                }
            }
            let entity = if first == -1.0 { Some(self.car) } else { self.props.get(&(first as u32)).copied() };
            let Some(entity) = entity else { continue; };
            if points.is_empty() || world.get::<RigidBody>(entity) != Some(&RigidBody::Dynamic) { continue; }
            retained.insert(entity);
            // The same rule as the held loads: identical records leave a settled body asleep.
            if world.get::<FluidDrag>(entity).is_some_and(|old| old.points == points) { continue; }
            match world.get_mut::<FluidDrag>(entity) {
                Some(mut drag) => { drag.points.clear(); drag.points.extend_from_slice(&points); }
                None => { world.entity_mut(entity).insert(FluidDrag { points: points.clone(), ..Default::default() }); }
            }
            world.commands().queue(WakeBody(entity));
        }
        for entity in previous {
            if !retained.contains(&entity) {
                world.entity_mut(entity).remove::<FluidDrag>();
                world.commands().queue(WakeBody(entity));
            }
        }
        world.flush();
        true
    }
    /// Rebuild only exported island colliders after structural failure. Terrain, vehicles,
    /// dynamic debris and ferry platforms are deliberately kept in the same solver world.
    pub fn clear_island_statics(&mut self) {
        let world = self.app.world_mut();
        let entities: Vec<Entity> = world.query_filtered::<Entity, With<IslandStatic>>().iter(world).collect();
        for entity in entities { world.despawn(entity); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn debris(on_ground: bool) -> (RallyPhysics, Entity) {
        let mut sim = RallyPhysics::new();
        assert!(sim.set_terrain(&[0.0;81], 9, 4000.0, -2000.0));
        assert!(sim.wake_prop(51, 0, &[0.5,0.5,0.5],
            &[40.0,if on_ground { 0.5 } else { 100.0 },0.0,0.0,0.0,0.0,1.0],
            10.0, 0.8, 0.0, false));
        let entity = sim.props[&51];
        (sim, entity)
    }
    fn step(sim: &mut RallyPhysics) { sim.advance(1.0/120.0,0.0,0.0,0.0,0.0); }
    fn settle(sim: &mut RallyPhysics, entity: Entity, load: &[f32]) {
        for _ in 0..600 { assert!(sim.set_disaster_loads(load)); step(sim); }
        assert!(sim.app.world().get::<Sleeping>(entity).is_some(), "steady loaded body did not settle");
    }
    // Frozen former setter for valid test inputs, including its force caps and
    // wake behavior. This is also the before case in the optional CPU probe.
    fn replace_loads(sim: &mut RallyPhysics, data: &[f32]) {
        let world = sim.app.world_mut();
        let entities: Vec<Entity> = world.query_filtered::<Entity, With<DisasterLoad>>().iter(world).collect();
        for entity in entities { world.entity_mut(entity).remove::<(DisasterLoad,ConstantForce,ConstantTorque)>(); }
        for d in data.chunks_exact(7) {
            let entity = if d[0] == -1.0 { Some(sim.car) } else { sim.props.get(&(d[0] as u32)).copied() };
            if let Some(entity) = entity {
                if world.get::<RigidBody>(entity) != Some(&RigidBody::Dynamic) { continue; }
                let force = Vec3::new(d[1],d[2],d[3]).clamp_length_max(2.0e6);
                let torque = Vec3::new(d[4],d[5],d[6]).clamp_length_max(2.0e6);
                if force.length_squared()+torque.length_squared()<1.0e-6 { continue; }
                world.entity_mut(entity).insert((DisasterLoad,ConstantForce(force),ConstantTorque(torque)));
                world.commands().queue(WakeBody(entity));
            }
        }
        world.flush();
    }

    #[test]
    fn steady_disaster_load_preserves_sleep_and_resting_contact() {
        let (mut sim, entity) = debris(true);
        let load = [51.0,5.0,0.0,0.0,0.0,0.0,0.0];
        settle(&mut sim, entity, &load);
        let position = sim.app.world().get::<Position>(entity).unwrap().0;
        let rotation = sim.app.world().get::<Rotation>(entity).unwrap().0;
        let velocity = sim.app.world().get::<LinearVelocity>(entity).unwrap().0;
        let spin = sim.app.world().get::<AngularVelocity>(entity).unwrap().0;
        assert!((position.y-0.5).abs()<0.03, "ground contact must still support the crate");
        for _ in 0..240 {
            assert!(sim.set_disaster_loads(&load));
            assert!(sim.app.world().get::<Sleeping>(entity).is_some(), "identical load woke the body");
            step(&mut sim);
            assert!(sim.app.world().get::<Sleeping>(entity).is_some());
        }
        let world = sim.app.world();
        assert_eq!(world.get::<Position>(entity).unwrap().0, position);
        assert_eq!(world.get::<Rotation>(entity).unwrap().0, rotation);
        assert_eq!(world.get::<ConstantForce>(entity).unwrap().0, Vec3::X*5.0);
        assert_eq!(world.get::<LinearVelocity>(entity).unwrap().0, velocity);
        assert_eq!(world.get::<AngularVelocity>(entity).unwrap().0, spin);
        assert!(velocity.length()<1e-4 && spin.length()<1e-4);
    }

    #[test]
    fn changed_disaster_force_and_torque_wake_and_move_resting_debris() {
        for torque_only in [false, true] {
            let (mut sim, entity) = debris(true);
            settle(&mut sim, entity, &[51.0,5.0,0.0,0.0,0.0,0.0,0.0]);
            let before = sim.app.world().get::<Position>(entity).unwrap().0;
            let load = if torque_only { [51.0,5.0,0.0,0.0,0.0,150.0,0.0] }
                       else { [51.0,400.0,0.0,0.0,0.0,0.0,0.0] };
            assert!(sim.set_disaster_loads(&load));
            assert!(sim.app.world().get::<Sleeping>(entity).is_none());
            for _ in 0..12 { step(&mut sim); }
            if torque_only {
                assert!(sim.app.world().get::<AngularVelocity>(entity).unwrap().y.abs()>0.1);
            } else {
                assert!(sim.app.world().get::<Position>(entity).unwrap().x-before.x>0.05);
            }
        }
    }

    #[test]
    fn omitted_or_zero_disaster_load_wakes_and_releases_balanced_body() {
        for replacement in [&[][..], &[51.0,0.0,0.0,0.0,0.0,0.0,0.0][..]] {
            let (mut sim, entity) = debris(false);
            settle(&mut sim, entity, &[51.0,0.0,98.1,0.0,0.0,0.0,0.0]);
            let before = sim.app.world().get::<Position>(entity).unwrap().y;
            assert!(sim.set_disaster_loads(replacement));
            assert!(sim.app.world().get::<Sleeping>(entity).is_none());
            assert!(sim.app.world().get::<DisasterLoad>(entity).is_none());
            assert!(sim.app.world().get::<ConstantForce>(entity).is_none());
            assert!(sim.app.world().get::<ConstantTorque>(entity).is_none());
            for _ in 0..12 { step(&mut sim); }
            assert!(sim.app.world().get::<LinearVelocity>(entity).unwrap().y < -0.9);
            assert!(sim.app.world().get::<Position>(entity).unwrap().y < before-0.04);
        }
    }

    #[test]
    fn invalid_disaster_batch_preserves_load_and_sleep_atomically() {
        let (mut sim, entity) = debris(true);
        settle(&mut sim, entity, &[51.0,5.0,0.0,0.0,0.0,0.0,0.0]);
        for invalid in [vec![51.0,0.0], vec![51.0,900.0,0.0,0.0,0.0,0.0,f32::NAN], vec![0.0;513*7]] {
            assert!(!sim.set_disaster_loads(&invalid));
            assert!(sim.app.world().get::<Sleeping>(entity).is_some());
            assert_eq!(sim.app.world().get::<ConstantForce>(entity).unwrap().0, Vec3::X*5.0);
        }
    }

    #[test]
    fn persistent_disaster_load_matches_replace_each_frame_while_awake() {
        let (mut current, entity) = debris(false);
        let (mut reference, old_entity) = debris(false);
        for frame in 0..240 {
            let load = if frame%13 == 0 { vec![] } else { vec![51.0,
                20.0*(frame as f32*0.23).sin(),4.0,13.0*(frame as f32*0.1).cos(),0.7,-0.3,0.5] };
            assert!(current.set_disaster_loads(&load));
            // Frozen former update mechanism; all forces and solver steps match.
            replace_loads(&mut reference, &load);
            step(&mut current);step(&mut reference);
            let a = current.app.world();let b = reference.app.world();
            assert_eq!(a.get::<Position>(entity).unwrap().0,b.get::<Position>(old_entity).unwrap().0);
            assert_eq!(a.get::<Rotation>(entity).unwrap().0,b.get::<Rotation>(old_entity).unwrap().0);
            assert_eq!(a.get::<LinearVelocity>(entity).unwrap().0,b.get::<LinearVelocity>(old_entity).unwrap().0);
            assert_eq!(a.get::<AngularVelocity>(entity).unwrap().0,b.get::<AngularVelocity>(old_entity).unwrap().0);
        }
    }

    #[test]
    #[ignore = "CPU timing probe; coordinate with browser measurements before running"]
    fn native_persistent_load_benchmark() {
        const COUNT: usize = 128;
        let mut loads = Vec::with_capacity(COUNT*7);
        let mut cases = [RallyPhysics::new(), RallyPhysics::new()];
        for sim in &mut cases {
            assert!(sim.set_terrain(&[0.0;81],9,4000.0,-2000.0));
            sim.reset(500.0,0.5,500.0,0.0);
            for i in 0..COUNT {
                assert!(sim.wake_prop(i as u32,0,&[0.5,0.5,0.5],
                    &[-200.0+(i%16) as f32*3.0,0.5,-100.0+(i/16) as f32*3.0,0.0,0.0,0.0,1.0],
                    10.0,0.8,0.0,false));
            }
        }
        for i in 0..COUNT { loads.extend_from_slice(&[i as f32,5.0,0.0,0.0,0.0,0.0,0.0]); }
        let advance = |sim: &mut RallyPhysics, old: bool| {
            if old { replace_loads(sim,&loads); } else { assert!(sim.set_disaster_loads(&loads)); }
            sim.advance(1.0/60.0,0.0,0.0,0.0,0.0);
        };
        for (index, sim) in cases.iter_mut().enumerate() { for _ in 0..300 { advance(sim,index==0); } }
        let mut rows = [Vec::new(), Vec::new()];
        for round in 0..7 {
            for index in if round%2 == 0 { [0,1] } else { [1,0] } {
                let start = std::time::Instant::now();
                for _ in 0..120 { advance(&mut cases[index],index==0); }
                rows[index].push(start.elapsed().as_secs_f64()*1000.0/120.0);
            }
        }
        let sleeping: Vec<usize> = cases.iter().map(|s|s.props.values().filter(|e|s.app.world().get::<Sleeping>(**e).is_some()).count()).collect();
        assert_eq!(sleeping,[0,COUNT]);
        for sim in &cases { for entity in sim.props.values() {
            assert!((sim.app.world().get::<Position>(*entity).unwrap().y-0.5).abs()<0.03);
        } }
        println!("{{\"bodies\":{COUNT},\"fixedHz\":120,\"substeps\":8,\"beforeMillisecondsPerFrame\":{:?},\"afterMillisecondsPerFrame\":{:?},\"sleepingBeforeAfter\":{:?}}}",rows[0],rows[1],sleeping);
    }
    #[test]
    fn first_force_step_uses_spawned_mass_and_stop_removes_load() {
        let mut sim=RallyPhysics::new();
        assert!(sim.wake_prop(51,0,&[0.5,0.5,0.5],&[-10.0,100.0,0.0,0.0,0.0,0.0,1.0],10.0,0.0,0.0,false));
        assert!(sim.set_disaster_loads(&[51.0,100.0,0.0,0.0,0.0,0.0,0.0]));
        sim.advance(1.0/120.0,0.0,0.0,0.0,0.0);
        let state=sim.disaster_motion();let body=state.chunks_exact(7).find(|b|b[0]==51.0).unwrap();
        assert!((body[4]-1.0/12.0).abs()<0.002,"first step velocity {}",body[4]);
        let before=body[4];assert!(sim.set_disaster_loads(&[]));sim.advance(1.0/120.0,0.0,0.0,0.0,0.0);
        let state=sim.disaster_motion();let body=state.chunks_exact(7).find(|b|b[0]==51.0).unwrap();assert!((body[4]-before).abs()<0.001);
    }

    // ---- Fluid drag (`fluid_drag`): the water holds what it carries.
    /// The six face points of a box of half extents `half` sharing rho Cd A / 2 = `quadratic` (kg/m),
    /// in a fluid moving at `fluid` (m/s): the layout the game sends for a box (RigidLoads.js).
    fn box_drag(id: f32, half: [f32;3], quadratic: f32, fluid: [f32;3]) -> Vec<f32> {
        let mut out = Vec::new();
        for axis in 0..3 { for sign in [-1.0f32, 1.0] {
            let mut p = [0.0f32;3];
            p[axis] = sign*half[axis]*0.65;
            out.extend_from_slice(&[id,p[0],p[1],p[2],quadratic/6.0,0.0,fluid[0],fluid[1],fluid[2]]);
        } }
        out
    }
    /// rho Cd A / 2 of a 1 m² face in sea water (1025 kg/m³, Cd 1), kg/m.
    const WATER: f32 = 0.5*1025.0;
    /// rho Cd A / 2 of the same face in air (1.225 kg/m³, Cd 1.1), kg/m.
    const AIR: f32 = 0.5*1.225*1.1;
    /// The 10 kg crate's weight carried, as neutral buoyancy carries it (N).
    const WEIGHTLESS: [f32;7] = [51.0,0.0,98.1,0.0,0.0,0.0,0.0];

    #[test]
    fn water_slows_a_free_body_at_the_rate_of_quadratic_drag() {
        let (mut sim, entity) = debris(false);
        let (v0, c) = (12.0f32, WATER/10.0); // m/s; rho Cd A / (2 m), 1/m
        sim.app.world_mut().entity_mut(entity).insert(LinearVelocity(Vec3::X*v0));
        let drag = box_drag(51.0,[0.5;3],WATER,[0.0;3]);
        // Half a second: the solver puts a body to sleep once it has moved under 0.15 m/s for 0.5 s, and this one is that slow from 0.13 s.
        for n in 1..=60 {
            assert!(sim.set_disaster_loads(&WEIGHTLESS));
            assert!(sim.set_disaster_drag(&drag));
            step(&mut sim);
            let v = sim.app.world().get::<LinearVelocity>(entity).unwrap().0;
            let t = n as f32/120.0;
            let expected = v0/(1.0+c*v0*t);
            if [1,6,12,60].contains(&n) {
                assert!((v.x-expected).abs()<=0.02*expected, "after {t:.3} s in still water the crate moves at {:.4} m/s; quadratic drag leaves v0 / (1 + c v0 t) = {expected:.4} m/s", v.x);
            }
            assert!(v.y.abs()<0.01 && v.z.abs()<0.01, "drag along the motion turned it: {v:?}");
        }
    }

    #[test]
    fn still_fluid_never_adds_energy_to_a_tumbling_body() {
        let mut sim = RallyPhysics::new();
        assert!(sim.set_terrain(&[0.0;81], 9, 4000.0, -2000.0));
        // A 10 kg plate, 1.2 x 0.1 x 0.6 m, thrown spinning.
        assert!(sim.wake_prop(51,0,&[0.6,0.05,0.3],&[40.0,100.0,0.0,0.0,0.0,0.0,1.0],10.0,0.8,0.0,false));
        let entity = sim.props[&51];
        sim.app.world_mut().entity_mut(entity).insert((LinearVelocity(Vec3::new(3.0,-2.0,5.0)),AngularVelocity(Vec3::new(4.0,-7.0,2.0))));
        // Uneven grip, a corner in water and a point with linear damping, so the drag couples its turn and its travel.
        let drag = [51.0,0.6,0.05,0.3,300.0,0.0,0.0,0.0,0.0, 51.0,-0.4,0.0,0.0,40.0,25.0,0.0,0.0,0.0];
        let energy = |sim: &RallyPhysics| {
            let w = sim.app.world();
            let (v, a) = (w.get::<LinearVelocity>(entity).unwrap().0, w.get::<AngularVelocity>(entity).unwrap().0);
            let inertia = world_inertia(w.get::<ComputedAngularInertia>(entity).unwrap(), w.get::<Rotation>(entity).unwrap().0);
            0.5*10.0*v.length_squared()+0.5*a.dot(inertia*a)
        };
        let (mut first, mut last) = (0.0f32, f32::INFINITY);
        for n in 0..480 {
            assert!(sim.set_disaster_loads(&WEIGHTLESS));
            assert!(sim.set_disaster_drag(&drag));
            step(&mut sim);
            let e = energy(&sim);
            if n==0 { first = e; }
            assert!(e<=last*1.0001+1e-5, "step {n}: kinetic energy rose from {last} J to {e} J in still fluid");
            last = e;
        }
        assert!(last<0.05*first, "4 s of drag left {last} J of {first} J");
    }

    #[test]
    fn a_flow_holds_light_bodies_against_a_wall_and_the_ground_without_moving_them() {
        let (mut sim, front) = debris(true);
        // A wall 5 cm downstream of the crate, and a second crate upstream that the same flow presses on the first.
        sim.add_surface_boxes(&[41.05,1.0,0.0,0.5,1.0,2.0,0.0,0.8],&[5]);
        assert!(sim.wake_prop(52,0,&[0.5,0.5,0.5],&[38.95,0.5,0.0,0.0,0.0,0.0,1.0],10.0,0.8,0.0,false));
        let back = sim.props[&52];
        // 30 m/s of water on a 1 m² face of a 10 kg crate: 46 000 m/s² on a free body.
        let flow = |v: [f32;3]| { let mut d = box_drag(51.0,[0.5;3],WATER,v); d.extend(box_drag(52.0,[0.5;3],WATER,v)); d };
        let at = |sim: &RallyPhysics, e: Entity| sim.app.world().get::<Position>(e).unwrap().0;
        let speed = |sim: &RallyPhysics, e: Entity| sim.app.world().get::<LinearVelocity>(e).unwrap().0.length();
        for direction in [[30.0,0.0,0.0],[0.0,-30.0,0.0]] {
            // The flow closes the gaps first; from there nothing may move.
            for _ in 0..120 { assert!(sim.set_disaster_drag(&flow(direction))); step(&mut sim); }
            let start = [at(&sim,front),at(&sim,back)];
            let mut worst = 0.0f32;
            for _ in 0..1200 {
                assert!(sim.set_disaster_drag(&flow(direction)));
                step(&mut sim);
                worst = worst.max(at(&sim,front).distance(start[0])).max(at(&sim,back).distance(start[1]));
            }
            assert!(worst<=0.05, "held by a {direction:?} m/s flow for 10 s a crate moved {worst:.3} m");
            // The flow stops: they come to rest where they are.
            assert!(sim.set_disaster_drag(&[]));
            for _ in 0..120 { step(&mut sim); }
            for (e, p) in [(front,start[0]),(back,start[1])] {
                assert!(speed(&sim,e)<0.05, "1 s after the flow stopped a crate still moves at {:.3} m/s", speed(&sim,e));
                assert!(at(&sim,e).distance(p)<=0.05, "after the flow stopped a crate ended {:.3} m from where it was held", at(&sim,e).distance(p));
            }
        }
    }

    #[test]
    fn steady_fluid_drag_preserves_sleep_and_a_changed_fluid_wakes_the_body() {
        let (mut sim, entity) = debris(true);
        let breeze = box_drag(51.0,[0.5;3],AIR,[5.0,0.0,0.0]);
        for _ in 0..600 { assert!(sim.set_disaster_drag(&breeze)); step(&mut sim); }
        assert!(sim.app.world().get::<Sleeping>(entity).is_some(), "a crate on the ground in a steady 5 m/s breeze did not settle");
        let position = sim.app.world().get::<Position>(entity).unwrap().0;
        for _ in 0..240 {
            assert!(sim.set_disaster_drag(&breeze));
            assert!(sim.app.world().get::<Sleeping>(entity).is_some(), "identical fluid woke the body");
            step(&mut sim);
            assert!(sim.app.world().get::<Sleeping>(entity).is_some());
        }
        assert_eq!(sim.app.world().get::<Position>(entity).unwrap().0, position);
        // A bad batch is refused whole: the breeze stays and the body sleeps on.
        let (mut nan, mut negative) = (breeze.clone(), breeze.clone());
        nan[6] = f32::NAN;
        negative[4] = -1.0;
        for invalid in [vec![51.0;8], nan, negative, vec![0.0;(MAX_DRAG_RECORDS+1)*DRAG_RECORD]] {
            assert!(!sim.set_disaster_drag(&invalid));
            assert!(sim.app.world().get::<Sleeping>(entity).is_some());
            assert_eq!(sim.app.world().get::<FluidDrag>(entity).unwrap().points.len(), 6);
        }
        // A 60 m/s gust (2.4 kN on the face against 78 N of friction) wakes it and moves it.
        let gust = box_drag(51.0,[0.5;3],AIR,[60.0,0.0,0.0]);
        assert!(sim.set_disaster_drag(&gust));
        assert!(sim.app.world().get::<Sleeping>(entity).is_none(), "a changed fluid did not wake the body");
        for _ in 0..24 { assert!(sim.set_disaster_drag(&gust)); step(&mut sim); }
        let moved = sim.app.world().get::<Position>(entity).unwrap().x-position.x;
        assert!(moved>0.05, "0.2 s of a 60 m/s gust moved the crate {moved:.3} m");
        // The event ends: no fluid is left on the body.
        assert!(sim.set_disaster_drag(&[]));
        assert!(sim.app.world().get::<FluidDrag>(entity).is_none());
    }
}
