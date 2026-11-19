// The wave asked for is the wave that arrives. The player sets the offshore crest height H; the solver launches it at
// the source line (the outer ring holds exactly H there, test/tsunami-launch-at-sea.mjs) and carries it to the shore.
// Reference: Green's law for a long wave shoaling from still depth d_s to d_g, H_g = H ( d_s / d_g )^( 1 / 4 )
// (Green 1838; Synolakis 1991 shows it holds for the incident crest on a mild slope until it breaks), and the McCowan
// limit H / d = 0.78 past which the crest has broken and is depth limited (its height at breaking is the most a bore
// can carry on toward the shore). Band at the wet shoreline gauge (the first point out from the target whose still
// water outlasts the leading trough, as test/tsunami-approach.mjs):
// - at least 0.85 x the smaller of Green's height and the breaking height (declared tolerance: second-order diffusion
//   of the 32 m ring over 1-3 km of approach; measured 0.87-1.1 over seeds 1-10 at 2, 10 and 25 m);
// - at most 2 x Green's height: the gauge stands in front of the beach, so it sees the incident crest plus its
//   reflection, which at most doubles it.
// The 25 m crests read 1.25-1.6 x Green: their sources sit in 10-13 m of water, the gauge in 12-16 m, so Green alone
// gives about 1; the excess is the beach's reflection and the bore's set-up over the shelf, inside the 2 x bound.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';

const STEP = 0.1; // s: the game's largest accepted disaster step
const BREAKING = 0.78; // McCowan, H / d
const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );

// Depth (m) where a crest of height H shoaling by Green's law from depth ds first reaches the McCowan limit, and
// its height there: H ( ds / d )^( 1 / 4 ) = 0.78 d, so d^( 5 / 4 ) = H ds^( 1 / 4 ) / 0.78.
function breakingHeight( H, ds ) {
	const d = Math.pow( H * Math.pow( ds, 0.25 ) / BREAKING, 0.8 );
	return d >= ds ? H : BREAKING * d;
}

for ( const H of [ 2, 10, 25 ] ) for ( const seed of [ 1, 5, 9 ] ) {
	test( `${ H } m tsunami (seed ${ seed }): the crest reaching the village shoreline stands within the Green's-law band of the height set`, () => {
		const field = new DisasterField( ground );
		const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, intensity: H, warningLead: 3, seed } );
		const a = e.direction * Math.PI / 180, cx = Math.cos( a ), cz = Math.sin( a );
		const at = s => ( { x: e.x - cx * s, z: e.z - cz * s, s } );
		const sourceDepth = - ground( at( e.launchDistance ).x, at( e.launchDistance ).z );
		let gauge = null;
		for ( let s = 0; s < e.launchDistance && ! gauge; s += 2 ) if ( - ground( at( s ).x, at( s ).z ) >= e.drawdown * H + 0.5 ) gauge = at( s );
		assert.ok( gauge && sourceDepth > 0, `a wet shoreline gauge and a sea source on the ray (source depth ${ sourceDepth.toFixed( 1 ) } m)` );
		const gaugeDepth = - ground( gauge.x, gauge.z );
		let crest = - Infinity;
		while ( field.time < e.arrival + 25 && field.events.has( 'tsunami' ) ) {
			field.advance( STEP );
			if ( e.launched ) crest = Math.max( crest, field.waterAt( gauge.x, gauge.z ) );
		}
		const green = H * Math.pow( sourceDepth / gaugeDepth, 0.25 ), low = 0.85 * Math.min( green, breakingHeight( H, sourceDepth ) ), high = 2 * green;
		const report = `crest ${ crest.toFixed( 2 ) } m at the shoreline gauge ${ gauge.s } m out in ${ gaugeDepth.toFixed( 1 ) } m of water, source ${ e.launchDistance.toFixed( 0 ) } m out in ${ sourceDepth.toFixed( 1 ) } m, Green ${ green.toFixed( 2 ) } m, band ${ low.toFixed( 2 ) }-${ high.toFixed( 2 ) } m`;
		console.log( `# ${ H } m seed ${ seed }: ${ report }` );
		assert.ok( crest >= low && crest <= high, report );
	} );
}
