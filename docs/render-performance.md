# Render and frame-time performance

## Startup on iPhone and iPad

The physical iPhone 17 Pro finished compiling on its second attempt, then restarted after the first live frames. In the corresponding opening view, the renderer submitted about 14.6 million triangles per frame and uploaded 100 MiB of geometry for the two ferry terminals alone. Explore started eleven simultaneous ambient audio decodes in the reference browser. For Apple touch devices, use lower-triangle authored ferry visuals with the existing collider files and interactive pivots, prepare structural fracture meshes when an event needs them, keep one interactive frame in flight, and decode audible ambient sounds one at a time. Keep the existing shared wave, terrain, physics and input sources. Exercise Explore, the introduction, audible playback, sustained rendering and the vehicle picker in the browser.

A physical iPhone restarted the tab at shader warm-up with 662 MiB in estimated live textures and the first command buffer still pending. The mobile startup budget targets less than 400 MiB of texture storage. Character and prop surface tiles use at most 256 pixels on the long edge, marine and vehicle maps 512, and a single 55 m sun-shadow cascade uses a 1024-pixel depth map. These are game budgets. The terrain heights, collision and vehicle physics retain the full island data. If the browser terminates an iOS tab during startup, its next visit pauses before creating a GPU device. A tap on **Load island again** retries. The tab clears the marker on ordinary navigation, a handled failure, or successful initialization.

Submit completed upload work between startup stages before encoding the first island frame. A physical-device trace and an instrumented real-game browser scenario check the first submission and resource sizes.

Both the canvas and its temporal history allocate at the selected output resolution. Starting Auto at one device pixel per CSS pixel cuts the initial pixel count to one quarter of the 2× desktop default. The resolution governor can raise it after a sustained run of fast frames. Explicit Retina and Standard retain their usual settings.

The startup camera should warm the visible island before the player taps **Click to explore**. On Apple touch devices, let the normal frustum, layer and visibility rules select those shaders. Hidden geometry and alternate water variants can use the existing first-use pipeline cache when they appear. Limit native asynchronous pipeline creation to two outstanding jobs on these devices, a startup memory budget chosen for this game. Render and compute work share the budget. Shader or device failures must still surface through the existing loader and graphics-device dialog. Controls, world distances and physics use their existing systems.

Meshes sharing the same WGSL, vertex format, bindings layout and fixed render state reuse one native pipeline. Each paint colour and texture retains its own bindings.

