import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';
import { INUNDATION_DEPTH } from '../src/disasters/WaterGrid.js';

const STEP = 0.1; // s: the game's largest accepted disaster step
const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );

// The shoreline on the approach ray: the first point out from the target with half a metre of still water
// (test/tsunami-approach.mjs shoreFor).
function shoreFor( e ) {
	const a = e.direction * Math.PI / 180, cx = Math.cos( a ), cz = Math.sin( a );
	for ( let s = 0; s < e.launchDistance; s += 2 ) if ( ground( e.x - cx * s, e.z - cz * s ) <= - 0.5 ) return { x: e.x - cx * s, z: e.z - cz * s };
	return null;
}

// The disasters.spec Tsunami control run (Fishing village target (40, -115) as Controls.target sets it, Surge 2 m,
// 6 s lead, radius 180 m, seed 7) and the default config's Severe 10 m (DEFAULTS.tsunami at (40, -25), seed 1, a
// shelf-edge source in test/tsunami-approach.mjs).
for ( const [ name, H, x, z, radius, seed ] of [ [ 'Surge', 2, 40, - 115, 180, 7 ], [ 'Severe', 10, DEFAULTS.tsunami.x, DEFAULTS.tsunami.z, DEFAULTS.tsunami.radius, 1 ] ] ) {
	test( `${ name } ${ H } m (seed ${ seed }): coastal flooding is reported when the bore reaches the village shore, not at launch`, () => {
		const field = new DisasterField( ground );
		const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, x, z, intensity: H, warningLead: 6, radius, duration: 90, seed } );
		const shore = shoreFor( e );
		assert.ok( shore && Math.hypot( shore.x - x, shore.z - z ) < radius, 'the shoreline on the ray lies inside the watched radius' );
		const launch = e.launchTime ?? e.warning; // s
		const approach = e.arrival - launch; // s: the countdown at launch
		const sea = {};
		let front = null; // s after launch: the sea at the shoreline first INUNDATION_DEPTH above datum
		const a = e.direction * Math.PI / 180, cx = Math.cos( a ), cz = Math.sin( a );
		const shoreOut = ( e.x - shore.x ) * cx + ( e.z - shore.z ) * cz; // m
		let flaggedOut = null; // m: the most seaward wet watched cell at the flag
		const step = () => {
			field.advance( STEP );
			if ( front === null && e.launched && field.water.sample( shore.x, shore.z, sea ).height > INUNDATION_DEPTH ) front = e.time - launch;
			if ( flaggedOut === null && e.coastReached ) {
				const w = field.water;
				flaggedOut = - Infinity;
				for ( const k of field.coastWatch ) if ( w.h[ k ] > INUNDATION_DEPTH ) flaggedOut = Math.max( flaggedOut, - ( ( w.x + ( k % w.n ) * w.dx - e.x ) * cx + ( w.z + Math.floor( k / w.n ) * w.dx - e.z ) * cz ) );
			}
		};
		while ( e.time < launch + 1 ) step();
		assert.ok( e.launched, 'the crest launched' );
		assert.equal( e.coastReached, undefined, `coast flagged ${ ( e.firstImpact - launch ).toFixed( 1 ) } s after launch with the crest ${ ( e.arrival - e.time ).toFixed( 0 ) } s out (${ field.water.stats.inundatedArea } m^2 wet land in the grid)` );
		while ( ( ! e.coastReached || front === null ) && e.time < e.arrival + 0.5 * approach ) step();
		assert.ok( e.coastReached, `the village shore never flooded by ${ ( e.time - launch ).toFixed( 0 ) } s after launch` );
		assert.ok( front !== null, 'the sea at the shoreline never rose' );
		const flood = e.firstImpact - launch;
		const report = `village land wet ${ flood.toFixed( 1 ) } s after launch, sea front at the shoreline ${ front.toFixed( 1 ) } s, countdown ${ approach.toFixed( 1 ) } s`;
		console.log( `${ name } ${ H } m seed ${ seed }: ${ report }` );
		assert.ok( flood >= 0.5 * approach, `${ report }: flagged in the first half of the approach` );
		assert.ok( flaggedOut <= shoreOut + field.water.dx, `${ report }: the flag fired on land ${ flaggedOut.toFixed( 0 ) } m seaward of the target, beyond the village shoreline at ${ shoreOut.toFixed( 0 ) } m` );
		assert.ok( Math.abs( flood - front ) <= 0.15 * approach, `${ report }: the flag must follow the front within 15% of the countdown` );
		assert.ok( flood <= 1.15 * approach, `${ report }: later than the crest band` );
	} );
}
