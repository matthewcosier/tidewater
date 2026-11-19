# Disaster simulation model

The subsequent [physics performance recovery](physics-performance.md) records the current solver optimization, matched timings and remaining smooth-play failure. Earlier measurements below remain historical evidence.

Tidewater uses one spatial environment field for the island. Coordinates are metres, time seconds, mass kilograms, force newtons, torque newton-metres, and velocities metres per second. The field combines the existing ambient wind with each active disaster. Multiple types can run together; starting a type again replaces that type's event. This is a real-time numerical model with declared idealizations, not a calibrated hazard forecast or a structural engineering assessment.

## Water and tsunami

The nonlinear, depth-averaged shallow-water state is water depth `h`, terrain elevation `b`, and discharges `qx=h*u`, `qz=h*v`. Its mass equation is `dh/dt + d(qx)/dx + d(qz)/dz = 0`. Momentum includes advective flux, hydrostatic pressure and the terrain-gradient source. A first-order Rusanov finite-volume flux with hydrostatic reconstruction preserves a still lake over varying terrain. Dry cells receive water through flux from their neighbours. No minimum depth is injected into dry cells.

The runtime domain is 257 × 257 cells at 8 m spacing, centred at world 0, covering 2048 m × 2048 m. Cell values are double precision; the same elevation, current and depth are packed to an RGBA32F texture. Rendering and GPU water queries use the same manual bilinear interpolation as CPU body queries. Existing small wind waves remain part of the boat/jetski GPU hydrostatics; coarse debris uses the common long-wave elevation. Flooding cannot resolve a wall or opening smaller than a cell. Buildings do not block flow in this terrain grid; no erosion, breaking-wave overturning or three-dimensional turbulence is solved.

The timestep satisfies `dt <= .45 / ((|u|+sqrt(g*h))/dx + (|v|+sqrt(g*h))/dx)`. Adaptive CFL substeps advance the whole accepted frame interval, up to 0.1 s. There is no 24-substep cutoff. Time beyond the accepted world interval, positivity correction and boundary sponge volume are recorded separately; extreme sources can require substantially more CPU work. The outer 8-cell sponge absorbs disturbance; it is an artificial open-boundary approximation. Initial below-datum basins contain still water. The initial tsunami pulse is restricted to the ocean component connected to its source, so it cannot appear across an emerged ridge in an isolated basin.

Tornado and ambient wind also drive this same grid while a water-coupled event is active. The surface stress is `tau = rho_air * Cd * |U_air - U_water| * (U_air - U_water)`, with assumed `Cd = 0.0015`. Each wet cell receives this momentum source using exact constant-air quadratic relaxation over the substep. Dry cells receive no stress, and the source creates no water. Applied wind impulse (N s) and kinetic work (J) are accumulated separately from wave-source volume and boundary losses. The prescribed atmosphere is an external momentum reservoir; water does not alter the prescribed vortex. Bounded air modifiers, including turbine wakes, feed both body air samples and surface water stress. `sampleRaw` exposes unmodified inflow to prevent double application inside a wake-producing system.

A controllable offshore elevation pulse adds a declared water volume. Its initial simple-wave velocity is `2*(sqrt(g*(h+eta))-sqrt(g*h))`, directed toward the target. Width and radius shape the source. Source volume and boundary removal appear in the conservation budget. This models an imposed incoming wave; it does not solve the generating earthquake or seabed uplift.

Start issues the warning immediately. Warning lead defaults to 90 s and is configurable 3–300 s. The source starts after that lead; Duration is the length of the incoming wave train from the first crest's arrival (one crest today; see "Design: the wave train"), and the event then runs until its flood has drained ("How a tsunami ends"). Crest arrival is estimated from source distance and the finite-amplitude simple-wave characteristic `3*sqrt(g*(h+eta))-2*sqrt(g*h)`. Bathymetry and dispersion error can change the actual arrival. The warning separately reports actual inundation once emerged cells exceed 0.1 m depth. Audio starts only after the Start gesture; mute, volume, global M, pause, stop and reset control the real oscillator sources.

Stop is an explicit laboratory control: it clears the wave field immediately and cancels disaster forcing/alarm, while damaged geometry and body momentum remain. Baseline sea buoyancy and ambient fluid drag continue. Restore reinstates saved geometry, collision surfaces and affected poses without changing the economy/save. Each new experiment after Restore captures fresh vessel, player and car state; simultaneous disasters retain one shared snapshot. Full car orientation and velocity, prior dents, detached parts and pre-existing loose car debris are restored.

Crests from 0.5 to 3,000 m are accepted without visual scaling. The extreme upper range is a numerical laboratory experiment: a 3 km elevation with a short source width violates the hydrostatic long-wave approximation. There is no overturning wall, atmosphere displacement or compressible impact model. The same numerical elevation and current drive visible water, CPU/GPU queries and body loads, with the existing explicit force limits. The ocean frustum bounds follow the actual packed surface extrema plus the ordinary ±25 m wave margin. The finite domain and its imperfect boundary treatment can reflect a crest above the requested source amplitude; the input is not a global maximum-height clamp.

### Far field, inflow and hand-off (walls the ring cannot hold)

Measured on the real island (`test/tsunami-farfield.mjs`, `test/tsunami-mega.mjs`): hand-off height within 3%, face within 64 m (two ring cells), face speed over the next 3 s within 25% of C; the 3000 m wall keeps 3000-3525 m at every gauge to the coast and overtops the 297 m summit; 320 m keeps 279-358 m and arrives above the village roofs; 2 m and 10 m get no far field. Cost: the ring's CFL step at 3000 m is about 8 ms of CPU (u + c = 885 m/s), so the mega run takes 40-50 s of CPU per 8-12 s of game time in node; the GPU port is open.

### How a tsunami ends

Design note (tsunami round of 12 November 2026).

- **Reference.** A tsunami flood ends when the water has run back to the sea; the backwash is as violent as the run-up (2011 Tohoku and 2004 Indian Ocean footage: debris and people carried seaward). Ponds in closed hollows stand for hours to days after a real event. The old end was a timer: at warning + approach + Duration the event was deleted and both grids dropped, so for the Severe 10 m (seed 1) 532,000 m3 of water on 12.3 ha of land, moving at up to 118 m2/s, vanished in one frame (2 m seed 7: 42,700 m3 on 4.7 ha).
- **Source of truth.** The solver's own state, computed in loops that already run: `WaterGrid.pack` on the CPU, `WaterGridGPU.readback` on the GPU, both through `WaterGrid.drainStats` (largest land discharge h|u|, land cells deeper than `INUNDATION_DEPTH` 0.1 m moving faster than `STILL_SPEED` 0.2 m/s, wet land cells, the largest departure of a wet sea cell from datum). The ring's cells under the village grid are left out (`WaterGrid.nestIn`, `covered`): the village grid is what is drawn and sampled there.
- **Phases** (`Field.js` `tsunamiOver`). Warning, approach, train (from the first crest at `e.arrival` to `e.trainEnd = arrival + Duration`), drain, hand-back, end.
- **Drain condition.** After the train, no land cell deeper than 0.1 m moving faster than 0.2 m/s (slower water cannot move fine sand, Hjulstrom 1935: it stands), and no land discharge at or over 0.4 m2/s (`FloodHazard` `HU_CHILD`, the lowest line the game knocks anyone at): the backwash can no longer carry a person seaward. Held 2 s (`DRAIN_HOLD`). The drain is the solver's flow: nothing is softened to end it sooner.
- **Hand-back.** Then standing water on land soaks in at 0.04 m/s and every other wet cell returns to its still level at 0.5/s (`CALM`, `WaterGrid.calmCell`, the same maths in the WGSL `sources` pass). 0.04 m/s is about 700 times the saturated conductivity of sand (5.8e-5 m/s, Rawls, Brakensiek and Saxton 1982): a declared compression, because real ponds stand for hours. The grids drop when no land cell holds water (the 2 mm packed wet line) and no sea cell is more than 1 cm off datum, so nothing the player sees or a hull feels moves by more than that across the end. A tornado on the same grid skips the hand-back (the grid stays for it).
- **Bounds.** `DRAIN_LIMIT` 600 s after the train and `CALM_LIMIT` 120 s exist only to stop a stuck state; `e.drainCapped` records a drain the limit ended (a defect, not a flood). `Field.endTime` for a tsunami is now that latest end.
- **Stop** still clears at once.
- **Edges found while building it.** Friction used a 2 cm depth floor, so a film ran at up to 12.7 times its Manning speed (2-7 m/s in 2-4 mm of water, 200 land cells 60 s after the 10 m crest); it now uses the cell's own depth (`test/tsunami-film.mjs`: a draining film stays within 2 times Manning). The surface-slope reconstruction across a step in the free surface lifted a downhill face's bed above the water: a 1.86 m pool held 30 m/s for 100 s on a 1:2 hillside at (360, -128) without moving (56 m2/s at one cell, which alone would have kept the drain open). Such a cell is now first order (`WaterGrid.sweep`, WGSL `slopeAxis`); a lake at rest has no step.
- **Open.** The land floods a second time 255-290 s after a single crest (10 m seed 1: land volume 25,000 to 144,000 m3; 2 m seed 7: 1,500 to 12,600 m3). It is not the ring's edges: the sponge returns 1.0 % of a radial wave (`test/tsunami-open-sea.mjs`; a characteristic absorbing band was tried, returned 0.7 %, and left the re-flood as it was). Candidates: the crest's reflection off Joey Island and the strait's far coasts, edge waves on the shelf, or the plane crest's flanks eaten by the ring's side bands, whose deficit diffracts in. The drain waits for it, as it should if it is real. Not yet met for the Severe 10 m (seed 1): its land water was still moving 600 s after the train, so the drain bound fired, and the hand-back's 120 s bound fired with 1.56 m (803 m3) still on land (`test/tsunami-drain.mjs` fails on it). The Surge 2 m (seed 7) drains through the solver 455 s after its train, the hand-back takes 15 s, and 363 m3 of a 120,000 m3 flood is left to soak in.
- **Evidence.** `test/tsunami-drain.mjs` (both presets: no water on land and the sea within 5 cm at the last frame; under 5 % of the peak flood volume left when the hand-back starts; the drain held on the water, not the limit), `test/tsunami-film.mjs`, `test/tsunami-open-sea.mjs`.
- **What a depth-averaged solver cannot give the look lane.** No overturning lip, no spray, no air entrainment, no sediment or debris load in the water: the front is a steep bore in the solver, and the dark, debris-laden, foaming front of the 2004 and 2011 footage must come from the look (`FloodLook.js`, spray, sediment).

