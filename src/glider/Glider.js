// Hang glider activity: deck entry with E, the fixed-step flight loop, bail-out, the hike guide and
// the chase and harness cameras. World frame: metres, y up; the flight state lives in GliderPhysics
// as plain arrays (position, velocity, quaternion) stepped at STEP (1/120 s).
import { Quaternion, Vector3 } from '../engine/index.js';
import { loadModel } from '../rally/VehicleModel.js';
import { fadeCustomize } from '../people/Fade.js';
import { GliderPhysics, STEP, WING } from './GliderPhysics.js';
import { buildStation } from './Station.js';
import { GliderCollision } from './Collision.js';
import { GliderPanel } from './Panel.js';
import { LAUNCH, launchPoint } from './Site.js';
import { add, rotate, clamp } from '../aviation/Math.js';
import { localAircraftExit, entryRescue } from '../aviation/OnFootExit.js';
import { clearFlightCamera } from './FlightCamera.js';
import { GliderBody } from './GliderBody.js';
import { GliderAir } from './Air.js';

// m to the side of the keel where E after a landing sets the pilot down: the half-span plus 0.4 m.
const EXIT_SIDE = WING.span / 2 + 0.4;
const DECK_REACH = 5; // m from the glider's rest point on the deck within which E clips in
const DECK_REACH_HEIGHT = 3; // m above or below the deck: the stairs below do not offer the clip-in
const DECK_REST_ALONG = - 3; // m along the ramp axis: the wing's rest point on the deck
const VISIT_STAND = [ 0, - 5, 1.7 ]; // launch frame (across, along, up), m: where a visitor stands
const VISIT_EYE = [ - 19, 30, 12 ]; // launch frame, m: the station overview camera
const VISIT_TARGET = [ 0, 3, 1 ]; // launch frame, m
const HARNESS_EYE = [ 0, - 0.55, 1.05 ]; // wing frame, m: the pilot's eye in the harness
const HARNESS_LOOK = 50; // m ahead along the keel
const CHASE_BACK = 15; // m behind the wing along its heading
const CHASE_UP = 5; // m above the wing
const CHASE_LOOK = 5; // m ahead of the wing along the keel
const CAMERA_RATE = 6; // 1/s: the visit camera eases toward the chase eye
const MAX_FRAME = 0.2; // s: a longer frame is discarded, not simulated (tab switch, debugger)
const WINDSOCK_HEIGHT = 5; // m above the launch point where the windsock samples the air
const TRAIL_REACH = 0.65; // m: a hike waypoint counts as reached
const HIKE_PITCH = 0.04; // rad: the hike guide's view pitch
// Thermals follow the sun's height (sun direction y): none below 0.1 (about 6 degrees), full at 0.5
// (30 degrees).
const THERMAL_SUN_LOW = 0.1;
const THERMAL_SUN_SPAN = 0.4;
// Pilot weight shift drawn on the Pilot pivot: m per unit bar roll and pitch, rad of tilt per unit roll.
const PILOT_SHIFT_ROLL = 0.35;
const PILOT_SHIFT_PITCH = 0.22;
const PILOT_TILT_ROLL = 0.12;
// The trail starts at the road below the mountain and leaves the evacuation route at the refuge.
const TRAILHEAD = { x: 54, z: - 74 };
const TRAIL_REFUGE_EXIT = { x: 47, z: - 246 };
const CHAIRLIFT_BUSY = 'Exit the chairlift at a terminal before changing activities.';
const LANDED_PHASES = [ 'ready', 'landed', 'crashed', 'ditched' ];

// Scratch vectors for bail(), sync() and updateCamera(): no allocation per frame.
const _bailAt = new Vector3();
const _bailVelocity = new Vector3();
const _bailAttitude = new Quaternion();
// A hang-glider pilot hangs prone in the harness: head along the keel (+z), face down (-y). The avatar
// stands along +y facing +z, so the harness attitude is the wing's turned +90 degrees about its right
// (+x) axis: +y goes to +z and +z to -y.
const PRONE = new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), Math.PI / 2 );
const _pilotAxis = new Vector3( 0, 0, 1 );
const _eye = new Vector3();
const _target = new Vector3();

function leaveOtherVehicles( app ) {

	app.aviation?.leave();
	if ( app.rally?.active ) app.rally.leave();
	if ( app.jetskis?.riding ) app.jetskis.dismount();

}

export class Glider {

