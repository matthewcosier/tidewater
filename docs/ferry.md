# The Tidewater Spirit (car ferry)

A 50.4 m, 17.8 m beam aluminium catamaran car ferry after Austal's Spirit of Kangaroo Island
(2003, 2.5 m draught), with our own name and livery. The terminal is `tools/ferry/terminal_build.py`
(Penneshaw layout: breakwater hook, L jetty, solar-roofed hall, marshalling yard, stern-to berth).
Schedule, the Joey Island crossing, wake in game and marine life are later phases (plan at the end).

## Design: a faster helm, boost, two ships and a longer strait (2026-10-05)

## Model: `tools/ferry/ferry_build.py`

Procedural Blender build (Blender 5, headless):

Outputs `public/ferry/ferry.glb`, `public/ferry/ferry_colliders.json` and `assets/ferry/ferry.blend`.
Most parts go through `tools/ferry/ferry_batch.py` (one mesh per group and material; sheets such as
skins and glazing keep the winding they were built with, so build them facing outward).

Layout (model frame: bow +Y, starboard +X, Z up from the waterline; the export turns her to glTF +Z):
- Hull: one loft of both slender demi-hulls (centres x +/-6.7, 2.2 m half width at the waterline)
  and the tunnel between them, square-shouldered aft and arching up to 6.5 m under the bow. Knife
  stems rake from the waterline at y 22.6 to the deck edge at y 25.0. The navy runs to the boot top
  (3.3 m) and rises along the stem rake to the deck at the bow; the underwater body is blue.
- Vehicle deck 2.6 m, 13.2 m wide between the side wings, open to the sky aft (trucks), under the
  saloon forward to the bulkhead at y 18.6. Stern ramp 10 m x 7 m (pivot `SternRamp`).
- Side wings (x 6.6 to 8.9, stern to y 0.5): a corridor at 7.0 m with the window band, a walkway on
  top at 10.0 m, stairs from a doorway in the vehicle deck wall up to the corridor and on to a stair
  house on the walkway, the gangway door in each side at y -15.5 (sill out to |x| 9.32), a ladder
  down the side at y -18. The starboard wing carries the rescue boat under the davit.
- Saloon at 7.0 m from y 0.5 to its glazed front at 16.6, under a brow; its roof at 10.0 m is the sun
  deck aft of the bridge deckhouse. The side walls are flush from the boot top to the deckhouse
  windows, then fall as the cheeks to the bow corners; the window band ends in a raked point on them.
- Bridge deckhouse on the saloon roof from y 5.4, flush sides, rounded front, windows 11.0 to 12.85,
  roof 13.2 m: an upper lounge aft, the bridge forward (console, wheel `HelmWheelMount`/`HelmWheel`,
  throttles `ThrottlePort`/`ThrottleStarboard`), mast and radars (`RadarX`, `RadarS`) on the roof.
- Bow deck at 7.0 m: winches, capstans, bitts, lines, an outside stair up to the brow.

Stations: `HelmStation`, `GangwayDoor` (port), `GangwayDoorStarboard`, `RampTop`, `CarDeck`,
`SaloonCentre`, `ViewingDeck` (the sun deck), `BowDeck`.

Review renders: `tools/ferry/ferry_render.py` (Cycles on the GPU, a simulated sea with a wake mask
painted into the water, marine paint shaders from `tools/ferry/ferry_paint.py`, render-only passengers):

Views: photo ref ref9 (framed like the reference photo) sideclose aerial1 bowlow sternq bow34 stern34
profile aerial rampdown bridge helm wheel saloon cafe cardeck stairs sundeck bowdeck corridor.

Materials in the GLB are glTF PBR factors only (the game loader reads colour, metalness, roughness,
emissive, alpha); the glass is dark tinted (alpha 0.72, blended, double-sided). The paint shaders
(plate dishing, orange peel, grime streaks, waterline scum) exist only in the Cycles renders.

## Interiors (builder sections 10 to 12 and 16, `src/ferry/FerryPaint.js`)

