# Car physics

Tidewater's cars run on its own vehicle controller, `rally-physics/src/controller.rs`,
hosted in WebAssembly on Avian 0.5 / Bevy 0.18 at 120 Hz with eight solver substeps.
It started from Rally's controller (`src/driving/physics.rs` in the Rally project) and was
rewritten on 25 September 2026 for realism, ease on a keyboard, water and damage.
Rally still supplies the car meshes and its `DriveIntent` input type (`driving/input.rs`,
hash-checked by `test/rally-bridge.mjs`); `npm run sync:rally` never overwrites the controller.

## Model

- **Contacts.** Each wheel casts a ray under the hub and a tyre-shaped cylinder. The
  cylinder finds kerbs, logs and rock faces ahead of or behind the hub, so tyres climb
  them instead of clipping into them. Contacts steeper than about 63 degrees are walls.
- **Suspension.** Springs per axle, separate bump and rebound damping, a stiff bump stop,
  and anti-roll bars coupling each axle. The force acts along the contact normal.
- **Tyres.** Every wheel has its own spin. Forces come from combined slip ratio and slip
  angle on a normalised curve per surface: `peak` friction, a `rise` exponent, and a `tail`
  for how much grip is left when fully sliding. Asphalt peaks sharply and drops; soft sand
  never drops and piles up. Wheel spin is integrated at 720 Hz, implicitly in the tyre's
  stiffness, so light wheels on stiff tyres stay stable. Grip falls slightly with load. A
  locked, nearly stopped tyre holds with static friction instead of creeping downhill.
- **Surfaces** (`road.rs`). Asphalt, gravel (from the road ribbons, indexed in a 32 m spatial
  grid for O(1) per-wheel lookup across 8.5+ km of island roads), then the terrain splat
  per texel: dry sand, wet sand near the waterline, soil or grass, rock. Props are wood
  (pier, rails, logs); trunks and rocks are rock. Contacts under the sea are water.
  Sand adds rolling and ploughing drag.
- **Driftwood** (`carBox` in `RallyDrive.js`). Trunk sections stay whole: thin ones are
  climbed, big ones (2.6 m and longer) stop the car. Gnarled branch pieces are short for their
  spread; the car meets only their thick wood, a bump of at most 12 cm its tyres roll over.
- **Driveline.** Torque curve, clutch slip at launch, reflected engine inertia once
  engaged, a limited-slip coupling, and a 5-speed automatic. The automatic shifts on a
  smoothed throttle with a settle time, so feathering the pedal never hunts gears. Rev
  limiter and top-speed governor. Aster RS: rear drive, 250 Nm. Jeep: full-time 4x4
  (42 percent front), 480 Nm, governed to 160 km/h.
- **Pedals.** S brakes to a stop, holds for half a second, then engages reverse, which is
  governed to 27 km/h. W does the reverse of that. With no demand, a stopped car auto-holds
  on its brakes, even on a grade.
- **Assists, on by default** (`set_assists( false )` turns them off). ABS always works.
  Traction control trims torque past 1.4 times the useful slip. Stability control measures
  intended yaw from driver demand (not trimmed lock) and brakes the outside front wheel only
  when the rear axle actually slides past peak grip in a spinout, leaving corner entry crisp,
  and stands down on the handbrake. At speed, slip-guided front-axle steering aligns the front
  tyres near their peak slip angle with proportional yaw damping so full keyboard steer holds
  high-g cornering without collapsing lock. Steering turn-in reaches lock in about 0.085 s
  and returns in about 0.055 s.
- **Water.** Twelve vertical water columns under the hull give buoyancy at the right
  place, drag relative to the moving surface, and a push along the wave slope. Wheels
  under water paddle weakly (under 2 m/s). The renderer fits the local sea plane from five
  GPU wave queries (`src/rally/CarWater.js`) and calls `set_water`. The plane is off
  when no sample is over water.
- **Collisions.** Compound hulls match rendered GLB body widths and lengths with rounded
  corners (`0.08` to `0.10 m`) that slide along walls. Non-linear swept CCD (`SweptCcd` above
  3 m/s linear / 0.4 rad/s angular) prevents fast rotating corners from poking through rails,
  poles or parked cars, and `HeightFieldFlags::FIX_INTERNAL_EDGES` keeps low splitters from
  catching graded road sags. Leaning palm trunks (segmented along their shader curve),
  full-radius tree trunks, roadside guide posts, parked terminal cars, terminal posts and
  guardrails are all solid static colliders (`src/rally/WorldPhysics.js`, `CoastalRoad.js`,
  `Terminal.js`). Dynamic props use linear swept CCD and breakable fence shards spawn ahead
  of the hitting car hull.
