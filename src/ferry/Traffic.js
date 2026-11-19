import { Group, Mesh, Vector3, Quaternion, Matrix4, InstancedMesh, mergeGeometries } from '../engine/index.js';
import { loadModel } from '../rally/VehicleModel.js';
import { WheelRig } from './trafficWheels.js';
import { paintFor } from './carPaint.js';

// the five everyday cars (tools/ferry/everyday_cars.py) and the Ridgeback, the rarer one
const MODELS = [ 'ParkedHatch', 'ParkedSedan', 'ParkedSuv', 'ParkedUte', 'ParkedVan', 'ParkedJeep' ];
// each model's wheel nodes in parked_cars.glb (<model>WheelFrontL ..), fronts first: they steer
const WHEELS = [ 'WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR' ];
const YARD = 3.2, DECK = 2.6;          // m: the yard's paving (terminal frame), her vehicle deck (her frame)
const LANES = [ 0.75, 4.0 ];           // terminal x of the two marshalling lanes cars queue in
const HEAD = - 48, STEP = 7.5;         // terminal z of the queue's head (a clear apron off the linkspan for cars driving or backing off), and the spacing back from it
const GATE = - 100, CHECK = - 3.15;    // where cars appear and go, beyond the boom gate; its lane (x)
const ARM = - 83.675;                  // terminal z of the check-in boom's arm (Terminal.openBoom lifts it)
const LAND = 4.0, SLOW = 1.6;          // m/s across the yard; through the check-in and when backing
const RAMP = 2.2, DECK_V = 3.2, TURN = 2.8;   // m/s over the linkspan and her ramp; along her deck; round the turn at her bow and into a slot
const GAP = 7.5;                       // m, nose to nose, behind the car ahead
const SIDE = 4.9;                      // her outer lanes' middles (|x|, outboard of the yellow lines); the centre lanes are the player's
const ABREAST = 1.75;                  // m: her two boarding lanes' middles (|x|) over the linkspan, her ramp (10 m wide) and up her centre lanes: 3.5 m apart, two cars abreast
// her z of the centre of each lane's half turn at her bow: the lane to her starboard slots turns at
// the bow, the lane to her port slots 4.5 m aft of it (its last chord still 1 m forward of her
// foremost slot, 6.5). Mirrored turns at one z sweep the same 10 m of deck in opposite senses, so
// only one could turn at a time (a car through the bow every 4 to 5 s: a full queue 8 to 17 s late);
// staggered, the two roads cross once, square, where the port lane's turn crosses the other's road
const BOW = [ 12, 7.5 ];               // [ to starboard, to port ]
// The crossing is a box junction: the starboard lane's last 5 m up to its turn and the turn's first
// two chords, the port lane's turn from its first chord to its sixth (where either car's body can be
// in the other's road: a 4.8 m by 1.9 m car, test/ferry-traffic-hold.mjs). [ first, last ] segment of
// her road in the box, per lane; a car stops within JUNCTION_STOP m of the box while the other lane's
// car is in it, or is at the box too and was waved aboard first, unless the car ahead of it in its own
// lane is in the box: the deck crew wave a lane through nose to tail and then the other (each switch
// costs a stop and a pull away; strictly one from each lane in turn a full queue sailed 6 to 9 s late).
const JUNCTION = [ [ 5, 7 ], [ 6, 11 ] ];   // [ to starboard, to port ]: segment indices on board()'s road
const JUNCTION_STOP = 1.5;             // m short of the box: braking from DECK_V 3.2 m/s at 4 m/s2 takes 1.3 m
// her deck's parking slots [ side, z ], facing aft; aftmost first, so later cars never pass a parked one
const SLOTS = [ - 19.5, - 14, - 4.5, 1, 6.5 ].flatMap( z => [ [ 1, z ], [ - 1, z ] ] );
const PLAYER_OFF = 60;                 // s after her ramp is down that the queue waits for the player's car to drive off
const PLAYER_HOLD = 120;               // s past her timetable she waits for the player's car coming aboard
const STUCK = 15;                      // s held up by the player's car before a boarding car gives way
const NEAR = 250;                      // m from the player's car inside which a car has a solid body
const REACH = 9;                       // m of its own road ahead (backing: behind) a car checks for the player's car
const LOOK = 1.6;                      // s ahead the player's car is predicted along its velocity
const CLEAR = 2.3;                     // m, footprint to road: both cars' half widths and a margin (a lane apart is 3.25)
const PLAYER_HALF = 2.3;               // m, half the player's car's length along its heading
const SETTLE = 3;                      // s the player's car stands still in the lanes or aboard before a car starts aboard
const ID = 1000;                       // car physics remote ids from here, four a car (SharedDrive's players use 1 up)
// A person on foot in a car's road. A driver crawling through the terminal reacts in about REACT s
// (declared, inside the 0.7 to 1.5 s Green 2000 measured) and brakes at the 4 m/s2 drive() eases down
// at, so it looks from its middle to its nose, plus that reaction and stopping distance, plus a
// margin of KERB m. A person is in its road within the car's half width plus their body radius of it.
const REACT = 0.75, KERB = 1.0, BRAKE = 4;   // s, m, m/s2
const BODY_R = 0.27, PLAYER_R = 0.3;   // m: a townsperson's capsule (people/Contact.js BODY_R), the player's walker (Player.js RADIUS)
const PERSON_STEP = 0.5;               // m between the points of its road it checks
const SEE = 2.5;                       // s of a moving car's road a walker keeps out of (roadAhead)
// her deck and ramp in her frame, where a car's walker box goes into her deck boxes (walkers())
const ON_DECK = { x: 9.5, aft: - 36, bow: 27 };
const LOW = 0.28;
const FIT = { ParkedHatch: [ 0, 0.03, 0.14 ], ParkedSedan: [ 0, 0.03, 0.4 ], ParkedSuv: [ 1, - 0.3, 0.23 ], ParkedUte: [ 1, - 0.25, 0.63 ], ParkedVan: [ 1, - 0.2, 0.56 ], ParkedJeep: [ 1, - 0.045, 0.4 ] };

const _v = new Vector3(), _w = new Vector3(), _u = new Vector3(), _f = new Vector3(), _s = new Float32Array( 8 ), _q = new Quaternion(), _p = new Quaternion(), _up = new Vector3( 0, 1, 0 ), _x = new Vector3( 1, 0, 0 );
const _m = new Matrix4(), _r = new Quaternion(), _one = new Vector3( 1, 1, 1 );
const _people = [], _rp = new Vector3();
const rand = ( a, b ) => a + Math.random() * ( b - a );
const bySlot = ( a, b ) => a.slot - b.slot;
// is q ahead of p along heading (hx, hz) (length h): in a cone, or a corridor 2.6 m either side (see blocked)
function ahead( p, hx, hz, h, q, gap, cone ) {

	const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot( dx, dz );
	if ( Math.abs( q.y - p.y ) > 2.5 ) return false;
	const along = ( dx * hx + dz * hz ) / h, side = Math.abs( dx * hz - dz * hx ) / h;
	return cone ? ( d < 3.4 && along > - 1 ) || ( d < gap && along > 0.55 * d ) : along > - 1 && along < gap && side < 2.6;

}

