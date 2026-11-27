# Strait suspension bridge: Tidewater Island to Joey Island

## Design: Strait suspension bridge

Reference:
- Golden Gate Bridge and Humber Bridge suspension ratios: main span ~60 to 68 percent of total suspended length, main cable sag-to-span ratio ~1:7 to 1:9, twin H-frame portal towers rising ~65 to 75 m above mid-span deck, concrete caisson piers resting on shallow shoals flanking the deep shipping channel.
- AASHTO LRFD Bridge Design Specifications and navigable channel clearance: two-lane highway bridge deck 7.4 m clear roadway (`halfWidth = 3.7 m`) between raised 1.05 m concrete Jersey barriers, flanked by 1.1 m pedestrian sidewalks and steel handrails; vertical navigation air draft well above the tallest local vessel (`Tidewater Spirit` measured `public/ferry/ferry.glb` radar mast top at `20.25 m` above waterline, beam `18.64 m`, length `51.3 m`).
- Declared aesthetic choices: weathered International Orange structural steel towers, main cables and stiffening box/truss girder; pale marine concrete caissons, anchorages, barriers and sidewalks; galvanised steel vertical suspenders, railings and streetlamp standards; red aviation obstruction beacons atop both 106 m towers.

Real outcome:
- Players can drive one continuous 9.4 km loop across both Tidewater Island and Joey Island without waiting for the ferry: from Tidewater's West Headland cliffs (`bridgeNorth`, 91.4 m), across the 637.2 m suspension bridge (`straitBridge`), down onto Joey Island's central valley (`bridgeSouth`, 235.0 m) and onto `joeyLoop`, and back again at highway speeds (100 to 220+ km/h) with zero bump, lip or drop-through.
- The `Tidewater Spirit` ferry on its real scheduled `Autopilot` service sails freely underneath the 427 m main span in both directions (`Tidewater -> Joey` and `Joey -> Tidewater`) with at least 8 m vertical air-draft margin above its 20.25 m radar mast and at least 50 m horizontal clearance from both tower caissons, while manually steering the ferry into a tower caisson physically strikes it.
- Walkers can walk across the full 637.2 m bridge deck and sidewalks, bounded by solid side railings.

Source of truth:
- `src/world/TerrainData.js` and `src/world/CoastalRoute.js` own the graded island terrain and both approach roads (`bridgeNorth`, `bridgeSouth`), pinning their bridge-end elevations and tangents directly to `BRIDGE` constants from `src/world/StraitBridge.js`.
- `src/world/StraitBridge.js` owns the single bridge geometry (`P0 = [-250, 138]`, `P1 = [5, 722]`, `L = 637.24 m`, towers at `T1 = 105 m` and `T2 = 532 m`, main span `427 m`, arch `deckY(s) = 16 + 5*u + 18*sin(pi*u)`, peak `36.5 m`, soffit `34.3 m`), its 5 merged static meshes, its walker/ferry `Colliders`, and its pitched Avian car physics platform (`id = 20`).
- `src/ferry/FerryService.js` and `src/ferry/FerryShip.js` drive the real ferry across the strait unmodified; `src/rally/RallyDrive.js` attaches the bridge's pitched asphalt platform into Avian once at init.

Budget:
- GPU: 5 merged static draw calls total (`Strait bridge asphalt`, `Strait bridge steel`, `Strait bridge concrete`, `Strait bridge fittings`, `Strait bridge lights`), ~26k triangles total. Measured on `?bench` at 2560x1267: `straitBridge` view runs at 7.394 ms GPU (wall 13.227 ms).
- CPU: Zero per-frame heap allocations; stationary kinematic Avian compound (`id = 20`) with pitched deck slabs, concrete Jersey barriers and tower shafts; O(1) static collision checks.

Detail by distance:
- Full 106 m twin towers, sweeping main cables, suspenders and stiffening girder stay visible across the entire 2 km island basin as a landmark silhouette from the beach, pier, ferry deck, village and Joey Island.
- Roadway asphalt shares the same procedural weathered seal, antialiased centre dashes and edge lines (aligned at +/-2.55 m with island roads) as `CoastalRoad`.

Controls:
- Same driving and walking controls as everywhere else (W/S/A/D, Space handbrake, J aids, R recover, T repair, E enter/leave).
- New `Start at` menu option: `Suspension bridge` (`straitBridge`), spawning on the north approach facing straight south across the 637.2 m span.

Transitions:
- North abutment (`s = 0`, `[-250, 138]`, `y = 16.0 m`, `+9.7%` grade): `bridgeNorth` grades straight along the bridge axis for the last 16 m with heights held directly to `BRIDGE.deckY(s)` so the expansion joint onto the pitched asphalt deck is flush.
- South abutment (`s = 637.24`, `[5, 722]`, `y = 21.0 m`, `-8.1%` grade): the South Approach Viaduct passes `14.5+ m` above `joeyLoop` at `z = 706`, lands squarely on Joey Island's natural 21 m north bluff crest, and `bridgeSouth` grades straight off the expansion joint and sweeps smoothly onto `joeyLoop` at `[158, 874]`.
- Bridge physics deck slabs extend 5 m into both graded earth abutments beneath the approach seal so a car's four tyres transition seamlessly between heightfield and bridge platform with zero wheel drop.

Edges:
- Ferry navigation clearance: both scheduled autopilot crossings (`Tidewater -> Joey` and `Joey -> Tidewater`) cross strictly inside the 427 m main span (`s` well inside `T1 + 25 .. T2 - 25`) with > 45 m horizontal distance to both caisson piers and > 8 m vertical air-draft margin above the 20.25 m radar mast.
- `joeyLoop` overpass clearance: at `z = 706` (`s = 616 m`), bridge soffit is > 14 m above `joeyLoop` (`6.4 m`), and solid walker side rails stop at `s = 580 m` so no 2D ground-road collider check conflicts with `joeyLoop`.
- Submerged caisson pier colliders terminate at `y = 6.8 m` (19+ m below deck) so boats and swimmers hit the pier while roadway traffic drives unimpeded overhead.
- Existing Tidewater road grading runs first in its original bounding box so chairlift tower heights (`test/frame-garbage.mjs`) and summit hike routes (`test/walker-cadence.mjs`, `test/debris-clear-zones.mjs`) remain bit-identical.

## Evidence and Perf

- Red-first Node test `test/strait-bridge.mjs` (failed `ERR_MODULE_NOT_FOUND` before implementation; 3/3 pass after, wired into `npm run test:simulation`): verifies both scheduled ferry crossings, full 637.2 m WASM car crossing on continuous asphalt with all static world colliders loaded, flush approach joints with zero cliffs, continuous walker deck support, and <= 5 draw calls.
- Playwright real-product BDD (`test/browser/driving-overhaul.spec.js` Scenario 3 + `test/browser/crossing.spec.js`): real W/A/D driving across the suspension bridge onto Joey Island (reaching 96 km/h on arrival) and real scheduled `Tidewater Spirit` ferry crossings sailing underneath both ways with zero hull damage.
- Whole-frame captures (`view-straitBridge.png`, `view-straitBridgeDeck.png`, `view-westHeadland.png`, `bridge-crossing-joey.png`) reviewed in full; three defects caught during inspection (caisson pier collider extending through roadway, flat abutment wall protruding above sloped approaches, and minor outer-shoulder joint shadow lip) were all fixed and re-verified.
- `?bench` at 2560x1267 (best of 3): `straitBridge` 7.394 ms GPU / 13.227 ms wall; `westHeadland` 7.112 ms GPU / 11.766 ms wall.