- **Damage hooks.** `take_impacts()` returns hard hits on the body, each as a car-local
  point, push direction, delta-v severity and a scenery flag. `set_damage( engine, pull,
  wheels[12] )` sets power loss, steering pull, per-wheel toe, spring strength and
  detached wheels.
- **Remote cars** are kinematic proxies built from the owner's poses. Their collider is
  rebuilt only when the owner changes vehicle.

## Moving platforms (the ferry's vehicle deck)

`add_platform(id, boxes)` builds one kinematic body from boxes in its own frame (centre xyz,
half extents xyz, yaw, friction per record) with its centre of mass at its origin, surfaced as
asphalt. `set_platform(id, [position xyz, rotation xyzw, linear velocity xyz, angular velocity
xyz])` poses it and sets the motion the solver carries it along until the next call;
`remove_platform(id)`. In `drive_forces` each wheel contact on a platform takes the platform's
velocity at that point, `v + w x (p - origin)`, and the tyres, springs and static hold work
relative to it; the car's speed (speedo, gearbox), drag, drift assist and ESC yaw rate are
measured over the average deck under the grounded wheels. Evidence: three `tests.rs` scenarios
(a parked car through a 1.5 m/s2 pull-away to 29 km/h, through an easing turn at 0.08 rad/s,
and driving forward along a moving deck). Red before the fix: the parked car slid 57.8 m off the
deck, drifted 36 m in the turn, and went backwards when driven; the same final tests fail again
with the deck lookup disabled.

## Rendering between steps

`advance()` runs whole 1/120 s steps and banks the remainder, so one display frame can get
zero, one or two steps. A car drawn at the latest step judders in proportion to its speed
(23 cm per missing or extra step at 100 km/h; worst on 120 Hz displays). `blend()` returns the
pose before the latest step (position xyz, rotation xyzw) and alpha, the remainder as a
fraction of a step. `RallyDrive.syncModel` draws the car at lerp/slerp(previous, snapshot
pose, alpha): one step (8 ms) behind, but even at any frame rate. Tyre marks and spray get the
same offset (`RallyDrive.drawn`) so they stay under the drawn wheels. `reset()` seeds the
previous pose, so a teleport never blends. Evidence: `rally.spec.js` "At speed on a 120 Hz
display…" (red: a 1.91 / 0.00 step pattern on 28 of ~150 frames; green: every frame within
20 % of speed times frame time).

## Snapshot (96 floats, `snapshot()` in `lib.rs`)

