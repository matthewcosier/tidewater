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

## Loose pieces drawn by the GPU

During a tsunami's flood a few hundred loose pieces move every frame: wall panels, roof sheets and
openings of the village houses, the pier's deck members, props, imported terminal fragments. Each
used to be drawn by rewriting every vertex and normal of its spans on the CPU (`Structures.drawSpans`,
`MemberSkin.drawMember`, `PropPhysics.draw`), keeping the previous positions for the motion vectors
(`GeometryMotion.js`) and uploading all three ranges again: in a 10 m flood (seed 7, 2560x1267)
`drawSpans` 8.0 ms self, `Structures.sync` 10.4 ms inclusive, `drawMember` 1.5 ms and 2.8 MB a frame,
`writeBuffer` 7.4 ms, `MeshRenderer._attributeBuffer` 9.3 ms inclusive, and the refraction pass'
bounds of the moved vertices (`RefractionPass._localBox`) 3.5 ms.

### Measured (flood phase, 10 m, seed 7, 2560x1267, `tools/flood-profile.mjs`, back to back, load 19-22)

GPU ms per pass at the flood views (bench, same runs): no pass slower by more than 0.1 ms; opaque
4.87 -> 3.87 (flood), 2.99 -> 3.27 (impact), 4.45 -> 3.17 (aerial); refraction 0.90 -> 0.88 (impact).
The bench's frame totals in the flood are CPU-bound (first to last timestamp) and are not compared.

### Design: the GPU applies each piece's transform (`src/engine/render/PieceMotion.js`)

- **Reference.** A piece is rigid between its joints, so its drawn vertices are one transform of its
  rest vertices; a jointed member's skin is the linear blend of its two rigid section frames by a rest
  weight per vertex. This is what the CPU computed; nothing about the look changes.
- **Source of truth.** The rest vertices stay in the merged batch (the same arrays the collision
  proxies, the bounds and `saveSpan` read). The pose stays where it was: the solver's poses read by
  `Structures.sync`, the section frames of `MemberSkin`, a prop's `m` and `m0`. One storage buffer of
  slot transforms, written only by `PieceMotion.js`.
- **Data.** Per vertex of a breakable batch a `piece` attribute (uint32 x 2: the slot, and the blend
  weight toward the next slot as f32 bits, its sign bit asking for the normal to be renormalised),
  made at load by `saveSpan` so every pipeline is compiled with it behind the loading screen, and
  written for a span's vertices once, when it first moves. Per slot 96 bytes: this frame's 3x4
  transform and the last drawn frame's.
- **Passes.** `MeshShader.js` (`HAS_PIECE`) applies the transform after the vertex fetch and before the
  material hook, in every pass that draws the batch: main, depth (shadow cascades), refraction, colour.
  The motion vector adds (last drawn - this frame) of the piece. No draw is added: the batches draw as
  before.
- **Budget.** CPU: one 3x4 write per moved span (a rigid piece) or two (a member), no per-vertex work,
  no allocation. Upload: 96 bytes per moved slot a frame, in merged runs. GPU: per piece vertex up to
  three storage reads and dot products in the vertex stage (six for a bending member); vertices of no
  piece skip it on one branch. Memory: the slot buffer is sized at load for two slots per saved span,
  so it does not grow during an event (a growth is a new buffer, a re-upload of every slot in use and a
  rebuild of every bind group that reads it). The island's 8,566 saved spans (the village, its props,
  both terminals) give 32,768 slots: 3.0 MB on the GPU and 3.3 MB of CPU copy and flags. Every record
  broken at once claims 8,481. The `piece` attribute is 8 bytes per breakable vertex.
- **Readers of the drawn positions.** The CPU no longer holds them: `test/helpers/drawn-pieces.mjs`
  (`drawnPosition`, the CPU mirror of the vertex stage) is what tests read. Cached shadow depth sees a
  batch's piece motion as a deformation (`ShadowCasters.js`, `pieceMotionOf`), as it saw rewritten
  vertices. The refraction pass draws a batch with a piece away from rest whole (`piecesAway`), since
  its rest bounds no longer hold the piece; it used to recompute the bounds of the moved vertices.
  Frustum culling reads the batch's bounding sphere, computed once at build, as before.
- **Transitions.** A piece's first move starts its last drawn pose at rest (no streak); a stopped
  piece's next frame has no motion (`commitPieces`); a Restore draws every piece at rest at once with
  the jump's motion for one frame, then hands its slots back and clears its vertices' slots, so a
  restored batch is drawn, and costs, as at load. A new claim over vertices another span holds (a later
  event that cut a building differently) first clears that span's vertices. The kind of blend weights
  a member span's vertices hold (rigid, bending, severed) is kept on its slot claim, not on the span: a
  span claimed again after a Restore, often given the same slot back, writes its weights again. Kept on
  the span, it skipped that write, and a member that bent again in the next event was drawn rigid with
  its left section.
- **Edges.** A span's frame is rigid (the imported terminals' world matrices have scale 1 to 4e-15),
  so a slot's 3x3 turns normals as the CPU's normal matrix did. Spans with a frame renormalise their
  drawn normal, as `saveSpan` renormalised their rest normals. A device loss reloads the page.
- **Evidence.** `test/piece-motion.mjs`: a frame with 12 moving pieces of a real village house uploads
  one transform per span (red at the old code: 116,280 bytes for 50 spans of 3,230 vertices, against
  4,800). `test/piece-equivalence.mjs`: old
  against new on real data (a house, the pier, a bending timber frame, props, terminal fragments; poses
  up to 300 m away), the vertex stage's WGSL on the GPU and its CPU mirror, within 4 float32 ulps of the
  coordinate scale. `test/geometry-motion-gpu.mjs` (motion vectors through the real vertex stage, the
  Restore jump), `test/debris-motion.mjs`, `test/structural-members.mjs`, `test/shadow-caster-motion.mjs`.
  The same equivalence draws a bending timber frame again after Restore island (red with the weight kind
  kept on the span: 99,631 x the float32 bound off the CPU skin). `test/piece-motion.mjs` also samples the
  heap under the drawing of 12 house pieces, 90 pier sections and 30 props: nothing allocated a frame
  after 200 warm frames (red at the old code: 247,421 bytes a frame). The engine boxes the doubles of
  code it has not optimised yet, about 2.5 KB a frame over the first 50 frames, so the sample comes
  after the warm frames.

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
