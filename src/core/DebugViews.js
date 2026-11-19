import { Vector3 } from '../engine/math/index.js';
import { WORLD } from '../world/WorldLayout.js';
import { boreFront, COAST_BAND, LAND_BAND } from '../disasters/FloodLook.js';

// Joey Island across the strait, placed from its terminal so the views follow it when Joey moves
// (WORLD.joeyTerminal). The island's middle lies about 356 m east and 108 m south of its terminal.
// Eye and target are offsets from the terminal (m); yaw and pitch aim the eye at the target.
const JT = WORLD.joeyTerminal.position;
function joeyView( dx, y, dz, ax, ay, az, time ) {

	const p = [ JT.x + dx, y, JT.z + dz ], at = [ JT.x + ax, ay, JT.z + az ];
	const yaw = Math.atan2( p[ 0 ] - at[ 0 ], p[ 2 ] - at[ 2 ] );
	const pitch = Math.atan2( at[ 1 ] - y, Math.hypot( at[ 0 ] - p[ 0 ], at[ 2 ] - p[ 2 ] ) );
	return { p, yaw, pitch, time };

}

// Named review cameras used to check every change from the same set of angles.
// window.__view( name ) jumps there; window.__views lists them.
export const VIEWS = {
	// the default tornado (village, heading +x at 3 m/s) about 25-35 s in, from 2 km, 500 m, 150 m and the ground
	tornadoFar: { p: [ 120, 150, 1885 ], yaw: 0, pitch: 0.1, time: 15.5 },
	tornado500: { p: [ 120, 60, 385 ], yaw: 0, pitch: 0.3, time: 15.5 },
	tornado150: { p: [ 120, 25, 35 ], yaw: 0, pitch: 0.35, time: 15.5 },
	tornadoGround: { p: [ 100, 3.5, - 55 ], yaw: - 0.68, pitch: 0.5, time: 15.5 },
	beach: { p: [ 15, 3.0, - 58 ], yaw: Math.PI, pitch: - 0.08, time: 16.2 },
	surf: { p: [ 12, 1.7, - 44 ], yaw: Math.PI + 0.25, pitch: - 0.02, time: 16.2 },
	surfSide: { p: [ 40, 2.2, - 36 ], yaw: Math.PI * 0.62, pitch: - 0.08, time: 10.5 },
	swash: { p: [ 10, 1.6, - 49 ], yaw: Math.PI + 0.1, pitch: - 0.35, time: 16.2 },
	sunGlitter: { p: [ 0, 12, 120 ], yaw: Math.PI * 0.5, pitch: - 0.1, time: 16.2 },
	deepBlue: { p: [ 0, 3, 200 ], yaw: - Math.PI * 0.5, pitch: - 0.06, time: 12.5 },
	aerial: { p: [ 60, 95, 140 ], yaw: Math.PI * 0.08, pitch: - 0.55, time: 15.0 },
	shallowSeabed: { p: [ 8, 1.6, - 30 ], yaw: Math.PI, pitch: - 0.75, time: 13.0 },
	underwater: { p: [ - 70, - 2.5, 50 ], yaw: Math.PI * 0.8, pitch: 0.25, time: 13.0 },
	waterline: { p: [ 5, 0.02, - 10 ], yaw: Math.PI, pitch: 0.0, time: 14.0 },
	sunset: { p: [ 20, 2.5, - 50 ], yaw: Math.PI * 1.35, pitch: 0.02, time: 18.35 },
	sunsetWest: { p: [ 20, 2.5, - 50 ], yaw: 2.02, pitch: 0.03, time: 18.05 },
	pier: { p: [ 75, 4, - 10 ], yaw: Math.PI * 1.15, pitch: - 0.1, time: 15.5 },
	village: { p: [ 62, 7, - 62 ], yaw: 0.34, pitch: - 0.12, time: 15.5 },
	// The village from 150 m out and 60 m up, along the village view's line: disaster damage reviews (docs/disaster-damage.md).
	village150: { p: [ 92, 60, 26 ], yaw: 0.36, pitch: - 0.38, time: 15.5 },
	// from the pier over the shallows, looking down (refraction near the bottom edge of the screen)
	pierShallows: { p: [ 53.4, 3.92, 5 ], yaw: 1.2, pitch: - 0.45, time: 9.0 },
	pierShallowsE: { p: [ 56.6, 3.92, 5 ], yaw: - 1.2, pitch: - 0.45, time: 16.5 },
	// looking at the sun from the beach, a little off axis (lens flare, sun disc); lookSun: aimed once the sky has updated
	sunFlare: { p: [ 15, 3.0, - 58 ], yaw: 0, pitch: 0, time: 11.0, lookSun: [ 0.18, - 0.08 ] },
	// at the waterline looking down toward the sun over the swash film (its edge on the wet sand)
	swashFilm: { p: [ 10, 1.7, - 44 ], yaw: 0, pitch: 0, time: 16.2, lookSun: [ - 0.5, - 1.0 ] },
	swashFilmE: { p: [ 30, 1.7, - 39 ], yaw: 0, pitch: 0, time: 16.2, lookSun: [ - 0.5, - 0.9 ] },
	// from above the beach: the back edge of the swash sheet in the backwash (Dan's view)
	swashAbove: { p: [ 46.08, 23.35, - 53.27 ], yaw: 1.87, pitch: - 0.57, time: 16.2 },
	palms: { p: [ - 30, 3.2, - 58 ], yaw: Math.PI * 0.42, pitch: - 0.1, time: 9.5 },
	tsunamiApproach: { p: [ 15, 4.5, - 60 ], yaw: Math.PI, pitch: 0.05, time: 15.5 },
	tsunamiImpact: { p: [ 62, 24, - 118 ], yaw: Math.PI, pitch: - 0.16, time: 15.5 },
	tsunamiFlood: { p: [ 62, 32, - 66 ], yaw: 0.34, pitch: - 0.55, time: 15.5 },
	tsunamiMegaWall: { p: [ 40, 90, - 280 ], yaw: Math.PI, pitch: 0.1, time: 15.5 },
	village150: { p: [ 92, 60, 26 ], yaw: 0.36, pitch: - 0.38, time: 15.5 },
	tsunamiAir: { p: [ 450, 220, - 30 ], yaw: Math.PI * 0.5, pitch: - 0.3, time: 15.5 },
	tHeadW: { p: [ - 150, 6, 40 ], yaw: 1.156, pitch: 0.02, time: 15.0 },
	tLowSun: { p: [ 60, 95, 140 ], yaw: Math.PI * 0.08, pitch: - 0.35, time: 17.6 },
	tValley: { p: [ 35, 16, - 175 ], yaw: 0.1, pitch: 0.12, time: 10.0 },
	tSummit: { p: [ - 60, 300, - 470 ], yaw: Math.PI * 1.02, pitch: - 0.35, time: 16.0 },
	tStacks: { p: [ - 240, 8, 300 ], yaw: 0.15, pitch: - 0.05, time: 16.5 },
	tCove: { p: [ - 160, 2.2, - 30 ], yaw: 1.35, pitch: - 0.08, time: 10.5 },
	tMorning: { p: [ 18, 3.0, - 60 ], yaw: 0.2, pitch: 0.05, time: 7.2 },
	// Joey from the air, north-west of the island (terrain heights, shore foam, grass at range)
	joeyAir: joeyView( 206, 260, - 412, 356, 0, 108, 15.0 ),
	// the same with the sun low in the west: Joey's hills cast terrain sun shadows (shadow-height mips)
	joeyLowSun: joeyView( 206, 260, - 412, 356, 0, 108, 18.2 ),
	// from a ferry's deck mid-strait, about 650 m out
	joeyStrait: joeyView( 150, 9, - 650, 356, 10, 108, 15.0 ),
	// on Joey's plateau, about 10 m up, looking east along the meadow
	joeyMeadow: joeyView( 276, 24, 128, 520, 20, 100, 15.5 ),
	// high over Joey looking south to the terrain's south edge (z 2304) and the CDLOD root row past it
	joeySouth: joeyView( 356, 420, 0, 356, 0, 900, 15.0 ),
};

