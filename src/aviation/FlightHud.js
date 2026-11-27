import { approachAlpha } from './FlightPhysics.js';
import { clamp, length, sub } from './Math.js';
import { projectVelocity, compassHeading, ladderPose, iclsDeviation, intStr, hdgStr, pctStr, tenthStr } from './HudMath.js';

// MIL-STD-1787B / F/A-18 Hornet phosphor-green fighter HUD + whisper-small bottom-right shortcut strip.
// Replaces the legacy WorldTools Flight Deck form and bulky right-side glass card.
// Zero per-frame heap allocations on the drawing path: SVGTransform instances are mutated in place
// and text readouts pull from prebuilt string tables only when the rounded value changes.
const DEG = 180 / Math.PI;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ON_SPEED_ALPHA_DEG = approachAlpha() * DEG;
const PHASE_LABELS = {
	ready: 'Ready on catapult',
	launching: 'Catapult launch',
	airborne: 'Airborne',
	touchdown: 'Deck contact',
	arresting: 'Wire captured',
	arrested: 'Arrested landing',
	bolter: 'Bolter · go around',
	ditched: 'Ditching · flooding',
	crashed: 'Aircraft damaged',
};

const STYLE = /* css */`
.av-hud {
	--av-rgb: 125, 255, 179;
	--av-ink: rgb(var(--av-rgb));
	--av-dim: rgba(var(--av-rgb), 0.56);
	--av-halo: rgba(0, 16, 6, 0.82);
	--av-smoke: rgba(6, 14, 10, 0.7);
	position: fixed; inset: 0; z-index: 108; pointer-events: none; color: var(--av-ink);
}
.av-hud[hidden] { display: none; }
body:has(.tw-root.is-photo) .av-hud,
body:has(.tw-root.is-starting) .av-hud { display: none !important; }
/* At flight speed the 110 m walking minimap covers under a second of travel and occupies the shortcut strip corner. */
body:has(.av-hud:not([hidden])) :is(.gm-map, .gm-pin, .gm-coach) { visibility: hidden; pointer-events: none; }

.av-glass {
	position: fixed; left: 50%; top: 50%;
	width: min(calc(376 * var(--tw-u)), calc(100vw - 28px));
	aspect-ratio: 360 / 300;
	transform: translate(-50%, -50%); overflow: visible;
	fill: none; stroke: currentColor; stroke-width: 1.25; stroke-linecap: round; stroke-linejoin: round;
	filter: drop-shadow(0 0 1px var(--av-halo)) drop-shadow(0 1px 1.6px rgba(0, 0, 0, 0.48));
}
.av-glass text {
	fill: currentColor; stroke: none; font-family: var(--tw-mono); font-weight: 600;
	font-variant-numeric: tabular-nums;
}
.av-glass .av-big { font-size: 13px; }
.av-glass .av-sm { font-size: 8px; }
.av-glass .av-xs { font-size: 6.5px; letter-spacing: 0.08em; }
.av-glass .av-dim { opacity: 0.58; }
.av-glass .av-fill { fill: currentColor; stroke: none; }
.av-glass .av-neg { stroke-dasharray: 5 3; }
.av-hud[data-view='chase'] .av-conformal { display: none; }
.av-hud:not(.is-approach) .av-icls,
.av-hud:not(.is-bracket) .av-bracket { display: none; }
.av-fpm.is-limited { opacity: 0.45; }
.av-fpm.is-off { display: none; }

.av-cue {
	position: fixed; left: 50%; top: calc(var(--tw-edge) + 90 * var(--tw-u)); transform: translateX(-50%);
	margin: 0; max-width: min(calc(540 * var(--tw-u)), calc(100vw - 260px));
	font: 600 calc(11 * var(--tw-u))/1.35 var(--tw-mono); letter-spacing: 0.08em;
	text-transform: uppercase; text-align: center; color: var(--av-ink);
	text-shadow: 0 0 2px var(--av-halo), 0 1px 2px rgba(0, 0, 0, 0.7);
}
@media (max-height: 560px) { .av-cue { top: 96px; font-size: 10px; } }
.av-cue .av-note:not(:empty)::before { content: ' · '; }
.av-cue.is-warn .av-note {
	padding: 0 calc(4 * var(--tw-u)); outline: 1px solid currentColor;
	animation: av-flash 1s steps(2, start) infinite;
}
@keyframes av-flash { 50% { opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) { .av-cue.is-warn .av-note { animation: none; } }

/* Ultra-small fixed bottom-right flight shortcut strip (26 px tall, smoked glass, lit phosphor keycap LEDs). */
.av-keys {
	position: fixed; right: calc(12 * var(--tw-u)); bottom: calc(12 * var(--tw-u));
	display: flex; align-items: center; gap: 1px;
	height: calc(26 * var(--tw-u)); padding: 0 3px; box-sizing: border-box;
	border-radius: calc(7 * var(--tw-u)); background: var(--av-smoke);
	-webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
	border: 1px solid rgba(var(--av-rgb), 0.16);
	box-shadow: 0 4px 14px -6px rgba(0, 0, 0, 0.6);
	pointer-events: auto;
	font: 600 calc(9 * var(--tw-u))/1 var(--tw-mono); letter-spacing: 0.05em;
	text-transform: uppercase; color: rgba(var(--av-rgb), 0.78);
}
.av-keys button {
	display: inline-flex; align-items: center; gap: 3px;
	height: 24px; min-width: 24px; padding: 0 4px;
	border: 0; border-radius: 5px; background: none; color: inherit;
	font: inherit; letter-spacing: inherit; text-transform: inherit; cursor: pointer;
	transition: background 100ms ease, color 100ms ease;
}
.av-keys button:hover { background: rgba(var(--av-rgb), 0.12); color: var(--av-ink); }
.av-keys button:focus-visible { outline: 1.5px solid var(--av-ink); outline-offset: -1px; }
.av-keys kbd {
	display: grid; place-items: center; min-width: 13px; height: 13px; padding: 0 2px;
	box-sizing: border-box; border: 1px solid rgba(var(--av-rgb), 0.38); border-radius: 3px;
	background: none; color: var(--av-ink); font: inherit;
}
.av-keys [aria-pressed='true'] kbd,
.av-keys [data-level='2'] kbd {
	background: rgba(var(--av-rgb), 0.9); border-color: transparent; color: #03140a;
	box-shadow: 0 0 6px rgba(var(--av-rgb), 0.45);
}
.av-keys [data-level='1'] kbd { background: rgba(var(--av-rgb), 0.36); color: #eafff2; }
.av-keys [data-act='wheel'] {
	margin-left: 2px; padding-left: 5px; border-left: 1px solid rgba(var(--av-rgb), 0.16);
	border-radius: 0 5px 5px 0; color: rgba(var(--av-rgb), 0.62);
}
@media (max-width: 560px) {
	.av-glass { width: calc(100vw - 112px); }
	.av-keys button span { display: none; }
	.av-keys button { justify-content: center; padding: 0; }
	.av-cue { top: calc(var(--tw-edge) + 92 * var(--tw-u)); max-width: calc(100vw - 24px); font-size: 10px; }
	body:has(.disaster-warning:not([hidden])) .av-cue { top: calc(var(--tw-edge) + 194 * var(--tw-u)); }
}
@media (max-height: 560px) and (min-width: 561px) {
	.av-keys { right: calc(68 * var(--tw-u)); }
}
`;