	constructor( app ) {

		this.app = app;
		this.flight = new GliderPhysics();
		this.active = false;
		this.pilot = false;
		this.camMode = 'chase';
		this.camReady = false;
		this.accumulator = 0;
		this.discardedTime = 0;
		this.savedPlayer = null;
		this.snapshot = null;
		this.time = 0;
		this.env = {
			terrainAt: ( x, z ) => app.terrainData.heightAt( x, z ),
			waterAt: ( x, z ) => app.disasters?.field?.waterAt( x, z ) || 0,
			// Shared road surface (CoastalRoute.surfaceAt): the landing message names the asphalt.
			roadAt: ( x, z ) => app.terrainData.roadSurfaceAt?.( x, z ) || null,
		};
		// The wing's air is the shared field shaped by the shared terrain (Air.js); thermals follow the
		// shared sun: none below about 6 degrees of elevation, full strength above about 30.
		this.air = new GliderAir( {
			field: () => app.disasters?.field,
			terrainAt: this.env.terrainAt,
			waterAt: this.env.waterAt,
			daylight: () => {

				const y = app.atmosphere?.sunDir?.value?.y;
				return Number.isFinite( y ) ? ( y - THERMAL_SUN_LOW ) / THERMAL_SUN_SPAN : 1;

			},
			clock: () => this.time,
		} );
		this.airOut = { wx: 0, wy: 0, wz: 0 };
		this.env.sample = ( x, y, z ) => this.air.sample( x, y, z, this.airOut );
		this.deckOffer = { text: '', act: () => this.board() };

	}

	// E prompt at the launch deck (Player.js asks every walking frame, like the jetski offer).
	offer( player ) {

		if ( this.active || player.mode !== 'walk' || ! this.station || this.station.launchRecord.broken || this.app.chairlift?.active ) return null;
		const deck = launchPoint( 0, DECK_REST_ALONG, 0 );
		const dx = player.position.x - deck[ 0 ];
		const dz = player.position.z - deck[ 2 ];
		if ( dx * dx + dz * dz > DECK_REACH * DECK_REACH || Math.abs( player.position.y - deck[ 1 ] ) > DECK_REACH_HEIGHT ) return null;
		this.deckOffer.text = this.flight.phase === 'ready' ? 'Clip in to the hang glider' : 'Clip in to a fresh hang glider';
		return this.deckOffer;

	}

	board() {

		if ( ! this.takeControl() ) return;
		if ( this.flight.phase !== 'ready' ) this.flight.reset();
		this.pilot = true;
		this.camReady = false;
		this.app.cameraCut();
		this.ui?.message( 'Hold W to run off the ramp into the wind.' );

	}

	bail() {

		const a = this.app;
		const p = a.player;
		const f = this.flight;
		const harness = add( f.position, rotate( f.quaternion, [ 0, - 1.45, 0 ] ) );
		this.active = false;
		this.pilot = false;
		this.lastExit = 'bail';
		this.savedPlayer = null;
		f.controls.pitch = 0;
		f.controls.roll = 0;
		f.controls.flare = false;
		p.resumeOnFoot( { position: harness, velocity: f.velocity } );
		_bailAt.set( harness[ 0 ], harness[ 1 ], harness[ 2 ] );
		_bailVelocity.set( f.velocity[ 0 ], f.velocity[ 1 ], f.velocity[ 2 ] );
		_bailAttitude.fromArray( f.quaternion ).multiply( PRONE );
		p.avatar?.group?.quaternion.copy( _bailAttitude );
		p.ragdoll( null, null, { velocity: _bailVelocity, at: _bailAt, heading: null, spin: { x: 0, y: 0, z: 0 } } );
		a.camera.up.set( 0, 1, 0 );
		this.releaseInput();
		this.ui?.update( 0 );
		a.cameraCut();

	}

