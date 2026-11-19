import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FerryService } from '../src/ferry/FerryService.js';

test( 'the timetable asks for her ramp quietly while she is off the berth (no helm toast for a player who never pressed R)', () => {

	const asks = [];
	const ferry = { berths: [ { name: 'Tidewater' }, { name: 'Joey' } ], ship: { moored: false }, castingOff: false, flood: 0, driven: false,
		lowerRamp( quiet ) { asks.push( quiet ); return false; } };
	const service = new FerryService( ferry, { short: true } );
	for ( let i = 0; i < 600; i ++ ) service.update( 1 / 60 ); // 10 s: the 4 s layover ends, then she is still not fast
	assert.ok( asks.length > 100, `the layover retried the ramp ${ asks.length } times in 6 s off the berth` );
	assert.deepEqual( [ ...new Set( asks ) ], [ true ], `every timetable ask is quiet (got ${ [ ...new Set( asks ) ].join( ', ' ) })` );

} );
