# Summit hang gliding

## Design: flying properly (2026-10-05)

Open **Hang glider** in the world controls. **Visit summit** is a camera shortcut; **Guide summit hike** instead steers the walking view along the village evacuation boardwalk, through the refuge and up the new timber stairs. Hold **W** to move using the normal walking controller, optionally **Shift** to run. Releasing the key stops movement. The guide never writes the player's position.

**Launch glider** starts a finite run down the ramp into the prevailing wind. Wait until clear of the mountain before making a broad turn toward the bay. Arrow **Up/W** pulls in for speed, **Down/S** pushes out to slow down, **Left/Right/A/D** shifts weight sideways. Neutral gradually levels the wing. **Space** flares, **C** changes camera and **R** resets the wing and **E** leaves it. After landing or crashing, E steps off beside the wing; E in flight unclips the pilot, who falls from the harness as a ragdoll while the empty glider flies on. There is no throttle. The beach flags are at (−92, −91). Lose height in broad turns, then approach into wind. **Practice beach approach** starts an airborne 22 m approach; all subsequent travel, stall and touchdown results come from the same solver. Flaring around 1.5 m clearance produces a gentle landing in the initial wind; flaring high can stall and cause a hard impact.

The station sits on the existing volcanic summit at (−34, −500), with a deck at 306.6 m. A terrain survey found heights above 304 m nearby. The 844.830 m timber stair extension joins the north gate of the evacuation refuge at (47, −249). Its treads are 2.3 m wide, with a maximum 0.186 m rise and 0.62 grade. Thirty-two level landings keep the upper treads clear of the walking lane at bends. Where the route crosses the mountain road, the deck underside clears the surveyed road surface by at least 5.6 m and supports stay out of the road corridor. Route planning avoids height edits and clears vegetation before it is generated. The highest assumed trestle is 43.22 m; the site and foundation sizes are visual and structural gameplay assumptions, not an engineered building design. The tall trestle geometry is a documented simplification; foundation bearing, lateral bracing design and timber buckling are not solved. The final switchback now feeds a flight square to the rear platform opening. A 4 m level threshold has its own supporting beams and fits the deck notch without overlapping floor meshes. Stair rails join the guarded rear opening instead of passing through the platform. Along the full route, rail segments follow true offset corner joins instead of cutting straight chords across the walking lane. All 31 turning landings have complete polygon floors and supported edge beams; overlapping treads are omitted. Solid edge guards share the rendered corridor. The landing collision floor uses narrow conservative strips, with at most 0.28 m extension beyond the visible polygon behind those guards. Stair sections and the launch assembly register with the shared structural damage system. A broken launch ramp refuses takeoff until **Restore island** repairs it.

## Physical model and provenance

### Round-out, hold-off and flare

Real reference: a foot-launched hang glider lands routinely in 5-9 m/s surface wind. The pilot comes
in fast for penetration and through the wind gradient (USHPA Hang Gliding Training Manual and the BHPA
Pilot Handbook: approach speed rises with the wind; Wills Wing Falcon 3 owner's manual: approach well
above trim, flare at the stall), rounds out a metre or two up, holds off level just above the ground
while the speed bleeds, then pushes out to the stall and touches down on the feet at the stall speed
minus the headwind. This wing stalls at 8.0 m/s (28.9 km/h).

Node results on flat ground (final airspeed, surface headwind: touchdown ground speed, sink):
13 m/s into 5.5: 2.0 m/s, 0.7 m/s; 15 into 5.5: 2.1, 0.5; 14 into 8: 0.5, 0.6; 12 into 3: 4.5, 0.8;
11 in calm: 7.4, 1.0. Touchdown airspeed is about 7.4 m/s in every case, the stall mush.

### Round-out authority: a late flare

Real reference: the round-out is 0.5-1 s of steady push begun one to two metres up (USHPA Hang Gliding
Training Manual and BHPA Pilot Handbook, the landing approach); pilots, like landing birds, pace it by
how soon the ground arrives, the looming cue tau = height / closing speed (Lee 1976, Perception 5). The
push is a weight shift, so the moment the arms make does not fall with airspeed.