	async init() {

		const app = this.app;
		// every material carries Fade.js's dither fade (opaque ones alpha-tested) for the see-through wing (applyWingFade)
		this.model = await loadModel( `${ import.meta.env.BASE_URL || '/' }glider/glider.glb`, { customize: fadeCustomize } );
		this.ensureBody();
		app.scene.add( this.model.root );
		this.station = buildStation( app );
		app.disasters?.structures?.addRecords?.( this.station.records );
		this.collision = new GliderCollision( app.colliders );
		this.env.obstacleAt = ( x, y, z ) => this.collision.at( x, y, z );
		this.pilotNode = this.model.pivots.get( 'Pilot' );
		this.pilotBase = this.pilotNode?.position.clone();
		const evac = app.terrainData.evacuationRoute;
		const trailhead = { x: TRAILHEAD.x, z: TRAILHEAD.z, y: app.terrainData.heightAt( TRAILHEAD.x, TRAILHEAD.z ) };
		const refugeExit = { x: TRAIL_REFUGE_EXIT.x, z: TRAIL_REFUGE_EXIT.z, y: evac.refuge.y };
		this.trail = [ trailhead, evac.entry, ...evac.points, refugeExit ].concat( this.station.site.points );
		this.trailIndex = 0;
		this.guiding = false;
		this.trailArrived = false;
		this.ui = new GliderPanel( this );
		this.unregister = app.disasters?.registerExternal?.( {
			before: () => this.captureDisasterState(),
			reset: () => this.resetDisasterEffects(),
		} );
		this.sync();

	}

	takeControl() {

		if ( this.app.chairlift?.active ) return false;
		this.guiding = false;
		if ( this.active ) return true;
		const a = this.app;
		const p = a.player;
		leaveOtherVehicles( a );
		this.savedPlayer = { position: p.position.clone(), yaw: p.yaw, pitch: p.pitch, mode: p.mode };
		if ( a.freeCam ) a.setFreeCam( false );
		this.active = true;
		a.freeCam = false;
		p.mode = 'glider';
		p.velocity.set( 0, 0, 0 );
		p.prompt = null;
		this.releaseInput();
		this.camReady = false;
		a.cameraCut();
		return true;

	}

	releaseInput() {

		this.app.input.keys.clear();
		this.app.input.pressed.clear();
		this.app.input.consumeLook();

	}

	visit() {

		if ( ! this.takeControl() ) return CHAIRLIFT_BUSY;
		this.pilot = false;
		this.camReady = false;
		this.app.cameraCut();

	}

	launch() {

		if ( this.station.launchRecord.broken ) return 'Launch ramp damaged · restore the island first';
		if ( this.flight.phase !== 'ready' ) return 'Reset the glider before another launch';
		if ( ! this.takeControl() ) return CHAIRLIFT_BUSY;
		this.pilot = true;
		const error = this.flight.launch( this.env );
		this.camReady = false;
		this.app.cameraCut();
		return error;

	}

	approach() {

		if ( ! this.takeControl() ) return CHAIRLIFT_BUSY;
		this.pilot = true;
		this.flight.approach( this.env );
		this.camReady = false;
		this.app.cameraCut();

	}

	reset() {

		this.flight.reset();
		this.camReady = false;
		this.accumulator = 0;
		this.sync();
		this.ui?.update( 0 );
		this.app.cameraCut();

	}

	leave() {

		if ( ! this.active ) return;
		const a = this.app;
		const p = a.player;
		if ( this.pilot && ( this.flight.phase === 'running' || this.flight.phase === 'airborne' ) ) {

			this.bail();
			return;

		}
		const local = this.pilot && LANDED_PHASES.includes( this.flight.phase ) ? localAircraftExit( a, this.flight, { waterAt: this.env.waterAt, sideOffset: EXIT_SIDE } ) : null;
		if ( local ) local.yaw = Math.atan2( - ( this.flight.position[ 0 ] - local.position[ 0 ] ), - ( this.flight.position[ 2 ] - local.position[ 2 ] ) );
		const destination = local || entryRescue( a, this.savedPlayer );
		this.lastExit = local ? 'local' : 'rescue';
		this.active = false;
		this.pilot = false;
		this.flight.controls = { pitch: 0, roll: 0, flare: false };
		p.resumeOnFoot( destination );
		this.savedPlayer = null;
		a.camera.up.set( 0, 1, 0 );
		this.releaseInput();
		this.ui?.update( 0 );
		a.cameraCut();

	}

	walkToStation() {

		if ( this.app.chairlift?.active ) return 'Exit the chairlift at a terminal before hiking.';
		this.leave();
		const a = this.app;
		const p = a.player;
		if ( a.freeCam ) a.setFreeCam( false );
		leaveOtherVehicles( a );
		this.guiding = ! this.guiding;
		this.trailArrived = false;
		if ( this.guiding ) {

			let best = Infinity;
			this.trailIndex = 0;
			for ( let i = 0; i < this.trail.length; i ++ ) {

				const t = this.trail[ i ];
				const d = Math.hypot( t.x - p.position.x, t.z - p.position.z, t.y - p.position.y );
				if ( d < best ) {

					best = d;
					this.trailIndex = i;

				}

			}

		}
		this.releaseInput();
		a.cameraCut();
		this.ui.message( 'Hold W to hike; the guide only steers your view. Release W to stop. Shift runs.' );

	}

