# Vacation premise, BeamNG-style radial menu and effortless vehicle mount/recall

## Design: Island holiday sandbox UX and vehicle mounting

Reference:
- BeamNG.drive radial wheel and Kurtenbach/Buxton marking-menu ergonomics: 6 primary wedges at 60 degrees per sector around a 46 px neutral deadzone hub and 154 px outer ring. Holding `Tab` or `Q` (>= 180 ms) lets the player flick toward a wedge and release to execute; tapping (< 180 ms) latches the ring open for browsing sub-rings by click or arrow/number keys.
- Real-world PWC safety lanyard cut-off (USCG/ABYC T-10 emergency engine cut-off switch): when the rider steps off or is thrown from a personal watercraft, the lanyard kills propulsion and hull immersion plus a drogue/brake drag arrests forward glide within ~3 to 5 m on a step-off and ~10 to 15 m from 65 km/h on a wipeout, rather than coasting 50+ m across the bay.
- Vehicle entry ergonomics: 4.5 m door reach around a 5 m 4x4 (was 2.4 m, barely past the bumper), 6.5 m open-water climb-aboard reach on a bobbing jetski (was 3.2 m), and 5.5 m boarding reach at the boat stern (was 4.2 m).
- Declared premise: Tidewater is an open-world two-island family holiday sandbox where you have just landed and can do anything you feel like (drive cars across 9.4 km of roads and the 637 m suspension bridge, ride rocket jetskis, fly the carrier jet, hang glide off the volcano, ride the chairlift, helm the car ferry, fish the reef, or stir up a storm).

Real outcome:
- Loading screen (`index.html`), start overlay (`UI.js`), replayable guide (`Guide.js`) and `F1` help sheet introduce the island holiday premise and rotate tips across driving, water craft, aviation, gliding, ferry, weather/disasters, and fishing rather than framing the whole game as a fishing simulator.
- Entering the island drops the player straight into the live world with zero blocking fishing tutorial modal, showing only a brief non-blocking arrival pill (`Hold Tab or Q for Activities · E to interact · G to recall your ride`).
- Fishing HUD (`$0 / Cooler` purse and `ATM PIN` chip) stays hidden while exploring or driving and fades in contextually when holding the rod, near vendors/boat, or near an ATM.
- One translucent glass **Activity Wheel** (`src/ui/RadialMenu.js`, opened with `Tab`, `Q`, or a compact top-left `Activities` button) replaces the permanent top-left `World controls` debug strip and the persistent on-foot `Take a car` form card. Six primary wedges (`Drive`, `Water`, `Air`, `World`, `Ride`, `Places`) expose every car, road start, water craft, flight activity, disaster/weather tool, vehicle action, and island landmark.
- Dismounting a jetski (`E`) or wiping out engages lanyard water-braking so the ski stops nearby (`< 6 m` on step-off, `< 16 m` from 18 m/s on wipeout). Pressing `G` on foot or in the water recalls your last-used vehicle right beside you (bringing a jetski alongside and climbing aboard in water, or parking your car on clear flat ground ahead on land). For 8 seconds after a wipeout or car yeet (`Y`), pressing `R` snaps you straight back into the seat. `E` enters and leaves every vehicle consistently (including the hang glider).

Source of truth:
- `src/game/HudContext.js` owns the contextual HUD chip rule (`purse`, `pin`, `guidance`), reading live player mode, rod state, vendor/ATM proximity, and free-camera state with zero per-frame allocations.
- `src/ui/RadialMenu.js` owns the BeamNG-style radial menu DOM, SVG ring geometry, hold-and-flick vs tap-to-click state machine, and activity tree wired directly into existing systems (`RallyDrive`, `Jetskis`, `BoatController`, `Ferry`, `WorldTools`, `Aviation`, `Glider`, `Chairlift`, `Game`, `App.settings`, `VehicleRecall`).
- `src/player/VehicleRecall.js` owns last-vehicle history, the 8 s post-wipeout/yeet quick re-mount window (`R`), and safe ground/water recall (`G`) using shared `TerrainData`, `Colliders`, and `clearSpawn`.
- `src/jetski/JetskiController.js` owns physical unmanned lanyard water-braking (`disembarkBrake` decay integrated inside its existing implicit `FluidStep` solver).
- `src/game/Minimap.js` adds vacation POI markers (active parked car, live jetski, suspension bridge, ferry terminal, volcano summit) alongside existing vendor/boat markers.