The GLB carries flat PBR factors, so interior detail is geometry plus runtime patterns keyed by material name
in `FerryPaint.js` (`INTERIOR`): `CarDeckWall` (welded plates, dark dado with a yellow line, rust at the foot and
from the seams, bumper scuffs, grime), `CarDeckFloor` (speckle, polished tyre tracks down the four lanes, oil
where cars stand), `CorridorLaminate` (1.2 m panels, dado, skirting), `CorridorVinyl` (flecked, welded seams),
`StairTread`, `CeilingLining` (600 x 1200 ceiling grid on down faces, panel joints on walls), `SaloonCarpet`
(teal diamond lattice, gold dots), `SeatFabric`, `HeadrestTeal`, `CurtainFabric`. Each snippet runs in its own
WGSL block, takes her-frame position `vLocal` and the face normal from `cross( dpdx( p ), dpdy( p ) )`, and adds a
warm fill (`s.emissive += s.albedo * warm * k`): the engine's sky ambient otherwise leaves ceilings black and walls
cold blue.

Section 16 fits out the vehicle deck (frames every 2.4 m, stringers, fire main, extinguishers, hose cabinet
lettering, NO SMOKING and PASSENGERS MUST NOT REMAIN signs, EXIT, the stair door leaf with kick plate and vision
port, drains, lashing sockets, lane numbers 1 to 4, sprinkler mains, cable trays and vent ducts under the saloon),
the wing corridors and stairs (laminate linings, sills, handrails, a lined ceiling, doors held open with kick
plates, muster station, lifejacket locker, fire and safety plan, aluminium nosings on the leading edge of each
tread, risers) and the saloon (linings, curtains, luggage racks, the kiosk's battened counter, pastry case, till,
espresso machine, drinks chillers, lettered menu, seat numbers A1 to K12 on every seat back). Small parts go in
the `Props` group; `Ferry.js` turns their shadows off.

Rules learned building it:
- A coplanar face loses to the dark one: the wing slabs' deck boxes (`wing_slab` rects) share the lining fill's
  plane, so the corridor and landing ceilings are separate lining sheets 5 to 20 mm below the slab.
- Flat lettering (`extrude=0.0`) must skip `tidy_glyphs` (`tidy=False`): its weld and sliver pass eats the thin
  fill triangles (E and T lose strokes) and its normal pass turns glyph pieces backward. `text()` in section 16
  faces every triangle to the lettering's +Z instead. Extruded lettering costs about three times the triangles.
- Lettering people read from a few metres (the muster signs: `wall_sign(..., extruded=True)`) is extruded 20 mm and
  tidied, front 3 mm proud of a 40 mm board, at 0.1 m or more: at 0.07 m the strokes of E and T went sub-pixel at 4 m and
  the stair door sign read "MUSTI R S TATIONS". `tidy_glyphs` no longer runs `dissolve_degenerate` (as in the terminal).
  Other wall signs stay flat (extruding them all cost 40 k triangles).
- Forward lounge (section 12): banquettes, not boxes: dark plinth behind stainless kick plates, three seat and three back
  cushions (`pillow`), oak-laminate arms and back panel, laminate capping rail with stainless edge trim; tables have a
  teak edge band on two pedestals. Their colliders are unchanged. `SaloonCarpet` repeats every 0.3 m (was 0.6 m, which
  read as 1 m squares) and fades its lines to their average where they go sub-pixel.
- Wing corridors: a panelled guard with a teak cap and kick plates round the car-deck stair's hatch (visual only, no
  collider); the gangway door leaf has a raised border, glazing both faces in a gasket, kick plates, lever handles and
  hinges. The stair house on each wing top is walls and a roof, not a closed box (its floor face capped the stair from
  below, and inside it was empty): laminate linings, a lined ceiling with a light, a steel door frame and sill, the leaf
  held open against the outboard wall. The dark slab that stood in its doorway is gone.
- New interior colliders: the two lifejacket lockers and the luggage rack (`solid`). Seats (`SEATS` in
  `Crowd.js`), car deck `car` boxes and every stair and door collider are unchanged.

Seats (`seat_unit`, section 12) are moulded, not boxes: `pillow()` sweeps a rounded-rectangle section and eases both
ends in, so every edge is rounded (four-segment corners stay under the 35 degree sharp pass and shade smooth). Each
seat has an upholstered pan, a contoured back in a dark moulded shell, a teal headrest and a stainless grab handle on
the shell for the row behind; padded armrests sit on bent tube. The pan top stays at DECK2 + 0.39 and the back frame
(-8 degrees, `SEAT_PLATES`) is unchanged, so `SEATS` in `Crowd.js` and the seat numbers still fit. The seats cost
about 100 k triangles (the GLB went from 236 k to 337 k triangles, 12.2 to 17.6 MB).

