# People: the townsfolk brain

The subsequent [physics performance recovery](physics-performance.md) records the current solver optimization, matched timings and remaining smooth-play failure. Earlier measurements below remain historical evidence.

People notice you and react: heads turn, they wave or nod, and now and then they say something in a speech bubble. Beach and ferry owners control ordinary activities. Contact and disaster loads can release a person to articulated physics, followed by a supported recovery or swimming.

## Design: solid trunks, cars and room between people

What the player saw (12 November 2026, measured in the running game before this change, through the player's own keys): he walked straight through palm trunks (his centre came 0.04 m from a 0.19 m palm's axis), through a queued car (152 of 189 frames inside a sedan's body) and through a car parked on her deck (132 of 170 frames inside it). In 54 s of the terminal crowd at loading, 1,196 of 3,251 frames had two upright people overlapping by more than 5 cm, 1,623 had a passenger walking inside a terminal solid (the hall door and the stair tower, up to 1.85 m deep at Joey's), 2,677 had someone inside her deck boxes (her wing stairs, her rail) and 343 had a driver inside a parked car's body. A sprinting walker broke a fence panel a passing car had woken. The beach walkers were clean apart from a shell hunter brushing a rock.

- **Reference.** A person's body is a capsule of radius 0.27 m (Contact.js `BODY_R`; shoulder breadth about 0.45 m, chest depth about 0.3 m: Fruin, *Pedestrian Planning and Design*, 1971, body ellipse 0.46 x 0.61 m with clothing). People queue at about 0.45 to 0.5 m a person and walk at 1.2 to 1.5 m/s (Fruin; Knoblauch et al. 1996). Two people pass on a footpath with their centres about 0.7 m apart, each stepping about a third of a metre aside; in Australia they keep left. A driver crawling through a terminal at 2 to 4 m/s stops for anyone in the car's way: reaction about 0.75 s (declared, inside Green 2000's 0.7 to 1.5 s), braking 4 m/s² (Traffic.js's own easing), so 3 to 6 m from a person. Car bodies are the drawn models' own extents (parked_cars.glb: 2.25 to 2.44 m across the mirrors, 4.4 to 5.5 m long).
- **Real outcome.** Nobody's centre comes within a body radius of a trunk's bark or a car's body; no two upright people overlap by more than 5 cm; a car never moves within its own half width plus a body radius of a person ahead of it; a queue closes up to a person's depth and stops; a fence stops a person at any speed and only a car breaks it.
- **Source of truth.** Trunks: `WorldPhysics.trunkCylinders`, the one flat set the car physics takes, handed to `Colliders.setTrunks` by `RallyDrive.refreshIslandColliders` (at load, when a disaster fells or uproots a tree, and on restore). They live in their own 4 m grid, not in `Colliders.cylinders`, because the car physics, clinging, the wake and the livestock read that list and get the trunks separately: in both, each trunk would be met twice. Cars: each traffic car's walker box is its drawn model's bounding box, posed every frame where the car is drawn (the walking world, `Colliders`, ashore; her deck boxes in her frame aboard, which is what the ferry walker reads). People: the hub's `Grid` of everyone's feet.
- **Budget.** CPU only, no draws. Walker against trunks: one grid lookup of at most four cells per substep. Traffic: one box pose per car per frame (about 20 cars) plus, per moving car, its road sampled every 0.5 m to its stopping point against the people within reach. Room: per walking person one grid query within 3.5 m and a dot product per neighbour (about 30 walkers and 10 neighbours each). Measured in Perf below.
- **Detail by distance.** Everything here runs for every person and car that moves, at every distance: a route cannot be walked through a wall only where nobody looks.
- **Controls.** None new. The walker meets these things through W A S D and Shift as before.
- **Transitions.** A side step eases at 0.7 m/s and back to the route's line when the way is clear, so nobody snaps sideways. A follower eases its pace over the last 0.5 m before a person's depth behind whoever is ahead. A car brakes at its usual 4 m/s² and pulls away at 1.5 m/s². A walker whose next step (0.6 m ahead) is in the road a moving car will drive in its next 2.5 s, or beside the body of one going by, waits at the kerb while it stands at least 0.15 m outside the band the car stops for, and crosses behind the car; a walker already inside that band walks on and the car waits for it, so the two can never wait for each other (`Crowd.js` `atKerb`). The gate queue closes up as its front pair boards: whoever is next in their file walks up 0.7 m into the free place, an arrival's claim moves up with the queue (its last leg runs up its own file, so it only lengthens), and only someone standing in their place boards (`Crowd.closeUp`, `Crowd.boarder`).
- **Edges.** A face-to-face meeting in a corridor too narrow to pass (her 1 m side corridor) would hold both walkers for good: after 2.5 s the walker squeezes past at half pace, so the gangway never deadlocks and she still sails on time. A person standing in a boarding car's road holds it as the player's car does: after `STUCK` s it gives way and backs out. The fence break is a decision on the car, not on whatever touched the panel fastest.
- **Evidence plan.** Node: `test/walker-solids.mjs` (the real Player at real palms and the shipped car models, felled trees leave, the car physics' cylinder list unchanged, a boarding car waits for a person in its road and not for one beside it, the fence), `test/walker-routes.mjs` (every authored route on the terminal, her decks and the beach keeps 0.27 m from every solid, trunk and parking slot), `test/walker-room.mjs` (followers keep a person's depth, oncoming walkers pass, nobody deadlocks), `test/walker-queue.mjs` (the gate queue closes up in its files and only someone standing in their place boards), `test/walker-kerb.mjs` (a walker waits at the kerb and the car drives on; a walker in the lane walks on and the car waits; neither waits for ever), and in `test/walker-routes.mjs` the leavers keep 0.6 m from every place in the gate queue. Browser: `test/browser/gameplay-people.spec.js`, through the real keys: a palm stops the player; a queued car stops the player and a car coming aboard waits for a person in its road; the terminal crowd at loading shows no two upright people overlapping.