export class Traffic {

	constructor( app, ferry ) {

		this.app = app;
		this.ferry = ferry;
		this.cars = [];
		this.pool = new Map( MODELS.map( n => [ n, [] ] ) );
		this.parts = null;              // model name -> [ { geometry, material, castShadow } ]
		this.seq = 0;
		// per ship (the fleet, App.fleet): her call at the berth she lies at (call())
		this.calls = new Map();
		this.stops = new Map();         // terminal name -> { want, spawn, boarding, started }
		this.physics = null;            // the car physics the bodies below live in
		this.bodies = new Set();        // ids of the cars with solid bodies in it
		this.extents = new Map();       // model name -> its drawn body's box in the car's frame (extent())
		this.walkerPool = [];           // walker boxes of cars that have gone, for the next car

	}

	async init() {

		const model = await loadModel( `${ import.meta.env.BASE_URL }ferry/parked_cars.glb` );
		this.parts = new Map( MODELS.map( n => [ n, ( model.pivots.get( n )?.children || [] ).filter( c => c.isMesh ) ] ) );
		this.wheelMeshes( model );
		for ( const b of this.ferry.berths ) {

			const stop = this.stop( b.terminal );
			for ( let i = 0; i < stop.want; i ++ ) this.spawn( b.terminal, true );

		}

	}

	stop( terminal ) {

		let s = this.stops.get( terminal.name );
		if ( ! s ) this.stops.set( terminal.name, s = { want: 6 + Math.floor( Math.random() * 4 ), spawn: rand( 2, 5 ), boarding: false } );
		return s;

	}

	// A car for the queue at `terminal`: in its place already (at start), or driving in from the gate.
	spawn( terminal, placed = false ) {

		// the first free place in the lanes, from the head back
		const taken = new Set( this.cars.filter( c => c.terminal === terminal && ( c.state === 'queue' || c.state === 'back' ) ).map( c => c.at.join() ) );
		let k = 0;
		while ( taken.has( [ LANES[ k % 2 ], YARD, HEAD - STEP * Math.floor( k / 2 ) ].join() ) ) k ++;
		const lane = LANES[ k % 2 ], z = HEAD - STEP * Math.floor( k / 2 );
		const name = MODELS[ Math.floor( Math.random() * MODELS.length ) ];
		const car = { id: ++ this.seq, seq: this.seq, name, group: this.body( name ), terminal, state: 'queue', lane, path: null, s: 0, v: 0, local: null, slot: null, driverIn: true, from: null };
		// in through the check-in lane under the boom, then over to the queue's lane
		car.path = placed ? null : this.route( car, [ [ 'T', CHECK, YARD, GATE, LAND ], [ 'T', CHECK, YARD, ARM - 6, SLOW ], [ 'T', CHECK, YARD, ARM + 4, SLOW ], [ 'T', lane, YARD, ARM + 11, LAND ], [ 'T', lane, YARD, z, LAND ] ] );
		car.at = [ lane, YARD, z ];
		this.cars.push( car );
		this.pose( car );
		return car;

	}

	body( name ) {

		const free = this.pool.get( name ).pop();
		if ( free ) { free.visible = true; this.app.scene.add( free ); return free; }
		const g = new Group();
		g.name = 'TrafficCar:' + name;
		for ( const part of this.merged( name ) ) {

			// the body's paint as one instance, so it takes this car's factory colour (carPaint.js) at no extra draw
			const paint = part.material.name === 'Paint';
			const m = paint ? new InstancedMesh( part.geometry, part.material, 1 ) : new Mesh( part.geometry, part.material );
			if ( paint ) { m.setColorAt( 0, paintFor( Math.random() ) ); m.computeBoundingSphere(); }
			m.castShadow = part.castShadow;
			m.receiveShadow = true;
			// the loader's layer: the glass draws in the transparent pass, as the car park's and the wheels' parts do
			m.layers.mask = part.layers;
			g.add( m );

		}
		this.wheelsFor( g, name );
		this.app.scene.add( g );
		return g;

	}

	// A model's parts merged per material and shadow flag (13 to 17 parts come down to a few draws), built once
	// and shared by every car of that model. Parts whose attributes don't match stay separate.
	merged( name ) {

		this._merged = this._merged || new Map();
		let out = this._merged.get( name );
		if ( out ) return out;
		const groups = new Map();
		for ( const part of this.parts.get( name ) || [] ) {

			const key = part.material.id + ( part.castShadow ? '+' : '-' ) + Object.keys( part.geometry.attributes ).sort().join() + ( part.geometry.index ? 'i' : 'n' );
			if ( ! groups.has( key ) ) groups.set( key, [] );
			groups.get( key ).push( part );

		}
		out = [];
		for ( const list of groups.values() ) {

			const geometry = list.length > 1 ? mergeGeometries( list.map( p => p.geometry ), false ) : null;
			if ( geometry ) { geometry.computeBoundingSphere?.(); out.push( { geometry, material: list[ 0 ].material, castShadow: list[ 0 ].castShadow, layers: list[ 0 ].layers.mask } ); }
			else for ( const p of list ) out.push( { geometry: p.geometry, material: p.material, castShadow: p.castShadow, layers: p.layers.mask } );

		}
		this._merged.set( name, out );
		return out;

	}