`CorridorLaminate` draws 1.2 m panels with a shadow gap at least a pixel wide (`fwidth`), a linen weave above an
oak-effect dado, an aluminium dado rail with its shadow line, a head joint at 2.15 m, scuffs, screw heads and a rubber
skirting. `CarDeckWall`'s fill under the saloon is 0.2 (0.4 burnt the near-white wall out) and soot darkens it toward
the deckhead. `LifejacketBox` is SOLAS orange; it was magenta and read as a missing texture on the bow stair.

## Colliders: `public/ferry/ferry_colliders.json`

In the ferry's frame (+Z bow, +Y up, origin on the waterline amidships; starboard is -X).
`walk` boxes are floors and stair treads (their tops are what you stand on; treads reach down
to their flight's base), `solid` boxes are walls, rails and furniture, `car`
boxes form her vehicle deck in the car physics. `stations` gives named points.

Every flight needs a clear opening above it for its whole length: a walker is 1.75 m tall and the
deck above (a `walk` box, solid below its top) stops their head. FerryDeck pushes a walker out of
a box along the shallower axis, so a head caught under a slab is shoved sideways, through a thin
wall if one is near, and drops to whatever is below. The wing stairs from the promenade (7.0) to
the top deck (10.0) run from z -19.9 to -15.74, so the top deck is open, and the stair house
covers, from z -19.95 forward. Keep a door's landing clear too (the liferaft cradles on the wing
tops sit forward of z -12.6). Walker's step is 0.45 m (two risers of a 0.183 m stair).

## Runtime: `src/ferry/`

Controls at the helm: A/D wheel (it stays where you leave it), W/S throttles, X stop, C wheel
amidships, G boost (on or off), Shift+A/D bow thruster, H horn, V bridge or chase view, E leave the helm. The stern
thruster is the autopilot's alone: there is no key for it, and `Ferry.update` zeroes it whenever
the service is not steering.

## Terminal: `src/ferry/Terminal.js`

Placement. `WORLD.ferryTerminal` (`src/world/WorldLayout.js`) is `{ position: (150, 0, 300), yaw: 0 }`:
where the terminal's glTF frame origin (the docked ferry's stern-ramp hinge line at sea level)
sits, and its yaw. The glTF frame is +Z out to sea (the docked ferry's bow), +X to the left
looking out to sea, +Y up; world = position + rotateY( yaw ) · local, with local +Z facing
( sin yaw, 0, cos yaw ), the same convention as `FerryShip.forward()`, `Colliders` box yaw and
`Object3D.rotation.y`. `terminalToWorld()` is the one place that transform lives; everything
below derives from it, so moving the terminal is a one-line change.

Data flow. The terminal lane (`tools/ferry/terminal_*.py`) writes three files, all in the glTF
frame, and the game only reads them:
- `src/ferry/terminalSite.js`: terrain edits and keep-clear zones (`fill`, `dredge`, `ridges`,
  `clear`, `roadEntry`, `parking`). `applyTerminalSite( terrainData )` runs in `App.init` straight
  after `new TerrainData()`, before the village, roads, vegetation, shore field, GPU terrain and
  minimap read the heights, so the surf and the minimap follow the new coast.
- `public/ferry/terminal_colliders.json`: `boxes` (`walk`, `solid`, `car`), `stations`, `pivots`.
- `public/ferry/terminal.glb`: loaded with `loadModel()` and placed at the site.

Terrain edits (`TerrainData`, world x, z, about 45 ms), in this order: the fill (`fillPolygon`:
only raises, to `height` inside with rock, sand and seabed cover cleared; a straight rock
revetment (rock 1) falls to the natural ground outside over `slope` metres; higher ground is left
alone), then the cut (`cutPolygon`, the same polygon: only lowers, to the fill `height` inside and
over a 1.5-texel shoulder, then a 1:1 rock cut face back into the natural ground; the yard paving
is visual and cars drive on the terrain, and behind Joey Island's lanes the natural hill stood up
to 12 m through the paving until this cut; Tidewater's flat is unchanged by it, `test/terminal-flat.mjs`
pins both), then the dredges (`dredgePolygon`: only lowers, to `depth` inside, smoothstep back over
`blend`; the berth polygon follows the quay faces with a 2 m blend, so it cuts the fill's bank
back out in front of the quay walls and keeps the berth deep), then the breakwater cores (`ridge`: only raises, flat crest `halfWidth` either side
of the line, sides at `slope` run per metre of rise, armour rock). `clear` polygons become
`TerrainData.addClearZone()` zones: `inClearZone( x, z, pad )` is tested by the plant scatter
(`vegetation/Scatter.js`), the rock scatter (`Rocks.js` keep-outs) and the debris placer (the
obstacle hash `dist()` returns -1 inside a zone), a polygon test rather than footprint circles so
the zones cost nothing outside their bounds.

Road. `roadEntry` (local (55, -116.2), yaw 0: world (205, 183.8), heading +Z) is where the
island's ferry road arrives (`CoastalRoute.buildFerryRoad()`, `route.ferryRoad`, start Ferry
road). It is a 380 m sealed spur (asphalt, 2.7 m half width, at most 8.6 % grade, never below
1.6 m) built like the circuit: it leaves the mountain circuit at (161, -185) on the circuit's
own tangent and height, follows the bay's east shore at the foot of the headland (landward of
the surf), cuts through the knoll at z 70 to 100 and crosses the sand spit on an embankment,
with a guardrail on the seaward side. Its last 15 m run straight along +Z and its last 12 m sit
level at 3.1 m, the fill height: `roadEntry.height` (3.2 m) is the GLB paving, which is visual
only, so the car drives on the fill and the road lands on it (the ground at the entry itself was
3.02 m after the site edits, the top of the revetment). `test/ferry-road.mjs` pins the road's
end to `roadEntry` through `terminalToWorld()`: if the terminal or its entry moves, that test
fails until `FERRY_ENTRY` and the last control points in `CoastalRoute.js` follow.

