# Island driving overhaul: road network, steering and collision fidelity

Design note for the driving overhaul across Tidewater Island and Joey Island. Four connected gaps are addressed together: expanding the short road loop into an island-wide multi-discipline network, fixing sluggish turn-in and high-speed steering collapse, matching physical collision hulls to rendered geometry so objects do not poke through each other, and making poles, leaning palm trunks, trees and parked cars solid.

## Reference

- **Road geometry and grades.** AASHTO *A Policy on Geometric Design of Highways and Streets* (7th ed., 2018) and Austroads *Guide to Road Design Part 3*: two-lane coastal/rural highways use 5.4 to 6.0 m sealed carriageways (`halfWidth = 2.7 m`), maximum sustained mountain grades of 10 to 12 percent (up to 15 to 17.5 percent on short technical descents), and smooth vertical curves whose grade changes at most 2 percent per metre (`K >= 50 m`).
- **Steering rack and tyre slip peak.** Road-car steering locks run 2.2 to 2.8 turns lock-to-lock, with quick driver inputs reaching cornering lock in 0.08 to 0.12 s. Modern street and semi-slick tyres (Pacejka Magic Formula street reference; Michelin Pilot Sport Cup 2) peak at 8 to 10 degrees lateral slip angle on dry asphalt with a progressive 15 to 18 percent friction drop past peak rather than a cliff at 7 degrees.
- **Vehicle collision bounds.** Measured directly from each shipped GLB (`BodyStatic` excluding wheels) in `public/rally/` and `public/ferry/parked_cars.glb`:
  - `aster_rs.glb`: 2.18 x 4.66 m body (was 1.72 x 4.10 m hull: 23 cm side and 28 cm end overhang).
  - `black_jeep.glb`: 2.41 x 4.96 m body (was 1.82 x 4.16 m hull: 30 cm side and 40 cm end overhang).
  - `concept_gt.glb`: 2.34 x 4.36 m body (was 2.20 x 4.30 m).
  - `cosier_gt3rs.glb` / `gt3rs_zry.glb`: 1.99 to 2.05 x 4.48 to 4.56 m body (was 1.90 x 4.55 m).
  - `fulmine_v10.glb`: 2.05 x 4.61 m body (was 1.90 x 4.45 m).
  - `corsaire_w16.glb`: 2.14 x 4.59 m body (was 2.00 x 4.48 m).
  - `sandpiper.glb`: 1.59 x 3.55 m body (was 1.50 x 3.30 m).
  - Parked terminal cars (`parked_cars.glb`): Wagon 2.22 x 5.03 m, Pickup 2.39 x 5.57 m, Aster 2.18 x 4.66 m, Jeep 2.51 x 4.96 m.
- **Vegetation trunk geometry.** `src/world/vegetation/PlantGeometry.js` and `VegNodes.js`: palm trunks curve horizontally by `leanDir * lean * fc(u) * H` (up to 0.6 to 1.1 m horizontal shift at car bumper/roof height) with ground/bumper radius 0.26 * scale; broadleaf trunks have radius 0.34 to 0.44 * scale near bumper height.

## Real outcome

