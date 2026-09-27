# Rally in Tidewater

The island renderer hosts the original Aster RS model and a Rust vehicle controller in
WebAssembly. Avian 0.5.0 and Bevy 0.18.0 run without a second renderer. Vehicle forces
execute at 120 Hz with eight solver substeps.

Since 25 September 2026 the controller is Tidewater's own (`rally-physics/src/controller.rs`):
a combined-slip tyre model, driveline, assists, buoyancy and damage hooks, documented in
`docs/rally-physics.md`. It started from Rally's controller; Rally still supplies the car
meshes and `driving/input.rs` (`DriveIntent`), whose SHA-256 hashes are in
`rally-physics/source-manifest.json`. The original Rally checkout is not modified.

## Integration notes

- Avian's `SpatialQuery` contains a mutable pipeline resource even for a raycast.
  A standalone Bevy `SystemState<SpatialQuery>` must use `get_mut(world_mut())`.

- With Bevy defaults disabled, explicitly enable `keyboard` and `gamepad` to
  compile the original input module. The general `std` feature does not export
  those input types. Browser intent enters through the bridge, without a second
  keyboard event loop or window.
- The cars use metres, Y up and +Z nose. Driver-right is -X in the car's local
  frame. Preserve the controller's corrected negative-Y right steering.
- Terrain samples live at texel centres, not at the heightmap domain edges.
  The collision field must preserve the half-texel shift and X/Z orientation.
  An asymmetric real-Avian raycast regression checks this boundary.
- Wheel visuals use the original pivot names, suspension lengths, steering and
  rolling speeds. Do not move the chassis onto an analytically sampled surface
  or inject steering yaw; those would bypass the physical simulation.
- The historical walking spawn `(18, -60)` is not clear for a car: decorative
  dinghies support its chassis. The car starts farther west on the dry beach;
  acceptance must prove four loaded wheel contacts on the actual full scene.

- Hiding a mesh is not enough to take it off a car: the damage rig
  (`buildDamageRig` in `src/rally/VehicleModel.js`) copies the model's meshes into
  its own dentable pieces, so a hidden mesh would come back drawn on the rig (the
  plate lettering showed twice). Remove the mesh from the model (as `paintPlate`
  does for PlateWhite and PlateBand), and the rig also skips any mesh with
  `visible === false`. The damage smoke and fire do not depend on rig meshes:
  they follow the front zone (`DamageState`, smoke from 0.5, fire from 0.9).
- The yeet ragdoll starts outside the car's walking box: its start is moved out
  of the door by the box half-width plus 0.15 m (`RallyDrive`, `walkingProxy.half.x
  + 0.15`). Started inside it, the walking collider shoved the body out and it flew
  20 to 90 m.
- The chase boom meets camera-only obstacles that the car never does: roofs and a
  0.9 m eave over each building, palm and tree trunks, and banana plants (a stem
  cylinder up through the crown, plus a pull of at most 3 m where the leaf spread
  sits at the lens; `cameraPlants` in `WorldPhysics.js`).
- The driving key strip is placed by measurement, not a width breakpoint:
  `DriveHUD.fitKeys` keeps it in the top row when it fits between the brand and
  mode pill and the purse, and drops it below (`.rh-keys.is-below`) otherwise.
- Ferry traffic gives way to the player's car (`src/ferry/Traffic.js`): a scripted
  car stops while the player's footprint, now or where its velocity takes it in
  the next 1.6 s, comes within 2.3 m of the car's next 9 m of road, and no car
  starts aboard while the player's car is moving in the lanes or aboard.

## Car dock

The start screen offer ends for good on the first walk of 4 m, a drive, the free camera, any
other mode or a teleport, or 60 s after the intro guide closes (`DriveHUD.offered`).

The "Take a car" dock (`src/rally/DriveHUD.js`, styles in `src/rally/rally.css`) is not a
permanent panel:

- Driving: always shown, as the compact chip strip (Recover, Repair, Leave, sound, Drive together).
- On foot (`walk` or `ferry` mode) it shows only:
  - on the start screen, until the first walk of about 4 m or the first drive (`hud.fresh`);
  - within 7 m of a drivable car, tested by `rally.nearCar( pos, radius )`, which returns the
    nearest drivable car (`{ key, model, distance }`) or null. Only the selected car (Aster RS or
    Black Jeep) is drivable today; the support wagon and pickup are props. Add new drivable cars
    to `nearCar`;
  - when summoned with the unlisted Backquote key (on foot or in free camera). Pressing it again,
    walking 25 m from the summon spot or getting in dismisses it. It is deliberately left out of
    every key legend, prompt and the help.