Colliders. `Terminal.init()` fetches the collider JSON and adds every box to `app.colliders` in
world space before `RallyDrive.init()`, so the car physics' one-time static export picks them up
with no extra call: `walk` boxes are walkable and solid (tag `terminal`), `solid` boxes solid
(tag `terminal`), `car` boxes walkable and solid (tag `terminal-car`). They are axis aligned in
the terminal frame, so in the world they carry the terminal's yaw. Stations and pivots are
exposed in world space (`terminal.stations.GangwayGate`, `terminal.pivots.LinkspanDeck.hinge`
and `.axis`) for the schedule phase. The GLB loads in the background while the car physics
starts; `App` awaits `terminal.ready` after the ferry, and the console logs
`[terminal] terminal.glb loaded in N ms`.

The ferry's mooring is the berth: her model origin sits at terminal (0, 0, 25.2) (`BERTH`), her
yaw is the terminal's, port side to the jetty. At rest her gunwale samples (x +/-9.0, radius
0.4) clear the fender face at x +9.5, so nothing pushes her and her readout's `data-x/-z` stay
on the berth. The deployed gangway lands on her port door sill (+9.32, 7.0, 9.7): a walker
crossing it from the covered walkway boards her through `FerryDeck.canBoard`.

### Harbour time

Slow only where the harbour needs it. Measured in `test/ferry-fleet.mjs` (real FerryShip and
FerryService, both berths from WORLD), lines off to 200 m out / 200 m off the far berth to lines on:

### Turning inside the breakwater

- Thrusters, a declared game choice: 100 kN each (was 40 kN). Reference: tunnel thrusters give
  about 11 to 13 kgf per kW, so a 50 m ship of her size carries 300 to 400 kW units (about 40 kN);
  100 kN is an 800 kW unit, the size a 150 m ro-pax carries at the bow. She swings 180 degrees in
  about 20 to 30 s and walks sideways at up to 0.8 m/s.
- The gate (where she swings) is 85 m out along the berth's axis from her marks. Her corners turn
  on a 26.5 m circle; there it passes the jetty head's corner (terminal x 10.1, z 78) 6.7 m clear.
  At 60 m out the circle cuts into the marina walkway, and the sweep in `test/ferry-fleet.mjs`
  failed at once (gunwale up to 2.96 m into the walkway box, and she hung on it).