### Evidence: solid trunks, cars and room

What failed without the change, and the same check after it:

| Check | Before (red) | After (green) |
| --- | --- | --- |
| `test/walker-solids.mjs`: the real Player sprinting at real palms and the shipped car models | through the trunk and inside the car bodies | stopped at the bark and the body |
| `test/walker-routes.mjs`: every authored route on foot | up to 1.83 m inside a terminal solid, 0.99 m into her deck, 1.55 m into the beach's wreck | 0.27 m clear everywhere; the way in through the stair tower's door, 0.46 m into its 1.1 m header, passes under it since the terminal was rebuilt with a 2.1 m door (`tools/ferry/terminal_build.py` DOOR_H) |
| `test/walker-routes.mjs`: the leavers pass the gate queue | 0.35 m from a person waiting (run on the earlier routes) | 0.6 m or more |
| `test/walker-room.mjs`: followers, oncoming walkers, a shared end, the player, a shared corner | 0.00 m centre to centre with no room given; 0.43 m at her port door's corner | a person's depth; keep left; no deadlock on her wing stair |
| `test/walker-queue.mjs`: the gate queue closes up | nobody moved up a place (closeUp emptied); a walker still moving up boarded first (the standing check removed) | everyone moves up their own file; only someone standing in their place boards |
| `test/walker-kerb.mjs`: a walker and a car coming aboard | the car slowed to 0.00 to 0.33 m/s for a walker who could have waited (no kerb); the walker 0.13 to 0.33 m inside the body of a car going by (no check beside the body); a stop-go crawl of 2.9 to 3.4 s when a walker inside the band waited | the car drives on at its pace, the walker crosses behind it; a walker in the lane walks on and the car waits |
| `test/browser/gameplay-people.spec.js`, the terminal crowd for 80 s of the service | 284 of 3,040 frames with two people overlapping, 2,706 with someone inside a solid (the routes and room of the earlier change) | 0 and 0 in 3,262 frames, the stair tower's door included (before the door was raised, 106 to 220 frames had someone in its header) |

Measured in the running game through the probe the earlier change used (every upright person each frame, `?ferryTimetable=short`, 12 November 2026): before, in 54 s of the terminal at loading, 1,196 of 3,251 frames had two people overlapping by more than 5 cm, 1,623 had someone inside a terminal solid, 2,677 inside her deck boxes and 343 inside a car. After, in 77 s: no overlapping pair, no one inside a car or a trunk; every frame with someone inside a terminal solid (105) was a foot passenger going through the stair tower's 1.1 m door, since raised to 2.1 m, and every frame inside her deck boxes (272) is a passenger sidling along a row of seats to theirs, chest first, within 0.23 m of the seats (the routes hold that leg to half a chest's depth, 0.15 m). At the beach in 32 s: no overlapping pair, no beach walker inside a solid.