export const FRONT_SHORE = 160, FRONT_SHORE_LO = 120, FRONT_SHORE_HI = 200, FRONT_STREET = 45; // m
export const STREET_TURNS = [ 0, 0.6, - 0.6, 1.2, - 1.2 ]; // rad
export const SHORE_TURNS = [ 0, 0.4, - 0.4, 0.8, - 0.8, 1.2, - 1.2 ], SHORE_LIFTS = [ 3, 8, 16, 30, 60 ]; // rad, m
export function clearSight( px, py, pz, tx, ty, tz, groundAt ) {

	for ( let i = 1; i < 12; i ++ ) {

		const t = i / 12;
		if ( groundAt( px + ( tx - px ) * t, pz + ( tz - pz ) * t ) > py + ( ty - py ) * t - 0.2 ) return false;

	}
	return true;

}

export function frontPose( kind, f, groundAt ) {

	let px, py, pz, tx, ty, tz;
	if ( kind === 'air' ) {

		const back = 150 + f.crest, side = 90 + 0.3 * f.crest; // m
		px = f.x - f.dirX * back - f.dirZ * side;
		pz = f.z - f.dirZ * back + f.dirX * side;
		py = Math.max( groundAt( px, pz ), 0 ) + 90 + 1.3 * f.crest;
		tx = f.x + f.dirX * 60;
		tz = f.z + f.dirZ * 60;
		ty = Math.max( groundAt( tx, tz ), 0 );

	} else {

		const ahead = kind === 'street' ? FRONT_STREET + Math.min( 75, 3 * Math.max( 0, f.crest - f.bed ) ) : FRONT_SHORE;
		tx = f.x;
		tz = f.z;
		ty = Math.max( f.crest * 0.6, f.bed + 0.5 );
		const place = ( turn, lift ) => {

			const c = Math.cos( turn ), s = Math.sin( turn ), hx = f.dirX * c - f.dirZ * s, hz = f.dirX * s + f.dirZ * c;
			px = f.x + hx * ahead;
			pz = f.z + hz * ahead;
			const g = groundAt( px, pz );
			py = Math.max( g, 0 ) + lift;
			return g;

		};
		if ( kind === 'street' ) {

			for ( const turn of STREET_TURNS ) if ( place( turn, 1.7 ) > f.crest + 0.5 && clearSight( px, py, pz, tx, ty, tz, groundAt ) ) break;

		} else search: {

			for ( const lift of SHORE_LIFTS ) for ( const turn of SHORE_TURNS ) {

				place( turn, lift );
				if ( clearSight( px, py, pz, tx, ty, tz, groundAt ) ) break search;

			}
			place( 0, SHORE_LIFTS[ SHORE_LIFTS.length - 1 ] );

		}

	}
	const fx = tx - px, fy = ty - py, fz = tz - pz;
	const yaw = Math.atan2( - fx, - fz ), pitch = Math.min( 0.7, Math.max( - 1.2, Math.atan2( fy, Math.hypot( fx, fz ) ) ) );
	return { p: [ px, py, pz ], yaw, pitch, target: [ tx, ty, tz ] };

}