- She plans her braking to come to rest on the gate (0.5 m/s2, under her 0.59 m/s2 astern), and
  inside 30 m of it she pivots on it: the levers hold the gate's distance along her bow and both
  thrusters its distance abeam, while the thrusters' difference turns her at up to 0.12 rad/s.
- She leaves along the axis until her stern is 5 m past the jetty head (85 m out), then turns.
  At 60 m out the turn kicked her stern into the walkway.
- She backs only when square within 3 degrees and on the line before her stern passes the jetty
  head (within 0.25 m at full creep, stopped at 0.55 m off), on a 0.175 m/s2 braking curve, and
  comes ahead again if she runs past her marks (the old crawl pushed her on astern into the
  linkspan).
- She turns out of her harbour at TURN only while the other ship is within 900 m (MEET).

The sweep: `test/ferry-fleet.mjs` builds both terminals on the real terrain and loads
`terminal_colliders.json`, then every frame in a harbour checks her keel lines against the seabed
and the breakwater cores, and her gunwales (a 0.4 m capsule, as `FerryShip.collide`) against the
terminal's boxes.

## Evidence

`test/browser/ferry.spec.js`: boarding from a free-camera drop onto the sun deck, walking through the
upper lounge to the wheel, taking the helm (she still lies on her berth to 5 cm), making way and
turning to starboard; full ahead with the wheel hard to port swings her east across the harbour
basin onto the rocks east of the harbour (the breakwater armour or the headland's sea stacks,
depending on the site data), which damages (in practice holes) the hull. Inverse: with boarding
disabled both fail at the drop; with an indestructible hull the damage scenario fails (hull
damage 0). Car riding: the three deck scenarios in `rally-physics/src/tests.rs`.

`test/browser/terminal.spec.js`: a free-camera drop onto the covered walkway's landing at the
gangway gate, facing her port door; walking forward over the gangway shows "Aboard the Tidewater
Spirit". Red before the terminal existed: the drop landed in the sea (`mode: swim`). Captures:
`test-results/terminal-gangway.png`, `test-results/terminal-from-beach.png`.

## Plan

1. Terminal (ticket shop, jetty, stair tower, covered gangway, linkspan) and its dredged berth: placed, see above.
2. Schedule: ramp and gangway, horn signals, the crossing and docking, cars boarding over the ramp.
3. Wake: a second wave-sim instance with a twin-hull pressure source.
4. Joey Island with its own terminal; dolphins riding her bow wave and wake; whales.

## Joey Island and the scheduled service

- Joey Island lies across the strait to the south (src/world/terrain/IslandShape.js `JOEY` outline and two ridges; TerrainData `_coast()` blends it in). Its terminal is the same site placed a second time: `WORLD.joeyTerminal` (-176, 0, 1802 since 2026-10-05; 652 before), yaw 220 degrees. `Terminal.js` takes a placement name (`new Terminal( app, 'joey' )`, `PLACES`), `applyTerminalSite( terrain, site, place )` edits the terrain for either, and each instance has its own `toWorld` and `berth()`.
- `Ferry.berths` lists both berths; `onMarks`, the auto capture, `makeFast` and the berthing signals work against the nearest one, and the gangway and linkspan barrier follow the terminal she lies at (`ferry.at`). The helm readout carries `data-berth` ('tidewater' | 'joey' | '').
- `FerryService.js`: the timetable (60 s layover at start with the ramp up, ramp down, 60 s loading, ramp up, cast off with the prolonged blast, sail, make fast, lower the ramp, load, return). It is on by default; `?ferryService=off` turns it off (she then lies made fast until a player takes her), and `?ferryTimetable=short` shortens only the waits at the berth to 4 s and 5 s (tests). When it is off the departures board stays hidden. Taking her helm pauses the service; leaving it resumes from where she is: made fast, the berth cycle goes on (a layover of at least 10 s); under way, she makes for the nearest berth.
- The `Autopilot` drives her real lever, wheel and thrusters, in legs (`pilot.leg`, also `data-leg` on the board):
  - `depart`: dynamic positioning straight out along the berth's axis at service speed until 60 m out (`CLEAR`), the thrusters holding her on the line and on its heading so her port side never touches the jetty;
  - `cross`: wheel and levers for the far berth's gate, 130 m out along its axis (`GATE`), at 12 m/s (`CRUISE`, 7.8 m/s before 2026-10-05), slowing inside 200 m;
  - `swing`: 60 m short of the gate (`SWEEP`) a pivot nearly in place on both thrusters (0 to 0.3 m/s, heading only) onto the berth's axis heading out, so she lies stern-to outside the breakwater head (about 170 m out from her marks);
  - `back`: dynamic positioning down the axis. Heading held on the berth's yaw by the thrusters turning against each other, sideways held on a line 0.3 m to starboard of her marks (`MARK`) by the thrusters pushing together, and astern on the levers at up to 3 m/s (`CREEP`), easing as the square root of the distance left (`sqrt( 0.07 * along )`, then `0.12 * along + 0.05` in the last metres) so she comes onto her marks at a crawl. She holds off (no way astern) while she is more than about 0.4 m plus 8 % of the distance left off the line, or more than 0.05 rad off heading. The lines go on through `Ferry.onMarks` (1.5 m, 3 deg, 0.4 m/s), and the winches haul her the last 0.3 m in.
  - `route()` puts her straight into `back` when she is resumed within 90 m of the berth (`HOLD`), under 2 m/s and within 0.8 rad of its heading.
