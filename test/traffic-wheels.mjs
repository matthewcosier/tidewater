import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// the models the game draws, read from the game's own tables so this test cannot drift from them
const source = f => readFileSync( new URL( `../src/ferry/${ f }`, import.meta.url ), 'utf8' );
const MODELS = [ ...source( 'Traffic.js' ).match( /const MODELS = \[([^\]]*)\]/ )[ 1 ].matchAll( /'(\w+)'/g ) ].map( m => m[ 1 ] );
const PARKED = [ ...source( 'Terminal.js' ).match( /const PARKED = \[(.*)\];/ )[ 1 ].matchAll( /\[ '(\w+)'/g ) ].map( m => m[ 1 ] );
const FIT = source( 'Traffic.js' ).match( /const FIT = \{(.*)\};/ )[ 1 ];
// the everyday cars of docs/cars.md (Everyday traffic), built by tools/ferry/everyday_cars.py
const EVERYDAY = [ 'ParkedHatch', 'ParkedSedan', 'ParkedSuv', 'ParkedUte', 'ParkedVan' ];
const WHEELS = [ 'WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR' ];

function readGlb( path ) {

	const b = readFileSync( path ), len = b.readUInt32LE( 12 );
	return JSON.parse( b.subarray( 20, 20 + len ).toString() );

}

// a wheel node's hub (its translation in the car's frame) and its mesh's half height (the tyre's radius)
function wheelOf( gltf, root, suffix ) {

	const node = ( root.children || [] ).map( i => gltf.nodes[ i ] ).find( n => n.name === root.name + suffix );
	if ( ! node || node.mesh === undefined ) return null;
	let lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ];
	for ( const p of gltf.meshes[ node.mesh ].primitives ) {

		const a = gltf.accessors[ p.attributes.POSITION ];
		lo = lo.map( ( v, k ) => Math.min( v, a.min[ k ] ) );
		hi = hi.map( ( v, k ) => Math.max( v, a.max[ k ] ) );

	}
	const hub = node.translation || [ 0, 0, 0 ];
	return { hub, radius: ( hi[ 1 ] - lo[ 1 ] ) / 2, centre: lo.map( ( v, k ) => ( v + hi[ k ] ) / 2 ), rotated: !! node.rotation };

}

test( 'every traffic car model has four wheels of its own, hubs where a real car has them', () => {

	const gltf = readGlb( new URL( '../public/ferry/parked_cars.glb', import.meta.url ) );
	for ( const name of MODELS ) {

		const root = gltf.nodes.find( n => n.name === name );
		assert.ok( root, `${ name } is in parked_cars.glb` );
		const w = Object.fromEntries( WHEELS.map( s => [ s, wheelOf( gltf, root, s ) ] ) );
		for ( const s of WHEELS ) assert.ok( w[ s ], `${ name }${ s } is a separate wheel node with its own mesh (got none: the wheels are welded to the body)` );
		for ( const s of WHEELS ) {

			const { hub, radius, centre, rotated } = w[ s ];
			// a passenger car or light truck tyre: 195/65 R15 is 0.32 m, 265/70 R17 is 0.39 m, 35x12.5 R17 is 0.45 m
			assert.ok( radius > 0.28 && radius < 0.5, `${ name }${ s } tyre radius ${ radius.toFixed( 3 ) } m inside 0.28 .. 0.50 m` );
			// tyre on the ground: the hub stands one radius up (the root sits on the ground)
			assert.ok( Math.abs( hub[ 1 ] - radius ) < 0.04, `${ name }${ s } hub ${ hub[ 1 ].toFixed( 3 ) } m up for a ${ radius.toFixed( 3 ) } m tyre` );
			// the mesh centred on its hub, or it wobbles as it spins about its axle
			assert.ok( Math.hypot( centre[ 1 ], centre[ 2 ] ) < 0.02, `${ name }${ s } mesh centre ${ centre.map( v => v.toFixed( 3 ) ).join( ', ' ) } off its axle` );
			assert.ok( ! rotated, `${ name }${ s } pivot has identity rotation, so its local X is the axle` );

		}
		const wheelbase = w.WheelFrontL.hub[ 2 ] - w.WheelRearL.hub[ 2 ], track = w.WheelFrontR.hub[ 0 ] - w.WheelFrontL.hub[ 0 ];
		// a Golf is 2.64 m, a Hilux double cab 3.09 m; tracks 1.5 .. 1.8 m to the tyre centres
		assert.ok( wheelbase > 2.3 && wheelbase < 3.4, `${ name } wheelbase ${ wheelbase.toFixed( 2 ) } m (nose +Z, front axle ahead)` );
		assert.ok( track > 1.35 && track < 2.15, `${ name } track ${ track.toFixed( 2 ) } m (L on -X)` );

	}

} );

