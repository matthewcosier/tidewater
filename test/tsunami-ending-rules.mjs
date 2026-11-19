// The decisions a tsunami's ending rests on, each on the real solver or the real field, fast (no full event): which water
// counts as still running (the pond test on spill levels, WaterGrid.pack), which sea counts as open (the settled test),
// when the drain is judged over (Field.tsunamiOver), how the hand-back paces itself (the soak from the deepest water left,
// the sea's fall capped) and what a second tsunami or a tornado does to it. The long runs on the real island are
// test/tsunami-drain.mjs (docs/disasters.md "How a tsunami ends").
import test from 'node:test';
import assert from 'node:assert/strict';
import { WaterGrid } from '../src/disasters/WaterGrid.js';
import { DisasterField, DEFAULTS } from '../src/disasters/Field.js';
import { HU_CHILD } from '../src/people/FloodHazard.js';
import { TerrainData } from '../src/world/TerrainData.js';

// An island 100 m across at +4 m on a -6 m sea, a beach from 100 m to 140 m out, and two closed hollows in its top: a
// bowl on land (floor +2 m, at x = +40) and a basin under datum (floor -1 m, at x = -40) walled off from the sea by the
// island's own ground. Both spill at +4 m, the lowest rim on any way out; the open sea spills at datum.
function islet( x, z ) {

	if ( Math.hypot( x - 40, z ) < 24 ) return 2;
	if ( Math.hypot( x + 40, z ) < 24 ) return - 1;
	const r = Math.hypot( x, z );
	if ( r < 100 ) return 4;
	if ( r < 140 ) return 4 - 10 * ( r - 100 ) / 40;
	return - 6;

}
const N = 41, DX = 8; // 320 m square, centred on the islet
const at = ( g, x, z ) => Math.round( ( z - g.z ) / g.dx ) * g.n + Math.round( ( x - g.x ) / g.dx );

test( 'Water standing in a closed hollow is a pond: its slosh is never land flow, and a walled-off basin is not open sea', () => {

	const g = new WaterGrid( islet, { n: N, dx: DX, sponge: false } );
	// The bowl holds 1 m sloshing at 1 m/s (h |u| 1 m2/s, over the child line); the basin stands 0.3 m over datum.
	for ( let k = 0; k < g.h.length; k ++ ) {

		const x = g.x + ( k % N ) * DX, z = g.z + Math.floor( k / N ) * DX;
		if ( Math.hypot( x - 40, z ) < 24 ) { g.h[ k ] = 1; g.qx[ k ] = 1; }
		if ( Math.hypot( x + 40, z ) < 24 ) g.h[ k ] = 1.3;

	}
	g.pack();
	let s = g.stats;
	assert.ok( s.landFlow < 1e-9, `slosh inside a closed hollow is not land flow: largest land discharge outside ponds ${ s.landFlow.toFixed( 2 ) } m2/s` );
	assert.ok( s.seaOff < 1e-9 && Math.abs( s.restOff - 0.3 ) < 1e-9, `the walled-off basin 0.3 m high is not open sea (open sea ${ s.seaOff?.toFixed( 3 ) } m off datum) but is still off its rest (${ s.restOff?.toFixed( 3 ) } m)` );
	assert.ok( s.landWet > 0 && Math.abs( s.landDeep - 1 ) < 1e-9, `the pond still counts as water on land for the hand-back (${ s.landWet } wet cells, deepest ${ s.landDeep } m)` );
	assert.ok( Math.abs( g.spill[ at( g, 40, 0 ) ] - 4 ) < 1e-9 && Math.abs( g.spill[ at( g, - 40, 0 ) ] - 4 ) < 1e-9 && g.spill[ at( g, 150, 0 ) ] === 0, `the bowl and the basin spill at their 4 m rim, the open sea at datum (${ g.spill[ at( g, 40, 0 ) ] }, ${ g.spill[ at( g, - 40, 0 ) ] }, ${ g.spill[ at( g, 150, 0 ) ] } m)` );
	// Fill the bowl over its rim (surface 4.5 m): that water can leave, so its flow counts. A sheet running down the beach
	// counts too, and the open sea off datum is open sea.
	for ( let k = 0; k < g.h.length; k ++ ) {

		const x = g.x + ( k % N ) * DX, z = g.z + Math.floor( k / N ) * DX;
		if ( Math.hypot( x - 40, z ) < 24 ) { g.h[ k ] = 2.5; g.qx[ k ] = 0.5; }
		if ( Math.hypot( x, z ) > 100 && Math.hypot( x, z ) < 132 && g.bed[ k ] > 0 ) { g.h[ k ] = 0.2; g.qx[ k ] = 0.2 * 2 * Math.sign( x ); }
		if ( g.bed[ k ] < 0 && g.spill[ k ] === 0 ) g.h[ k ] = 0.4 - g.bed[ k ];

	}
	g.pack();
	s = g.stats;
	assert.ok( Math.abs( s.landFlow - 0.5 ) < 1e-9, `water over a hollow's rim and run-off on the beach are land flow (largest ${ s.landFlow.toFixed( 2 ) } m2/s, expected the overflowing bowl's 0.5)` );
	assert.ok( Math.abs( s.seaOff - 0.4 ) < 1e-9, `the open sea 0.4 m over datum reads 0.4 m off (${ s.seaOff.toFixed( 3 ) })` );

} );