	updateHike() {

		if ( ! this.guiding || this.active || this.app.freeCam || this.app.player.mode !== 'walk' ) return;
		const p = this.app.player;
		while ( this.trailIndex < this.trail.length && Math.hypot( this.trail[ this.trailIndex ].x - p.position.x, this.trail[ this.trailIndex ].z - p.position.z ) < TRAIL_REACH ) this.trailIndex ++;
		if ( this.trailIndex >= this.trail.length ) {

			this.guiding = false;
			this.trailArrived = true;
			return;

		}
		const t = this.trail[ this.trailIndex ];
		p.yaw = Math.atan2( - ( t.x - p.position.x ), - ( t.z - p.position.z ) );
		p.pitch = HIKE_PITCH;

	}

	captureDisasterState() {

		if ( this.snapshot ) return;
		this.snapshot = {
			flight: structuredClone( { ...this.flight } ),
			active: this.active,
			pilot: this.pilot,
			camMode: this.camMode,
			savedPlayer: this.savedPlayer,
			guiding: this.guiding,
			trailIndex: this.trailIndex,
			trailArrived: this.trailArrived,
		};

	}

	resetDisasterEffects() {

		if ( ! this.snapshot ) return;
		const s = this.snapshot;
		Object.assign( this.flight, s.flight );
		this.active = s.active;
		this.pilot = s.pilot;
		this.camMode = s.camMode;
		this.savedPlayer = s.savedPlayer;
		this.guiding = s.guiding;
		this.trailIndex = s.trailIndex;
		this.trailArrived = s.trailArrived;
		this.snapshot = null;
		this.accumulator = 0;
		this.camReady = false;
		if ( this.active ) {

			this.app.player.mode = 'glider';
			this.app.player.velocity.set( 0, 0, 0 );
			this.app.freeCam = false;
			this.releaseInput();

		}
		this.sync();
		this.ui?.update( 0 );
		this.app.cameraCut();

	}

	controls() {

		if ( ! this.active ) return;
		const i = this.app.input;
		const c = this.flight.controls;
		// E leaves (the house key): beside the wing on the ground, a bail-out in the air. It was X.
		if ( i.hit( 'KeyE' ) ) {

			this.leave();
			return;

		}
		if ( ! this.pilot ) return;
		// W on the deck starts the run; the panel's Launch button does the same.
		if ( this.flight.phase === 'ready' && ( i.hit( 'KeyW' ) || i.hit( 'ArrowUp' ) ) ) {

			const error = this.launch();
			if ( error ) this.ui?.message( error );

		}
		c.pitch = ( i.down( 'ArrowDown' ) || i.down( 'KeyS' ) ? 1 : 0 ) - ( i.down( 'ArrowUp' ) || i.down( 'KeyW' ) ? 1 : 0 );
		// A +Z-facing mesh has its +X side on screen left in a Y-up chase view.
		c.roll = ( i.down( 'ArrowLeft' ) || i.down( 'KeyA' ) ? 1 : 0 ) - ( i.down( 'ArrowRight' ) || i.down( 'KeyD' ) ? 1 : 0 );
		c.flare = i.down( 'Space' );
		if ( i.hit( 'KeyR' ) ) this.reset();
		if ( i.hit( 'KeyC' ) ) this.toggleCamera();

	}

	toggleCamera() {

		this.camMode = this.camMode === 'harness' ? 'chase' : 'harness';
		this.camReady = false;
		this.app.cameraCut();

	}

	applyWingFade( dt ) {

		const body = this.body;
		if ( ! body ) return;
		body.unasked += dt;
		if ( body.unasked > 0.25 ) {

			body.fade = 0;
			body.sinceHidden = Infinity;

		}
		const q = Math.round( body.fade * 50 ) / 50;
		if ( q === this.wingFade ) return;
		this.wingFade = q;
		if ( ! this.wingMaterials ) {

			const materials = new Set();
			this.model.root.traverse( o => {

				if ( o.material?.uniforms?.fade ) materials.add( o.material );

			} );
			this.wingMaterials = [ ...materials ];

		}
		for ( const m of this.wingMaterials ) m.set( 'fade', q );

	}

