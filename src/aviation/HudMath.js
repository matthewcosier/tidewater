import { rotateInto, clamp } from './Math.js';
import { APPROACH } from './Constants.js';

// Pure, zero-allocation F/A-18 HUD projection math and prebuilt readout string tables.
// Coordinates follow Aviation's body frame: +Z nose forward, +Y up, +X screen left.
// SVG user coordinates: +x right, +y down, origin at boresight.
const DEG = 180 / Math.PI;
const CONJ = [ 0, 0, 0, 0 ];
const BODY = [ 0, 0, 0 ];

export function projectVelocity( q, v, ppd, out ) {

	CONJ[ 0 ] = - q[ 0 ];
	CONJ[ 1 ] = - q[ 1 ];
	CONJ[ 2 ] = - q[ 2 ];
	CONJ[ 3 ] = q[ 3 ];
	rotateInto( BODY, CONJ, v );
	if ( BODY[ 2 ] <= 1e-3 ) {

		out.ok = false;
		return out;

	}
	const k = ppd * DEG;
	out.x = - ( BODY[ 0 ] / BODY[ 2 ] ) * k;
	out.y = - ( BODY[ 1 ] / BODY[ 2 ] ) * k;
	out.ok = true;
	return out;

}

// Single source for compass heading (degrees 0..360) shared by the heading tape and data-heading.
export function compassHeading( m ) {

	return ( 180 - m.heading * DEG + 360 ) % 360;

}

// Pitch ladder rotation and vertical shift in SVG user units.
// Right bank is negative in attitude().bank and tilts the world horizon counter-clockwise (negative SVG deg).
// Nose-up pitch is positive and pushes the horizon downward (+y in SVG).
export function ladderPose( m, ppd, out ) {

	out.rot = m.bank * DEG;
	out.shift = m.pitch * DEG * ppd;
	return out;

}

// Carrier ICLS localiser and glideslope fly-to deviations (degrees).
// Carrier local +X is port (left), so cross < 0 means right of centreline -> locDeg < 0 (fly left).
// glideDeg > APPROACH.glideDeg means above glideslope -> gsErrDeg > 0 (fly down, SVG +y).
export function iclsDeviation( runway, phase, out ) {

	const dist = Math.max( 0, - runway.along );
	out.distance = dist;
	out.active = phase === 'airborne' && runway.along < 0 && dist < 1500;
	if ( ! out.active ) {

		out.locDeg = 0;
		out.gsErrDeg = 0;
		return out;

	}
	const d = Math.max( 1, dist );
	out.locDeg = Math.atan2( runway.cross, d ) * DEG;
	out.gsErrDeg = Math.atan2( runway.height - 1.9, d ) * DEG - APPROACH.glideDeg;
	return out;

}

// Prebuilt string tables avoid per-tick string formatting allocations on steady readouts.
let INT = null, HDG = null, PCT = null, TENTH = null;
function initTables() {

	if ( INT ) return;
	INT = new Array( 2001 );
	for ( let i = 0; i <= 2000; i ++ ) INT[ i ] = String( i );
	HDG = new Array( 360 );
	for ( let i = 0; i < 360; i ++ ) HDG[ i ] = String( i ).padStart( 3, '0' );
	PCT = new Array( 101 );
	for ( let i = 0; i <= 100; i ++ ) PCT[ i ] = `${ i }%`;
	TENTH = new Array( 1999 );
	for ( let i = - 999; i <= 999; i ++ ) {

		const a = Math.abs( i );
		TENTH[ i + 999 ] = `${ i < 0 ? '-' : '' }${ Math.floor( a / 10 ) }.${ a % 10 }`;

	}

}

export function intStr( n ) {

	initTables();
	const k = Math.round( n );
	return k >= 0 && k <= 2000 ? INT[ k ] : String( k );

}

export function hdgStr( deg ) {

	initTables();
	const k = ( ( Math.round( deg ) % 360 ) + 360 ) % 360;
	return HDG[ k ];

}

export function pctStr( frac ) {

	initTables();
	return PCT[ clamp( Math.round( frac * 100 ), 0, 100 ) ];

}

export function tenthStr( v ) {

	initTables();
	const k = Math.round( v * 10 );
	if ( k === 0 ) return TENTH[ 999 ]; // never "-0.0"
	return k >= - 999 && k <= 999 ? TENTH[ k + 999 ] : ( k / 10 ).toFixed( 1 );

}