function svgEl( tag, attrs = null ) {

	const el = document.createElementNS( SVG_NS, tag );
	if ( attrs ) for ( const [ k, v ] of Object.entries( attrs ) ) el.setAttribute( k, String( v ) );
	return el;

}

function makeTransform( svg, el ) {

	const t = svg.createSVGTransform();
	el.transform.baseVal.initialize( t );
	return t;

}

export class FlightHud {

	constructor( aviation ) {

		this.aviation = aviation;
		this.last = 0;
		this._ppd = 0;
		this._fov = 0;
		this._fpm = { x: 0, y: 0, ok: false };
		this._pose = { rot: 0, shift: 0 };
		this._icls = { locDeg: 0, gsErrDeg: 0, distance: 0, active: false };
		this._cache = {};
		this.invalidate();
		if ( typeof document !== 'undefined' && document.head ) this.build();

	}

	build() {

		const style = document.createElement( 'style' );
		style.textContent = STYLE;
		document.head.append( style );

		const root = this.hud = document.createElement( 'section' );
		root.className = 'av-hud';
		root.hidden = true;
		root.setAttribute( 'role', 'status' );
		root.setAttribute( 'aria-label', 'Flight instruments' );
		root.setAttribute( 'aria-live', 'off' );
		root.dataset.view = 'chase';
		root.innerHTML = `
			<svg class="av-glass" viewBox="-180 -150 360 300" aria-hidden="true">
				<defs>
					<clipPath id="av-clip-tape"><rect x="-66" y="-150" width="132" height="32"/></clipPath>
					<clipPath id="av-clip-ladder"><rect x="-92" y="-84" width="184" height="162"/></clipPath>
				</defs>
				<g clip-path="url(#av-clip-tape)"><g class="av-tape"></g></g>
				<path class="av-fill" d="M0 -121 l-3.6 5.5 h7.2 z"/>
				<text class="av-sm" x="0" y="-105" text-anchor="middle" data-read="heading">000</text>
				<rect x="-150" y="-10" width="48" height="20"/>
				<text class="av-big" x="-106" y="4.5" text-anchor="end" data-read="speed">0</text>
				<text class="av-xs av-dim" x="-150" y="19">M/S</text>
				<text class="av-sm" x="-150" y="32"><tspan class="av-dim">α </tspan><tspan data-read="alpha">0.0</tspan></text>
				<text class="av-sm" x="-150" y="43"><tspan class="av-dim">G </tspan><tspan data-read="g">1.0</tspan></text>
				<text class="av-sm" x="-150" y="54"><tspan class="av-dim">THR </tspan><tspan data-read="throttle">0%</tspan></text>
				<rect class="av-dim" x="-163" y="-30" width="4" height="80"/>
				<g transform="translate(-162 50)"><g class="av-thr-fill"><rect class="av-fill" x="0" y="-78" width="2" height="78"/></g></g>
				<text class="av-sm" x="150" y="-17" text-anchor="end"><tspan class="av-dim">VS </tspan><tspan data-read="sink">0.0</tspan></text>
				<rect x="102" y="-10" width="48" height="20"/>
				<text class="av-big" x="146" y="4.5" text-anchor="end" data-read="altitude">0</text>
				<text class="av-xs av-dim" x="150" y="19" text-anchor="end">M</text>
				<g class="av-conformal">
					<g clip-path="url(#av-clip-ladder)"><g class="av-roll"><g class="av-pitch"></g></g></g>
					<path d="M-16 0 H-7 L-4 5 L0 -1 L4 5 L7 0 H16"/>
					<g class="av-fpm"><circle r="4.5"/><path d="M-13 0 H-4.5 M4.5 0 H13 M0 -4.5 V-10"/></g>
					<g class="av-bracket"><path d="M-22 -9 H-19 V9 H-22 M-19 0 H-16"/></g>
					<path class="av-dim" d="M-62.2 62.2 A88 88 0 0 0 62.2 62.2"/>
					<g class="av-bank-ticks"></g>
					<g class="av-bank-ptr"><path class="av-fill" d="M0 82 l-3.2 -5.4 h6.4 z"/></g>
					<g class="av-icls"><path class="av-loc" d="M0 -40 V40"/><path class="av-gs" d="M-40 0 H40"/></g>
				</g>
			</svg>
			<p class="av-cue"><span class="av-phase"></span><span class="av-note"></span></p>
			<div class="av-keys" role="toolbar" aria-label="Flight controls">
				<button type="button" data-act="gear" aria-label="Landing gear" aria-keyshortcuts="G" aria-pressed="true" title="Landing gear (G)"><kbd>G</kbd><span>Gear</span></button>
				<button type="button" data-act="hook" aria-label="Arrestor hook" aria-keyshortcuts="H" aria-pressed="false" title="Arrestor hook (H)"><kbd>H</kbd><span>Hook</span></button>
				<button type="button" data-act="flaps" aria-label="Cycle flaps" aria-keyshortcuts="V" data-level="1" title="Cycle flaps (V)"><kbd>V</kbd><span>Flaps</span></button>
				<button type="button" data-act="brake" aria-label="Wheel brake" aria-keyshortcuts="B" aria-pressed="true" title="Wheel brake (B, hold Space)"><kbd>B</kbd><span>Brake</span></button>
				<button type="button" data-act="camera" aria-label="Cockpit view" aria-keyshortcuts="C" aria-pressed="false" title="Cockpit view (C)"><kbd>C</kbd><span>View</span></button>
				<button type="button" data-act="reset" aria-label="Reset aircraft" aria-keyshortcuts="R" title="Reset aircraft (R)"><kbd>R</kbd><span>Reset</span></button>
				<button type="button" data-act="leave" aria-label="Leave aviation" aria-keyshortcuts="E" title="Leave aviation (E)"><kbd>E</kbd><span>Leave</span></button>
				<button type="button" data-act="wheel" aria-label="Activity Wheel" aria-keyshortcuts="M" title="Activity Wheel (M)"><kbd>M</kbd><span>Wheel</span></button>
			</div>`;
		document.body.append( root );

		const $ = sel => root.querySelector( sel );
		this.svg = $( '.av-glass' );
		this.tapeEl = $( '.av-tape' );
		this.pitchEl = $( '.av-pitch' );
		this.fpmEl = $( '.av-fpm' );
		this.cueEl = $( '.av-cue' );
		this.phaseEl = $( '.av-phase' );
		this.noteEl = $( '.av-note' );
		this.reads = {
			heading: $( '[data-read=heading]' ),
			speed: $( '[data-read=speed]' ),
			alpha: $( '[data-read=alpha]' ),
			g: $( '[data-read=g]' ),
			throttle: $( '[data-read=throttle]' ),
			sink: $( '[data-read=sink]' ),
			altitude: $( '[data-read=altitude]' ),
		};
		this.btns = {
			gear: $( '[data-act=gear]' ),
			hook: $( '[data-act=hook]' ),
			flaps: $( '[data-act=flaps]' ),
			brake: $( '[data-act=brake]' ),
			camera: $( '[data-act=camera]' ),
		};

		this.tTape = makeTransform( this.svg, this.tapeEl );
		this.tThr = makeTransform( this.svg, $( '.av-thr-fill' ) );
		this.tRoll = makeTransform( this.svg, $( '.av-roll' ) );
		this.tPitch = makeTransform( this.svg, this.pitchEl );
		this.tFpm = makeTransform( this.svg, this.fpmEl );
		this.tBracket = makeTransform( this.svg, $( '.av-bracket' ) );
		this.tBankPtr = makeTransform( this.svg, $( '.av-bank-ptr' ) );
		this.tLoc = makeTransform( this.svg, $( '.av-loc' ) );
		this.tGs = makeTransform( this.svg, $( '.av-gs' ) );

		this.buildHeadingTape();
		this.buildBankTicks( $( '.av-bank-ticks' ) );
		this.buildPitchLadder( 12.3 );

		const keys = $( '.av-keys' );
		keys.addEventListener( 'pointerdown', e => e.stopPropagation() );
		keys.addEventListener( 'click', e => {

			const btn = e.target.closest( '[data-act]' );
			if ( ! btn ) return;
			const act = btn.dataset.act;
			btn.blur();
			if ( act === 'wheel' ) {

				this.aviation.app.radialMenu?.show?.( { mode: 'tap' } );
				return;

			}
			this.aviation.command( act );
			this.aviation.app.engine?.domElement?.focus?.();

		} );
		window.addEventListener( 'resize', () => { this._ppd = 0; this.invalidate(); } );

	}

