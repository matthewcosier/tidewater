# F/A-18 Hornet: fighter HUD, Activity Wheel ownership and shortcut strip

Status: implemented and verified in `tidewater-driving-overhaul` (branch `feat/vacation-radial-vehicles`, 2026-11-28).
Coordinator resolutions applied: on-screen name uses `F/A-18 Hornet` / `Hornet` (`AIRCRAFT_NAME`), desktop minimap hides while piloting, telemetry drawer retired, Activity Wheel shortcut updated to `M` (with global mute moved to `U`), cue line placed in open upper sky clear of the UFCD, and bottom bank arc tightened to `r = 88` clear of the HUD projector lens.

Premises are marked VERIFIED (with file:line in this worktree) or ASSUMPTION (the builder checks it
before building on it).

## 1. Problem

Three surfaces make the jet look and feel like a debug tool:

1. **Entry.** `Air -> Carrier Jet` calls `openTool('aviation')` (`src/ui/RadialMenu.js:643`), which
   opens the WorldTools "Flight deck" form (`src/aviation/AviationPanel.js:41`): four buttons, two
   selects, a number input, a validation line and three accordions. `Places -> Aircraft Carrier`
   opens the same form (`RadialMenu.js:685`).
2. **In flight.** `.av-hud` is a 300 px dark card (`AviationPanel.js:17,44`) on the right of the
   screen with a name banner, four large readings, seven buttons in a grid and an "Inspect forces"
   accordion. On a 390 px portrait screen it covers the lower right third of the view
   (capture `test-results/portrait-verified/world-systems-Portrait-coe-d8f55-instruments-remain-readable/tidewater-portrait-warning-flight.png`).
3. **Cockpit view.** The only cockpit symbology is a CSS line and a `◇` glyph (`.av-reticle`,
   `AviationPanel.js:31-34`), which does not move with the flight path or the horizon.

Defects found while reading, all fixed by this design:

| What the player sees | Where | Fixed by |
| --- | --- | --- |
| The panel's key sheet is wrong: it says `↓ / S` pulls up, `↑ / W` pushes down, `Q / E` is rudder and `X` leaves. The real keys are W/S throttle, A/D rudder, E leave (`Aviation.js:11-27`). Q opens the wheel. | `AviationPanel.js:41` | Panel retired; strip and README show the real keys |
| After the catapult launch the automation raises the gear and flaps (`FlightPhysics.js:140-146`), but the Gear button stays lit, because `syncControls` only runs on key events (`Aviation.js:186`). | `AviationPanel.js:62-68` | Strip state read from controls on every HUD tick (section 7.5) |
| Clicking Gear or Flaps during the launch toggles the control without setting `auto.gearDone` / `auto.flapsDone`, so the automation overrides the click 15 m later. Keys set them (`Aviation.js:167-175`), buttons do not (`AviationPanel.js:57-58`). | two doors, two rules | One `Aviation.command()` door (section 6) |
| The flight HUD stays on screen in photo mode: no `is-photo` rule covers `.av-hud` (searched `src/**/*.js`, `src/ui/ui.css`). | missing rule | Section 7.7 |
| Several browser specs click the WorldTools rail button "Aviation", but the rail is `display:none` whenever the Activities button exists (`WorldTools.js:35`). ASSUMPTION: those specs are already red on this base. The builder runs them once before the change to confirm. | `aviation.spec.js:13`, `aviation-recovery.spec.js:16`, `livestock.spec.js:27`, `fighter-shadow.spec.js:11`, `chairlift.spec.js:53`, `sharks.spec.js:102` | Section 10 migration |

## 2. Reference

### 2.1 Real HUD layout

- **MIL-STD-1787B, Aircraft Display Symbology** (US DoD, 1996; superseded by 1787C, 2001): the
  layout rules for head-up symbology. A flight path marker (velocity vector) shows where the
  aircraft is going. A pitch ladder references the horizon with solid rungs above it and dashed
  rungs below. The heading scale is a moving tape read against a fixed caret. Airspeed and altitude
  sit left and right of centre.
- **F/A-18 NATOPS Flight Manual (A1-F18AC-NFM-000), HUD symbology chapter.** The Hornet shows
  airspeed and altitude as **digital boxes**, not moving tapes: airspeed box left of centre,
  altitude box right of centre, vertical velocity above the altitude box. Angle of attack (α),
  Mach and normal acceleration (G) are listed under the airspeed box. The heading scale runs across
  the top in navigation mode. With the gear down the HUD adds the **E-bracket**, the AoA indexer
  beside the velocity vector, centred on the 8.1° on-speed AoA. ICLS needles show localiser and
  glideslope deviation as raw needles, not conformal symbols.
  ASSUMPTION: the builder checks the heading-scale position and the E-bracket geometry against
  the NATOPS figure before final art. The design does not depend on either.
- **Why boxes, not tapes.** The brief asked for speed and altitude "tape/bracket". The Hornet uses
  boxes, and boxes are also cheaper: one text node each and no moving ticks. This design uses boxes.

### 2.2 Accessibility and legibility numbers

- WCAG 2.2 SC 2.5.8 (Target Size, Minimum): pointer targets of at least 24 x 24 CSS px. Strip
  buttons are 24 px tall and at least 24 px wide at every width.
- WCAG 2.2 SC 2.5.3 (Label in Name): each visible strip label is a word of its accessible name
  ("Gear" in "Landing gear", "Leave" in "Leave aviation"). That is why the labels are Gear, Hook,
  Flaps, Brake, View, Reset, Leave, and not BRK or EXIT.
- WCAG 2.2 SC 1.4.3: text needs 4.5:1 contrast. Phosphor `#7dffb3` (relative luminance about 0.83)
  on the strip's smoked glass `rgba(6,14,10,.68)` over a white sky gives about 6:1. At `.45` it
  would be about 3.8:1, so `.68` is the floor. The HUD glass has no backing, as in the real
  aircraft. Instead a dark halo gives it local contrast (section 7.3).

### 2.3 Units

The game runs in SI everywhere. The physics, the approach guidance ("hold 68 m/s",
`FlightPhysics.js:77`), the cue line ("620 m to stern", `AviationPanel.js:80`) and the docs all use
m/s and m. The Hornet's own HUD reads knots and feet. A HUD in knots beside guidance in m/s would
contradict itself, so the HUD uses **m/s and m** with small unit tags. This is a stated departure
from the real aircraft.

### 2.4 Aircraft name

The project builds real-looking vehicles under its own names without badges (hero cars Fulmine,
Corsaire and Petrel). The brief names the rebuilt jet "F/A-18 Hornet". **Open decision for the
coordinator:** keep the real designation on screen, or give the replica a house name. The design
puts the name in one constant (`AIRCRAFT_NAME` in `src/aviation/Constants.js`: `full: 'F/A-18 Hornet'`,
`short: 'Hornet'`), so either choice is a one-line edit. All labels below use the constant.