// A tsunami on the real island, staged at the end of its train with the grids' drain state written in, judged by the
// field itself (tsunamiOver: what Field.advance calls every frame).
const island = new TerrainData();
const ground = ( x, z ) => island.heightAt( x, z );
function staged() {

	const field = new DisasterField( ground );
	const e = field.start( 'tsunami', { ...DEFAULTS.tsunami, intensity: 2, warningLead: 3, seed: 7 } );
	e.launched = true;
	e.time = e.trainEnd;
	return { field, e };

}
function write( field, { landFlow = 0, seaOff = 0, landWet = 0, landDeep = 0, restOff = seaOff } ) {

	for ( const g of [ field.water, field.outer ] ) Object.assign( g.stats, { landFlow, seaOff, landWet, landDeep, restOff, landMoving: 0 } );

}
function judge( field, e, seconds, dt = 0.1 ) {

	for ( let t = 0; t < seconds - 1e-9; t += dt ) {

		e.time += dt;
		if ( field.tsunamiOver( e, dt ) ) return true;

	}
	return false;

}

test( 'The drain waits for the open sea to settle as well as the land: a quiet slack between two surges does not end it', () => {

	// Land flow under the child line, the open sea still 0.6 m off datum (the bay ringing): not over.
	let { field, e } = staged();
	write( field, { landFlow: 0.1, seaOff: 0.6, landWet: 40, landDeep: 0.5 } );
	judge( field, e, 30 );
	assert.equal( e.calmFrom, undefined, `with the open sea 0.6 m off datum the drain held anyway (hand-back from ${ e.calmFrom?.toFixed( 1 ) } s)` );
	// The sea under 0.25 m and the land under the line, held 2 s: the hand-back starts.
	write( field, { landFlow: 0.1, seaOff: 0.2, landWet: 40, landDeep: 0.5 } );
	judge( field, e, 2.5 );
	assert.ok( e.calmFrom !== undefined && ! e.drainCapped, `the land under the child line (0.1 m2/s) and the open sea 0.2 m off datum end the drain within 2.5 s (calm from ${ e.calmFrom }, capped ${ e.drainCapped })` );
	// Land flow at the child line keeps it open even with the sea flat.
	( { field, e } = staged() );
	write( field, { landFlow: HU_CHILD, seaOff: 0 } );
	judge( field, e, 30 );
	assert.equal( e.calmFrom, undefined, `land flow at the child line (${ HU_CHILD } m2/s) did not hold the drain open` );

} );

test( 'The hand-back soaks the deepest water in on its own clock, lowers no surface faster than 0.1 m/s and never cuts the water', () => {

	const { field, e } = staged();
	// A 6 m pond left on land, the sea settled: the soak is paced from the deepest water, not the 0.04 m/s floor.
	write( field, { landWet: 100, landDeep: 6, seaOff: 0.1, restOff: 0.1 } );
	judge( field, e, 2.5 );
	assert.ok( e.calmFrom !== undefined, 'the hand-back began' );
	const soak = field.water.calm.soak; // what the solver soaks at
	assert.ok( Math.abs( soak - 6 / ( e.calmFrom + 120 - e.time ) ) < 1e-6, `the soak empties the deepest water in the time left (${ soak.toFixed( 4 ) } m/s for 6 m, expected ${ ( 6 / ( e.calmFrom + 120 - e.time ) ).toFixed( 4 ) })` );
	assert.ok( field.water.calm === e.calm && field.outer.calm === e.calm, 'both grids take the event\'s hand-back' );
	// Long past the plan, water still on land: the event keeps handing back (nothing is deleted at a deadline).
	const cut = judge( field, e, 300 );
	assert.ok( ! cut && field.water.calm === e.calm && e.calm.soak <= 0.1 + 1e-12, `300 s into the hand-back with water on land it still runs (ended ${ cut }, by ${ e.endedBy }, soak ${ field.water.calm?.soak?.toFixed( 3 ) } m/s, at most 0.1)` );
	// The water gone and the sea at rest: it ends, late, so the record says so.
	write( field, { landWet: 0, landDeep: 0, seaOff: 0.005, restOff: 0.005 } );
	assert.ok( judge( field, e, 0.2 ), 'with no water on land and the sea within 1 cm of datum the hand-back ends' );
	assert.ok( field.water.calm === null && field.outer.calm === null && e.endedBy === 'limit', `a hand-back that ran past its bound ends as 'limit' with the grids released (${ e.endedBy })` );
	// The solver's own hand-back on a sea cell 2 m high and a land cell 1 m deep: one 0.24 s step moves neither by more
	// than 0.1 m/s.
	const g = new WaterGrid( islet, { n: N, dx: DX, sponge: false } ), sea = at( g, 150, 0 ), land = at( g, 0, 0 );
	g.h[ sea ] += 2;
	g.h[ land ] = 1;
	g.calm = { rate: 0.5, soak: 0.1, fall: 0.1 };
	const before = [ g.h[ sea ], g.h[ land ] ];
	g.calmCell( sea, 0.24 );
	g.calmCell( land, 0.24 );
	const fallSea = before[ 0 ] - g.h[ sea ], fallLand = before[ 1 ] - g.h[ land ];
	assert.ok( fallSea > 0 && fallSea <= 0.1 * 0.24 + 1e-12 && fallLand <= 0.1 * 0.24 + 1e-12, `in one 0.24 s step the sea fell ${ fallSea.toFixed( 4 ) } m and the land water ${ fallLand.toFixed( 4 ) } m (at most 0.024)` );

} );

