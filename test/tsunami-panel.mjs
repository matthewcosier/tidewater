import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';
import { HEIGHT_MIN, HEIGHT_MAX, SLIDER_STEPS, PRESETS, WARNINGS, heightFromSlider, sliderFromHeight, planTsunami, runUp } from '../src/disasters/TsunamiPanel.js';

const terrain = new TerrainData();
const ground = ( x, z ) => terrain.heightAt( x, z );
const PIER = { ...DEFAULTS.tsunami, x: 58, z: -46 }; // the harbour pier target the panel offers

test( 'The height slider spans 1 m to 3,000 m on a log scale and every preset lands exactly', () => {
	assert.equal( heightFromSlider( 0 ), HEIGHT_MIN );
	assert.equal( heightFromSlider( SLIDER_STEPS ), HEIGHT_MAX );
	let last = 0;
	for ( let s = 0; s <= SLIDER_STEPS; s ++ ) {
		const H = heightFromSlider( s );
		assert.ok( H >= last, `slider step ${ s } gave ${ H } m after ${ last } m` );
		last = H;
	}
	// log scale: the middle of the travel sits near the geometric mean (55 m), not the arithmetic one
	const mid = heightFromSlider( SLIDER_STEPS / 2 );
	assert.ok( mid > 40 && mid < 70, `the slider midpoint reads ${ mid } m` );
	assert.deepEqual( PRESETS.map( p => p.height ), [ 2, 10, 40, 320, 3000 ] );
	for ( const p of PRESETS ) assert.equal( heightFromSlider( sliderFromHeight( p.height ) ), p.height, `${ p.name } ${ p.height } m does not survive the slider` );
} );

test( 'Each preset and warning reaches the field as its crest and lead, and the arrival readout is the field planner', () => {
	assert.deepEqual( WARNINGS, { none: 3, short: 20, long: 90 } );
	for ( const p of PRESETS ) for ( const [ name, lead ] of Object.entries( WARNINGS ) ) {
		const config = { ...PIER, intensity: p.height, warningLead: lead, seed: 7 };
		const field = new DisasterField( ground );
		const e = field.start( 'tsunami', config );
		assert.equal( e.intensity, p.height, `${ p.name }: the field crest is ${ e.intensity } m` );
		assert.equal( e.warning, lead, `${ name } warning: the field lead is ${ e.warning } s` );
		const plan = planTsunami( ground, config );
		assert.ok( Math.abs( plan.arrival - e.arrival ) < 1e-9, `${ p.name } ${ name }: readout ${ plan.arrival } s, field ${ e.arrival } s` );
		assert.ok( plan.arrival > lead, `${ p.name }: the crest arrives after the warning (${ plan.arrival } s)` );
	}
} );

test( 'The run-up readout grows with height, never reads below the crest, and the Mega preset clears the 305.5 m summit', () => {
	let last = 0;
	for ( const p of PRESETS ) {
		const plan = planTsunami( ground, { ...PIER, intensity: p.height } );
		assert.ok( Number.isFinite( plan.runUp ), `${ p.name } run-up is ${ plan.runUp }` );
		assert.ok( plan.runUp > last, `${ p.name } run-up ${ plan.runUp } m is not above ${ last } m` );
		assert.ok( plan.runUp >= p.height, `${ p.name } run-up ${ plan.runUp } m is below its ${ p.height } m crest` );
		last = plan.runUp;
	}
	assert.ok( last > 305.5, `Mega run-up ${ last } m stays below the summit` );
	// Synolakis (1987) breaking law on a 1:30 beach in 20 m of water: a 2 m wave runs up about 4.6 m
	const surge = runUp( 2, 20, 30 );
	assert.ok( surge > 4 && surge < 5.2, `2 m in 20 m on 1:30 runs up ${ surge } m` );
} );