	// Each model's wheels (tools/ferry/parked_cars.py): its hubs, its front left wheel's parts (the
	// right hand pair is the same wheel turned half round about Y, as on a real car), the tyre's
	// radius and the wheelbase. Each car draws them as one InstancedMesh per wheel material, four
	// instances, inside its own group (wheelsFor). Not one mesh per model across every car: the
	// engine reprojects an instance with this frame's matrix as last frame's (MeshRenderer: prevModel
	// = draw.prevModel * instance), so wheels of moving cars drawn that way had no motion vectors and
	// left dark TAA trails behind the cars (traffic-wheels-closeup.png, 2026-10-05). In the car's
	// group they move with its tracked matrix; only their own roll goes unblurred.
	wheelMeshes( model ) {

		this.wheelSpec = new Map();
		for ( const name of MODELS ) {

			const hubs = [];
			for ( const suffix of WHEELS ) {

				const pivot = model.pivots.get( name + suffix );
				if ( pivot ) hubs.push( pivot.position.clone() );

			}
			const parts = ( model.pivots.get( name + WHEELS[ 0 ] )?.children || [] ).filter( c => c.isMesh );
			// (a GLB from before 2026-10-05 has no wheel nodes: its cars draw without wheels to turn)
			if ( hubs.length < 4 || ! parts.length ) continue;
			// the tyre's radius: the wheel's half height (its mesh is centred on the hub); the
			// wheelbase from the hubs (fronts first)
			let radius = 0;
			for ( const m of parts ) {

				if ( ! m.geometry.boundingBox ) m.geometry.computeBoundingBox();
				radius = Math.max( radius, m.geometry.boundingBox.max.y, - m.geometry.boundingBox.min.y );

			}
			this.wheelSpec.set( name, { hubs, parts, radius, wheelbase: hubs[ 0 ].z - hubs[ 2 ].z } );

		}

	}

	// A car group's wheels: per wheel material an InstancedMesh of the four, at rest at their hubs.
	wheelsFor( g, name ) {

		const spec = this.wheelSpec?.get( name );
		g.wheelMeshes = [];
		if ( ! spec ) return;
		for ( const part of spec.parts ) {

			const mesh = new InstancedMesh( part.geometry, part.material, 4 );
			mesh.name = 'TrafficWheels:' + name + ':' + part.material.name;
			mesh.castShadow = part.castShadow;
			mesh.receiveShadow = true;
			mesh.layers.mask = part.layers.mask;
			g.add( mesh );
			g.wheelMeshes.push( mesh );

		}
		this.placeWheels( g, spec, 0, 0 );
		for ( const mesh of g.wheelMeshes ) {

			mesh.trackPreviousMatrices();   // the spin's own motion vectors (drawWheels)
			mesh.computeBoundingSphere();

		}

	}

	// The four wheels in the car's frame: at the hub, steered (front pair) about the wheel's Y, then
	// rolled about its axle (X). A right hand wheel (k odd) is the left one turned half round: its
	// axle points the other way, so the same roll forward is the opposite angle about it.
	placeWheels( g, spec, steer, spin ) {

		for ( let k = 0; k < 4; k ++ ) {

			const right = k % 2 === 1;
			_r.setFromAxisAngle( _up, ( k < 2 ? steer : 0 ) + ( right ? Math.PI : 0 ) ).multiply( _p.setFromAxisAngle( _x, right ? - spin : spin ) );
			_m.compose( spec.hubs[ k ], _r, _one );
			for ( const mesh of g.wheelMeshes ) mesh.setMatrixAt( k, _m );

		}
		for ( const mesh of g.wheelMeshes ) mesh.instanceMatrix.needsUpdate = true;

	}

	drawWheels() {

		if ( ! this.wheelSpec ) return;
		const tick = this.wheelTick = ( this.wheelTick || 0 ) + 1;
		for ( const car of this.cars ) {

			const spec = this.wheelSpec.get( car.name ), g = car.group;
			if ( ! spec || ! g.visible || ! g.wheelMeshes?.length ) continue;
			const rig = car.wheels || ( car.wheels = new WheelRig( spec.radius, spec.wheelbase ) );
			const drawnLast = g.wheelTick === tick - 1;
			g.wheelTick = tick;
			const standing = rig.spin === g.drawnSpin && rig.steer === g.drawnSteer;
			if ( standing && g.wheelsSettled ) continue;   // standing and settled: nothing to upload
			if ( drawnLast ) this.keepDrawnWheels( g );
			if ( ! standing ) {

				g.drawnSpin = rig.spin;
				g.drawnSteer = rig.steer;
				this.placeWheels( g, spec, rig.steer, rig.spin );

			}
			if ( ! drawnLast ) this.keepDrawnWheels( g );
			g.wheelsSettled = standing;

		}

	}

	// A car's drawn wheel matrices become its previous ones (InstancedMesh.trackPreviousMatrices).
	keepDrawnWheels( g ) {

		for ( const mesh of g.wheelMeshes ) {

			mesh.instancePrevMatrix.array.set( mesh.instanceMatrix.array );
			mesh.instancePrevMatrix.needsUpdate = true;

		}

	}

	// Test hook: the drawn front left wheel in its car's frame, read back from its instances: its
	// steer, and how far its roll is from the rig's (rad). Null while the car has no wheels drawn.
	drawnWheel( car ) {

		const mesh = car.group.wheelMeshes?.[ 0 ];
		if ( ! mesh || ! car.wheels ) return null;
		const e = _m.fromArray( mesh.instanceMatrix.array, 0 ).elements, steer = Math.atan2( - e[ 2 ], e[ 0 ] );
		const off = Math.atan2( e[ 4 ] * Math.sin( steer ) + e[ 6 ] * Math.cos( steer ), e[ 5 ] ) - car.wheels.spin;
		return { steer, spinError: Math.abs( off - 2 * Math.PI * Math.round( off / ( 2 * Math.PI ) ) ), draws: car.group.wheelMeshes.length };

	}

	// waypoints [ frame 'T' (the car's terminal) | 'S' (her), x, y, z, speed ] into a path
	route( car, points ) { return { points, len: null }; }

	// The fleet (App.fleet: the lead and her sister). Cars board and leave whichever ship lies at
	// their terminal, and each car keeps its ship (car.ferry) from boarding until it has gone.
	// Before this the lead's alone: the queue at Joey Island waited for the Tidewater Spirit while
	// the Sealion Spirit lay loading in front of it (test/browser/fleet.spec.js).
	fleet() { return this.app.fleet?.length ? this.app.fleet : ( this.solo || ( this.solo = [ this.ferry ] ) ); }

	// The ship moored at terminal t, or null.
	shipAt( t ) {

		for ( const f of this.fleet() ) if ( f.ship?.moored && f.at?.terminal === t ) return f;
		return null;

	}

	// Her ramp down at her berth and her timetable loading: cars may drive on and off.
	open( f ) { return !! f && f.ship.moored && f.ramp >= 1 && ! f.castingOff && f.service.enabled && f.service.phase === 'loading'; }

	// Her call: s past her time (held), the player's car (playerHeld), her ramp down for (rampDownFor),
	// a car gave way to the player's car (shut: no more start aboard this call), the player boarding.
	call( f ) {

		let c = this.calls.get( f );
		if ( ! c ) this.calls.set( f, c = { held: 0, playerHeld: 0, rampDownFor: 0, shut: false, boarding: false } );
		return c;

	}

	shipOf( car ) { return ( car.ferry || this.ferry ).ship; }