- Changing Vehicle or Start at moves the car away, so the dock stays put for that choice (the same
  25 m rule as a summon).
- It fades in and out (200 ms opacity and a short rise, `.is-away`, made `inert`), with no motion
  under `prefers-reduced-motion`.
- It stays hidden (`dock.hidden`) during a bail-out and in `jetski`, `jetski-thrown`, `ragdoll` and
  `ferry-helm`, as before. "Drive" from a summoned dock enters the car wherever it is parked (the
  Start at spot until the player picks another), including from the ferry deck.

## Visual review ledger

| Capture | Finding | Resolution |
| --- | --- | --- |
| In-app browser, 25 September 2026, initial driving view | Aster spawned on two dinghies, leaving only one loaded wheel; HUD said “1 wheels”. | Move the car to clear beach sand and pluralise the contact label correctly. Recheck the complete view after the driving tests. |
| `docs/rally-free-camera-before.png` | The existing F prompt says “Walk” although returning from free camera resumes driving. | Add a car-specific return prompt and cover free-camera input isolation and keyboard exit. |
| `test-results/rally-coastal-road.png` | Flat black asphalt, chopped edge lines, sawtooth shoulders; driving HUD a tall debug slab ("4 wheels grounded") over a quarter of the screen. | Textured asphalt with patches, lines and sand verges (CoastalRoad); new cluster, vehicle card and dock (DriveHUD). |
| `test-results/rally-tyre-tracks.png` | Gravel ramp ended as a dark rectangle on the white sand. | Ramps are compacted sand tracks that fade out at the beach and the asphalt. |
| `test-results/road-captures/after-bend-ne.png` | Village palm on the NE bend shoulder (a tree stood in the road). | Village palms keep off roads (Scatter.js); `road-clearance.spec.js` fails on any trunk or prop within half width + 1 m (red on three palms, then green). |
| `demo/tour-aster-coast-18.png` (25 Sep review) | Driving key strip sat over the car's rear bumper; brake bar red while parked on auto-hold. | Key strip moved to the top; telemetry reports the driver's pedal, not the auto-hold. |
| `demo/tour-aster-coast-9.png` | White beach-sand verges running through inland grass; asphalt patch outlines read like UI boxes. | Verges follow the terrain splat; patches jittered with feathered seal edges. |
| `test-results/road2-captures/b-loopverge.png` | Grass tufts standing on the loop's asphalt edge. | Grass mask keeps 1 m clear of every road edge, thickening over 1.5 m (Scatter.js). |
| `demo/m-sheet.png` (390 px) | Fps meter over the Cooler pill; driving dock three rows deep over the car; adrift prompt never shown. | Compact fps readout on phones; key-only dock chips; adrift timer decays instead of resetting (a bobbing hull brushes the seabed). |
| `damage/captures/05,07,08` | Glass shatter made the Aster read as a convertible; white-hot flame core at night; pale debris. | Windscreen and rear screen crack in place, side glass bursts; fire, smoke and debris shading retuned (damage2 lane). |
| `demo/mtn-sheet.png` | Steam cloud covering a third of the screen after a light rail scrape. | Steam thinned and damage calibrated so scrapes only dent; glancing hits load the side zone. |
| `demo/esheet.png` | Chase camera parked behind a palm trunk, hiding the car. | Camera collision now includes trunk cylinders. |
| `demo/finale2-test.mp4` (960 px) | Driving key strip over the brand and the Cooler pill in windows up to 1240 px wide. | Strip drops below the top row at 1240 px and keeps only the driving keys at 720 px; `rally.spec.js` checks 960, 700 and 1280 (red at 960 and 700). |
| `demo/full12.png` | Surface chip said SAND on a grassy verge: airborne wheels voted with their default code. | Only grounded wheels vote and the chip holds its last surface in the air; `coastal-road.spec.js` surface chip scenario (red: Sand flashed on the drop). |
| `car-panel/15-driving.png` (1280 px) | Driving key strip over the "Driving · Aster RS" mode pill; "Take a car" card always on screen while walking. | Strip drops below the top row up to 1480 px (`20-driving-keys.png`); dock only on the start screen, near a car or when summoned (see Car dock). |
| `test-results/rally-dock-700.png` | 561 to 860 px windows: dock buttons under the speedo, map over the speedo. | Speedo moves to the corner and the dock stacks above it up to 860 px; `rally.spec.js` dock scenarios (red at 700 and 820). |
| `demo/f3sheet.png` | Cars stopped dead in a -17 % to +17 % sag before the bottom hairpin. | Circuit grades are smoothed after the cap sweeps; `test/coastal-grade.mjs` kink test (70 kinks with smoothing off, 0 on). |
| `demo/yf90sheet.png` | Bail-out view tumbling through tree trunks, off the road; car picker over the tumble. | Trunk collisions, slope contact and friction; dock hidden until the driver stands. |
| Playtest, 25 Sep | Judder that grew with speed. | Render interpolation (`blend()`); `rally.spec.js` 120 Hz scenario. |
| `test-results/road2-captures/c-overview.png` (open) | Dark hollow inside the first switchback: the shaded face of an 8 m cutting. | Left as is (a layout change); reads as a cutting at gameplay distance. |