## 3. Real outcome

What the player can do and see, each checkable:

1. Entering the jet takes three wheel picks (`Tab`, then **Air -> F/A-18 Hornet -> Fly Hornet**) or a
   walk-up `E`. No form, select, number input or accordion appears anywhere in ordinary play.
2. Every in-flight action works from three doors that give the same state: its key, the wheel's
   **Hornet** ring and the shortcut strip. Gear clicked during the launch stays where the player put
   it, exactly as `G` does.
3. In flight nothing covers the right-hand third of the screen. The instruments sit around the
   centre as thin phosphor-green lines and numbers. The only solid thing is a 28 px strip in the
   bottom-right corner.
4. In cockpit view the flight path marker sits on the aircraft's real velocity direction and the
   horizon line sits at the real pitch and bank, within 0.5° at the centre of the glass
   (node test, section 11).
5. On a carrier approach in cockpit view, the ICLS needles show which way the glideslope and the
   centreline are, and the E-bracket shows fast or slow against on-speed AoA.
6. Lit key caps on the strip always match the aircraft: gear down, hook down, brake on, cockpit view,
   and the flap setting as three levels. They also follow the launch automation.
7. Every existing Playwright contract on `Flight instruments` still holds (section 10.1).

## 4. Source of truth

The HUD keeps no state of its own. It reads:

| Reading | Source (VERIFIED) |
| --- | --- |
| Phase, reason text | `flight.phase`, `flight.reason` (`FlightPhysics.js:65`, set throughout `step`) |
| Airspeed m/s, α, G, stall, pitch, bank, heading | `flight.metrics.speed / alpha / loadFactor / stall / pitch / bank / heading` (`FlightPhysics.js:55`; attitude from `Math.js:37`) |
| Altitude m, vertical speed m/s | `flight.position[1]`, `flight.velocity[1]` (as today, `AviationPanel.js:75-77`) |
| Flight path direction | `flight.velocity` (world) rotated into the body frame by the inverse of `flight.quaternion` (`[x,y,z,w]`, `Math.js:20`) |
| Throttle, gear, hook, flaps, brake | `flight.controls` (`FlightPhysics.js:65`) |
| Approach geometry | `carrier.runway(position)` (`.along`, `.cross`, `.height`), as today (`AviationPanel.js:79`) |
| View | `aviation.camMode` (`Aviation.js:142`) |
| Focal length | `app.camera.fov` (62° vertical, `src/engine/Engine.js:42`) and the canvas CSS height |

Conventions (VERIFIED, `Math.js:37`, `Aviation.js:152`, `FlightPhysics.js:191`): body +Z is
forward, +Y is up, +X is **screen left** in both cameras. `metrics.pitch` is positive nose-up.
`metrics.bank` is negative in a right bank. The compass heading is `(180 - heading·180/π + 360) % 360`
(`AviationPanel.js:71`). This expression moves into one helper, `compassHeading()`, used by both the
tape and `data-heading`, so the two cannot disagree.

The cockpit camera looks along body +Z with body +Y up (`Aviation.js:217-218,243`), so the screen
centre is the boresight. ASSUMPTION: the WebGPU canvas fills the viewport, so the boresight is the
viewport centre. The builder checks `engine.domElement.getBoundingClientRect()` once.

Approach constants become one source. Lift `APPROACH = { distance: 620, glideDeg: 3.5, speed: 68 }`
into `Constants.js`, and use it in `FlightPhysics.startApproach` (`FlightPhysics.js:69-71,77`) and
in the HUD. The on-speed AoA for the E-bracket is the trim AoA that `startApproach` already computes
(`FlightPhysics.js:71`). Export it as `approachAlpha()` from `FlightPhysics.js` instead of
recomputing it in the HUD.

## 5. Activity Wheel ownership (`src/ui/RadialMenu.js`)

The wheel owns every activity choice. The WorldTools aviation panel is **retired** (section 5.4).

### 5.1 `Air -> F/A-18 Hornet`

Replace the `Carrier Jet` item (`RadialMenu.js:643`):

```js
{ label: AIRCRAFT_NAME.full, sub: 'Carrier flight ops', icon: 'air', children: () => this.hornetItems() },
```

`hornetItems()` (new, next to `rideItems()`). Items run clockwise from 12 o'clock, so the digit keys
are 1 to 4:

| # | label | sub | key | act |
| --- | --- | --- | --- | --- |
| 1 | `Fly Hornet` | `Hold W to launch` when `flight.phase === 'ready'`, else `Take the controls` | | `this.aviationAct( a => a.enter() )` |
| 2 | `Landing Approach` | `620 m astern` (from `APPROACH.distance`) | | `this.aviationAct( a => a.approach() )` |
| 3 | `Walk Flight Deck` | `Stroll the carrier` | | `this.aviationAct( a => a.walkDeck() )` |
| 4 | `Inspect` | `Carrier & jet views` | | `children: () => this.inspectItems()` |

`inspectItems()`, four items, each `this.aviationAct( a => a.visit( view ) )`:
`Whole Carrier` (`carrier`), `Flight Deck` (`deck`), `Bridge` (`bridge`), `Hornet` (`fighter`).

`aviationAct( fn )` is the one guard every aviation wheel item uses. It keeps the chairlift refusal
that `AviationPanel.act` had (`AviationPanel.js:52`), worded like the other wheel refusals
(`RadialMenu.js:500`):

```js
aviationAct( fn ) {
	const app = this.app;
	if ( ! app.aviation ) return;
	if ( app.chairlift?.active ) return app.chairlift.message?.( 'Exit the chairlift at a terminal before changing activities.' );
	fn( app.aviation );
}
```

`Places -> Aircraft Carrier` (`RadialMenu.js:685`) becomes `act: () => this.aviationAct( a => a.visit( 'carrier' ) )`.
`openTool( 'aviation' )` then has no callers.

### 5.2 Context wedge while piloting: `Hornet`

`rideLabel()` (`RadialMenu.js:692`) returns `AIRCRAFT_NAME.short` when `app.aviation?.pilot`,
`'Carrier'` when `app.aviation?.active && ! app.aviation.pilot`, and `'Flight'` for the glider.
`rideItems()` splits the shared aviation/glider branch (`RadialMenu.js:728-735`). The glider keeps
its three items unchanged.

Hornet ring while piloting. There are eight items, so digits 1 to 8 reach every one. Labels are
worked out when the ring opens (`children` is already a function), so each label names the action
it will take:

| # | label | key | act (all through `Aviation.command`, section 6) |
| --- | --- | --- | --- |
| 1 | `Raise Gear` / `Lower Gear` | G | `command( 'gear' )` |
| 2 | `Lower Hook` / `Raise Hook` | H | `command( 'hook' )` |
| 3 | `Flaps` (sub: `Up` / `Takeoff` / `Landing`, the current setting) | V | `command( 'flaps' )` |
| 4 | `Set Brake` / `Release Brake` | B | `command( 'brake' )` |
| 5 | `Cockpit View` / `Chase View` | C | `command( 'camera' )` |
| 6 | `Reset Launch` (sub: `Back to the catapult`) | R | `command( 'reset' )` |
| 7 | `Landing Approach` (sub: `620 m astern`) | | `command( 'approach' )` |
| 8 | `Leave Aircraft` | E | `command( 'leave' )` |

There is no telemetry drawer in the wheel or the HUD. α and G, the two force readings a pilot uses,
are on the HUD (section 7.2). Lift, drag, thrust, cable work, carrier heave and the rest stay
machine-readable as `data-*` on `.av-hud` and are described in `docs/aviation.md`. Nothing that
ordinary play needs is lost. A ninth wedge would break the 1 to 8 digit picks. If the coordinator
wants the readout back, swap it for item 7 and show it as a small phosphor text block under the
left column, updated on the HUD tick.

### 5.3 Context wedge while inspecting: `Carrier`

When `aviation.active && ! aviation.pilot` (camera on the carrier, no HUD):

| # | label | key | act |
| --- | --- | --- | --- |
| 1 | `Fly Hornet` | | `a.enter()` |
| 2 | `Whole Carrier` | | `a.visit( 'carrier' )` |
| 3 | `Flight Deck` | | `a.visit( 'deck' )` |
| 4 | `Bridge` | | `a.visit( 'bridge' )` |
| 5 | `Hornet` | | `a.visit( 'fighter' )` |
| 6 | `Walk Flight Deck` | | `a.walkDeck()` |
| 7 | `Leave Carrier` | E | `a.leave()` |

Today an inspecting player whose wheel shows `Flight` gets `Reset Launch` and `Switch Camera`, which
do nothing useful there (`RadialMenu.js:728-735`).

### 5.4 The WorldTools panel: retired

Every control in `.av-panel` either has a better door or is wrong:

| Panel control | Where it goes |
| --- | --- |
| Visit carrier / Inspection view select | `Inspect` ring and the `Carrier` wedge |
| Enter fighter / Walk flight deck / Start landing approach | `F/A-18 Hornet` ring |
| Aircraft throttle number input | W / S (`Aviation.js:162-163`). A typed throttle has no use in a game. |
| Flap setting select | V, the wheel and the strip |
| Flying controls accordion | Wrong today (section 1). The strip and `README.md` carry the real keys. |
| Launch and recovery / Physics and limits prose | `docs/aviation.md` (already holds the physics, `docs/aviation.md:52`) |
| Validation alert | Only the throttle input and the chairlift used it. The chairlift refusal moves to `aviationAct`. |

So `addWorldTool( ..., { id: 'aviation' } )` is removed. `AviationPanel.js` becomes
`src/aviation/FlightHud.js` (class `FlightHud`, HUD only), and `Aviation.js` refers to
`this.hud` instead of `this.panel` (ten lines: `Aviation.js:76,100,108,109,123,130,139,142,186,199`).
Keeping a "minimal advanced panel" was considered and rejected. It would be a second door to the
same actions, it needs its own tests, and it is the surface the user called ugly.

### 5.5 Wheel item names

Today a wheel item's accessible name is its label plus its key tag (`<small>F</small>`,
`RadialMenu.js:483-484`), so `Free Camera` is announced as "Free Camera F". In `renderLevel()`, set
`b.setAttribute( 'aria-label', item.label )` and, when `item.key` exists,
`b.setAttribute( 'aria-keyshortcuts', item.key )`. The visible text is unchanged. VERIFIED: no
existing test clicks a wheel item that carries a key (`rg menuitem test/`). The root ring texts that
`vacation-radial.spec.js:33` reads are not affected.

## 6. One door for flight commands (`src/aviation/Aviation.js`)

Add `command( name )`. Keys, strip and wheel all call it, so they share one rule:

```js
command( name ) {
	const f = this.flight, c = f.controls;
	switch ( name ) {
	case 'gear': c.gear = ! c.gear; if ( f.auto ) f.auto.gearDone = true; break;
	case 'hook': c.hook = ! c.hook; break;
	case 'flaps': c.flaps = c.flaps < .3 ? .6 : c.flaps < .9 ? 1 : 0; if ( f.auto ) f.auto.flapsDone = true; break;
	case 'brake': c.brake = ! c.brake; break;
	case 'camera': this.toggleCamera(); break;
	case 'reset': this.reset(); break;
	case 'approach': this.approach(); break;
	case 'leave': this.leave(); break;
	}
}
```

`controls()` (`Aviation.js:165-185`) replaces its inline toggles with `command()` calls for G, H, V,
B, R and C. The Space hold-brake stays inline because it is a hold, not a toggle. The trailing
`this.panel?.syncControls()` (`Aviation.js:186`) is deleted, because the HUD reads state on its tick
(section 7.5). The strip's click handler is `button => { aviation.command( button.dataset.act ); button.blur(); app.engine.domElement.focus?.(); }`.

## 7. The fighter HUD (`src/aviation/FlightHud.js`)

### 7.1 DOM

`.av-hud` stays the root and keeps its contract: `role="status"`, `aria-label="Flight instruments"`,
`aria-live="off"`, `hidden` when not piloting, and every `data-*` attribute it carries today. It
becomes a full-viewport, click-through layer that holds the glass, the cue line and the strip:

```html
<section class="av-hud" role="status" aria-label="Flight instruments" aria-live="off" data-view="chase" hidden>
  <svg class="av-glass" viewBox="-180 -150 360 300" aria-hidden="true">
    <defs>
      <clipPath id="av-clip-tape"><rect x="-66" y="-150" width="132" height="30"/></clipPath>
      <clipPath id="av-clip-ladder"><rect x="-96" y="-96" width="192" height="192"/></clipPath>
    </defs>
    <!-- heading tape: both views -->
    <g clip-path="url(#av-clip-tape)"><g class="av-tape"><!-- ticks and labels, built once --></g></g>
    <path class="av-caret" d="M0 -121 l-4 6 h8 z"/>
    <text class="av-sm" x="0" y="-104" text-anchor="middle" data-read="heading">000</text>
    <!-- left column: both views -->
    <rect x="-150" y="-10" width="48" height="20"/>
    <text class="av-big" x="-106" y="5" text-anchor="end" data-read="speed">0</text>
    <text class="av-xs av-dim" x="-150" y="19">M/S</text>
    <text class="av-sm" x="-150" y="32"><tspan class="av-dim">α </tspan><tspan data-read="alpha">0.0</tspan></text>
    <text class="av-sm" x="-150" y="43"><tspan class="av-dim">G </tspan><tspan data-read="g">1.0</tspan></text>
    <text class="av-sm" x="-150" y="54"><tspan class="av-dim">THR </tspan><tspan data-read="throttle">0%</tspan></text>
    <rect class="av-dim" x="-163" y="-30" width="4" height="80"/>
    <g class="av-thr-pos" transform="translate(-162 50)"><rect class="av-fill" x="0" y="-78" width="2" height="78"/></g>
    <!-- right column: both views -->
    <text class="av-sm" x="150" y="-18" text-anchor="end"><tspan class="av-dim">VS </tspan><tspan data-read="sink">0.0</tspan></text>
    <rect x="102" y="-10" width="48" height="20"/>
    <text class="av-big" x="146" y="5" text-anchor="end" data-read="altitude">0</text>
    <text class="av-xs av-dim" x="150" y="19" text-anchor="end">M</text>
    <!-- conformal layer: cockpit view only -->
    <g class="av-conformal">
      <g clip-path="url(#av-clip-ladder)"><g class="av-roll"><g class="av-pitch"><!-- horizon and rungs, rebuilt on resize --></g></g></g>
      <path class="av-waterline" d="M-16 0 H-7 L-4 5 L0 -1 L4 5 L7 0 H16"/>
      <g class="av-fpm"><circle r="4.5"/><path d="M-13 0 H-4.5 M4.5 0 H13 M0 -4.5 V-10"/></g>
      <g class="av-bracket"><path d="M-22 -9 H-19 V9 H-22 M-19 0 H-16"/></g>
      <path class="av-dim" d="M-79.2 79.2 A112 112 0 0 0 79.2 79.2"/><!-- bank arc, ±45° -->
      <!-- bank ticks at 0, ±10, ±20, ±30, ±45, built once -->
      <g class="av-bank-ptr"><path d="M0 104 l-3.5 -6 h7 z"/></g>
      <g class="av-icls"><path class="av-loc" d="M0 -40 V40"/><path class="av-gs" d="M-40 0 H40"/></g>
    </g>
  </svg>
  <p class="av-cue"><span class="av-phase"></span><span class="av-note"></span></p>
  <div class="av-keys" role="toolbar" aria-label="Flight controls"><!-- section 8 --></div>
</section>
```

The old name banner (`KESTREL 07 · DECK FIGHTER`), the reading grid, the seven-button grid, the
"Inspect forces" details element and the separate `.av-reticle` element are all removed. The mode
chip already says `Flying · <name>` (`AppUI.js:354`).

**Text constraint (test contract).** Playwright's `toContainText` reads `textContent`, which
includes hidden SVG text. The HUD must never hold a static node whose text contains `STALL`, `Hold W
to launch` or `You have control`. Those strings appear only when `flight.reason` or the stall cue
writes them (`aviation.spec.js:31,41,56`).

### 7.2 Geometry (viewBox user units, origin at the boresight)

The glass is centred on the viewport, so its origin is the boresight:

```css
.av-glass{position:fixed;left:50%;top:50%;width:min(calc(360 * var(--tw-u)),calc(100vw - 32px));aspect-ratio:360/300;transform:translate(-50%,-50%);overflow:visible}
```