	// A waypoint's world position now (her frame follows her: the car's ship).
	world( car, w, out ) { return w[ 0 ] === 'S' ? this.shipOf( car ).toWorld( _w.set( w[ 1 ], w[ 2 ], w[ 3 ] ), out ) : car.terminal.toWorld( [ w[ 1 ], w[ 2 ], w[ 3 ] ], out ); }

	board( car, slot, ferry = this.ferry ) {

		// up the boarding lane on the far side from her slot (lx), then a half turn of radius 3.3 m
		// round her bow (8 chords) into the outer lane: from lx to side * SIDE
		const [ side, z ] = SLOTS[ slot ], x = car.at[ 0 ], q = car.at[ 2 ], arc = [], lx = - side * ABREAST, r = ( SIDE + ABREAST ) / 2, bow = BOW[ side > 0 ? 0 : 1 ];
		for ( let k = 0; k <= 8; k ++ ) {

			const t = Math.PI - k * Math.PI / 8;
			arc.push( [ 'S', side * ( ( SIDE - ABREAST ) / 2 + r * Math.cos( t ) ), DECK, bow + r * Math.sin( t ), TURN ] );

		}
		car.slot = slot; car.state = 'board'; car.seq = ++ this.seq; car.s = 0; car.from = car.terminal; car.ferry = ferry;
		car.path = this.route( car, [ [ 'T', x, YARD, q, LAND ], [ 'T', x, YARD, - 36, LAND ], [ 'T', lx, YARD, - 32, RAMP ], [ 'T', lx, YARD, - 28.25, RAMP ],
			[ 'S', lx, DECK, - 25.2, RAMP ], [ 'S', lx, DECK, bow - 5, DECK_V ], ...arc, [ 'S', side * SIDE, DECK, z, TURN ] ] );
		car.path.junction = JUNCTION[ side > 0 ? 0 : 1 ];

	}

	unload( car, terminal ) {

		// from where she stands: her slot, or where she parked on giving way (settle())
		const [ side ] = SLOTS[ car.slot ], at = car.local;
		car.terminal = terminal; car.state = 'unload'; car.seq = ++ this.seq; car.s = 0;
		car.path = this.route( car, [ [ 'S', at.x, DECK, at.z, TURN ], [ 'S', side * SIDE, DECK, - 20.5, DECK_V ], [ 'S', 0, DECK, - 24.6, TURN ],
			[ 'T', 0, YARD, - 28.25, RAMP ], [ 'T', 0, YARD, - 34, LAND ], [ 'T', CHECK, YARD, - 42, LAND ], [ 'T', CHECK, YARD, ARM + 6, LAND ], [ 'T', CHECK, YARD, ARM - 4, SLOW ], [ 'T', CHECK, YARD, GATE, LAND ] ] );

	}

	update( dt ) {

		if ( ! this.parts ) return;
		let astir = false;
		for ( const f of this.fleet() ) {

			const call = this.call( f ), open = this.open( f ), service = f.service;
			if ( open && service.wait <= 0 ) call.held += dt; else if ( ! open ) { call.held = 0; call.shut = false; }
			call.boarding = open && this.playerBoarding( f.at?.terminal, f );
			// the player's car on the move in the lanes, over the linkspan or aboard: no car starts aboard
			// until it has stood still for SETTLE s (cars already on their way give way to it: blocked())
			if ( call.boarding && Math.abs( this.app.rally.state[ 7 ] ) > 1 ) astir = true;
			call.rampDownFor = open ? call.rampDownFor + dt : 0;
			// (only the time she waits for the player alone counts against PLAYER_HOLD)
			if ( call.boarding && service.wait <= 0 && ! this.trafficHolding( f ) ) call.playerHeld += dt; else if ( ! open ) call.playerHeld = 0;

		}
		this.playerStill = astir ? 0 : ( this.playerStill ?? SETTLE ) + dt;
		for ( const b of this.ferry.berths ) {

			// the ship lying here, if her ramp is down and she is loading
			const t = b.terminal, stop = this.stop( t ), here = this.shipAt( t ), mine = this.open( here ), call = here && this.call( here );
			// arrivals: aboard her from the other side drive off first, once their drivers are back in
			const aboard = this._aboard || ( this._aboard = [] );
			aboard.length = 0;
			if ( here ) for ( const c of this.cars ) if ( c.state === 'parked' && c.ferry === here && c.from !== t ) aboard.push( c );
			if ( mine ) for ( const c of aboard.sort( bySlot ) ) if ( c.driverIn ) this.unload( c, t );
			// the player driving off counts as an arrival too: the queue waits for them (up to PLAYER_OFF s)
			const playerOff = mine && this.playerAboard( here ) && call.rampDownFor < PLAYER_OFF;
			const unloading = this.cars.some( c => c.state === 'unload' && c.terminal === t && c.s < 60 ) || ( mine && aboard.length ) || playerOff;
			// the queue drives aboard behind them, while her slots are free and her timetable allows: two
			// lanes at once, each marshalling lane's head behind the last car waved from that lane (the
			// inboard lane to her starboard slots, the outboard lane to her port slots: see the header)
			if ( mine && ! unloading && here.service.wait > 0 && ! call.shut && this.playerStill > SETTLE ) {

				const used = new Set( this.cars.filter( c => c.ferry === here && c.slot !== null && ( c.state === 'parked' || c.state === 'board' ) ).map( c => c.slot ) );
				for ( let k = 0; k < LANES.length; k ++ ) {

					const side = k === 0 ? 1 : - 1;
					let head = null, last = null;
					for ( const c of this.cars ) {

						if ( c.terminal === t && c.state === 'queue' && ! c.path && c.at[ 0 ] === LANES[ k ] && ( ! head || c.at[ 2 ] > head.at[ 2 ] ) ) head = c;
						if ( c.ferry === here && c.state === 'board' && SLOTS[ c.slot ][ 0 ] === side && ( ! last || c.seq > last.seq ) ) last = c;

					}
					const free = SLOTS.findIndex( ( s, i ) => s[ 0 ] === side && ! used.has( i ) );
					// (and not up a lane the player's car stands in on her deck: the other lane still boards past it)
					if ( head && free >= 0 && ( ! last || last.s > 6 ) && ! this.playerInBoardingRoad( here, - side * ABREAST ) ) this.board( head, free, here );

				}

			}
			// top the queue up while she is away or boarding elsewhere
			let waiting = 0;
			for ( const c of this.cars ) if ( c.terminal === t && c.state === 'queue' ) waiting ++;
			if ( ! mine && waiting < stop.want && ( stop.spawn -= dt ) <= 0 ) { this.spawn( t ); stop.spawn = rand( 3, 6 ); }

		}

		for ( const car of this.cars ) {

			this.drive( car, dt );
			// the check-in boom lifts for a car coming up to it in its lane, either way
			if ( car.path && car.world ) {

				const t = car.terminal, dx = car.world.x - t.position.x, dz = car.world.z - t.position.z, c = Math.cos( t.yaw ), s = Math.sin( t.yaw );
				if ( Math.abs( dx * c - dz * s - CHECK ) < 2.5 && Math.abs( dx * s + dz * c - ARM ) < 16 ) t.openBoom?.( 6 );

			}

		}
		this.solid();
		this.walkers();
		// the gone go back to the pool (compacted in place: no new array each frame)
		let keep = 0;
		for ( const car of this.cars ) {

			if ( car.state !== 'gone' ) { this.cars[ keep ++ ] = car; continue; }
			if ( car.walker ) { car.walker.solid = false; this.walkerPool.push( car.walker ); car.walker = null; }
			car.group.visible = false;
			this.app.scene.remove( car.group );
			this.pool.get( car.name ).push( car.group );

		}
		this.cars.length = keep;
		this.drawWheels();

	}