## Rebuild and refresh

The prebuilt browser module and original GLB assets are included in `public/rally`.
`npm ci` and `npm run dev` are sufficient for playing; Rust is only needed when
rebuilding the module or running its native tests.

```sh
# Once, if the Rust browser toolchain is not already installed:
rustup target add wasm32-unknown-unknown
cargo install --locked wasm-bindgen-cli --version 0.2.114
npx playwright install chromium

# Refresh from a Rally checkout (set RALLY_DIR, or pass its path after --):
npm run sync:rally
npm run build:rally
npm test
npm run build
```

The build script accepts `WASM_BINDGEN=/path/to/wasm-bindgen`; it also finds the
Rally checkout's own tool at `$RALLY_DIR/target/tools/bin/wasm-bindgen` when
there is no matching version on PATH. Sync reads the Rally checkout, copies the
physics/input and car files, extracts the original vehicle bundle, and refreshes
the source hashes. It never writes to the original project. Changes to the source
Rally module layout fail explicitly so the adapter can be reviewed.

## Scope

This is an island driving integration: the Aster and lifted Jeep are drivable, the two support
vehicles are parked, and the original fishing/boat game remains available on foot.
It does not import Rally's roads, missions or renderer. The island's existing
static boxes/cylinders and full-resolution heightfield supply collision, plus car-only
palm and tree trunks and the road's guardrails. Grip comes from the surface under each
wheel contact (asphalt, gravel, dry and wet sand, soil, rock, wood, water); see
`docs/rally-physics.md`. Cars float in the sea instead of being reset.

## Acceptance

`test/browser/rally.spec.js` binds native Playwright tests to explicit
Given/When/Then steps. The host is the actual local game on port 5190 with
fresh browser persistence. Terrain, WebGPU rendering, WASM and car physics are
real. Only the unrelated Google Fonts stylesheet is replaced with empty CSS.
Actions use the visible driving button and genuine browser keyboard events;
assertions read the driver's accessible telemetry, not internal game hooks.

The original three scenarios were executed against the buildable baseline and
all failed at the absent Drive Aster RS button. The first integrated run failed
the four-wheel support assertion because the car spawned on dinghies; the same
scenarios passed after moving the spawn. The free-camera scenario separately
failed on the missing “Return to car” prompt before its copy was corrected.

Scope HUD text locators to their status element: labels such as “Free camera”
also appear in the hidden controls help. A strict-locator failure is a fixture
error, not behavioural negative evidence.

`npm test` includes the native Rally regressions, a real-Avian asymmetric terrain
raycast, checks of the actual shipped WASM (terrain support, reset, imported box
and cylinder collision, invalid inputs), original fishing/engine tests and all
eleven real-game browser scenarios across driving, tyre effects, vehicle selection,
recorded audio, shared driving and both coastal entrances. No test scripts are
opt-in-only gates. See `rally-expansion.md` for the added assets and scene work.