// a mesh's bounds over its primitives (only those whose material passes `keep`), and its triangles and draws
function bounds( gltf, mesh, keep = () => true ) {

	let lo = [ Infinity, Infinity, Infinity ], hi = [ - Infinity, - Infinity, - Infinity ], tris = 0, draws = 0;
	for ( const p of gltf.meshes[ mesh ].primitives ) {

		draws ++;
		tris += ( p.indices !== undefined ? gltf.accessors[ p.indices ].count : gltf.accessors[ p.attributes.POSITION ].count ) / 3;
		if ( ! keep( gltf.materials[ p.material ]?.name ) ) continue;
		const a = gltf.accessors[ p.attributes.POSITION ];
		lo = lo.map( ( v, k ) => Math.min( v, a.min[ k ] ) );
		hi = hi.map( ( v, k ) => Math.max( v, a.max[ k ] ) );

	}
	return { lo, hi, tris, draws };

}

test( 'the traffic and the car park are everyday cars at real size, with four wheels each', () => {

	const gltf = readGlb( new URL( '../public/ferry/parked_cars.glb', import.meta.url ) );
	for ( const name of EVERYDAY ) {

		assert.ok( MODELS.includes( name ), `${ name } drives in the traffic (Traffic.js MODELS: ${ MODELS.join( ', ' ) })` );
		assert.ok( PARKED.includes( name ), `${ name } parks in the car park (Terminal.js PARKED: ${ PARKED.join( ', ' ) })` );

	}
	for ( const name of new Set( [ ...MODELS, ...PARKED ] ) ) {

		const root = gltf.nodes.find( n => n.name === name );
		assert.ok( root && root.mesh !== undefined, `${ name } is a body in parked_cars.glb` );
		assert.ok( FIT.includes( name + ':' ), `${ name } has its collider fit in Traffic.js FIT` );
		for ( const s of WHEELS ) assert.ok( wheelOf( gltf, root, s ), `${ name }${ s } is a wheel node of its own` );
		const body = bounds( gltf, root.mesh );
		// width as a spec sheet gives it: the painted body, mirrors (black, Trim) left out
		// (the Ridgeback's paint is its own ObsidianBlackPaint, its flares and mirrors trim)
		const painted = bounds( gltf, root.mesh, m => /Paint$/.test( m || '' ) );
		const paint = gltf.meshes[ root.mesh ].primitives.some( p => gltf.materials[ p.material ]?.name === 'Paint' );
		const length = body.hi[ 2 ] - body.lo[ 2 ], width = painted.hi[ 0 ] - painted.lo[ 0 ], height = body.hi[ 1 ];
		// a small hatch is 4.0 .. 4.4 m, a dual-cab ute up to 5.4 m; 1.70 .. 2.00 m wide; 1.40 .. 2.00 m tall
		assert.ok( length > 3.8 && length < 5.6, `${ name } is ${ length.toFixed( 2 ) } m long` );
		assert.ok( width > 1.7 && width < 2.0, `${ name } is ${ width.toFixed( 2 ) } m wide` );
		// (the Ridgeback is a 4x4 lifted on 37-inch tyres with a roof rack: 2.31 m, as such a build stands)
		const tallest = EVERYDAY.includes( name ) ? 2.1 : 2.35;
		assert.ok( height > 1.35 && height < tallest, `${ name } is ${ height.toFixed( 2 ) } m tall` );
		if ( ! EVERYDAY.includes( name ) ) continue;
		assert.ok( paint, `${ name } paints its body with the shared Paint the game tints per car` );
		// docs/cars.md budget: near LOD about 6 .. 9.5k body triangles; at most 7 draws a car, body and wheels
		const wheelDraws = gltf.meshes[ wheelOf( gltf, root, 'WheelFrontL' ) && ( root.children || [] ).map( i => gltf.nodes[ i ] ).find( n => n.name === name + 'WheelFrontL' ).mesh ].primitives.length;
		assert.ok( body.tris > 6000 && body.tris < 9500, `${ name } body ${ body.tris } triangles` );
		assert.ok( body.draws + wheelDraws <= 7, `${ name } draws ${ body.draws } body + ${ wheelDraws } wheel meshes` );

	}

} );