	// Along its path at up to the waypoint's speed, stopping for the car ahead and the player's.
	drive( car, dt ) {

		const P = car.path;
		if ( P ) {

			// the waypoints in the world now (reused per path: her frame moves them every frame)
			const n = P.points.length;
			if ( ! P.pts || P.pts.length !== n ) { P.pts = P.points.map( () => new Vector3() ); P.seg = new Float64Array( Math.max( 0, n - 1 ) ); }
			const pts = P.pts, seg = P.seg;
			for ( let k = 0; k < n; k ++ ) this.world( car, P.points[ k ], pts[ k ] );
			let len = 0;
			for ( let k = 0; k < n - 1; k ++ ) { const l = pts[ k + 1 ].distanceTo( pts[ k ] ); seg[ k ] = l; len += l; }
			P.len = len;   // (roadAhead reads this frame's road)
			let i = 0, s = car.s;
			while ( i < seg.length - 1 && s > seg[ i ] ) s -= seg[ i ++ ];
			// the segment's speed, easing down to a stop at the path's end (backing out: its start)
			const back = car.state === 'back', by = this.blocked( car, pts, seg, i, len ), s0 = car.s;
			car.by = by;
			const want = by ? 0 : Math.min( back ? SLOW : P.points[ i + 1 ][ 4 ], 0.15 + 1.4 * Math.sqrt( Math.max( 0, back ? car.s : len - car.s ) ) );
			car.braking = want < car.v - 0.05 || want === 0;
			car.v = want < car.v ? Math.max( want, car.v - 4 * dt ) : Math.min( want, car.v + 1.5 * dt );
			car.s = back ? Math.max( 0, car.s - car.v * dt ) : Math.min( len, car.s + car.v * dt );
			car.shore = seg[ 0 ] + ( seg[ 1 ] || 0 );   // along a boarding route: the lanes' end, short of the linkspan
			// held up by the player's car standing still (not just a slow car ahead in the procession),
			// or by a person standing in its road: count it, and give way once it has been too long
			const still = Math.abs( this.app.rally?.state?.[ 7 ] ?? 0 ) < 3;
			car.stuck = ( ( by === 'player' && still ) || by === 'person' ) && car.state === 'board' ? ( car.stuck || 0 ) + dt : 0;
			if ( car.stuck > STUCK ) this.giveWay( car );
			else if ( back ? car.s <= 0.02 : car.s >= len - 0.02 ) this.arrive( car );
			else {

				// pose on the segment, from its endpoints in the world
				const f = seg[ i ] > 0 ? Math.min( 1, s / seg[ i ] ) : 1, a = pts[ i ], b = pts[ i + 1 ];
				car.world = ( car.world || new Vector3() ).copy( a ).lerp( b, f );
				car.heading = Math.atan2( b.x - a.x, b.z - a.z );
				car.grade = Math.atan2( b.y - a.y, Math.hypot( b.x - a.x, b.z - a.z ) );
				car.local = P.points[ i ][ 0 ] === 'S' && P.points[ i + 1 ][ 0 ] === 'S' ? this.shipOf( car ).toLocal( car.world, car.local || new Vector3() ) : null;
				if ( car.local ) car.localYaw = car.heading - this.shipOf( car ).yaw;
				// its wheels roll by the road it covered and steer for the road ahead (trafficWheels.js)
				car.wheels?.follow( pts, seg, car.s, car.world, car.heading, car.s - s0, dt );

			}

		}
		this.pose( car );

	}

	arrive( car ) {

		const ship = this.ferry.ship;
		car.path = null; car.v = 0; car.braking = false;
		if ( car.state === 'board' ) {

			const [ side, z ] = SLOTS[ car.slot ];
			car.state = 'parked';
			car.local = new Vector3( side * SIDE, DECK, z );
			car.localYaw = Math.PI;
			car.driverIn = true;

		} else if ( car.state === 'unload' ) car.state = 'gone';
		else if ( car.state === 'back' ) { car.state = 'queue'; car.slot = null; car.local = null; car.from = null; car.ferry = null; }
		else if ( car.state === 'queue' ) car.local = null;
		void ship;

	}

	// Held up by the player's car for STUCK seconds: this car and every car boarding behind it give
	// way, and no more start aboard at this call. One that has turned at her bow (facing aft, in her
	// frame) parks where it stands; one still on its way up backs out to its place in the queue.
	giveWay( car ) {

		this.call( car.ferry || this.ferry ).shut = true;
		const ship = this.shipOf( car );
		for ( const c of this.cars ) {

			if ( c.state !== 'board' || c.ferry !== car.ferry || c.seq < car.seq ) continue;
			c.stuck = 0;
			if ( c.local && Math.cos( c.heading - ship.yaw ) < 0 ) {

				c.path = null; c.v = 0; c.braking = false; c.state = 'parked'; c.driverIn = true;
				c.local = ship.toLocal( c.world, c.local ); c.local.y = DECK;
				c.localYaw = c.heading - ship.yaw;

			} else c.state = 'back';

		}

	}

	// Is a car of this car's lane (her slots' side) in the box junction at her bow (see JUNCTION)?
	inJunction( car ) {

		const side = SLOTS[ car.slot ][ 0 ];
		for ( const o of this.cars ) {

			if ( o === car || o.state !== 'board' || o.ferry !== car.ferry || o.slot === null || SLOTS[ o.slot ][ 0 ] !== side || ! o.path?.junction ) continue;
			const J = o.path.junction, oi = o.path.i ?? - 1;
			if ( oi >= J[ 0 ] && oi <= J[ 1 ] ) return true;

		}
		return false;

	}

