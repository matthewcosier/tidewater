import './controller.css';

const choices = 'button:not(:disabled), select:not(:disabled), input:not(:disabled), [role="slider"], [role="switch"], [role="combobox"]';
const labels = { car: 'Driving', walk: 'On foot', ferry: 'Ferry helm', free: 'Free camera' };
const hit = ( buttons, index ) => !! ( buttons & ( 1 << index ) );

export class ControllerMenu {
	constructor( app ) {
		this.app = app;
		this.garage = false;
	}
	build( ui ) {
		const dialog = document.createElement( 'dialog' );
		dialog.className = 'tw-pad-menu tw-glass';
		dialog.setAttribute( 'aria-labelledby', 'tw-pad-title' );
		dialog.innerHTML = '<header><div><small></small><h2 id="tw-pad-title">Controls</h2></div><button aria-label="Close controls">×</button></header><dl></dl><footer><button data-car>Choose car</button><button data-settings>Settings</button><button data-play>Resume</button></footer><p>↑ ↓ Navigate · A Select · B Back</p>';
		ui.root.append( dialog );
		this.dialog = dialog;
		dialog.querySelector( 'header button' ).onclick = dialog.querySelector( '[data-play]' ).onclick = () => dialog.close();
		dialog.querySelector( '[data-settings]' ).onclick = () => { dialog.close(); ui.togglePanel( true ); };
		dialog.querySelector( '[data-car]' ).onclick = () => {
			dialog.close();
			const hud = this.app.rally.hud;
			if ( hud.dock.inert ) hud.summon();
			this.garage = true;
			hud.dock.classList.add( 'is-pad-picker' );
			hud.vehicle.focus();
		};
	}
	show( context, controller ) {
		const ui = this.app.ui.ui;
		if ( ! this.dialog ) this.build( ui );
		if ( document.pointerLockElement ) document.exitPointerLock();
		this.dialog.querySelector( 'small' ).textContent = labels[ context ] || 'Island';
		const list = this.dialog.querySelector( 'dl' ); list.replaceChildren();
		for ( const [ key, name ] of controller.bindings( context ) ) {
			const action = document.createElement( 'dt' ), binding = document.createElement( 'dd' );
			action.textContent = name; binding.textContent = key; list.append( action, binding );
		}
		this.dialog.querySelector( '[data-car]' ).hidden = ! this.app.rally?.hud?.dock || ! [ 'walk', 'car' ].includes( context );
		this.dialog.showModal();
		this.dialog.querySelector( '[data-play]' ).focus();
	}
	clearFocus() {
		this.garage = false;
		this.app.rally?.hud?.dock?.classList.remove( 'is-pad-picker' );
		this.lastScope = null;
	}
	scope( ui ) {
		if ( this.dialog?.open ) return this.dialog;
		if ( ui._menu ) return ui._menu;
		if ( ui._start ) return ui.startEl;
		if ( this.app.game?.guide?.open ) return this.app.game.guide.el;
		if ( ui.helpOpen ) return ui.helpEl;
		if ( ui.panelOpen ) return ui.panel;
		const hud = this.app.game?.hud;
		if ( hud?.invOpen ) return hud.inv;
		if ( hud?.standOpen ) return hud.stand;
		const dock = this.app.rally?.hud?.dock;
		if ( this.garage && dock && ! dock.hidden && ! dock.inert ) return dock;
		this.garage = false;
		return null;
	}
	back( scope, ui ) {
		if ( scope === this.dialog ) this.dialog.close();
		else if ( scope === ui._menu ) ui._closeMenu( true );
		else if ( ui._start ) scope.querySelector( '[data-back]' )?.click();
		else if ( this.app.game?.guide?.open ) this.app.game.guide.close();
		else if ( ui.helpOpen ) ui.toggleHelp( false );
		else if ( ui.panelOpen ) ui.togglePanel( false );
		else if ( this.garage ) { this.clearFocus(); this.app.engine.domElement.focus(); }
		else scope.querySelector( '[data-close]' )?.click();
	}
	update( bits, context, controller ) {
		const ui = this.app.ui.ui;
		const scope = this.scope( ui );
		if ( ! scope ) {
			this.lastScope = null;
			if ( ! hit( bits, 9 ) ) return false;
			this.show( context, controller ); return true;
		}
		if ( hit( bits, 1 ) || hit( bits, 9 ) ) { this.back( scope, ui ); return true; }
		if ( ! bits && scope === this.lastScope ) return true;
		const nodes = [ ...scope.querySelectorAll( choices ) ].filter( el => ! el.closest( '[hidden],[inert]' ) && el.checkVisibility( { visibilityProperty: true } ) );
		const current = document.activeElement;
		let at = nodes.indexOf( current );
		this.lastScope = scope;
		if ( ! nodes.length ) return true;
		const shift = Number( hit( bits, 13 ) ) - Number( hit( bits, 12 ) );
		const adjust = Number( hit( bits, 15 ) ) - Number( hit( bits, 14 ) );
		if ( at >= 0 && current.tagName === 'SELECT' && adjust ) {
			current.selectedIndex = Math.min( current.options.length - 1, Math.max( 0, current.selectedIndex + adjust ) );
			current.dispatchEvent( new Event( 'change', { bubbles: true } ) );
			current.focus();
		} else if ( at >= 0 && adjust && ( current.matches( '[role="slider"],input[type="range"]' ) ) ) {
			current.dispatchEvent( new KeyboardEvent( 'keydown', { key: adjust > 0 ? 'ArrowRight' : 'ArrowLeft', bubbles: true } ) );
		} else {
			if ( shift || adjust ) at = ( at + ( shift || adjust ) + nodes.length ) % nodes.length;
			const selected = nodes[ Math.max( 0, at ) ];
			if ( current !== selected ) selected.focus();
			if ( hit( bits, 0 ) ) {
				if ( selected.tagName === 'SELECT' ) ui._openMenu( selected, [ ...selected.options ].map( o => o.text ), selected.selectedIndex, i => {
					selected.selectedIndex = i; selected.dispatchEvent( new Event( 'change', { bubbles: true } ) );
				} );
				else {
					selected.click();
					if ( this.garage && selected === this.app.rally.hud.go ) this.clearFocus();
				}
			}
		}
		return true;
	}
}