test( 'What holds a drain open is named: the open-sea cell standing furthest off datum beside the land cell with the largest flow outside ponds', () => {

	// The open sea 0.2 m over datum and 0.5 m at one cell off the beach (where a stream from a lake enters it), the bowl
	// over its rim: the grid's drain state names both cells (WaterGrid.pack; the GPU readback is held to it by
	// test/tsunami-gpu-parity.mjs).
	const g = new WaterGrid( islet, { n: N, dx: DX, sponge: false } ), mouth = at( g, 152, 0 ), rim = at( g, 40, 0 );
	for ( let k = 0; k < g.h.length; k ++ ) {

		const x = g.x + ( k % N ) * DX, z = g.z + Math.floor( k / N ) * DX;
		if ( g.bed[ k ] < 0 && g.spill[ k ] === 0 ) g.h[ k ] = 0.2 - g.bed[ k ];
		if ( Math.hypot( x - 40, z ) < 24 ) { g.h[ k ] = 2.5; g.qx[ k ] = k === rim ? 0.9 : 0.5; }

	}
	g.h[ mouth ] = 0.5 - g.bed[ mouth ];
	g.qx[ mouth ] = 0.9;
	g.pack();
	const s = g.stats;
	assert.ok( s.seaOffCell === mouth && Math.abs( s.seaOff - 0.5 ) < 1e-9, `the open-sea cell furthest off datum is named (cell ${ s.seaOffCell }, expected ${ mouth }; ${ s.seaOff?.toFixed( 3 ) } m off)` );
	assert.ok( s.landFlowCell === rim, `the land cell with the largest flow outside ponds is named (cell ${ s.landFlowCell }, expected ${ rim })` );
	// When the drain's bound fires on the real island the field records both, per grid, with where they are.
	const { field, e } = staged();
	const named = [];
	for ( const grid of [ field.water, field.outer ] ) {

		const sea = grid.bed.findIndex( ( b, k ) => b < - 1 && grid.spill[ k ] <= 0 && ! grid.covered?.[ k ] ), land = grid.bed.findIndex( ( b, k ) => b > 1 && ! grid.covered?.[ k ] );
		grid.h[ sea ] = 0.35 - grid.bed[ sea ];
		grid.h[ land ] = 0.5;
		Object.assign( grid.stats, { landFlow: 1, landFlowCell: land, seaOff: 0.35, seaOffCell: sea, landWet: 10, landDeep: 0.5, restOff: 0.35, landMoving: 0 } );
		named.push( { x: grid.x + ( sea % grid.n ) * grid.dx, z: grid.z + Math.floor( sea / grid.n ) * grid.dx } );

	}
	judge( field, e, 1201 );
	const held = e.heldOpen ?? [];
	assert.ok( e.drainCapped && held.length === 2 && held.every( ( r, i ) => r.seaCell && r.seaCell.x === named[ i ].x && r.seaCell.z === named[ i ].z && Math.abs( r.seaCell.ground + r.seaCell.depth - 0.35 ) < 1e-6 && r.cell ), `the bound records the open-sea cell that held each grid open and where it stands (${ JSON.stringify( held ) }, expected ${ JSON.stringify( named ) })` );

} );

test( 'A second tsunami started during the hand-back is not calmed by the first, and a tornado does not skip the hand-back', () => {

	let { field, e } = staged();
	write( field, { landWet: 10, landDeep: 1, seaOff: 0.1 } );
	judge( field, e, 2.5 );
	assert.ok( field.water.calm, 'the first tsunami is handing back' );
	field.start( 'tsunami', { ...DEFAULTS.tsunami, intensity: 2, warningLead: 3, seed: 8 } );
	assert.ok( field.water.calm === null && field.outer.calm === null, 'the second tsunami\'s approach is not damped by the first one\'s hand-back' );
	// A tornado running when the drain holds: the tsunami still hands its water back before it ends (the grid stays for
	// the tornado afterwards with nothing standing on land).
	( { field, e } = staged() );
	field.start( 'tornado', { ...DEFAULTS.tornado, seed: 3 } );
	write( field, { landWet: 10, landDeep: 1, seaOff: 0.1 } );
	const over = judge( field, e, 2.5 );
	assert.ok( ! over && e.calmFrom !== undefined && field.water.calm === e.calm, `with a tornado running the drain led into the hand-back (over ${ over }, calm from ${ e.calmFrom })` );

} );
