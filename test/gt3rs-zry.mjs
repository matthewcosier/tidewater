// The GT3RS ZRY: the owner's own 992 GT3 RS model (tools/rally/import_gt3rs_zry.mjs) on the COSIER car's
// physics kind 6. It must stand on that kind's contact patches, roll its discs and tyres while the
// callipers steer, carry no plates, keep its side graphic as a texture, give the damage rig its lamps,
// glass, paint and wing, and fit the game's triangle budget.
//   node --test test/gt3rs-zry.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { RallyPhysics } from '../public/rally/rally_physics.js';
import { VEHICLES } from '../src/rally/Vehicles.js';
import { loadModel } from '../src/rally/VehicleModel.js';
import { bindWheels, poseWheel } from '../src/rally/WheelRig.js';
import { Vector3 } from '../src/engine/index.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';

const asset = path => readFile( new URL( '../public/rally/' + path, import.meta.url ) );
await init( { module_or_path: await asset( 'rally_physics_bg.wasm' ) } );
const car = VEHICLES.gt3rszry;
const bytes = await asset( car.file + '.glb' );
const gltf = parseGLB( bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ) );
const withModel = async run => {
	globalThis.__assetFile = () => bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
	try { return await run( await loadModel( car.file ) ); } finally { delete globalThis.__assetFile; }
};

test( 'the ZRY has its own picker entry and shares the COSIER GT3 RS physics', () => {
	const cosier = VEHICLES.gt3rs;
	assert.equal( car.name, 'GT3RS ZRY' );
	for ( const key of [ 'id', 'tag', 'mass', 'radius', 'mount', 'width', 'idle', 'redline' ] ) assert.equal( car[ key ], cosier[ key ], key );
	assert.deepEqual( car.hull, cosier.hull );
} );

test( 'the ZRY launches on asphalt with its four hubs over physics kind 6 contact patches', () => {
	const sim = new RallyPhysics();
	try {
		sim.set_terrain( new Float32Array( 25 ), 5, 400, - 200 );
		sim.set_roads( new Float32Array( [ 0, - 190, 0, 190, 5, 1 ] ) );
		sim.select_vehicle( car.id );
		sim.reset( 0, 0.45, 0, 0 );
		for ( let i = 0; i < 360; i ++ ) sim.advance( 1 / 120, 0, 0, 0, 1 );
		const s = sim.snapshot();
		assert.equal( s[ 10 ], 4 );
		for ( const [ i, name ] of [ 'WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR' ].entries() ) {
			const carrier = gltf.nodes.find( n => n.name === name );
			const error = Math.hypot( carrier.t[ 0 ] - s[ 29 + i * 10 ], carrier.t[ 2 ] - s[ 31 + i * 10 ] );
			assert.ok( error < 0.015, `${ name } is ${ error.toFixed( 3 ) } m from its contact patch` );
			// the hub height is the model's own loaded radius, near the solver's 0.359 m mean tyre
			assert.ok( carrier.t[ 1 ] > 0.32 && carrier.t[ 1 ] < 0.37, `${ name } hub at ${ carrier.t[ 1 ].toFixed( 3 ) } m` );
		}
		let steps = 0;
		while ( steps < 720 && sim.snapshot()[ 7 ] < 100 ) {
			sim.advance( 1 / 120, 1, 0, 0, 0 );
			steps ++;
		}
		const seconds = steps / 120;
		assert.ok( seconds >= 3 && seconds <= 4.6, `0–100 km/h took ${ seconds.toFixed( 2 ) } s` );
	} finally {
		sim.free();
	}
} );

