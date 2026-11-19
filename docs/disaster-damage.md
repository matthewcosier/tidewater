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

## Not done yet

Bend sway in the vegetation shader (reads `t.util`); pre-fractured terminals. See the lane map.

# Disaster damage: a structure breaks without throwing its pieces

Breaking takes energy out of a structure and never puts any in. At the instant a connection breaks or a
part is torn off, no piece gains speed except from gravity, from the wind or water on it, and from being
struck by something it was not part of. Code: `rally-physics/src/structures.rs` (the pieces, what each
began inside, the two collision hooks), `src/disasters/Structures.js` (`fracture`, `spawnPiece`,
`fractureLegacy` name each body's structure), `src/disasters/MaterialMembers.js` (fittings ride a member).

## Design note

1. **Reference.** A nailed timber connection stores little: a 3 mm nail in softwood slips about 0.7 kN/mm
   (EN 1995-1-1 section 7.1, K_ser = rho^1.5 d^0.8 / 30 with rho 420 kg/m^3), so at the 1.8 kN the game
   gives a fastener it holds about 2 J, and pull-out absorbs that as it fails. Wreckage in a flood moves at
   or below the speed of the water (FEMA P-646, 2019, section 6.5.6 takes the flow speed as the debris
   speed), and nothing but buoyancy lifts it. So the real outcome is: a failed frame sags, folds and is
   carried; its pieces do not leave faster than the flow, and none rises. Measured before this change on the
   real island with no load at all (no wind, no water, gravity cancelled): the Harbour pier, switched from
   standing to jointed, broke 291 of its 305 connections in one second and its sections reached 34 m/s; the
   first evacuation boardwalk broke 15 of 15 and reached 3.7 m/s; with every connection removed by hand the
   pier's sections left at up to 29.5 m/s, 13 m/s of it upward.
2. **Cause.** A piece's collision box is the fitted box of its triangles (`memberFrame`), and the triangles
   of a deck bay, a rafter truss or a wall that wraps a corner do not fill that box. So boxes of pieces that
   were built touching overlap: 210 of the pier's 305 jointed pairs, by up to 4.1 m (median 1.0 m); 14 more
   pairs with no connection between them, by up to 1.4 m; 122 of the 260 deck sections on the island begin
   more than 1 cm inside a standing box of the next structure (a neighbouring bay's deck or rail, up to
   1.13 m). The solver separates overlapping boxes. Two sections alone gain 0.15 to 0.44 m/s from it; a
   frame of them, each pushed by several neighbours and pulled back by its connections, tears itself apart.
3. **The rule in the solver.** A piece does not collide with a thing it began inside until it has first
   come clear of it; from then on it collides with it normally. Nothing is trimmed: the collider is the box
   of the piece that is drawn. "Began inside" is an overlap deeper than 1 cm (`TOUCH`): shallower is two
   things resting on each other, which the solver holds at about 5 mm, and they collide from the first step.
   - Two pieces of one structure: the pair is listed when either is named as a piece
     (`set_structure_piece`), and again if a connection between them breaks or is removed while they
     overlap. A listed pair makes no contact (`filter_pairs`). Each step, a listed pair whose boxes no longer
     intersect leaves the list. A pair never joins the list any other way.
   - A piece and a standing box or post: on the piece's first step, every standing shape it is more than
     1 cm inside is copied to the piece (the standing shapes are rebuilt whenever a building changes, so the
     copy is the shape, not the body). Contact points inside a copied shape are dropped
     (`modify_contacts`). Each step, a copied shape the piece no longer intersects is forgotten.
   - Against everything else (the ground, a standing building it was not inside, other structures'
     wreckage, cars, trees, people) a piece collides from its first step.
   - Why not trim the box (the earlier answer for parts): the collider became smaller than the piece that
     is drawn, a roof cover still rose with no load, and trimmed sections climbed more, not less. Why not a
     speed limit or extra damping on pieces: they hide the push and also slow what the flow should carry.
4. **Every way two things begin overlapping.**

   | How it begins | Before | Now |
   |---|---|---|
   | Two sections joined by a connection | collide on the step the connection breaks | listed from activation; checked again at the break |
   | Two sections of one structure with no connection between them | collide from activation and break the frame with no load | listed at activation |
   | The two halves of one long member | as jointed sections | as jointed sections |
   | A part torn off beside loose parts of its building | collider trimmed, by up to half its size | listed at spawn, full-size collider |
   | A part spawned over a section or proxy of its structure | trimmed | listed at spawn |
   | The four proxies of an imported structure | collide at once | listed at spawn |
   | A fitting on its member | a 2 kg body of its own, flung by the member | not a body: it rides the member (below) |
   | A piece inside a standing box (the next bay's deck or rail, the wall slab beside a part, a door in its wall) | pushed out; a bay broke all its connections at activation | the box is copied to the piece on its first step |
   | A piece inside the ground | the buried end is cut off the collider (`fracture`) | unchanged |
   | Pieces of two different structures | collide | collide (a piece is never spawned inside another structure's wreckage by its own building) |

5. **Fittings.** In the jointed path a member under both `PIECE_MASS` (25 kg) and `PIECE_SIZE` (1.5 m) is
   never a body. Its triangles join the nearest member as a rigid attachment and its mass is added to that
   member, so it is drawn with it and never hidden.
6. **Source of truth.** The solver's own shapes and poses decide what overlaps; the structure a body
   belongs to comes from the record (`scatterIndex`). No new field, water or terrain read.
7. **Budget.** CPU, in the solver's step: one box-against-box test per listed pair and per copied shape,
   and one lookup per contact pair of a piece. Measured in Perf below. Nothing per frame in JS: the calls
   are made once per body, when it is created.
8. **Detail by distance, controls.** Unchanged: the same bodies as before, no new input.
9. **Transitions.**
   - A structure switches from standing to jointed: every overlapping pair is listed before the first step,
     so the frame is at rest until a load arrives.
   - A connection breaks: the pair is on the list already (it never came clear while joined); if it came
     clear and the frame then flexed back, it is listed again at the break.
   - A piece falls asleep: its entries stay and cost nothing (a sleeping pair is skipped).
   - A building is restored, or Restore island: each body is removed, and its pairs and copied shapes with it.
   - A second event on a half-broken building: loose pieces keep their entries; a new part is listed
     against whatever of its structure is loose at that moment.
   - A standing wall fails after a piece began inside its slab: the slab is gone; the copy is forgotten when
     the piece leaves where the slab was.
   - A piece handed to the debris hook was never a body and has no entry.
   - An activation that runs out of bodies half way is rolled back: the bodies go, and their entries.
10. **Edges.** The test is geometry at one instant (boxes at spawn or at the break), not a force or a speed
    the piece makes itself. Two stacked pieces touch by less than 1 cm and are not listed, so a sheet rests
    on its rafter. A pair that never separates (two bays lying on the ground through each other) stays
    listed: they are drawn overlapping, as they were when standing. Ids that are not awake bodies are refused.
11. **Evidence plan.** Rust (`structures.rs`): two overlapping boxes whose connection breaks under load
    gain nothing from the break; a piece inside a standing box is not pushed and lands on it once clear;
    pieces of different structures collide. Node (`test/structure-breakup.mjs`, real island): two real pier
    sections with their connection removed; the pier, a boardwalk bay and a house failed by hand in still
    air (energy never exceeds the height lost; no lowest point rises); a roof cover with no load. Island
    runs (2 m, 10 m and 25 m, seeds 1 to 3) before and after. Browser:
    `test/browser/structure-breakup.spec.js`.

## Evidence

- Solver (`cargo test --manifest-path rally-physics/Cargo.toml structures`). With the collision hooks not
  registered, which is the solver as it was: a connection that breaks between two boxes 0.4 m inside each
  other, with no load, leaves a piece at 3.1 m/s; a connection removed by hand, 0.42 m/s; a piece 0.3 m
  inside a standing box, 0.48 m/s. With the rule each stays under 0.02 m/s, and once pulled clear and pushed
  back it stops against the other within 2 cm.
- The real island with no wind and no water (`node --test test/structure-breakup.mjs`), before and after:
  two pier sections 4.14 m inside each other gained 0.44 m/s when their connection broke, now under 0.1 m/s;
  the pier, standing for one second, broke 300 of its 305 connections and reached 34.9 m/s, now none and at
  rest; the first evacuation bay broke 15 of 15, now none; the main boardwalk's sections held 0.2 kJ having
  lost no height, now never more than the height they lose; of the parts of three houses failed by hand one
  rose 2.85 m, now none rises 0.05 m and each collides as the box it is drawn in.
- The real island in a flood, seeds 1, 2 and 3, sections and parts of structures:

  | | 2 m surge | 10 m wave |
  |---|---|---|
  | Pieces that climbed over 0.5 m within 3 s of appearing, before | 11, 18, 19 | 28, 29, 28 |
  | after | 0, 0, 0 | 3, 2, 5 |
  | Fastest upward speed clear of water and ground (m/s), before | 13.2, 18.6, 10.6 | 28.8, 30.2, 25.3 |
  | after | 2.3, 3.8, 2.4 | 7.3, 10.4, 6.8 |
  | Worst climb of a jointed section over the whole run (m), before | 6.02, 9.49, 5.42 | 16.07, 20.01, 13.15 |
  | after | 2.32, 2.99, 2.30 | 3.28, 3.61, 3.28 |
  | Worst climb of a wall part (m), before | 0.79, 0.72, 0.29 | 2.69, 1.32, 1.18 |
  | after | 0.02, 0.05, 0.00 | 2.42, 2.88, 2.39 |
  | Structures failed, of 49 (the same before and after) | 12, 14, 9 | 44, 44, 44 |

  Two runs of the same code differ (contacts are chaotic): judge over the three seeds.
- Fittings: 8 of the pier's 90 members, 5 of the main boardwalk's 24 and 2 of each evacuation bay's 6 were
  under 25 kg and 1.5 m. They now ride a member.

## Not done yet (break-up)

- In a 2 m surge 4, 7 and 7 pieces still climb over 0.5 m (up to 3.0 m) later than 3 s after they appeared,
  at up to 3.8 m/s upward: not the break, and not traced. In a 10 m wave 2 to 5 pieces still climb within 3 s.
- The browser scenario `test/browser/structure-breakup.spec.js` is written and has not run to its end.
- Frame time: at most 216 listed pairs and 34 copied shapes at once (25 m wave, 224 structure bodies), one box
  test each per step. Not yet timed.
- A piece spawned inside the wreckage of another structure still collides with it at once.
- The pier's record holds two members at the world origin, 55 m from the pier; they hold to their own anchor.
