import { Vector3 } from '../engine/index.js';
import { WORLD } from '../world/WorldLayout.js';
import { BRIDGE } from '../world/StraitBridge.js';
import { AIRCRAFT_NAME, APPROACH } from '../aviation/Constants.js';

// BeamNG-style frosted-glass radial Activity Wheel for Tidewater's open-world holiday sandbox.
// Hold M (or Tab) to flick and release, tap M to latch open and click, or tap the compact
// top-left Activities button. Replaces the permanent top-left WorldTools debug bar and on-foot car card.
export const RADIAL_WEDGE_IDS = Object.freeze( [ 'drive', 'water', 'air', 'world', 'ride', 'places' ] );
const DEADZONE = 46;
const HOLD_MS = 180;
const R_IN = 52;
const R_OUT = 164;
const CX = 180;
const CY = 180;

// Pure sector resolver: angle clockwise from 12 o'clock, centered on each wedge.
// Returns -1 inside the deadzone hub (cancel or back).
export function pickRadialSector( dx, dy, count = 6, deadzone = DEADZONE ) {

	if ( ! Number.isFinite( dx + dy ) || count <= 0 ) return - 1;
	if ( Math.hypot( dx, dy ) < deadzone ) return - 1;
	const sector = ( Math.PI * 2 ) / count;
	let angle = Math.atan2( dx, - dy );
	if ( angle < 0 ) angle += Math.PI * 2;
	return Math.floor( ( ( angle + sector * 0.5 ) % ( Math.PI * 2 ) ) / sector ) % count;

}

const ICONS = {
	drive: '<path d="M5 14l1.5-4.5A2 2 0 0 1 8.4 8h7.2a2 2 0 0 1 1.9 1.5L19 14M4 14h16v3.5a.5.5 0 0 1-.5.5H18a1.5 1.5 0 0 1-3 0H9a1.5 1.5 0 0 1-3 0H4.5a.5.5 0 0 1-.5-.5V14Z"/><circle cx="7.5" cy="14" r="1"/><circle cx="16.5" cy="14" r="1"/>',
	water: '<path d="M2 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/><path d="M4 11l3-4h6l4 4"/>',
	air: '<path d="M12 3l2.5 6.5L21 12l-6.5 2L12 21l-2.5-7L3 12l6.5-2.5L12 3Z"/>',
	world: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
	ride: '<path d="M4 12a8 8 0 1 1 2.3 5.7"/><path d="M4 17v-5h5"/>',
	places: '<path d="M12 21s6-5.7 6-10.5a6 6 0 1 0-12 0C6 15.3 12 21 12 21Z"/><circle cx="12" cy="10.5" r="2.2"/>',
	back: '<path d="M15 6l-6 6 6 6"/>',
	menu: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 4v5.5M12 14.5V20M4 12h5.5M14.5 12H20"/>',
};