Still to do: the stern corner of her sun deck's rail (the player stops at her collider boxes, which square off the curved rail, so the drawn rail passes through his legs), and a car held by someone standing in its road creeps up in short stops to about 2 m short of them, because its look ahead shrinks with its speed and is sampled every 0.5 m (`Traffic.personInWay`).

### Perf: solid trunks, cars and room

CPU only; no draws, passes or GPU work were added. Measured by the probe over 20 s of the terminal at loading with the free camera on the walkway (`ferry.peopleMs` for the traffic and crowd update, `people.state().cpu.ms` for the hub):

| | Traffic and crowd (ms per frame) | People hub (ms per frame) | Frame (ms) |
| --- | --- | --- | --- |
| Before (no room, no kerb, cars not solid) | 0.259 | 0.340 | 20.7 |
| After (15 people, 14 cars) | 0.319 | 0.378 | 26.6 |

The added cost is about 0.06 ms in the traffic and crowd update (each car's road against the people near it, each walker's room and kerb) and 0.04 ms in the hub. The frame time is not comparable between the two runs: the after run shared the machine with other work.

## Files

| File | What it holds |
| --- | --- |
| `src/people/People.js` | The hub, `app.people`. The registry, the grid and bus, the smart objects, the bubbles, detail by distance, event polling, the CPU meter, `state()`. |
| `src/people/Brain.js` | One brain per person. Archetypes, moods, memory of the player, the utility decider, `REACT` (how each event is taken). |
| `src/people/Perception.js` | `Grid` (spatial hash, 8 m cells) and `Bus` (events to everyone in range, plus subscribers). |
| `src/people/SmartObjects.js` | `ACTIVITIES` (the activity table), `SmartObject` (slots, neighbours) and `SmartObjects` (claim, release, mateOf). |
| `src/people/Speech.js` | The DOM bubbles. They use `.tw-glass` and the ui.css tokens. |
| `src/people/Lines.js` | The lines table, by context and archetype. |
| `src/people/Pose.js` | Head look (yaw down the spine, neck and head; pitch at the neck and head) and the seated tuck (knees aside, chest leaning away). It runs on top of the clip. |
| `src/people/Contact.js` | Bumps (`app.people.contact`): the player's walker and the rally car against people, the knock timelines (nudge, stagger, tumble, fall, flinch, jump, dive), overboard and the swimmer, held things and fetching them. |
| `src/people/Tumble.js` | A townsperson's 14-capsule, 13-joint ragdoll. Capsule sizes use the parent-transformed neutral pelvis height; recovery/swimming clips are retargeted by bone name. Capacity 64, enough for 26 beach and 32 ferry people; adaptive steps with a normal free-flight interval at most 1/120 s. |
| `src/people/ArticulatedContacts.js` | Capsule contacts with rotated inertia and equal/opposite impulses. The rig solves self contacts inside its substeps; the hub resolves neighboring rigs and the player after owners advance. |
| `src/player/Ragdoll.js` | Shared player/NPC articulated integration, geometric repair, contact, recovery and explicit protection ledgers. |
| `src/player/ArticulatedMass.js` | O(n) connected mass/viscosity response, shared by the base step and contact impulses. |
| `src/player/JointVelocity.js` | Actual joint-coordinate gradients and accumulated unilateral limit/contact responses. |
| `src/people/Props.js` | Things people carry in the left hand (coffee, phone, book, esky, bag, rod, chips), the drop arc and bounce, a coffee stain. |
| `src/ferry/Crowd.js` | The ferry crowd, the first owner. It keeps its bodies, routes, queues, boarding, drivers and `holding()`. |

## How it fits

The owner (Crowd.js) moves bodies and plays clips. The brain decides and never touches the body. Each frame the owner keeps these fields on each person: `world`, `yaw`, `posture` (`sit`, `stand` or `walk`), `head` (eye height) and `can( clipKey )`. It reads these from the brain:

- `target` and `lookUntil`: where the head looks. This is a live Vector3: the player's head, the bird, a neighbour's head, the horn.
- `engagedUntil`: a standing person turns their body to the target too.
- `gesture`: `{ clip, greet }`, a one-shot clip key. The owner plays it and clears it. Seated people never get a standing gesture.
- `activity`: `{ name, clip, pitch }`, the looping clip key, plus a head bow for phone, book and doze.
- `tuck` and `away`: seated, knees swung aside, away from the player.

`App.js` creates the hub before the ferry and calls `people.update( dt )` after the cockatoo.

## The brain

