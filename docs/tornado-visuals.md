# Transported tornado dust, mist and condensate

`TornadoVisuals(app, field)` adds one cloud mesh and one small-litter mesh to the scene. `update(dt)` reads the active tornado; `clear()` removes emission and drawn instances. `Disasters` owns these calls, so pause, stop and restore share the physical-load lifecycle. This replaces the separate 36-step condensation volume. There is no independent upper optical tube.

## Design note: the cinematic tornado

**Source of truth.** Centre, intensity (with the seeded pulses) and envelope come from `DisasterField.center`, `tornadoIntensity` and `envelope`; ground height from `field.terrain`; the seed from `e.seed` (EventRandom, track stream indices 32+, so the track is unchanged); sun and sky light from the shared frame uniforms, which `App.applyAtmosphereReadback` scales by `stormLight(app.storm)`; cloud cover is the shared `app.clouds.coverage`. No private sun, wind or height.

**Budget.** One draw, one box, no allocation per frame. Per covered pixel: at most 40 funnel steps (only where the ray crosses the funnel's bounding cylinder, about 100-200 m wide) and 24 storm-base steps (rays that cross the base slab inside 3 km), one or two fetches of the shared 64^3 noise each. Target 1 ms GPU at the M5 Pro display size; full resolution, not half (the material path has no half-resolution target yet; recorded as a deviation).

**Detail by distance.** The volume is drawn within the 3 km storm base, which contains every review view; beyond it the shared clouds carry on (coverage raised to 0.85). The funnel is resolved by the cylinder march at any range; the parcel dust and litter only near the ground, as before.

**Controls.** Unchanged: the Disasters panel (Start disaster, Stop all disasters, all reachable with Tab and Enter, which the scenario uses).

**Transitions.** Start: the storm darkens with an 8 s time constant (no snap), cloud cover rises from the player's own value, the wall cloud forms over half the genesis, then the funnel builds down. End or Stop: the funnel lifts away over 1.5 s as the wind stops, the storm clears over a 15 s time constant and the player's cloud cover is handed back exactly. Pause: everything holds.

## The look, round two

| Defect | Cause | Fix |
|---|---|---|
| Speckle in the funnel, no shapes in the base | The march read the parcel clouds' 64^3 per-voxel white noise: every 4-7 m step an unrelated value | `TornadoNoise.js`: tiling fractal value noise, shape, detail and billow channels (Schneider and Vos, SIGGRAPH 2015), stretched to full range |
| Stipple band at the base edge | The step jitter depended on the pixel only (same dither every frame) and the material set the TAA reactive coverage, which caps the history at half the upsampled weight: nothing averaged it | Interleaved gradient noise moved 5.588238 px a frame (Jimenez 2014); no reactive coverage, so the history accumulates it. The root fix was temporal, so no half-resolution target was added |
| Flat pipe | Constant tint times sky irradiance, no light transport | Three ALU-only light steps through the smooth funnel toward the key light (Beer-Lambert), Henyey-Greenstein phase (g 0.6 and -0.2), skylight reduced with depth into the core, striations from the detail channel in a frame that turns at the core's angular velocity and shears into a helix |
| Square cap | The Burgers-Rott radius grows without bound toward the base and the bounding cylinder cut it | Soft knee on the radius and the funnel dissolves into the wall cloud over its top 220 m (this march composites in front of the base) |
| Lavender | Clear-sky blue irradiance used as is | Storm light: the sky irradiance keeps its brightness with 75 % of its colour taken out, a grey-green cast; the key light is the clear horizon beyond the storm |
| Black void | Base shade 0.18-0.55 x 0.55 x sky | Floor at 0.4 x sky, lighter with height and where the billow is thin, plus horizon light from beyond the deck that brightens the base toward its edge |
| Flat wall cloud, straight deck edge | Uniform radii | Ragged outlines from the shape channel, lumpy underside (+-90 m) with hanging billow lobes, the wall cloud a quarter darker and turning |
| Faint debris | 0.02 extinction times a white-noise sample | A brown-grey skirt turning with the vortex, widest and densest at the ground, gone by 1.3 x the seeded debris height (40-150 m, so 50-195 m tall), 0.03 1/m at full load |

**Reference photos (by eye, declared).** NSSL, Union City, Oklahoma, 24 May 1973 (NOAA Photo Library): a grey cone-to-rope funnel, darker than the bright sky under the base and lighter than the base itself, with a dust skirt at the ground about two funnel widths across. VORTEX-95, Dimmitt, Texas, 2 June 1995 (NOAA Photo Library): striated, helically banded edges, a brown debris cloud roughly 100-200 m tall. NWS SKYWARN spotter guide (as cited above): a lowered, ragged wall cloud under a dark base with a brighter band of sky under the base's edge. From these: the base is dark slate, about 15-30 % of the horizon below it, not black; the funnel stands out from the sky under the base by >= 0.3 in luminance; its lit and shadowed sides differ.

**Budget.** Still one draw and one box. Funnel: 40 steps, one fetch each (two inside the debris skirt) and three ALU-only light steps where there is condensate. Base: 32 quadratically spaced steps (short where the ray enters the base, long inside; the dense deck ends most rays within about 12), two fetches each. Noise: 1 MiB rgba8, built once per page in about 0.1-0.45 s of CPU in an idle callback after boot, or on the first storm.

## The look, round three

| Defect | Cause | Fix |
|---|---|---|
| Thread funnel, 12 px from 2 km | The density faded out from 40-75 % of the condensation radius, so a funnel the model makes 30-40 m wide drew 15-20 m wide | The condensation radius is the cloud's edge (solid to 0.8 of it, soft to 1.2), drawn at `FUNNEL.drawnWidth` 1.8 x the dry Burgers-Rott estimate (declared: near-saturated, rain-cooled inflow under the wall cloud condenses at a smaller drop, and the skin carries dust and spray). The tip, where the deficit reaches the full rho g H, does not move (`test/tornado-funnel.mjs`, the BDD tip Then) |
| White rope | The thin-cloud forward phase (up to 7 x) on the horizon key light | A 30-60 m funnel is optically thick: key light 0.35 x horizon + 0.25 x sun, phase capped at 2, skylight into the core 0.22-0.62, slate albedo, browner in the lowest 1.6 debris heights |
| Symmetric lens, no wall cloud | Wall cloud and deck centred on the funnel; the wall cloud's rim ramped over half its radius under +-90 m of underside noise, so the 150-300 m lowering vanished | The funnel hangs at the rear edge of its wall cloud: wall-cloud and deck centres 0.3 of their radii ahead, opposite the seeded rope trail (`drift` uniform). The wall cloud is an abrupt lowering, rim 0.7-1.15 radii from the shape channel, a side 12 % of the radius wide, a flatter (+-35 m) sharper base, 40 % darker. The deck outline is lobed by an 8 km tile of the shape channel (1-2 km in and out) |
| No debris from 2 km | Dark brown soil (0.45 x sky) on a dark island | Wider (to 1.2 debris radii at the ground, 1.75 bound), taller (1.5 debris heights), 0.045 1/m, lit like dust (0.58, 0.51, 0.42 x 0.75 sky + horizon) |

**Budget.** Unchanged in kind: one draw, one box (now 1.5 deck radii wide for the offset deck), 40 funnel steps, 32 base steps, one extra fetch per base step (the deck lobes). Bench below.

## The look, round four

## The look, round five

## The look, round six

## Grain transport

`TornadoParticles` holds a fixed pool of 1,280 aerosol parcels and 64 leaf/wood flecks. An aerosol is a statistical cloud containing many equal spherical mineral grains or water droplets. Its physical grain diameter, in metres, sets aerodynamic response. Its separate metre-scale optical radius describes the cloud, not a giant physical grain.

Carrier air comes from `DisasterField.sample`, including registered wake modifiers. Relative-air drag uses Schiller–Naumann spherical-particle drag. [NASA Ames' supplement, equation 4](https://www.nas.nasa.gov/assets/nas/pdf/staff/Shariff_K_Making_aircraft_vortices_visible_water_spray_supplemental.pdf) states the correlation and its approximately 5% accuracy below Reynolds number 800. The constant drag coefficient 0.44 above Reynolds number 1,000 follows the [OpenFOAM Foundation implementation](https://cpp.openfoam.org/v13/SchillerNaumann_8C_source.html). These are empirical spherical-grain assumptions. Droplet breakup and resolved grain shape are omitted.

The existing `AerosolDynamics.js` integrator is unchanged. Gravity, air buoyancy and drag are integrated together using a frozen-rate exponential update, including displacement. It is exact for constant linear Stokes drag and constant carrier velocity. At finite Reynolds number, reevaluation at intervals no longer than 1/60 second gives a first-order approximation. The existing 100-micrometre, 20 m/s, 0.1-second benchmark has displacement errors of 4.31%, 2.18% and 1.09% at 60, 120 and 240 Hz against an independent fine-step RK4 reference.

Evaporation changes the physical droplet diameter used by the next drag step. Optical cloud radius and shading noise do not enter the grain drag law. Flecks retain the shared `DisasterField.acceleration`, mass/area response and gravity; their visual spin and terrain contact are approximations. Large debris, cars, trees and structural pieces retain their native rigid-body solver.

## Reduced liquid lifecycle and entrainment

`TornadoPlume.js` adds an explicit one-way closure. It does not solve atmospheric vapour, pressure or heat. [Kumar, Schumacher and Shaw, equation 26](https://arxiv.org/pdf/1112.5012) uses `r dr/dt = K (RH - 1)`. For diameter `d = 2r`, the implemented constant-step solution is:

```text
d_next² = max(0, d² - 8 K (1 - RH) dt)
grain mass = density × π d³ / 6
cloud liquid mass = droplet number × grain mass
nominal extinction area = droplet number × Qext × π d² / 4
```

`K` has units m²/s and `RH` is dimensionless. The factor eight follows from the radius law; a diameter-squared coefficient must not be substituted unchanged. The default `K = 5e-11 m²/s`, source `RH = 1`, ambient `RH = 0.84` and geometric extinction efficiency `Qext = 2` are assumed reduced-model parameters. The paper supplies physical rationale, not calibration for this island. Supersaturated growth, temperature dependence, ventilation corrections and vapour feedback are not simulated. Evaporated liquid transfers to a counted, unrendered vapour reservoir. Mineral grains do not evaporate.

Entrainment speed is `u_e = alpha × |sampled air velocity|`, in m/s. The assumed dimensionless `alpha` varies smoothly from 0.035 to 0.16 with height. The [particle-laden plume experiments](https://arxiv.org/abs/2109.01240) motivate an entrainment closure but do not establish these tornado coefficients. Cloud radius grows through positive entrainment and diffusion:

```text
R_next = sqrt((R + u_e dt)² + 4 D dt)
unmixed_fraction_next = unmixed_fraction × (R / R_next)³
RH_cloud = RH_ambient + (RH_source - RH_ambient) × unmixed_fraction
```

`D` is an assumed diffusivity in m²/s: 0.8–2.0 times radius scale for ground clouds and 2.0–4.0 times scale for condensate. The split is exact for either constant diffusion alone or constant entrainment alone, and first order when both act together. Ambient humidity approaches 0.84 smoothly away from the moist core and aloft. The old nominal volume height, `130 × radius / 100` metres, is only a continuous mixing scale. It does not clip particles, velocity or optical radius. Parcels can rise above it and become dilute or evaporate there.

Two smooth curl modes give nearby parcels the same unresolved eddy velocity, independent of IDs and birth cohorts. Their assumed event-wide amplitude is bounded by the intensity parameter; this is prescribed subgrid motion, not a new atmospheric fluid solve or feedback to the shared field. Its amplitude does not track every local wake deficit. The combined prescribed carrier is not claimed to be globally divergence free.

## Source and matter accounting

Ground sources still depend on actual local horizontal air speed. The assumed thresholds are 6 m/s for soil and 12 m/s for spray. Elevated condensate requires an actual updraft. Its source cross-section opens gradually with height; the source spans 8–120 times the radius scale in metres and then travels freely. Condensate starts at 8–28 micrometres; spray and mineral grain sizes are unchanged. Source cloud radius also grows gradually with source height, representing larger moist volumes aloft. These are appearance-oriented source assumptions, not a soil erosion, sea-spray or thermodynamic nucleation solver.

A shared smooth three-dimensional moisture pattern is sampled at each condensate birth. Neighbouring births see nearby values; IDs do not choose the moisture. The prescribed source pattern moves upward at 0.22 times the intensity parameter. A cloud retains its source moisture, humidity (0.94–1) and number-loading weight (0.16–2.36), then entrainment dilutes that source state. This is a heterogeneous prescribed source, not resolved vapour transport or a measured nucleation law.

Each cloud gains grain number smoothly over its first 0.6 second. Added source mass and extinction use its current representative diameter. This keeps the statistical source budget explicit, but does not resolve multiple droplet ages within a parcel. Mineral and spray number remain inferred from assumed optical loading. Condensate instead uses an explicit assumed mean liquid-water content of 0.06 g/m³ (6e-5 kg/m³). Its mean optical cloud volume is 4πR³/3, nominal liquid mass is concentration times that volume times shared updraft/moisture loading, and droplet number is nominal mass divided by physical droplet mass. Extinction then follows droplet number and diameter. This optical volume is a reduced statistical representation, not a resolved thermodynamic cell. Reported kilograms are model quantities, not measured atmospheric loading or water removed from the sea.

Randomized 7–14-second pool lifetimes bound memory and runtime. The former emission demand filled the 1,280-slot pool and stopped ground dust emission: the actual mineral birth rate at event seconds 6/7/8 was 0/1/6 after 273 at second 4. The revised actual birth rate is capped at capacity/14 per second, multiplied only by the event envelope. Intensity goes into a statistical source weight, not an extra multiplier above that capacity bound:

```text
weight = (14 / 5) × clamp(intensity / 75, 0.15, 1.5)
represented radius = base radius × cube_root(weight)
represented volume = base volume × weight
```

Condensate mass uses that represented volume once, so mean source concentration stays unchanged. Mineral/spray extinction uses the base cloud area times the statistical weight once. This preserves intended homogeneous-source mass/extinction flux while reducing the number of represented births. With heterogeneous source positions, moisture and grain sizes, the equality is a statistical sampling approximation, not an exact identity for every realized time interval. The source still has the same fixed maximum storage, with no forced early slot reuse or position discontinuity. During the final 35% of a cloud's life, its population transfers smoothly to a counted, unrendered far-field reservoir. This retirement is a computational boundary; it does not destroy mineral matter or represent mineral evaporation. Terrain and water encounters transfer the remaining cloud into deposited matter.

For each material, `snapshot().budget` exposes source, live, exported and deposited mass in kg and nominal extinction area in m². Liquid additionally reports evaporated mass and extinction. The balances are:

```text
source dust = live dust + exported dust + deposited dust
source liquid = live liquid + exported liquid + deposited liquid + evaporated liquid
```

The same balance applies to nominal extinction area with the corresponding evaporation term. Spreading lowers projected density while preserving grain number and nominal extinction. During the last two seconds of an event, a decreasing duration-only factor exports the remaining represented population smoothly. The rising startup envelope never enters this retirement factor. At natural expiry any residual population is exported, the meshes disappear and `completedBudget` retains the final balance until an explicit clear or new event. `clear()` resets event and completed budgets, as intended for Stop/Restore.

## Shared optics and motion history

Dust, spray and condensate use the same far-to-near instanced soft-cloud path at every height. Its radial kernel is `exp(-3.4 q) × (1 - smoothstep(0.62, 1, q))`, where `q` is squared normalized billboard radius. The radial integral is `π R² × 0.274597137431334`; dividing extinction area by this accounts for the kernel's projected density. Two existing 3D noise reads use a shared advected world coordinate, so nearby clouds contain coherent optical irregularity instead of independent noise that averages into a smooth column. This modulation is normalized approximately in the ensemble, not exactly per cloud. The nominal CPU extinction budget is therefore not an exact per-frame rendered flux integral.

Beer–Lambert transmittance uses `1 - exp(-opticalDepth)` and premultiplies colour once. Opaque scene depth clips a soft cloud chord, avoiding a hard billboard centre-plane seam. This follows the depth-soft particle principle in [NVIDIA GPU Gems 3, chapter 23](https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-23-high-speed-screen-particles). Transparent water is absent from the opaque depth buffer. Cloud ordering, lighting, multiple scattering and the planar density projection remain optical approximations.

Motion history includes world position, cloud radius, rotation and previous camera-facing orientation. A reused pool slot starts with matching current and previous values. After GPU submission prior values settle to current values, so paused renders do not reuse the last moving frame's particle velocity. Stop and restore draw zero instances until another event starts.

## Cost and verification

The fixed pools use two draws, at most 3,328 triangles, zero volume ray steps and 262,144 bytes of static noise texels. No density grid is rebuilt per frame. Removing the volume reduces one draw and ray marching, while greater cloud radius can increase overdraw. Actual cost requires controlled browser measurement; triangle count alone does not predict it.

`app.disasters.tornadoVisuals.snapshot()` exposes the budget, evaporation count, maximum cloud radius, liquid-cloud count, source/deposition/expiry counts and real poses. A parcel exposes `diameter`, `initialDiameter`, `liquidFraction` (remaining mass fraction per droplet), `grainMass`, `number`, `cloudMass`, `extinctionArea`, `relativeHumidity`, `mixedFraction`, `sourceMoisture`, `sourceHumidity`, `sourceLoading`, `id` and `cycle`. `completedBudget` retains the final accounted natural-expiry balance. These are observations for verification, not user-facing controls.

The final plume and director selection passes 25/25; the normal simulation suite also includes grain transport and the other aerosol regressions. Exact tests against buildable original particle and volume modules pass 12 unchanged/analytic cases and fail five intended production expectations: liquid evaporation, entrainment spreading, spatially shared eddies, matter budgets and a single optical population. The final source cases also fail against candidate1 behavior and pass unchanged on candidate2: they check actual upper emission geometry and statistical grain population before metadata. Separate cases cover continuous spatial moisture and the real Field.advance → TornadoVisuals.update duration crossing with both mass and area budgets. Candidate3 adds exact concentration-to-mass/extinction injection, the independently calculated constant-source weighting fixture, and actual continuous ground emission over 54 seconds at both 1/60-second and 0.1-second steps. The unchanged production seeding and steady-source tests fail against candidate2 for wrong seeded liquid mass and measured pool starvation, then pass in candidate3. Tests retain size-dependent grain transport, analytical settling, finite-Re convergence, shared wake response, deposition, pause, reset and submitted motion history.

The staged full-pool flat-terrain diagnostic uses the actual field at 100 m/s, 180 m radius and zero translation. Candidate3 emits 72–74 mineral clouds per second after startup across the 55-second observation, and retains roughly 197–224 visible low clouds at 6–18 seconds instead of the former 99 at second 8. Across 80–320 m, no sampled row's peak unmodulated opacity falls below 0.1. At 8/12/16 seconds, the minimum row peak across 0–80 m is 0.441/0.368/0.299. These orthographic kernel estimates exclude GPU noise, camera, lighting and scene depth; they are not visual acceptance. Visible particles remain free to rise beyond the old fixed volume height.

Candidate1 passed the actual UI lifecycle BDD and GPU compilation, but was rejected after all five wide and five detail frames were inspected: it removed the old high chimney while leaving a narrow, weak middle column. Candidate2 added a broader heterogeneous source, but its ten full frames still showed intermittent detached upper puffs and a weak ground connection. Candidate3 addresses the measured under-loaded condensate inventory and demonstrated finite-pool starvation. It does not change validated shared air, physical grain drag or native debris forces.

The root identified a separate transparent-cloud temporal-accumulation defect in an actual GPU translation/spreading fixture. Settled particle transforms alone did not prevent a stale silhouette against opaque background depth. The scoped correction adds a cloud-coverage reactive mask: current and previous coverage reject stale temporal history without modifying shared water mask channels. The root owns that renderer coupling and its maintained actual GPU regression. It is a temporal reconstruction approximation, not another particle force or optical-mass term.

All five wide and five detail candidate3 frames were inspected. They show a stronger continuous lower connection and varying soft cloud width; upper tips form changing lobes. The near-horizon connection remains thinner, and some upper haze is still smooth. Both actual capture summaries report zero renderer/page errors, settled pause-history error zero and Restore returning to ten native bodies with zero broken structures. The integrated ordinary-UI lifecycle test passes: the same captured liquid cohorts shrink while rising, dry grains retain their diameter, Pause preserves poses and submitted motion history, and Stop/Restore/restart clears and recreates the plume. The final full frame and continuous motion were independently inspected. The main current limitations are smooth upper haze, transparent layering and the reduced statistical source, not an independently moving optical tube.

The production GPU fixture measures about 5.986 screen pixels of motion per frame across 4,568 samples. Eight frames after exposure, its plume-history error is zero; Stop clears 6,533 observed coverage pixels. A stack of 160 faint overlapping clouds still marks the reactive mask, and 2,162 water-mask samples remain unchanged. All twelve complete diagnostic frames were inspected. At 1,440×900 the reactive history adds about 5.18 MB, one mask copy and up to eighteen mask reads per output pixel. This protects plume edges from stale history but costs bandwidth; pool size and triangle count do not establish full-scene FPS.