Model (`BAR` in `src/glider/GliderPhysics.js`): while the feet would touch sooner than `roundOutTau`
(0.65 s) the arms push with at least `roundOutAuthority` (1.9) x the q-scaled authority, building over
`roundOutTauBand` (0.2 s) and held until the push-out (dropping it as the wing levelled left the high
alpha on a weak bar, and the wing climbed and stalled from 0.6 m). While it is on, the round-out asks for
no more than the sail's maximum lift (`ALPHA_CL_MAX`). An on-time flare (1.5 m, 1.6 m/s sink) starts at
0.8-0.9 s to touch and is barely touched. 1.9 is the most the 13 m/s headwind final takes: at 2.2 its
push-out ballooned to 1.99 m and touched at 2.01 m/s.

The 0.25 s stumbles flare 0.9-1.0 m up in a 2 m/s sink, under 0.5 s to touch: shorter than a real
round-out, so a stumble there is the honest outcome. The browser trace of `aviation-recovery.spec.js`
replays in node to a beach landing at 1.60 m/s (was a 4.6 m/s stumble). Pinned by `test/glider-approach.mjs`
"a flare pressed up to 0.2 s late still ends in a running landing on the beach in every gust phase"
(red 89 of 186 on the pre-fix tree, then green).

### Push-out: zoom, then brake

Model (`BAR` in `src/glider/GliderPhysics.js`):

All state and forces use metres, seconds, kilograms and newtons. Shared gravity and air density come from `physics/Loads.js`. Every fixed 1/120 s step samples the shared disaster field once; it already includes ambient wind, tornado flow and the wind farm's momentum-deficit wakes and declared turbulence approximation. There is no second ambient contribution, additional thermal, ridge uplift or fan-like energy source.

NASA's [lift equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/lift-equation/) supplies L=½ρV²SCl. NASA's [finite-wing induced drag relation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/induced-drag-coefficient/) supplies Cdi=Cl²/(πARe) and Cd=Cd0+Cdi. NASA's [glide geometry](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/glide-angle/) connects loss of height to horizontal range. These are sourced laws; the parameters below are explicitly assumed for the fictional Ridgeline wing.

| Parameter | Assumption |
| --- | --- |
| Total mass / pilot mass | 118 kg / 85 kg |
| Wing area / span | 15.8 m² / 10.2 m |
| Attached polar | Cl = .22 + 4.2α, α in radians |
| Zero-lift drag / span efficiency | .039 / .72 |
| Stall onset / blend | 14.32° onset; smooth .20 rad transition to a separated-flow sine approximation |
| Neutral angle of attack | .12 rad, about 6.88° |
| Inertia, body x/y/z | 85 / 170 / 230 kg·m² |
| Maximum weight shift / control moment | .38 m; bounded by 85 × 9.81 × .38 ≈ 317 N·m |
| Launch effort | ≤ 440 N leg force, tapering near 6.2 m/s running speed |
| Gameplay airframe envelope | 42 m/s or 5.5 g triggers damage |

Lift is perpendicular to air-relative velocity; drag opposes it. Gravity acts continuously. Fore/aft weight shift changes trim through bounded torque, lateral shift applies a roll moment, and sideslip drives a yaw moment. Angular inertia and damping determine response; the solver does not rotate the velocity vector to fake steering. Neutral roll assistance is an explicit handling simplification. Position uses the midpoint of old/new velocity. Aerodynamic work uses that same midpoint, allowing an independent mechanical-energy closure test.

At the assumed neutral polar and sea-level density, the synthetic steady-glide benchmark is 12.820070462 m/s and L/D 9.758383973. This is an analytical consequence of the declared polar, not measured performance of a commercial hang glider. The tests independently verify force balance and energy loss. Mass distribution, flexible sail deformation, unsteady separation outside the landing push-out, detailed pilot biomechanics, gust spectra and aeroelastic failure are not resolved.

Three swept pilot/wing-tip probes check terrain, water and live island box/cylinder proxies. A controlled landing requires reasonable descent speed, ground speed, bank and surface slope. Steep/fast impacts become crashes; sea contact becomes a floating/flooding state, never underwater flight. The sweep is a coarse contact approximation; intact turbine blades have no matching shared physical proxy. Moving debris and glider-to-vehicle impulse exchange are not resolved by this feature. Station destruction uses the shared assumed anchor/fracture model and its existing body budget.

### Push-out flown level: settle, then the shove at the stall

Real reference: USHPA (Hang Gliding Training Manual) and BHPA (Pilot Handbook) teach the landing as a
hold-off and a flare, not one movement. The pilot flies level a little off the ground with the bar eased
out only as far as keeps the wing from climbing or dropping while the speed bleeds, and gives one
decisive, full push-out at the stall, with the feet just off the ground. A push-out given early or high
makes the wing balloon (climb), stall at the top and drop the pilot; the taught fix is to hold, not to
push harder. In nil wind the pilot still runs a few paces; into a breeze the wing stops over the spot.