- **Archetypes** (`ARCHETYPES`): friendly, grumpy, shy, larrikin, kid, elderly. Their traits are warmth, chat, bold, patience, energy, curiosity, humour and wave. `weight` sets how common each one is. Kids have weight 0 until there are child avatars (the beach lane).
- **Moods**: energy, sociability, curiosity, patience and annoyance. They start from the traits plus some noise. Energy runs down and dozing restores it. Annoyance decays faster in patient people.
- **Memory of the player**: `friendly` (you stayed for their chat), `ignored` (they spoke and you walked straight off), `annoyed` (squeezing past an impatient person, or twice within a minute), `bumped` (hook: `brain.bump( t, strength )`). Two ignores and they stop talking to you. A friendly memory makes them greet you with `greet-again`.
- **Thinking**: the hub runs `think()` at 2 to 5 Hz within 25 m, with staggered times. Each think does three things. First it senses the player directly: close by and looking at them, or squeezing past their seat. Then it takes the most telling event from its inbox (salience × curiosity, plus noise; a dozer cares less). Finally, when the activity's hold runs out, it re-chooses. The decider scores every activity the slot offers, adds noise and a small penalty for repeating, and takes the best one.
- **Greeting** (kept from the old Crowd.js behaviour, which `test/browser/crowd.spec.js` checks): the first time they are close and looked at, a standing person waves or nods, and maybe says a line. If you stay (2.5 s, or 4 s for the shy), they talk with their hands or point. Then there is a 15 s cool-down, and 8 s after you leave.

## Events

`app.people.bus.emit( type, at, radius, data )` delivers an event to everyone within `radius`, scaled by their hearing (elderly 0.7). People beyond 80 m get nothing. `bus.on( type | '*', fn )` sees every event.

| Event | Source (polled at 5 Hz in `People.sense`) | Radius |
| --- | --- | --- |
| `horn` | `ferry.horns` changes. The source is 14 m up her mast. | 600 m |
| `bird-near`, `bird-landed` | The cockatoo is `flying` or `resting`. Under a roof he stays on the shoulder (Cockatoo.js), so nothing is sent. | 7 m |
| `player-run` | The player's ground speed is over 4 m/s. Aboard it is measured in her frame. A move of a metre in one frame is a teleport, not a run. | 9 m |
| `jetski` | A ski in `app.jetskis.skis` doing over 4 m/s. | 30 m |
| `car` | The player's rally car doing over 8 km/h. | 8 m |

Some things are sensed directly, not sent on the bus: the player close and looking (3 m, and the camera within `SEEN` 0.8 of them), and the player within 1.9 m of a seated person (`People.close`, every frame). The squeeze line needs the player to be moving.

How each event is taken lives in `REACT` in Brain.js: salience, how long the head follows it, the line context, the base chance of speaking, standing gestures, and annoyance. A reaction holds their eye (`reactUntil`) even while you stand in front of them.

## Smart objects and activities

A `SmartObject` has a `kind`, a `tag` and `slots` (each with `mates`, the neighbouring slot indices). People `claim` a slot and `release` it when they leave. The brain chooses between the `ACTIVITIES` whose `at` includes the slot's kind.

| Kind | Where (Crowd.js) | Activities |
| --- | --- | --- |
| `seat` | Her saloon: benches of two, 12 per side | sit, sitLook, phone, read, doze, yawn, sitChat (needs a neighbour) |
| `queue` | The gangway gate at each terminal: 12 spots in pairs | wait, lookAround, phoneCall, talk / listen / laugh / shrug (need a neighbour) |
| `rail` | Her sun deck rail, per side | lookOut, wait, lookAround, phoneCall, and the chat set with the next place along |
| `spot` | Hook: standing chat spots (the beach lane) | the standing set |

Chats need turn-taking: `talk` scores low when the mate is talking, and `listen` scores high. People in a chat look at their mate's head.

**Adding an activity**: add a row to `ACTIVITIES` (`at`, `clip` key, `hold`, optional `pitch` and `mate`, and `score( brain, mate )`). If it needs a new clip, add its key to `CLIP` in the owner and to `STATIC` in `tools/characters/build_crowd.sh`. Rebuild, then run `crowd_keys.mjs`. Sitting clip keys also go in Crowd.js `SITTING`.

**Adding a smart object**: `app.people.objects.add( new SmartObject( { kind, tag, slots: [ { ...your data, mates: [ ... ] } ] } ) )`. Claim with `objects.claim( kind, filter, person )`. The owner keeps the positions; the object only knows its slots and who is in them.

## Lines and bubbles