	ensureBody() {

		if ( this.body || ! this.model?.root ) return;
		this.body = new GliderBody( this.model.root, this.flight );
		const p = this.app.player;
		if ( p ) {

			( p.cameraObstacles ||= new Set() ).add( this.body );
			( p.obstacleProviders ||= new Set() ).add( this.body );

		}

	}

	update( dt ) {

		if ( ! this.model ) return;
		this.updateHike();
		this.controls();
		this.collision?.refresh();
		const accepted = clamp( Number.isFinite( dt ) ? dt : 0, 0, MAX_FRAME );
		this.discardedTime += Math.max( 0, dt - accepted );
		this.accumulator += accepted;
		while ( this.accumulator >= STEP ) {

			this.flight.step( STEP, this.env );
			this.accumulator -= STEP;

		}
		this.time += accepted;
		this.sync();
		this.applyWingFade( accepted );
		if ( this.active ) {

			const player = this.app.player;
			player.position.fromArray( this.pilot ? this.flight.position : launchPoint( ...VISIT_STAND ) );
			player.velocity.set( 0, 0, 0 );
			player.prompt = null;

		}
		const wind = this.env.sample( LAUNCH.x, LAUNCH.y + WINDSOCK_HEIGHT, LAUNCH.z );
		const station = this.station;
		station.windsock.visible = ! station.launchRecord.broken;
		if ( station.launchRecord.broken && this.flight.phase === 'running' ) {

			this.flight.phase = 'airborne';
			this.flight.reason = 'Launch support failed';

		}
		station.windsock.rotation.y = Math.atan2( - ( wind.wx || 0 ), - ( wind.wz || 0 ) );
		this.ui.update( dt );

	}

	sync() {

		if ( ! this.model ) return;
		const f = this.flight;
		this.model.root.position.fromArray( f.position );
		this.model.root.quaternion.fromArray( f.quaternion );
		if ( this.pilotNode ) {

			this.pilotNode.visible = this.active && this.pilot;
			this.pilotNode.position.copy( this.pilotBase );
			this.pilotNode.position.x += f.bar.roll * PILOT_SHIFT_ROLL;
			this.pilotNode.position.z -= f.bar.pitch * PILOT_SHIFT_PITCH;
			this.pilotNode.quaternion.setFromAxisAngle( _pilotAxis, - f.bar.roll * PILOT_TILT_ROLL );

		}

	}

	updateCamera( dt ) {

		if ( ! this.active || ! this.model ) return;
		this.ensureBody();
		const f = this.flight;
		let eye;
		let target;
		if ( ! this.pilot ) {

			eye = launchPoint( ...VISIT_EYE );
			target = launchPoint( ...VISIT_TARGET );

		} else if ( this.camMode === 'harness' ) {

			eye = add( f.position, rotate( f.quaternion, HARNESS_EYE ) );
			target = add( eye, rotate( f.quaternion, [ 0, 0, HARNESS_LOOK ] ) );

		} else {

			const forward = rotate( f.quaternion, [ 0, 0, 1 ] );
			const heading = Math.atan2( forward[ 0 ], forward[ 2 ] );
			eye = add( f.position, [ - Math.sin( heading ) * CHASE_BACK, CHASE_UP, - Math.cos( heading ) * CHASE_BACK ] );
			target = add( f.position, rotate( f.quaternion, [ 0, 0, CHASE_LOOK ] ) );

		}
		const camera = this.app.camera;
		if ( this.pilot && this.camMode === 'chase' ) {

			if ( ! this.camReady ) camera.position.fromArray( eye );
			clearFlightCamera( camera.position, f.position, this.app.terrainData, this.app.colliders, f.quaternion, { desired: eye, dt, state: this.cameraState ||= {}, reset: ! this.camReady, sail: this.body, controls: f.controls, velocity: f.velocity } );

		} else if ( this.camReady && this.camMode === 'chase' ) camera.position.lerp( _eye.fromArray( eye ), 1 - Math.exp( - dt * CAMERA_RATE ) );
		else camera.position.fromArray( eye );
		camera.up.set( 0, 1, 0 );
		camera.lookAt( _target.fromArray( target ) );
		this.camReady = true;

	}

}
