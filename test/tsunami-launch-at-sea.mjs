import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';
import { INUNDATION_DEPTH } from '../src/disasters/WaterGrid.js';

const STEP = 0.1; // s: the game's largest accepted disaster step
// Checked: the launched state, then every grid after the first full step. Old code: the Severe 10 m had 63 Joey
// beach cells under up to 0.95 m in the launched state, the Surge 2 m 42 cells under 0.26 m after one step.
// Measured with the taper (launch-green.log): first wet land 1.5 s (Surge) and 0.5 s (Severe: the 10 m crest
// three cells off Joey's beach crosses those 16-24 m through the solver, a dam-break front of 2 sqrt( g H ) =
// 20 m/s) after launch. Water arriving, not appearing; the source line across Joey is planApproach's to move.
const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );

// A cell with land (ground above datum) among its 8 neighbours.
function besideLand( grid, k ) {
	const n = grid.n, i = k % n, j = Math.floor( k / n );
	for ( let dj = - 1; dj <= 1; dj ++ ) for ( let di = - 1; di <= 1; di ++ ) {
		const ii = i + di, jj = j + dj;
		if ( ii >= 0 && jj >= 0 && ii < n && jj < n && grid.bed[ jj * n + ii ] > 0 ) return true;
	}
	return false;
}

// Land holding more than INUNDATION_DEPTH of water, per grid: [ cells, deepest m, x, z ].
function wetLand( grid ) {
	let cells = 0, deepest = 0, at = null;
	for ( let k = 0; k < grid.h.length; k ++ ) {
		if ( grid.bed[ k ] > 0 && grid.h[ k ] > INUNDATION_DEPTH ) {
			cells ++;
			if ( grid.h[ k ] > deepest ) {
				deepest = grid.h[ k ];
				at = [ grid.x + ( k % grid.n ) * grid.dx, grid.z + Math.floor( k / grid.n ) * grid.dx ];
			}
		}
	}
	return { cells, deepest, at };
}

for ( const [ name, H, x, z, radius, seed ] of [ [ 'Surge', 2, 40, - 115, 180, 7 ], [ 'Severe', 10, DEFAULTS.tsunami.x, DEFAULTS.tsunami.z, DEFAULTS.tsunami.radius, 1 ] ] ) {
	test( `${ name } ${ H } m (seed ${ seed }): the launched wave starts at sea and no beach is wet after the first step`, () => {
		const field = new DisasterField( ground );
		const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, x, z, intensity: H, warningLead: 6, radius, duration: 90, seed } );
		// Land on the launch instant itself: the solver then runs 0.1 ms, so the grids hold the launched state.
		while ( ! e.launched ) field.advance( Math.min( STEP, Math.max( 1e-4, ( e.launchTime ?? e.warning ) - e.time ) ) );
		const launch = e.time;
		for ( const [ grid, which ] of [ [ field.water, 'village grid' ], [ field.outer, 'outer ring' ] ] ) {
			if ( ! grid ) continue;
			let shore = 0, worst = 0;
			for ( let k = 0; k < grid.h.length; k ++ ) {
				if ( grid.bed[ k ] < 0 && besideLand( grid, k ) ) {
					shore ++;
					worst = Math.max( worst, Math.abs( grid.h[ k ] + grid.bed[ k ] ) );
				}
			}
			assert.ok( shore > 0 && worst < 1e-3, `${ which }: the sea cells next to land (${ shore }) carry ${ worst.toFixed( 3 ) } m of the launched wave` );
		}
		// The crest is still there at sea: the taper trims the shore edge, not the wave.
		let crest = 0;
		for ( let k = 0; k < field.water.h.length; k ++ ) if ( field.water.bed[ k ] < 0 ) crest = Math.max( crest, field.water.h[ k ] + field.water.bed[ k ] );
		assert.ok( crest > 0.6 * H, `the launched crest stands ${ crest.toFixed( 2 ) } m over datum, under 0.6 x ${ H } m` );
		let firstWet = null;
		while ( e.time < launch + 3 ) {
			const checked = e.time <= launch + STEP + 1e-6;
			for ( const [ grid, which ] of [ [ field.water, 'village grid' ], [ field.outer, 'outer ring' ] ] ) {
				if ( ! grid ) continue;
				const wet = wetLand( grid );
				if ( wet.cells && firstWet === null ) firstWet = e.time - launch;
				if ( checked ) assert.equal( wet.cells, 0, `${ which }: ${ wet.cells } land cells under ${ wet.deepest.toFixed( 2 ) } m of water ${ ( e.time - launch ).toFixed( 1 ) } s after launch, deepest at (${ wet.at?.map( v => v.toFixed( 0 ) ) }), the crest ${ ( e.arrival - e.time ).toFixed( 0 ) } s from the target` );
			}
			field.advance( STEP );
		}
		console.log( `${ name } ${ H } m seed ${ seed }: launched crest ${ crest.toFixed( 2 ) } m, first wet land ${ firstWet === null ? 'none in 3' : firstWet.toFixed( 1 ) } s after launch` );
	} );
}