`Lines.js` has these contexts: `greet`, `greet-again`, `chat`, `squeeze`, `squeeze-again`, `bird-shoulder`, `bird`, `horn`, `jetski`, `running`, `car`. Each context has lines per archetype, and `any` as the fallback. `line()` avoids the person's last four lines.

## Detail by distance

The hub sets `p.lod` from the camera distance:

| Band | Brain | Animation (owner) | Events |
| --- | --- | --- | --- |
| near, under 25 m | 2 to 5 Hz, staggered | every frame (every other frame when still; a third of the frames if behind the camera) | yes |
| mid, 25 to 80 m | 1 Hz | every third frame | yes |
| far, over 80 m | none (inbox cleared) | frozen; hidden past 90 m | no |

`app.people.state().cpu` gives `ms` (the average per frame: the hub plus what owners `charge()`, which for Crowd.update means routes, animation and pose), `peak` (the last 2 s) and `hub` (the hub alone).

## Bumps (step 2)

## Articulated reactions and moving support

The player totals 75 kg; an adult NPC totals 72 kg and an instantiated child rig 35 kg. Fourteen capsules and 13 limited joints form a reduced articulated body, not deformable tissue. Capsule dimensions use the neutral skeleton height after composing its ancestor transforms in metres. Reading only a pelvis animation's local translation was incorrect for the shipped crowd armatures and could create nearly zero-sized capsules with extreme inverse inertia. The population capacity is 64 articulated rigs; the complete authored beach/ferry population is 58. Missing rigs or future overflow remain an explicitly counted physical-capsule/animation fallback.

An inherited-velocity handoff adds no random spin or limb kicks. A real contact supplies torque through its actual point and normal. The connected velocity solve uses `H = M + h c DᵀD`, where `D` measures child-minus-parent angular velocity and the assumed joint viscosity `c` is 1 N·m·s/rad. An O(n) articulated-tree factor retains both anchor constraints and this viscosity coupling. The base momentum step, contact impulses and unilateral joint limits use that same factor. Friction uses physical accumulated normal impulse, not the geometric repair amount. Dense-reference equivalence, momentum and complete fixed-pose energy checks are retained in `test/articulated-mass.mjs`.

Overlap repair is separate from velocity, so a geometric correction does not become a limb launch. Actual joint-coordinate gradients constrain orientation, and a fixed-rotation anchor projection preserves centre of mass and immediate kinetic energy. Geometric orientation changes can still change inertia and energy; centre repair can change orbital angular momentum. These are numerical stabilization errors, not an exact whole-step conservation claim. Adjacent capsules within two joints are excluded from self contact because they overlap by construction. Neighboring rigs use point impulses and a bounded whole-rig translation after owners advance, preserving internal anchors. This contact pass is separate from the articulated substeps; it is not a simultaneous solve of all touching rigs or arbitrary skinned-mesh collision.

The normal free-flight interval is at most 1/120 s. After each solved impact, subsequent intervals adapt to keep integrated rotation at most 0.1 rad and measured near-contact sample travel at most 0.15 capsule radius relative to support. Force trials restart from the same unforced state when refinement is needed. Physical advance and geometric repair have separate telemetry. A maximum of 192 pieces per accepted frame bounds cost; exhausting that budget invokes explicit support-relative velocity scaling. The solver records each intervention, removed translational and rotational kinetic energy, world energy change and kinematic support work. A person already co-moving with a ferry stays co-moving. High-speed observations are not speed clamps, and the recorded emergency approximation must not be confused with accurate extreme-impact dynamics.

Recovery requires actual support or surface flotation, low complete translational and rotational energy relative to that support, maximum relative segment spin below the assumed 1.5 rad/s threshold, and one second of repose. There is no elapsed-time recovery while falling. The final get-up is a keyed animation after physical rest. Settled rigs leave the active solver; distant active rigs retain their joints.

`People.update` synchronizes worn props through `Beach.wearAt` immediately after `Tumbles.collide` performs the final corrected rig draw. Hats and glasses therefore use the current Head transform during physical fall, prone rest, get-up and ordinary standing. The retained actual-sprint UI proof contains 292 observations, zero emergency interventions and maximum attachment matrix-element error 3.97118×10⁻⁷. Whole-video review also checks the visible attachment; a solver pass alone would not detect a floating hat.

Ferry support uses the actual tilted deck boxes, bounds and furniture. Ship point velocity includes measured translation, heave, pitch, roll and yaw. A player or rig carries that velocity when leaving support. The ferry publishes gangway availability before advancing passengers: a route waits when its endpoints disconnect, and a person already crossing without remaining real support enters physical motion. Recovery anchors the reached deck or shore and discards a stale route across water.

