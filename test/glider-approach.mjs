import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData } from '../src/world/TerrainData.js';
import { CoastalRoute } from '../src/world/CoastalRoute.js';
import { CoastalRoad } from '../src/world/CoastalRoad.js';
import { Village } from '../src/world/Village.js';
import { Colliders } from '../src/world/Colliders.js';
import { ReefBatch } from '../src/world/reef/ReefBatch.js';
import { prepareEvacuationRoute } from '../src/evacuation/Route.js';
import { prepareWindFarmSites } from '../src/windfarm/Sites.js';
import { prepareGliderSite, BEACH } from '../src/glider/Site.js';
import { buildStation } from '../src/glider/Station.js';
import { Glider } from '../src/glider/Glider.js';
import { GliderCollision } from '../src/glider/Collision.js';
import { STEP, WING } from '../src/glider/GliderPhysics.js';
import { Scene } from '../src/engine/index.js';
import { StorageBuffer } from '../src/engine/gpu/Texture.js';
import { applyTerminalSite, PLACES } from '../src/ferry/Terminal.js';
import { JOEY_VILLAGE_SITE } from '../src/joey/Village.js';
import { DisasterField } from '../src/disasters/Field.js';
import { BOOT_WIND } from '../src/core/BootWind.js';
import { Crabs } from '../src/world/wildlife/Crabs.js';

const CLEARANCE = WING.span / 2 + 2;
const FLARE_BELOW = 1.5; // m above ground, as glider.spec flares
const IMPACT_MAX = 1.4;
const GUST_PHASES = 31; // clock offsets 0, 4 ... 120 s through the GliderAir gust cycle
const PHASE_STEP = 4; // s
const NEAR = 90; // m around the beach: every collider the approach could reach
const MAX_STEPS = 4000; // 33 s at 120 Hz, far longer than the 15 s glide
const SAND = 0.75; // sand cover fraction the crabs treat as beach (Crabs.sandAt)
const DRY = 0.5; // m: the start's ground stands at least this far above the water
const TIP = WING.span / 2; // m: wing tip from the keel

// The terrain's loose-sand mask through its one shared reader (the crabs burrow by it), so this test
// never indexes the grid itself.
const sandAt = ( terrain, x, z ) => Crabs.prototype.sandAt.call( { terrain }, x, z );

// Surface faults under the pilot and both wing tips at a touchdown: road (the coastal route's
// asphalt or gravel, terrain.roadSurfaceAt), water, or ground that is not sand.
function touchdownFaults( app, g ) {

	const terrain = app.terrainData;
	const field = app.disasters.field;
	const p = g.position;
	const right = [ Math.cos( g.metrics.heading ?? 0 ), - Math.sin( g.metrics.heading ?? 0 ) ];
	const faults = [];
	for ( const side of [ 0, - 1, 1 ] ) {

		const x = p[ 0 ] + right[ 0 ] * TIP * side;
		const z = p[ 2 ] + right[ 1 ] * TIP * side;
		const road = terrain.roadSurfaceAt?.( x, z );
		if ( road ) faults.push( `${ side ? 'tip' : 'pilot' } on ${ road.kind } at x ${ x.toFixed( 1 ) } z ${ z.toFixed( 1 ) }` );

	}
	if ( terrain.heightAt( p[ 0 ], p[ 2 ] ) < ( field.waterAt( p[ 0 ], p[ 2 ] ) || 0 ) ) faults.push( 'pilot in the water' );
	const sand = sandAt( terrain, p[ 0 ], p[ 2 ] );
	if ( sand < SAND ) faults.push( `sand cover ${ sand.toFixed( 2 ) } under the pilot` );
	return faults;

}

// Same App construction order and stubs as test/walker-cadence.mjs: only canvas raster and GPU
// uploads are isolated.
const priorDocument = globalThis.document;
const upload = ReefBatch.prototype.upload;
const textures = CoastalRoad.prototype.loadTextures;
const write = StorageBuffer.prototype.write;
const context = new Proxy( { getImageData: () => ( { data: new Uint8ClampedArray( 1024 * 1024 * 4 ) } ) }, { get: ( o, k ) => k in o ? o[ k ] : () => {} } );
globalThis.document = { createElement: () => ( { getContext: () => context } ) };
ReefBatch.prototype.upload = () => {};
CoastalRoad.prototype.loadTextures = async () => {};
StorageBuffer.prototype.write = function ( data ) {

	this.pendingData = data.slice();

};
test.after( () => {

	globalThis.document = priorDocument;
	ReefBatch.prototype.upload = upload;
	CoastalRoad.prototype.loadTextures = textures;
	StorageBuffer.prototype.write = write;

} );

