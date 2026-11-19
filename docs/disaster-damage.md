# Disaster damage: trees

How a tree answers a tornado, a tsunami or an earthquake: it bends, it snaps, or it uproots, and it
falls about its hinge. Code: `src/disasters/TreeFailure.js` (failure and hinge), `src/disasters/TreeMass.js`
(green-wood mass), `src/disasters/Bodies.js` (wiring), `src/disasters/FallenVegetation.js` (the copied mesh
and the snap cut), `rally-physics/src/disasters.rs` (`set_prop_motion_limits`, `set_prop_crown`).

## Design note

1. **Reference.** EF scale damage indicators (WSEC 2006, used by the US NWS): DI 28 hardwoods are
   uprooted at an expected 41 m/s (91 mph) and snapped at 49 m/s (110 mph); DI 27 softwoods 41 and
   47 m/s. Island broadleaves take 41 m/s uproot and 48 m/s snap. Palms are the most wind-firm urban
   trees in hurricane surveys (Duryea et al. 2007, Arboriculture & Urban Forestry 33(2)): declared 52
   and 58 m/s. Green wood is 600 to 1000 kg/m³ (Wood Handbook FPL-GTR-190, ch. 4): 850 broadleaf, 700
   palm. Root-plate resistance is largely gone by 20 deg of tilt (Coutts 1986, Annals of Botany 58).
   Porous crowns streamline in strong wind (Vollsinger et al. 2005): crown Cd 0.35 on its ellipse.
2. **Source of truth.** Wind, flow, depth and shaking from `DisasterField.sample`; ground from
   `app.terrainData.heightAt`; capacity scatter from `EventRandom` (`STREAM.tree`, `CAPACITY_COV.tree`
   0.35, Nicoll et al. 2006); the authored mesh from the live `VegType` instance buffers.
3. **Budget.** At most 40 tree bodies (`treeLimit`) and 160 copied trees (`TREE_GROUP_LIMIT`), each one
   or two draws. The hinge is a 1-DOF integration per falling tree at 120 Hz on the main thread, no
   allocation per step.
4. **Detail by distance.** Within 300 m of the camera a falling tree becomes a rigid body once it
   passes 60 deg; farther away, or past the body budget, it keeps falling as an animated copy until its
   crown is a crushed crown's height off the ground, then rests. A standing tree that has not failed
   bends: `t.util` (moment over capacity) is computed for a sway shader (not built yet).
5. **Controls.** None of its own: the Disasters panel starts the event (`docs/disasters.md`).
6. **Transitions.** Standing to falling: the copy replaces the instance in the same frame at the same
   pose, so nothing moves until the hinge does. Hinge to body: the body takes the hinge's pose, linear
   and angular velocity (omega x r about the hinge), so nothing jumps (pinned: foot within 0.6 m of
   the hinge). Snap: the stump is a second copy cut below the break and never moves.
7. **Edges.** The failure moment comes from the field, not from the tree's own motion. A body's spin is
   capped at 2 rad/s with 0.5 1/s angular damping in Avian (`MaxAngularSpeed`, `AngularDamping`).
   Non-finite limits and crown sizes are rejected at the bridge. The hinge never swings back (omega >= 0).
8. **Evidence.** `test/tree-failure.mjs` (in `test:simulation`) and `cargo test
   released_tree_spin_is_capped_and_its_crown_props_the_top_off_the_ground`, below.

## Model

- Mass: stem = green density x form factor (0.45 broadleaf, 0.8 palm) x base cylinder; crown 30% of a
  broadleaf, 15% of a palm, as an ellipsoid at the authored crown. The crown counts as buoyant wood, so
  a floating tree's stem floats and its crown drags instead of sinking the top end.
- Capacity: each tree's uproot and snap capacity is the moment its own crown drag makes at the EF wind,
  times an independent lognormal factor per event. The drag area cancels, so every size fails at the EF
  wind on average. The mode is whichever capacity is exceeded more.
- Snap height: peak bending stress of a stem tapering to 40% at the top under a crown load, about 0.3 H,
  +-8% of H for defects, clamped to 15-70% of H. Palms barely taper and break low.
- Hinge: I theta'' = crown drag on the crown's velocity relative to the air x lever + m g d sin theta -
  residual capacity fading to zero by 20 deg (uproot) or 6 deg (snap).
- Body: stem box plus a crown sphere of 0.3 x crown radius (the crushed crown) that holds the top off the
  ground; friction 0.9 so branches snag.

## Evidence

# Disaster damage: buildings fail piece by piece

## Design note

## Model (buildings)

`src/disasters/BuildingComponents.js` sorts a house's spans into components: openings (glass, and
door-sized wood panels), wall panels (wood below the eave, binned by side and 3 m bay), roof covering
sheets (roofMetal, thatch), roof structure (wood above the eave, one per roof side), masonry (stone)
and fittings (hard, rope, net, flag; they ride with the nearest component). Each component's
capacity is the declared band centre turned into a pressure, times the per-event capacity factor.
A failed roof frame takes its sheets; a failed wall panel takes the openings and fittings inside it.
Houses, sheds, the boathouse and the market stall use this path (`structure(..., {progressive:true})`);
the pier, boardwalks and other decks keep the jointed module path.

## Drawing (buildings, members, props)

A loose piece is drawn by the GPU (`src/engine/render/PieceMotion.js`, `docs/render-performance.md`
"Loose pieces drawn by the GPU"). Its vertices stay at rest in the merged batch; the first time a
span moves it claims a slot, written once into its vertices' `piece` attribute, and every frame it
moves it sets one 3x4 transform, rest to drawn, in its geometry's own frame:

- a rigid piece (`Structures.drawSpans`): the body's pose after its rest origin; a span with a frame
  (the imported terminals) takes `inverse * pose * frame`, its normal renormalised as `saveSpan`
  renormalised its rest normals;
- a jointed member (`MemberSkin.drawMember`): two consecutive slots, its two section frames, and each
  vertex's rest weight toward the second (the bending blend, or 0 / 1 per triangle once severed),
  written when the skin changes kind and again for every new claim (the kind is kept on the claim, so a
  member that bends again after Restore island is drawn bending); the normal is renormalised after the
  blend, as before;
- a prop (`PropPhysics.draw`): `m * m0^-1`.

The vertex stage of every pass applies it before the material hook, so the main pass, the shadow
cascades, the refraction and colour passes and the motion vectors (this frame's transform against the
last drawn one) see the piece where the CPU rewrite used to put it (`test/piece-equivalence.mjs`).
Restore sets the slots back to identity for one frame (the jump writes its motion, as before), then
hands them back and clears the vertices' slots, so a restored batch is drawn as at load. A small or
distant piece still collapses its vertices on the CPU once (`hidePiece`).

## Not done yet

Bend sway in the vegetation shader (reads `t.util`); pre-fractured terminals. See the lane map.