The player's finite walking motor applies shared environmental acceleration afterward. An assumed stance threshold of 3.2 m/s² lateral acceleration or an 18 m/s updraft releases locomotion to the same physical rig. These are gameplay loss-of-control rules, not validated human biomechanics. Swimmers retain bounded propulsion and current-relative drag. Surface following integrates bounded vertical acceleration rather than copying a distant crest height; extreme crest/updraft conditions can release the player to the rig.

Walking sweeps each accepted displacement through contact queries at intervals no larger than 1/60 s or 0.15 m. Input edges, propulsion, environmental force, gravity, carrier transport and sound still belong to the accepted frame once. Supported descending steps can recontact a floor within 0.4 m while vertical motion relative to support is nonpositive. An intentional jump or unsupported ledge retains airborne motion and the physical fall response. `test/walker-cadence.mjs` exercises the complete 3,287-point summit route with actual village, road and stair collision geometry, a real player rig, multiple frame cadences and the recorded failing descent.

Swimmers query registered physical obstacles with their actual feet and a reduced upright capsule. The visible swimming head extends ahead of that capsule, so the actual posed head receives a separate finite contact pass after `Avatar.update`. Its measured sphere uses authored head geometry; the physical player, whole displayed avatar and placement history receive the same correction. The glider supplies actual cloth/frame triangles, live pose and point velocity. Contact removes inward relative velocity without adding water or gravity forces. This remains a one-way kinematic wreck response, not a two-way glider/human momentum solver. Camera obstruction has a separate interface. `test/player-swim-head.mjs` checks the real Player/Avatar boundary, sustained contact, distant-water invariance, and clearing prior sweep history during Restore and same-mode activity handoffs; `test/player-flood.mjs` retains the water/current controls.

Ordinary physical proof includes 144 actual animated contacts across eight crowd casts, three clips, three clip times and both 1/60 s and 0.1 s cadence. They require zero emergency interventions, connected anchors, transient joint-coordinate error below 5°, bounded complete energy and natural recovery. A separate eight-person fixture records 160 inter-person contacts and completes all get-ups with zero interventions; its maximum frame-split overlap is 0.069 m. Maintained tests are `test/articulated-contact.mjs`, `test/articulated-solver.mjs`, `test/articulated-mass.mjs`, `test/articulated-neighbors.mjs` and the existing `test/gameplay-people.mjs`. The normal simulation runner includes them. Actual-input vortex, sprint-contact and separated-gangway scenarios are in `test/browser/gameplay-people.spec.js`.

`node test/people-budget.mjs` measures 58 actual crowd variants, 812 capsules and 754 joints with skeleton pose work and upload-copy transport. On Apple M5 Max / Node 22.14.0, the final three-second 120 m/s vortex workload averaged 13.28 ms per 1/60 s frame (p95 18.52 ms) after 30 warm-up frames, with zero emergency interventions or nonfinite states. Separate ordinary 3 m/s falls complete all 58 get-ups within 4.367 s; the inactive contact manager averages 0.000231 ms afterward. The active fixture has no inter-person contacts and excludes rendering, scene walls and normal animation/AI outside physical rigs. It is a bounded CPU fixture, not an FPS claim or a representative prolonged full-scene stress result.

The full-scene stress captures show substantially worse cost and reduced fidelity. A retained 120 m/s vortex UI run advanced 13.1 simulation seconds and recorded maximum segment spin 93.2685 rad/s plus nine protective interventions removing 129,946.54 J; the video remains visibly choppy. The latest 3,000 m wave capture advanced 13.0332 simulation seconds with 45 loaded people and at most 26 simultaneously physical. It recorded 1,285 interventions removing 306,910,367.67 J and maximum segment spin 275.5467 rad/s. The recording averaged only 1.073 engine frames/s (185 frames over 172.38 wall seconds).

That 3,000 m run recorded zero nonfinite states, omitted accepted simulation time or physical-advance bound violations. Those checks establish bounded execution, not real-time performance or faithful extreme trajectories. The protected velocity reductions materially alter motion, and consuming each accepted simulation interval does not mean keeping pace with wall time. Severe stress therefore remains limited in both performance and physical accuracy; the ordinary-contact and sparse CPU proofs must not be presented as resolving those limits.

## Hooks for the next lanes