| Index | Value |
| --- | --- |
| 0-12 | Position, rotation, signed km/h, gear (-1 R, 0 N when parked, 1-5), rpm, loaded contacts, distance, mean slide |
| 13 + w·4 | Suspension length, steer angle, wheel surface speed (ω·r, 0 when locked), grounded. Wheel w: 0 front at -X (driver's right, model node WheelFrontL), 1 front +X, 2 rear -X, 3 rear +X |
| 29 + w·10 | Contact point, normal, load, slide 0..1, ground speed, lateral speed |
| 69-80 | Throttle applied, driver brake (not auto-hold), steering, handbrake, submerged, TC or ESC, ABS, lateral g, longitudinal g, yaw rate, engine load, shifting |
| 81-92 | Per-wheel slip ratio, slip angle, surface code (0 sand, 1 soil, 2 rock, 3 asphalt, 4 gravel, 5 wood, 6 water, 7 wet sand) |
| 93-95 | Sea height at the car (-1000 when none), vertical speed, speed through water |

Multiplayer poses carry this array, quantised, and older 69-float poses are still accepted.
Poses carry the sender's own timestamp. Each remote car is drawn 110 ms behind the fastest
delivery seen from that driver, between buffered poses (`SharedDrive.sample`). A late packet
is bridged along the car's own reported speed and heading, for at most 150 ms.

## Evidence

`npm run test:physics` runs 69 native behaviour tests against the real Avian solver (plus
3 ignored benchmark/trace probes). They cover:
- rest and slope hold
- 0-100 km/h and top-speed bands
- ABS stops
- steering direction, symmetry, fast turn-in and sustained high-speed cornering at 120 and 160 km/h without lock collapse
- cornering without rollover, including a Jeep slalom
- handbrake rotation
- a sand launch with TC
- the brake-to-reverse pause
- gearbox hunting
- floating, riding a swell, drifting down a sloping sea, and floating when capsized
- paddle speed
- no tunnelling through a thin rail, heightfield sag non-launch, and visual-matched car hull contact bounds
- climbing a log
- impact reports and mechanical damage
- moving ferry deck contacts, fluid loads, structural compliance and disaster force batches

Stability control, the reverse pause, the gearbox, high-speed turn-in, heightfield sag edges
and visual hull contact were each shown to fail the test without the fix. Browser scenarios
cover the same behaviour through the real game: `rally.spec.js`, `rally-water.spec.js`,
`tyre-marks.spec.js`, `gamepad.spec.js`, `coastal-road.spec.js`, `gt3-handling.spec.js`,
`road-clearance.spec.js`, and `driving-overhaul.spec.js`.

## Controls

Keyboard: W/S or arrows (throttle, brake and reverse), A/D (steer), Space (handbrake),
R (recover near the car, keeping its heading and any damage), E (leave), F (free camera),
K (key hints). A standard gamepad gives analog control: left stick steers, right and left
triggers are throttle and brake, A or right bumper is the handbrake, Y recovers. The mouse
or a drag orbits the chase camera, which settles back behind the car on its own.
The chase camera's lens widens by up to 12 degrees by 160 km/h and settles back when slow.

Y (B on a pad) bails out: `src/rally/Bailout.js` throws the driver out of the side at the
car's velocity plus a sideways and upward leap, then integrates a body of 0.3 m radius with
gravity, bounce, slope contact and friction (6.5 m/s², 2.5x in water), colliding with boxes
and trunk cylinders, seen through the driver's eyes rolling with speed. At rest it stands up
and hands over to walking. The car rolls on driverless and off the handbrake until it stops. The shout
(`public/rally/audio/yeet.wav`, CC0) plays unless `?noShout` is in the URL
(`settings.bailShout`); the demo recorder turns it off.
`App.warp( curve )` slows the whole world for the bail (full speed for the shout, a fifth in
the air, back to full around the landing: `bulletTime` in `RallyDrive.js`); `App.gameTime`
is the world clock the specs read.

## Loose props (rally-physics/src/props.rs, src/physics/Props.js)

Crates, barrels and lobster pots (anything stamped by `InstancedProps.add`) and fence panels
(`fence()` with colliders) are loose props. They are drawn inside the merged static batches as
before; `GeoBuilder.tagSpans` and the `tag` argument of `Batch.addBatch` record which vertex range
each prop owns, and `Batch.build()` hands the range to the prop (`bind`). A prop starts dormant:
no Avian body, only a grid entry. `PropPhysics.update` (App, after `rally.update`) wakes props near
the moving car (radius 4 m + 0.45 s of speed) or the walker (2.2 m + 0.4 s) with `wake_prop`, reads
every awake pose once a frame with `prop_poses` (10 floats each), rewrites the vertex range, and
puts a prop back to sleep (`sleep_prop`, the body goes, the pose stays) once it has rested 0.6 s
with nobody within its radius plus 3 m. Fence panels wake as static sensors; a hitter faster than
4 m/s breaks the panel into its three pre-split pieces, a slower one meets a solid panel
(`set_prop_solid`). The walker is a person-sized dynamic capsule (`set_pusher`, 80 kg, pushed toward the walker
by at most 500 N in `drive_pusher`) on its own collision layer that touches props only: it shoves
a 12 kg crate but only rocks a 150 kg full barrel, and `PropPhysics.pushers` holds the walker
within 0.15 m of the body (`pusher_position`), so a prop too heavy to move stops the walker. The
steel drum density is set for a mostly full drum (about 150 kg). Walker boxes of prop stacks and fence panels carry `prop = true` and are
left out of the car's static world (RallyDrive).

Correction (2026-09-27): the ferry terminal and Joey village GLBs are merged by material (31 and
6 nodes); bins, bollards, signs and chairs are not separate nodes, and their colliders JSON boxes
carry no names. Making them loose props needs a rebuild of those GLBs with the props as their own
nodes (tools/ferry/terminal_build.py, tools/joey/village_build.py).