// The car physics' collider shapes (rally-physics/src/vehicle.rs, VehicleConfig::of: 0 the Aster's,
// 1 the Jeep's), read from the Rust source so this check cannot drift from the boxes the player hits.
const RUST = readFileSync( new URL( '../rally-physics/src/vehicle.rs', import.meta.url ), 'utf8' );
function shapeOf( fn ) {

	const m = RUST.slice( RUST.indexOf( `fn ${ fn }(` ) ).match( /body:Vec3::new\(([^)]*)\),body_y:([-\d.]+),\s*cabin:Vec3::new\(([^)]*)\),cabin_y:([-\d.]+),cabin_z:([-\d.]+)/ );
	const v = s => s.split( ',' ).map( Number );
	return { body: v( m[ 1 ] ), bodyY: Number( m[ 2 ] ), cabin: v( m[ 3 ] ), cabinY: Number( m[ 4 ] ) };

}

test( 'every traffic and parked car is covered by its colliders, within 0.15 m', () => {

	const gltf = readGlb( new URL( '../public/ferry/parked_cars.glb', import.meta.url ) );
	const LOW = Number( source( 'Traffic.js' ).match( /const LOW = ([\d.]+);/ )[ 1 ] );
	const shapes = [ shapeOf( 'aster' ), shapeOf( 'jeep' ) ];
	for ( const name of new Set( [ ...MODELS, ...PARKED ] ) ) {

		const [ kind, lift, reach ] = FIT.match( new RegExp( `${ name }: \\[ ([^\\]]*) \\]` ) )[ 1 ].split( ',' ).map( t => Number( t.replace( /\s/g, '' ) ) );   // '- 0.3' is -0.3
		const s = shapes[ kind ];
		const root = gltf.nodes.find( n => n.name === name );
		const body = bounds( gltf, root.mesh ), painted = bounds( gltf, root.mesh, m => /Paint$/.test( m || '' ) );
		const end = reach + s.body[ 2 ] / 2, half = s.body[ 0 ] / 2;
		const top = lift + Math.max( s.bodyY + s.body[ 1 ] / 2, s.cabinY + s.cabin[ 1 ] / 2 );
		const floor = lift - LOW + s.bodyY - s.body[ 1 ] / 2;
		// [ where, the body's reach that way, the colliders' reach that way ]
		const rows = [ [ 'nose', body.hi[ 2 ], end ], [ 'tail', - body.lo[ 2 ], end ],
			[ 'side', ( painted.hi[ 0 ] - painted.lo[ 0 ] ) / 2, half ], [ 'roof', painted.hi[ 1 ], top ], [ 'floor', - body.lo[ 1 ], - floor ] ];
		for ( const [ where, model, box ] of rows ) {

			assert.ok( model - box <= 0.15, `${ name } ${ where }: body reaches ${ model.toFixed( 3 ) } m, its colliders ${ box.toFixed( 3 ) } m, a ${ ( model - box ).toFixed( 3 ) } m gap` );
			assert.ok( box - model <= 0.15, `${ name } ${ where }: colliders reach ${ box.toFixed( 3 ) } m, its body ${ model.toFixed( 3 ) } m, ${ ( box - model ).toFixed( 3 ) } m over` );

		}

	}

} );

// The drive-in route from beyond the boom gate, through the check-in lane and over to a queue lane
// (src/ferry/Traffic.js spawn(): CHECK - 3.15, GATE - 100, ARM - 83.675, LANES[ 1 ] 4.0, HEAD - 48),
// terminal frame, metres. Its dogleg at the check-in is the one corner every arriving car drives.
const ROUTE = [ [ - 3.15, - 100 ], [ - 3.15, - 89.675 ], [ - 3.15, - 79.675 ], [ 4.0, - 72.675 ], [ 4.0, - 48 ] ];