| Element | View | Geometry |
| --- | --- | --- |
| Heading tape | both | 2 units per degree; ticks every 5° (minor `y -128..-124`, major every 10° `y -130..-124`); two-digit labels every 10° (`00`..`35`) at `y -133`, font 8. Built from -40° to 400° so the wrap is seamless; the clip shows ±33°. Moves by `translate(-hdg·2, 0)`. Fixed caret, and a 3-digit heading under it. |
| Speed box | both | rect `(-150,-10) 48x20`, number font 13 right-aligned at `x -106`. `M/S` tag under it. |
| α, G, THR | both | rows at `y 32 / 43 / 54`, font 8, prefixes dimmed. α in degrees to 0.1, G to 0.1, THR as `NN%`. |
| Throttle bar | both | 4 x 80 outline at `x -163`; the fill is scaled `scale(1, throttle)` from its bottom. |
| VS | both | above the altitude box at `y -18`, m/s to 0.1. No `-0.0` (keep the rule at `AviationPanel.js:76-77`). |
| Altitude box | both | rect `(102,-10) 48x20`, number right-aligned at `x 146`. `M` tag under it. |
| Waterline | cockpit | fixed at the origin. Replaces `.av-reticle`. |
| Pitch ladder | cockpit | horizon `M-90 0 H-14 M14 0 H90`. Rungs every 5° from -90° to +90° at `y = -θ·ppd`. Positive rungs are solid with tips toward the horizon: `M-44 y H-16 V y+4 M16 y H44 V y+4`. Negative rungs are dashed (`stroke-dasharray: 5 3`) with tips up. Labels `5`, `10`, ... at `x ±48`, font 7. Clipped to ±96 so they never reach the boxes at ±102. |
| Flight path marker | cockpit | at the projected velocity (section 7.4). Clamped to ±90; when clamped it dims (`.is-limited`). Hidden on deck below 25 m/s (the chase camera's own threshold, `Aviation.js:35`). |
| Bank scale | cockpit | arc of radius 112 from -45° to +45° about straight down, ticks at 0, ±10, ±20, ±30, ±45; the pointer is rotated by the bank about the origin. |
| E-bracket | cockpit, approach with gear down | at `(fpmX, fpmY + (α - α_onSpeed)·7.5)` (9 units = 1.2°). When on speed, the marker sits in the middle of the bracket. |
| ICLS needles | cockpit, approach | localiser: vertical line moved by `x = clamp(locDeg / 3, -1, 1)·60`. Glideslope: horizontal line moved by `y = clamp(gsErrDeg / 1, -1, 1)·60`. Full scale is ±3° on the localiser and ±1° on the glideslope (design choices, not sourced). |

`ppd` (user units per degree) = `f · π/180 / s`, where `f = (canvasCssHeight / 2) / tan(fov / 2)`
and `s = glassCssWidth / 360`. Both are measured on `resize`, on showing the HUD and whenever
`camera.fov` differs from the cached value (one number compare per frame). At 1440 x 900, f = 749 px,
s ≈ 1.06 and ppd ≈ 12.3. At 390 x 844, f = 702 px, s ≈ 0.99 and ppd ≈ 12.3. The ladder spaces rungs
evenly at the centre's scale. Across the ±96-unit clip (about ±7.8°) that differs from the exact
`tan` projection by under 1%. The ladder rungs and labels are rebuilt only when ppd changes.

**Chase view.** Only the heading tape, both columns and the cue line show. A pitch ladder or flight
path marker drawn on a camera 20 m behind the jet would not line up with anything (`Aviation.js:219-236`),
so they are hidden there. The result is a light frame either side of the jet, not a box over it.

**Approach predicate.** The needles and the E-bracket show when
`phase === 'airborne' && runway.along < 0 && distance < 1500`, the same condition the cue line uses
today (`AviationPanel.js:80`). The bracket also needs `controls.gear`. Deviation:
`locDeg = atan2(runway.cross, distance)·180/π`, `gsErrDeg = glideDeg - APPROACH.glideDeg`, where
`glideDeg` is today's `atan2(runway.height - 1.9, distance)`. ASSUMPTION: the sign of `runway.cross`.
The cue text today says `"<n> m right"` when `cross < 0` (`AviationPanel.js:80`). The node test
(section 11) fixes the needle sign: a jet right of the centreline shows the localiser needle left of
centre (fly left).

### 7.3 Colour and type tokens

Scoped to `.av-hud`, so nothing leaks into the shell tokens in `src/ui/ui.css`:

```css
.av-hud{--av-rgb:125,255,179;--av-ink:rgb(var(--av-rgb));--av-dim:rgba(var(--av-rgb),.58);--av-halo:rgba(0,16,6,.8);--av-smoke:rgba(6,14,10,.68);
 position:fixed;inset:0;z-index:108;pointer-events:none;color:var(--av-ink)}
.av-hud[hidden]{display:none}
.av-glass{fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round;
 filter:drop-shadow(0 0 1px var(--av-halo)) drop-shadow(0 1px 1.5px rgba(0,0,0,.45))}
.av-glass text{fill:currentColor;stroke:none;font-family:var(--tw-mono);font-weight:600;font-variant-numeric:tabular-nums}
.av-glass .av-big{font-size:13px}.av-glass .av-sm{font-size:8px}.av-glass .av-xs{font-size:6.5px;letter-spacing:.08em}
.av-glass .av-dim{opacity:.58}.av-glass .av-fill{fill:currentColor;stroke:none}
.av-glass .av-neg{stroke-dasharray:5 3}
.av-hud[data-view=chase] .av-conformal{display:none}
.av-hud:not(.is-approach) :is(.av-icls,.av-bracket){display:none}
.av-fpm.is-limited{opacity:.45}
```

Inside an inline SVG, CSS `px` font sizes are user units, so type scales with the glass.

**Halo, measured.** The drop-shadow filter on the glass is the simplest way to keep the lines
readable over bright sky. It is re-applied whenever the SVG repaints. If `?bench` shows the cockpit
HUD adding more than 0.2 ms of frame time, drop the filter. Then give text `paint-order:stroke;
stroke:var(--av-halo);stroke-width:2.5px` and put a second, wider, 35% black stroke under the ladder
and the marker.

### 7.4 Projection (new pure module `src/aviation/HudMath.js`)

All maths the HUD needs lives in pure functions that write into caller-owned scratch objects, so the
node test can run them without a DOM:

```js
// q is [x,y,z,w] (Math.js:20). Body +X is screen left, +Y up, +Z forward.
export function projectVelocity( q, v, ppd, out ) {         // out: { x, y, ok }
	CONJ[0] = - q[0]; CONJ[1] = - q[1]; CONJ[2] = - q[2]; CONJ[3] = q[3];
	rotateInto( BODY, CONJ, v );                               // Math.js:20, no allocation
	if ( BODY[2] <= 1e-3 ) { out.ok = false; return out; }
	const k = ppd * 180 / Math.PI;                             // tan(angle)·k = user units
	out.x = - BODY[0] / BODY[2] * k; out.y = - BODY[1] / BODY[2] * k; out.ok = true;
	return out;
}
export const compassHeading = m => ( 180 - m.heading * 180 / Math.PI + 360 ) % 360;
export function ladderPose( m, ppd, out ) {                  // out: { rot, shift }
	out.rot = m.bank * 180 / Math.PI;                         // right bank (negative) -> counter-clockwise
	out.shift = m.pitch * 180 / Math.PI * ppd;                // nose up -> horizon moves down (SVG +y)
	return out;
}
export function iclsDeviation( runway, out ) { /* fills out.locDeg, out.gsErrDeg, out.distance, out.active */ }
```

`CONJ` and `BODY` are module-level `[0,0,0,0]` and `[0,0,0]` arrays.

### 7.5 Update strategy: no per-frame allocation on the drawing path

Two cadences:

**Every frame** (`FlightHud.update(dt)` runs every frame from `Aviation.update`, `Aviation.js:199`),
only while piloting:

- Heading tape: `tTape.setTranslate( -hdg * 2, 0 )`.
- Cockpit only: `tRoll.setRotate( pose.rot, 0, 0 )`, `tPitch.setTranslate( 0, pose.shift )`,
  `tFpm.setTranslate( fpm.x, fpm.y )`, `tBankPtr.setRotate( pose.rot, 0, 0 )`, and when approaching
  `tLoc.setTranslate( x, 0 )`, `tGs.setTranslate( 0, y )`, `tBracket.setTranslate( ... )`.
- `tThr.setScale( 1, throttle )`.

Each `t*` is an `SVGTransform` made once at build time:
`const t = svg.createSVGTransform(); el.transform.baseVal.initialize( t );`. The calls above then
change it in place: no strings, no arrays, no objects. The scratch outputs (`fpm`, `pose`, `icls`)
are allocated once in the constructor.

**Every 80 ms** (today's tick, `AviationPanel.js:70`):

- Text: each readout keeps its last shown value as an integer (tenths for α, G and VS). It writes
  `textContent` only when that value changes, taking the string from a table built on first show:
  `INT[0..1999]` (speed, heading, throttle, altitude to 1999 m) and `TENTH[-999..999]` (±99.9).
  Altitude above 1999 m falls back to `String(n)`. About 4,000 short strings (under 150 KB) are
  built once.
- Cue: `.av-phase` and `.av-note` texts are written only when the phase, reason or warning changes.
  The note keeps today's rule (`AviationPanel.js:80`) word for word: stall text, then approach
  guidance, then `flight.reason`.
- Classes, toggled only on change: `data-view` (`chase` / `cockpit`), `.is-approach`, `.is-warn`
  on `.av-cue` (stall, ditched, crashed), `.is-limited` on the marker.
- Strip state: `aria-pressed` for gear, hook, brake and camera, and `data-level` (`0` / `1` / `2`)
  for flaps (`< .3`, `< .9`, else), compared with cached values and written on change. This fixes the
  stale Gear light after the automated gear-up (section 1).
- Telemetry `data-*`: kept, because the browser specs read them. Write them from a static key list
  instead of the per-tick object literal and `Object.entries` (`AviationPanel.js:71-72`). The
  `toFixed(5)` strings (about 30 short strings per tick) are the one remaining allocation. It is
  bounded, unchanged from today, and needed by the test contract.

Show, restore and resize invalidate every cache (set it to `NaN`), so the first tick after
`Aviation.enter`, `resetDisasterEffects` (`Aviation.js:123`) or a resize writes everything.

### 7.6 Cue line

```css
.av-cue{position:fixed;left:50%;top:calc(50% + 162 * var(--tw-u));transform:translateX(-50%);margin:0;max-width:min(calc(520 * var(--tw-u)),calc(100vw - 32px));
 font:600 calc(11 * var(--tw-u))/1.35 var(--tw-mono);letter-spacing:.08em;text-transform:uppercase;text-align:center;color:var(--av-ink);
 text-shadow:0 0 2px var(--av-halo),0 1px 2px rgba(0,0,0,.6)}
.av-cue .av-note:not(:empty)::before{content:' · '}
.av-cue.is-warn .av-note{padding:0 calc(4 * var(--tw-u));outline:1px solid currentColor;animation:av-flash 1s steps(2,start) infinite}
@keyframes av-flash{50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.av-cue.is-warn .av-note{animation:none}}
```

`text-transform` changes only the painting, so `textContent` still reads `Hold W to launch`. The
`::before` separator is not in `textContent` either.

### 7.7 Visibility rules

```css
body:has(.tw-root.is-photo) .av-hud,body:has(.tw-root.is-starting) .av-hud{display:none}
```

The narrow-screen rule that hides the HUD while a world panel is open stays as it is
(`WorldTools.js:61`). Remove `.av-reticle` from its list, because that element no longer exists.

## 8. Shortcut strip

### 8.1 Markup (inside `.av-hud`, so `getByRole('status',{name:'Flight instruments'}).getByRole('button',{name:'Leave aviation'})` keeps working, `world-systems.spec.js:92`)

```html
<div class="av-keys" role="toolbar" aria-label="Flight controls">
  <button type="button" data-act="gear"   aria-label="Landing gear"   aria-keyshortcuts="G" aria-pressed="true"  title="Landing gear (G)"><kbd>G</kbd><span>Gear</span></button>
  <button type="button" data-act="hook"   aria-label="Arrestor hook"  aria-keyshortcuts="H" aria-pressed="false" title="Arrestor hook (H)"><kbd>H</kbd><span>Hook</span></button>
  <button type="button" data-act="flaps"  aria-label="Cycle flaps"    aria-keyshortcuts="V" data-level="1"      title="Cycle flaps (V)"><kbd>V</kbd><span>Flaps</span></button>
  <button type="button" data-act="brake"  aria-label="Wheel brake"    aria-keyshortcuts="B" aria-pressed="true"  title="Wheel brake (B, hold Space)"><kbd>B</kbd><span>Brake</span></button>
  <button type="button" data-act="camera" aria-label="Cockpit view"   aria-keyshortcuts="C" aria-pressed="false" title="Cockpit view (C)"><kbd>C</kbd><span>View</span></button>
  <button type="button" data-act="reset"  aria-label="Reset aircraft" aria-keyshortcuts="R"                     title="Reset aircraft (R)"><kbd>R</kbd><span>Reset</span></button>
  <button type="button" data-act="leave"  aria-label="Leave aviation" aria-keyshortcuts="E"                     title="Leave aviation (E)"><kbd>E</kbd><span>Leave</span></button>
  <span class="av-keys-tab" aria-hidden="true"><kbd>Tab</kbd><span>Wheel</span></span>
</div>
```

The accessible names and `aria-pressed` meanings are exactly today's (`AviationPanel.js:44,66-67`).
The `data-act` values are `Aviation.command()` names.

### 8.2 Style

```css
.av-keys{position:fixed;right:var(--tw-edge);bottom:var(--tw-edge);display:flex;align-items:center;gap:calc(2 * var(--tw-u));
 height:calc(28 * var(--tw-u));padding:0 calc(2 * var(--tw-u));box-sizing:border-box;border-radius:calc(8 * var(--tw-u));
 background:var(--av-smoke);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(var(--av-rgb),.16);
 pointer-events:auto;font:600 calc(9.5 * var(--tw-u))/1 var(--tw-mono);letter-spacing:.06em;text-transform:uppercase;color:rgba(var(--av-rgb),.8)}
.av-keys button{display:inline-flex;align-items:center;gap:calc(4 * var(--tw-u));height:calc(24 * var(--tw-u));min-width:max(24px,calc(24 * var(--tw-u)));
 padding:0 calc(5 * var(--tw-u)) 0 calc(4 * var(--tw-u));border:0;border-radius:calc(6 * var(--tw-u));background:none;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer}
.av-keys button:hover{background:rgba(var(--av-rgb),.1);color:var(--av-ink)}
.av-keys button:focus-visible{outline:1.5px solid var(--av-ink);outline-offset:-1px}
.av-keys kbd{display:grid;place-items:center;min-width:calc(14 * var(--tw-u));height:calc(14 * var(--tw-u));padding:0 calc(2 * var(--tw-u));box-sizing:border-box;
 border:1px solid rgba(var(--av-rgb),.38);border-radius:calc(3 * var(--tw-u));background:none;color:var(--av-ink);font:inherit}
.av-keys [aria-pressed=true] kbd,.av-keys [data-level="2"] kbd{background:rgba(var(--av-rgb),.88);border-color:transparent;color:#03140a;box-shadow:0 0 6px rgba(var(--av-rgb),.45)}
.av-keys [data-level="1"] kbd{background:rgba(var(--av-rgb),.38)}
.av-keys-tab{display:inline-flex;align-items:center;gap:calc(4 * var(--tw-u));padding:0 calc(6 * var(--tw-u));border-left:1px solid rgba(var(--av-rgb),.16);color:rgba(var(--av-rgb),.55)}
@media (max-width:560px){.av-keys button span,.av-keys-tab span{display:none}.av-keys button{justify-content:center;padding:0}}
@media (max-height:560px) and (min-width:561px){.av-keys{right:calc(68 * var(--tw-u))}}
```

The lit key cap is the "LED": a filled phosphor cap means gear down, hook down, brake on or cockpit
view. Flaps show three levels: an empty cap (up), a half-filled cap (takeoff) and a full cap
(landing).

### 8.3 Fit and clearances

| Viewport | Strip | Clearance (VERIFIED geometry, computed) |
| --- | --- | --- |
| 1440 x 900 (`--tw-u` ≈ 1.06) | labels shown, about 440 x 30 px, bottom-right at 17 px | Settings rail: vertically centred at `right: var(--tw-3)` (`ui.css:1426-1436`), so its bottom is near 450 + 175 = 625 px and the strip's top is about 853 px. |
| 390 x 844 (`--tw-u` = 1) | key caps only, about 215 x 28 px | Rail bottom near 597 px, strip top 800 px. 16 px side gutter. The map, prompt and evacuation hint are already hidden while the flight HUD shows (`WorldTools.js:62`). |
| 844 x 390 (short landscape) | labels shown, moved left to `right: 68u` | The rail column (12u inset + 48u wide, `ui.css:1426,1469-1474`) would reach about 365 px, below the strip's top at 346 px. The short-height rule moves the strip clear of the column. |

**Minimap on desktop: decision for the coordinator.** The rule that hides `.gm-map` while the
flight HUD shows sits inside `@media(max-width:700px)` (`WorldTools.js:47,62`). On desktop the
184u round map stays bottom-right (`Minimap.js:23`) and would sit under the strip. Recommendation:
hide the map, its pins and its coach while piloting at every width, with a new rule outside the media
query: `body:has(.av-hud:not([hidden])) :is(.gm-map,.gm-pin,.gm-coach){visibility:hidden;pointer-events:none}`.
The reason: at flight speed the map's 110 m view (`Minimap.js:401`) covers under a second of travel.
This changes what the player sees, so it needs the coordinator's yes. If the answer is no, move the
strip left of the map instead: `right: calc(var(--tw-edge) + 192 * var(--tw-u))`.

**Keyboard focus.** Tab opens the wheel by design (`RadialMenu.js:96`), so keyboard players use the
hotkeys and the wheel, not tab focus on the strip. The buttons stay real buttons with names, so
screen readers and pointer users reach them. After a click, focus goes back to the canvas (today's
`blur` and `focus`, `AviationPanel.js:50,61`).

## 9. Transitions

| From -> to | What happens |
| --- | --- |
| Not piloting -> piloting (`enter`, walk-up E, `approach`) | `.av-hud` unhidden; caches invalidated; the whole HUD is written on the first tick. No fade, because the camera cuts on the same frame (`Aviation.js:100,108`). |
| Chase <-> cockpit (C, wheel, strip) | `data-view` flips on the next tick; the conformal layer shows or hides with the camera cut (`Aviation.js:142`). |
| Ready -> launching -> airborne | Cue text follows `flight.reason`: `Hold W to launch`, `Catapult`, `Rotating`, `Climbing, gear up`, `You have control`. The Gear and Flaps caps go dark when the automation raises them. |
| Airborne -> approach window (within 1500 m astern) | `.is-approach` on; needles and (gear down) E-bracket appear; the cue shows distance, lineup and glide. |
| Any -> stall | Cue note `STALL · lower the nose and add power`, boxed and flashing at 1 Hz; steady under reduced motion. |
| Touchdown -> arresting -> arrested, bolter | Cue only. The marker hides below 25 m/s on deck. |
| Crashed or ditched | Cue shows the reason with `.is-warn`; the conformal layer stays as the attitude shows it. |
| Piloting -> inspecting or not active (`visit`, `leave`, `walkDeck`) | `.av-hud` hidden at once. The wheel's context wedge becomes `Carrier` or `Ride`. |
| Wheel opened mid-flight | The wheel overlay (z 160) dims and blurs the HUD (z 108). Input keys are cleared (`RadialMenu.js` `show`). The control law holds the flight path with the stick neutral (`FlightPhysics.js:158-163`). |
| World panel opened (Disasters) | Narrow screens: the HUD is hidden by `WorldTools.js:61` and returns on close (`world-systems.spec.js:125,136`). Desktop: the panel sits top-left and the HUD stays. |
| Disaster restore | `resetDisasterEffects` calls `hud.update(0)` (`Aviation.js:123`); caches are invalidated first. |
| Free camera | F is ignored while piloting (`App.js:815`). The wheel's Free Camera item turns free-cam on, which leaves aviation (`App.js:660`), so the HUD hides. |
| Photo mode | HUD hidden (section 7.7). |
| Resize or orientation change | Recompute ppd and rebuild the ladder; invalidate caches. |

## 10. Test contracts

### 10.1 Kept exactly (no edits needed)

- `getByRole('status',{name:'Flight instruments'})`, visible while piloting and hidden otherwise.
  The full-viewport root has a non-empty box, so `toBeVisible` holds. The narrow-screen panel rule
  sets `visibility:hidden`, so `toBeHidden` holds.
- Every `data-*` read by the specs: `phase`, `contacts`, `gear`, `hook`, `heading`, `y`,
  `landing-distance`, `cable-energy`, `peak-cable-force`, `deck-speed`
  (`aviation.spec.js`, `aviation-recovery.spec.js`).
- `[data-read=throttle]` has text `100%` during the launch (`aviation.spec.js:37`; now a `<tspan>`).
- `toContainText('Hold W to launch' | 'You have control')` and `not.toContainText('STALL')`, given
  the text constraint in 7.1.
- Buttons `Reset aircraft` and `Leave aviation` inside the status (`aviation.spec.js:83,104-105`,
  `world-systems.spec.js:92`).
- `.av-hud` hidden while the Disasters panel is open and visible after it closes, on portrait
  (`world-systems.spec.js:125,136`).
- `separated()` checks for brand, Activities, warning and panel (`world-systems.spec.js:115-131`).

### 10.2 Migrated (old door -> wheel door)

Add one helper next to `open()` in `world-systems.spec.js` and reuse it (export it from a small
`test/browser/helpers/wheel.js`): `wheel(page, ...path)` clicks `Activities menu` and then each
menuitem in turn.

| Spec and line | Old | New |
| --- | --- | --- |
| `world-systems.spec.js:6,44` | `Aviation` in the panel-exclusivity loop, region `Aviation controls` | Remove `Aviation` from `TOOL_PATHS` and from the loop (no panel left to be exclusive). |
| `world-systems.spec.js:86-88,119` | `open(page,'Aviation')` + `Enter fighter` | `wheel(page,'Air','F/A-18 Hornet','Fly Hornet')` |
| `world-systems.spec.js:89` | `Flying · Kestrel` | `Flying · ${AIRCRAFT_NAME.short}` (if the name decision lands) |
| `world-systems.spec.js:120` | `region 'Aviation controls'` hidden | `menu 'Activity Wheel'` hidden |
| `aviation.spec.js:13` (`ready`) | rail button `Aviation` | nothing; each scenario opens the wheel |
| `aviation.spec.js:22` | `Walk flight deck` | `wheel(...,'F/A-18 Hornet','Walk Flight Deck')` |
| `aviation.spec.js:66,93` | `Start landing approach` | `wheel(...,'F/A-18 Hornet','Landing Approach')` |
| `aviation.spec.js:107-108` | reopen panel, `Enter fighter` visible | `wheel(page,'Air','F/A-18 Hornet')`, then menuitem `Fly Hornet` visible |
| `aviation.spec.js:114-131` | `Inspection view` select + `Close aviation controls` | `wheel(...,'Inspect', '<Whole Carrier/Flight Deck/Bridge/Hornet>')`; the same camera-distance assertions |
| `aviation.spec.js:144,156-157` | rail `Aviation` + `Enter fighter`; `Close disaster controls` | wheel path; unchanged |
| `aviation-recovery.spec.js:16,25` | `ready(page,'Aviation')`, `Enter fighter`, `Walk flight deck` | wheel paths |
| `livestock.spec.js:27`, `fighter-shadow.spec.js:11`, `sharks.spec.js:102` | rail `Aviation` + `Enter fighter` | wheel path |
| `chairlift.spec.js:53` | four panel buttons refused on the chairlift | the four `F/A-18 Hornet` ring items refused on the chairlift (same `check()`), which proves `aviationAct` |
| `hud-shell.spec.js:139-142` | `.av-panel h2` has text `Flight deck` and no own typography | **Delete.** It pins panel typography, and the panel is gone. |

## 11. Evidence plan

**Node test `test/f18-hud.mjs`** (added to the `test:simulation` script in `package.json`). It uses
real `FlightPhysics` and `CarrierPhysics` states, no DOM:

1. A jet posed 5° nose-up and flying a 2° climb: `projectVelocity` puts the marker 3° below the
   boresight (`y = +3·ppd`), within 0.5°. Red first: flip the `y` sign and see it fail.
2. `ladderPose` on a 30° right bank (attitude bank negative) gives `rot = -30` (horizon turns
   counter-clockwise on screen). Nose-up 10° gives `shift = +10·ppd` (horizon below centre).
3. `startApproach()` then one step: the jet is on the glideslope, so `iclsDeviation` gives
   `|gsErrDeg| < 0.2` and `|locDeg| < 0.5`. Shift the jet 20 m right of the centreline and the
   localiser needle goes left of centre.
4. `approachAlpha()` equals the AoA `startApproach` sets (one source).
5. Allocation: run with `--expose-gc`, warm up, then 100,000 calls of `projectVelocity`,
   `ladderPose` and `iclsDeviation` into the same scratch objects. `heapUsed` grows by less than
   64 KB after `gc()`.
6. `compassHeading` agrees with the old `data-heading` expression over 0 to 360° in 1° steps.

**Playwright scenario `test/browser/f18-hud.spec.js`** (Given/When/Then through the player's keys
and the wheel, real product, fresh context):

1. *Wheel to launch with no form.* Given the island; when I pick Air -> F/A-18 Hornet -> Fly Hornet;
   then `Flight instruments` shows `Hold W to launch` and no `region` named `Aviation controls`
   exists. When I hold W; then `data-phase` reaches `launching`, `[data-read=throttle]` reads `100%`,
   and once `You have control` shows, `Landing gear` has `aria-pressed="false"` and `data-gear` is
   `up`. Red on today's code: the gear light stays lit.
2. *Three doors, one rule.* While piloting: press `G` and `data-gear` flips; click `Arrestor hook` on
   the strip and `data-hook` becomes `down`; pick `Hornet -> Cockpit View` in the wheel and
   `.av-hud` has `data-view="cockpit"` and `Cockpit view` is pressed. During the launch, click
   `Landing gear` down after the automation raised it, climb another 5 s, and the gear stays down.
   Red on today's code: the click does not set `gearDone`.
3. *Refusal.* On the chairlift, `F/A-18 Hornet -> Fly Hornet` leaves `aviation.active` false and
   shows the chairlift message (part of the migrated `chairlift.spec.js`).
4. *Coexistence* at 1440 x 900, 390 x 844 and 844 x 390, in the existing `separated()` style: the
   strip does not overlap the settings rail, the Activities button, the tsunami warning or (if the
   map stays on desktop) `.gm-map`, and it sits inside the viewport.

No new assertions on colour, font, pixel position or wording beyond the existing contract strings.

**Captures** (each viewed whole, defects logged): `ready-on-catapult` (chase), `climb-cockpit`,
`approach-cockpit` (needles and bracket), `portrait-warning-flight` (the frame that started this),
`landscape-short`, `photo-mode` (no HUD). Captures stay out of git.

**Bench.** `?bench` GPU ms and main-thread HUD ms, before and after, in chase and cockpit at
1440 x 900. Budget: 0 extra GPU passes and draw calls, because the HUD is DOM and never touches the
WebGPU frame. HUD main-thread update under 0.1 ms per frame, and total frame time within ±0.2 ms of
before. If the cockpit glass misses that, apply the halo fallback in 7.3 and measure again.

## 12. Budget

| Item | Budget |
| --- | --- |
| WebGPU passes, draw calls, textures | 0 added (DOM overlay only) |
| Per-frame JS heap allocation on the drawing path | 0 (`SVGTransform` edits, scratch outputs, string tables) |
| 80 ms tick allocation | strings only for readouts that changed, plus the existing telemetry `data-*` strings (about 30 per tick) |
| DOM nodes | about 330 SVG nodes (ladder 37 rungs, tape 89 ticks + 36 labels, bank scale 9), built once; the ladder is rebuilt on resize |
| Paint | glass about 380 x 320 CSS px repainted per frame in cockpit, the tape strip in chase; strip repaints only on state change |

## 13. Files the build touches

| File | Change |
| --- | --- |
| `src/aviation/AviationPanel.js` -> `src/aviation/FlightHud.js` | HUD only: glass, cue, strip, tick and frame updates |
| `src/aviation/HudMath.js` (new) | pure projection, heading, ladder, ICLS and string tables |
| `src/aviation/Aviation.js` | `command()`, keys routed through it, `this.panel` -> `this.hud` |
| `src/aviation/FlightPhysics.js`, `src/aviation/Constants.js` | `APPROACH`, `approachAlpha()`, `AIRCRAFT_NAME` |
| `src/ui/RadialMenu.js` | `F/A-18 Hornet` ring, `Inspect` ring, `Hornet` and `Carrier` context wedges, `aviationAct`, Places carrier item, item `aria-label` and `aria-keyshortcuts` |
| `src/ui/WorldTools.js` | drop `.av-reticle` from line 61; desktop map rule if approved |
| `src/ui/AppUI.js:354` | mode chip uses `AIRCRAFT_NAME.short` |
| `docs/aviation.md`, `README.md` controls table, Help sheet in `src/ui/UI.js` | real fighter keys (W/S throttle, arrows pitch and roll, A/D rudder, G/H/V/B/C/R/E, Space hold brake); launch and recovery text moved from the panel |
| tests | section 10.2 migrations, `test/f18-hud.mjs`, `test/browser/f18-hud.spec.js` |

The jet model rebuild (the F/A-18 airframe and its 12 pivots) is a separate lane. This design reads
no pivot and does not depend on it.

## 14. Open decisions for the coordinator

1. **On-screen name**: the real `F/A-18 Hornet` designation, or a house name in the project's
   no-badge style (section 2.4). One constant either way.
2. **Desktop minimap while piloting**: hide it (recommended), or move the strip left of it
   (section 8.3).
3. **Telemetry readout**: retired (recommended), or brought back as wheel item 7 in place of
   `Landing Approach` (section 5.2).