function island() {

	const terrain = new TerrainData();
	for ( const place of Object.values( PLACES ) ) applyTerminalSite( terrain, undefined, place );
	applyTerminalSite( terrain, JOEY_VILLAGE_SITE, PLACES.joey );
	const colliders = new Colliders();
	const scene = new Scene();
	const village = new Village( { scene, terrain, colliders } );
	const coastalRoute = new CoastalRoute( terrain );
	prepareEvacuationRoute( terrain );
	prepareWindFarmSites( terrain );
	prepareGliderSite( terrain, coastalRoute );
	new CoastalRoad( scene, terrain, coastalRoute, colliders );
	const field = new DisasterField( ( x, z ) => terrain.heightAt( x, z ) );
	const toward = BOOT_WIND.direction * Math.PI / 180;
	const ambient = { x: BOOT_WIND.speed * Math.cos( toward ), z: BOOT_WIND.speed * Math.sin( toward ) };
	field.ambient = () => ambient;
	const sun = { value: { y: 0.5 } };
	const app = { terrainData: terrain, coastalRoute, colliders, scene, village, disasters: { field }, atmosphere: { sunDir: sun } };
	buildStation( app );
	return { app, sun };

}

// 3D gap from a point to a collider: oriented box footprint and height span, or a cylinder.
function gap( c, x, y, z ) {

	let across;
	let bottom;
	let top;
	if ( c.center ) {

		const dx = x - c.center.x;
		const dz = z - c.center.z;
		const lx = Math.abs( dx * c.cos - dz * c.sin ) - c.half.x;
		const lz = Math.abs( dx * c.sin + dz * c.cos ) - c.half.z;
		across = Math.hypot( Math.max( 0, lx ), Math.max( 0, lz ) );
		bottom = c.bottom;
		top = c.top;

	} else {

		across = Math.max( 0, Math.hypot( x - c.x, z - c.z ) - c.radius );
		bottom = c.yMin;
		top = c.yMax;

	}
	const up = y > top ? y - top : y < bottom ? bottom - y : 0;
	return Math.hypot( across, up );

}

test( 'the practice beach approach clears every collider by the half-span plus 2 m and lands on the beach in every gust phase', () => {

	const { app, sun } = island();
	const glider = new Glider( app );
	const g = glider.flight;
	const env = glider.env;
	const collision = new GliderCollision( app.colliders );
	env.obstacleAt = ( x, y, z ) => collision.at( x, y, z );
	const near = [ ...app.colliders.boxes, ...app.colliders.cylinders ].filter( c => Math.hypot( ( c.center?.x ?? c.x ) - BEACH.x, ( c.center?.z ?? c.z ) - BEACH.z ) < NEAR );
	assert.ok( near.some( c => c.tag === 'guardrail' ), 'the coastal guardrail by the beach is in the collider set' );
	const failures = [];
	for ( const sunY of [ 0.5, 0 ] ) {

		sun.value.y = sunY;
		for ( let k = 0; k < GUST_PHASES; k ++ ) {

			glider.time = k * PHASE_STEP;
			g.approach( env );
			const [ sx, , sz ] = g.position;
			const ground = app.terrainData.heightAt( sx, sz );
			const water = app.disasters.field.waterAt( sx, sz ) || 0;
			const overLand = ground > water + DRY;
			const startNote = `start x ${ sx.toFixed( 1 ) } z ${ sz.toFixed( 1 ) } ground ${ ground.toFixed( 2 ) } m, water ${ water.toFixed( 2 ) } m`;
			let worst = { gap: Infinity, tag: '', x: 0, z: 0 };
			for ( let i = 0; i < MAX_STEPS && g.phase === 'airborne'; i ++ ) {

				g.controls.flare = g.metrics.agl < FLARE_BELOW && g.metrics.airTime > 0.5;
				g.step( STEP, env );
				glider.time += STEP;
				const p = g.position;
				for ( const c of near ) {

					const d = Math.min( gap( c, p[ 0 ], p[ 1 ], p[ 2 ] ), gap( c, p[ 0 ], p[ 1 ] - 1.45, p[ 2 ] ) );
					if ( d < worst.gap ) worst = { gap: d, tag: c.tag, x: p[ 0 ], z: p[ 2 ] };

				}

			}
			const where = `sun ${ sunY }, gust phase ${ k * PHASE_STEP } s: ${ g.phase } '${ g.reason }' at x ${ g.position[ 0 ].toFixed( 1 ) } z ${ g.position[ 2 ].toFixed( 1 ) }, closest ${ worst.gap.toFixed( 2 ) } m to ${ worst.tag } at x ${ worst.x.toFixed( 1 ) } z ${ worst.z.toFixed( 1 ) }`;
			const faults = g.phase === 'landed' ? touchdownFaults( app, g ) : [];
			if ( ! overLand ) faults.push( `${ startNote }: start over the sea` );
			const fromFlags = Math.hypot( g.position[ 0 ] - BEACH.x, g.position[ 2 ] - BEACH.z );
			if ( fromFlags > BEACH.radius ) faults.push( `touchdown ${ fromFlags.toFixed( 1 ) } m from the beach flags (beach radius ${ BEACH.radius } m)` );
			if ( g.metrics.impactSpeed >= IMPACT_MAX ) faults.push( `impact ${ g.metrics.impactSpeed.toFixed( 2 ) } m/s descent (bound ${ IMPACT_MAX })` );
			if ( g.reason !== 'Beach landing complete' || worst.gap < CLEARANCE || faults.length ) failures.push( `${ where }${ faults.length ? '; ' + faults.join( ', ' ) : '' }` );

		}

	}
	assert.deepEqual( failures, [], `${ failures.length } of ${ 2 * GUST_PHASES } approaches failed (need a start over land, a sand touchdown off the road, a beach landing and ${ CLEARANCE.toFixed( 1 ) } m clear):\n${ failures.slice( 0, 6 ).join( '\n' ) }` );

} );