	buildHeadingTape() {

		const frag = document.createDocumentFragment();
		for ( let deg = - 40; deg <= 400; deg += 5 ) {

			const x = deg * 2, major = deg % 10 === 0;
			frag.append( svgEl( 'line', { x1: x, y1: major ? - 130 : - 128, x2: x, y2: - 124 } ) );
			if ( major ) {

				const label = String( ( ( ( deg % 360 ) + 360 ) % 360 ) / 10 ).padStart( 2, '0' );
				const t = svgEl( 'text', { class: 'av-sm', x, y: - 133, 'text-anchor': 'middle' } );
				t.textContent = label;
				frag.append( t );

			}

		}
		this.tapeEl.append( frag );

	}

	buildBankTicks( parent ) {

		const frag = document.createDocumentFragment();
		for ( const deg of [ - 45, - 30, - 20, - 10, 0, 10, 20, 30, 45 ] ) {

			const a = deg * Math.PI / 180, s = Math.sin( a ), c = Math.cos( a );
			const r0 = 88, r1 = deg % 30 === 0 || deg === 45 || deg === - 45 ? 93.5 : 91;
			frag.append( svgEl( 'line', {
				x1: ( r0 * s ).toFixed( 1 ), y1: ( r0 * c ).toFixed( 1 ),
				x2: ( r1 * s ).toFixed( 1 ), y2: ( r1 * c ).toFixed( 1 ),
			} ) );

		}
		parent.append( frag );

	}

