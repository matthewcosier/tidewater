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
  absorption (2.2, 3.0, 4.6) /m and scattering (24, 23, 21) /m, opaque within about 4 cm, the ratio giving the
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

### Spray and mist

Design: what leaves the flood's surface (`src/disasters/FloodSpray.js`, the flood region of `src/fx/Spray.js`).

Reference. A tsunami runs ashore as a turbulent bore. Its front is a wall of white water with spray thrown ahead of it
and above it, and a haze of fine drops hangs over the front and over every fast, shallow sheet behind it (Tohoku 2011:
the front crossing the Sendai plain, the water going over the Miyako seawall with spray bursting off the wall,
Kesennuma; Khao Lak 2004). Three things throw water into the air:

- The breaking face. The roller of a bore lifts spray of the order of its own height: the spray region over a breaking
  roller reaches one to two roller heights (Chanson 2009, Eur. J. Mech. B 28). The jump is the classifier's own
  (`FloodLook.classifyBore`, h2 ( 1 - 1 / r )).
- An obstacle. Fast flow stopped by rising ground or a wall climbs its stagnation head, u^2 / 2g (Bernoulli): 1.8 m at
  6 m/s, 5.1 m at 10 m/s, 20 m at 20 m/s. Impact jets go far above that.
- The leading edge: the thin, fast snout of a surge over dry ground.

Real outcome. Spray stands about one and a half jump heights over the face (declared, the violent end of Chanson's
band), is carried ahead of the front at more than the water's speed, falls back in the flight time of that throw
(1.1 s for a 1 m jump, 3.5 s for 10 m), and leaves mist that follows the wind (7 m/s default) and thins downwind. A
2 m surge throws knee to head high spray; a 10 m front throws a curtain 15 m over its face; a wall throws sprites
28 m across.

Model. A source is a strength (0..1) and a jump (m). One function turns any source into particles (`emission()`, its
WGSL twin `floodSprayEmission`, from the same constants):

- sprite radius 0.3 x jump, clamped 0.12 to 14 m;
- launch speed sqrt( 2 g x 1.5 x jump ), straight up, with the flow's own velocity added (ahead of a face at 0.9 to
  1.4 times the water's speed; a quarter of it off an obstacle);
- life: the ballistic flight up and back, clamped 0.7 to 7 s;
- rate per m^2 of breaking ground: strength x 1.2 x curtain / ( pi r^2 x life ), the curtain being 3 jumps tall on
  1 / ( 1.5 x cell ) m of face. The live sprites cover the curtain about once over, so a bigger wave throws fewer,
  bigger, longer-lived sprites and the particle count does not grow with the wave.

Sources (`source()`, WGSL `floodSpraySource`; the strongest by strength x jump wins): the face (`bore.x x crest`, jump
`bore.z`); an obstacle (the ground rises 0.25 to 0.7 m/m along the flow over 3 m and the water moves at 2 to 6 m/s or
more; jump u^2 / 2g; a beach under 1 in 8 is run up, not hit); the leading edge (wet over 3 cm, faster than 1 to
3 m/s, the next cell along the flow dry; strength 0.7, jump depth + a quarter of the head). Mist is thrown with each
(2.5 times the sprite, twice the life, twice the curtain's area) and by fast shallow flow on its own (4 to 9 m/s in
under 3 m of water). Clear drops and ligaments are thrown with the spray within 90 m of the camera.