export function installDebugViews( app ) {

	window.__views = [ ...Object.keys( VIEWS ), 'swept' ];
	// the current camera as a VIEWS entry (paste it back as a named view): __pose()
	window.__pose = () => {

		const c = app.camera, e = new Vector3().setFromMatrixColumn( c.matrixWorld, 2 ).negate();
		const r = ( v ) => Math.round( v * 100 ) / 100;
		return JSON.stringify( { p: [ r( c.position.x ), r( c.position.y ), r( c.position.z ) ], yaw: r( Math.atan2( - e.x, - e.z ) ), pitch: r( Math.asin( e.y ) ), time: r( app.settings.timeOfDay ) } );

	};
	const ground = ( x, z ) => app.terrainData.heightAt( x, z );
	const staged = {};
	const front = ( kind, near = null ) => {

		const w = app.disasterWater, g = w?.grid;
		return g ? boreFront( w.packed, g.n, g.dx, g.x, g.z, kind === 'street' ? LAND_BAND : COAST_BAND, ground, {}, { edge: kind === 'street', near } ) : null;

	};
	window.__viewFront = ( kind ) => {

		const f = front( kind );
		if ( ! f ) return null;
		staged[ kind ] = [ f.x, f.z ];
		const v = frontPose( kind, f, ground );
		app.settings.timeOfDay = 15.5;
		if ( app.setFreeCam ) app.setFreeCam( true );
		app.reviewPose = `front-${ kind }`;
		app.fly.setPose( new Vector3( ...v.p ), v.yaw, v.pitch );
		app.fly.velocity.set( 0, 0, 0 );
		return { ...f, pose: v };

	};
	window.__frontOnScreen = ( kind ) => {

		const f = front( kind, staged[ kind ] ?? null );
		if ( ! f ) return false;
		const c = new Vector3( f.x, Math.max( f.crest * 0.6, f.bed + 0.5 ), f.z ).applyMatrix4( app.camera.matrixWorldInverse );
		if ( c.z >= 0 ) return false;
		c.applyMatrix4( app.camera.projectionMatrix );
		// the street view holds the edge in the middle third across the frame
		return Math.abs( c.x ) <= ( kind === 'street' ? 1 / 3 : 1 ) && Math.abs( c.y ) <= 1;

	};
	window.__view = ( name ) => {

		if ( name === 'swept' ) return frameSwept( app );
		const v = VIEWS[ name ];
		if ( ! v ) return 'unknown view';
		if ( v.time !== undefined ) app.settings.timeOfDay = v.time;
		if ( app.setFreeCam ) app.setFreeCam( true );
		app.reviewPose = name;
		app.worldTools?.closeAll();
		app.fly.setPose( new Vector3( ...v.p ), v.yaw, v.pitch );
		app.fly.velocity.set( 0, 0, 0 );
		return name;

	};

}