	// What stops this car ('car' | 'player' | 'person' | null): a car ahead of it in the order within the gap
	// (a cone along its way; backing out, the cars backing out behind it) or close by, the
	// player's car in or crossing its way (playerInWay), or a person on foot in its road (personInWay).
	// Nothing behind it stops it.
	blocked( car, pts, seg, i, len ) {

		const a = pts[ i ], b = pts[ i + 1 ], back = car.state === 'back', k = back ? - 1 : 1;
		let hx = k * ( b.x - a.x ), hz = k * ( b.z - a.z ), h = Math.hypot( hx, hz );
		const p = car.world || a;
		// its heading on the ground; a step with none (the linkspan's end up to her ramp's toe: 0.6 m
		// up, 0 m along) keeps the last, or every car level with it would read as in its lane ahead
		const dir = car.dir || ( car.dir = { x: 0, z: 1 } );
		if ( h < 1e-3 ) { hx = dir.x; hz = dir.z; h = 1; } else { dir.x = hx / h; dir.z = hz / h; }
		const boarding = car.state === 'board' && car.slot !== null;
		// where it is on its road: the segment, and the metres to that segment's end (the box junction)
		const P = car.path;
		let end = 0;
		for ( let k = 0; k <= i; k ++ ) end += seg[ k ];
		P.i = i; P.toEnd = end - car.s;
		for ( const o of this.cars ) {

			if ( o === car || ! o.world || ! o.path ) continue;
			// the other boarding lane: abreast (3.5 m apart) it never stops this car; it does in this
			// car's lane ahead (a corridor, not the cone), which is only where their turns cross at her
			// bow. There the car already in the other's lane goes first; if each is in the other's lane,
			// the one waved aboard first (lower seq) goes and the other waits: no deadlock.
			if ( boarding && o.state === 'board' && o.ferry === car.ferry && o.slot !== null && SLOTS[ o.slot ][ 0 ] !== SLOTS[ car.slot ][ 0 ] ) {

				const J = P.junction, oJ = o.path.junction, oi = o.path.i ?? - 1;
				if ( J && oJ && i === J[ 0 ] - 1 && P.toEnd < JUNCTION_STOP ) {

					if ( oi >= oJ[ 0 ] && oi <= oJ[ 1 ] ) return 'car';
					if ( oi === oJ[ 0 ] - 1 && o.path.toEnd < JUNCTION_STOP && o.seq < car.seq && ! this.inJunction( car ) ) return 'car';

				}
				if ( ahead( p, hx, hz, h, o.world, GAP, false ) && ! ( o.seq > car.seq && o.dir && ahead( o.world, o.dir.x, o.dir.z, 1, p, GAP, false ) ) ) return 'car';
				continue;

			}
			if ( back ? o.state === 'back' && o.seq > car.seq : o.seq < car.seq ) if ( ahead( p, hx, hz, h, o.world, GAP, true ) ) return 'car';

		}
		if ( this.playerInWay( car, pts, seg, len, p, hx / h, hz / h ) ) return 'player';
		return this.personInWay( car, pts, seg, len ) ? 'person' : null;

	}

	playerInWay( car, pts, seg, len, p, ux, uz ) {

		const rally = this.app.rally, st = rally?.state;
		if ( ! st || Math.hypot( st[ 0 ] - p.x, st[ 2 ] - p.z ) > REACH + PLAYER_HALF + LOOK * 45 ) return false;
		const f = rally.forward, fl = f ? Math.hypot( f.x, f.z ) : 0;
		const fx = fl > 1e-3 ? f.x / fl * PLAYER_HALF : 0, fz = fl > 1e-3 ? f.z / fl * PLAYER_HALF : 0;
		const vx = rally.velocity?.x || 0, vz = rally.velocity?.z || 0, moving = Math.hypot( vx, vz ) > 0.3;
		const back = car.state === 'back';
		const along = vx * ux + vz * uz, tailing = ( st[ 0 ] - p.x ) * ux + ( st[ 2 ] - p.z ) * uz < 0 && along > Math.abs( vx * uz - vz * ux );
		const horizon = moving && ! tailing ? LOOK : 0;   // s of the player's path that count
		for ( let d = 1; d <= REACH; d += 1 ) {

			// the point d m along its road
			let at = back ? car.s - d : car.s + d;
			if ( at < 0 || at > len ) break;
			let k = 0;
			while ( k < seg.length - 1 && at > seg[ k ] ) at -= seg[ k ++ ];
			_u.copy( pts[ k ] ).lerp( pts[ k + 1 ], seg[ k ] > 0 ? Math.min( 1, at / seg[ k ] ) : 1 );
			if ( Math.abs( _u.y - st[ 1 ] ) > 2.5 ) continue;
			for ( let t = 0; t <= horizon + 1e-6; t += 0.4 ) {

				const cx = st[ 0 ] + vx * t, cz = st[ 2 ] + vz * t;
				// distance from the road point to the footprint segment
				const ex = _u.x - ( cx - fx ), ez = _u.z - ( cz - fz ), L2 = 4 * ( fx * fx + fz * fz );
				const w = L2 > 0 ? Math.max( 0, Math.min( 1, ( ex * 2 * fx + ez * 2 * fz ) / L2 ) ) : 0;
				if ( Math.hypot( ex - w * 2 * fx, ez - w * 2 * fz ) < CLEAR ) return true;

			}

		}
		return false;

	}

	// Solid bodies for the cars near the player's car: kinematic, posed where each car is drawn
	// (four per car: fore and aft, and a pair LOW under them; fitted by FIT), so the player's car stops against them instead of
	// passing through. Parked cars aboard ride with her pose each frame at no speed of their own.
	// Bodies go when a car leaves the radius or the service; none until the car physics is up.
	solid() {

		const physics = this.app.rally?.physics, s = this.app.rally?.state;
		if ( physics !== this.physics ) { this.physics = physics; this.bodies.clear(); }
		if ( ! physics || ! s ) return;
		for ( const car of this.cars ) {

			const g = car.group, id = ID + 4 * car.id;
			if ( car.state === 'gone' || ! car.world || Math.hypot( g.position.x - s[ 0 ], g.position.z - s[ 2 ] ) > NEAR ) {

				if ( this.bodies.delete( car.id ) ) for ( let j = 0; j < 4; j ++ ) physics.remove_remote( id + j );
				continue;

			}
			const [ kind, lift, reach ] = FIT[ car.name ], q = g.quaternion;
			_u.set( 0, lift, 0 ).applyQuaternion( q ).add( g.position );
			_f.set( 0, 0, reach ).applyQuaternion( q );
			_s[ 3 ] = q.x; _s[ 4 ] = q.y; _s[ 5 ] = q.z; _s[ 6 ] = q.w;
			_s[ 7 ] = car.path ? ( car.state === 'back' ? - car.v : car.v ) * 3.6 : 0;
			_w.set( 0, - LOW, 0 ).applyQuaternion( q );
			for ( let j = 0; j < 4; j ++ ) {

				const k = j & 1 ? - 1 : 1, low = j > 1 ? 1 : 0;
				_s[ 0 ] = _u.x + k * _f.x + low * _w.x; _s[ 1 ] = _u.y + k * _f.y + low * _w.y; _s[ 2 ] = _u.z + k * _f.z + low * _w.z;
				physics.update_remote( id + j, kind, _s );

			}
			this.bodies.add( car.id );

		}

	}