Budget:
- GPU: 0 additional WebGPU draw calls or compute dispatches. The radial overlay is pure DOM/SVG hidden (`visibility: hidden`, `pointer-events: none`) during gameplay; `?bench` GPU ms delta at 2560x1267 target <= 0.05 ms.
- CPU: Zero per-frame heap allocations in `AppUI._syncView`, `HudContext.hudChips`, `VehicleRecall.update`, `JetskiController.step`, and `Minimap.update` (`test/frame-garbage.mjs` remains green).

Detail by distance:
- Minimap POI icons sit on the rim with directional arrows when outside the current map radius and smoothly enter the map window as you approach.
- Radial wheel renders only when open; specialist panels (`Disasters`, `Wind farm`, `Aviation`, `Hang glider`, `Chairlift`, `Animals`, `Evacuation`) stay hidden until chosen from the wheel.

Controls:
- `M` (or `Tab`): Hold-and-flick or tap-to-click Activity Wheel (`M` works across every mode including free camera and flight; inside inputs, dialogs, or open panels typing stays undisturbed).
- `U`: Mute / unmute global sound (also available inside `World -> More World` on the Activity Wheel).
- `I`: Cooler and fish log (separated from `Tab` so the Activity Wheel never collides with fishing inventory).
- `E`: Enter or leave any vehicle (car, jetski, boat, ferry helm, Kestrel jet, hang glider, chairlift terminal), talk to locals, use ATM.
- `G`: Recall last vehicle on foot or in water (while flying Kestrel: landing gear; while riding jetski: pick up/drop off mate).
- `R`: Within 8 s of a jetski wipeout or car yeet: quick re-mount; otherwise equip/stow fishing rod on foot or recover car while driving.
- `F1` / `?`: Updated holiday sandbox controls sheet with replayable guide.

Transitions:
- Splash -> live island: `Click to explore` (or `Enter`) enters directly into walking mode with no blocking modal; non-blocking welcome pill fades out after 6 s.
- Radial hold vs tap: pressing `Tab` or `Q` unlocks pointer lock and opens the wheel immediately; releasing after >= 180 ms while hovering a wedge activates it (or opens its sub-ring); releasing within < 180 ms with no flick leaves the wheel latched open for clicking until selection or `Esc`.
- Dismount -> water/land: `Jetski.dismount` sets `ctl.disembarkBrake = 2.5` s and damps residual velocity gently so the ski settles alongside the rider; `throwRider` sets `ctl.disembarkBrake = 3.0` s and opens `VehicleRecall`'s 8 s quick-remount window.
- Recall (`G`): in water, brings the live jetski upright to 2.5 m ahead of the swimmer with a splash and mounts smoothly; on land, places the selected car on the nearest clear flat spot 4 to 10 m ahead via `clearSpawn` and faces the player toward it.

Edges:
- Non-finite player positions or headings are rejected before recall placement.
- Chairlift active guard: radial activities and vehicle recall respect the existing chairlift safety guard (exit at a terminal first).
- ATM and vendor proximity: walking within 18 m of an ATM or opening the ATM screen reveals the `Card PIN` chip; holding the rod, catching fish, boarding the fishing boat, or visiting Joe/Marta/Dazza/Bev reveals the purse/cooler chip.
- Narrow viewports (390 px mobile portrait, 960x540 desktop): radial wheel scales cleanly via `min(340px, 84vmin)` and never overlaps top banners or bottom telemetry.