	buildPitchLadder( ppd ) {

		this._ppd = ppd;
		this.pitchEl.textContent = '';
		const frag = document.createDocumentFragment();
		// Horizon line
		frag.append( svgEl( 'path', { d: 'M-90 0 H-14 M14 0 H90' } ) );
		for ( let deg = - 90; deg <= 90; deg += 5 ) {

			if ( deg === 0 ) continue;
			const y = - deg * ppd;
			const tip = deg > 0 ? y + 4 : y - 4;
			const p = svgEl( 'path', { d: `M-44 ${ y.toFixed( 1 ) } H-16 V${ tip.toFixed( 1 ) } M16 ${ y.toFixed( 1 ) } H44 V${ tip.toFixed( 1 ) }` } );
			if ( deg < 0 ) p.setAttribute( 'class', 'av-neg' );
			frag.append( p );
			const txt = String( Math.abs( deg ) );
			for ( const sx of [ - 48, 48 ] ) {

				const t = svgEl( 'text', { class: 'av-xs', x: sx, y: ( y + 2.4 ).toFixed( 1 ), 'text-anchor': sx < 0 ? 'end' : 'start' } );
				t.textContent = txt;
				frag.append( t );

			}

		}
		this.pitchEl.append( frag );

	}

	measurePpd() {

		if ( ! this.svg ) return 12.3;
		const app = this.aviation.app;
		const fov = app.camera?.fov || 62;
		if ( this._ppd > 0 && fov === this._fov ) return this._ppd;
		this._fov = fov;
		const canvas = app.engine?.domElement;
		const cRect = canvas?.getBoundingClientRect?.();
		const gRect = this.svg.getBoundingClientRect();
		const ch = cRect?.height > 10 ? cRect.height : window.innerHeight;
		const gw = gRect.width > 10 ? gRect.width : Math.min( 376, window.innerWidth - 28 );
		const f = ( ch * 0.5 ) / Math.tan( ( fov * Math.PI ) / 360 );
		const s = gw / 360;
		const ppd = clamp( ( f * Math.PI / 180 ) / s, 4, 30 );
		if ( Math.abs( ppd - this._ppd ) > 0.05 ) this.buildPitchLadder( ppd );
		return this._ppd;

	}