const CSS = /* css */`
.tw-act-btn {
	position: fixed; z-index: 112; left: var(--tw-edge); top: calc(var(--tw-edge) + 46 * var(--tw-u));
	display: inline-flex; align-items: center; gap: calc(7 * var(--tw-u));
	height: calc(32 * var(--tw-u)); padding: 0 calc(12 * var(--tw-u)) 0 calc(9 * var(--tw-u));
	border-radius: 999px; border: 1px solid var(--tw-line);
	background: linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0) 45%), var(--tw-glass);
	color: var(--tw-ink); font: 600 var(--tw-fs-sm) var(--tw-font); letter-spacing: 0.01em;
	-webkit-backdrop-filter: blur(18px) saturate(1.5); backdrop-filter: blur(18px) saturate(1.5);
	box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 24px -10px rgba(0,0,0,0.55);
	cursor: pointer; transition: background var(--tw-fast) var(--tw-ease), border-color var(--tw-fast) var(--tw-ease), transform var(--tw-fast) var(--tw-ease);
}
.tw-act-btn:hover, .tw-act-btn[aria-expanded='true'] {
	background: rgba(var(--tw-aqua-rgb), 0.16); border-color: rgba(var(--tw-aqua-rgb), 0.45);
}
.tw-act-btn svg { width: calc(15 * var(--tw-u)); height: calc(15 * var(--tw-u)); color: var(--tw-aqua); flex: none; }
.tw-act-btn kbd {
	font: 600 var(--tw-fs-xs) var(--tw-mono); color: var(--tw-ink-2);
	padding: 1px calc(5 * var(--tw-u)); border-radius: calc(4 * var(--tw-u));
	border: 1px solid var(--tw-line-2); background: rgba(255,255,255,0.06);
}
body:has(.tw-root.is-starting) .tw-act-btn,
body:has(.tw-root.is-photo) .tw-act-btn { display: none !important; }
body:has(.disaster-warning:not([hidden])) .tw-act-btn { top: calc(var(--tw-edge) + 92 * var(--tw-u)); }

.tw-radial {
	position: fixed; inset: 0; z-index: 160; display: grid; place-items: center;
	background: radial-gradient(circle at 50% 50%, rgba(4, 14, 24, 0.22), rgba(4, 10, 18, 0.56));
	-webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px);
	opacity: 0; visibility: hidden; pointer-events: none;
	transition: opacity 150ms var(--tw-ease), visibility 0s linear 150ms;
}
.tw-radial.is-open {
	opacity: 1; visibility: visible; pointer-events: auto;
	transition: opacity 150ms var(--tw-ease), visibility 0s;
}
.tw-radial-wheel {
	position: relative; width: min(392px, 90vmin); height: min(392px, 90vmin);
	transform: scale(0.92); transition: transform 180ms var(--tw-ease);
	user-select: none; -webkit-user-select: none;
}
.tw-radial.is-open .tw-radial-wheel { transform: scale(1); }
.tw-radial-svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 18px 38px rgba(0, 0, 0, 0.55)); }
.tw-radial-wedge {
	fill: rgba(11, 23, 34, 0.84); stroke: rgba(255, 255, 255, 0.13); stroke-width: 1.25;
	cursor: pointer; transition: fill 110ms ease, stroke 110ms ease, transform 110ms ease;
	transform-origin: 180px 180px;
}
.tw-radial-wedge.is-hot {
	fill: rgba(24, 72, 86, 0.92); stroke: rgba(95, 227, 212, 0.85); stroke-width: 1.8;
	transform: scale(1.028);
}
.tw-radial-items { position: absolute; inset: 0; pointer-events: none; }
.tw-radial-item {
	position: absolute; transform: translate(-50%, -50%);
	display: flex; flex-direction: column; align-items: center; gap: 3px;
	padding: 4px 6px; border: 0; border-radius: 10px; background: none;
	color: rgba(235, 245, 250, 0.88); font: 600 12px/1.15 var(--tw-font); text-align: center;
	pointer-events: auto; cursor: pointer; max-width: 86px;
	transition: color 100ms ease, transform 100ms ease;
}
.tw-radial-item.is-hot { color: #ffffff; transform: translate(-50%, -50%) scale(1.06); }
.tw-radial-item svg { width: 18px; height: 18px; color: var(--tw-aqua); opacity: 0.9; }
.tw-radial-item.is-hot svg { color: var(--tw-sun); opacity: 1; }
.tw-radial-item small { font: 500 10px/1 var(--tw-mono); color: rgba(190, 218, 228, 0.62); }
.tw-radial-hub {
	position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
	width: 28%; height: 28%; border-radius: 50%;
	display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 8px;
	border: 1.5px solid rgba(255, 255, 255, 0.16);
	background: radial-gradient(circle at 35% 30%, rgba(22, 42, 56, 0.94), rgba(8, 16, 24, 0.96));
	color: var(--tw-ink); text-align: center; cursor: pointer;
	box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 8px 20px rgba(0,0,0,0.45);
	transition: border-color 110ms ease, background 110ms ease;
}
.tw-radial-hub:hover { border-color: rgba(95, 227, 212, 0.55); }
.tw-radial-hub-eyebrow {
	font: 700 8.5px/1.15 var(--tw-font); letter-spacing: 0.12em; text-transform: uppercase; color: var(--tw-sun);
}
.tw-radial-hub-title {
	font: 600 12px/1.15 var(--tw-font); color: #fff; max-width: 100%; overflow: hidden; text-overflow: ellipsis;
}
.tw-radial-hint {
	position: absolute; left: 50%; bottom: -34px; transform: translateX(-50%); white-space: nowrap;
	padding: 4px 12px; border-radius: 999px; background: rgba(8, 16, 24, 0.78); border: 1px solid rgba(255,255,255,0.1);
	color: rgba(210, 228, 236, 0.78); font: 500 11px/1.2 var(--tw-font);
}
.tw-radial-hint kbd { font: 600 10px var(--tw-mono); color: var(--tw-aqua); padding: 0 3px; }
@media (max-width: 700px) {
	.tw-act-btn, body:has(.disaster-warning:not([hidden])) .tw-act-btn { left: 12px; top: 54px; }
	.tw-radial-item { font-size: 11px; max-width: 76px; }
}
@media (prefers-reduced-motion: reduce) {
	.tw-radial, .tw-radial-wheel, .tw-radial-wedge, .tw-radial-item { transition: none !important; }
}
`;

function wedgePath( index, count ) {

	const sector = ( Math.PI * 2 ) / count;
	const gap = count >= 8 ? 0.022 : 0.032;
	const a0 = index * sector - sector * 0.5 + gap;
	const a1 = ( index + 1 ) * sector - sector * 0.5 - gap;
	const pt = ( r, a ) => [ CX + r * Math.sin( a ), CY - r * Math.cos( a ) ];
	const [ x0, y0 ] = pt( R_OUT, a0 ), [ x1, y1 ] = pt( R_OUT, a1 );
	const [ x2, y2 ] = pt( R_IN, a1 ), [ x3, y3 ] = pt( R_IN, a0 );
	const large = a1 - a0 > Math.PI ? 1 : 0;
	return `M${ x0.toFixed( 2 ) } ${ y0.toFixed( 2 ) } A${ R_OUT } ${ R_OUT } 0 ${ large } 1 ${ x1.toFixed( 2 ) } ${ y1.toFixed( 2 ) } L${ x2.toFixed( 2 ) } ${ y2.toFixed( 2 ) } A${ R_IN } ${ R_IN } 0 ${ large } 0 ${ x3.toFixed( 2 ) } ${ y3.toFixed( 2 ) } Z`;

}

