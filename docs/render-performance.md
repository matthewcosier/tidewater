# Render and frame-time performance

The README target is 60 fps at 2560x1267 on an M5 Pro: 16.7 ms a frame. The GPU fits it (6-13 ms in
the named views). The CPU does not (19-29 ms a frame on a loaded machine), so this pass works on CPU
time and proves each change by identical output, not by fps.

## Rules

- Identical output first. Every change here has a node test that compares the new path with the old
  one on the same input and asserts equality, plus a test that fails on the old code for the cost it
  removes (seen red, then green).
- Measure CPU self time per function with a CDP profile (`tools/frame-bench.mjs time`) and GPU time
  per pass with `?bench`. Wall fps on a shared machine is noise: 8 build lanes put the load average
  at 52-173 during this work.
- Nothing is simplified away (`docs/PORTING.md`): no LOD, quality or effect was lowered.

## What changed

## Thin geometry held at a pixel (wire AA)

A strip or tube thinner than a render pixel is hit by the pixel centres of some columns only, so it
rasterises as dots or dashes that TAA cannot rebuild. Such a mesh keeps a minimum drawn size and
dither their coverage (true / drawn size, a per-frame interleaved-gradient threshold that TAA averages),
so they read as a faint unbroken line. It does not apply in the depth (shadow) pass.

## Frame-time gate

`test/browser/frame-time.spec.js` boots the real game with `?bench` and renders beach, village,
underwater and aerial at 2560x1267. It asserts GPU p95 under 16.7 ms in every view. Wall time per
frame is logged and annotated as advisory (ceiling 33.4 ms) and never fails, because a loaded machine
moves it by 2x. Set a real CPU budget after a quiet-machine re-bench.

The real loop in a tsunami: `node tools/flood-profile.mjs <port> <wave m> <out.json> [loop|bench|both]` against a
running `npx vite --host 127.0.0.1 --port <port>`. Per phase (no event, approach, flood on land) it writes frame rate,
engine CPU ms, game seconds per wall second, CPU self and inclusive ms a frame per function, allocated bytes a frame
per function (garbage included) and the ragdoll pool's stats; `bench` adds GPU ms per pass in four driven states.

## Measured

| view | CPU before -> after | wall before -> after | GPU before -> after |
|---|---|---|---|
| beach | 26.48 -> 24.34 | 29.10 -> 25.71 | 12.61 -> 11.99 |
| village | 19.44 -> 19.12 | 21.10 -> 20.22 | 10.19 -> 10.07 |

## CPU self time per function, before and after

**beach** (CPU per frame 26.5 -> 24.3 ms; share = self time / CPU per frame)

| function | before ms (share) | after ms (share) | after / before |
|---|---|---|---|
| (garbage collector) | 6.69 (25.3 %) | 4.29 (17.6 %) | 0.64 |
| visit engine/render/MeshRenderer.js:444 | 3.88 (14.6 %) | 3.56 (14.6 %) | 0.92 |
| drawItems engine/render/MeshRenderer.js:598 | 3.67 (13.9 %) | 3.13 (12.8 %) | 0.85 |
| groundHeightAt world/Colliders.js:65 | 0.82 (3.1 %) | 0.96 (4.0 %) | 1.17 |
| _pipeline engine/render/MeshRenderer.js:352 | 0.95 (3.6 %) | 0.74 (3.0 %) | 0.78 |
| _attributeBuffer engine/render/MeshRenderer.js:159 | 0.77 (2.9 %) | 0.85 (3.5 %) | 1.10 |
| render engine/render/MeshRenderer.js:542 | 0.77 (2.9 %) | 0.83 (3.4 %) | 1.07 |
| _pack engine/gpu/Uniforms.js:197 | 0.78 (3.0 %) | 0.80 (3.3 %) | 1.02 |
| setBindGroup :0 | 0.69 (2.6 %) | 0.65 (2.7 %) | 0.94 |
| (anon) engine/render/ShadowCasters.js:15 | 0.72 (2.7 %) | 0.53 (2.2 %) | 0.73 |
| getBindGroup engine/gpu/Shader.js:383 | 0.60 (2.3 %) | 0.53 (2.2 %) | 0.89 |
| setVertexBuffer :0 | 0.60 (2.3 %) | 0.50 (2.1 %) | 0.84 |
| traverseVisible engine/scene/Object3D.js:259 | 0.61 (2.3 %) | 0.47 (2.0 %) | 0.78 |
| _slot engine/render/MeshRenderer.js:100 | 0.52 (2.0 %) | 0.55 (2.3 %) | 1.06 |

**village** (CPU per frame 19.4 -> 19.1 ms; share = self time / CPU per frame)

| function | before ms (share) | after ms (share) | after / before |
|---|---|---|---|
| visit engine/render/MeshRenderer.js:444 | 3.21 (16.5 %) | 3.08 (16.1 %) | 0.96 |
| drawItems engine/render/MeshRenderer.js:598 | 2.00 (10.3 %) | 1.93 (10.1 %) | 0.96 |
| (garbage collector) | 0.88 (4.5 %) | 1.39 (7.3 %) | 1.59 |
| groundHeightAt world/Colliders.js:65 | 0.79 (4.0 %) | 1.03 (5.4 %) | 1.31 |
| (anon) engine/render/ShadowCasters.js:15 | 0.62 (3.2 %) | 0.55 (2.9 %) | 0.90 |
| resolveCapsule world/Colliders.js:82 | 0.59 (3.1 %) | 0.52 (2.7 %) | 0.87 |
| _attributeBuffer engine/render/MeshRenderer.js:159 | 0.54 (2.8 %) | 0.57 (3.0 %) | 1.05 |
| _pipeline engine/render/MeshRenderer.js:352 | 0.51 (2.6 %) | 0.51 (2.6 %) | 1.00 |
| updateMatrixWorld engine/scene/Object3D.js:282 | 0.55 (2.8 %) | 0.44 (2.3 %) | 0.80 |
| _pack engine/gpu/Uniforms.js:197 | 0.53 (2.7 %) | 0.45 (2.3 %) | 0.84 |
| traverseVisible engine/scene/Object3D.js:259 | 0.51 (2.6 %) | 0.44 (2.3 %) | 0.86 |
| render engine/render/MeshRenderer.js:542 | 0.46 (2.4 %) | 0.47 (2.5 %) | 1.03 |
| setBindGroup :0 | 0.45 (2.3 %) | 0.37 (1.9 %) | 0.82 |
| setVertexBuffer :0 | 0.39 (2.0 %) | 0.33 (1.7 %) | 0.84 |

## Not done yet (in order)