function drive( rig, route, v, dt, back = false ) {

	const pts = route.map( ( [ x, z ] ) => ( { x, z } ) ), seg = new Float64Array( pts.length - 1 );
	let len = 0;
	for ( let k = 0; k < seg.length; k ++ ) { seg[ k ] = Math.hypot( pts[ k + 1 ].x - pts[ k ].x, pts[ k + 1 ].z - pts[ k ].z ); len += seg[ k ]; }
	const log = [], at = { x: 0, z: 0 };
	let s = back ? len : 0;
	while ( back ? s > 0 : s < len ) {

		const ds = Math.min( v * dt, back ? s : len - s ) * ( back ? - 1 : 1 );
		s += ds;
		// the pose the traffic AI gives the car (its point and heading on the segment)
		let i = 0, r = s;
		while ( i < seg.length - 1 && r > seg[ i ] ) r -= seg[ i ++ ];
		const a = pts[ i ], b = pts[ i + 1 ], f = Math.min( 1, r / seg[ i ] );
		at.x = a.x + ( b.x - a.x ) * f;
		at.z = a.z + ( b.z - a.z ) * f;
		const heading = Math.atan2( b.x - a.x, b.z - a.z );
		rig.follow( pts, seg, s, at, heading, ds, dt );
		log.push( { s, z: at.z, steer: rig.steer, spin: rig.spin } );

	}
	return { log, len };

}

test( 'a traffic car\'s wheels turn once per tyre circumference and steer through the check-in dogleg', async () => {

	const { WheelRig, MAX_LOCK } = await import( '../src/ferry/trafficWheels.js' );
	const radius = 0.34, wheelbase = 2.64;
	const rig = new WheelRig( radius, wheelbase );
	const { log, len } = drive( rig, ROUTE, 4.0, 1 / 60 );
	const revs = rig.turned / ( 2 * Math.PI ), want = len / ( 2 * Math.PI * radius );
	assert.ok( Math.abs( revs - want ) < 0.005 * want, `${ revs.toFixed( 2 ) } wheel revolutions over ${ len.toFixed( 1 ) } m, a ${ radius } m tyre turns ${ want.toFixed( 2 ) }` );
	const straight = log.filter( e => e.z < - 94 );
	assert.ok( straight.every( e => Math.abs( e.steer ) < 0.01 ), `wheels straight on the straight lane, worst ${ Math.max( ...straight.map( e => Math.abs( e.steer ) ) ).toFixed( 3 ) } rad` );
	// into the dogleg toward +X (a positive yaw): the front wheels steer positive before the corner, then back
	const into = log.filter( e => e.z > - 86 && e.z < - 79.675 ), out = log.filter( e => e.z > - 79.675 && e.z < - 66 );
	const maxIn = Math.max( ...into.map( e => e.steer ) ), minOut = Math.min( ...out.map( e => e.steer ) );
	assert.ok( maxIn > 0.12, `steers into the dogleg before its corner: ${ maxIn.toFixed( 3 ) } rad` );
	assert.ok( minOut < - 0.12, `steers back out of it: ${ minOut.toFixed( 3 ) } rad` );
	assert.ok( log.every( e => Math.abs( e.steer ) <= MAX_LOCK + 1e-9 ), 'never past full lock' );
	assert.ok( Math.abs( log.at( - 1 ).steer ) < 0.05, `straight again in the queue lane: ${ log.at( - 1 ).steer.toFixed( 3 ) } rad` );

} );

test( 'backing out, the wheels roll backward', async () => {

	const { WheelRig } = await import( '../src/ferry/trafficWheels.js' );
	const rig = new WheelRig( 0.41, 3.09 );
	const { len } = drive( rig, ROUTE.slice( 3 ), 1.6, 1 / 60, true );
	assert.ok( Math.abs( rig.turned + len / 0.41 ) < 0.01 * len / 0.41, `turned ${ rig.turned.toFixed( 2 ) } rad backing ${ len.toFixed( 1 ) } m` );

} );