export class RadialMenu {

	constructor( app ) {

		this.app = app;
		this.open = false;
		this.mode = 'tap'; // 'hold' | 'tap'
		this.openKey = null;
		this.openedAt = 0;
		this.stack = [];
		this.items = [];
		this.hovered = - 1;
		this.wedges = [];
		this.itemBtns = [];
		if ( typeof document !== 'undefined' && document.head ) this.build();

	}

	build() {

		const style = document.createElement( 'style' );
		style.textContent = CSS;
		document.head.append( style );

		const btn = this.launcher = document.createElement( 'button' );
		btn.type = 'button';
		btn.className = 'tw-act-btn tw-interactive';
		btn.setAttribute( 'aria-label', 'Activities menu' );
		btn.setAttribute( 'aria-expanded', 'false' );
		btn.setAttribute( 'aria-haspopup', 'menu' );
		btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ ICONS.menu }</svg><span>Activities</span><kbd>M</kbd>`;
		btn.addEventListener( 'pointerdown', e => e.stopPropagation() );
		btn.addEventListener( 'click', e => {

			e.stopPropagation();
			if ( this.open ) this.close();
			else this.show( { mode: 'tap' } );
			btn.blur();

		} );
		document.body.append( btn );

		const root = this.el = document.createElement( 'div' );
		root.className = 'tw-radial tw-interactive';
		root.setAttribute( 'role', 'menu' );
		root.setAttribute( 'aria-label', 'Activity Wheel' );
		root.setAttribute( 'aria-hidden', 'true' );
		root.innerHTML = `
			<div class="tw-radial-wheel">
				<svg class="tw-radial-svg" viewBox="0 0 360 360" aria-hidden="true"></svg>
				<div class="tw-radial-items"></div>
				<button type="button" class="tw-radial-hub" aria-label="Back or close">
					<span class="tw-radial-hub-eyebrow">HOLIDAY</span>
					<span class="tw-radial-hub-title">Activities</span>
				</button>
				<div class="tw-radial-hint">Flick or click · <kbd>1</kbd>-<kbd>8</kbd> · <kbd>Esc</kbd> close</div>
			</div>`;
		this.wheel = root.querySelector( '.tw-radial-wheel' );
		this.svg = root.querySelector( '.tw-radial-svg' );
		this.itemsEl = root.querySelector( '.tw-radial-items' );
		this.hub = root.querySelector( '.tw-radial-hub' );
		this.hubEyebrow = root.querySelector( '.tw-radial-hub-eyebrow' );
		this.hubTitle = root.querySelector( '.tw-radial-hub-title' );
		this.hintEl = root.querySelector( '.tw-radial-hint' );

		root.addEventListener( 'pointerdown', e => {

			e.stopPropagation();
			if ( e.target === root ) this.close();

		} );
		this.hub.addEventListener( 'click', e => {

			e.stopPropagation();
			if ( this.stack.length > 1 ) this.pop();
			else this.close();

		} );
		window.addEventListener( 'mousemove', e => this.onMove( e ) );
		window.addEventListener( 'keydown', e => this.onKeyDown( e ), true );
		window.addEventListener( 'keyup', e => this.onKeyUp( e ), true );
		document.body.append( root );

	}

	canToggleFromKey( e ) {

		const app = this.app;
		if ( app.ui?.ui?.root?.classList.contains( 'is-starting' ) ) return false;
		if ( app.game?.guide?.open || app.game?.atm?.open || app.game?.hud?.invOpen || app.game?.hud?.standOpen ) return false;
		const target = e.target;
		if ( target?.closest?.( 'input, textarea, select, [contenteditable="true"], [role="dialog"], .tw-world-panel:not([hidden]), .tw-panel.is-open' ) ) return false;
		return true;

	}

	onKeyDown( e ) {

		if ( this.open ) {

			if ( e.code === 'Escape' ) {

				e.preventDefault(); e.stopPropagation();
				this.close();
				return;

			}
			if ( e.code === 'Backspace' ) {

				e.preventDefault(); e.stopPropagation();
				if ( this.stack.length > 1 ) this.pop(); else this.close();
				return;

			}
			if ( e.code === 'KeyM' || e.code === 'Tab' ) {

				e.preventDefault(); e.stopPropagation();
				if ( ! e.repeat && this.mode === 'tap' ) this.close();
				return;

			}
			const digit = /^Digit([1-8])$/.exec( e.code );
			if ( digit && ! e.repeat ) {

				const idx = Number( digit[ 1 ] ) - 1;
				if ( idx < this.items.length ) {

					e.preventDefault(); e.stopPropagation();
					this.activate( idx );

				}
				return;

			}
			if ( e.code === 'ArrowRight' || e.code === 'ArrowDown' ) {

				e.preventDefault(); e.stopPropagation();
				this.setHover( ( this.hovered + 1 + this.items.length ) % this.items.length );
				return;

			}
			if ( e.code === 'ArrowLeft' || e.code === 'ArrowUp' ) {

				e.preventDefault(); e.stopPropagation();
				this.setHover( ( ( this.hovered < 0 ? 0 : this.hovered ) - 1 + this.items.length ) % this.items.length );
				return;

			}
			if ( e.code === 'Enter' || e.code === 'Space' ) {

				e.preventDefault(); e.stopPropagation();
				if ( this.hovered >= 0 ) this.activate( this.hovered );
				return;

			}
			return;

		}

		if ( ( e.code === 'KeyM' || e.code === 'Tab' ) && ! e.repeat && ! e.ctrlKey && ! e.metaKey && ! e.altKey && this.canToggleFromKey( e ) ) {

			e.preventDefault();
			e.stopPropagation();
			this.show( { mode: 'hold', key: e.code } );

		}

	}

	onKeyUp( e ) {

		if ( ! this.open || this.mode !== 'hold' || e.code !== this.openKey ) return;
		const held = performance.now() - this.openedAt;
		if ( this.hovered >= 0 ) {

			this.activate( this.hovered );

		} else if ( held < HOLD_MS ) {

			// Quick tap with no flick latches the menu open for clicking.
			this.mode = 'tap';

		} else {

			this.close();

		}

	}

	onMove( e ) {

		if ( ! this.open || ! this.wheel ) return;
		const r = this.wheel.getBoundingClientRect();
		const cx = r.left + r.width * 0.5, cy = r.top + r.height * 0.5;
		const deadzone = DEADZONE * ( r.width / 360 );
		this.setHover( pickRadialSector( e.clientX - cx, e.clientY - cy, this.items.length, deadzone ) );

	}

	show( { mode = 'tap', key = null } = {} ) {

		const app = this.app;
		app.worldTools?.closeAll?.();
		document.exitPointerLock?.();
		app.input?.keys?.clear();
		app.input?.pressed?.clear();
		app.input?.consumeLook?.();
		this.open = true;
		this.mode = mode;
		this.openKey = key;
		this.openedAt = performance.now();
		this.stack = [ { title: 'Activities', eyebrow: 'HOLIDAY', items: this.rootItems() } ];
		this.renderLevel();
		this.el.classList.add( 'is-open' );
		this.el.setAttribute( 'aria-hidden', 'false' );
		this.launcher?.setAttribute( 'aria-expanded', 'true' );

	}

	close() {

		if ( ! this.open ) return;
		this.open = false;
		this.openKey = null;
		this.hovered = - 1;
		this.el.classList.remove( 'is-open' );
		this.el.setAttribute( 'aria-hidden', 'true' );
		this.launcher?.setAttribute( 'aria-expanded', 'false' );
		this.app.engine?.domElement?.focus?.();

	}

	push( title, items, eyebrow = 'BACK' ) {

		this.stack.push( { title, eyebrow, items } );
		this.mode = 'tap';
		this.renderLevel();

	}

	pop() {

		if ( this.stack.length <= 1 ) return this.close();
		this.stack.pop();
		this.renderLevel();

	}

	setHover( idx ) {

		if ( idx === this.hovered ) return;
		this.hovered = idx;
		for ( let i = 0; i < this.wedges.length; i ++ ) {

			const hot = i === idx;
			this.wedges[ i ].classList.toggle( 'is-hot', hot );
			this.itemBtns[ i ]?.classList.toggle( 'is-hot', hot );

		}
		const level = this.stack.at( - 1 );
		if ( idx >= 0 && this.items[ idx ] ) {

			this.hubEyebrow.textContent = this.items[ idx ].sub || ( this.stack.length > 1 ? level.title : 'HOLIDAY' );
			this.hubTitle.textContent = this.items[ idx ].label;

		} else {

			this.hubEyebrow.textContent = this.stack.length > 1 ? '‹ BACK' : level.eyebrow;
			this.hubTitle.textContent = level.title;

		}

	}

	activate( idx ) {

		const item = this.items[ idx ];
		if ( ! item ) return;
		if ( item.children ) {

			const kids = typeof item.children === 'function' ? item.children() : item.children;
			this.push( item.label, kids );
			return;

		}
		this.close();
		item.act?.();

	}

	renderLevel() {

		const level = this.stack.at( - 1 );
		this.items = level.items;
		this.hovered = - 1;
		this.hubEyebrow.textContent = this.stack.length > 1 ? '‹ BACK' : level.eyebrow;
		this.hubTitle.textContent = level.title;
		this.svg.innerHTML = '';
		this.itemsEl.innerHTML = '';
		this.wedges = [];
		this.itemBtns = [];

		const count = this.items.length;
		const rLabel = ( R_IN + R_OUT ) * ( count >= 8 ? 0.55 : 0.52 );
		const sector = ( Math.PI * 2 ) / count;
		const ns = 'http://www.w3.org/2000/svg';

		for ( let i = 0; i < count; i ++ ) {

			const item = this.items[ i ];
			const path = document.createElementNS( ns, 'path' );
			path.setAttribute( 'd', wedgePath( i, count ) );
			path.setAttribute( 'class', 'tw-radial-wedge' );
			path.addEventListener( 'mouseenter', () => this.setHover( i ) );
			path.addEventListener( 'click', e => { e.stopPropagation(); this.activate( i ); } );
			this.svg.append( path );
			this.wedges.push( path );

			const angle = i * sector;
			const lx = ( ( CX + rLabel * Math.sin( angle ) ) / 360 ) * 100;
			const ly = ( ( CY - rLabel * Math.cos( angle ) ) / 360 ) * 100;
			const b = document.createElement( 'button' );
			b.type = 'button';
			b.className = 'tw-radial-item';
			b.setAttribute( 'role', 'menuitem' );
			b.setAttribute( 'aria-label', item.label );
			if ( item.key ) b.setAttribute( 'aria-keyshortcuts', item.key );
			b.style.left = `${ lx.toFixed( 2 ) }%`;
			b.style.top = `${ ly.toFixed( 2 ) }%`;
			const ico = item.icon && ICONS[ item.icon ]
				? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ ICONS[ item.icon ] }</svg>`
				: '';
			const keyTag = item.key ? `<small>${ item.key }</small>` : '';
			b.innerHTML = `${ ico }<span>${ item.label }</span>${ keyTag }`;
			b.addEventListener( 'mouseenter', () => this.setHover( i ) );
			b.addEventListener( 'click', e => { e.stopPropagation(); this.activate( i ); } );
			this.itemsEl.append( b );
			this.itemBtns.push( b );

		}

	}

	// ---- activity actions wired to shared systems ----

	driveCar( vehicleKey, destination = null ) {

		const app = this.app, r = app.rally;
		if ( ! r ) return;
		if ( app.chairlift?.active ) return app.chairlift.message?.( 'Exit the chairlift at a terminal before driving.' );
		app.aviation?.leave();
		app.glider?.leave();
		if ( app.jetskis?.riding ) app.jetskis.dismount();
		if ( destination ) r.destination = destination;
		if ( vehicleKey && vehicleKey !== r.vehicleKey ) r.selectVehicle( vehicleKey );
		else if ( destination ) r.reset();
		if ( ! r.active ) r.enter();

	}

	openTool( id ) {

		const tool = this.app.worldTools?.tools?.get( id );
		if ( tool ) tool.open();

	}

	aviationAct( fn ) {

		const app = this.app;
		if ( ! app.aviation ) return;
		if ( app.chairlift?.active ) return app.chairlift.message?.( 'Exit the chairlift at a terminal before changing activities.' );
		fn( app.aviation );

	}

	hornetItems() {

		const a = this.app.aviation;
		const ready = a?.flight?.phase === 'ready';
		return [
			{ label: `Fly ${ AIRCRAFT_NAME.short }`, sub: ready ? 'Hold W to launch' : 'Take the controls', icon: 'air', act: () => this.aviationAct( av => av.enter() ) },
			{ label: 'Landing Approach', sub: `${ APPROACH.distance } m astern`, icon: 'air', act: () => this.aviationAct( av => av.approach() ) },
			{ label: 'Walk Flight Deck', sub: 'Stroll the carrier', icon: 'places', act: () => this.aviationAct( av => av.walkDeck() ) },
			{ label: 'Inspect', sub: 'Carrier & jet views', icon: 'air', children: () => this.inspectItems() },
		];

	}

	inspectItems() {

		return [
			{ label: 'Whole Carrier', sub: '320 m flight deck', act: () => this.aviationAct( av => av.visit( 'carrier' ) ) },
			{ label: 'Flight Deck', sub: 'Catapult & wires', act: () => this.aviationAct( av => av.visit( 'deck' ) ) },
			{ label: 'Bridge', sub: 'Island tower', act: () => this.aviationAct( av => av.visit( 'bridge' ) ) },
			{ label: AIRCRAFT_NAME.short, sub: AIRCRAFT_NAME.full, act: () => this.aviationAct( av => av.visit( 'fighter' ) ) },
		];

	}

	teleport( x, z, yaw, label, { swim = false } = {} ) {

		const app = this.app, p = app.player;
		if ( ! p ) return;
		if ( app.chairlift?.active ) return app.chairlift.message?.( 'Exit the chairlift at a terminal before moving.' );
		app.aviation?.leave();
		app.glider?.leave();
		if ( app.rally?.active ) app.rally.leave();
		if ( app.jetskis?.riding ) app.jetskis.dismount();
		app.setFreeCam?.( false );
		const y = swim ? ( p.waterH ?? 0 ) - 0.25 : app.terrainData.heightAt( x, z ) + 0.1;
		p.mode = swim ? 'swim' : 'walk';
		p.position.set( x, y, z );
		p.velocity.set( 0, 0, 0 );
		p.yaw = yaw;
		p.pitch = - 0.06;
		p.grounded = ! swim;
		p._camY = null;
		app.cameraCut?.();
		if ( label ) app.ui?.ui?.toast?.( label );

	}

	rideJetski( { rocket = false } = {} ) {

		const app = this.app, js = app.jetskis;
		if ( ! js ) return;
		if ( app.chairlift?.active ) return app.chairlift.message?.( 'Exit the chairlift at a terminal before riding a jetski.' );
		app.aviation?.leave();
		app.glider?.leave();
		if ( app.rally?.active ) app.rally.leave();
		app.setFreeCam?.( false );
		const ski = js.live || js.skis?.[ 0 ];
		if ( ! ski ) return;
		if ( rocket && js.ctl ) js.ctl.fuel = 1;
		js.mount( ski );
		app.ui?.ui?.toast?.( rocket ? 'Rocket jetski ready · hold X to boost!' : 'Jetski ready · W throttle · Space hop' );

	}

	boardBoat() {

		const app = this.app, p = app.player, b = app.boatCtl;
		if ( ! p || ! b ) return;
		if ( app.chairlift?.active ) return app.chairlift.message?.( 'Exit the chairlift at a terminal before boarding.' );
		app.aviation?.leave();
		app.glider?.leave();
		if ( app.rally?.active ) app.rally.leave();
		if ( app.jetskis?.riding ) app.jetskis.dismount();
		app.setFreeCam?.( false );
		p.boardBoat?.();
		app.ui?.ui?.toast?.( 'Aboard the boat · E at wheel to drive' );

	}

	boardFerry() {

		const app = this.app, f = app.ferry, p = app.player;
		if ( ! f?.ship || ! p ) return;
		if ( app.chairlift?.active ) return app.chairlift.message?.( 'Exit the chairlift at a terminal before boarding.' );
		app.aviation?.leave();
		app.glider?.leave();
		if ( app.rally?.active ) app.rally.leave();
		if ( app.jetskis?.riding ) app.jetskis.dismount();
		app.setFreeCam?.( false );
		const st = f.deck?.stations?.ViewingDeck || f.deck?.stations?.CarDeck;
		const dock = f.ship.toWorld( st ? st.clone() : new Vector3( 0, 2.6, - 10 ), new Vector3() );
		p.position.copy( dock );
		if ( f.deck?.board ) f.deck.board( p, dock );
		app.ui?.ui?.toast?.( 'Aboard Tidewater Spirit · walk up to the bridge for the helm' );

	}

	setTime( hour, label ) {

		const app = this.app;
		app.settings.timeOfDay = hour;
		app.updateSun?.();
		app.ui?.ui?.toast?.( label );

	}

	rootItems() {

		const app = this.app;
		return [
			{
				id: 'drive', label: 'Drive', sub: '9.4 km roads & cars', icon: 'drive',
				children: () => [
					{ label: 'Suspension Bridge', sub: 'Strait bridge', icon: 'drive', act: () => this.driveCar( null, 'straitBridge' ) },
					{ label: 'COSIER GT3 RS', sub: 'Flat-six GT3', icon: 'drive', act: () => this.driveCar( 'gt3rs' ) },
					{ label: 'GT3RS ZRY', sub: 'Track GT3', icon: 'drive', act: () => this.driveCar( 'gt3rszry' ) },
					{ label: 'Fulmine V10', sub: 'V10 supercar', icon: 'drive', act: () => this.driveCar( 'fulmine' ) },
					{ label: 'Corsaire W16', sub: 'W16 hypercar', icon: 'drive', act: () => this.driveCar( 'corsaire' ) },
					{ label: 'Aster RS', sub: 'Rally coupe', icon: 'drive', act: () => this.driveCar( 'aster' ) },
					{ label: 'Ridgeback 4x4', sub: 'Lifted V8 4x4', icon: 'drive', act: () => this.driveCar( 'jeep' ) },
					{
						label: 'Roads & More', sub: 'Highways & cars', icon: 'places',
						children: () => [
							{ label: 'North Coast Hwy', sub: 'Island perimeter', act: () => this.driveCar( null, 'northCoast' ) },
							{ label: 'Mountain Pass', sub: 'Switchback touge', act: () => this.driveCar( null, 'mountainPass' ) },
							{ label: 'Rainforest Rally', sub: 'Gravel special stage', act: () => this.driveCar( null, 'rallyStage' ) },
							{ label: 'West Headland', sub: 'Cliff loop', act: () => this.driveCar( null, 'westHeadland' ) },
							{ label: 'Joey Island', sub: 'South island roads', act: () => this.driveCar( null, 'joeyLoop' ) },
							{ label: 'Joey Peninsula', sub: 'East headland', act: () => this.driveCar( null, 'joeyPeninsula' ) },
							{ label: 'Petrel GT', sub: 'GT3 coupe', act: () => this.driveCar( 'petrel' ) },
							{ label: 'Sandpiper 1600', sub: 'Beach buggy', act: () => this.driveCar( 'sandpiper' ) },
						],
					},
				],
			},
			{
				id: 'water', label: 'Water', sub: 'Jetski, boat & ferry', icon: 'water',
				children: () => [
					{ label: 'Ride Jetski', sub: 'Hit the bay swells', icon: 'water', act: () => this.rideJetski( { rocket: false } ) },
					{ label: 'Rocket Jetski', sub: 'Hold X to ignite', icon: 'water', act: () => this.rideJetski( { rocket: true } ) },
					{ label: 'Fishing Boat', sub: 'Board & fish the reef', icon: 'water', act: () => this.boardBoat() },
					{ label: 'Car Ferry', sub: 'Tidewater Spirit', icon: 'water', act: () => this.boardFerry() },
					{ label: 'Reef Swim', sub: 'Dive the coral reef', icon: 'water', act: () => this.teleport( - 25, 32, Math.PI, 'Enjoy the reef · C to dive', { swim: true } ) },
					{ label: 'Watch Sharks', sub: 'Underwater camera', icon: 'water', act: () => this.openTool( 'sharks' ) },
				],
			},
			{
				id: 'air', label: 'Air', sub: 'Jet, glider & lift', icon: 'air',
				children: () => [
					{ label: AIRCRAFT_NAME.full, sub: 'Carrier flight ops', icon: 'air', children: () => this.hornetItems() },
					{ label: 'Hang Glider', sub: '307 m volcano flight', icon: 'air', act: () => this.openTool( 'glider' ) },
					{ label: 'Chairlift', sub: 'Ride up the mountain', icon: 'air', act: () => this.openTool( 'chairlift' ) },
					{ label: 'Free Camera', sub: 'Roam freely', key: 'F', icon: 'air', act: () => app.setFreeCam?.( ! app.freeCam ) },
					{ label: 'Photo Mode', sub: 'Hide all HUD', key: 'P', icon: 'air', act: () => app.ui?.ui?.togglePhoto?.() },
				],
			},
			{
				id: 'world', label: 'World', sub: 'Weather & chaos', icon: 'world',
				children: () => [
					{ label: 'Disasters', sub: 'Tornado & tsunami', icon: 'world', act: () => this.openTool( 'disasters' ) },
					{ label: 'Golden Hour', sub: 'Warm island sunset', icon: 'world', act: () => this.setTime( 17.6, 'Golden hour' ) },
					{ label: 'Sunny Midday', sub: 'Bright turquoise sea', icon: 'world', act: () => this.setTime( 11.5, 'Sunny midday' ) },
					{ label: 'Starry Night', sub: 'Moonlight & lanterns', icon: 'world', act: () => this.setTime( 21.5, 'Night sky' ) },
					{ label: 'Wind Farm', sub: 'Turbines & wind', icon: 'world', act: () => this.openTool( 'windfarm' ) },
					{
						label: 'More World', sub: 'Wildlife & settings', icon: 'world',
						children: () => [
							{ label: 'Animals', sub: 'Island wildlife', act: () => this.openTool( 'livestock' ) },
							{ label: 'Evacuation', sub: 'Emergency route', act: () => this.openTool( 'evacuation' ) },
							{ label: 'Shark Bite Demo', sub: 'Demo scenario', act: () => this.openTool( 'shark-bite' ) },
							{ label: app.audio?.muted ? 'Unmute Sound' : 'Mute Sound', sub: 'Toggle audio', key: 'U', act: () => {
								if ( app.audio ) { app.audio.setMuted( ! app.audio.muted ); app.ui?.ui?.toast?.( app.audio.muted ? 'Sound off' : 'Sound on' ); }
							} },
							{ label: 'Settings', sub: 'Graphics & ocean', key: 'H', act: () => app.ui?.ui?.togglePanel?.() },
							{ label: 'Controls & Help', sub: 'Full key sheet', key: 'F1', act: () => app.ui?.ui?.toggleHelp?.() },
						],
					},
				],
			},
			{
				id: 'ride', label: this.rideLabel(), sub: 'Quick actions', icon: 'ride',
				children: () => this.rideItems(),
			},
			{
				id: 'places', label: 'Places', sub: 'Island landmarks', icon: 'places',
				children: () => [
					{ label: 'Beach & Village', sub: 'Home cove & shops', icon: 'places', act: () => this.teleport( 15, - 58, Math.PI, 'Beach & Village' ) },
					{ label: 'Suspension Bridge', sub: 'North tower plaza', icon: 'places', act: () => {
						const [ x, z ] = BRIDGE.worldXZ( - 14, 0 );
						this.teleport( x, z, Math.atan2( - BRIDGE.ux, - BRIDGE.uz ), 'Strait suspension bridge' );
					} },
					{ label: 'Joey Island', sub: 'South island village', icon: 'places', act: () => this.teleport( WORLD.joeyTerminal.position.x + 15, WORLD.joeyTerminal.position.z - 25, 0, 'Joey Island' ) },
					{ label: 'Ferry Terminal', sub: 'Tidewater harbour', icon: 'places', act: () => this.teleport( WORLD.ferryTerminal.position.x + 35, WORLD.ferryTerminal.position.z - 40, Math.PI, 'Ferry terminal' ) },
					{ label: 'Volcano Summit', sub: '307 m lookout', icon: 'places', act: () => app.glider?.visit?.() },
					{ label: 'Aircraft Carrier', sub: 'Offshore deck', icon: 'places', act: () => this.aviationAct( av => av.visit( 'carrier' ) ) },
				],
			},
		];

	}

	rideLabel() {

		const app = this.app;
		if ( app.rally?.active ) return 'Car';
		if ( app.jetskis?.riding ) return 'Jetski';
		if ( app.aviation?.pilot ) return AIRCRAFT_NAME.short;
		if ( app.aviation?.active ) return 'Carrier';
		if ( app.glider?.active ) return 'Flight';
		return 'Ride';

	}

	rideItems() {

		const app = this.app;
		if ( app.rally?.active ) {

			const out = [
				{ label: 'Leave Car', key: 'E', act: () => app.rally.leave() },
				{ label: 'Repair Car', key: 'T', act: () => app.rally.repair() },
				{ label: 'Recover Car', key: 'R', act: () => app.rally.recover() },
				{ label: app.rally.assists ? 'Aids Off' : 'Aids On', key: 'J', act: () => app.rally.toggleAssists() },
				{ label: 'Yeet!', key: 'Y', act: () => app.rally.yeet() },
			];
			if ( import.meta.env?.MODE !== 'pages' ) out.push( { label: 'Drive Together', act: () => app.rally.shared?.show?.() } );
			return out;

		}
		if ( app.jetskis?.riding ) {

			return [
				{ label: 'Dismount', key: 'E', act: () => app.jetskis.dismount() },
				{ label: 'Switch Camera', key: 'C', act: () => { app.jetskis.camMode = app.jetskis.camMode === 'chase' ? 'hood' : 'chase'; } },
				{ label: 'Pick up Mate', key: 'G', act: () => app.jetskis.mate?.key?.() },
				{ label: 'Refill Rocket', act: () => { if ( app.jetskis.ctl ) { app.jetskis.ctl.fuel = 1; app.ui?.ui?.toast?.( 'Rocket tank full!' ); } } },
			];

		}
		if ( app.aviation?.pilot ) {

			const a = app.aviation, c = a.flight.controls;
			const flapSub = c.flaps < 0.3 ? 'Up' : c.flaps < 0.9 ? 'Takeoff' : 'Landing';
			return [
				{ label: c.gear ? 'Raise Gear' : 'Lower Gear', key: 'G', act: () => a.command( 'gear' ) },
				{ label: c.hook ? 'Raise Hook' : 'Lower Hook', key: 'H', act: () => a.command( 'hook' ) },
				{ label: 'Flaps', sub: flapSub, key: 'V', act: () => a.command( 'flaps' ) },
				{ label: c.brake ? 'Release Brake' : 'Set Brake', key: 'B', act: () => a.command( 'brake' ) },
				{ label: a.camMode === 'cockpit' ? 'Chase View' : 'Cockpit View', key: 'C', act: () => a.command( 'camera' ) },
				{ label: 'Reset Launch', sub: 'Back to catapult', key: 'R', act: () => a.command( 'reset' ) },
				{ label: 'Landing Approach', sub: `${ APPROACH.distance } m astern`, act: () => a.command( 'approach' ) },
				{ label: 'Leave Aircraft', key: 'E', act: () => a.command( 'leave' ) },
			];

		}
		if ( app.aviation?.active ) {

			const a = app.aviation;
			return [
				{ label: `Fly ${ AIRCRAFT_NAME.short }`, act: () => this.aviationAct( av => av.enter() ) },
				{ label: 'Whole Carrier', act: () => this.aviationAct( av => av.visit( 'carrier' ) ) },
				{ label: 'Flight Deck', act: () => this.aviationAct( av => av.visit( 'deck' ) ) },
				{ label: 'Bridge', act: () => this.aviationAct( av => av.visit( 'bridge' ) ) },
				{ label: AIRCRAFT_NAME.short, act: () => this.aviationAct( av => av.visit( 'fighter' ) ) },
				{ label: 'Walk Flight Deck', act: () => this.aviationAct( av => av.walkDeck() ) },
				{ label: 'Leave Carrier', key: 'E', act: () => a.command( 'leave' ) },
			];

		}
		if ( app.glider?.active ) {

			return [
				{ label: 'Leave Aircraft', key: 'E', act: () => app.glider.leave() },
				{ label: 'Reset Launch', key: 'R', act: () => app.glider.reset() },
				{ label: 'Switch Camera', key: 'C', act: () => app.glider.toggleCamera() },
			];

		}
		return [
			{ label: 'Recall Ride', sub: 'Bring car or ski here', key: 'G', act: () => app.vehicleRecall?.recall() },
			{ label: 'Drive Current Car', sub: app.rally?.profile?.name || 'Hop straight in', act: () => this.driveCar( null ) },
			{ label: 'Fishing Rod', sub: 'Cast into the bay', key: 'R', act: () => {
				const g = app.game;
				if ( g?.canFish && ! g.fight ) { g.rod.equip( ! g.rod.equipped ); if ( ! g.rod.equipped ) g.cancelLine(); }
			} },
			{ label: 'Cooler & Log', sub: 'Catches & cash', key: 'I', act: () => app.game?.hud?.toggleInventory?.() },
			{ label: '1st / 3rd View', key: 'V', act: () => app.player?.toggleView?.() },
			{ label: 'Call Cockatoo', key: 'B', act: () => app.cockatoo?.whistle?.() },
		];

	}

}
