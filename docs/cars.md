# Cars: the drivable line-up and the island's traffic

No real brand names, logos or badges anywhere in the game. Each car gets its own name and keeps the
silhouette of the kind of car it is drawn from.

## 1. Reference

Figures are the real car's, from the maker's data unless marked. "Declared" marks a game choice; the
tests in `rally-physics/src/tests.rs` (`NEW_CARS`) hold every declared number to the real outcome.

Sources: Lamborghini Huracan EVO technical data (lamborghini.com, 2019 press kit); Bugatti Chiron
press kit (2016); Porsche 911 GT3 PDK technical data,
https://newsroom.porsche.com/dam/jcr:ca1882c7-1588-4a2e-995c-fe19ef1281fc/pag-911-gt3-pdk-en.pdf
(track, ratios, final drive, weight); Meyers Manx, https://en.wikipedia.org/wiki/Meyers_Manx and
https://www.conceptcarz.com/s23823/meyers-manx.aspx (wheelbase, weight); Volkswagen air-cooled
engine, https://en.wikipedia.org/wiki/Volkswagen_air-cooled_engine (1600 twin-port output).

Declared in every new config (`rally-physics/src/vehicle.rs`): spring and damper rates, inertias,
collision boxes, tyre grip multipliers, and `peak_torque`, which is set so the shared torque curve
(it falls to 0.9 at 0.9 x redline) gives the published peak power at the published rpm. One radius
serves all four wheels, so staggered tyres use their mean. The physics origin stays mid-wheelbase
(the models' root, per `assets/rally/asset_report.json`); `com_z` moves the centre of mass back to
the published split. Without it the GT (then the Kestrel GT) launched on half its weight and reached only 240 km/h
in 35 s (red run, `cargo-g1.log`).

Measured in the simulator (`cargo test ... new_cars -- --nocapture`, 2026-10-05):

## 2. Source of truth

- Physics: `VehicleConfig::of( kind )` in `rally-physics/src/vehicle.rs`, chosen through
  `RallyPhysics::select_vehicle` (kinds below `VehicleConfig::COUNT`).
- Game side: `VEHICLES` in `src/rally/Vehicles.js` (id = physics kind, mass, wheel radius, mount,
  tyre width, tread, pressure, camera). The radius, mount and width there must equal the Rust config.
- Terrain heights, roads and water are the shared ones the Aster and Jeep already use; no car keeps
  its own.
- Models: `public/rally/<file>.glb` built by `tools/rally/**`, under the contract in
  `assets/rally/asset_report.json` (Y up, +Z nose, root on the ground mid-wheelbase, pivots
  `WheelFrontL/R`, `WheelRearL/R`, spin about local X).

## 3. Budget (M5 Pro, 2560x1267)

| | LOD0 | LOD1 | LOD2 |
|---|---|---|---|
| Hero car (driven, or another player's) | under 25 m: up to 150k triangles with interior, up to 14 draws (one per material; four wheel pivots share theirs) | 25 to 80 m: 35k, cabin as tinted glass over a dark card, up to 8 draws | over 80 m: 8k, up to 4 draws |
| Traffic car (moving) | under 30 m: up to 12k triangles with wheels, up to 7 draws (pinned by traffic-wheels.spec.js) | 30 to 90 m: 3.5k body, 200-triangle wheels that still spin (a 0.65 m wheel is still about 13 px at 80 m) | over 90 m: 800, wheels baked in |
| Parked car | merged per material across the car park (already a few dozen draws); wheels merged with the body, they never turn | | |

The Petrel GT (the CarConcept import, 134k triangles, interior, rigged, emblem blanked) is the GT3-style car and shows a hero car fits LOD0. Bench the drive
view and the terminal lanes with `?bench` before and after each model lands.

## 4. Detail by distance

Only the driven car simulates its full tyre and driveline model. Other players' cars are kinematic
bodies. Traffic cars have kinematic bodies within 250 m of the player's car (`NEAR` in Traffic.js)
and roll and steer their wheels at any distance they draw. Parked cars never move.

## 5. Controls

The same keys as the Aster RS and the Ridgeback 4x4: nothing new. The picker lists every car with its
name; E enters and leaves, R recovers, V swaps the camera.

## 6. Transitions

Picking a car swaps the physics body (`select_vehicle` resets it at the start) and the model; the
walking proxy (the box the player walks around) takes its size from the car's collision box.

## 7. Edges

The hypercar reaches 105.6 m/s: a wheel moves 0.88 m per 120 Hz step. The body sweeps (CCD) above
6 m/s; the strip tests run each car flat out for 35 s with all four wheels in contact. The governed
top speeds are in m/s in `top_speed`. Non-finite inputs are rejected at the bridge as before.

## 8. Evidence plan

- Node/Rust: `NEW_CARS` in tests.rs, five tests (springs, 0-100, top speed, 100-0, lateral g), red
  0/5 before the configs (no such vehicle), green 5/5 after.
- BDD (when the models land): pick each car in the Vehicle picker with the keyboard, drive the coast
  road with the player's keys, all four wheels grounded and turning in telemetry, captures reviewed.
- Bench: the drive view per car and the terminal lanes, before and after.

## Asset source and licence per car

| Car | Model | Licence |
|---|---|---|
| Aster RS, support wagon and pickup | existing imports (`CREDITS.md`) | as credited |
| Ridgeback 4x4 (key `jeep`, file `black_jeep`: kept so shared-driving rooms and saves still match) | `tools/rally/build_black_jeep.py` (Blender, built from code) | ours |
| Petrel GT | `public/rally/concept_gt.glb`, CarConcept by Eric Chadwick (Khronos glTF Sample Assets), imported by `tools/rally/import_cars.py` (emblems blanked) | CC BY 4.0, credited in `CREDITS.md` |
| Fulmine V10, Corsaire W16, Sandpiper | not yet built: Blender builds from these references, or a CC-BY source with badges stripped and credited in `CREDITS.md` | to be recorded per car |
| Traffic and parked bodies | `tools/ferry/everyday_cars.py` (Blender, built from code, 2026-10-06): hatch, sedan, SUV, ute, van; the Ridgeback stays as the rarer one | ours |

## The car table

`src/rally/Vehicles.js` is the one table the game reads for each drivable car: name, tag, model file,
mass, tyre radius and width, mount, idle and redline, engine recording, walking proxy and nameplate
height. The picker (`DriveHUD.js`), the rev gauge, `EngineSound.js`, the walking proxy
(`RallyDrive.selectVehicle`), the shared-driving nameplate (`SocialPanel.js`) and the model loader
(`RallyDrive.init` loads every row) all read it. `test/vehicle-parity.mjs` (in `test:simulation`)
holds mass, radius, width, mount, idle and redline equal to `rally-physics/src/vehicle.rs`; it was red
on idle and redline while those lived in DriveHUD's own copy. `test/browser/hero-cars.spec.js` picks
each new car, starts it on the coastal road, drives it under W and holds the drawn wheels' turns to
the distance driven (within 10 %) with four wheels grounded throughout. Add a row there with each car.

## Glass and the shared tables

## Specs that hold under load, and a lost graphics device

## Hero cars built in Blender

- `tools/rally/car_palette.py`: the one material table, now imported by both `import_cars.py` and the
  builders, so Headlamp, TailLamp and Glass mean the same thing on every car (CarLights finds the
  lamps by those names; `test/vehicle-glass.mjs` holds Glass to the blended tint).
- `tools/rally/hero_kit.py`: the body is one surface lofted through measured cross-sections (11
  points round each half section, Catmull-Rom round it, a cubic Hermite in metres along the car so
  uneven station spacing leaves no crease). Windows, lamps, intakes, the engine cover, skirts and the
  undertray are regions of that surface, so their edges meet the paint exactly. Wheel arches are
  circles cut from the side and floor (never a bonnet or deck) with the cut edge snapped onto the
  circle. Wheels: lathed tyre whose tread radius is the physics radius, open barrel, polished lip,
  spokes, hub and centre nut, a disc that turns with the wheel; calipers on the body (the contract).
  `finish()` asserts the contract on the exported GLB (pivots at y = radius with identity rotation,
  a GlassPanels mesh, the LOD0 triangle cap) and writes the report.
- `tools/rally/build_fulmine_v10.py` (kind 2, key `supercar`): 4.50 x 1.93 x 1.165 m on the Huracan
  EVO's 2.620 m wheelbase and 1.668 / 1.620 m track, 245 and 305 mm tyres drawn on the physics' 0.336 m
  radius. 60,468 triangles, 14 materials (14 draws, the LOD0 budget), 2.0 MB. Interior: tub floor,
  dash and binnacle, console, two buckets, a right-hand-drive wheel (the car's right is -X), bulkhead,
  door cards and headliner. Plates from its report into `VehicleModel.js` PLATES.

## Hero cars, round two: hard-surface bodies and a roll check over a coast

- A low-poly control cage: 16 stations nose to tail, each a 10-point half section (floor centre,
  floor edge, rocker, waist, shoulder, deck edge, belt, top of the side glass, roof edge, crown),
  mirrored into an 18-point ring, so every car is symmetric by construction.
- Character lines are cage edges with crease 1.0 (rocker, waist, shoulder, roof edge, the nose and
  tail perimeters, the door blade) and every edge between two materials is creased, so the glass,
  the black pillars, the intakes and the lamp housings keep crisp outlines. A vertex where a creased
  lengthwise line meets a creased cross line gets a vertex crease: without it the side window came
  out an oval.
- Subdivided three times, octagonal wheel arches cut by an exact boolean (a flat top, 4.3 cm off the
  tread; the cut faces are the black wheel-well liners), then face-area weighted normals with sharp
  edges past 26 degrees, so big panels stay flat to their edges.
- Lamps, shut lines and fittings are laid on the finished paint by ray casts (`Surface`, `ribbon`):
  Y-shaped day-running lamps and tail lamps, 4 mm shut lines, hexagonal exhausts in the black rear
  panel, a splitter inside the nose's plan, slatted engine cover, slim mirrors on stalks.

## Hero cars, round three: Fulmine tail, Corsaire W16, Sandpiper 1600

### Corsaire W16 (kind 3, `hypercar`)

Reference: the Bugatti Chiron (2016), 4.544 m long, 2.038 m wide, 1.212 m tall, 2.711 m wheelbase,
1.748 / 1.660 m track, 285/30 R20 front and 355/25 R21 rear; 1,500 kW, 1,600 Nm, 1,995 kg
(vehicle.rs hypercar(), which carries the sources). Built by `tools/rally/build_corsaire_w16.py` on the
same cage as the Fulmine: body 4.48 m (4.54 m over the splitter and exhausts), crown 1.212 m, waist
1.00 m half width. Its signatures, drawn for this car and without any badge: a horseshoe grille (dark
mesh in a polished surround with five bars) on a flat nose face; a polished C-shaped line round the
door that is also the side intake's leading edge; a polished spine along the crown over a shallow
tent roof (crown crease); four small headlamps in a rising diagonal at each corner; a full-width
tail lamp bar 1.6 m long; quad round exhausts in a black diffuser panel under the plate; louvres either
side of the spine; five twin-spoke polished wheels, 20 in front and 21 in rear rims. Deep blue
clearcoat. 69,919 triangles, 13 materials, 2.3 MB. Defect fixed in the renders: the C first read as
two loose lines, because its back curve fell inside the tucked intake and then because a strip laid
on hits 14 cm apart cut the chord under the bulging waist (the path is now resampled every 2.5 cm).

### Sandpiper 1600 (kind 5, `buggy`)

Reference: the Meyers Manx (1964) on a shortened flat-four floor pan: 2.03 m wheelbase (vehicle.rs
buggy(): mounts z 1.016), 1.31 / 1.35 m track, 620 kg, an open fibreglass tub with no doors, a short
flat windscreen, a roll hoop, the air-cooled flat four exposed behind the rear axle, chrome nerf bars,
balloon tyres on 15 in rims, wider at the back. Built by `tools/rally/build_sandpiper.py` on the same
cage, soft (only the tub's rims, the tail edge and the material edges are creased). The tub is open by
shape, not by missing faces: in the cockpit stations the section drops into a well (rim, inner wall,
floor), so the shell stays a closed solid and the exact boolean still cuts the arches with liners. The
engine bay is a second well between the rear fenders, and the tail is a low convex valance so the flat
four shows above it (a U-shaped tail cap subdivides from its vertex mean, which falls in the notch, and
folds across the bay). Arches 9 cm off the tread for 25 cm of travel. Chartreuse gelcoat. 57,092
triangles, 1.7 MB. Tyre prints `mud` (knobbly) for the sand.

No W16 or flat-four recordings: both borrow the Aster's six, like the Fulmine and the Petrel.

### Hero cars: frame time

GPU ms per frame on the M5 Pro at 2560x1267, one run per car while other lanes held the GPU, each car framing a slightly
different view, so read differences of a millisecond or two as noise:

| Car | GPU mean (median) | Opaque pass |
|---|---|---|
| Aster RS (baseline) | 9.97 ms (9.62) | 3.94 ms |
| Fulmine V10 | 7.99 ms (7.55) | 3.00 ms |
| Petrel GT | 9.51 ms (9.13) | 3.69 ms |
| Corsaire W16 | 8.98 ms (8.41) | 3.43 ms |
| Sandpiper 1600 | 9.25 ms (9.04) | 3.61 ms |

None of the hero cars costs more than the Aster, so none needs a reduced-detail LOD yet.

Best of each: Aster 8.32 ms, Corsaire 8.16 ms. The Corsaire still costs no more than the Aster.

## Corsaire W16, form pass: round and muscular, two-tone, round arches

## Everyday traffic

**Reference** (2024 model-year manufacturer spec sheets; shapes are ours, sizes are theirs):

| Root | Kind | Sized after | Length x width x height | Wheelbase | Track | Tyre (radius) |
|---|---|---|---|---|---|---|
| `ParkedHatch` | small hatch | Corolla hatch (E210) | 4.37 x 1.79 x 1.44 m | 2.64 m | 1.54 m | 205/55 R16 (0.316 m) |
| `ParkedSedan` | mid sedan | Camry (XV70) | 4.885 x 1.84 x 1.445 m | 2.825 m | 1.58 m | 215/55 R17 (0.334 m) |
| `ParkedSuv` | compact SUV | RAV4 (XA50) | 4.60 x 1.855 x 1.685 m | 2.69 m | 1.61 m | 225/65 R17 (0.362 m) |
| `ParkedUte` | dual-cab ute | HiLux SR5 double cab | 5.325 x 1.855 x 1.815 m | 3.085 m | 1.54 m | 265/60 R18 (0.388 m) |
| `ParkedVan` | van | HiAce LWB (H300) | 5.265 x 1.95 x 1.99 m | 3.21 m | 1.66 m | 215/70 R16C (0.354 m) |

Mix: the car park's bays follow roughly the 2024 new-car sales mix (SUVs over half, utes and vans about
a fifth, passenger cars the rest; `PARKED` in `src/ferry/Terminal.js`, a game choice); the traffic picks
the six bodies evenly (`MODELS` in `src/ferry/Traffic.js`).

**Model.** Each body is one loft along the car: a 15-point half-section (underbody, wheel well, rocker,
door with a 12 mm bulge, shoulder, glass, roof) at stations every 9 cm and densely round the arches,
through monotone cubic keylines (roof, bonnet, belt, sill, plan width) that pass through the reference
points without overshoot. Faces take their material from where they sit, so the glass, pillars, wells
and panels share edges. Lamps are patches lifted off the same surface (a black housing with a reflector
lens; tail lamps wrap the rear corners); door cuts, the bonnet shut line, belt seals and drip rails are
thin tubes on it; mirrors, handles, wipers, plates, roof rails (SUV), a tonneau and rear step (ute), a
sliding-door rail and rear-door glass (van). The dash, steering wheel (right-hand drive) and seats show
through the glass. Wheels: a tyre section with sidewalls, shoulders and two grooves, an alloy rim with
lip, dish and 5 to 10 spokes, a dark disc behind them.

**Colliders.** Each model's four collider boxes (`FIT` and `LOW` in `src/ferry/Traffic.js`: two of the
car physics' shapes fore and aft, and the pair under them) cover the body that `parked_cars.glb` measures
to 0.15 m at the nose, tail, sides, painted roof and underbody (`test/traffic-wheels.mjs`, colliders
cover each body; shapes read from `rally-physics/src/vehicle.rs`). Red first: the van's stood 0.19 m
under its roof. The van now lifts its stack -0.2 m and the Ridgeback -0.03 m. The roof is the painted
roof: the Ridgeback's 2.31 m rack over its 0.29 m underbody is more than one Jeep stack (1.64 m tall)
spans, and a rack stands above the line a bonnet meets.

**Paint.** One shared material, `Paint`, white at 0.8; each car multiplies it by a factory colour
(`src/ferry/carPaint.js`: white 30 %, grey 18 %, silver 14 %, black 14 %, dark blue 10 %, red 7 %,
bronze 4 %, dark green 3 %, a game choice after the global colour-popularity reports) through an
instance colour: the car park's instanced bodies one per bay (fixed by the bay's hash), each traffic
car one per body (its paint drawn as a one-instance InstancedMesh in its own group, so it keeps its
motion vectors). No material and no draw per colour.

**Budget.** Body 8.3k to 8.9k triangles (hatch 8372, sedan 8568, SUV 8596, ute 8814, van 8326; the ute
and van loft a little coarser for their length), wheels 1484 to 1560 each (under `WHEEL_TRIS` 1600). Draws a moving car: 5 body materials (Paint, Glass, Trim,
Lamp, TailLamp) and 2 wheel (Trim, Rim) = 7, the `traffic-wheels.spec.js` bound. The car park stays
one instanced mesh per model and material.

**Controls and transitions.** None new: the cars are other people's; the models load with the terminal.

**Edges.** The colliders (`FIT` in Traffic.js) keep the two shapes the physics has: the Aster's for the
hatch and sedan, the Jeep's for the SUV, ute and van, each pair offset to span the body's length.

**Evidence.** `test/traffic-wheels.mjs` reads the game's own `MODELS`, `PARKED` and `FIT` and holds
every body to its class (3.8 to 5.6 m long, 1.7 to 2.0 m painted width, under 2.1 m tall; the
Ridgeback, lifted on 37-inch tyres with a rack, under 2.35 m), four wheel nodes at the hubs, the
shared Paint, 6k to 9.5k body triangles and 7 draws. Red before (`ParkedHatch drives in the traffic
(Traffic.js MODELS: ParkedAster, ParkedJeep, ParkedWagon, ParkedPickup)`), green after (4/4).
`test/browser/traffic-wheels.spec.js` adds a Then step: the traffic draws only the everyday bodies, the
car park holds more than ten painted bodies in four or more colours, captured as `traffic-carpark.png`.

### Everyday traffic: frame time (`?bench`, terminal views)

| View | Before mean (median) | After mean (median) |
|---|---|---|
| Terminal lanes (16 traffic cars) | 8.900 ms (8.172) | 8.501 ms (8.255) |
| Car park (973 parked instances) | 13.015 ms (12.613) | 10.314 ms (10.139) |

No regression: the everyday bodies cost no more than the decimated imports they replaced, and draws stay at
7 a car (5 body materials and 2 wheel materials). A far LOD for the parked rows was not needed.

### Everyday traffic: colours, bumper face and headlamps

### The Ridgeback rework

## Low-speed contacts: knocks are not crashes

Reference. ECE R42 and US 49 CFR Part 581 require lights, cooling and suspension to survive 4 km/h (2.5 mph) barrier hits front and rear. RCAR's low-speed structural test at 15 km/h (4.2 m/s) damages only the bumper and crash boxes. A wheel comes off only from a hub-square hit near 50 km/h (the model's SNAP, 14 m/s).

Kept: a 40 km/h nose-in still steams and a 50 km/h hub-square hit still snaps the wheel. `test/damage-low-speed.mjs` pins all of this (in `test:simulation`): the deck at rest, backing down a heaving ramp, under way onto a parked pickup, the check-in boom at 0 and 5 km/h, forty 4 m/s knocks, a pickup creeping into her nose at 2 m/s through hitched frames (0.3 s wall, 0.1 s handed on, as `src/engine/Engine.js` clamps), and the keepers.