1. **Island road network.** Expand total drivable roads from 2.94 km to 9.40 km across both islands (8,763.5 m graded island roads plus the 637.2 m inter-island suspension bridge; see `docs/strait-bridge.md`) by adding:
   - West Headland cliff loop (`westHeadland`, 827.7 m asphalt loop out to the sea-stack bluff).
   - Grand Island Perimeter highway (`islandHighway`, 2,238.3 m sweeping coastal/valley highway looping west, north past the three wind turbines, and down the east flank onto `ferryRoad`).
   - High Mountain Touge pass (`mountainPass`, 790.7 m switchback climb along the western massif bench into `islandHighway`).
   - East Headland coastal loop (`eastHeadland`, 515.1 m asphalt scenic loop off `ferryRoad`).
   - Rainforest gravel rally stage (`rallyStage`, 520.5 m loose-surface gravel stage cutting through the northern rainforest valley).
   - Joey Island East Peninsula loop (`joeyPeninsula`, 518.3 m asphalt extension across Joey Island's east bluff).
   - Suspension bridge approaches (`bridgeNorth` 91.4 m on Tidewater Island, `bridgeSouth` 235.0 m on Joey Island) linking both island networks across the strait into one continuous driving loop.
   Every path grades smoothly into the shared heightfield with zero vertical kinks (> 2 percent/m), zero terrain cliff steps (> 1.4 m per metre), outside-bend cut-bank shoulder clearance, and zero trees, rocks or structures on any road.
2. **Responsive, arcade-accessible steering without high-speed collapse.**
   - Turn-in reaches target lock in ~0.09 to 0.11 s (return and countersteer in ~0.06 to 0.07 s).
   - At 80, 120, 160 and 200 km/h on dry asphalt, full steer produces smooth, sustained high-g cornering without collapsing lock to 1.7 degrees, without ESC braking the outside front wheel during normal corner entry, and without yaw-rate reversal.
   - Turning driving aids off (J) preserves raw manual lock, burnouts, handbrake drifts and donuts.
3. **Zero object poke-through and full static/dynamic obstacle solidity.**
   - Vehicle compound colliders match rendered body dimensions within a few centimetres while preserving ground clearance for logs and crests, and use non-linear swept CCD for fast rotating corners.
   - Heightfield internal triangle edges are constrained (`HeightFieldFlags::FIX_INTERNAL_EDGES`) so low bumpers never launch on graded sags.
   - Breakable fence pieces spawn clear of the hitting car's hull; dynamic props use linear swept CCD; rocks down to 0.55 m get matching cylinder colliders; detached wreckage bounces off static world colliders.
   - Roadside guide posts, all ~120 parked terminal cars, missing terminal bollards/lamp posts/gate posts, Joey Village parking sign, evacuation sign posts, glider station fixtures, leaning palm trunks (segmented along their exact shader curve) and full-radius tree trunks are solid to cars, and trunks also block the walker via a spatial grid in `Colliders`.

## Source of truth

- Terrain and road surfaces: `src/world/TerrainData.js` and `src/world/CoastalRoute.js` own the single heightfield, road segments, surface lookup and plant/rock clearance (`terrain.pathDistance`, `terrain.roadSurfaceAt`).
- Road rendering and roadside furniture: `src/world/CoastalRoad.js` reads `CoastalRoute` directly.
- Vehicle geometry and physics: `rally-physics/src/vehicle.rs` and `src/rally/Vehicles.js` stay in strict parity (`test/vehicle-parity.mjs`); `rally-physics/src/controller.rs`, `road.rs`, `lib.rs` and `props.rs` own all vehicle and prop forces at 120 Hz.
- Static and dynamic world collision: `src/world/Colliders.js`, `src/rally/WorldPhysics.js`, `src/ferry/Terminal.js`, `src/joey/Village.js`, `src/world/Rocks.js`, `src/physics/Props.js`, `src/rally/Wreckage.js`.
- Disaster integration: `src/disasters/Bodies.js` reads parked car colliders directly from `Terminal` so lifted cars disable and restore their static boxes cleanly.

## Budget

- **GPU:** At most 2 additional draw calls for the entire +8 km road expansion by batching all new asphalt highways into one shared mesh/material (using per-vertex merge mask attributes instead of one shader per branch) and the gravel rally stage into one mesh/material. Target delta on `?bench` at 2560x1267: <= 0.3 ms GPU across matched views.
- **CPU (physics):** Add a uniform 2D spatial grid inside `RoadSurfaces` (`rally-physics/src/road.rs`) so per-wheel surface lookup stays O(1) (~10 to 30 segments per cell) instead of linearly scanning ~14,000 segments at 480 Hz. Zero per-frame heap allocations in `Colliders.resolveCapsule`, `Wreckage.update` and `controller.rs`.
- **Memory:** Static trunk cylinders stay cell-batched into 64 m compounds inside Avian (`STATIC_CELL`), and the walker trunk spatial grid uses flat index arrays.

## Detail by distance

- New asphalt and gravel ribbons reuse `CoastalRoad`'s distance-scaled view-ray lift (`LIFT`), anisotropic photo textures and screen-space antialiased markings (`crLine`), keeping crisp edges close up and zero z-fighting at 500+ m.
- Guardrails and guide posts merge into the existing single steel mesh and single guide-post mesh (no per-post draw calls).
- Parked terminal car colliders add zero extra draw calls (instanced meshes are unchanged).

## Controls

- Driving controls are unchanged: W/S throttle and brake/reverse, A/D steer, Space handbrake, J toggle aids, R recover, T repair, E enter/leave, Y yeet, F free camera.
- New start points are added to the existing `Start at` picker in `src/rally/DriveHUD.js` (`West Headland cliffs`, `Suspension bridge`, `North Coast highway`, `High Mountain pass`, `Rainforest rally`, `Joey East peninsula`) alongside all ten existing starts.

## Transitions

- Every new road merges onto its parent road on the parent's tangent and pinned height (`profile()`), with edge-line gaps and parent-seal alpha cutouts so asphalt transitions are seamless.
- Driving from asphalt onto the gravel rally stage or beach sand updates wheel surface codes immediately via `RoadSurfaces` without a frame gap.
- Walking into trees/palms or parked cars stops smoothly along the tangent without snagging; driving into parked cars, poles, guide posts or leaning palms transfers impact impulses into `Damage`.
- During disasters, a parked terminal car picked up by wind or water disables its static collider box and restores it on disaster reset.

## Edges

- Wind farm exclusion: `islandHighway` and `rallyStage` stay at least 30 m from `WT-01`, `WT-02` and `WT-03` footings so `verifySites` and `test/windfarm.mjs` remain untouched.
- Glider stairs, chairlift and evacuation boardwalk: new mountain roads route around the summit stair/chairlift corridor (`x < -110` on the upper mountain) and stay clear of all built footprints.
- Existing road names and metrics (`route.length`, `route.maxGrade`, `circuitLength`, `ferryRoadLength`, `joeyLoopLength`) retain their exact meanings; `route.totalLength` reports the combined network.
- Terminal road entry and marshalling lanes: terminal gate post and parked car colliders stay strictly outside the driving lanes (`test/browser/joey-road.spec.js`, `test/terminal-flat.mjs`).
- Non-finite inputs remain guarded at every Rust WASM boundary.

## Evidence

- **Rust physics (`npm run test:physics`):** 69/69 tests pass, including fast turn-in (< 0.15 s), sustained high-speed cornering at 120 and 160 km/h (Aster RS 0.94 to 0.95 g, Fulmine 1.11 g, GT3 RS 1.40 g without lock collapse or yaw reversal), heightfield internal edge non-launch, and visual-matched car hull contact bounds.
- **Node simulation (`npm run test:simulation` + road/bridge suites):**
  - `test/driving-overhaul.mjs`: 6/6 pass (8,763.5 m graded road network, 0 walls, < 0.12 m surface drift, 0 kinks, leaning palm curve match within 18 cm, full-radius tree trunks blocking walkers, solid guide posts, solid parked terminal cars, terminal gate posts/bollards, medium rock colliders, GLB hull parity within 15 cm, wreckage world bounce).
  - `test/strait-bridge.mjs`: 3/3 pass (both autopilot ferry crossings clear main span with > 8 m vertical and > 45 m horizontal margin, real WASM car crosses the full bridge on continuous asphalt, both approaches flush with continuous walker deck support and <= 5 draw calls).
  - `test/coastal-grade.mjs` (3/3), `test/ferry-road.mjs` (4/4), `test/terminal-flat.mjs` (3/3), `test/gt3-handling.mjs` (6/6), `test/vehicle-parity.mjs` (2/2), `test/frame-garbage.mjs` (6/6, bit-identical chairlift hash `348389eda0caa921`), `test/walker-cadence.mjs` (9/9), `test/debris-clear-zones.mjs` (1/1), `test/windfarm.mjs`, `test/chairlift.mjs`, `test/glider-station.mjs` all pass.
- **Playwright real-product BDD:**
  - `test/browser/driving-overhaul.spec.js`: 4/4 pass (North Coast highway responsive high-speed turn-in and all new named starts, W/A/D driving collision into Town backroad guide post and Ferry terminal parked car, W/A/D inter-island suspension bridge crossing onto Joey Island, whole-frame review captures).
  - Existing browser suites: `coastal-road.spec.js`, `ferry-road.spec.js`, `joey-road.spec.js`, `gt3-handling.spec.js`, `rally.spec.js` (including 700x800, 820x700 and 960x540 dock layout checks), `crossing.spec.js` (scheduled ferry sailing under the bridge both ways), and `npm run test:pages` (`donuts.spec.js` and `single-player.spec.js`) all pass.

## Perf (`?bench` at 2560x1267)

Measured with `tools/frame-bench.mjs` at 2560x1267 (`scale=1`, best of 3 runs after; baseline captured on unmodified `fork/main` commit `9fc4623`):

| View | GPU ms before | GPU ms after | Delta | Notes |
|---|---:|---:|---:|---|
| `beach` | 10.707 | 8.424 | -2.283 | Opaque 2.349 ms, water 1.466 ms; within 16.6 ms budget |
| `village` | 9.679 | 7.184 | -2.495 | Opaque 3.186 ms, TAAU 0.663 ms |
| `aerial` | 11.906 | 7.981 | -3.925 | Opaque 2.789 ms, water 1.686 ms |
| `palms` | 8.971 | 6.987 | -1.984 | No regression from curved palm collider segments |
| `straitBridge` | (new) | 7.394 | n/a | 5 merged bridge draw calls, wall 13.227 ms |
| `westHeadland` | (new) | 7.112 | n/a | Batched highway network + north abutment, wall 11.766 ms |