	invalidate() {

		const c = this._cache;
		c.heading = c.speed = c.alpha = c.g = c.throttle = c.sink = c.altitude = NaN;
		c.view = c.phase = c.note = '';
		c.warn = c.approach = c.bracket = c.fpmOff = c.fpmLim = null;
		c.gear = c.hook = c.brake = c.cockpit = null;
		c.flaps = - 1;
		this.last = 1;

	}

	update( dt ) {

		if ( ! this.hud ) return;
		const a = this.aviation, f = a.flight, m = f.metrics, c = a.carrier.metrics;
		const show = !! a.pilot;
		if ( this.hud.hidden === show ) {

			this.hud.hidden = ! show;
			if ( show ) { this._ppd = 0; this.invalidate(); }

		}
		if ( ! show ) return;

		// ---- per-frame smooth SVGTransform updates (zero heap allocation)
		const hdg = compassHeading( m );
		this.tTape.setTranslate( - hdg * 2, 0 );
		this.tThr.setScale( 1, clamp( f.controls.throttle, 0, 1 ) );

		const runway = a.carrier.runway( f.position );
		const icls = iclsDeviation( runway, f.phase, this._icls );
		const cockpit = a.camMode === 'cockpit';
		const cache = this._cache;

		if ( cockpit ) {

			const ppd = this.measurePpd();
			const pose = ladderPose( m, ppd, this._pose );
			this.tRoll.setRotate( pose.rot, 0, 0 );
			this.tPitch.setTranslate( 0, pose.shift );
			this.tBankPtr.setRotate( pose.rot, 0, 0 );

			const fpm = projectVelocity( f.quaternion, f.velocity, ppd, this._fpm );
			const fpmOff = ! fpm.ok || ( m.contacts > 0 && m.speed < 25 );
			if ( fpmOff !== cache.fpmOff ) { cache.fpmOff = fpmOff; this.fpmEl.classList.toggle( 'is-off', fpmOff ); }
			if ( ! fpmOff ) {

				const cx = clamp( fpm.x, - 90, 90 ), cy = clamp( fpm.y, - 90, 90 );
				const lim = cx !== fpm.x || cy !== fpm.y;
				if ( lim !== cache.fpmLim ) { cache.fpmLim = lim; this.fpmEl.classList.toggle( 'is-limited', lim ); }
				this.tFpm.setTranslate( cx, cy );
				if ( icls.active && f.controls.gear ) {

					const alphaErr = m.alpha * DEG - ON_SPEED_ALPHA_DEG;
					this.tBracket.setTranslate( cx, clamp( cy + alphaErr * 7.5, - 90, 90 ) );

				}

			}
			if ( icls.active ) {

				this.tLoc.setTranslate( clamp( icls.locDeg / 3, - 1, 1 ) * 60, 0 );
				this.tGs.setTranslate( 0, clamp( icls.gsErrDeg, - 1, 1 ) * 60 );

			}

		}

		// ---- 80 ms discrete readouts, LED states, cue line and Playwright telemetry attributes
		this.last += dt;
		if ( this.last < 0.08 && dt > 0 ) return;
		this.last = 0;

		const view = cockpit ? 'cockpit' : 'chase';
		if ( view !== cache.view ) { cache.view = view; this.hud.dataset.view = view; }
		const approach = icls.active;
		if ( approach !== cache.approach ) { cache.approach = approach; this.hud.classList.toggle( 'is-approach', approach ); }
		const bracket = approach && !! f.controls.gear;
		if ( bracket !== cache.bracket ) { cache.bracket = bracket; this.hud.classList.toggle( 'is-bracket', bracket ); }

		const hdgInt = Math.round( hdg ) % 360;
		if ( hdgInt !== cache.heading ) { cache.heading = hdgInt; this.reads.heading.textContent = hdgStr( hdgInt ); }
		const spdInt = Math.round( m.speed );
		if ( spdInt !== cache.speed ) { cache.speed = spdInt; this.reads.speed.textContent = intStr( spdInt ); }
		const altInt = Math.round( f.position[ 1 ] );
		if ( altInt !== cache.altitude ) { cache.altitude = altInt; this.reads.altitude.textContent = intStr( altInt ); }
		const alpha10 = Math.round( m.alpha * DEG * 10 );
		if ( alpha10 !== cache.alpha ) { cache.alpha = alpha10; this.reads.alpha.textContent = tenthStr( alpha10 / 10 ); }
		const g10 = Math.round( m.loadFactor * 10 );
		if ( g10 !== cache.g ) { cache.g = g10; this.reads.g.textContent = tenthStr( g10 / 10 ); }
		const thrPct = Math.round( f.controls.throttle * 100 );
		if ( thrPct !== cache.throttle ) { cache.throttle = thrPct; this.reads.throttle.textContent = pctStr( f.controls.throttle ); }
		const vsVal = Math.abs( f.velocity[ 1 ] ) < 0.05 ? 0 : f.velocity[ 1 ];
		const vs10 = Math.round( vsVal * 10 );
		if ( vs10 !== cache.sink ) { cache.sink = vs10; this.reads.sink.textContent = tenthStr( vs10 / 10 ); }

		// Cue line: stall warning -> approach guidance -> flight reason (preserves exact test strings).
		const phaseText = PHASE_LABELS[ f.phase ] || f.phase;
		if ( phaseText !== cache.phase ) { cache.phase = phaseText; this.phaseEl.textContent = phaseText; }
		const stalled = ! ( f.phase === 'crashed' || f.phase === 'ditched' || f.phase === 'arrested' ) && m.stall && m.speed > 25;
		const note = stalled
			? 'STALL · lower the nose and add power'
			: approach
				? `${ icls.distance.toFixed( 0 ) } m to stern · ${ Math.abs( runway.cross ).toFixed( 1 ) } m ${ runway.cross < 0 ? 'right' : 'left' } · ${ ( icls.gsErrDeg + 3.5 ).toFixed( 1 ) }° glide`
				: f.reason;
		if ( note !== cache.note ) { cache.note = note; this.noteEl.textContent = note; }
		const warn = stalled || f.phase === 'crashed' || f.phase === 'ditched';
		if ( warn !== cache.warn ) { cache.warn = warn; this.cueEl.classList.toggle( 'is-warn', warn ); }

		// Live shortcut strip LED states (always synced to aircraft controls, including auto-retract after launch).
		const ctrl = f.controls;
		const gearOn = !! ctrl.gear;
		if ( gearOn !== cache.gear ) { cache.gear = gearOn; this.btns.gear.setAttribute( 'aria-pressed', String( gearOn ) ); }
		const hookOn = !! ctrl.hook;
		if ( hookOn !== cache.hook ) { cache.hook = hookOn; this.btns.hook.setAttribute( 'aria-pressed', String( hookOn ) ); }
		const brakeOn = !! ctrl.brake;
		if ( brakeOn !== cache.brake ) { cache.brake = brakeOn; this.btns.brake.setAttribute( 'aria-pressed', String( brakeOn ) ); }
		if ( cockpit !== cache.cockpit ) { cache.cockpit = cockpit; this.btns.camera.setAttribute( 'aria-pressed', String( cockpit ) ); }
		const flapLvl = ctrl.flaps < 0.3 ? 0 : ctrl.flaps < 0.9 ? 1 : 2;
		if ( flapLvl !== cache.flaps ) { cache.flaps = flapLvl; this.btns.flaps.dataset.level = String( flapLvl ); }

		// Machine-readable telemetry attributes consumed by Playwright specs.
		const el = this.hud;
		const deckSpeed = length( sub( f.velocity, a.carrier.velocityAt( f.position ) ) );
		el.setAttribute( 'data-phase', f.phase );
		el.setAttribute( 'data-speed', m.speed.toFixed( 5 ) );
		el.setAttribute( 'data-deck-speed', deckSpeed.toFixed( 5 ) );
		el.setAttribute( 'data-contacts', m.contacts.toFixed( 5 ) );
		el.setAttribute( 'data-model-parts', a.modelParts.toFixed( 5 ) );
		el.setAttribute( 'data-gear', ctrl.gear ? 'down' : 'up' );
		el.setAttribute( 'data-hook', ctrl.hook ? 'down' : 'up' );
		el.setAttribute( 'data-q', m.q.toFixed( 5 ) );
		el.setAttribute( 'data-lift', m.lift.toFixed( 5 ) );
		el.setAttribute( 'data-drag', m.drag.toFixed( 5 ) );
		el.setAttribute( 'data-thrust', m.thrust.toFixed( 5 ) );
		el.setAttribute( 'data-alpha', ( m.alpha * DEG ).toFixed( 5 ) );
		el.setAttribute( 'data-heading', hdg.toFixed( 5 ) );
		el.setAttribute( 'data-bank', ( - m.bank * DEG ).toFixed( 5 ) );
		el.setAttribute( 'data-catapult-run', m.catapultRun.toFixed( 5 ) );
		el.setAttribute( 'data-cable-energy', m.cableEnergy.toFixed( 5 ) );
		el.setAttribute( 'data-peak-cable-force', m.peakCableForce.toFixed( 5 ) );
		el.setAttribute( 'data-landing-distance', m.landingDistance.toFixed( 5 ) );
		el.setAttribute( 'data-deck-sink', m.deckSink.toFixed( 5 ) );
		el.setAttribute( 'data-x', f.position[ 0 ].toFixed( 5 ) );
		el.setAttribute( 'data-y', f.position[ 1 ].toFixed( 5 ) );
		el.setAttribute( 'data-z', f.position[ 2 ].toFixed( 5 ) );
		el.setAttribute( 'data-carrier-heave', c.heave.toFixed( 5 ) );
		el.setAttribute( 'data-carrier-roll', ( c.roll * DEG ).toFixed( 5 ) );
		el.setAttribute( 'data-carrier-wind-force', c.windForce.toFixed( 5 ) );

	}

}