### The wave asked for is the wave launched

`test/tsunami-launch-at-sea.mjs` read the launched crest from the village grid (+-1024 m). Since the plan stands the crest out on its C+ characteristic, every 10 m source sits 1.4-2.2 km out, in the ring only, and the village grid held the crest's tail (4.04 m for the Severe 10 m, seed 1) while the ring held 10.00 m. The test now reads the grid that holds the source line. The launch was right. `test/tsunami-crest-height.mjs` holds the arrival: the first crest at the wet shoreline gauge stands between 0.85 times the smaller of Green's law height (Green 1838) and the McCowan breaking height, and 2 times Green's height (incident plus full reflection). Measured on seeds 1-10: 2 m 0.87-0.98 of Green, 10 m 0.84-1.49, 25 m 0.80-1.59 (the 25 m sources sit in 10-13 m of water, so the excess is the beach's reflection and the bore's set-up).

### Design: the wave train (not built this round)

Real tsunamis arrive as several waves over hours, the first often not the largest (2004 Banda Aceh eyewitness reconstruction, Lavigne et al. 2009; 2011 Tohoku tide gauges). The design for the next round:
- Crests 2..N may not appear in one step (anti-pattern "an event that appears instead of arriving"), so they are not host writes at the source line (and on the GPU path the host grid holds the blended readback, not the solver state). The train is one analytic field, a sum of N-waves with crest k at D_k(t) = launchDistance + gap_k - c_k t: written as the initial condition at launch for the part inside the ring, then fed through the ring's upwave band (a generalised `inflowAt` and WGSL `inflow()`, per-crest uniforms in the 128 bytes still free per 256-byte parameter slot), only on band cells upwave of the target.
- The interval is the crest's own period, about 2 pi sigma_t with sigma_t = crestWidth / c at the source depth (a Gaussian matched to a cosine crest), times a drawn 0.9-1.4: 40-120 s. Shorter would overlap the crests and lose the draw-back between them. Number of crests drawn 2-4, cut to those that arrive within Duration; heights drawn with the largest equal to H, which crest is largest drawn (first or second most often). Draws come after the existing ones in `planApproach`, so every seed's plan stays as it is. Crest k's countdown is the Dijkstra line time at D_k, scaled by the ray-travel ratio for H_k. Walls keep one crest (their plateau already spans the train).
- `e.arrival` stays the first crest: `EvacuationAI` (dawdling, read only in its warning phase) needs no change, and the all-clear fires only when the event ends, so nobody walks back to the beach between crests. The banner names the next crest's estimate and that more waves are expected until the event ends.

### Coastal flooding detected (the warning's coast)

### The wave is generated at sea

### Seeds and replay

**Reference.** The maths does not change: second-order central-upwind (Kurganov and Petrova 2007) with hydrostatic reconstruction (Audusse et al. 2004) and Heun's SSP-RK2, Manning friction, the edge sponge, the far-field inflow band (Mayer, Garapon and Sorensen 1998) and the one-way nest. `src/disasters/WaterGridGPU.js` is a pass-for-pass WGSL mirror of `WaterGrid.step`, with the CPU line each pass mirrors named in its comment. The CPU `WaterGrid` stays the reference and the node path: every node test keeps running it, and the parity test holds the two together.