	// A model's drawn body in its car's frame (the group: +z forward, +y up, the origin on the ground
	// under its middle), from the bounds of the parts it draws (parked_cars.glb: 2.25 to 2.44 m across
	// the mirrors, 4.4 to 5.5 m long). The box a person on foot meets. Measured once a model.
	extent( name ) {

		let e = this.extents.get( name );
		if ( e ) return e;
		e = { min: new Vector3( Infinity, Infinity, Infinity ), max: new Vector3( - Infinity, - Infinity, - Infinity ), half: 0 };
		for ( const part of this.parts?.get( name ) || [] ) {

			const g = part.geometry;
			if ( ! g.boundingBox ) g.computeBoundingBox();
			e.min.min( g.boundingBox.min );
			e.max.max( g.boundingBox.max );

		}
		// (no parts loaded yet: an everyday car's size)
		if ( ! Number.isFinite( e.min.x ) ) { e.min.set( - 1.15, 0, - 2.5 ); e.max.set( 1.15, 1.5, 2.5 ); }
		e.half = Math.max( - e.min.x, e.max.x );
		this.extents.set( name, e );
		return e;

	}

	// Every car is solid to people on foot: a walker box of its drawn body, posed every frame where it
	// is drawn, in the walking world (app.colliders; marked a prop so the car physics, which has its own
	// bodies for these cars in solid(), never takes it as a static) and, on or over a ship's deck or
	// ramp, in her deck boxes in her frame, the world the walker aboard reads (FerryDeck.walk). Before
	// this the player walked through every queued, moving and parked car (docs/people.md).
	walkers() {

		const C = this.app.colliders;
		if ( ! C ) return;
		const ships = this.fleet();
		for ( const f of ships ) if ( f.deck ) f.deck.trafficUsed = 0;
		for ( const car of this.cars ) {

			if ( car.state === 'gone' || ! car.world ) { if ( car.walker ) car.walker.solid = false; continue; }
			const g = car.group, e = this.extent( car.name ), q = g.quaternion;
			const hx = ( e.max.x - e.min.x ) / 2, hy = ( e.max.y - e.min.y ) / 2, hz = ( e.max.z - e.min.z ) / 2;
			_f.set( 0, 0, 1 ).applyQuaternion( q );
			const yaw = Math.atan2( _f.x, _f.z );
			_u.set( ( e.min.x + e.max.x ) / 2, ( e.min.y + e.max.y ) / 2, ( e.min.z + e.max.z ) / 2 ).applyQuaternion( q ).add( g.position );
			let b = car.walker;
			if ( ! b ) {

				b = car.walker = this.walkerPool.pop() || C.addBox( _u, _w.set( hx, hy, hz ), yaw, { tag: 'traffic-car' } );
				b.prop = true;

			}
			b.center.copy( _u );
			b.half.set( hx, hy, hz );
			b.rotY = yaw; b.cos = Math.cos( yaw ); b.sin = Math.sin( yaw );
			b.top = _u.y + hy; b.bottom = _u.y - hy; b.radius = Math.hypot( hx, hz );
			b.solid = true;
			for ( const f of ships ) {

				const deck = f.deck, ship = f.ship;
				if ( ! deck || ! ship ) continue;
				const l = ship.toLocal( _u, _v );
				if ( Math.abs( l.x ) > ON_DECK.x || l.z < ON_DECK.aft || l.z > ON_DECK.bow || Math.abs( l.y - hy - DECK ) > 2 ) continue;
				// axis aligned in her frame: the box round the car as it lies across her (a car turning at her bow is boxed wider)
				const r = yaw - ship.yaw, c = Math.abs( Math.cos( r ) ), s = Math.abs( Math.sin( r ) );
				const pool = deck.trafficBoxes || ( deck.trafficBoxes = [] );
				let d = pool[ deck.trafficUsed ];
				if ( ! d ) {

					d = { walk: false, solid: true, center: new Vector3(), half: new Vector3(), tag: 'traffic-car' };
					pool.push( d );
					deck.boxes.push( d );

				}
				deck.trafficUsed ++;
				d.center.copy( l );
				d.half.set( c * hx + s * hz, hy, s * hx + c * hz );
				d.solid = true;

			}

		}
		for ( const f of ships ) {

			const pool = f.deck?.trafficBoxes;
			if ( pool ) for ( let i = f.deck.trafficUsed; i < pool.length; i ++ ) pool[ i ].solid = false;

		}

	}

	// The point d m along this car's road from where it is (backing out: behind it), or false past an end.
	roadPoint( car, pts, seg, len, d, out ) {

		let at = car.state === 'back' ? car.s - d : car.s + d;
		if ( at < 0 || at > len ) return false;
		let k = 0;
		while ( k < seg.length - 1 && at > seg[ k ] ) at -= seg[ k ++ ];
		out.copy( pts[ k ] ).lerp( pts[ k + 1 ], seg[ k ] > 0 ? Math.min( 1, at / seg[ k ] ) : 1 );
		return true;

	}

	// A person on foot in this car's road: the player walking, aboard on foot or down (driving, the
	// player's car is playerInWay's), and the townsfolk standing or walking (app.people's grid of
	// everyone's feet), within the car's half width plus their body radius of its road, from its middle
	// to its nose plus its reaction and braking distance and KERB. A driver waits for them as for the
	// player's car; before this a car drove on through anyone in its way.
	personInWay( car, pts, seg, len ) {

		const e = this.extent( car.name ), w = car.world, back = car.state === 'back';
		if ( ! w ) return false;   // a car set on its road this frame is posed after its first drive (the game's first frame)
		const reach = ( back ? - e.min.z : e.max.z ) + car.v * REACT + car.v * car.v / ( 2 * BRAKE ) + KERB;
		const pl = this.app.player, rally = this.app.rally;
		const player = pl && ! rally?.active && ! rally?.bailout?.active && ( pl.mode === 'walk' || pl.mode === 'ferry' || pl.mode === 'ragdoll' )
			&& Math.hypot( pl.position.x - w.x, pl.position.z - w.z ) < reach + e.half + 1 ? pl.position : null;
		_people.length = 0;
		this.app.people?.grid.near( w.x, w.z, reach + e.half + 1, _people );
		if ( ! player && ! _people.length ) return false;
		for ( let d = 0; d <= reach; d += PERSON_STEP ) {

			if ( ! this.roadPoint( car, pts, seg, len, d, _rp ) ) break;
			if ( player && Math.abs( player.y - _rp.y ) < 2 && Math.hypot( player.x - _rp.x, player.z - _rp.z ) < e.half + PLAYER_R ) return true;
			for ( const q of _people ) {

				if ( q.posture === 'sit' || ! q.world ) continue;
				if ( Math.abs( q.world.y - _rp.y ) < 2 && Math.hypot( q.world.x - _rp.x, q.world.z - _rp.z ) < e.half + BODY_R ) return true;

			}

		}
		return false;

	}