Evidence plan:
- Red-first Node test `test/vacation-radial-vehicles.mjs` (added to `npm run test:simulation`): verifies contextual `hudChips` hiding purse/PIN on plain walk and revealing them when fishing or near ATM, verifies real `JetskiController` lanyard braking stops a dismounted ski from 18 m/s within 15 m (and step-off within 6 m), verifies `VehicleRecall` ground/water recall and 8 s post-wipeout quick remount, verifies radial wedge geometry and sector selection, and verifies vacation premise copy in `index.html`.
- Playwright Given/When/Then BDD suite `test/browser/vacation-radial.spec.js`: verifies vacation loader and modal-free arrival with clean contextual HUD, opens the BeamNG radial menu with `Tab`/`Q` and launches a car onto the Suspension bridge and opens Disasters cleanly, rides a jetski at speed then dismounts (`E`) and verifies the ski brakes nearby and `G` recalls/climbs back aboard smoothly.
- Whole-frame visual captures of arrival view (clean uncluttered ocean/island), open radial wheel (top ring + Drive sub-ring), and jetski dismount/recall reviewed in full.
- `?bench` GPU ms check at 2560x1267 confirming zero frame-time regression.

## Model and implementation

- **Holiday sandbox entry**: `index.html`, `src/ui/UI.js`, and `src/game/Guide.js` frame Tidewater as a two-island family holiday sandbox. The blocking three-card fishing modal no longer auto-opens on first arrival (`_wait = -1`); a non-blocking arrival tip fades in at 0.9 s and hides automatically whenever the Activity Wheel or any vehicle/flight HUD is active.
- **Contextual HUD (`src/game/HudContext.js`, `src/ui/AppUI.js`, `src/game/Atm.js`, `src/game/Game.js`)**: `hudChips()` takes `fishing` and `nearAtm` flags computed without per-frame heap allocation. The fishing purse/cooler stays hidden on plain beach exploration and driving, and appears when the rod is equipped, during a fight/landing, on the fishing boat, near Joe/Marta/Dazza/Bev (14 m), or inside the cooler/stand. The ATM card PIN chip appears only within 18 m of an ATM or while using an ATM.
- **BeamNG-style Activity Wheel (`src/ui/RadialMenu.js`)**: A compact top-left `Activities [Tab]` frosted pill replaces the permanent `World controls` debug rail (`WorldTools.js`) and the arrival `Take a car` form card (`DriveHUD.js`). Holding `Tab` or `Q` (>= 180 ms) lets the player flick onto any wedge and release to launch; tapping (< 180 ms) latches the ring open for clicking, arrow keys, or `1`-`8` shortcuts. Six primary wedges (`Drive`, `Water`, `Air`, `World`, `Ride`, `Places`) launch cars, highway starts, jetskis, boats, the car ferry, carrier jet, hang glider, chairlift, disasters, time-of-day presets, wind farm, wildlife, vehicle recovery/recall, and landmarks.
- **Effortless mount, dismount and recall (`src/jetski/JetskiController.js`, `src/jetski/Jetski.js`, `src/player/VehicleRecall.js`, `src/player/Player.js`, `src/glider/Glider.js`)**:
  - `JetskiController` applies lanyard cut-off water braking (`disembarkBrake`, `560 * wetD` isotropic water-relative damping inside the implicit `FluidStep` solver) whenever the rider dismounts (`E`) or wipes out (`throwRider`), arresting forward glide within 16 m even from 18 m/s (65 km/h).
  - `VehicleRecall` tracks the last vehicle used, opens an 8 s post-wipeout quick re-mount window (`R`), and binds `G` on foot or in water to summon the ride beside the player (pulling the live jetski upright alongside and mounting smoothly in water; delivering the car via `clearSpawn` at least 6 m clear of the player and obstacles on land, with `recoverySpot` fallback).
  - Walk-up / swim-up grab radii widen to 4.5 m (car), 6.5 m swim / 4.5 m land (jetski), and 6.2 m swim / 5.5 m land (boat). `E` enters and leaves every vehicle consistently including the hang glider.