const LATE = [ 0.1, 0.2 ]; // s after the feet first come under FLARE_BELOW

test( 'a flare pressed up to 0.2 s late still ends in a running landing on the beach in every gust phase', () => {

	const { app, sun } = island();
	const glider = new Glider( app );
	const g = glider.flight;
	const env = glider.env;
	const collision = new GliderCollision( app.colliders );
	env.obstacleAt = ( x, y, z ) => collision.at( x, y, z );
	const failures = [];
	for ( const late of LATE ) for ( const sunY of [ 0.5, 0 ] ) {

		sun.value.y = sunY;
		for ( let k = 0; k < GUST_PHASES; k ++ ) {

			glider.time = k * PHASE_STEP;
			g.approach( env );
			let seen = - 1;
			let flareAgl = NaN;
			for ( let i = 0; i < MAX_STEPS && g.phase === 'airborne'; i ++ ) {

				if ( seen < 0 && g.metrics.agl < FLARE_BELOW && g.metrics.airTime > 0.5 ) seen = i;
				if ( seen >= 0 && i >= seen + Math.round( late / STEP ) && ! g.controls.flare ) {

					g.controls.flare = true;
					flareAgl = g.metrics.agl;

				}
				g.step( STEP, env );
				glider.time += STEP;

			}
			g.controls.flare = false;
			if ( g.reason !== 'Beach landing complete' || g.metrics.impactSpeed >= IMPACT_MAX ) failures.push( `${ late } s late, sun ${ sunY }, gust phase ${ k * PHASE_STEP } s: flare at ${ flareAgl.toFixed( 2 ) } m, ${ g.phase } '${ g.reason }' at ${ g.metrics.landingSpeed.toFixed( 2 ) } m/s, impact ${ g.metrics.impactSpeed.toFixed( 2 ) } m/s descent` );

		}

	}
	assert.deepEqual( failures, [], `${ failures.length } of ${ LATE.length * 2 * GUST_PHASES } late flares did not land running on the beach:\n${ failures.slice( 0, 6 ).join( '\n' ) }` );

} );

test( 'a touchdown on the coastal road inside the beach zone reports the road, not the beach', () => {

	const { app } = island();
	const glider = new Glider( app );
	const g = glider.flight;
	const env = glider.env;
	const x = -100;
	const z = -82.5;
	assert.equal( app.terrainData.roadSurfaceAt( x, z )?.kind, 'asphalt', 'the staging point is on the asphalt' );
	assert.ok( Math.hypot( x - BEACH.x, z - BEACH.z ) < 45, 'the staging point is inside the beach message zone' );
	g.approach( env );
	g.position = [ x, app.terrainData.heightAt( x, z ) + 1.5, z ];
	g.velocity[ 1 ] = - 0.3; // m/s: a gentle flared touchdown
	g.controls.flare = true;
	for ( let i = 0; i < 600 && g.phase === 'airborne'; i ++ ) g.step( STEP, env );
	assert.equal( g.phase, 'landed', `staged touchdown ended '${ g.reason }'` );
	assert.doesNotMatch( g.reason, /Beach/, `a road touchdown said '${ g.reason }'` );
	assert.match( g.reason, /road/i, `a road touchdown said '${ g.reason }'` );

} );
