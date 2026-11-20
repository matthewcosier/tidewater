// Standard Gamepad API layout. Sample once per simulation frame so menus and
// vehicles share the same button edges, even while a physics worker is pending.
import { ControllerMenu } from '../ui/ControllerMenu.js';

const bit = i => 1 << i;
const axis = value => Math.abs( value || 0 ) <= 0.12 ? 0 : Math.sign( value ) * ( Math.abs( value ) - 0.12 ) / 0.88;
const value = ( pad, i ) => pad.buttons[ i ]?.value ?? ( pad.buttons[ i ]?.pressed ? 1 : 0 );
const FACE = [ 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', '↑', '↓', '←', '→' ];

// Each digital action uses the same gameplay command as its keyboard binding.
const FREE = [ 13, 'KeyF', 'Free camera' ];
const WALK = [ [ 2, 'KeyE', 'Interact' ], [ 0, 'Space', 'Jump / swim up' ], [ 10, 'ShiftLeft', 'Sprint' ],
	[ 1, 'KeyC', 'Crouch / dive' ], [ 3, 'KeyV', 'Change view' ], FREE ];
const ACTIONS = {
	walk: WALK,
	car: [ [ 2, 'KeyE', 'Leave car' ], [ 12, 'Repair', 'Repair car' ], FREE ],
	ferry: [ [ 0, 'KeyX', 'Stop engines' ], [ 1, 'KeyC', 'Centre wheel' ], [ 2, 'KeyE', 'Leave helm' ],
		[ 3, 'KeyV', 'Change view' ], [ 5, 'KeyH', 'Sound horn' ], [ 12, 'KeyR', 'Toggle ramp' ],
		[ 14, 'KeyL', 'Mooring lines' ], [ 4, 'ShiftLeft', 'Bow thruster + left stick' ] ],
	free: [ [ 0, 'Space', 'Rise' ], [ 1, 'KeyC', 'Descend' ], [ 10, 'ShiftLeft', 'Fly faster' ], [ 13, 'KeyF', 'Leave free camera' ] ],
};
const AXES = {
	walk: [ [ 'LS', 'Move' ] ], free: [ [ 'LS', 'Fly' ] ],
	car: [ [ 'LS', 'Steer' ], [ 'RT / LT', 'Accelerate / brake' ], [ 'A / RB', 'Handbrake' ], [ 'Y', 'Recover car' ], [ 'B', 'Bail out' ] ],
	ferry: [ [ 'LS', 'Turn wheel' ], [ 'RT / LT', 'Raise / lower throttle' ] ],
};
export class Controller {
	constructor( app ) {
		this.app = app;
		this.previous = this.blocked = 0;
		this.active = false;
		this.menu = new ControllerMenu( app );
		this.drive = { steer: 0, throttle: 0, brake: 0, handbrake: false, recover: false, yeet: false };
		this.hints = true;
		const keyboard = e => { if ( e.isTrusted ) this.setActive( false ); };
		window.addEventListener( 'keydown', keyboard );
		window.addEventListener( 'pointerdown', keyboard );
		window.addEventListener( 'pointermove', keyboard );
		window.addEventListener( 'blur', () => { this.suspended = true; this.setActive( false ); } );
		window.addEventListener( 'focus', () => { this.suspended = false; } );
	}
	setActive( active ) {
		if ( active === this.active ) return;
		this.active = active;
		document.body.classList.toggle( 'using-controller', active );
		if ( ! active ) this.menu.clearFocus();
	}
	context() {
		const app = this.app, mode = app.player?.mode;
		if ( app.freeCam ) return 'free';
		if ( app.rally?.active ) return 'car';
		if ( mode === 'ferry-helm' ) return 'ferry';
		return [ 'walk', 'deck', 'swim', 'ferry' ].includes( mode ) ? 'walk' : null;
	}
	bindings( context ) {
		return [ ...( AXES[ context ] || [] ), ...( context ? [ [ 'RS', 'Look around' ] ] : [] ),
			...( ACTIONS[ context ] || [] ).map( ( [ i, , action ] ) => [ FACE[ i ], action ] ),
			[ 'View', 'Show / hide prompts' ], [ 'Menu', 'Controls' ] ];
	}
	update( dt ) {
		const input = this.app.input;
		input.padHeld.clear(); input.padHits.clear();
		input.moveX = input.moveY = input.helmSteer = input.helmLever = 0;
		this.driving = null;
		let pads;
		try { pads = navigator.getGamepads?.(); } catch { /* Gamepad can be disabled by browser policy. */ }
		let pad = null;
		for ( const candidate of pads || [] ) if ( candidate?.connected ) {
			if ( ! pad || candidate.mapping === 'standard' ) pad = candidate;
			if ( pad.mapping === 'standard' ) break;
		}
		if ( ! pad ) { this.previous = this.blocked = 0; this.direction = null; this.setActive( false ); return; }
		let bits = 0;
		for ( let i = 0; i < FACE.length; i ++ ) if ( value( pad, i ) > 0.5 ) bits |= bit( i );
		const pressed = bits & ~this.previous;
		this.previous = bits;
		this.blocked &= bits;
		const x = axis( pad.axes[ 0 ] ), y = axis( pad.axes[ 1 ] ), rx = axis( pad.axes[ 2 ] ), ry = axis( pad.axes[ 3 ] );
		const throttle = value( pad, 7 ), brake = value( pad, 6 );
		if ( this.suspended || document.hidden ) { this.blocked = bits; return; }
		if ( pressed || x || y || rx || ry || throttle || brake ) this.setActive( true );
		if ( ! this.active || ! this.app.ui ) return;
		const context = this.context();
		const dir = Math.abs( x ) > .55 && Math.abs( x ) > Math.abs( y ) ? ( x > 0 ? 15 : 14 )
			: Math.abs( y ) > .55 ? ( y > 0 ? 13 : 12 ) : null;
		const nav = dir !== null && dir !== this.direction ? bit( dir ) : 0;
		this.direction = dir;
		if ( this.menu.update( pressed | nav, context, this ) ) { this.blocked |= bits; return; }
		if ( ! input.enabled ) return;
		const held = bits & ~this.blocked;
		if ( pressed & bit( 8 ) ) this.hints = ! this.hints;
		if ( context === 'car' || this.app.player.mode === 'jetski' ) {
			this.driving = Object.assign( this.drive, { steer: x, throttle: this.blocked & bit( 7 ) ? 0 : throttle,
				brake: this.blocked & bit( 6 ) ? 0 : brake, handbrake: !! ( held & ( bit( 0 ) | bit( 5 ) ) ),
				recover: !! ( pressed & bit( 3 ) ), yeet: !! ( pressed & bit( 1 ) ) } );
		}
		if ( ! context ) return;
		input.look.x += rx * 900 * Math.min( dt, .1 ); input.look.y += ry * 680 * Math.min( dt, .1 );
		if ( context === 'walk' || context === 'free' ) { input.moveX = x; input.moveY = - y; }
		if ( context === 'ferry' ) { input.helmSteer = x; input.helmLever = throttle - brake; }
		for ( const [ index, command ] of ACTIONS[ context ] ) {
			if ( held & bit( index ) ) input.padHeld.add( command );
			if ( pressed & bit( index ) ) input.padHits.add( command );
		}
	}
}