Verify the budget with actual WebGPU calls, the loaded island, the canvas dimensions, and a touch through the start overlay. Measure pipeline requests and compare the initial beach view before and after. [WebGPU asynchronous pipeline creation](https://www.w3.org/TR/webgpu/#dom-gpudevice-createrenderpipelineasync)

The mobile-profile browser regression measured around 2,480 simultaneous native asynchronous pipeline requests before the change and two afterward. It requested 2,665 pipelines in total before and 321 afterward. The 390-CSS-pixel viewport initially allocated 780 output pixels across and now allocates 390. The WebKit test on macOS also entered the island, dismissed the introduction and rendered the first view. Hardware iPhone memory limits are outside this test.

On the 402-CSS-pixel iPhone 17 Pro profile, the same WebKit test measured 1,061 MiB of textures before the asset changes and 363 MiB afterward. These estimates sum the requested texels, mip levels, array layers and sample counts; they exclude GPU driver overhead and JavaScript memory. Five command buffers had already been submitted before car physics was ready in the passing WebKit run. The native packed-image test checks the exact four-channel averages on the whale atlas. A second browser scenario restores an interrupted tab, verifies no game canvas is created until the retry tap, and enters the island.

The Explore test on the 402-pixel WebKit profile rendered the opening view at about 4.05 million triangles per frame. It kept one submitted frame and one ambient decoder in flight, sustained at least 120 submissions over 12 seconds after the tap, and entered the GT3 by touch. Mobile water uses the opaque-colour refraction fallback. The mobile lighting path keeps sun and sky illumination, nearby lamps and the short-range shadow map, and omits the secondary bounce and refracted shadow-position calculations. The shader meter reports completed jobs from the visible-view compile batch. The early-play interruption marker clears after ten seconds and thirty advancing frames.

The desktop beach benchmark at 2560×1267 recorded 8.66 ms GPU before and 8.40 ms after (best of three). This is a startup change; the steady-state samples overlap. The two-colour GPU readback checks that sharing a native pipeline preserves both materials’ pixels and keeps a different colour-write mask separate.

The README target is 60 fps at 2560x1267 on an M5 Pro: 16.7 ms a frame. The GPU fits it (6-13 ms in
the named views). The CPU does not (19-29 ms a frame on a loaded machine), so this pass works on CPU
time and proves each change by identical output, not by fps.

## Rules

- Identical output first. Every change here has a node test that compares the new path with the old
  one on the same input and asserts equality, plus a test that fails on the old code for the cost it
  removes (seen red, then green).
- Measure CPU self time per function with a CDP profile (`tools/frame-bench.mjs time`) and GPU time
  per pass with `?bench`. Concurrent workloads affect wall-clock frame times.
- Nothing is simplified away (`docs/PORTING.md`): no LOD, quality or effect was lowered.

## What changed

| change | where | identical-output proof | cost removed |
|---|---|---|---|
| The main scene is posed once per frame, not once per pass | `src/engine/render/ScenePose.js`, `App.renderFrame` | `test/render-hot-paths.mjs` "posed main scene": posed matrices equal a fresh update; draw lists equal the per-pass reference | matrix self time 2.5-3.0 -> 0.5-1.1 ms a frame |
| A posed scene draws from a flat walk, rebuilt only when the hierarchy changes | `src/engine/render/SceneWalk.js`, `MeshRenderer.collect`, `SceneHierarchy.version` in `Object3D.add/remove/attach` | `test/render-hot-paths.mjs` "flat walk": same draw lists and the same callback order as the recursive walk over 4 pass kinds, across a hierarchy change between frames and one mid-frame | 328 -> 0 child-list reads in 4 passes of the test scene; profile below |
| Ground and push-out queries build no array per nearby box | `src/world/Colliders.js` `groundHeightAt`, `resolveCapsule` | `test/collider-queries.mjs`: bit-identical answers to the old code on the real village, piers and terminals (a 0.37 m lattice, 3 heights and pads, 3 capsules) | 1,250,942 -> 0 arrays over the lattice |
| A closed chairlift panel does no DOM work | `src/chairlift/Panel.js` | `test/chairlift-panel.mjs`: the open panel still shows the live cable state; `test/browser/chairlift.spec.js` | 180 -> 0 DOM queries in 60 frames |
| Livestock builds one herd list per kind per frame | `src/wildlife/Livestock.js` | `test/livestock.mjs` "own herd": every brain sees the same herd list as before | 310 -> 0 filters in 31 frames, O(n^2) -> O(n) |
| The bench dries the lens between views | `src/core/Bench.js` `pose` | harness only | n/a |

## Thin geometry held at a pixel (wire AA)

A strip or tube thinner than a render pixel is hit by the pixel centres of some columns only, so it
rasterises as dots or dashes that TAA cannot rebuild. Such a mesh keeps a minimum drawn size and
dither their coverage (true / drawn size, a per-frame interleaved-gradient threshold that TAA averages),
so they read as a faint unbroken line. It does not apply in the depth (shadow) pass.

| mesh | where | minimum | evidence |
|---|---|---|---|
| Chairlift haul rope (0.034 m tube) | `VillageMaterials.js` `WIRE_VERTEX` / `WIRE_SURFACE`, the village set's `hardWire`; `src/chairlift/Geometry.js` | 0.75 render px radius | render masks (the rope needs its own material key); no rope shadow (a 3.7 m umbra under a rope 4-9 m up) |

## Frame-time gate

`test/browser/frame-time.spec.js` boots the real game with `?bench` and renders beach, village,
underwater and aerial at 2560x1267. It asserts GPU p95 under 16.7 ms in every view. Wall time per
frame is logged and annotated as advisory (ceiling 33.4 ms) and never fails, because a loaded machine
moves it by 2x. Set a real CPU budget after a quiet-machine re-bench.

Measured GPU p95 at the target resolution was 16.59 ms at the beach, 12.72 ms in the village, 8.57 ms underwater and 11.88 ms from the air.

## Measured

CPU and GPU milliseconds per frame, best of two runs at 2560×1267 using `tools/frame-bench.mjs time`.

| view | CPU before -> after | wall before -> after | GPU before -> after |
|---|---|---|---|
| beach | 26.48 -> 24.34 | 29.10 -> 25.71 | 12.61 -> 11.99 |
| village | 19.44 -> 19.12 | 21.10 -> 20.22 | 10.19 -> 10.07 |