test( 'the disc and the round tyre roll while the red calliper stays on its steered hub', async () => {
	await withModel( async model => {
		const wheel = bindWheels( model, car )[ 0 ];
		const point = material => {
			let sample;
			wheel.carrier.traverse( mesh => {
				if ( mesh.material?.name === material ) sample = new Vector3().fromBufferAttribute( mesh.geometry.attributes.position, 0 ).applyMatrix4( mesh.matrixWorld );
			} );
			assert.ok( sample, `missing ${ material } on the hub` );
			return sample;
		};
		const set = spin => { poseWheel( wheel, car.radius - 0.025, 0.25, spin ); model.root.updateMatrixWorld( true ); };
		set( 0 );
		const tyre = point( 'Tyre_carbon_black' ), disc = point( 'Brakes_black_carbon_ceramic_friction_face' ), brake = point( 'Brakes_Guards_Red_caliper_enamel' );
		set( Math.PI / 2 );
		assert.ok( tyre.distanceTo( point( 'Tyre_carbon_black' ) ) > 0.30, 'a quarter turn must carry the tread at least 0.30 m' );
		assert.ok( disc.distanceTo( point( 'Brakes_black_carbon_ceramic_friction_face' ) ) > 0.05, 'the brake disc must rotate with the tyre' );
		assert.ok( brake.distanceTo( point( 'Brakes_Guards_Red_caliper_enamel' ) ) < 0.0001, 'the calliper must not turn with the disc' );
		// the studio tyre was modelled flat on the road; a game tyre spins, so its tread must be round
		const roll = model.pivots.get( 'WheelFrontLRoll' );
		const radii = [];
		roll.traverse( mesh => {
			if ( mesh.material?.name !== 'Tyre_carbon_black' ) return;
			const p = mesh.geometry.attributes.position;
			const bins = new Float32Array( 36 );
			for ( let i = 0; i < p.count; i ++ ) {
				const r = Math.hypot( p.getY( i ), p.getZ( i ) ), b = Math.floor( ( Math.atan2( p.getY( i ), p.getZ( i ) ) + Math.PI ) / ( 2 * Math.PI ) * 36 ) % 36;
				bins[ b ] = Math.max( bins[ b ], r );
			}
			radii.push( ...bins );
		} );
		assert.ok( Math.max( ...radii ) - Math.min( ...radii ) < 0.003, `tread radius varies ${ ( ( Math.max( ...radii ) - Math.min( ...radii ) ) * 1000 ).toFixed( 1 ) } mm around the wheel` );
	} );
} );

test( 'the GLB keeps the COSIER node layout, no plates and the side graphic as a texture', () => {
	const names = gltf.nodes.map( n => n.name );
	for ( const name of [ 'BodyStatic', 'GlassPanels', 'InteriorAssembly', 'RearWing' ] ) assert.ok( names.includes( name ), name );
	for ( const wheel of [ 'WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR' ] ) for ( const part of [ '', 'Camber', 'Roll' ] ) assert.ok( names.includes( wheel + part ), wheel + part );
	const body = gltf.nodes.find( n => n.name === 'BodyStatic' );
	for ( const child of [ 'GlassPanels', 'InteriorAssembly', 'RearWing' ] ) assert.ok( body.children.some( i => gltf.nodes[ i ].name === child ), `${ child } under BodyStatic` );
	assert.ok( ! gltf.materials.some( m => /plate/i.test( m.name ) ), 'no plate materials' );
	const vinyl = gltf.materials.find( m => m.name === 'BodyPaintVinyl' );
	assert.ok( vinyl?.pbrMetallicRoughness.baseColorTexture, 'the side graphic is a texture on BodyPaintVinyl' );
	assert.equal( gltf.images.length, 1 );
	let triangles = 0;
	for ( const mesh of gltf.meshes ) for ( const p of mesh ) triangles += ( p.indices.array || p.indices ).length / 3;
	assert.ok( triangles <= 250000, `${ triangles } triangles` );
} );

test( 'the damage rig finds the ZRY lamps, glass, paint and wing, and a rear hit releases the wing', async () => {
	const { Damage } = await import( '../src/rally/Damage.js' );
	await withModel( async model => {
		const rig = Damage.prototype.build( model );
		for ( const part of [ 'lampFrontLeft', 'lampFrontRight', 'lampRearLeft', 'lampRearRight', 'bumperFront', 'bumperRear', 'rearWing' ] ) assert.ok( rig.names.includes( part ), `damage part ${ part }` );
		assert.ok( ! rig.names.some( name => /plate/.test( name ) ), 'no plate parts' );
		assert.ok( rig.materials.some( m => m.kind === 'glass' ) && rig.materials.some( m => /^BodyPaint/.test( m.material.name ) ), 'glass and paint are owned by the rig' );
		const result = rig.state.hit( [ 0, 1.0, - 2.18 ], [ 0, 0, 1 ], 9 );
		assert.ok( result.broken.some( i => rig.names[ i ] === 'rearWing' ), '32 km/h rear impact left the wing attached' );
		const wing = rig.rig.parts.get( 'rearWing' );
		assert.ok( wing.anchor.y > 0.95 && wing.anchor.z < - 1.4, 'the wing part sits above the rear deck' );
	} );
} );