- **After a bump**: a shy or elderly person sitting on a nearby bench after a fall needs bench smart objects ashore (the beach lane). Ordinary upright NPC avoidance remains authored. Active articulated NPCs now collide through their actual capsule segments; dropped hand props still use their authored arcs.
- **Beach population**: a new owner registers people with `app.people.add( p, { archetype } )`, keeps `world`, `yaw`, `posture` and `head` current, and adds `spot` and bench smart objects. Kids need child avatars and `weight` > 0.
- **E to chat**: the brain's memory (`friendly`, `ignored`, `annoyed`) and its mood give the opening line. Use the `chat` context and `bus.on`.
- **Life moments** (for example "oh no, I missed the ferry"): subscribe with `bus.on( 'horn', ... )` or read the ferry service's phase, set an activity or gesture, and `hub.say()` a new context.

## Forks and known gaps

- Drivers' `path` and `out` are still one array, as before, so a driver vanishes from their seat at the far berth instead of walking back down (Crowd.js `spawnDriver`). This is kept on purpose; fixing it changes the service's timing.
- Perception has no sight lines: a bird over the saloon roof is "near" people inside.

## The beach (step 3)

- **Owner**: `src/people/Beach.js` (`app.beach`), created in `App.js` after the hire stand and updated before `people.update`. 26 people: five camps (towels, sand, umbrellas, eskies), beach cricket (bowler, batter, keeper, fielder; the ball is scripted), a frisbee pair east of the pier, two shell hunters on the tideline, three swimmers treading water past 1.45 m, two waders, two fishers on the pier head (clothed, rods), and the hire attendant (teal-shirt m01, stool, phone, clipboard; clothed m04 is an asset fallback).
- **Slot kinds**: `camp` (the slot's `kind` is towel, reader, phoner or sand; `sunbake`, `campRead`, `campPhone` score by it), `swim` (`tread`), `wade`, `line` (`fish`), `stool`, and `cricket` / `frisbee` / `shells` (`play`, the owner scripts the body).
- **Bodies**: `public/models/characters/crowd/swim/<cast>.glb` (`tools/characters/crowd_swim.py`, Blender python) where built, else the clothed crowd. Lying is the idle clip on a tilt group turned -90 degrees about x; sitting on the sand is the chair clip lowered 0.42 m with the knees up (Pose.js knock `legs`); treading is the idle clip 1.38 m down.
- **Detail**: still people (lying, sitting, the stool, treading) animate a third of the frames near and a sixth mid. Measured with 46 people (ferry crowd plus beach) on the beach: 0.64 to 0.69 ms average, 1.1 ms peak.
- **Occluder fade**: `ThirdPersonCamera.apply` calls `app.people.occlude( lens, head )`; people across that line fade to 0.85 on interleaved gradient noise shifted every frame (`frame.frameIndex`), which the TAA resolves into a smooth see-through; the old 4 x 4 Bayer read as a coarse checkerboard (`src/people/Fade.js`, every crowd and beach material is alpha-tested with a `fade` uniform). The boom no longer needs to pull in for people.
- **Jetski hire**: `HireDesk` in `src/world/JetskiHire.js` wraps `app.jetskis.offer` (Jetski.js untouched). Unpaid, at the counter or a beach ski, E is "Hire a jetski · $20" (`game.state.spend`); broke, a line and no charge. Paid: the safety line, he walks out and pushes, "Ride jetski" returns. Stepped off near the stand after a ride: he walks out, ties it up, the hire ends. `?freeHire` skips the fee.
- **Cocky on people**: `Beach.cocky()` rarely (8% a second while he explores near sunbakers or sitters) sets `cockatoo.spot` and calls `cockatoo.startLanding( 'spot' )`. The person laughs and takes a photo, shoos him, or (a larrikin) offers a chip. `app.forceCocky = true` forces it for checks.
- **Gotcha**: `SkinnedModel.play( name )` hands back the live layer when that clip is already current, even if it has ended, so a one-shot gesture replayed never ends again and a walker waiting for it stalls. Use `Beach.gest()` (restarts the layer and keeps a timer).

## The jetski hire stand and its attendant (Beach.js, src/world/JetskiHire.js)

- The stand (`tools/jetski/hire_build.py` -> `public/models/jetski-hire.glb`) is weathered timber: gapped boards in
  mixed greys and browns with rusty nail heads. Its counter is the east end (stand frame +x), facing the path down
  from the village, with a painted "JETSKI HIRE / $20 A RIDE" sign, a key board with keys on floats (one hook
  empty), a cash tin, a brochure stand, a leaflet and a clipboard. The top sign faces east and west (lettered both
  sides); the A-frame by the path says $20, the same as `HIRE_FEE`. Four life jackets (collar, foam blocks,
  three buckled straps, side straps, reflective tape, a hanger each) hang on a rail along the back; the back is
  open east of them, the attendant's way in and out. The dolly lies off the west end. The awning slopes down to
  the sea with the valance on its low edge.
- The attendant sits on a supported stool behind the stand (`Beach.layout`), facing +x with a clear capsule exit.
  The complete stand collision envelope remains solid; the person and stool no longer spawn inside it. `HireDesk.counter` is the east side of the counter;
  `AROUND` takes him out the back and round the west end, so he never walks through a customer at the counter.
  `Beach.floor()` keeps walkers on the deck inside the stand's footprint.
- His body is `public/models/beach/attendant.glb` (`tools/beach/staff_shirt.py`): the swim crowd's m01 with the
  white tee dyed the hire's teal, the fold shading kept. Missing, the clothed m04 stands in.
- Worn props (`Beach.wear`, `WEAR`): sunnies, `sun_hat` and `bucket_hat` ride the `Bip01 Head` bone. The offset
  is solved once against the rest pose. `People.update` reapplies the current head transform after final
  articulated contact/draw, including fall and get-up; worn props share the person's fade. The crown sits
  0.232 m (men) or 0.217 m (women) above the head bone's rest origin.
- The reader at the x = 29 camp has put her book down: the `book` GLB lies open on the sand beside her
  (`bookDown`), so she holds nothing.

- Bodies: `Beach.plan()` runs once after `layout()` and promises each crowd slot a cast (three bodies a cast) that no slot within `NEIGHBOUR` (6 m) already has; `fill()` places a body only in a slot promised its cast, so the casts can load in any order without twins side by side. `fill( true )` after the last cast takes whatever is left, still preferring a body no neighbour wears.
- Speech bubbles fade in over 90 ms (readable at once) and out over 220 ms, with a soft text shadow for bright sand behind the glass.
- See-through people (Fade.js) verified in game: `people.occlude( a, b )` with a line through a standing person eases their fade to 0.85 in about 0.3 s and the dither shows. A prop held in the hand (the batter's bat) does not fade with its holder yet.

## Bubbles, sitters, fades and the tin (people-fix round)

- **Bubbles keep clear of the HUD** (Speech.js `place`). Every visible `.tw-glass` box (the minimap `gm-map`, the icon rail `tw-rail`, the purse `gm-purse`, the prompts and keys `tw-prompt`) is read from the DOM twice a second and on each new bubble; boxes over 30% of the screen (menus) are skipped. A bubble whose head sits under a panel is hidden; one that would overlap a panel moves the smallest way clear (left, right or up, 8 px gap, at most 150 px) and its tail (`--pp-tail`) still points at the head. The top pills are not `.tw-glass`: the `TOP` clamp (110 px) keeps bubbles under them.
- **Sand sitters sit on the sand** (Beach.js `seat`). The chair-sit clips hold the pelvis at chair height, and a fixed 0.42 m drop left the casts with higher hips (the women, about 0.19 m pelvis bone to sand) sitting on air. The drop now puts the pelvis bone `SAND.seat` (0.15 m) above the floor sampled under the pelvis itself, from last frame's pose; mid-blend or with no pelvis bone the fixed drop stands. Clamped to 0.3 to 0.6 m.
- **What people wear or hold fades with them** (Fade.js `setGroupFade`, `fadeCustomize`). The hats, sunnies and bat load with the fade uniform (Beach.js `FADES`), the hand props (Props.js) build with it, and People.js fades `p.item`, `p.bat` and `p.wear` in its fade loop. The first fade gives each mesh its own material copy (the sources are shared); a part without the uniform (a stand-in) hides past 0.3 instead. Worn things are no longer hidden outright.
- **Occluders against a high chase camera** (People.js `occlude`). The test now takes the band between the sight lines to the player's head and to their chest (0.8 m lower), so someone hiding the player's body fades even when the lens looks down past their head. Proved through the real third-person camera: the batter between lens and player fades to 0.85, bat included.
- **The cash tin's key ring** (tools/jetski/hire_build.py `torus`) is one smooth torus (24 x 10, 9.5 mm, 1.4 mm wire). A chain of 4-sided tube segments broke into dashes at that size. The build also rewrites public/models/jetski-buoys.glb (not byte-stable); restore it when only the stand changed.
