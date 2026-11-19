import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PerspectiveCamera,Vector3,Euler} from '../src/engine/index.js';
import {loadModel} from '../src/rally/VehicleModel.js';
import {GliderBody} from '../src/glider/GliderBody.js';
import {ThirdPersonCamera} from '../src/player/ThirdPersonCamera.js';

const bytes = await fs.readFile( new URL( '../public/glider/glider.glb', import.meta.url ) );
const glider = await loadModel( 'data:model/gltf-binary;base64,' + bytes.toString( 'base64' ) );
const EYE = 1.62, SUBJECT = [ 0, - 0.5, - 0.9 ]; // m: eye height; head, chest and hips below the eye
const WING_SEEN = 0.7; // fade (0 solid, 1 gone) at which the sail no longer counts as hiding him

function wing( roll ) {

	const s = Math.sin( roll / 2 ), flight = { position: [ 0, 0, 0 ], quaternion: [ 0, 0, s, Math.cos( roll / 2 ) ], velocity: [ 0, 0, 0 ], omega: [ 0, 0, 0 ], phase: 'landed' };
	const body = new GliderBody( glider.root, flight );
	// sit the lowest point of the wing on the beach (y 0)
	let low = Infinity;
	for ( const t of body.cameraTriangles ) for ( const v of [ t.a, t.b, t.c ] ) low = Math.min( low, new Vector3( v.x, v.y, v.z ).applyQuaternion( { x: 0, y: 0, z: s, w: Math.cos( roll / 2 ) } ).y );
	flight.position[ 1 ] = - low;
	return body;

}

test( 'the walker is never left behind opaque sail: the wing fades when it hides him and stays solid when it does not', () => {

	const hidden = [], ghost = [];
	let faded = 0;
	let poses = 0;
	for ( const roll of [ 0, 0.6 ] ) {

		const body = wing( roll ), cam = new PerspectiveCamera( 60, 16 / 9, 0.1, 4000 ), boom = new ThirdPersonCamera();
		const player = { mode: 'walk', camera: cam, cameraObstacles: new Set( [ body ] ), terrain: { heightAt: () => 0 }, colliders: null };
		for ( const radius of [ 1.2, 2.5, 3.5 ] ) for ( let k = 0; k < 16; k ++ ) for ( const turn of [ - 0.5, 0, 0.5 ] ) for ( const pitch of [ - 0.25, - 0.05 ] ) {

			// he cannot stand inside the wing: GliderBody's sail contact (0.3 m capsule, 1.8 m tall) holds him at its
			// edge, where he stands after E or after walking into it
			const a = k * Math.PI / 8, feet = new Vector3( Math.sin( a ) * radius, 0, Math.cos( a ) * radius );
			body.resolveCapsule( feet, 0.3, 1.8 );
			const x = feet.x, z = feet.z;
			// he looks away from the wing (the lens behind him, the wing between): yaw puts the view's -z outward
			const yaw = Math.atan2( - x, - z ) + Math.PI + turn;
			boom.reset();
			for ( let f = 0; f < 90; f ++ ) {

				cam.position.set( x, EYE, z );
				cam.quaternion.setFromEuler( new Euler( pitch, yaw, 0, 'YXZ' ) );
				boom.apply( player, 1 / 60 );

			}
			poses ++;
			const fade = body.fade || 0, pose = `roll ${ roll } r ${ radius } a ${ a.toFixed( 2 ) } turn ${ turn } pitch ${ pitch }`;
			let crossed = false;
			for ( const dy of SUBJECT ) {

				const from = new Vector3( x, EYE + dy, z ), to = cam.position.clone().sub( from ), length = to.length();
				if ( body.cameraRaycast( from, to.divideScalar( length ), length ) < length - 0.05 ) {

					crossed = true;
					if ( fade < WING_SEEN ) hidden.push( `${ pose } at ${ dy } (boom ${ length.toFixed( 2 ) } m, fade ${ fade.toFixed( 2 ) })` );
					break;

				}

			}
			if ( crossed && fade >= WING_SEEN ) faded ++;
			if ( ! crossed && fade > 0 ) ghost.push( `${ pose } (fade ${ fade.toFixed( 2 ) })` );

		}

	}
	assert.equal( poses, 576 );
	assert.equal( hidden.length, 0, `${ hidden.length } of ${ poses } poses leave the walker behind opaque sail: ${ hidden.slice( 0, 5 ).join( '; ' ) }` );
	assert.equal( ghost.length, 0, `${ ghost.length } of ${ poses } poses fade a wing that hides nothing: ${ ghost.slice( 0, 5 ).join( '; ' ) }` );
	console.log( `${ poses } poses: ${ faded } with a line across the wing, all faded to at least ${ WING_SEEN }; the rest solid` );

} );
