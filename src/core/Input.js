// Keyboard takes precedence while a movement key is held.
export function movementAxis( input, positive, negative, stick = 0 ) {
	return Number( input.down( positive ) ) - Number( input.down( negative ) ) || stick;
}

// Direction in a mode's local frame. Keep a light stick proportional and limit
// diagonal travel to the same top speed as a single keyboard direction.
export function movementVector( input, out, forward, right ) {
	return out.copy( forward ).multiplyScalar( movementAxis( input, 'KeyW', 'KeyS', input.moveY ) )
		.addScaledVector( right, movementAxis( input, 'KeyD', 'KeyA', input.moveX ) );
}

// Keyboard / mouse input with pointer lock support.
export class Input {

	constructor( dom ) {

		this.dom = dom;
		this.keys = new Set();
		this.pressed = new Set();
		this.padHeld = new Set();
		this.padHits = new Set();
		this.look = { x: 0, y: 0 };
		this.wheel = 0;
		this.mouseDown = false;
		this.rightDown = false;
		this.locked = false;
		this.enabled = true;

		window.addEventListener( 'keydown', ( e ) => {

			if ( e.target && ( e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' ) ) return;
			if ( ! this.keys.has( e.code ) ) ( this.nextPressed ?? this.pressed ).add( e.code );
			this.keys.add( e.code );
			if ( [ 'Space', 'ArrowUp', 'ArrowDown', 'Tab' ].includes( e.code ) ) e.preventDefault();

		} );
		window.addEventListener( 'keyup', ( e ) => this.keys.delete( e.code ) );
		window.addEventListener( 'blur', () => this.keys.clear() );

		dom.addEventListener( 'mousedown', ( e ) => {

			if ( e.button === 0 ) this.mouseDown = true;
			if ( e.button === 2 ) this.rightDown = true;

		} );
		window.addEventListener( 'mouseup', ( e ) => {

			if ( e.button === 0 ) this.mouseDown = false;
			if ( e.button === 2 ) this.rightDown = false;

		} );
		dom.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
		window.addEventListener( 'mousemove', ( e ) => {

			if ( this.locked || this.mouseDown || this.rightDown ) {

				this.look.x += e.movementX;
				this.look.y += e.movementY;

			}

		} );
		dom.addEventListener( 'wheel', ( e ) => {

			this.wheel += Math.sign( e.deltaY );
			e.preventDefault();

		}, { passive: false } );

		document.addEventListener( 'pointerlockchange', () => {

			this.locked = document.pointerLockElement === dom;

		} );

	}

	requestLock() {

		if ( ! this.locked ) this.dom.requestPointerLock?.()?.catch?.( () => {} );

	}

	down( code ) {

		return this.enabled && ( this.keys.has( code ) || this.padHeld.has( code ) );

	}

	// true once per physical key press
	hit( code ) {

		return this.enabled && ( this.pressed.has( code ) || this.padHits.has( code ) );

	}

	consumeLook() {

		const l = { x: this.look.x, y: this.look.y };
		this.look.x = 0;
		this.look.y = 0;
		return l;

	}

	consumeWheel() {

		const w = this.wheel;
		this.wheel = 0;
		return w;

	}

	endFrame() {

		if ( this.nextPressed ) { this.pressed = this.nextPressed; this.nextPressed = null; }
		else this.pressed.clear();

	}

	beginFrame() {
		// Keys arriving while physics workers run belong to the next frame.
		this.nextPressed = new Set();
	}

}