test( 'each traffic body keeps every material it was built with, and its paint takes the car\'s own colour', async () => {

	globalThis.__assetFile = async url => {

		const b = readFileSync( new URL( `../public/${ url.replace( /^\//, '' ) }`, import.meta.url ) );
		return b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength );

	};
	const { loadModel } = await import( '../src/rally/VehicleModel.js' );
	const { Traffic } = await import( '../src/ferry/Traffic.js' );
	const { Group } = await import( '../src/engine/index.js' );
	const model = await loadModel( 'ferry/parked_cars.glb' );
	const traffic = new Traffic( { scene: new Group() }, { berths: [] } );
	// as Traffic.init() takes them (init itself reads import.meta.env, which only the browser build has)
	traffic.parts = new Map( MODELS.map( n => [ n, ( model.pivots.get( n )?.children || [] ).filter( c => c.isMesh ) ] ) );
	traffic.wheelMeshes( model );
	for ( const name of MODELS ) {

		const built = new Set( traffic.parts.get( name ).map( p => p.material.name ) );
		const g = traffic.body( name );
		const drawn = g.children.filter( m => m.isMesh && ! m.name.includes( 'Wheel' ) ).map( m => m.material.name );
		const lost = [ ...built ].filter( n => ! drawn.includes( n ) );
		assert.deepEqual( lost, [], `${ name } draws its body in ${ [ ...new Set( drawn ) ].join( ', ' ) }: lost ${ lost.join( ', ' ) }` );
		if ( ! EVERYDAY.includes( name ) ) continue;
		const paint = g.children.find( m => m.isInstancedMesh && m.material.name === 'Paint' );
		assert.ok( paint?.instanceColor, `${ name }: no tinted Paint instance (children ${ g.children.map( m => m.type + '/' + m.material?.name ).join( ', ' ) })` );
		const a = paint.instanceColor.array;
		assert.ok( Math.max( a[ 0 ], a[ 1 ], a[ 2 ] ) > 0, `${ name }: paint tint is black` );

	}

} );

// one accessor of a GLB as a typed array (float VEC3 or unsigned indices), read from its BIN chunk
function glbArrays( path ) {

	const b = readFileSync( path ), len = b.readUInt32LE( 12 );
	const gltf = JSON.parse( b.subarray( 20, 20 + len ).toString() );
	const bin = b.subarray( 28 + len );
	const read = i => {

		const a = gltf.accessors[ i ], v = gltf.bufferViews[ a.bufferView ];
		const n = a.count * ( a.type === 'VEC3' ? 3 : 1 ), at = bin.byteOffset + ( v.byteOffset || 0 ) + ( a.byteOffset || 0 );
		const Kind = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[ a.componentType ];
		return new Kind( bin.buffer.slice( at, at + n * Kind.BYTES_PER_ELEMENT ) );

	};
	return { gltf, read };

}

test( 'every everyday car\'s front bumper face shades as one flat panel, no fold and no wedge', () => {

	const { gltf, read } = glbArrays( new URL( '../public/ferry/parked_cars.glb', import.meta.url ) );
	for ( const name of EVERYDAY ) {

		const root = gltf.nodes.find( n => n.name === name );
		const prim = gltf.meshes[ root.mesh ].primitives.find( p => gltf.materials[ p.material ]?.name === 'Paint' );
		const pos = read( prim.attributes.POSITION ), nor = read( prim.attributes.NORMAL ), idx = read( prim.indices );
		const front = gltf.accessors[ prim.attributes.POSITION ].max[ 2 ];       // glTF +Z is the nose (Blender -Y)
		let faces = 0, folded = 0, worst = 0;
		for ( let t = 0; t < idx.length; t += 3 ) {

			const [ a, b, c ] = [ idx[ t ], idx[ t + 1 ], idx[ t + 2 ] ];
			if ( [ a, b, c ].some( i => front - pos[ 3 * i + 2 ] > 0.001 ) ) continue;
			faces ++;
			// the triangle's own facing from its winding: the z of ( b - a ) x ( c - a )
			const nz = ( pos[ 3 * b ] - pos[ 3 * a ] ) * ( pos[ 3 * c + 1 ] - pos[ 3 * a + 1 ] ) - ( pos[ 3 * b + 1 ] - pos[ 3 * a + 1 ] ) * ( pos[ 3 * c ] - pos[ 3 * a ] );
			if ( nz < - 1e-9 ) folded ++;
			for ( const i of [ a, b, c ] ) worst = Math.max( worst, Math.acos( Math.min( 1, nor[ 3 * i + 2 ] ) ) * 180 / Math.PI );

		}
		assert.ok( faces > 10, `${ name } has a front bumper face (${ faces } Paint triangles on its front plane)` );
		assert.equal( folded, 0, `${ name } front bumper face: ${ folded } of ${ faces } triangles wound backwards (a fold)` );
		assert.ok( worst < 20, `${ name } front bumper face: a normal leans ${ worst.toFixed( 1 ) } deg off forward (bound 20)` );

	}

} );

