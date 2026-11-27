import test from 'node:test';
import assert from 'node:assert/strict';
import { CarrierPhysics } from '../src/aviation/CarrierPhysics.js';
import { FlightPhysics, approachAlpha } from '../src/aviation/FlightPhysics.js';
import { poseQ, attitude } from '../src/aviation/Math.js';
import { projectVelocity, ladderPose, iclsDeviation, compassHeading } from '../src/aviation/HudMath.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

test( 'projectVelocity places the flight path marker 3 deg below boresight for 5 deg nose-up in a 2 deg climb', () => {
	const ppd = 12.3;
	const q = poseQ( 0, 5 * RAD, 0 );
	const v = [ 0, 100 * Math.sin( 2 * RAD ), 100 * Math.cos( 2 * RAD ) ];
	const out = { x: 0, y: 0, ok: false };
	projectVelocity( q, v, ppd, out );
	assert.equal( out.ok, true );
	assert.ok( Math.abs( out.x ) < 0.05, `lateral drift ${ out.x } should be 0` );
	assert.ok( Math.abs( out.y - 3 * ppd ) < 0.5 * ppd, `expected +3 deg below boresight (${ ( 3 * ppd ).toFixed( 2 ) }), got ${ out.y.toFixed( 2 ) }` );
} );

test( 'ladderPose tilts horizon counter-clockwise in right bank and drops it on nose-up pitch', () => {
	const ppd = 12.3;
	// Right bank is negative in attitude(q).bank (body +X is screen left).
	const q = poseQ( 0, 10 * RAD, - 30 * RAD );
	const m = attitude( q );
	const out = { rot: 0, shift: 0 };
	ladderPose( m, ppd, out );
	assert.ok( Math.abs( out.rot - ( - 30 ) ) < 0.1, `expected rot -30 deg in right bank, got ${ out.rot }` );
	assert.ok( Math.abs( out.shift - 10 * ppd ) < 0.5, `expected shift +${ ( 10 * ppd ).toFixed( 2 ) }, got ${ out.shift.toFixed( 2 ) }` );
} );

test( 'iclsDeviation centres on the real training approach and drives localiser left when right of centreline', () => {
	const carrier = new CarrierPhysics();
	const flight = new FlightPhysics( carrier );
	flight.startApproach();
	flight.step( 1 / 120 );
	const out = { locDeg: 0, gsErrDeg: 0, distance: 0, active: false };
	iclsDeviation( carrier.runway( flight.position ), flight.phase, out );
	assert.equal( out.active, true );
	assert.ok( Math.abs( out.gsErrDeg ) < 0.25, `approach glideslope error ${ out.gsErrDeg.toFixed( 3 ) } deg` );
	assert.ok( Math.abs( out.locDeg ) < 0.5, `approach localiser error ${ out.locDeg.toFixed( 3 ) } deg` );

	// Shift 20 m right of centreline (crossTrack < 0 is starboard/right): fly-to needle must go left (locDeg < 0).
	const rightOfLine = carrier.fromRunway( - 20, - 500, 1.9 + 500 * Math.tan( 3.5 * RAD ) );
	iclsDeviation( carrier.runway( rightOfLine ), 'airborne', out );
	assert.equal( out.active, true );
	assert.ok( out.locDeg < - 1.5, `right of centreline must deflect localiser needle left (< -1.5 deg), got ${ out.locDeg.toFixed( 2 ) }` );
} );

test( 'approachAlpha matches the trim AoA used by FlightPhysics.startApproach', () => {
	const carrier = new CarrierPhysics();
	const flight = new FlightPhysics( carrier );
	flight.startApproach();
	const a0 = approachAlpha();
	// In calm air, startApproach trims pitch to gamma + trimAlpha (gamma = -3.5 deg), so alpha = pitch - gamma ≈ approachAlpha.
	const att = attitude( flight.quaternion );
	const impliedAlpha = att.pitch + 3.5 * RAD;
	assert.ok( Math.abs( impliedAlpha - a0 ) < 0.02, `implied ${ ( impliedAlpha * DEG ).toFixed( 2 ) } deg vs approachAlpha ${ ( a0 * DEG ).toFixed( 2 ) } deg` );
} );

test( 'compassHeading matches the existing data-heading formula across 0..360 deg', () => {
	for ( let deg = 0; deg < 360; deg ++ ) {
		const heading = deg * RAD;
		const legacy = ( 180 - heading * DEG + 360 ) % 360;
		const got = compassHeading( { heading } );
		assert.ok( Math.abs( got - legacy ) < 1e-9, `mismatch at ${ deg } deg: ${ got } vs ${ legacy }` );
	}
} );

test( 'HudMath functions allocate zero heap across 100,000 calls into caller scratch objects', () => {
	const q = poseQ( 0.4, 0.1, - 0.25 );
	const v = [ 12, 5, 95 ];
	const m = attitude( q );
	const runway = { along: - 480, cross: - 8, height: 32 };
	const fpm = { x: 0, y: 0, ok: false };
	const pose = { rot: 0, shift: 0 };
	const icls = { locDeg: 0, gsErrDeg: 0, distance: 0, active: false };
	for ( let i = 0; i < 5000; i ++ ) {
		projectVelocity( q, v, 12.3, fpm );
		ladderPose( m, 12.3, pose );
		iclsDeviation( runway, 'airborne', icls );
	}
	if ( typeof global.gc === 'function' ) {
		global.gc();
		const before = process.memoryUsage().heapUsed;
		for ( let i = 0; i < 100_000; i ++ ) {
			projectVelocity( q, v, 12.3, fpm );
			ladderPose( m, 12.3, pose );
			iclsDeviation( runway, 'airborne', icls );
		}
		global.gc();
		const growth = process.memoryUsage().heapUsed - before;
		assert.ok( growth < 64 * 1024, `expected < 64 KB heap growth over 100k calls, got ${ growth } bytes` );
	}
} );