Sprites over sediment-laden water are beige-grey (`FOAM_TURBID`, the foam's own tint), white over the clear sea: the
particle's tag carries the turbidity of the water that threw it.

Source of truth. The flood's state is read through `disasterLookAt`, `disasterSample` and `disasterCell` (Water.js),
the functions the water surface is drawn with; the ground through `terrainHeightAt`; gravity from `Frame.js`; the wind
and the time step from the frame uniforms. Particles are integrated, lit, collided with the water and the ground and
drawn by the spray system as every other particle is (they die on `waterQueryHeightAtXZ`, which includes the flood).

The flood has its own region of the particle buffers (32,768 slots after the surf's ring and the CPU part) and its
own head. It does not share the ring the shore breakers feed: the breakers steer that ring to turn over about every
2 s, flood mist lives up to 9 s, and in one ring each emitter would overwrite the other's live sprites.

Budget. One compute dispatch of 4,096 candidates (64 workgroups) a frame while a flood grid is live; each candidate
reads five bilinear samples of the packed state and two terrain heights and writes at most 21 particles. 4 bytes are
read back a frame to steer the emission so the region fills once per longest life in flight (`steer()`,
`ringSeconds()`). While a flood runs, and for 12 s after, the spray update and the sprite draw cover 81,920 slots
instead of 49,152. With no flood: no dispatch, no readback, and the spray system runs exactly its own 49,152 slots.
Measured: see "Evidence: spray and the water at the lens".

Detail by distance. The candidates are log-polar around the camera (64 angles x 64 rings, 4 m to 2,500 m, jittered
every frame), so one stands for r^2 x dtheta x dln r of ground: 1 m^2 at 10 m, 100 m^2 at 100 m, a hectare at 1 km.
A sprite is never smaller than 0.003 rad at its distance (about 3 px at 900 lines: far sprites merge into fewer,
bigger ones of the same live area) and never wider than 0.3 of its distance (near ones split, so one sprite never
walls off the view). A candidate that owes more sprites than it may write in a frame writes bigger ones of the same
total area. Drops stop at 90 m, where they are far under a pixel. Flood sprites fade out by 2,600 m (the surf's by
320 m).

Controls. None: the spray follows the event the player starts from the Disasters panel.

Transitions. Spray starts with the first breaking cell and grows with the jump (every threshold is a smoothstep).
Sprites bloom and fade over their lives as all spray does. When the event ends or the island is restored the emitter
stops with the grids; the sprites in flight fall back and die within their lives (9 s at most), and the region is
dropped from the update and the draw 12 s after the last live frame.

Edges. Still water throws nothing: every source needs the water's own speed (over 0.3 m/s) and a face, a rise or a dry
cell ahead. Thresholds are on the water's state, never on a particle's. A film under 3 cm throws nothing. Beyond the
grids the analytic wall is read through the same look, and only its crest band throws (`disasterFarCrest`). A jump of
zero gives a rate of zero and finite sizes. The camera's distance is floored at 1 m.

Evidence plan. Node: `test/flood-spray.mjs` (the throw height, the cover, the scaling with the jump, what counts as a
source, the candidate layout, the budget, a seeded 10 m event on the real island: the sea at rest throws nothing and
the front's own cells hold a wall of live sprites). Browser: `test/browser/flood-spray.spec.js` "A breaking tsunami
front throws spray" (flood-tagged live particles on the front; none before the event; none ten seconds after Restore
island). Frames: the wave-following review views of `test/browser/tsunami-render.spec.js` and the scenario's own
capture. Frame time: `test/browser/tsunami-bench.spec.js`, before and after.

### Inside the water

Design: what a camera under the flood sees (`src/disasters/FloodMedium.js`, `src/post/Underwater.js`,
`src/fx/MarineSnow.js`).

Reference. Flood water that has crossed the land carries soil, sand and debris, of order 1 to 10 kg/m^3 (Jaffe and
Gelfenbaum 2007). At those loads the Secchi depth is a few centimetres. A camera inside it sees almost nothing: a
dark brown murk that glows toward the surface and is black below, with grit and bubbles streaming past the lens.

Real outcome. With the surface's own coefficients (`SED_ABSORB` 9, 11, 14 /m, `SED_SCATTER` 12, 11.5, 10.5 /m:
extinction 21 to 25 /m) an object 10 cm from the lens keeps 10 % of its contrast and one at 30 cm is gone. Daylight
goes down by the diffuse attenuation Kd = ( a + bb ) / mu (Gordon 1989; Kirk 1994), bb 3.5 % of the scattering: 13 to
20 /m under a high sun, so 1 % of the light is left 0.25 to 0.35 m down and the water is black within a metre. Blue is
absorbed most, so the glow is brown.

Model. The medium at the camera is one number, 0 for the sea's own water and 1 for the flood's: the surface's own
decision, `FloodLook.turbidity( depth, speed, bed )`, of the water column the camera is in (`floodMediumAt`, from the
solver state the surface texture is uploaded from). The underwater composite, the shaft march and the particles add
`medium x SED_ABSORB` and `medium x SED_SCATTER` to the sea's coefficients (`FLOOD_MEDIUM_WGSL`, one set of
constants). Over land the medium is 1; in the open sea far from land it is 0; where the flow stirs a shallow bed it
is between.

The diving view's drifting specks (12,000 in an 8 m box) fade out with the medium. In flood water a second population
takes their place in a 1.4 m box around the lens: grit (dark, 2 to 9 mm) and bubbles (bright, rising at 0.25 m/s),
carried by the water's own velocity at the camera and drawn stretched along their motion across the lens over a
1/50 s exposure. They are opaque and fogged by the composite at their own distance, so only the ones within about
20 cm of the lens show, coming out of the murk and gone again.

Anything drawn inside the murk (tree canopies, hulls overhead) is fogged by the same extinction at its own distance:
nothing beyond 30 cm shows as a shape.

Source of truth. The camera's water height is query slot 0 (`WaterQuery`, which includes the flood). The sediment
coefficients are `FloodLook.js` `SED_ABSORB` and `SED_SCATTER`, the ones the surface is shaded with. The sea's are the
frame uniforms. The water's velocity at the camera is the solver's.

Budget. One `floodMediumAt` on the CPU a frame (two bilinear samples). In the shaders two multiply-adds per pixel.
With no flood the medium is exactly 0, x + c x 0 = x, and the frame is the sea's own. The flood particles are 8,000
more instances, drawn only while the medium is above 0.

Transitions. The turbidity is continuous in space, so a camera moving from one water to the other sees no step. The
medium follows it with a 0.35 s time constant, which covers the one step in time, the frame an event's grids drop,
and it lands exactly on its target. The sea's specks shrink out as the grit grows in.

Edges. No event, no grid or a dry column: 0. A non-finite read: 0. The lens straddling the surface is the underwater
pass's own business (`LENS_REACH`), unchanged.

Evidence plan. Node: `test/flood-spray.mjs` (no event: 0 everywhere; under 2 m of flood over land: the sediment
extinction; the deep open sea in the same event: 0; continuity along a transect; the blend). Browser:
`test/browser/flood-spray.spec.js` "A camera inside the flood is in dirty water". Frames: the scenario's captures and
the same dive with and without the change.

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
