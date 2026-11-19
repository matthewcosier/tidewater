// A tsunami ends the way a flood ends: the water runs back to the sea and the event is over when the land has drained,
// not when a timer fires (Field.js tsunamiOver, docs/disasters.md "How a tsunami ends"). The old end deleted the event
// at warning + approach + Duration and dropped both grids: for the 10 m crest (seed 1) 532,000 m3 of water stood on
// 12.3 ha of land at 118 m2/s and vanished in one frame.
// Held, on the real island for the Surge 2 m (seed 7) and the Severe 10 m (seed 1):
// - at the last frame before the grids drop, no water stands on land (deepest cell under 5 cm) and the sea is within
//   5 cm of datum, so nothing the player sees or a hull feels steps by more than that;
// - the drain was the solver's flow, not the hand-back: when the hand-back began, the land held under 5 % of its
//   peak flood volume, and the drain held on the water before its 600 s bound (the bound is only for a stuck state).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';

const STEP = 0.1; // s
const STEP_SEEN = 0.05; // m: the largest change across the end a player or a floating body may meet
const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );

// Water on land (m3) and the largest visible departure (m) across both grids: depth on land, |surface| at sea. The
// ring's cells under the village grid are left out (the village grid is what is drawn and sampled there).
function state( field ) {
	let volume = 0, land = 0, sea = 0;
	for ( const g of [ field.water, field.outer ] ) {
		if ( ! g ) continue;
		const n = g.n, inner = g === field.outer ? field.water : null;
		for ( let k = 0; k < g.h.length; k ++ ) {
			if ( inner && inner.contains( g.x + ( k % n ) * g.dx, g.z + Math.floor( k / n ) * g.dx ) ) continue;
			const h = g.h[ k ], b = g.bed[ k ];
			if ( b > 0 ) {
				if ( g === field.water ) volume += h * g.dx * g.dx;
				land = Math.max( land, h );
			} else if ( h > 0 ) sea = Math.max( sea, Math.abs( h + b ) );
		}
	}
	return { volume, land, sea };
}

for ( const [ name, H, x, z, seed ] of [ [ 'Surge', 2, 40, - 115, 7 ], [ 'Severe', 10, DEFAULTS.tsunami.x, DEFAULTS.tsunami.z, 1 ] ] ) {
	test( `${ name } ${ H } m (seed ${ seed }): the flood runs back to the sea before the event ends, and nothing steps at the end`, () => {
		const field = new DisasterField( ground );
		const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, x, z, intensity: H, warningLead: 3, seed } );
		const bound = field.endTime( e ) + 1;
		let peak = 0, last = null, atCalm = null;
		while ( field.events.has( 'tsunami' ) && field.time < bound ) {
			field.advance( STEP );
			if ( ! field.water ) break;
			last = state( field );
			peak = Math.max( peak, last.volume );
			if ( atCalm === null && e.calmFrom !== undefined ) atCalm = { volume: last.volume, time: field.time };
		}
		const report = JSON.stringify( { arrival: +e.arrival.toFixed( 1 ), end: +field.time.toFixed( 1 ), drained: e.drainEnd === undefined ? null : +( e.drainEnd - e.trainEnd ).toFixed( 1 ), calm: atCalm && +( field.time - atCalm.time ).toFixed( 1 ), peakVolume: Math.round( peak ), calmVolume: atCalm && Math.round( atCalm.volume ), endedBy: e.endedBy ?? null, capped: e.drainCapped ?? null } );
		console.log( `# ${ name } ${ H } m seed ${ seed }: ${ report }` );
		assert.ok( ! field.events.has( 'tsunami' ), `the event is still running at ${ field.time.toFixed( 0 ) } s, past its bound ${ report }` );
		assert.ok( last.land < STEP_SEEN && last.sea < STEP_SEEN, `at the last frame before the event ended ${ last.land.toFixed( 2 ) } m of water stood on land and the sea was ${ last.sea.toFixed( 2 ) } m off datum (${ Math.round( last.volume ) } m3 on land), removed in one step ${ report }` );
		assert.ok( atCalm && atCalm.volume < 0.05 * peak && ! e.drainCapped, `the land drained through the solver: ${ report }` );
	} );
}