Model (`BAR` in `src/glider/GliderPhysics.js`, `rg -F 'pushOutShove:'`):

### The thin margins

### See-through wing

### Running landing, hold-off over the ground ahead, and the practice line

## Assets, integration and evidence

`tools/glider/build.py` reproducibly builds the curved delta sail, battens, leading tubes, crossbar, kingpost, upper/lower rigging, control frame, suspended pilot/harness and instrument pod. The editable `assets/glider/glider.blend` is retained alongside its preview. The GLB is 11,228 triangles in 13 meshes, 487,364 bytes. Material factors and geometry are native engine inputs; no runtime texture download is required. Pilot weight shift animates the named `Pilot` pivot.

Root App integration prepares clearzones before vegetation, initialises the model before shader compilation, updates its solver with the other vessels, and delegates camera/player ownership while `active`. `leave()` clears ownership before returning to walking/free camera. Aviation and glider entry relinquish the other mode. Disaster capture/restore preserves flight and controller state. The station registers late structural records and refreshes the native static collision world.

Final browser checks cover all seven maintained scenarios across focused runs: launch/steer/reset, controlled practice landing, premature flare/stall/crash, shared wind controls, the complete village-to-summit walk, damaged-ramp refusal/restore, and an uninterrupted summit-to-beach flight. Fixed-resolution visual capture selects Performance → Resolution → Standard and records actual sceneRenderer dimensions, rather than assuming a URL scale fixes the adaptive resolution governor.

### Uninterrupted flight acceptance

After one launch, a test-only feedback pilot reads observations and sends actual Arrow key and Space events. It stays neutral during the ramp run and first airborne second, clears the ridge to the west, loses height in broad turns, extends its downwind leg according to the turn exit, then approaches into wind at a requested 13 m/s airspeed. It requests one brief Space flare below 0.35 m clearance. These are scenario-specific test-pilot choices, not a new product autopilot or general real-world flight advice. No practice preset, reset, mid-flight repositioning, flight-method calls, extra lift or force/state edits occur after launch.

The actual 1440×900 Standard browser flight passed in 3.9 minutes wall time. Its phase history was `ready → running → airborne → landed`: **205.8 s airborne**, **2,479.10 m** travelled and **22.07 m** launch run. Touchdown was at `(−89.9206, 3.9324, −86.1767)`, **5.25 m** from the beach centre and inside the visible flag rectangle. Recorded vertical impact was **1.070 m/s**, horizontal landing speed **6.241 m/s** and final bank **0.83°**. The normal production contact and landing predicate accepted the flight. The browser scenario keeps the production 45 m completion envelope assertion; that envelope is wider than the visible flags.

Across 1,269 airborne observations, sampled shared wind ranged **4.894–7.000 m/s**, with at most **0.0031 m/s** difference between recorded wing wind and the contemporaneous shared-field observation. No simulation time was discarded, all observed state remained finite, and no page/console errors occurred. The test pilot targeted 100 ms waits, while actual observation intervals were 117–267 ms (150 ms median). Six preparatory numerical routes also landed with varied observation cadence; those are supporting probes, not substitutes for this actual browser result.

The first real attempt overshot inland and held its flare too long, ballooned, then crashed at 4.32 m/s descent. Its failed trace is retained. Only the test pilot's route and flare were revised; the flight solver, shared current model and landing criteria were unchanged. This proof establishes an achievable route using ordinary controls, not novice piloting ease, arbitrary weather robustness, a coupled 3D atmospheric solve or a fully articulated pilot-ground landing model. Accepted touchdown uses the existing reduced stopping/projection response.

Landing screenshot in Library: `libfile_78fba287f4a48191b7fd928bfc5f3326`. Complete observation/action records and independent review are in the task evidence under `evidence/glider-journey-followup`.

### Gameplay recovery verification

The chase camera checks the final interpolated eye against terrain, actual island box colliders and the authored sail. Its usual view is 40° to one side of the rear boom so the suspended pilot remains readable. Candidate booms range from 7 to 15 m horizontally; the view checks the wing centre, lower pilot, wing tips, helmet and harness. A 0.7 s velocity extrapolation helps select a clear side before reaching an obstacle, without changing flight state. Angular, radial and vertical camera movement are bounded. If the direct interpolation is obstructed, a small local search continues around the obstacle instead of jumping to the other side. Each target starts from the nominal boom, so previous corrections cannot accumulate into an upward retreat. Confined or embedded wrecks can still make all visibility constraints impossible; this is finite-probe camera collision, not a full view-volume solver.

