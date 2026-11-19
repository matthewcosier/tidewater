import test from 'node:test';
import assert from 'node:assert/strict';
import { Disasters } from '../src/disasters/Disasters.js';

function host( calls ) {

	const rec = ( n ) => () => calls.push( n );
	return {
		paused: false, frameDt: 1 / 60, external: [], app: { ferry: { ship: {} } },
		field: { advance: rec( 'advance' ), events: new Map( [ [ 'tornado', {} ] ] ) },
		water: { update: rec( 'water' ) }, siren: { update: rec( 'siren' ) },
		structures: { update: rec( 'structures' ) }, bodies: { update: rec( 'bodies' ) },
		wakeProps: rec( 'wake' ), loads: rec( 'loads' ), parkedSkis: rec( 'skis' ), updateVisuals: rec( 'visuals' ),
		// the production chain divides by the step somewhere upstream of the drag law: model that here
		people: ( dt ) => { calls.push( 'people' ); if ( ! ( dt > 0 ) ) throw new RangeError( 'Relative velocity must be finite' ); },
	};

}

test( 'a zero, negative or non-finite step during a disaster advances nothing and throws nothing', () => {

	for ( const dt of [ 0, - 0, Number.NaN, - 1 / 60, Infinity ] ) {

		const calls = [], self = host( calls );
		assert.doesNotThrow( () => Disasters.prototype.before.call( self, dt ), `dt ${ dt }` );
		assert.deepEqual( calls, [], `dt ${ dt } stepped ${ calls.join( ', ' ) }` );
		assert.equal( self.frameDt, 1 / 60, `dt ${ dt } overwrote the last real step` );

	}

} );

test( 'a real step during a disaster still runs every stage once, in order', () => {

	const calls = [], self = host( calls );
	Disasters.prototype.before.call( self, 1 / 60 );
	assert.deepEqual( calls, [ 'advance', 'water', 'siren', 'structures', 'bodies', 'wake', 'loads', 'people', 'skis', 'visuals' ] );
	assert.equal( self.frameDt, 1 / 60 );

} );
