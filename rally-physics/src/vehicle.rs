use avian3d::prelude::*;
use bevy::prelude::*;
use crate::{driving::PlayerCar,controller::Car};

/// Everything that makes one car feel different from another. Units are SI.
/// Geometry (mounts, rest/travel/extension, radius, body boxes) matches the
/// rendered models; the rest is a plausible real-world setup for each car.
#[derive(Resource,Clone,Debug)]
pub struct VehicleConfig {
    pub mass:f32, pub com:f32, pub inertia:Vec3,
    pub mounts:[Vec3;4], pub wheelbase:f32,
    // Suspension: zero-force length `rest`, bump travel below it, droop to `extension`.
    pub radius:f32, pub width:f32, pub rest:f32, pub travel:f32, pub extension:f32,
    pub spring_front:f32, pub spring_rear:f32, pub bump:f32, pub rebound:f32,
    pub arb_front:f32, pub arb_rear:f32, pub roll_centre:f32,
    // Tyres: peak friction multiplier on sealed and on loose surfaces, wheel inertia.
    pub grip_road:f32, pub grip_loose:f32, pub wheel_inertia:f32,
    // Engine and driveline.
    pub idle:f32, pub peak_rpm:f32, pub redline:f32, pub peak_torque:f32, pub engine_brake:f32,
    pub engine_inertia:f32, pub gears:Vec<f32>, pub reverse:f32, pub final_drive:f32,
    pub shift_time:f32, pub front_share:f32, pub diff_lock:f32, pub top_speed:f32,
    pub brake_torque:f32, pub brake_front:f32, pub handbrake_torque:f32,
    pub drag:f32, pub max_steer:f32,
    // Collision boxes (full sizes) and hull buoyancy.
    pub body:Vec3, pub body_y:f32, pub cabin:Vec3, pub cabin_y:f32, pub cabin_z:f32,
    pub displacement:f32, pub paddle:f32,
}
impl Default for VehicleConfig { fn default()->Self { Self::aster() } }
impl VehicleConfig {
    /// Aster RS: 1970s rally coupe, 1,250 kg, 2.0 litre six, rear drive, road tyres.
    pub fn aster()->Self {
        Self { mass:1250.0,com:0.52,inertia:Vec3::new(1550.0,1850.0,600.0),
            mounts:[Vec3::new(-0.79,0.68,1.32),Vec3::new(0.79,0.68,1.32),Vec3::new(-0.79,0.68,-1.32),Vec3::new(0.79,0.68,-1.32)],
            wheelbase:2.64,
            radius:0.34,width:0.235,rest:0.43,travel:0.28,extension:0.49,
            spring_front:38000.0,spring_rear:34000.0,bump:3600.0,rebound:5200.0,
            arb_front:16000.0,arb_rear:7000.0,roll_centre:0.18,
            grip_road:1.0,grip_loose:0.88,wheel_inertia:1.1,
            idle:850.0,peak_rpm:5200.0,redline:7200.0,peak_torque:250.0,engine_brake:55.0,
            engine_inertia:0.16,gears:vec![3.35,2.12,1.48,1.14,0.92],reverse:3.2,final_drive:3.9,
            shift_time:0.16,front_share:0.0,diff_lock:70.0,top_speed:62.0,
            brake_torque:2600.0,brake_front:0.64,handbrake_torque:2400.0,
            drag:0.47,max_steer:0.58,
            body:Vec3::new(1.72,0.48,4.10),body_y:0.64,
            cabin:Vec3::new(1.52,0.55,2.10),cabin_y:1.07,cabin_z:-0.15,
            displacement:0.65,paddle:650.0 }
    }
    /// Lifted black Jeep: 2,100 kg, 5.7 litre V8, full-time 4x4, mud-terrain tyres.
    pub fn jeep()->Self {
        Self { mass:2100.0,com:0.92,inertia:Vec3::new(3500.0,4200.0,1600.0),
            mounts:[Vec3::new(-1.02,0.99,1.38),Vec3::new(1.02,0.99,1.38),Vec3::new(-1.02,0.99,-1.38),Vec3::new(1.02,0.99,-1.38)],
            wheelbase:2.76,
            radius:0.47,width:0.38,rest:0.65,travel:0.35,extension:0.77,
            spring_front:44000.0,spring_rear:46000.0,bump:5200.0,rebound:7600.0,
            arb_front:26000.0,arb_rear:21000.0,roll_centre:0.34,
            grip_road:0.92,grip_loose:1.08,wheel_inertia:3.2,
            idle:650.0,peak_rpm:4000.0,redline:5600.0,peak_torque:480.0,engine_brake:95.0,
            engine_inertia:0.28,gears:vec![4.03,2.36,1.53,1.15,0.85],reverse:3.6,final_drive:4.1,
            shift_time:0.24,front_share:0.42,diff_lock:140.0,top_speed:44.5,
            brake_torque:4600.0,brake_front:0.62,handbrake_torque:3600.0,
            drag:0.95,max_steer:0.56,
            body:Vec3::new(1.82,0.46,4.16),body_y:0.98,
            cabin:Vec3::new(1.72,0.93,2.58),cabin_y:1.64,cabin_z:-0.70,
            displacement:0.72,paddle:1100.0 }
    }
    pub fn of(kind:u8)->Self { if kind==1 { Self::jeep() } else { Self::aster() } }
    /// Rounded boxes let a glancing car slide along walls and rails instead of snagging a corner.
    pub fn collider(&self)->Collider {
        let rounded=|size:Vec3,r:f32| Collider::round_cuboid((size.x-2.0*r).max(0.05),(size.y-2.0*r).max(0.05),(size.z-2.0*r).max(0.05),r);
        Collider::compound(vec![
            (Vec3::new(0.0,self.body_y,0.0),Quat::IDENTITY,rounded(self.body,0.12)),
            (Vec3::new(0.0,self.cabin_y,self.cabin_z),Quat::IDENTITY,rounded(self.cabin,0.14)),
        ])
    }
    /// Lowest point of the body hull above the car origin, and total hull height.
    pub fn hull(&self)->(f32,f32) {
        let bottom=self.body_y-self.body.y*0.5;
        (bottom,(self.cabin_y+self.cabin.y*0.5)-bottom)
    }
}

pub fn bundle(config:&VehicleConfig)->impl Bundle + use<> {
    (PlayerCar,RigidBody::Dynamic,TransformInterpolation,config.collider(),
        Mass(config.mass),CenterOfMass::new(0.0,config.com,0.0),AngularInertia::new(config.inertia),
        Friction::new(0.3),Restitution::new(0.08),SleepingDisabled,
        // Thin rails and posts must stop a car at 150 km/h; sweeps only when fast.
        SweptCcd { linear_threshold:6.0, ..SweptCcd::LINEAR },
        Car::new(config))
}
