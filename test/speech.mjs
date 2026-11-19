import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from '../src/engine/index.js';

const node = () => ( { dataset: {}, style: { setProperty() {} }, classList: { toggle() {} }, append() {}, remove() {}, offsetWidth: 160, offsetHeight: 30 } );
globalThis.document = { createElement: node, head: node(), body: node() };
const S = await import( '../src/people/Speech.js' );

const LINE = 'Tsunami warning! Follow the green signs uphill.';
const person = ( id, x, z ) => ( { id, world: new Vector3( x, 0, z ) } );
const speech = () => new S.Speech( { camera: { position: new Vector3( 0, 2, 0 ) } } );

test( 'Two people 5 m apart warned together: only the first says the line; one 18 m off, or 4 s on, says it again', () => {

	const sp = speech();
	assert.equal( sp.say( person( 1, 0, 5 ), LINE, 'disaster-warning', 10, true ), true, 'the first warned person speaks' );
	const second = sp.say( person( 2, 5, 5 ), LINE, 'disaster-warning', 10.5, true );
	assert.equal( second, false, `a second person 5 m away said the same line 0.5 s later (${ sp.live.length } bubbles live)` );
	assert.equal( sp.say( person( 3, 18, 5 ), LINE, 'disaster-warning', 11, true ), true, 'someone 18 m along the beach says it to their own group' );
	assert.equal( sp.say( person( 4, 2, 5 ), LINE, 'disaster-warning', 14.6, true ), true, '4.6 s on, the line may be said again' );
	assert.equal( sp.say( person( 5, 1, 6 ), 'Watch out!', 'bump', 14.7, true ), true, 'a different line is not held back' );

} );

test( 'Two bubbles with the same foot point stack: the second sits wholly above the first', () => {

	assert.equal( typeof S.stackClear, 'function', 'Speech.js has no stacking for bubbles that land on one another' );
	const boxes = new Float32Array( 16 ), w = 300, h = 30, x = 400, y = 500;
	// the first bubble: foot at ( x, y ), box from y - 8 - h to y - 8 (Speech.update's translate)
	boxes.set( [ x - w / 2, y - 8 - h, x + w / 2, y - 8 ] );
	const by = S.stackClear( boxes, 1, x + 40, y, w, h );
	const top = by - 8 - h, bottom = by - 8;
	assert.ok( bottom <= boxes[ 1 ], `the second bubble (${ top.toFixed( 0 ) } to ${ bottom.toFixed( 0 ) } px) overlaps the first (${ boxes[ 1 ] } to ${ boxes[ 3 ] } px)` );
	assert.ok( boxes[ 1 ] - bottom < 12, `stacked ${ ( boxes[ 1 ] - bottom ).toFixed( 0 ) } px above, not right on top` );
	assert.equal( S.stackClear( boxes, 1, x + w + 20, y, w, h ), y, 'a bubble clear of the first stays at its own foot' );

} );