const SWEPT_BACK = 7, SWEPT_UP = 3.5; // m
const UNDER_BACK = 3.2, UNDER_LENS = 0.6, BED_CLEAR = 0.35, DEEP = 1.0; // m
function frameSwept( app ) {

	let best = null, who = null, score = 0;
	for ( const p of app.people?.list ?? [] ) {

		const rd = p.knock?.rag?.rd;
		if ( ! rd || rd.phase === 'idle' ) continue;
		const s = rd.cling ? 3 : rd.pinned ? 2 : 1;
		if ( s > score ) {

			score = s;
			best = rd;
			who = p;

		}

	}
	if ( ! best ) return 'no knocked body';
	const a = ( app.disasters?.field?.events.get( 'tsunami' )?.direction ?? - 90 ) * Math.PI / 180;
	const cx = Math.cos( a ), cz = Math.sin( a ), f = best.focus;
	// the flood surface at the body (the ragdoll's own water height, read from the disaster field)
	const w = Number.isFinite( best.waterY ) ? best.waterY : app.disasters?.field?.waterAt( f.x, f.z ) ?? 0;
	const bedAt = ( x, z ) => app.terrainData?.heightAt( x, z ) ?? - Infinity;
	const ux = f.x + cx * UNDER_BACK, uz = f.z + cz * UNDER_BACK;
	const lens = Math.min( f.y, w - UNDER_LENS ), floor = Math.max( bedAt( f.x, f.z ), bedAt( ux, uz ) ) + BED_CLEAR;
	const under = f.y < w && w - bedAt( f.x, f.z ) > DEEP && lens > floor;
	if ( app.setFreeCam ) app.setFreeCam( true );
	if ( under ) app.fly.setPose( new Vector3( ux, lens, uz ), Math.atan2( cx, cz ), Math.atan2( f.y - lens, UNDER_BACK ) );
	else app.fly.setPose( new Vector3( f.x + cx * SWEPT_BACK, f.y + SWEPT_UP, f.z + cz * SWEPT_BACK ), Math.atan2( cx, cz ), - Math.atan2( SWEPT_UP, SWEPT_BACK ) );
	app.fly.velocity.set( 0, 0, 0 );
	return { view: 'swept', id: who.id, clinging: !! best.cling, pinned: !! best.pinned, under };

}