test( 'a rolling traffic wheel draws last frame\'s matrix as its previous one: the tyre top moves road speed x dt', async () => {

	const { Traffic } = await import( '../src/ferry/Traffic.js' );
	const { WheelRig } = await import( '../src/ferry/trafficWheels.js' );
	const { Group, Vector3, Matrix4, BoxGeometry } = await import( '../src/engine/index.js' );
	const gltf = readGlb( new URL( '../public/ferry/parked_cars.glb', import.meta.url ) );
	const NAME = MODELS[ 0 ];   // a car the game draws (the table moves with the fleet)
	const root = gltf.nodes.find( n => n.name === NAME );
	const w = WHEELS.map( s => wheelOf( gltf, root, s ) );
	const radius = w[ 0 ].radius, wheelbase = w[ 0 ].hub[ 2 ] - w[ 2 ].hub[ 2 ];
	const spec = { hubs: w.map( x => new Vector3( ...x.hub ) ), parts: [ { geometry: new BoxGeometry( 0.2, 2 * radius, 2 * radius ), material: { name: 'Tyre' }, castShadow: true, layers: { mask: 1 } } ], radius, wheelbase };
	const traffic = Object.create( Traffic.prototype );
	traffic.wheelSpec = new Map( [ [ NAME, spec ] ] );
	const g = new Group();
	traffic.wheelsFor( g, NAME );
	const rig = new WheelRig( radius, wheelbase );
	traffic.cars = [ { name: NAME, group: g, wheels: rig } ];
	const mesh = g.wheelMeshes[ 0 ];
	assert.ok( mesh.instancePrevMatrix, 'the wheel mesh keeps no previous instance matrices: a spinning wheel draws with its car\'s motion only' );
	const v = 10, dt = 1 / 60, cur = new Matrix4(), prev = new Matrix4(), top = new Vector3(), was = new Vector3();
	// the top of the tyre, the rim point that moves fastest relative to the car
	const travel = ( k ) => {

		mesh.getMatrixAt( k, cur );
		prev.fromArray( mesh.instancePrevMatrix.array, k * 16 );
		return top.set( 0, radius, 0 ).applyMatrix4( cur ).distanceTo( was.set( 0, radius, 0 ).applyMatrix4( prev ) );

	};
	for ( let f = 0; f < 4; f ++ ) {

		rig.spin += v * dt / radius;   // the rig's roll for 10 m/s over one frame (rig.follow, tested above)
		traffic.drawWheels();

	}
	for ( let k = 0; k < 4; k ++ ) {

		const d = travel( k );
		// the top of a tyre rolling v dt along the road turns v dt / radius about its hub: it moves the chord of that
		// arc in the car's frame (a 0.30 m tyre at 10 m/s: 164.5 mm of chord for 166.7 mm of road in 1/60 s)
		const chord = 2 * radius * Math.sin( v * dt / ( 2 * radius ) );
		assert.ok( Math.abs( d - chord ) < 0.01 * chord, `wheel ${ k }: tyre top reprojects ${ ( d * 1000 ).toFixed( 2 ) } mm in a frame, the chord of its roll at road speed is ${ ( chord * 1000 ).toFixed( 2 ) } mm` );

	}
	traffic.drawWheels();   // the car has stopped: same roll, same steer
	for ( let k = 0; k < 4; k ++ ) assert.ok( travel( k ) < 1e-6, `wheel ${ k } of a stopped car still reprojects ${ ( travel( k ) * 1000 ).toFixed( 3 ) } mm (stale previous matrix)` );

} );
