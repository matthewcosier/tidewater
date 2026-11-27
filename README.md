# Tidewater

**[Play Tidewater in your browser](https://matthewcosier.github.io/tidewater/)** with a WebGPU-capable browser. The hosted island supports solo play, including both GT3 RS cars. Shared driving and Mac-rendered phone play are available when you run the local server.

This fork includes the playable island expansion, the drivable COSIER GT3 RS and [Mac-rendered LAN play](docs/lan-play.md). The [experimental builds](docs/experimental-builds.md) preserve earlier disaster, crowd and performance work.

An open-world two-island holiday sandbox for the browser. You have just landed for your getaway and can do
anything you like: drive cars across 9.4 km of coastal highways, mountain switchbacks and a 637 m suspension
bridge, ride rocket jetskis across the bay, fly a jet off the offshore carrier, hang glide off the volcano,
take the mountain chairlift, helm the car ferry, stir up a storm, swim the coral reef, or cast a line for
fish off the pier and sell your catch in the village. It runs directly on WebGPU and WGSL with its own small
rendering engine, no framework.

To play this branch locally, run `npm ci` followed by `npm run dev`. The [original Tidewater demo](https://dgreenheck.github.io/tidewater/) is hosted by the upstream project.

![Fishing off the pier at golden hour](docs/screenshot.jpg)

![The beach in the late afternoon](docs/screenshot-beach.jpg)

## Requirements

- A browser with WebGPU: a recent Chrome, Edge or Safari.
- A capable GPU. It targets 60 fps at 2560×1267 on an Apple M5 Pro, and dynamic resolution scales
  the render down on slower machines.
- The first load compiles several hundred shaders, which can take a minute or more. Later visits are
  faster because the browser caches them.

## Features

**Fishing**
- A spinning rod and reel that cast, reel and bend under load, with the bail, rotor and crank animated.
- Bites that depend on the water (shallows, pier, reef, bay, deep water), depth and time of day, across
  18 Caribbean species.
- A line-tension fight: keep the tension in the green band, ease off when the fish runs.
- A full-screen catch card with the fish's length and weight, a fish log with records, and a cooler.
- Joe's fish stand buys your catch; Marta's chandlery sells line, reels, rods, a bigger hold, fuel, a rebuilt
  engine, a fish finder and deck floodlights for night fishing.
- Walk the deck and the wheelhouse while the boat drifts; the boat burns fuel.
- A first-play guide, contextual tips and a minimap. Progress is saved in the browser.

**Ocean**
- Four-cascade FFT ocean (Tessendorf spectra) with foam, whitecaps, wind streaks and swell.
- Depth-aware breaking waves with peeling shoulders, whitewater, spray and foam lace.
- A shallow-water simulation for swash running up and down the sand.
- Boat wake and bow spray, and a whale wake.
- Caustics on the seabed and in the water, with light shafts.
- A split underwater/above-water view at the waterline, with water droplets on the lens after surfacing.
- Refraction of the seabed through the surface, including behind the pier and boats.

**Sky**
- Physically based atmosphere (Hillaire 2020) with a sun, moon and stars.
- Volumetric cumulus and wispy cirrus with cloud shadows on the land.
- Aerial perspective and sea haze.
- God rays, and a lens flare with occlusion.

**World**
- An island with a beach, hills, headlands and rocks.
- A fishing village, a pier, and the vendors' stalls built from Poly Haven scans.
- Realistic vendor characters (Microsoft Rocketbox) with skinned animation.
- A coral reef with fish.
- Palms, bananas, monstera, elephant ear, heliconia, bird of paradise, broadleaf trees, shrubs and dune
  grass, with impostors and dithered LOD fades.
- Beach debris.
- Birds, crabs and marine snow.
- A humpback whale with an escort of fish, blows, fluke dives and breaches.

**Lighting and post**
- Cascaded shadows with contact-hardening penumbrae, and screen-space contact shadows.
- Ground bounce light.
- GTAO ambient occlusion.
- Temporal upscaling and sharpening.
- Bloom, auto exposure and motion blur.
- Night lighting from lanterns, windows and the boat, plus a flashlight that also works underwater.

**Audio**
- Positional audio from real CC0 field recordings: surf timed to each breaking wave, wind, birds, the boat
  engine, footsteps by surface, underwater ambience, whale song, and the rod and reel (casts, the bail,
  reeling, the drag, line snaps, splashes).

## Controls

| Key | Action |
|---|---|
| Tap **Click to explore** or press Enter | Enter the island after shader warm-up. If iOS interrupted the last load, tap **Load island again** to retry. |
| W A S D | Move on foot. In a car, W accelerates, S brakes or reverses, and A/D steer. |
| Mouse | Look (click to capture the mouse, Esc to release) |
| Shift | Sprint / boat boost |
| Space | Jump / swim up / car handbrake |
| W + S | Hold both pedals near a standstill for a rear-drive burnout. Release S to launch. For a donut in either GT3, choose **Ferry terminal**, switch aids off with J, hold W + S and full steering, then release only S. |
| J | Toggle driving aids. Switch them off for deliberate power slides. |
| C | Crouch / dive |
| M | Open the **Activity Wheel** (hold and flick to pick, or tap to click / use `1`-`8` and arrow keys; `Esc` closes). Launches cars, highways, jetskis, boats, ferry, F/A-18 Hornet, hang glider, chairlift, weather/disasters, and landmarks. |
| W / S + Arrows + A / D (in F/A-18 Hornet) | W/S throttle (hold W on the catapult to launch), Arrows pitch and roll, A/D rudder, G landing gear, H arrestor hook, V flaps, B / Space wheel brake, C cockpit / chase view, R reset launch, E leave aircraft. |
| G | Recall your last ride on foot or in the water (in water: pulls the jetski alongside and climbs aboard; on land: delivers your car onto clear ground ahead). On a jetski: pick up/drop off mate. In the Kestrel: landing gear. |
| E | Interact: enter or leave any vehicle (car, jetski, fishing boat, ferry helm, carrier jet, hang glider, chairlift), trade with locals, use ATMs |
| V | Camera view (1st / 3rd person on foot or at the helm) |
| R | Within 8 s of a jetski wipeout or car yeet: quick re-mount; otherwise equip/stow the fishing rod on foot, or recover the car while driving |
| Left mouse | Hold to wind up, release to cast · strike when a fish takes the bait · hold to reel |
| Right mouse | Reel an empty line in |
| I | Cooler / fish hold and the fish log |
| `` ` `` (Backquote) | Toggle the quick car selector dock on foot |
| F | Free camera |
| L | Flashlight |
| T | Pause time (in a car: repair) |
| U | Mute |
| H | Settings panel |
| P | Photo mode |
| F1 or ? | All controls |

### Fishing

Walk the deck of the boat while it drifts, or fish from the pier and the beach. Cast, wait for the bobber
to dip and strike when it's pulled under, then play the fish: keep the line tension in the green band,
ease off when it runs. Different water holds different fish (the shallows, the pier, the reef, the bay and
deep water offshore), and some bite best at dawn, dusk or night. Sell your catch to Joe at the fish stand
on the beach by the pier, and spend it at Marta's chandlery by the boathouse: stronger line, a faster reel,
a longer rod, a bigger fish hold, a larger fuel tank, a rebuilt engine, a fish finder and deck floodlights for
night fishing. The boat burns diesel at the helm; fill up at the chandlery. Progress is saved in the browser.

The settings panel (H) exposes the sea state, time of day, sun azimuth, clouds, haze, post-processing and
more.

## URL options

Add these to the URL, for example `?fly&noAudio`:

| Option | Effect |
|---|---|
| `fly` | Start in the free camera |
| `noAudio` | Disable sound |
| `noClouds` | Skip the volumetric clouds |
| `noHaze` | Skip the haze and sun shafts |
| `noCaustics` | Skip caustics |
| `noVeg` | Skip vegetation |
| `noSim` | Skip the swash (shallow-water) simulation |

## Running locally

The compiled physics module and the largest new vehicle models are stored losslessly under `assets/distribution/`. `npm ci`, `npm run dev` and `npm run build` prepare the ordinary runtime files in `public/`. If installation scripts are disabled, run `npm run assets:prepare` before direct tests. Building the Rust module or rebuilding one of those models refreshes its distribution file. Game and server URLs stay the same.

### Driving

Pick a car in the lower-left card after entering the island, the **Aster RS** (a rear-drive
rally coupe), the **Ridgeback 4x4** (a lifted, Blender-built 4x4 with mud-terrain tyres and a
recorded HEMI V8), the **COSIER GT3 RS** (the white-and-red Blender car with its own seven-speed gearbox), the **GT3RS ZRY** (a second white-and-red GT3 RS model on the same physics, with clear glass and no plates), the **Petrel GT** (a GT3-style rear-drive coupe), or one of three Blender-built
hero cars: the **Fulmine V10** (a mid-engine wedge supercar), the **Corsaire W16** (a horseshoe-grille
hypercar) or the **Sandpiper 1600** (an open-tub beach buggy), and choose where to start: the beach, the coastal road, the town backroad,
the mountain summit, either beach entrance, West Headland cliffs, Suspension bridge, North Coast highway, High Mountain pass, Rainforest rally, Ferry road, either ferry terminal, Joey Island road, or Joey East peninsula. The Cedar wagon and Ridge pickup stay parked
near the village. All cars except the GT3RS ZRY carry custom number plates.

The road network spans 9.4 km across Tidewater Island and Joey Island, connected into one
continuous two-island loop by a 637 m suspension bridge across the ferry strait (427 m main span,
34.3 m mid-span soffit clearance so the `Tidewater Spirit` ferry sails cleanly underneath). A
graded coastal loop runs west of the village with textured asphalt, patched and crack-sealed seal,
painted lines, sandy verges, solid guide posts and steel guardrails. From it branch the 1.1 km
mountain circuit (climbing through switchbacks to a ridge and a 17 percent descent), the West
Headland cliff loop, the Grand Island Perimeter highway past the north coast and wind farm, the
High Mountain pass switchbacks, the East Headland coastal loop, the Ferry road, a loose-surface
Rainforest gravel rally stage, and Joey Island's ring road plus East Peninsula loop. Gravel
ramps lead from the loop down onto the beach.

The cars run on Tidewater's own physics, compiled to WebAssembly from Rust/Avian
([car physics](docs/rally-physics.md)):
- a slip-based tyre model per surface, so asphalt, gravel, soft and wet sand, grass and rock
  each feel different
- a 5-speed automatic, anti-roll bars, ABS, traction and stability control
- a handbrake for slides

Tyres leave tread impressions and ruts in sand, and rubber on asphalt only when they
slide. Drive into the sea and the car floats and rides the swell; wheels in the shallows
throw spray. Crashes dent the body and knock parts off, and hard enough ones damage the
engine, steering and wheels, through steam and smoke to fire. **T** repairs.

| Driving control | Keyboard | Gamepad |
|---|---|---|
| Throttle | W / Up | Right trigger |
| Brake, then reverse when stopped | S / Down | Left trigger |
| Steer | A D / Left Right | Left stick (analog) |
| Handbrake | Space | A or right bumper |
| Recover: back on its wheels on clear ground nearby | R | Y |
| Bail out: jump from the moving car, tumble to a stop and walk (the car rolls on) | Y | B |
| Repair the car | T | |
| Leave the car | E | |
| Free camera (press again to return) | F | |
| Show or hide the key hints | K | |
| Look around the car (settles back behind) | Mouse or drag | |

The **Tidewater Spirit**, a 50 m car ferry, lies in the bay. Step onto her decks to come
aboard, walk up to the bridge and press **E** at the wheel to take her helm: **A/D** turn the
wheel, **W/S** work the throttles, **X** stops the engines, **C** centres the wheel,
**Shift+A/D** runs the bow thruster, **H** sounds the horn, **V** swaps the bridge and chase
views, **E** leaves the helm. Run her aground or into the pier and the hull takes damage; hole
her and she floods. See `docs/ferry.md`.

**Mac-rendered LAN play** lets a phone drive the GT3 or explore on foot with touch controls. The Mac renders the game and sends pictures and sound over the local network. See [LAN play](docs/lan-play.md) for the host command and controls.

**Drive together** opens the local multiplayer lobby. Host a drive and share its room
code, or join a listed drive. Up to eight players share visible cars with name tags,
tyre effects, a driver list with direction and distance, and coloured minimap markers.
Each browser simulates its own car, the server owns room membership and relays validated
poses, and remote cars are drawn smoothly between buffered poses. Remote contacts use
kinematic bodies, so collisions are not server-authoritative.

The WebSocket server runs alongside Vite. For a built installation, run
`npm run build` then `npm start`. Other computers need a reachable **HTTPS** origin
for WebGPU and the same server for WebSockets. The default host is loopback;
`HOST`, `PORT`, `HTTPS_CERT` and `HTTPS_KEY` configure the production server.
Nothing is deployed publicly by the local setup.

The browser-ready physics module is included, so playing only requires Node/npm and a
WebGPU browser. `npm test` runs the physics, bridge, fishing, engine and real-product
driving scenarios; the developer suite also requires Rust and a Playwright browser with
GPU access. See [Rally integration](docs/rally-integration.md) and
[car physics](docs/rally-physics.md) for rebuilding and verification details.

```sh
npm install
npm run dev      # http://127.0.0.1:5189
npm run build    # static build in dist/
```

Every push to the fork’s default branch, `playable`, deploys the single-player build to GitHub Pages. Run `npm run test:pages` to exercise the production build under the project URL before publishing.

## Project layout

| Folder | Contents |
|---|---|
| `src/game/` | The fishing game: rod, bites, the fight, catch card, cooler and log, vendors and stalls, guide, minimap, HUD |
| `src/engine/` | The rendering engine: math, scene graph and geometry, GPU resources, WGSL shader composition, materials, lighting and shadows |
| `src/ocean/` | FFT ocean, water surface and material, shore waves, breakers, swash, wake, caustics, underwater lighting |
| `src/sky/` | Atmosphere, clouds, sky and environment |
| `src/world/` | Terrain, village, pier, reef, fish, vegetation, rocks, debris, wildlife, whale, boat |
| `src/post/` | Post chain: AO, underwater composite, haze, TAAU, motion blur, bloom, lens flare, droplets |
| `src/materials/` | Shared lighting: shadow filtering, bounce light, contact shadows, local lights, LOD fades |
| `src/player/` | Walking, swimming, the boat and the free camera |
| `src/audio/` | The sample-based soundscape |
| `src/ui/` | Settings panel, loading screen and HUD |
| `tools/` | Scripts that fetch and convert the characters, stall props and fishing sounds |
| `test/` | Headless engine smoke test and game-logic tests (`npm test`), and HUD / loader dev pages |

## Credits and license

The code is released under the MIT license; see [LICENSE](LICENSE). Third-party assets (CC0 audio from
Freesound, CC0 scans from Poly Haven, MIT characters from Microsoft Rocketbox, OFL / Apache fonts) and
technique references are listed in [CREDITS.md](CREDITS.md).