- Offline sim (terrain edits and both terminals' collider boxes, the autopilot and `FerryShip` as shipped, 60 and 30 fps): Tidewater to Joey Island makes fast 202.6 s after casting off, Joey Island to Tidewater 227.0 s; peak sideways error inside 90 m of the berth 0.30 m (the aim), no hull contact at all (no collider push, no grounding, no impact). The earlier bow-thruster-only approach never made fast at Joey Island (2 m off her marks) and brushed the jetty 1088 times.
- In game (test/browser/crossing.spec.js, 60 fps headless): Tidewater to Joey Island, lines off to lines on, 202.6 s game time, hull under 0.02, the same figure as the sim. A car parked on her deck drifts 0.335 m over the whole crossing and never tips.
- Mooring and heading: her yaw is not wrapped, so a berth a full turn away (Joey Island's 220 degrees after a crossing) must be reached the short way. `FerryShip.hold()` takes the berth heading by the wrapped difference; snapping to the berth's raw yaw read as a one-frame spin of hundreds of rad/s and flung cars parked on her deck into the wing wall (test/ferry-mooring.mjs pins it).
- Driving off: cars back off her stern down the ramp and the linkspan (terminal.spec.js "Driving off", crossing.spec.js at Joey Island). The ramp is 10 m wide on a 13.2 m deck, so a car parked hard over to one side has to swing its tail across while backing.
- Departures board: top centre, dropping below the driving key hints while they show.
- Joey's ground cover: the grass mask (`Scatter.js` `buildGrassMask`) holds rows for the main island (z -950..0) and for Joey over its outline's z extent, with the same density rules; GrassField's distance culling decides what draws. `test/joey-grass.mjs`: meadow on 47.8 % of Joey's open land (0.0 % before), none on its built sites, its road or the strait.
- Review views (`src/core/DebugViews.js`, placed from `WORLD.joeyTerminal`): `joeyAir`, `joeyLowSun`, `joeyStrait` (from a deck about 650 m out), `joeyMeadow`, `joeySouth` (over Joey to the terrain's south edge).
- Minimap: the bake covers 1800 m (the island, the strait and Joey Island).
- Known gaps: Joey Island to Tidewater has only been timed in the sim (227 s); the helm has no key for the stern thruster (autopilot only).

## Other people on the service

`src/ferry/Traffic.js` and `src/ferry/Crowd.js` (created and updated by `Ferry`, after `berthing()`;
`ferry.peopleMs` is their smoothed CPU time) keep the terminals and her decks from being empty.

`test/browser/crowd.spec.js`: at Tidewater on the short timetable, cars queue, drive aboard and park
in her outer lanes (asserted in her frame) and foot passengers walk over the gangway into her and
sit; with the service off, the player walks up to the queue at the gangway gate and a passenger
turns, waves or nods, then talks or points. Captures `crowd-terminal.png`, `crowd-cardeck.png`,
`crowd-saloon.png`, `crowd-greeting.png`.