**Passes (one step, one compute pass, 64-thread workgroups over the n^2 cells, 1033 groups at n 257).** `slopes` (both axes' limited slopes of eta, h and the normal and tangential speeds, first order at the edge and next to water under DRY 1 mm: `WaterGrid.sweep`'s first loop), `faces` (each face's central-upwind flux once: mass, normal momentum less the left side's face pressure, tangential momentum, and the pressure difference the right side adds), `update1` (gathers its four faces and the centred bed term `-g h sEta`, saves the stage copy, positive Euler step: `stepSecond` stage one), then `slopes`, `faces`, `update2` (the Heun average), `sources` (friction, then on an un-nested grid the inflow band or the sponge: `WaterGrid.sources` / `inflowAt`), `nest` (the edge band relaxed to the parent's blended field: `nestToParent`), `pack` (previous <- state, state <- (surface, u, v, h): `WaterGrid.pack`). Per frame: `blend` (pixels = mix(previous, state, lag / step): `WaterGrid.blend`) and `rate` (the CFL rate's maximum, atomicMax on the float's bits: `WaterGrid.stableStep`). Each face is computed once and read by both its cells, so the mass a face moves leaves one cell and enters the other exactly (conservative in f32). The state is f32 on the GPU (f64 on the CPU); a lake at rest stays exactly at rest because the bed and the still depth round to the same magnitude.

**Layout.** Per grid: `U` 2 n^2 vec4 (h, qx, qz, bed; then the stage copy), `S` 2 n^2 vec4 (x then z slopes), `F` 2 n^2 vec4 (x then z faces), `PK` 3 n^2 vec4 (state, previous, pixels: the same (surface, u, v, h) the CPU `pixels` holds, the layout the renderer's `disasterGridTex` reads and `Field.sample` interpolates). 6 storage bindings per pass (the engine requests 10). 257^2: 4.2 MB per grid, 8.5 MB for both. The ring's `PK` is bound read-only to the village grid's `nest` pass.

**Source of truth.** The GPU `PK` pixels are the field: the renderer reads them in place (no upload: the texture becomes a storage buffer the water shader indexes, or `pack` writes the texture as a storage texture), and the CPU consumers read a copy. Launch and `addImpulse` stay on the CPU (they are one-off writes onto water at rest) and upload `U` once; the event's inflow bookkeeping (`inflow.elapsed`, `time`, `stats.steps`) stays on the host `WaterGrid`, which the GPU wrapper advances.

**CPU consumers.** Every reader of `Field.waterAt` / `Field.sample` / `WaterGrid.sample` (Ragdoll, RagdollPool and RigSnapshot, Structures, Disasters, EvacuationAI, Contact, FerryShip and FerryDeck, Chairlift, Aviation, Glider, OnFootExit, Habitat, Brain, Sharks, Route) reads `pixels` through the same bilinear `sample`. In GPU mode those `pixels` are an async readback: `copyBufferToBuffer` of the pixels third of `PK` into one of two MAP_READ staging buffers, `mapAsync` resolved one or two frames later and copied into the host grid's `pixels` (same layout, so `sample`, `floods`, `landWithin` and every consumer are unchanged). Gameplay never waits on the GPU: a frame whose readback has not resolved keeps the previous field (one to two frames, 17-33 ms, late: under a body's 0.3 s surface smoothing and the 1 s ragdoll rest test). Readback: 1.06 MB per grid per frame, 2.1 MB for both (unified memory on the M-series target). `stats` that need a reduction (inundated area, min and max surface) come from the readback on the CPU, as `pack` computes them today; `positivityCorrection` and `boundaryVolume` are not kept on the GPU (named gap: a reduction pass if a test needs them in GPU mode).

**Detail by distance.** Unchanged: the ring (32 m cells, 8.2 km) holds the approach and the far field, the village grid (8 m, 2 km) the coast; beyond the ring the analytic wall (`disasterFar`).

**Transitions.** CPU to GPU happens at grid creation (a device exists: GPU; node or no device: CPU). Launch and an impulse upload the host state once (a readback copied before the upload is dropped by epoch, so the calm sea never lands on a just-launched wave). Stop, and the end of the last water event, destroy the GPU buffers with the grids (a readback still mapping is caught, not thrown). GPU to CPU happens mid-event in two cases, both from the last readback: a tornado starts (its wind stress is not on the GPU) and the device is lost (`device.lost`; once, for the session).

**Edges.** Non-finite rate: the CPU throws; the GPU rate pass ignores NaN (atomicMax on bits) so the host checks the readback for a non-finite or zero rate and falls back. f32 positions: cell centres within 4.1 km of the origin carry 0.25 mm of rounding, the far-field crest position the same. The nest's `pn - 1.000001` clamp rounds to `pn - 1` in f32, so the GPU clamps the base cell to `pn - 2` instead (same bilinear weights).

**Evidence plan.** `test/tsunami-gpu-parity.mjs` (headless WebGPU through `test/headless.mjs`): the real island, the Surge 2 m and 320 m events (seed 1) in the real `DisasterField`, both grids snapshotted in flight, then the same CFL steps on the CPU and the GPU: eta and momentum within a stated tolerance, volume within 1e-6 of the CPU's, and a closed basin (no sponge) conserving its volume to 1e-6. Then the readback path, the switch in `Field` and the before / after bench.

## Rendering the flood

**Reference.**
- Bore strength is the bore Froude number Fr1 = c / sqrt(g h1). Undular (smooth crests, no roller) below 1.3-1.5,
  breaking roller beyond, fully breaking by about 2 (Chanson 2009, Eur. J. Mech. B/Fluids 28, 191-210). The
  renderer sees only the state behind the front, so it inverts the jump relations for a front running into still
  water or a dry bed: Fr2 = sqrt((r + 1) / 2) (r - 1) / r with r = h2 / h1. Fr1 = 1.3 is a local Fr2 of 0.316 and
  Fr1 = 2.0 is 0.751 (`src/disasters/FloodLook.js` derives both; `test/tsunami-render.mjs` pins them).
- Overland flow in 2011 ran at Froude numbers of about 0.7-2 and was white and churning where supercritical
  (Fritz et al. 2012, Geophys. Res. Lett. 39, Kesennuma survivor videos).
- Suspended sediment in the 2004 and 2011 flows was of order 1-10 kg/m^3 (Jaffe and Gelfenbaum 2007, Sediment.
  Geol. 200): brown-black water, opaque within centimetres. Fine sand goes into suspension at about 0.5-3 m/s of
  depth-averaged flow in shallow water (Soulsby 1997, Dynamics of Marine Sands).
- Declared game choices: the lip leans forward 0.35 of the jump and the roller stands 0.1 of the jump above the
  conjugate depth (after the plunging lip in `src/ocean/Breakers.js`); sediment optics at turbidity 1 are
  absorption (9, 11, 14) /m and scattering (12, 11.5, 10.5) /m (`FloodLook.SED_ABSORB`, `SED_SCATTER`, the only
  copy: extinction 21 to 24.5 /m, so 5 cm of it hides about two thirds of the ground and 15 cm all of it), the ratio giving the
  brown-grey colour; the foam flow map cycles every 3 s.

**Source of truth.** Everything is read from the solver's packed state (`WaterGrid.pack`: surface, u, v, depth)
through `DisasterWater` (`src/disasters/Water.js`), the same texture the boats' `WaterQuery` height uses. The
classifier and the turbidity model are one set of constants in `FloodLook.js`, emitted both as JS (tests, the
debug stat) and as WGSL. The physics is never changed here.

**What it draws.**
1. Bore face, per vertex and per pixel: local Fr from the packed depth and velocity, the face slope as the fall of
   the interpolated surface along the flow; breaking = Fr ramp (0.316..0.751) x face ramp (0.02..0.10 m/m) x depth
   ramp. The jump h2 (1 - 1/r) scales the lip (vertices thrown forward along u) and the roller.
2. Whitewater, per pixel: the breaking roller plus the churning supercritical sheet (local Fr 0.6..1.6 in shallow
   water), as foam coverage and as aeration in the water medium.
3. Foam streaks advected by u: a two-phase flow map on the foam pattern where the flood flows.
4. Turbid flood: sediment absorption and scattering added to the water medium by turbidity (0 in water deeper than
   about 30 m, 1 over flooded land, stirred in fast shallow water).
5. Surf suppression: the shore waves' displacement, the plunging face, the roller, the surf foam and the shore
   simulation's foam fade where a surge or drawdown of 0.4-2 m covers the sea, or any flood (0.1-0.6 m) covers the
   beach. The run-up sheet already drops below the flood surface.
6. Waterline per pixel: the render surface carries the wet corners' level across the cell
   (`disasterSurface`), so the waterline is where that level meets the real terrain, not the 8 m (32 m outer) grid.

**Budget.** No new passes, draws or dispatches. Per water vertex the flood now costs 4 samples of the packed state
(it was 8: height, two 3-sample slopes, foam). Per water pixel, 3 samples plus two foam texture taps where the
flood flows. Off (no event) every sample returns at the domain check. Measured: see Evidence.

**Detail by distance.** The lip and roller follow the water mesh (fine near, coarse far, as the waves do). Foam
pattern detail fades into coverage with the pixel footprint (the existing rule), so far water shows the colour and
the white of the bore, near water the streaks.

**Transitions.** Every term is a smoothstep ramp: the bore appears as the Froude number and the face grow and
fades as they fall; turbidity grows as the water runs over the land; the surf fades over 0.4-2 m of surge.

**Edges.** Still water has Fr 0, so the still waterline (a large surface step to a dry cell) is never a bore. A
steady current with no face is not a bore. Depths under 0.02 m carry no face. The ratio iteration contracts (factor
< 0.5) for every Fr, so it cannot diverge; speeds are divided by max(speed, 1e-4).

Not yet built: GPU spray and mist along the front and at obstacles (a separate emitter, `FloodSpray.js`); the view
from a camera inside the flood (the underwater composite fogs with the clear sea's optics).

### Design: the sun on rough flood water

From 220 m toward the sun (`tsunamiAir`, 15.5 h) the flood drew a pale silver sheet with dark wavy lines, near-white
behind a 25 m wave, out to its edges. Water debug view 18 (the sun's glint alone) holds it: little foam (view 3), a
tan body (view 16), a dark sky reflection (view 17).

**Reference.**
- The slopes of a wind-roughened water surface are close to Gaussian (Cox and Munk 1954, from photographs of the sun's
  glitter taken from an aircraft; skewness and peakedness are small corrections). The mean square slope is 0.003 +
  0.00512 U over both axes, 0.075 at 14 m/s.
- The flood's chop below the solver's 8 m cells holds a mean square slope of 0.06 to 0.09 at full turbulence
  (`CHOP_*`, declared, the violent end). The sea's glint is a GGX lobe of roughness a2 = 2 x the slope variance below a
  pixel (`WaterMaterial`), and the flood's chop was added to that a2.
- GGX's slope density falls off as a power law, a2 / ( pi ( a2 + s^2 )^2 ). At a mean square slope of 0.08 it holds 134
  times the Gaussian's density at three rms slopes (0.85, 40 degrees). Beckmann's distribution is the Gaussian of the
  slopes; Smith's masking for it from the rational fit of Walter, Marschner, Li and Torrance 2007.

**Rule.** The glint's lobe is a mixture by the flood's share of the roughness (its chop's share of a2): that share is
Beckmann's distribution of the slope variance a2 / 2 with its matched height-correlated masking, the rest the sea's
GGX lobe (`FloodLook.floodGlint`, WGSL `floodGlint`). Far from the core the mixture's density is ( 1 - share ) a2 /
( pi s^4 ), the tail of the sea's own lobe: what a Gaussian chop added to the sea's slopes leaves there. Without a flood
the share is 0 and the shader takes the sea's expression unchanged. Nothing else moves: no roughness lowered with
distance, no cap on the glint. The jetski's headlamp takes the same lobe.

**Source of truth.** The flood's chop variance (`WaterSurface` `floodSurf.x`), the sea's roughness as it was. One
rule, `floodGlint`, read by the sun's glint and the headlamp's.

**Budget.** Per pixel with flood chop below it: one exp, two inverse square roots and about thirty multiplies and
adds, no sample. The sea skips it (a branch on the share). Measured under Perf.

**Detail by distance.** As the chop: the share grows as more of the chop falls below a pixel.

**Transitions.** The share is continuous: 0 at the flood's edge, where the chop fades out with its turbulence.

**Edges.** A facet turned from the light or the eye takes nothing (Smith's masking goes to 0); a share over 1 is
clamped; the lobe's density is guarded against a facet at 90 degrees.

### Design: foam where the water breaks

At 10 m and above the flood drew pale from the air (dunes, chalk, a snow field) and the 320 m wall as a cliff of
chalk with a white plateau behind its crest. The history made foam wherever a cell classified as breaking (a local
Froude number and an absolute surface slope, born at twice that), and the shader painted the same classifier white
on every pixel. In a large event nearly every cell classifies: on the seeded events 92 % of the flooded land held
dense foam 5 s after a 10 m wave arrived, 97 % behind a 25 m wave, and 91 % of the sea in the grid behind the 320 m
wall at +20 s (`foamShare`, the share of wet cells whose history foam stands over one half).

**Reference.**
- A bore of depth ratio r = h2 / h1 has the bore Froude number sqrt( r ( r + 1 ) / 2 ) (Belanger). Under about 1.3
  it is undular, a train of smooth waves; between about 1.3 and 1.8 its first crest breaks into a roller (Chanson
  2009, "Current knowledge in hydraulic jumps and related phenomena", Eur. J. Mech. B/Fluids 28; Chanson 2010 on
  tidal bores, the lower end in the field). The head a jump loses is ( h2 - h1 )^3 / ( 4 h1 h2 ), which is
  ( r - 1 )^3 / ( 4 r ) of h1: 1.2 % at a bore Froude number of 1.3, 11 % at 1.7. The roller is where that energy
  goes, and the roller is the white.
- The water behind a tsunami front is a deep, fast, smooth body: black-brown water with foam in streaks (Tohoku
  2011 from the air; Fritz et al. 2012). On the seeded 10 m event the median depth ratio across four cells among
  fast, rising water is 1.06 to 1.25, under the undular bore.
- Whitecap foam on clean sea water decays with an e-folding time of about 3.5 s (Monahan and Zietlow 1969): the
  dense stage. Loaded water keeps a thin residue many times longer (Callaghan, Deane and Stokes 2013), streaks
  minutes old in the Tohoku footage.

**Real outcome.** A dark body with a torn white front at every height from 2 m to the 320 m wall: at most about a
third of the flooded land in dense foam 5 s after arrival and less by +20 s; foam over loaded water tan and lit as
the water round it, in shadow on the lee of the wall and of a building.

**Source of truth.** The solver's packed state, as before. One rule for the roller (`roller`, WGSL `floodRoller`),
read by the history (`frontFoam`) and by the shader (`disasterLookAt`'s `o.roller`), and one light for the flood's
body and its foam (`floodLight`, `FLOOD_LIGHT_WGSL`). `classifyBore`'s `breaking` keeps its meaning (the lip, the
turbulence, the review camera's front).

**What it draws.**
1. Foam is born where a front carries a roller (`frontFoam`): the depth falls along the flow, the flux converges
   (`FACE_FILL`), and the jump `JUMP_SPAN` cells behind against `JUMP_SPAN` ahead, the smaller of the surface's and
   the depth's fall as a share of the depth behind (the depth step alone where the water ahead is under `JUMP_DRY`),
   ramps from `UNDULAR_FR` to `ROLLER_FR` on its bore Froude number. The fast leading edge still foams (`EDGE_FOAM`).
2. Two stages in the one foam channel: the excess over `FOAM_RESIDUAL` decays with `FOAM_ACTIVE_LIFE`, the rest with
   `FOAM_LIFE`. Foam over one half was born in the last 4 s.
3. Per pixel, the face's white is the classifier's breaking times the larger of the roller of the jump to the two
   samples the wake already takes ahead (`jumpDrop`, unweighted) and a tall face's crest and foot (`tallFront`).
   Beyond the grids the far wall's crest band keeps it as before. The carried foam is solid by its share above the
   residue (`lace`).
4. Flood foam takes the sun by its facet's cosine and the sky by the share its facet sees, as the body does. It took
   a wrapped sun, a quarter of it on a face turned away.
5. The lip leans forward and the roller stands up only where a front carries a roller (`o.roller`, the face's own
   rule). On the classifier alone the body behind a 10 m and a 25 m front stood in hummocks, a range of dunes.
6. The silt a bed holds and the water carries is a mass per area, so the load a column carries is at most
   `SILT_COLUMN` / h (8 m: a 10 cm deposit at about 1600 kg/m^3 makes about 8 m of column as turbid as the opaque
   flood, taken as 20 kg/m^3 of fines; declared), on top of what its own flow raises. Undiluted, the 320 m wall over a
   bay the drawdown had silted drew tan from its crest to its foot (water debug view 16, the body alone).

**Budget.** No new pass, draw, dispatch, texture or sample on the GPU: per flooded pixel inside the grids one more
min, max and square root (the roller reads the two samples the wake takes). CPU: per moving wet cell over the
undular local Froude number whose flux converges, two bilinear samples of two channels (16 reads), inside the
history's band; the history step stays under its band budget (median under 1 ms a frame). Measured under Perf.

**Detail by distance.** As before: the history covers the inner grid; the outer ring and the far wall take their
white per pixel only.

**Transitions.** The roller ramps over a bore Froude number of 1.3 to 1.7; the dense foam fades over seconds and the
residue over tens of seconds. No term switches.

**Edges.** The source is the front's own jump: speed, depth and slope alone make none (a 10 m deep flow at 12 m/s
whose depth falls 6 % a cell holds none). Still water: no speed, no source. A sheet thinning down a slope converges
nothing. A dry cell ahead: the depth step stands alone. The stencil reads the packed state only, so a step taken in
bands ends where one whole step does. Steps are capped at 0.5 s.

**Evidence.** Node, `test/tsunami-flood-look.mjs`, five tests shown to fail on the previous source: a 10 m deep flow
at 12 m/s whose depth falls 6 % a cell held foam 1.00 after 5 s; an undular step (depth ratio 1.25) held foam 1.00;
3.5 s after its source stopped the foam was still 0.92; flood foam on a face turned from the sun took 0.25 of the
sun; 5 s after the seeded 10 m wave reached the village 92.5 % of the flooded land carried dense foam. Four tests
moved with the source: the decay on still water is the two stages; the 2 m surge's foam is counted on the cells a
roller covers (`frontFoam`), not on every cell the classifier calls breaking; the foam behind the face decays as the
history decays it; the tall face is unchanged (its first argument is now the roller). A sixth: a 300 m column of the
wall over a bed the drawdown silted carried a load of 0.99 after 1 s (now under 0.05).

Water debug views 16, 17 and 18 (`PW_WDBG`) draw the body, the sky's reflection and the sun's glint alone. From
`tsunamiAir` toward the sun 20 s after a 25 m wave arrived the flood draws near-white with little foam (view 3): the
pale is the sun's glint over the flood's rough surface (view 18) on a tan body (view 16).

Dense foam over the flooded land (bed above the datum) and over the sea in the grid, the share of wet cells whose
history foam stands over one half, seed 7, the history stepped whole every 0.1 s (node probe; moments after
`e.arrival`; the sea column is diluted by about 53,000 cells of undisturbed sea):

| Height | Moment | Land before | Land after | Sea before | Sea after |
|---|---|---|---|---|---|
| 2 m | +1 s | 49.5 % | 24.4 % | 1.7 % | 0.5 % |
| 2 m | +5 s | 47.2 % | 26.2 % | 1.4 % | 0.3 % |
| 2 m | +20 s | 20.3 % | 9.9 % | 0.6 % | 0.1 % |
| 10 m | +1 s | 94.1 % | 29.6 % | 16.2 % | 0.8 % |
| 10 m | +5 s | 92.5 % | 21.7 % | 16.0 % | 0.6 % |
| 10 m | +20 s | 80.6 % | 9.3 % | 12.3 % | 0.5 % |
| 25 m | +1 s | 97.1 % | 48.4 % | 33.0 % | 1.6 % |
| 25 m | +5 s | 97.2 % | 32.6 % | 32.4 % | 1.1 % |
| 25 m | +20 s | 96.7 % | 7.2 % | 26.7 % | 0.7 % |
| 320 m | +1 s | no land wet | no land wet | 38.9 % | 4.9 % |
| 320 m | +5 s | 99.4 % | 17.0 % | 61.6 % | 2.1 % |
| 320 m | +20 s | 100.0 % | 0.0 % | 90.8 % | 0.0 % |

### Design: water that moves, a torn front, a film edge and wet ground

The flood drew as a flat brown mirror with lace scribbles, a straight seam across the beach, a stepped edge with a
dark rim against dry sand, and ground that was dry the instant the water left. Once it moved, the big waves showed
what was still wrong: a 320 m wall and the water behind a 25 m front drew white from top to toe (a cliff of chalk, a
field of snow), the far wall drew as a pale curtain, a 2 m surge turned the whole bay brown, the sheet arriving over
the beach had no foam at its edge and no direction, the wet ground ended on smooth lobes, and fast water smeared.

**Reference.**
- Tohoku 2011 (the Sendai plain from the air, the Miyako sea wall, Kesennuma harbour: Fritz et al. 2012), Banda
  Aceh 2004 and Lituya Bay 1958 for a wall: black-brown water with a matte, chaotic surface, chop of decimetres to
  metres, boils, foam in streaks along the streamlines for minutes behind the front, a leading edge that is a thin
  running film behind a tumbling line of froth, white where the water breaks (the crest and the foot of a face) and
  dark between, and ground left dark and glossy under a sheet of silt.
- A free surface breaks up when the turbulence under it overcomes gravity and surface tension, at velocity
  fluctuations of about 0.3 m/s (Brocchini and Peregrine 2001, J. Fluid Mech. 449). What deforms it is the turbulent
  energy against gravity over the eddy's size, q^2 / ( g L ): q follows the speed (10 to 20 % of it over the rough
  ground of a flooded town) and L the depth, so the slope variance follows the Froude number squared in any regime.
  `floodTurbulence` is the square root of a speed term (`TURB_SPEED` 0.2 to 2.5 m/s) times a Froude term
  (`TURB_FROUDE` 0.05 to 0.7): 0.9 for 2 m/s through a metre of water in a street, nothing under Froude 0.05, so the
  open sea keeps its own surface.
- The largest eddies and the boils they raise scale with the depth (Nezu and Nakagawa 1993): chop wavelength 2.5
  depths on fixed wavelengths from 0.5 to 86 m, and every finer wavelength keeps `CHOP_FINE` of the slope (the
  cascade). The streaks and boils of a thin sheet are a few depths across, so its foam gathers on the fine streaks.
- A gale-driven sea has a mean square slope of 0.003 + 0.00512 U (Cox and Munk 1954), 0.075 at 14 m/s. A boiling
  flood is at least that rough: 0.06 to 0.09 at full turbulence (declared, the violent end).
- A rough surface seen at a grazing angle reflects the mean Fresnel share of the sky over its facets, not nearly
  all of it (Bruneton, Neyret and Holzschuch 2010): `meanFresnel`.
- Whitecap foam on clean sea water decays with an e-folding time of about 3.5 s (Monahan and Zietlow 1969); water
  loaded with surfactants and fines holds it many times longer (Callaghan, Deane and Stokes 2013, J. Phys. Oceanogr.
  43). The Tohoku footage shows streaks minutes old: `FOAM_LIFE` 40 s (declared, the long end).
- The bed's fines reach the surface once they have mixed up through the column: about 0.4 h^2 / Dz with
  Dz = 0.067 u* h (Elder 1959; Fischer et al. 1979) and u* about a tenth of the speed, 60 h / u seconds. A surge
  passes in a minute or two, so water shows its bed where its depth over its speed is under 0.3 s and keeps the
  sea's colour over 1.2 s (`STIR_MIX`, declared band).
- Wet ground is about half as bright as dry (Twomey et al. 1986; Lekner and Dorf 1988), darkens before it turns
  glossy (Lagarde 2013) and stays dark for tens of minutes to hours. `WET_DRY` 300 s e-folding (declared: the fast
  end, so the player sees it dry). A tsunami leaves a sheet of sand and mud 1 to 30 cm thick, thicker in the lows
  (Jaffe and Gelfenbaum 2007).

**Source of truth.** The solver's packed state, as before. Every constant lives in `FloodLook.js` and reaches the
shaders through `FLOOD_LOOK_WGSL`. The history is computed from the packed state alone. The ground's small relief
(`floodRelief`, two grains of noise fixed to the ground) is one function for the film's edge and the wet ground.

**What it draws.**
1. One cover rule across the waterline (`floodCover`, Water.js `disasterLookAt`): the thresholds run from the sea's
   (0.4 to 2 m) to the land's (0.1 to 0.6 m) over bed -2 to 0 m.
2. A history of the flood (`FloodHistory`), stepped on the CPU at the solver's cadence on the inner grid, a band
   of rows a frame (`HISTORY_BANDS`): foam (born on the breaking face and at the leading edge, carried along the
   flow, decaying), turbulence (it outlives the front by `TURB_LIFE`), sediment load (water that has run over the
   land stays brown when it runs back to sea, and the bed keeps the silt it dropped) and wet ground (1 under water,
   drying with `WET_DRY`). It rides in the third block of rows of the one disaster texture and keeps its own
   domain, so the wet ground outlives the grids; a restored island is dry.
3. Chop the 8 m solver cannot hold (`floodChop`): gradient noise with its analytic gradient on fixed wavelengths,
   dragged along the flow in two phases and drifting against each other, scaled by the turbulence. Octaves finer
   than a pixel become slope variance: roughness for the sun's glint, the mean Fresnel reflectance, and a
   reflection that goes from a mirror to the sky's mean radiance (`MATTE`).
4. The body takes its light through its own facets, and its shade varies in plumes and drifts of flotsam.
5. Foam off the face is the history's cover gathered into rafts along the flow (`raft`), drawn as its own cover
   and lit as a plain scatterer, tan over loaded water. In a thin sheet the fine streaks carry the pattern
   (`RAFT_SCALES_THIN`), so the water is seen to run.
6. Deep water is dark between its streaks, whichever term made the foam (`FACE_TALL`, `FACE_TALL_COVER`), and a
   tall face is white at its crest and its foot (`tallFront`: where a pixel stands on the face, from the surface
   two cells up and down the flow). The far wall keeps every white term to its crest band.
7. Sediment where the flow can raise it: over the land, in water shallow for its speed (`STIR_MIX`), and wherever
   the history has carried the load. The open sea under a surge's current keeps its own colour.
8. The edge. The drawn sheet thins to nothing toward dry corners below its level (`sheetCap`) and ends inside
   the cell on a contour bent by the ground's small relief. A fast front holds its foam in the cell it is about to
   enter, and the sheet's last centimetres carry it as a line of froth (`edgeLine`); a draining edge has none.
9. Wet ground (`soakedGround`, Terrain.js): soaked to a ragged edge that follows the same small relief, a film in
   the hollows and damp matte ground on the rises (`SHEEN`), pools in the deepest hollows of flat ground while it
   is fresh (`POOL`), silt thin on the rises and thick in the hollows and in drifts (`SILT_PATCH`).
10. The flood's own motion for the temporal pass (`motionWeight`, WaterMaterial): where the flood is drawn the
    pixel's velocity is the flow's, projected to the screen, so the patterns the flow drags stay sharp.

**Budget.** No new pass, draw, dispatch or texture. Per flooded water pixel: one more packed sample (the drawn
sheet), one history sample, up to six chop octaves in two phases, three streak scales in two phases, two more
packed samples under water deeper than 6 m (the tall face), and one projection for the motion. Per wet terrain
pixel: three noise values. CPU: the history steps a band of rows a frame and uploads that band. Off (no event,
ground dry): every path returns at its domain check or takes a weight of exactly 0; the history does not step.

**Detail by distance.** Chop octaves fade into roughness below 1 to 3 pixels per wavelength. Foam detail fades
into cover with the pixel footprint (the sea's own rule). The history is 8 m everywhere in the inner grid; the
outer ring has none (the far wall's white is its crest band).

**Transitions.** Every term is a ramp. Foam and turbulence decay behind the front. Wet ground dries after the
water has left and after the grids have gone, the rises first. The film fades in over its first 3 cm.

**Edges.** Still water has no speed, so no turbulence, no foam source, no sediment pick-up and no motion written.
Dry cells keep stranded foam for `FOAM_STRAND`. The sea's bed takes no wet history. Advection is clamped to the
grid; steps are capped at 0.5 s. A point that was behind the eye a frame ago keeps the camera's motion.

**Evidence.** Node: `test/tsunami-flood-look.mjs` (in `test:simulation`), 25 tests (five for the foam source above). Shown to fail without the
build: a 2 m/s current through a metre of street water had turbulence 0.32; a boiling surface near grazing
reflected 0.77 of the sky; a 5 cm sheet over the land had turbidity 0.10; a 30 % foam cover left 0.30 on the
pattern's low ground; the history stepped in bands differed from one whole step at 9981 values; the sea returning
over silted shallows carried a load of 0.00; a 2 m/s current over 10 m of open water had turbidity 0.63; the middle
of a 200 m face between its streaks was 1.00 white; the dry cell a 3 m/s front was about to enter held foam 0.00;
4 s behind the face the foam it left still covered 0.84 between the streaks.
Scenarios in `test/browser/tsunami-render.spec.js`: the seeded review scenarios, "Ground the flood covered stays
wet after the water has gone", and the fixed-view look runs at 2, 10, 25 and 320 m that the frames are judged in.

**Perf.** `test/browser/tsunami-bench.spec.js`: reference shots and GPU ms with no event, and GPU ms 15 s into a
10 m and a 320 m flood, at the tsunami review views. The table is not filled in yet: the bench has not been
run before and after on this build.

**Open.** The foam source follows the front's own jump now ("Design: foam where the water breaks" above). Still
open: foam at standing jumps, at drops and behind obstacles (a standing-jump term as first measured put half of the
25 m flood's land in dense foam); the ground round houses the solver keeps dry draws as dry pads; the rest sea's
swash over a silted bed is still clear.

## Common force laws

The shared constants are `g=9.81m/s²`, air density 1.225 kg/m³ and seawater density 1025 kg/m³. Drag is `F=.5*rho*Cd*A*|u-v|*(u-v)`, with projected area and mass belonging to each proxy. Generic debris uses Cd 1.1 in air and 1 in water. Constant-fluid quadratic drag is integrated by exact relaxation over the interval for which the force is held, so light debris cannot overshoot fluid velocity and gain energy. Avian receives that average force at its 120 Hz integration steps after body mass initialization.

Buoyancy is `rho*g*submergedVolume`. Generic proxies use a linear submerged-height fraction; this does not integrate complex open hull sections. The boat and jetski retain their existing distributed hydrostatic/planing laws, with water-relative and air-relative velocities passed into those laws. The shared adapter does not add their buoyancy a second time. The active car similarly passes air velocity and horizontal current to its native aerodynamic and distributed water-column laws, with no second generic drag/buoyancy adapter. Its established forward drag coefficient remains; side/up projected areas use hull bounds and assumed bluff-body Cd 1.1. Native car drag now assembles its twelve anisotropic water-column loads, centre-of-mass air resistance and water rotational damping in one implicit six-degree-of-freedom solve over each actual 120 Hz held interval. It uses native computed mass, rotated inertia and centre of mass. The existing drag coefficients and explicit buoyancy/slope loads remain. This prevents the former quadratic-drag overshoot from producing runaway velocities and an enormous terrain contact search at extreme currents. Air and water are world velocities, including while the tyres ride a moving ferry. This is a stable reduced drag discretization, not a resolved transient fluid impact. The shipped car, boat and jetski pass equal-body/fluid-translation checks. A barrel reuses its actual cylinder mass and displacement from the native spawn metadata.

Applied debris acceleration is capped at 45 m/s², force at 2 MN and torque at 2 MN·m. The panel distinguishes raw demand from applied load and counts cap activations. These are operating limits, not material laws. Runtime budgets are 224 structural section bodies and 512 structural connections, 40 fallen trees, 24 parked vehicles, 80 loose props and 48 external pieces. A rejected allocation leaves the original representation intact; partial structural allocation is rolled back. Deferred failures are reported.

## Earthquake, tornado and failure

The earthquake has a spatial wavefront, configurable propagation speed and frequency, a smooth envelope and radial attenuation. PGA is specified in g. Dynamic bodies receive the simplified inertial load only through solved upward support contacts, propagated through stacks. A hovering or freely floating body receives no ground acceleration. Terrain geometry itself does not move; this is an equivalent contact-supported load model, not elastic seismic-wave propagation or moving-ground contact mechanics.

The tornado has a translating Rankine-like core/edge tangential velocity, radial inflow and vertical updraft. Wind is sampled at each object's location and added to the ambient wind. The prescribed vortex is not atmospheric CFD. Tree failure compares wind/flood/ground overturning moment with an assumed root capacity. For authored village geometry, a whole-assembly seismic/air/water utilization estimate activates a connected material model; it does not itself detach the panels. Once active, solved connector force and moment determine individual failures. Imported unstructured geometry retains the legacy utilization-based coarse release. The activation integral is a dimensionless heuristic, not fracture energy or a code-compliant stress analysis.

Uniform flood elevation gives equal opposing-wall hydrostatic forces and cancels. Spatially different levels create a net pressure resultant; interiors are treated as freely flooded, with no trapped-air pressure model. Imported unstructured geometry can release up to four coarse rigid assemblies per 10 m cell with box collision proxies. Authored village panels, supports and local deck modules instead use the connected material model described below. Authored posts and foundations can extend into the soil; the native proxy excludes the buried envelope, sampled at 1 m spacing with a 2 cm clearance skin. Its origin changes while the authored world vertices stay fixed. Proxy volume determines its assumed envelope mass. This is an exposed assembly approximation, not excavated soil or a detailed member collision model. A proxy with no exposed volume defers failure rather than spawning underground. Ground slabs, dynamic ferry gates/platforms, terrain, rocks and infrastructure below the selected structural layer remain intact.

Imported terminal and Joey source triangles are geometrically clipped at world X/Z grid boundaries before damage snapshots are captured. Every assigned surface piece stays inside its 10 m cell, including the original 47.2 m roof faces and 99.35 m railing faces. Barycentric interpolation retains position, normal, UV and colour fields, material identity and surface coverage; clipping does not manufacture thickness or internal fracture caps. This remains a coarse rigid imported representation, without the authored village's member connections. Its existing envelope-density mass, box contacts and static collider ownership by centre are approximations; adjacent visual surfaces are not exact contact meshes. Triangles below the original selected structural layer remain static. Restore returns the complete retessellated rest geometry and original collider state.

The actual two-terminal fixture has 511,380 source triangles and 547,403 clipped triangles (+7.04%); the former importer already expanded indexed faces to triangle soup. The new one-time two-terminal import measured 1.50 s in the CPU fixture. All 77 imported records alone can allocate 216 bodies within the unchanged 224-body shared structural budget. Other island damage competes for that budget and can defer records. These are fixture counts and a one-run construction timing, not full-scene performance claims. `test/imported-structures.mjs` checks the actual shipped GLB at both placements, surface/attribute integrals, an independently specified rotated interpolation fixture, native fragment transforms and exact repeated Restore. The unchanged old importer fails the oversized-cell and actual native-fragment bounds checks. The retained ordinary-input ferry flood replay passes its supported-walking and finite-fragment checks; complete frames and the boarding/destruction clip were independently inspected. The imported terminals break into bounded pieces rather than whole 47 m surfaces. Shared material shading and missing newly exposed interior caps remain visible approximations.

Assumed whole-building values:

| Material | Envelope mass density kg/m³ | Solid displaced density kg/m³ | Anchor acceleration | Air Cd |
|---|---:|---:|---:|---:|
| Timber |65|600|0.42g|1.3|
| Light construction |40|500|0.25g|1.3|
| Masonry |180|2400|0.65g|1.2|
| Steel assembly |100|7850|0.55g|1.2|

Envelope density estimates the mass inside the assembly bounds. Buoyancy uses `mass/solidDensity`, so freely flooded masonry and steel pieces do not acquire displacement from empty bounding-box air. The tree root moment capacity is 12000 N m times instance scale cubed. These strengths and geometric reductions are assumptions; no surveyed building, timber connection or root-soil dataset has calibrated them.

The 450 t ferry uses its actual surge/sway/yaw controller at 120 Hz. Water-relative resistance and wind enter the same force balance; mooring demand uses those loads. Its assumed effective waterplane is 190 m², giving buoyant stiffness `rho*g*190`; heave damping ratio 0.7 is assumed. It follows the sampled fore/aft and port/starboard long-wave slope without accumulating that slope each frame. Existing short-swell motion remains a prescribed small background motion. Mooring failure at 350 kN or 2 m rise is an assumed operational limit.

Fallen trees preserve their original species geometry, leaf masks and materials. The authored height is already world-scaled and is used once; release adds no arbitrary initial tilt. Five trunk and four canopy load points rotate with the actual native body. The relative fluid velocity at each point includes `omega × r`, so rotating trees experience angular drag even if the centre is stationary. The coupled six-degree-of-freedom implicit drag system uses the actual declared world inertia: `(M + dt Σ k BᵀB) Δv6 = dt Σ k Bᵀ(u − Bv6)`. Coefficients are frozen over the held frame interval. Distributed buoyancy uses the rotated point locations. Their contact shape remains a trunk-sized rigid box; individual branches and fronds do not bend or collide separately.

Tree mass remains the assumed `max(120,35H)` kg. `TreeMass.js` divides it into an equivalent uniform cylindrical stem and porous ellipsoidal crown: 85/15 percent for palms and 70/30 for broadleaf trees. Palm crown radii are `(4.5s,1.8s,4.5s)` m at height `H−.6s`; broadleaf crown radii are `(5.2s,3.7H/12.5,5.2s)` at `7.8H/12.5`. These dimensions follow the authored procedural geometry, while the mass fractions and uniform distributions are explicitly assumed. Cylinder/ellipsoid moments and the parallel-axis theorem determine all three principal moments and the centre of mass. Native Avian and the JavaScript point-load matrix use the same values. Native collision/render origin and initial vertices remain fixed; point velocity and moment arms are evaluated about the shifted physical centre of mass. Four crown force samples use radius `R√(2/5)` and the same total drag area and coefficients. This accounts for crown rotational inertia without a spin cap; it is still a nine-point rigid reduction, not calibrated tree biomechanics.

Loose cosmetic car panels and wheels retain the existing 36-piece terrain-contact, bob/sink and rolling approximation. They now sample the shared water elevation/current, receive common mass/area air drag and terrain-supported ground acceleration, and damp water-relative velocity. No second buoyancy or water drag is added. Assumed panel mass is 6 kg/m² of the largest projected face (minimum 0.25 kg); detached wheels are 22 kg; an unspecified scrap defaults to 5 kg. Settled scraps use an assumed static-friction threshold of 0.4g. Their 1.2/s water damping, prescribed flotation lifetime and simplified contacts are not hydrodynamic or contact-calibrated. Grounded wheels retain the wind impulse as rolling and lateral slip. Their longitudinal effective mass assumes a solid disc (`I = 0.5*m*r²`); lateral friction uses assumed coefficient 0.6. The no-environment legacy path is unchanged.

## Connected village materials

The village builder preserves authored primitive identity and introduces intermediate cross-section vertices on long members. Wall and roof sheets and ground-reaching posts become material members. Each flexible member is represented by two real rigid contact bodies with a compliant internal connection; its visible surface continuously interpolates the two solved section frames. Relative section rotation therefore bends the surface before failure. A broken internal material connection assigns each tessellated triangle to its section, permitting separation. This is a reduced flexible member, **not a volumetric soft body**. Decks, piers and stairs use local approximately 3 m modules connected to adjacent modules. Each minor door, fitting or decorative primitive stays rigidly attached to one section of its nearest selected member, preserving its actual indexed triangles during bending and fracture. Its separate mass, material strain and collisions are not resolved. A record selects at most ten primary panels and six supports, with a bounded fallback for other authored parts.

Each record has a colliderless static foundation frame. Ground-reaching members attach to it; when a record has no ground-reaching member, its lowest member receives an assumed attachment. A nearest-surface connection tree carries every selected member to a foundation, and touching neighbours add alternative load paths. Native collision shapes are exposed oriented boxes; clipping buried proxy volume leaves the authored rest vertices in place. JavaScript walking proxies are conservative world-aligned boxes updated from the actual native pose. They do not resolve a deformed sheet surface, and attached decorative vertices can extend outside them. Imported terminal/Joey sections still use their explicitly coarse legacy representation.

Material parameters are declared assumptions. They have not been measured from the buildings, tested as species-specific wood properties or calibrated as certified connector values:

| Material | Density kg/m³ | Young's modulus Pa | Failure stress Pa | Fastener capacity N | Sheet thickness m | Velocity relaxation s⁻¹ |
|---|---:|---:|---:|---:|---:|---:|
| Timber | 600 | 8×10⁹ | 30×10⁶ | 1,800 | 0.022 | 5 |
| Light construction | 500 | 5×10⁹ | 18×10⁶ | 950 | 0.018 | 6 |
| Steel roof | 7,850 | 200×10⁹ | 220×10⁶ | 1,400 | 0.0007 | 3 |
| Masonry | 2,400 | 15×10⁹ | 2×10⁶ | 12,000 | 0.18 | 5 |

For a rectangular section, `A = width × thickness`, `I = width × thickness³ / 12`, axial stiffness is `EA/L` and bending stiffness depends on `EI`. Roof corrugation uses an assumed factor of 100 on weak-plane `I`; this is not a resolved corrugation analysis. Visual shell thickness can exaggerate the physical sheet thickness. Deck module volume is estimated as half the authored triangle surface area times an assumed 0.05 m timber thickness, not the empty bounding volume. Fastener counts use assumed 0.6 m spacing with a minimum of two. Joint force capacity is the lesser of material section stress capacity and fastener capacity; the internal material joint uses section capacity. Moment capacity uses the section modulus and the declared stress. No plastic yielding, crack propagation, soil flexibility or nail pull-out curve is resolved.

The two-section small-deflection cantilever reduction uses rotational compliances `Croot=L/(6EI)` and `Cmid=2L/(3EI)`. It matches the ideal point-tip-load deflection `PL³/(3EI)` and rotation `PL²/(2EI)` in its calibrated bending plane. Avian's fixed joint has scalar point and angular compliance, so the connection is an effective isotropic rotational spring. It does not represent independent strong-plane bending, weak-plane bending and torsion, nor exact distributed-load/dynamic beam behaviour. Inter-member fasteners use assumed point compliance 2×10⁻⁶ m/N and angular compliance 4×10⁻⁵ rad/(N·m).

After each actual 120 Hz native step, failure is evaluated from `|F|/Fcapacity + |M|/Mcapacity > 1`. These are the finalized step-average native reactions, not peak substep forces. A failed connection is removed and ordinary contact between its former bodies resumes. Failure adds no launch impulse. Constitutive elastic energy is `U=.5(C|F|² + Cθ|M|²)`; removed energy is recorded as fracture loss. Measured anchor gap and angle are also retained, with geometric-gap energy minus constitutive energy reported as a numerical constraint residual. That residual can be appreciable for very stiff joints and must not be mistaken for material stored energy. Joint damping applies equal/opposite point and angular impulses using both real inverse masses/inertias; its nonnegative kinetic-energy loss is reported separately.

Restore removes all these native connections, foundation frames, bodies and walking proxies, then restores every original vertex and collider. Rejected partial allocation rolls back. The 224-body/512-connection limits can defer whole records; they do not silently detach unallocated geometry. In the retained five-second actual-village tornado fixture, 11 records activated, using 219 bodies and 380 connections; eight other exposed records remained deferred. This is bounded constituent detail, not a complete structural finite-element model of the whole island.

## People and debris contact

### People caught in a tsunami (2026-10-05)

### Tsunami panel

Beach and ferry people receive shared wind, flood level/current and contact-supported ground loads. Adults use an assumed 72 kg, children 35 kg; projected standing area is 0.7 m² for a 1.7 m adult and scales with height squared. The assumed lateral stance threshold is 3.2 m/s² while supported. It is tested on the push the same body feels at rest, so a person's own wading drag never counts: calm sea does not tip a wader at any pace, and a 2 m/s current over 0.8 m does (see [player-water.md](player-water.md), Wading and the trip test). Static sea buoyancy alone does not knock down a wader or swimmer. Strong updraft and deep moving/rising flood can remove control. Warning, route choice and voluntary evacuation are described in [people-evacuation.md](people-evacuation.md); route status does not grant immunity from physical loads.

Up to 64 articulated people use the existing solver (14 bodies and 13 joints each); the loaded beach/ferry population is 58. Missing/unloaded rigs or future overflow use a separately reported physical capsule with animated limbs, not an articulated ragdoll. Capsule dimensions come from the actual neutral pelvis height after composing its ancestor transforms in metres. A local animation translation alone is not body height: that old measurement collapsed some shipped crowd capsules while retaining their mass. Segment masses still sum to the declared total, and each receives air drag from its own projected area and mass. Solved upward contacts support the connected rig for the equivalent base-excitation load; an entirely airborne rig receives no earthquake acceleration.

Each rig now solves its connected velocity response using `H = M + h c DᵀD`, where `D` is child-minus-parent angular velocity and the assumed passive joint viscosity `c` is 1 N·m·s/rad. An O(n) articulated-tree factor retains the coupling between anchor constraints and viscosity. The same factor and original momentum right-hand side serve contact and unilateral joint-limit impulses. Ground friction uses measured physical normal impulse, with assumed friction 0.65 and restitution 0.15. Geometric overlap repair is separate from velocity, so a corrected penetration is not converted into a limb launch. Position repair uses the actual joint-coordinate gradients and a fixed-rotation anchor projection that preserves centre of mass. Geometric rotation can still change inertia and energy, and centre repair can change orbital angular momentum; these are disclosed numerical stabilization errors. Inter-rig and upright-player contact remains a frame-split impulse/overlap pass, not a simultaneous solve of every touching rig.

The maximum free-flight interval is 1/120 s. Subsequent intervals adapt to measured post-force and post-impact motion, targeting at most 0.1 rad rotation and 0.15 capsule radius of physical sample travel relative to nearby support. The 192-piece limit per accepted frame has an explicit emergency approximation: scale unresolved support-relative motion and record the count, removed translational/rotational kinetic energy, world energy change and kinematic support work. This preserves a person already co-moving with a ferry. There is no unexplained 40 rad/s ceiling: high-speed observations and actual interventions are reported separately. Geometric corrections have their own travel metric and are not covered by the physical-advance bound. Inherited motion adds no random spin, upward kick or limb actuator. Recovery requires real support/flotation, low complete support-relative kinetic energy, segment spin below the assumed 1.5 rad/s threshold and one second of repose. There is no twelve-second airborne get-up; the final get-up remains a keyed animation after physical rest.

The existing capsule water-entry/buoyancy law remains the only water law on a rig, evaluated relative to shared current. Segment flotation and planing coefficients remain gameplay assumptions. The maintained ordinary-contact fixture covers all eight shipped swim casts, three actual animated poses at three clip times, and both 1/60 s and 0.1 s cadence: 144 cases with zero emergency interventions and transient joint-coordinate error below 5°. A separate eight-person fixture records 160 inter-person contacts, natural recovery and zero interventions; its peak frame-split overlap is 0.069 m. This is a reduced articulated contact model, not validated human biomechanics or deformable tissue.

In the retained real-terrain 120 m/s vortex model test, the field stops at 6 s. At 60 Hz, the body enters supported repose at 8.483 s with zero interventions; a short-lived physical segment spin reaches 152.61 rad/s while resolved rotation remains below 0.1 rad per piece. Terrain penetration stays below 0.012 m, maximum joint-coordinate error is 0.143°, and the complete fixed-pose velocity solver adds no kinetic energy. With 0.1 s frames, one emergency budget intervention removes 6.548 kJ and materially changes the trajectory; repose begins at 6.8 s. Both consume the full accepted interval and complete get-up. These are model results. The ordinary-input browser replay remains physical through 13.1 simulated seconds and returns to supported walking after Stop. In that full scene the observed peak segment spin is 93.27 rad/s and nine emergency interventions remove 129.95 kJ. The inspected motion remains articulated, but the extreme scene is visibly slow and choppy. The CPU model result above therefore must not be read as a claim of smooth full-scene performance.

`test/people-budget.mjs` measures 58 actual crowd variants, 812 capsules and 754 joints with real skeleton pose work and upload-copy transport. On Apple M5 Max/Node 22.14.0, the final candidate's three-second 120 m/s vortex workload costs 13.28 ms mean and 18.52 ms p95 per 1/60 s frame after 30 warm-up frames, with zero interventions or nonfinite states. Separate unforced falls complete all 58 supported get-ups within 4.367 s; the inactive contact manager then averages 0.000231 ms. The active population fixture has no inter-person contacts, covered separately above. These CPU measurements exclude rendering, scene walls and normal animation/AI outside physical rigs; they are not an FPS claim. Maintained gates are `test/articulated-contact.mjs`, `test/articulated-solver.mjs`, `test/articulated-mass.mjs`, `test/articulated-neighbors.mjs` and the existing human integration tests. Actual keyboard/contact/gangway journeys remain in `test/browser/gameplay-people.spec.js`, with browser outcomes recorded separately in the gameplay handoff.

Structural, fallen-tree, parked-vehicle and registered external box debris can hit people. The adapter sweeps contact spheres against the actual native box translation, queries native point velocity and effective inverse mass, and applies equal and opposite linear impulses with assumed restitution 0.05. The human and native solvers each use their own local contact attachment; a separate world point records the time of impact. It handles at most 3 impacts per person per frame and samples the box's final orientation. It is a post-step coupling, not continuous rotating-body collision or exact global angular-momentum conservation between the two separated final attachment points. Ordinary loose prop cylinders and cosmetic car scraps are not included in this human contact adapter. Native impulses above 20 kN s or with invalid values are rejected atomically on both sides. There is no injury or gore model.

Restore captures both array-based ferry routes and vector-based beach routes without sharing mutable points. Capturing the baseline completes before any event becomes active. Each experiment restores affected poses and routes, then clears that baseline for the next experiment.

## Benchmarks and provenance

Recovery-specific maintained tests are `test/car-extreme-fluid.mjs`, `test/tree-loads.mjs`, `test/structural-members.mjs`, `test/tsunami-extreme.mjs`, native `structures::tests`, and `test/browser/disaster-materials.spec.js`. The seven material cases exercise real native load transfer, bending, selective failure, dissipative damping with unequal masses, complete reset, rigid-transform invariance, every-vertex/normal section-frame equivalence and repeated deck activation. Disabling only the native joint solver makes the same three native physical benchmarks fail; replacing only the production structure entry with the original coarse release fails the connected-load-path assertions. The browser tests use the actual controls and read-only solver observations; their final GPU result is tracked in the recovery handoff.

The native axial fixture has k=1,000 N/m and F=100 N, yielding extension≈0.1 m and elastic energy≈5 J. The two-link fixture has L=2 m, EI=1,000 N·m² and P=10 N: expected tip deflection 0.0266667 m and rotation 0.02 rad; measured deflection 0.0270916 m (about 1.6% error), rotation≈0.020255 rad and constitutive energy≈0.133299 J. Its stiff translational connector also has a disclosed geometric energy residual; the benchmark is not a proof of zero constraint error. The unequal-mass damping test accounts for kinetic-energy loss within 0.04 J.

A full 257×257 extreme-water fixture advances 2 s with a 3,000 m source in 320 CFL substeps, without negative/nonfinite state or omitted accepted time. Its actual maximum current is 390.649 m/s; characteristic speed (including gravity waves) is separately 475.192 m/s. Volume residual is approximately −3.28×10⁻⁷ m³. Actual shipped native bodies respond to both that current and its hydrostatic buoyancy. These are numerical stability/coupling checks, not real-world hazard predictions.

The equivalent affine-skin optimization preserves all 222 final native poses exactly in its retained comparison. A subsequent rigid-module refinement correction removes unnecessary subdivision from short evacuation treads: the unchanged 30,000-triangle budget passes with 28,888 triangles versus the original 23,336, still five draw calls and the same colliders. Surface-area difference is only 3.32×10⁻⁸ relatively. The final actual-site CPU fixture contains 219 bodies / 380 connections and reports no nonfinite or fully buried proxy; the lowest highest-corner terrain clearance is +0.1030 m. After warmup, median geometry update is 3.32 ms, native solve 2.86 ms and total 15.76 ms per 1/30 s simulated interval on this machine. This fixture excludes full rendering, NPCs, trees and other systems; it is not a browser frame-rate claim.

Maintained checks are `test/disasters.mjs`, `test/disaster-bridge.mjs`, `test/disaster-coupling.mjs`, `test/water-wind.mjs`, `test/disaster-wreckage.mjs`, `test/disaster-people.mjs`, `test/disaster-fragments.mjs`, `test/browser/disasters.spec.js` and `test/browser/disaster-people.spec.js`. They include exact stepped/sloped lake balance, disturbed-water mass balance, disconnected source topology, positive dry-bed flow, three-grid long-wave speed, Ritter convergence, CPU/packed interpolation, held-force energy decay, true contact support, Galilean craft invariance, flooded-wall cancellation, transactional replacement, transformed geometry/reset, ferry response, actual solver/collider browser observations, exact wind-stress momentum/work, shared vortex-to-water wiring, prior wreckage restoration, bounded scrap loads and real audio lifecycle including held-key mute. Human checks include actual articulated masses and supported-load sums, full accepted frame time, calm warning stability, equal/opposite shipped-native contact impulses, diagonal sweep torque, mixed-path snapshot/restore, and real UI pause/reset of moving capsules. The real boardwalk builder and shipped solver reproduce and prevent buried foundation proxies sinking through flat and sloping terrain; a separate 180 m/s thin-panel collision check remains green.

Measured small-wave speeds on 4 m / 2 m / 1 m grids were 9.90959 / 9.90960 / 9.90929 m/s versus `sqrt(9.81*10)=9.90454m/s`. Ritter mean depth errors on 2 m / 1 m / 0.5 m grids decreased 0.1435 → 0.1246 → 0.1005 m. The actual shipped solver also verifies that equal-area 40 kg and 400 kg pieces respond differently to a 100 m/s vortex: the lighter body lifts and gains tangential velocity faster, its observed path expands beyond the core, and outgoing motion continues after forcing stops. This is a force-driven rigid-body trajectory test within the declared acceleration cap. These benchmark agreements establish specific numerical properties; they do not validate real-island runup or failure predictions. A NOAA laboratory beach/runup calibration has not been performed.

Primary references include the [OpenSees elastic beam-column parameters](https://opensees.github.io/OpenSeesDocumentation/user/manual/model/elements/elasticBeamColumn.html), the locally pinned Avian 0.5.0 joint implementation, and [NOAA tsunami propagation](https://www.noaa.gov/jetstream/tsunamis/tsunami-propagation), [Clawpack shallow-water equations and dry states](https://www.clawpack.org/riemann_book/html/Shallow_water.html), [Audusse hydrostatic reconstruction](https://epubs.siam.org/doi/10.1137/S1064827503431090), [NOAA mass-conservation benchmarks](https://nctr.pmel.noaa.gov/benchmark/Basic/Basic_MassConservation/index.html), [NOAA convergence guidance](https://nctr.pmel.noaa.gov/benchmark/Basic/Basic_Convergence/index.html), [NASA drag equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/), [OpenSees support excitation](https://opensees.github.io/OpenSeesDocumentation/user/manual/model/pattern/uniformExcitationPattern.html). Equations from these sources are distinguished above from the game's assumed geometry, coefficients, capacities and numerical limits.

### Extreme native vehicle correction

The original full-app 3,000 m UI run failed in Parry heightfield/compound contact allocation; the later wasm-bindgen recursive-borrow errors were consequences of that native panic. A minimal actual-WASM car fixture reproduced the underlying explicit-drag instability without allocating an island: at 250 m/s current, the coupe's fluid-relative kinetic energy grew from 39.06 MJ to 1,899.55 MJ in three 120 Hz steps. The unchanged `car-extreme-fluid` regression failed for both vehicle types before the correction and passes all three cases afterward. At 400 m/s uniform current, the corrected coupe/Jeep reach 399.864/399.557 m/s after two seconds, without exceeding their initial fluid-frame kinetic energy in the recorded fixture. Native tests separately disable gravity/displacement to prove passive total rigid kinetic energy over every actual fixed step, for both vehicles, multiple attitudes and 250/300/400 m/s currents. They also exercise common deck/air translation, correct world-relative water-speed telemetry while riding a moving deck, and the six-dimensional impulse work identity.

The corrected complete native suite, including the tree mass and centre-of-mass regressions, passes 51 tests (one pre-existing ignored test), and the shipped rally bridge passes 9/9. An eight-second CPU integration of the actual 2,048×2,048 island heightfield, 3,000 m shared-water source, authored village, 224 native member bodies, 507 connections and the parked native car has zero nonfinite states or allocation failures; the minimum highest-corner terrain clearance is +0.0632 m. Restore removes all test member bodies and connections. This proof excludes ordinary loose props, trees, people and the ferry, and uses a local CPU water-plane fit for the car. It does not replace the loaded-island browser pause/Restore gate, which remains recorded in the recovery handoff.

## Loaded-island extreme limit

The final ordinary-UI 3,000 m run advances 13.033 simulated seconds, then pauses, stops and restores the island. All sampled native bodies, boats, jet skis and articulated people remain finite; Restore returns craft to their original neighbourhoods. The run loads 45 people, with at most 26 simultaneously physical. Every observed physical integration piece respects its 0.1 rad rotation and 0.15-radius near-support travel bounds, with no accepted time omitted. These are numerical and lifecycle checks.

This setting is not practically playable on the tested Mac. While recording at 1,440×900, 185 rendered frames take 172.38 wall seconds, about 1.07 FPS. Articulated rigs invoke 1,285 emergency budget interventions and remove about 306.91 MJ; the observed peak segment spin is 275.55 rad/s. Median sampled scene CPU moving average is about 1.60 s, including about 1.21 s for people. Those energy losses materially alter the extreme trajectory. Neither the shallow-water model nor this reduced human solver represents validated physics for a three-kilometre wave. Ordinary-scene timings and unrecorded disaster timings are recorded separately in the recovery evidence.

An unrecorded Standard 1,440×900 village tornado at 100 m/s and 180 m radius measures 5.34/4.75/4.82 FPS across three 18-second samples, with p95 frame intervals of 249.6–269.1 ms. Each reaches 224 structural bodies with roughly 9–17 active human rigs. Stop and Restore succeed without page errors. This confirms a substantial full-scene CPU cost beyond recording overhead; the current high-force destruction setting is not smooth real-time play.