- **Vacation minimap POIs (`src/game/Minimap.js`)**: Adds zero-allocation markers for the active parked car, live jetski, and suspension bridge (plus an International Orange bridge line on the baked map canvas).

## Controls

| Key | Action |
|---|---|
| `M` | Open the Activity Wheel (hold and flick to pick, or tap to browse with mouse, `1`-`8`, or arrows; `Esc` closes) |
| `U` | Mute / unmute global sound |
| `G` | Recall your last ride on foot or in water (in water: pull jetski alongside and mount; on land: deliver car nearby) |
| `E` | Enter or leave any vehicle (car, jetski, fishing boat, ferry helm, carrier jet, hang glider, chairlift), talk to locals, use ATM |
| `R` | Within 8 s of a jetski wipeout or car yeet: snap back on board; otherwise equip/stow fishing rod on foot or recover car while driving |
| `I` | Cooler and fish log |
| `` ` `` (Backquote) | Quick car selector dock on foot |

## Evidence

- **Red-first Node test**: `node --test test/vacation-radial-vehicles.mjs` failed before implementation with `ERR_MODULE_NOT_FOUND` on `src/ui/RadialMenu.js`. After initial implementation, `VehicleRecall` caught a real clearance defect (`recalled car distance 0.8 m out of safe nearby band`) where `clearSpawn` placed the car onto the player's own coordinates; passing player position in `peers` resolved it.
- **Green Node suites**:
  - `node --test test/vacation-radial-vehicles.mjs test/hud-context.mjs test/frame-garbage.mjs test/aviation-controls.mjs test/driving-overhaul.mjs test/strait-bridge.mjs` -> 39/39 passed.
  - `node --test test/jetski-fluid.mjs` -> 6/6 passed (including 257x257 extreme tsunami field and calm throttle planing envelope).
- **Playwright BDD suites**:
  - `test/browser/vacation-radial.spec.js` -> 2/2 passed (modal-free holiday arrival, contextual purse/PIN hidden, 6-wedge Activity Wheel driving onto Suspension Bridge, walking away + `G` car recall, jetski high-speed `E` dismount braking nearby + swim away + `G` recall remount).
  - `test/browser/hud-context.spec.js` -> 2/2 passed (contextual rod/free-cam HUD chips, keyboard `Tab` -> `World` -> `Wind Farm` + `Escape` focus return).
  - `test/browser/world-systems.spec.js` -> 5/5 passed (desktop 1440 px and portrait 390 px panel exclusivity, ambient wind, flight/wildlife modes, portrait coexistence).
  - `test/browser/driving-overhaul.spec.js` -> 4/4 passed (Activity Wheel Aster RS entry, highways, solid colliders, suspension bridge crossing, review captures).
  - `npm run test:pages` -> 2/2 passed (production Pages build, GT3 donuts, ZRY coastal road, zero errors/404s/sockets).

## Perf (2560x1267, best of 3 runs)

Measured via `node tools/frame-bench.mjs time --port 5207 --tag after-vacation --views beach,village,aerial,straitBridge --runs 3` against `fork/playable` (`af3cbe2`):

| View | GPU ms before | GPU ms after | Delta | Notes |
|---|---|---|---|---|
| `beach` | 8.424 | 8.376 | -0.048 ms | Within run-to-run noise; zero new GPU passes |
| `village` | 7.184 | 7.142 | -0.042 ms | Within run-to-run noise; zero new GPU passes |
| `aerial` | 7.981 | 8.024 | +0.043 ms | Within run-to-run noise; zero new GPU passes |
| `straitBridge` | 7.394 | 7.359 | -0.035 ms | Within run-to-run noise; zero new GPU passes |