The live `GliderBody` keeps 1,468 nondegenerate sail triangles for the ordinary swimming capsule, plus the authored opaque frame, cables and cloth in a separate camera/head-contact tree. It registers independently with `Player.cameraObstacles` and `Player.obstacleProviders`. Camera rays therefore see the metal spar as well as the sail. The body uses measured glider point velocity and removes inward relative velocity; it adds no buoyancy or wind force. This is a kinematic obstacle response, not equal-and-opposite swimmer/glider impulse exchange or flexible sail deformation. The floating wing remains driven by its existing water solver.

The animated swimming skull can extend outside the upright movement capsule. A separate approximately 0.184 m radius sphere is measured from the authored Head geometry, including a 0.025 m contact margin, then transformed through the actual current skeleton. After the Avatar is posed, one head-only contact pass resolves it against the full opaque wreck and translates the physical player, whole avatar and placement history by the same correction. The ordinary capsule still runs only in movement. Head correction is bounded to 0.65 m per pass and removes inward relative velocity. Restore and local activity handoffs clear the previous head sweep history. This is a reduced posed-head envelope: six triangle-projection iterations and a swept centre do not solve arbitrary mesh contact or every grazing sphere sweep. A rapidly moving or rotating foil sweeping across a stationary head is not full relative-motion continuous collision detection.

The nearby-wreck swimming camera runs once after the current Avatar pose and its physical head-contact correction. `finishView` retains the input eye and defers this search; `updateAvatar` completes it using the actual displayed geometry, without adding movement to that pose a second time. This ordering prevents a camera that clears the preceding animation pose from looking through the newly displayed head. Hidden first-person heads and stale remote poses are rejected. A bounded connected orbit normally uses a 4–6 m horizontal radius, keeps the lens at least 2.5 m from the body probes, tests world and full opaque wreck sightlines, and aims at the swimmer. It also skins 24 real head-surface vertices so visible joint centres alone cannot accept a cropped or hidden face. If animation removes every completely clear eased view, the lens continues at no more than 6 m/s toward a clear goal and tests the physical lens path. A confined or embedded pose can still make all constraints impossible; brief partial exposure is possible, and this is not a full view-volume or pixel-visibility guarantee. Look and movement inputs remain anchored to Player yaw/pitch, zoom is consumed once, and the ordinary first-person camera is unchanged.

An avatar hidden during vehicle travel clears its previous visual placement history. Its next visible pose starts beside the actual local exit instead of easing across the island from its last on-foot location. This changes neither the physical player position nor water forces. Ordinary visible walking into water retains its placement blend. A production Avatar/Player.updateAvatar regression covers both transitions; the wet browser scenario passively records the first eight rendered swim updates after X and checks the actual skinned head before W or V can conceal an entry delay.

The authored-sail ray queries use an immutable local bounding tree; 240 deterministic posed-ray tests match exhaustive intersection distances. This acceleration changes neither the collision triangles nor swimming force/contact response. The native Standard 1440×900 full summit hike and walking-height doorway capture have independent visual acceptance after the route-wide rail/landing repair.

The final unchanged wet-recovery Playwright scenario passed in 41.9 s (42.4 s total) at Standard 1440×900. It performs a real banked ditch, X exit, eight distinct first-visible engine frames, normal W swimming, first/third-person switching, actual foil contact, reset, relaunch and exit reuse. Four settled observations independently check skinned head/chest visibility. A separate per-engine-frame observer samples estimated projected front-facing head area against all opaque glider triangles, records actual water submersion, and rejects emerged masking lasting 0.25 s in either simulation or wall time. This run recorded 81 distinct contact-journey frames with zero threshold-failing intervals. It is an area estimate from triangle-centroid rays, not exact framebuffer coverage or intra-head self-occlusion; complete native video remains an independent visual gate.

The earlier unchanged native run failed with only 20/48 exposed head samples during contact. A maintained regression now replays those 103 captured displayed poses through actual `Player.finishView` followed by `Player.updateAvatar`: it failed before the camera-order repair and passes afterward. The current focused camera, head-contact, Player and flood selection passes 31/31, and the production build passes. The accepted hidden-to-visible Avatar fix, ordinary visible wading, finite swimmer forces and both Restore/history regressions remain intact. Detailed logs, exact source hashes and the final video decision are retained in the task's `wet-contact-repair-map.md`.
