import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WaterGrid} from '../src/disasters/WaterGrid.js';

const CAP = 0.45; // Courant number the solver promises (WaterGrid.stableStep)

test( 'every still-water depth from 0.5 m to 3000 m gives a step at or under the 0.45 Courant cap', () => {
	const over = [];
	let least = Infinity;
	for ( let k = 0; k < 600; k ++ ) {
		const depth = 0.5 * Math.pow( 6000, k / 599 ); // m, log-spaced: a puddle to the extreme 3000 m crest
		const grid = new WaterGrid( () => - depth, { n: 9, dx: 8, sponge: false, friction: false } );
		const step = grid.stableStep();
		assert.ok( step > 0 && Number.isFinite( step ), `step ${ step } s at ${ depth } m` );
		if ( step < 0.999 * CAP ) least = Math.min( least, grid.stats.cfl ); // the cap binds once the rate passes 1 per s
		if ( grid.stats.cfl > CAP ) over.push( `${ depth.toFixed( 3 ) } m: ${ grid.stats.cfl }` );
	}
	assert.deepEqual( over, [], `${ over.length } of 600 depths step over the cap, first ${ over.slice( 0, 3 ).join( ', ' ) }` );
	// The shave is a rounding guard, not a slower solver: the Courant number stays at the cap.
	assert.ok( least > CAP * ( 1 - 1e-9 ), `least Courant number ${ least } fell more than a rounding below ${ CAP }` );
} );