	// Is (x, y, z) in the road a moving car is about to drive (from its middle to where it will be in
	// `see` s), within its half width plus r? A walker who would step there waits at the kerb (Crowd.js).
	roadAhead( x, y, z, r, see = SEE ) {

		for ( const car of this.cars ) {

			const P = car.path;
			if ( ! P?.pts || ! P.len || ! car.world || car.v < 0.3 ) continue;
			const e = this.extent( car.name ), reach = ( car.state === 'back' ? - e.min.z : e.max.z ) + car.v * see;
			if ( Math.hypot( x - car.world.x, z - car.world.z ) > reach + e.half + r + 1 ) continue;
			for ( let d = 0; d <= reach; d += PERSON_STEP ) {

				if ( ! this.roadPoint( car, P.pts, P.seg, P.len, d, _rp ) ) break;
				if ( Math.abs( y - _rp.y ) < 2 && Math.hypot( x - _rp.x, z - _rp.z ) < e.half + r ) return true;

			}

		}
		return false;

	}

	pose( car ) {

		const g = car.group, ship = this.shipOf( car );
		if ( car.state === 'parked' || ( ! car.path && car.local ) ) {

			// aboard: her frame, riding with her
			ship.toWorld( car.local, g.position );
			g.quaternion.copy( ship.quaternion ).multiply( _q.setFromAxisAngle( _up, car.localYaw ) );
			car.world = ( car.world || new Vector3() ).copy( g.position );

		} else if ( ! car.path ) {

			car.terminal.toWorld( car.at, g.position );
			g.quaternion.setFromAxisAngle( _up, car.terminal.yaw );
			car.world = ( car.world || new Vector3() ).copy( g.position );

		} else if ( car.world ) {

			g.position.copy( car.world );
			g.quaternion.setFromAxisAngle( _up, car.heading ).multiply( _p.setFromAxisAngle( _x, - car.grade ) );

		}
		g.visible = g.position.distanceToSquared( this.app.camera.position ) < 400 * 400;

	}

	// Hold her ramp down: a car is driving on or off at her berth, or backing out over her deck,
	// ramp or linkspan. The queue never holds her: no car starts aboard past her time. A car that gave way to the player's car no
	// longer holds her once it is back in the lanes, and the queue stops holding her at that call.
	// The player driving through the marshalling lanes or over the linkspan and her ramp toward her
	// deck, not yet stopped aboard: the crew waits for them, up to PLAYER_HOLD seconds past her time.
	playerBoarding( t, ferry = this.ferry ) {

		const rally = this.app.rally, s = rally?.state;
		if ( ! t || ! s || ! rally.active ) return false;
		const c = Math.cos( t.yaw ), n = Math.sin( t.yaw ), dx = s[ 0 ] - t.position.x, dz = s[ 2 ] - t.position.z;
		const x = dx * c - dz * n, z = dx * n + dz * c;
		if ( x > - 12 && x < 10 && z > - 95 && z < - 8 ) return true;   // the lanes and the linkspan, to her ramp's toe
		const l = ferry.ship.toLocal( _v.set( s[ 0 ], s[ 1 ], s[ 2 ] ), _w );
		// on her ramp or deck and still moving, or standing in her after end where the ramp can't rise over it
		return Math.abs( l.x ) < 6.6 && l.z > - 36 && l.z < 16 && Math.abs( l.y - DECK ) < 2 && ( Math.abs( s[ 7 ] ) > 1 || l.z < - 18 );

	}

	playerInBoardingRoad( ferry = this.ferry, lx = 0 ) {

		const rally = this.app.rally, s = rally?.state;
		if ( ! s || ! rally.active ) return false;
		const l = ferry.ship.toLocal( _v.set( s[ 0 ], s[ 1 ], s[ 2 ] ), _w );
		return Math.abs( l.x - lx ) < CLEAR && l.z > - 36 && l.z < 16 && Math.abs( l.y - DECK ) < 2;

	}

	// The player in the driver's seat of a car on her vehicle deck.
	playerAboard( ferry = this.ferry ) {

		const rally = this.app.rally, s = rally?.state;
		if ( ! s || ! rally.active ) return false;
		const l = ferry.ship.toLocal( _v.set( s[ 0 ], s[ 1 ], s[ 2 ] ), _w );
		return Math.abs( l.x ) < 6.6 && l.z > - 26 && l.z < 16 && Math.abs( l.y - DECK ) < 1.5;

	}

	// (per ship: FerryService asks for its own ship)
	holding( ferry = this.ferry ) {

		const call = this.call( ferry );
		return this.trafficHolding( ferry ) || ( call.boarding && call.playerHeld < PLAYER_HOLD );

	}

	// Her ramp held for the traffic alone: cars driving on or off. (A queued car held her too, up to
	// 75 s past her time, while the queue kept starting aboard: removed, see the header.)
	trafficHolding( ferry = this.ferry ) {

		const t = ferry.at?.terminal;
		return this.cars.some( c => c.ferry === ferry && ( ( c.state === 'board' ) || ( c.state === 'back' && c.s > c.shore ) || ( c.state === 'unload' && c.s < 45 ) || ( c.state === 'parked' && c.from !== t ) ) );

	}

	// Read-only: every car, where it is and what it is doing (aboard: in her frame).
	state() {

		return this.cars.map( c => {

			const l = this.shipOf( c ).toLocal( c.world || c.group.position, new Vector3() );
			return { id: c.id, model: c.name, state: c.state, terminal: c.terminal.name, ship: c.ferry?.name ?? null, slot: c.slot, braking: !! c.braking, by: c.path ? c.by ?? null : null, v: + c.v.toFixed( 2 ), local: [ l.x, l.y, l.z ].map( v => + v.toFixed( 2 ) ) };

		} );

	}

}
