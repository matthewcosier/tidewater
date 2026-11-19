// Foot passengers and the traffic cars' drivers on the ferry service, so her terminals and her
// decks aren't empty. Rocketbox people (tools/characters/build_crowd.sh: public/models/characters/
// crowd/*.glb, MIT) walk simple waypoint routes, in the terminal's frame ashore and in hers aboard
// (so they ride with her): foot passengers come out of the hall past the ticket counter, round the
// yard path, up the stair tower and along the covered walkway to wait in pairs at the gangway gate,
// chatting (one talks with her hands, the other nods); with her gangway out and the service
// loading they file over it through her port door, to a saloon seat or up to the sun deck's rail,
// and at the far side they walk off into that terminal's hall and go. Drivers get out beside their
// parked cars, climb the wing stairs to the saloon or the sun deck and come back down to their cars
// as she swings for the far berth. People near the player who see the player looking at them
// turn their head and chest (on the skeleton), wave or nod, then talk with their hands or point if
// the player lingers; walkers pause to do it; a cool-down keeps it from looping.
// Everyone has a townsfolk brain (src/people, docs/people.md): the brain senses the player and the
// events around them, chooses what they do at their seat, queue spot or rail (smart objects the
// crowd registers), and asks for gestures, head looks, a tuck of the knees and speech bubbles; this
// file keeps the bodies, the routes and the service's orchestration.
//   ferry.crowd.update( dt ), ferry.crowd.state(), ferry.crowd.holding()
import { Group, Vector3 } from '../engine/index.js';
import { pose } from '../people/Pose.js';
import { People } from '../people/People.js';
import { room, onLine } from '../people/Room.js';
import { SmartObject } from '../people/SmartObjects.js';
import { fadeOptions } from '../people/Fade.js';
import { SkinnedModel } from '../engine/render/Skinning.js';
import { loadGLB } from '../engine/loaders/GLTF.js';
import { mulberry32 } from '../util/Noise.js';
import { freshSeed } from '../disasters/EventRandom.js';

const CAST = [ 'f01', 'm01', 'f03', 'm04', 'f06', 'm07', 'f09', 'm10' ];
const CLIP = { idle: 'idle_neutral_01', look: 'idle_look_around_01', sit: 'sit_chair_idle_neutral_01', talk: 'gestic_talk_neutral_01', wave: 'wave_01',
	point: 'gestic_presentation_right_01', nod: 'gestic_listen_accept_01', phone: 'cell_phone_talk_01', walk: 'walk_neutral_01',
	shrug: 'gestic_shrug_01', laugh: 'gestic_laugh_low', sitLook: 'sit_chair_idle_look_around', sitRelax: 'sit_chair_idle_relaxed_01',
	sitThink: 'sit_chair_gestic_thoughtful', sitYawn: 'sit_chair_idle_yawn',
	angry: 'idle_angry_01', crouch: 'crouch_idle', crouchIn: 'crouch_in', crouchOut: 'crouch_out' };   // bumps (src/people/Contact.js); the women's set has no crouch in or out
const SITTING = new Set( [ 'sit', 'sitLook', 'sitRelax', 'sitThink', 'sitYawn' ] );
const PER_CAST = 4;                    // instances of each avatar: 32 people at most
const QUEUE = 12;                      // waiting at each gangway gate at most
// Terminal frame (terminal_colliders.json): out of the ticket counter's queue lane, across the hall to its door
// (BuildingDoor, x 27.7 to 30.3), along the front and down the yard path outside the hall's west wall, round
// to the stair tower's door (JettyStairs), up its five flights round the well (each leg on its treads' own
// rise, 0.131 m in 0.3 m) and out onto the covered walkway's middle (its walls at x 13.04 and 15.40). Every leg
// keeps a body (0.27 m) clear of the walls, seats, posts and treads (test/walker-routes.mjs).
const IN = [ [ 37.4, 3.35, - 16.2 ], [ 37.4, 3.35, - 14.9 ], [ 29.0, 3.35, - 10.0 ], [ 29.0, 3.35, - 6.8 ], [ 22.4, 3.36, - 6.8 ], [ 22.4, 3.36, - 33.4 ], [ 16.5, 3.2, - 34.2 ], [ 14.85, 3.2, - 34.2 ],
	[ 14.85, 3.2, - 31.9 ], [ 14.85, 3.99, - 29.8 ], [ 12.07, 4.77, - 29.8 ], [ 12.07, 5.56, - 32.55 ], [ 14.85, 6.34, - 32.55 ], [ 14.85, 7.0, - 29.8 ],
	[ 14.6, 7.0, - 28.4 ] ];
// The gate queue: pairs side by side (x 14.25 and 15.05), rows 0.7 m apart (a person's depth and a little
// room: Fruin queues at 0.45 to 0.5 m a person in single file) from the rotunda's mouth back to z 4.1, all of
// it ahead of the ticket-check podium by the right wall (x 14.92 to 15.37, z 2.6 to 3.1), which the right
// file would otherwise stand in.
const ROW0 = 7.6, ROW = 0.7;   // m, the front row's z and the rows' spacing
const spot = k => [ k % 2 ? 15.05 : 14.25, 7.0, ROW0 - ROW * Math.floor( k / 2 ) ];
// Up the walkway's middle past the podium (x 14.6 clears it by 0.05 m) to behind the queue, then straight up
// the file to the spot, so an arrival never walks through the pair beside its place and a claim moved up the
// queue only lengthens the last leg (update(): the queue closes up).
const toSpot = k => [ [ 14.6, 7.0, 3.0 ], ...( k % 2 ? [ [ 14.6, 7.0, 3.4 ], [ 15.05, 7.0, 3.6 ] ] : [ [ 14.25, 7.0, 3.4 ] ] ), spot( k ) ];
// Over the gangway: from the queue's front to the rotunda's mouth, across to the gangway's shore end and over it
// in her port door (x 8.8, z -16.25 to -14.75) to her side corridor's lane (x 7.95: clear of the benches by the
// hull at 8.25 and over the floor beside the wing stairwell, which opens at x 7.8).
const GANGWAY = [ [ 'T', 14.6, 7.0, 8.7 ], [ 'T', 13.2, 7.0, 9.7 ], [ 'T', 11.12, 7.0, 9.7 ], [ 'S', 9.32, 7.0, - 15.5 ], [ 'S', 7.95, 7.0, - 15.3 ] ];
// Her frame (+x port; ferry_colliders.json). Her saloon's seat rows are 0.63 m deep, 0.95 m apart from z 3.07,
// with two seats a bench at x 2.18 to 3.82 and 5.68 to 7.32: every other row is used, sat 0.25 m forward of the
// row's back (facing forward).
const BENCHES = [ [ 2.6, 3.4 ], [ 6.1, 6.9 ] ], ROWS = [ 3.0, 4.9, 6.8, 8.7, 10.6, 12.5 ];   // two seats a bench, x; rows, z
// The sun deck's rail, per side (+1 port): gaps between the side deck's benches (x 7.55 to 8.35) and, to port, the
// open deck forward of them (z 0.5 to 5.4). To starboard a locker fills the side deck from z -5.5 to -0.3, so her
// starboard spots are all aft of it. The deck ahead of z 5.4 is behind the wheelhouse screen and planters.
const RAILS = { 1: [ - 10.6, - 8.2, - 5.8, 1.2, 2.6, 4.0 ], [ - 1 ]: [ - 13.6, - 10.6, - 8.2, - 7.0, - 5.9 ] };
// To a seat: from the corridor's lane into the saloon's outer aisle (x 8.06), and for the inner bench across to the
// middle aisle (x 4.75): to port along the front of the first row (z 2.43: 0.33 m from the bar at z 2.1, 0.32 m
// from the row), to starboard round the far end of the rows (z 13.6), because her starboard kiosk reaches z 2.4.
// Then up the aisle to the row, sideways along its legroom (0.32 m between rows: a person sidles, chest first)
// and down onto the seat.
const toSeat = ( side, [ x, z ] ) => {

	const a = x < 5 ? 4.75 : 8.06, g = z + 0.54;   // m: the aisle's middle; the legroom in front of the seat
	const across = x > 5 ? [] : side > 0 ? [ [ 4.75, 2.43 ] ] : [ [ 8.06, 13.6 ], [ 4.75, 13.6 ] ];
	return [ [ 7.95, - 1.2 ], [ 8.06, 2.43 ], ...across, [ a, g ], [ x, g ], [ x, z ] ].map( ( [ u, w ] ) => [ 'S', side * u, 7.0, w ] );

};
// To the rail: aft along the corridor past the sun deck stair (x 6.74 to 7.75) to its foot (z -19.9), up it
// (forward, to 10 m at z -15.74), out of its housing's door (x 6.95 to 7.8) and forward along the side deck
// inside the benches (x 7.15) to the spot, then out to the rail (x 8.3: the rail's face is at 8.65 to 8.72).
const toRail = ( side, z ) => [ [ 'S', side * 7.95, 7.0, - 15.3 ], [ 'S', side * 8.27, 7.0, - 16.1 ], [ 'S', side * 8.27, 7.0, - 20.3 ], [ 'S', side * 7.25, 7.0, - 20.3 ],
	[ 'S', side * 7.25, 7.0, - 19.9 ], [ 'S', side * 7.25, 10.0, - 15.74 ], [ 'S', side * 7.375, 10.0, - 14.3 ], [ 'S', side * 7.15, 10.0, - 13.7 ], [ 'S', side * 7.15, 10.0, z ], [ 'S', side * 8.3, 10.0, z ] ];
// her car deck's parking slots' z (Traffic.js SLOTS), where the drivers get out
const SLOTS_Z = [ - 19.5, - 14, - 4.5, 1, 6.5 ];
// A driver from beside the car, on its inboard side (x 3.3: between a centre-lane car's body at 2.97 and a parked
// car's at 3.68, mirrors included), to the wing stair's door (x 6.55 to 6.72, z -9.5 to -8.3), in, up its flight
// (z -8.2 to -1.96, 2.6 m to 7.0 m) and into the corridor's lane.
const fromCar = ( side, z ) => [ [ 'S', side * 3.3, 2.6, z ], [ 'S', side * 3.3, 2.6, - 8.9 ], [ 'S', side * 7.26, 2.6, - 8.9 ], [ 'S', side * 7.26, 2.6, - 8.2 ], [ 'S', side * 7.26, 7.0, - 1.96 ], [ 'S', side * 7.95, 7.0, - 1.2 ] ];

// Off her gangway and out through the terminal to its hall (terminal frame): the gangway's terminal half, then down
// the walkway's free side (x 13.6: 0.65 m from the queue's left file, 0.56 m from the wall), so a leaver never
// walks between the waiting pairs, and the way in, walked back.
const LEAVE = [ [ 'T', 11.12, 7.0, 9.7 ], [ 'T', 13.2, 7.0, 9.7 ], [ 'T', 13.6, 7.0, 8.4 ], [ 'T', 13.6, 7.0, - 27.0 ] ];
const OFF = () => [ ...LEAVE, ...[ ...IN ].reverse().map( w => [ 'T', ...w ] ) ];

// Every route the crowd walks, for test/walker-routes.mjs, built by the same tables the crowd walks
// them by: ashore [ name, points ] as [ x, y, z ] in the terminal's frame; aboard [ name, points, seated ]
// as Vector3s in her frame, `seated` when the route's last two legs are the sidle along a row's legroom and
// the step down onto the seat (toSeat).
export const ROUTES = {

	* terminal() {

		const T = route => route.map( w => w[ 0 ] === 'T' ? w.slice( 1 ) : w );
		for ( let k = 0; k < QUEUE; k ++ ) yield [ `the way in to the gate queue's spot ${ k }`, [ ...IN, ...toSpot( k ) ] ];
		for ( let k = 0; k < QUEUE; k ++ ) yield [ `from the queue's spot ${ k } to her gangway`, T( [ [ 'T', ...spot( k ) ], ...GANGWAY.slice( 0, 3 ) ] ) ];
		yield [ 'off her gangway out to the hall', T( OFF() ) ];

	},

	// the gate queue's places, terminal frame
	* queue() { for ( let k = 0; k < QUEUE; k ++ ) yield spot( k ); },

	* ship() {

		const V = route => route.map( w => new Vector3( w[ 1 ], w[ 2 ], w[ 3 ] ) );
		const seats = [];
		for ( const z of ROWS ) for ( const pair of BENCHES ) for ( const x of pair ) seats.push( [ x, z ] );
		for ( const side of [ 1, - 1 ] ) {

			// foot passengers board to port only (aboard()); drivers to their car's side (spawnDriver)
			const ways = side === 1 ? [ [ 'from her port door', GANGWAY.slice( 3 ) ] ] : [];
			for ( const z of SLOTS_Z ) ways.push( [ `from the car parked at her ${ side > 0 ? 'port' : 'starboard' } z ${ z }`, fromCar( side, z ) ] );
			for ( const [ from, start ] of ways ) {

				for ( const seat of seats ) yield [ `${ from } to the seat ${ side * seat[ 0 ] }, ${ seat[ 1 ] }`, V( [ ...start, ...toSeat( side, seat ) ] ), true ];
				for ( const z of RAILS[ side ] ) yield [ `${ from } to the rail at z ${ z }`, V( [ ...start, ...toRail( side, z ) ] ), false ];

			}

		}

	},

};

// The kerb (docs/people.md, Solid trunks, cars and room). A walker whose next step (KERB_LOOK ahead along its leg) is
// in the road a moving car will drive in its next few seconds (Traffic.roadAhead: from the car's middle to SEE s
// ahead), or beside the body of a car going by (its drawn extent and a body round it, behind its middle too, where
// roadAhead no longer looks), waits where it stands, but only while it stands outside the band the car itself stops
// for (Traffic.personInWay: the car's half width and a body, widened here by KERB_GAP). There the car drives on and
// the walker crosses behind it. A walker already inside that band walks on, and the car waits for it, so the two
// never wait for each other; a car below 0.3 m/s is not coming (roadAhead skips it), so a car waiting for someone
// never holds a walker either. Before this a walker stepped into a moving car's road, and the car braked for it.
const KERB_LOOK = 0.6;     // m: a walker's next step, about a stride (Fruin 1971: 0.6 to 0.75 m at 1.3 m/s)
const KERB_GAP = 0.15;     // m outside the car's own stopping band where a walker still waits (declared margin)
const BODY_R = 0.27;       // m: a person's body (Contact.js BODY_R)
//   atKerb( traffic, w, dx, dz ): w the walker's world position, ( dx, dz ) its leg's heading (any length)
export function atKerb( traffic, w, dx, dz ) {

	const cars = traffic?.cars, l = Math.hypot( dx, dz );
	if ( ! cars?.length || l < 0.05 ) return false;
	const ax = w.x + dx / l * KERB_LOOK, az = w.z + dz / l * KERB_LOOK;
	let coming = traffic.roadAhead( ax, w.y, az, BODY_R );
	for ( let i = 0; ! coming && i < cars.length; i ++ ) {

		// the body of one going by: car.dir is its heading on the ground (Traffic.blocked), either way along it
		const car = cars[ i ], o = car.world, d = car.dir;
		if ( ! o || ! d || car.v < 0.3 || Math.abs( o.y - w.y ) > 2 ) continue;
		const e = traffic.extent( car.name ), rx = ax - o.x, rz = az - o.z;
		coming = Math.abs( rx * d.z - rz * d.x ) < e.half + BODY_R && Math.abs( rx * d.x + rz * d.z ) < Math.max( e.max.z, - e.min.z ) + BODY_R;

	}
	return coming && ! traffic.roadAhead( w.x, w.y, w.z, BODY_R + KERB_GAP );

}

const LINE = 0.005;        // m: a side step this small is back on the route's line (Room.js)
const _v = new Vector3(), _w = new Vector3(), _d = new Vector3(), _c = new Vector3(), _a = new Vector3(), _b = new Vector3(), _s = new Vector3();
const rand = ( a, b ) => a + Math.random() * ( b - a );
const pick = a => a[ Math.floor( Math.random() * a.length ) ];
const wrap = a => Math.atan2( Math.sin( a ), Math.cos( a ) );
const clamp = ( v, a ) => Math.max( - a, Math.min( a, v ) );

export class Crowd {

	constructor( app, ferry ) {

		this.app = app;
		this.ferry = ferry;
		this.people = [];
		this.free = [];                 // idle instances { model, cast, walk }
		this.loaded = 0;
		this.seq = 0;
		this.stops = new Map();
		this.frame = 0;
		this.hub = app.people || ( app.people = new People( app ) );
		// the casting draws (take()): a fresh seed each time the crowd is made, so the faces differ from one visit to
		// the next; app.crowdSeed (tests, bug repro) replays them. Internal plumbing: nothing shows or sets it in the game
		this.castSeed = Number.isInteger( app.crowdSeed ) ? app.crowdSeed >>> 0 : freshSeed();
		this.castRandom = mulberry32( this.castSeed );
		// her seats (benches of two, per side) and her sun deck rail, as smart objects
		for ( const side of [ 1, - 1 ] ) {

			for ( const z of ROWS ) for ( const pair of BENCHES ) this.hub.objects.add( new SmartObject( { kind: 'seat', tag: side, slots: pair.map( ( x, i ) => ( { x, z, mates: [ 1 - i ] } ) ) } ) );
			this.hub.objects.add( new SmartObject( { kind: 'rail', tag: side, slots: RAILS[ side ].map( ( z, i, R ) => ( { z, mates: [ i - 1, i + 1 ].filter( j => j >= 0 && j < R.length && Math.abs( R[ j ] - z ) <= 1.6 ) } ) ) } ) );

		}

	}

	// The cast in the background: the first instance of each avatar decodes its maps, the rest share them.
	init() {

		const base = import.meta.env.BASE_URL;
		( async () => {

			for ( const cast of CAST ) {

				try {

					const gltf = await loadGLB( `${ base }models/characters/crowd/${ cast }.glb` );
					const walk = rootMotion( gltf );
					const maps = new Map();
					const bare = { ...gltf, materials: gltf.materials.map( m => ( { ...m, normalTexture: undefined, pbrMetallicRoughness: { ...m.pbrMetallicRoughness, baseColorTexture: undefined, metallicRoughnessTexture: undefined } } ) ) };
					for ( let i = 0; i < PER_CAST; i ++ ) {

						const model = await SkinnedModel.create( i ? bare : gltf, { materials: info => i ? fadeOptions( info, { textures: maps.get( info.name ) } ) : ( maps.set( info.name, info.textures ), fadeOptions( info ) ) } );
						for ( const m of model.materials ) m.underwaterLighting = 'lite';
						model.clipSet = new Set( model.clipNames() );
						this.free.push( { model, cast, walk } );

					}
					this.loaded ++;

				} catch ( e ) { console.warn( 'Crowd: failed to load', cast, e ); }

			}

		} )();

	}

	stop( t ) {

		let s = this.stops.get( t.name );
		if ( ! s ) {

			this.stops.set( t.name, s = { spawn: 0, want: 8 + Math.floor( Math.random() * 4 ), filled: false, next: 0 } );
			// the gangway gate queue: spots in pairs, side by side (a smart object; the pair chat)
			s.queue = this.hub.objects.add( new SmartObject( { kind: 'queue', tag: t, slots: Array.from( { length: QUEUE }, ( _, k ) => ( { k, mates: [ k ^ 1 ] } ) ) } ) );

		}
		return s;

	}

	// A body to make a person of. `avoid`: lists of avatars (casts) to keep away from the place they are taken for,
	// the first list that leaves a body free first (spawnFoot: everyone they could come to stand beside, then their
	// nearest neighbours).
	take( ...avoid ) {

		if ( ! this.free.length ) return null;
		// the avatar least in use, so the same face is seldom seen twice in one place, and none of `avoid` while
		// another is free: each avatar has one outfit, so before this two people side by side in the gate queue could
		// be twins. With only those avatars free, one of them (there is no other outfit to give)
		const use = c => this.people.filter( p => p.cast === c ).length;
		let pool = this.free;
		for ( const list of avoid ) { const left = this.free.filter( b => ! list.includes( b.cast ) ); if ( left.length ) { pool = left; break; } }
		const least = Math.min( ...pool.map( b => use( b.cast ) ) ), options = pool.filter( b => use( b.cast ) === least );
		const body = options[ Math.floor( this.castRandom() * options.length ) ];
		this.free.splice( this.free.indexOf( body ), 1 );
		const group = new Group();
		group.name = 'Crowd:' + body.cast;
		group.add( body.model.group );
		this.app.scene.add( group );
		return { ...body, group };

	}

	add( p ) {

		p.id = ++ this.seq; p.s = 0; onLine( p ); p.pace = rand( 1.2, 1.5 ); p.yaw = p.yaw ?? 0; p.look = 0; p.pitch = 0; p.tuck = 0; p.acc = 0;
		p.posture = 'walk'; p.head = new Vector3(); p.can = key => p.model.clipSet.has( CLIP[ key ] );
		// for bumps (src/people/Contact.js): their place before any knock, clip keys, where a step may go, how much room
		p.base = new Vector3(); p.based = false; p.clipOf = key => CLIP[ key ];
		p.canStand = ( w, base ) => this.canStand( p, w, base ); p.footing = () => this.footing( p );
		p.recoverAt = world => this.recoverAt( p, world );
		p.model.play( CLIP.idle, { fade: 0.01, from: Math.random() * p.model.clipDuration( CLIP.idle ) } );
		p.model.onClipEnd = () => { p.gesture = null; p.greeting = false; };
		this.hub.add( p );
		// something in hand: foot passengers often, drivers now and then (a coffee or the phone)
		if ( Math.random() < ( p.kind === 'foot' ? 0.55 : 0.3 ) ) this.hub.contact.give( p, p.kind === 'foot' ? undefined : pick( [ 'coffee', 'phone' ] ) );
		this.people.push( p );
		return p;

	}

	// A foot passenger for `terminal`'s gate queue: out of the hall and along the route, or in place.
	spawnFoot( terminal, placed ) {

		const queue = this.stop( terminal ).queue, k = queue.free()[ 0 ];   // the front-most free spot
		if ( k === undefined ) return;
		// not the avatar of anyone they could come to stand beside: ahead of or behind that spot in their file, and
		// anyone in the other file (the files slip against each other as the queue boards and closes up: the front-most
		// standing boards, often the same file twice, boarder, closeUp); else at least not the one beside, ahead,
		// behind or diagonally across
		const near = [], beside = [];
		for ( let j = 0; j < QUEUE; j ++ ) {

			const q = queue.slots[ j ]?.who;
			if ( ! q?.cast || j === k ) continue;
			if ( ( j & 1 ) !== ( k & 1 ) || Math.abs( j - k ) === 2 ) beside.push( q.cast );
			if ( Math.abs( ( j >> 1 ) - ( k >> 1 ) ) <= 1 ) near.push( q.cast );

		}
		const body = this.take( beside, near );
		if ( ! body ) return;
		const q = spot( k );
		const p = this.add( { ...body, kind: 'foot', terminal, spot: k, state: placed ? 'queue' : 'in', path: placed ? null : [ ...IN, ...toSpot( k ) ].map( w => [ 'T', ...w ] ), at: [ 'T', ...q ] } );
		queue.claim( k, p );
		if ( placed ) this.idle( p );

	}

	spawnDriver( car ) {

		const body = this.take();
		if ( ! body ) return;
		const side = Math.sign( car.local.x ) || 1, z = car.local.z;
		car.driverIn = false;
		const p = this.add( { ...body, kind: 'driver', car, side, terminal: car.terminal, state: 'board', aboard: true } );
		// path and out are one array, as before this file moved onto the brain (see docs/people.md, forks)
		p.path = p.out = [ ...fromCar( side, z ), ...this.place( p, side, 0.35 ) ];
		p.at = p.out[ p.out.length - 1 ];

	}

	// On her: a seat or the rail, from her port door.
	aboard( p ) { return this.place( p, 1, 0.3 ); }

	// A seat or a place at her rail on `side`, claimed from the smart objects, and the route to it.
	place( p, side, railChance ) {

		const objects = this.hub.objects, mine = o => o.tag === side;
		const s = ( Math.random() >= railChance && objects.claim( 'seat', mine, p ) ) || objects.claim( 'rail', mine, p ) || objects.claim( 'seat', mine, p );
		p.side = side;
		p.seat = s && s.x !== undefined ? [ s.x, s.z ] : null;
		return p.seat ? toSeat( side, p.seat ) : toRail( side, s ? s.z : pick( RAILS[ side ] ) );

	}

	update( dt ) {

		if ( ! this.free.length && ! this.people.length ) return;
		const t0 = performance.now();
		const ferry = this.ferry, ship = ferry.ship, service = ferry.service, app = this.app;
		const moored = ship.moored && ferry.gangway === 0 && ! ferry.castingOff;
		const boarding = moored && service.enabled && service.phase === 'loading';
		const here = ferry.at?.terminal;
		for ( const b of ferry.berths ) {

			const t = b.terminal, stop = this.stop( t );
			if ( ! stop.filled && this.free.length >= 6 ) { stop.filled = true; for ( let i = 0; i < 6; i ++ ) this.spawnFoot( t, true ); }
			const queued = this.people.filter( p => p.terminal === t && p.kind === 'foot' && ! p.aboard );
			if ( stop.filled && ! ( boarding && t === here ) && queued.length < stop.want && ( stop.spawn -= dt ) <= 0 ) { this.spawnFoot( t, false ); stop.spawn = rand( 3, 7 ); }
			this.closeUp( stop.queue );
			// boarding: the queue files over the gangway, the front pairs first
			if ( boarding && t === here && ( stop.next -= dt ) <= 0 ) {

				const p = this.boarder( queued );
				if ( p ) {

					const q = spot( p.spot );
					p.state = 'board'; p.aboard = true; p.from = t; p.s = 0; onLine( p ); p.pair = null;
				this.hub.objects.release( p );
					p.out = [ ...GANGWAY.slice( 3 ), ...this.aboard( p ) ];
					p.path = [ [ 'T', ...q ], ...GANGWAY, ...p.out.slice( 2 ) ];
					p.at = p.path[ p.path.length - 1 ];
					stop.next = rand( 0.7, 1.4 );

				}

			}

		}

		// drivers out of the cars parked aboard at this berth; back to them before the far berth
		const traffic = ferry.traffic;
		for ( const car of traffic?.cars || [] ) if ( car.state === 'parked' && car.driverIn && car.from === here && ! car.driven && moored ) { car.driven = true; this.spawnDriver( car ); }
		// drivers go back down once she is swinging for the far berth (or lies at it)
		const bound = service.phase === 'sailing' && [ 'swing', 'back', 'fill' ].includes( service.pilot.leg ) ? service.next.terminal : ship.moored ? here : null;
		for ( const p of this.people ) {

			if ( p.state === 'seated' || p.state === 'stand' ) {

				const back = p.kind === 'driver' ? !! bound && bound !== p.car.from : moored && here && here !== p.from && service.phase === 'loading';
				if ( back ) {

					p.state = 'leave'; p.s = 0; onLine( p ); p.seat = null;
					this.hub.objects.release( p );
					p.path = [ ...p.out ].reverse();
					if ( p.kind === 'foot' ) p.path.push( ...OFF() );
					p.terminal = here || p.terminal;
					p.model.play( CLIP.walk, { fade: 0.3 } );

				}

			}

		}

		this.frame ++;
		// whoever is down on the ground (Contact.js): walkers wait rather than walk through them
		this.fallen = this.people.filter( q => q.knock && ( q.knock.kind === 'fall' || q.knock.kind === 'dive' ) && q.world );
		const cam = app.camera.position, dir = app.camera.getWorldDirection( _d );
		for ( const p of this.people ) this.step( p, dt, cam, dir );
		for ( const p of this.people.filter( p => p.state === 'gone' ) ) {

			if ( p.car ) p.car.driverIn = true;
			this.hub.remove( p );
			this.app.scene.remove( p.group );
			p.group.remove( p.model.group );
			p.model.hold();
			this.free.push( { model: p.model, cast: p.cast, walk: p.walk } );

		}
		this.people = this.people.filter( p => p.state !== 'gone' );
		this.hub.charge( performance.now() - t0 );

	}

	// The gate queue closes up as its front pair boards: front to back, whoever is next in their file behind a free
	// place moves up into it (a 0.7 m walk forward); someone still on their way to a place has their claim moved up
	// with the queue (the last leg of their way runs up their own file, toSpot(), so it only lengthens). Before this
	// the queue kept its gaps: the places nearest the gate emptied and new arrivals walked up past the people waiting.
	closeUp( queue ) {

		for ( let k = 2; k < QUEUE; k ++ ) {

			const p = queue.slots[ k ].who;
			if ( ! p || queue.slots[ k - 2 ].who || p.knock || ( p.state !== 'queue' && p.state !== 'in' ) ) continue;
			queue.claim( k - 2, p );
			p.spot = k - 2;
			const to = [ 'T', ...spot( k - 2 ) ];
			if ( p.path ) p.path[ p.path.length - 1 ] = to;
			else { p.path = [ [ 'T', ...spot( k ) ], to ]; p.s = 0; onLine( p ); }
			p.at = to;

		}

	}

	// The next to board: the front-most foot passenger standing in their place. Someone still walking up to a place
	// the queue closed up to waits until they stand in it, because the way over the gangway starts from that place:
	// boarding them on the way would jump them up the file in one frame.
	boarder( queued ) {

		let next = null;
		for ( const p of queued ) if ( p.state === 'queue' && ! p.path && ( ! next || p.spot < next.spot ) ) next = p;
		return next;

	}

	world( p, w, out ) { if ( w[ 0 ] === 'W' ) return out.set( w[ 1 ], w[ 2 ], w[ 3 ] ); return w[ 0 ] === 'S' ? this.ferry.ship.toWorld( _w.set( w[ 1 ], w[ 2 ], w[ 3 ] ), out ) : p.terminal.toWorld( [ w[ 1 ], w[ 2 ], w[ 3 ] ], out ); }

	gangwayConnected( p ) {

		const f = this.ferry;
		if ( ! f.ship.moored || f.castingOff || f.gangway !== 0 || f.at?.terminal !== p.terminal ) return false;
		// Mooring state alone is insufficient after hull displacement in a flood.
		const a = this.world( p, GANGWAY[ 2 ], new Vector3() ), b = this.world( p, GANGWAY[ 3 ], new Vector3() );
		return Math.hypot( a.x - b.x, a.z - b.z ) < 4 && Math.abs( a.y - b.y ) < 0.45;

	}

	recoverAt( p, world ) {

		const deck = this.ferry.deck, local = this.ferry.ship.toLocal( world, new Vector3() );
		const aboard = !! deck?.supportAt( world, { maxRise: 0.2, maxDrop: 0.25 } );
		const oldPath = p.path;
		p.path = null; p.s = 0; onLine( p ); p.world.copy( world ); p.base.copy( world ); p.off?.set( 0, 0, 0 );
		p.local = aboard ? local : null; p.aboard = aboard;
		p.at = aboard ? [ 'S', ...local.toArray() ] : [ 'W', ...world.toArray() ];
		p.state = aboard ? 'stand' : 'displaced';
		// A displaced passenger never reconnects to an obsolete mixed-frame path.
		// A wholly onboard route can be resumed from the physically reached place.
		if ( aboard && oldPath?.length && oldPath.every( point => point[ 0 ] === 'S' ) ) p.path = [ p.at.slice(), ...oldPath.slice( 1 ) ];

	}

	step( p, dt, cam, dir ) {

		const ship = this.ferry.ship, m = p.model, b = p.brain, t = this.hub.t, knocked = !! p.knock;
		if ( p.based ) p.world.copy( p.base );   // their place, without last frame's knock offset
		p.walkV = 0; p.room = false;              // m/s this frame and stepped through the room: set by it while they walk (others read both, Room.js)
		// the brain's gesture: a one-shot clip (walkers pause for it); seated, none that would stand them up; none while knocked;
		// on their way, never a greeting (Brain.sense greets a walker with a look and a word: one asked for the frame
		// before they set off is not played, and one still playing when they set off, boarding or moving up the queue
		// or leaving, ends there), so a conversation never stands a passenger still on the walkway or the gangway
		if ( b.gesture && ! p.gesture && ! knocked ) {

			const clip = p.state === 'seated' || ( p.path && b.gesture.greet ) ? null : CLIP[ b.gesture.clip ];
			if ( clip && m.clipSet.has( clip ) ) { m.play( clip, { fade: 0.35, loop: false } ); p.gesture = clip; p.greeting = !! b.gesture.greet; if ( b.gesture.greet ) p.greeted = clip; }
			b.gesture = null;

		}
		if ( p.path && p.gesture && p.greeting ) { p.gesture = null; p.greeting = false; }
		const standing = p.state === 'queue' || p.state === 'stand' || ( knocked && p.state !== 'seated' );
		// walking: along the path, pausing for a gesture (a path of one point is already there)
		if ( p.path && p.path.length < 2 ) this.arrive( p );
		if ( p.path && ! p.gesture && ! knocked ) {

			const P = p.path;
			let a = this.world( p, P[ 0 ], _a ), b = this.world( p, P[ 1 ], _b ), seg = a.distanceTo( b );
			const hx = Math.sin( p.heading ?? 0 ), hz = Math.cos( p.heading ?? 0 );
			let wait = this.fallen.length > 0 && !! p.world && this.fallen.some( q => q !== p && q.world.distanceToSquared( p.world ) < 1.2 && ( q.world.x - p.world.x ) * hx + ( q.world.z - p.world.z ) * hz > 0 );
			if ( P[ 0 ][ 0 ] !== P[ 1 ][ 0 ] && ! this.gangwayConnected( p ) ) {
				wait = true;
				if ( p.s > 0 && ! this.hub.contact.boards( p.world, p.base ) && ! this.ferry.deck?.supportAt( p.world ) ) this.hub.contact.environment?.( p );
			}
			// the kerb (atKerb): a car coming through their next step, and them outside the band it stops for
			if ( ! wait && p.world && atKerb( this.ferry.traffic, p.world, b.x - a.x, b.z - a.z ) ) wait = true;
			// room between people (src/people/Room.js): the pace they may walk among the others and their side step
			if ( ! wait ) {

				const lx = b.x - a.x, lz = b.z - a.z, l = Math.hypot( lx, lz );
				// (a walker just out of the hall has no place yet on its first frame: the lerp below gives it one)
				if ( l > 0.05 && p.world ) room( this.hub, p, lx / l, lz / l, ( seg - p.s ) * l / seg, b.x, b.z, P.length === 2, dt, this );
				// a leg too short to steer along (or no place yet): to its end at most, so the next leg's room check
				// sees the rest of the step (else a slow frame carries up to 0.15 m onto it unchecked, into the player)
				else p.walkV = Math.min( p.pace, Math.max( 0, seg - p.s ) / Math.max( dt, 1e-6 ) );
				p.s += p.walkV * dt;

			}
			while ( ! wait && p.path && p.s >= seg ) {

				// a side step in hand at a corner or the route's end: wait there until back on the line (Room.js), so the
				// turn never carries it onto the next leg's normal and an arrival never jumps sideways onto its place
				if ( Math.abs( p.lat || 0 ) > LINE ) { p.s = seg; break; }
				p.s -= seg;
				P.shift();
				if ( P.length < 2 ) this.arrive( p );
				else {
					a = this.world( p, P[ 0 ], a ); b = this.world( p, P[ 1 ], b ); seg = a.distanceTo( b );
					if ( P[ 0 ][ 0 ] !== P[ 1 ][ 0 ] && ! this.gangwayConnected( p ) ) { p.s = 0; wait = true; }
				}

			}
			if ( p.path ) {

				const f = seg > 1e-4 ? Math.min( 1, p.s / seg ) : 1;
				// A disconnected bridge cannot drag an in-progress passenger through
				// open water as its remote endpoint moves away.
				if ( ! wait || P[ 0 ][ 0 ] === P[ 1 ][ 0 ] ) {

					p.world = ( p.world || new Vector3() ).copy( a ).lerp( b, f );
					// their side step off the route's line (Room.js), along the leg's left normal
					const lx = b.x - a.x, lz = b.z - a.z, l = Math.hypot( lx, lz );
					if ( p.lat && l > 0.05 ) { p.world.x += lz / l * p.lat; p.world.z -= lx / l * p.lat; }

				}
				if ( seg > 0.05 && Math.hypot( b.x - a.x, b.z - a.z ) > 0.05 ) p.heading = Math.atan2( b.x - a.x, b.z - a.z );
				p.local = P[ 0 ][ 0 ] === 'S' && P[ 1 ][ 0 ] === 'S' ? ship.toLocal( p.world, p.local || new Vector3() ) : null;
				if ( wait ) { if ( m.current !== CLIP.idle ) m.play( CLIP.idle, { fade: 0.3 } ); }
				else if ( m.current !== CLIP.walk ) m.play( CLIP.walk, { fade: 0.3, speed: Math.min( 1.6, Math.max( 0.6, p.pace / p.walk ) ) } );

			}

		} else if ( knocked && p.local ) {

			ship.toWorld( p.local, p.world );

		} else if ( ! p.path ) {

			// in place: at a queue spot (terminal frame) or aboard (hers)
			p.local = p.at[ 0 ] === 'S' ? _v.set( p.at[ 1 ], p.at[ 2 ], p.at[ 3 ] ).clone() : null;
			p.world = this.world( p, p.at, p.world || new Vector3() );

		}
		if ( ! p.world ) p.world = this.world( p, p.path ? p.path[ 0 ] : p.at, new Vector3() );
		// a knock (Contact.js): the offset from their place, the clips, the pose layer; the route waits
		p.base.copy( p.world ); p.based = true;
		const K = this.hub.contact.body( p, dt );
		if ( ! p.path && ! p.gesture && ! p.knock && ! K?.walk ) this.idle( p, dt );
		p.posture = ( p.path && ! p.gesture && ! p.knock ) || K?.walk ? 'walk' : p.state === 'seated' ? 'sit' : 'stand';
		// facing: the way they walk, their spot's way (a partner's or the rail's), turned to what the brain looks at
		const frameYaw = p.local || ( p.path ? false : p.at[ 0 ] === 'S' ) ? ship.yaw : p.terminal.yaw;
		let want = p.path && ! p.gesture ? p.heading ?? frameYaw : frameYaw + ( p.face || 0 );
		const target = b.target && t < b.lookUntil ? b.target : null;
		let look = 0, pitch = p.path ? 0 : b.activity?.pitch || 0;
		if ( target || p.gesture ) {

			let to = p.toward ?? want;
			if ( target ) {

				const dx = target.x - p.world.x, dz = target.z - p.world.z;
				p.toward = to = Math.atan2( dx, dz );
				pitch = clamp( Math.atan2( p.world.y + ( p.state === 'seated' ? 1.2 : 1.6 ) - target.y, Math.hypot( dx, dz ) || 1 ), 0.6 );

			}
			if ( ( standing && ( ! target || t < b.engagedUntil ) ) || ( p.path && p.gesture ) ) want = to;
			look = clamp( wrap( to - p.yaw ), 1.1 );

		}
		if ( K ) { if ( K.lockYaw ) want = p.yaw; else if ( K.face !== null ) want = K.face; }
		const k = 1 - Math.exp( - dt * 4 );
		p.yaw += wrap( want - p.yaw ) * ( 1 - Math.exp( - dt * 5 ) );
		p.look += ( look - p.look ) * k;
		p.pitch += ( pitch - p.pitch ) * k;
		p.tuck += ( ( p.state === 'seated' ? b.tuck : 0 ) - p.tuck ) * ( 1 - Math.exp( - dt * 6 ) );
		p.group.position.copy( p.world );
		if ( K?.drop ) p.group.position.y -= K.drop;
		p.group.rotation.y = p.yaw;
		// knocked flat (Contact.js tumble): the ragdoll draws the model in the world, so the group sits at the origin
		if ( K?.rag ) { p.group.position.set( 0, 0, 0 ); p.group.rotation.y = 0; p.group.visible = true; p.acc = 0; this.hub.contact.rag( p, dt ); return; }
		p.head.copy( p.world ).y += p.state === 'seated' ? 1.2 : 1.6 - ( K?.drop ? 1.65 * K.drop : 0 );   // sat on the ground: the head about 0.9 m up
		// detail by distance (the hub's p.lod): near every frame, mid a third of the frames, far frozen; hidden past 90 m
		const d2 = p.world.distanceToSquared( cam );
		p.group.visible = d2 < 90 * 90;
		p.acc += dt;
		if ( ! p.group.visible ) { p.acc = 0; return; }   // SkinnedModel.settle() holds the pose on draw
		if ( p.lod === 'far' ) { p.acc = 0; return; }
		// behind the camera (their shadows can still show), a third of the frames too
		const ahead = ( p.world.x - cam.x ) * dir.x + ( p.world.y - cam.y ) * dir.y + ( p.world.z - cam.z ) * dir.z;
		if ( ( p.lod === 'mid' || ahead < - 2 ) && ( this.frame + p.id ) % 3 ) return;
		m.update( p.acc );
		p.acc = 0;
		pose( m, p.look, p.pitch, p.tuck, b.away, K );
		if ( p.item ) this.hub.contact.hand( p );

	}

	// For Room.js: may p's body stand at ( x, z ), a side step off their route? As for a knock's step (canStand),
	// from where they are.
	clear( p, x, z ) { return this.canStand( p, _s.set( x, p.world.y, z ), p.world ); }

	// Walkable, for a knock's step (Contact.js): aboard, never out past her rail; ashore, the planks under
	// them (the pier, the terminal), never through a rail or off an edge.
	canStand( p, w, base ) {

		const ship = this.ferry.ship;
		if ( p.local || ( ! p.path && p.at[ 0 ] === 'S' ) ) {

			const deck = this.ferry.deck, q = ship.toLocal( w, _c );
			if ( ! deck ) return false;
			const g = deck.groundAt( q.x, q.z, q.y + 0.45 );
			if ( ! Number.isFinite( g ) || Math.abs( q.y - g ) > 0.45 ) return false;
			for ( const box of deck.boxes ) {
				if ( ! box.solid || box.center.y + box.half.y <= q.y + 0.45 || box.center.y - box.half.y >= q.y + 1.7 ) continue;
				if ( Math.abs( q.x - box.center.x ) < box.half.x + 0.27 && Math.abs( q.z - box.center.z ) < box.half.z + 0.27 ) return false;
			}
			return true;

		}
		return this.hub.contact.boards( w, base );

	}

	// Room to go over: seated, narrow (the gate queue, over the gangway, her rail: a stagger at most) or open.
	footing( p ) {

		if ( p.state === 'seated' ) return 'seat';
		if ( p.state === 'queue' || p.state === 'stand' ) return 'narrow';
		if ( p.path && p.path.some( w => w[ 0 ] === 'T' ) && p.path.some( w => w[ 0 ] === 'S' ) ) return 'narrow';
		return 'open';

	}

	// What someone standing or sitting does: the clip of their brain's activity (sitting ones while
	// seated, standing ones otherwise, the plain idle where an avatar lacks the clip); the pairs at
	// the gate half turn to each other, at the rail they face out.
	idle( p, dt = 0 ) {

		const m = p.model, a = p.brain.activity;
		const use = key => { let clip = CLIP[ key ]; if ( ! m.clipSet.has( clip ) ) clip = CLIP[ SITTING.has( key ) ? 'sit' : 'idle' ]; if ( m.current !== clip && ! p.gesture ) m.play( clip, { fade: 0.6, from: key === 'sit' ? Math.random() * 10 : 0 } ); };
		if ( p.seat && p.at[ 0 ] === 'S' ) { p.state = 'seated'; p.face = 0; p.posture = 'sit'; use( a && SITTING.has( a.clip ) ? a.clip : 'sit' ); return; }
		if ( p.state === 'queue' ) {

			const mate = this.hub.objects.mateOf( p );
			p.face = mate?.state === 'queue' ? ( p.spot % 2 ? - 0.9 : 0.9 ) : 0;

		} else if ( p.at[ 0 ] === 'S' ) {

			p.state = 'stand';
			p.face = Math.sign( p.at[ 1 ] ) * Math.PI / 2;

		} else return;
		use( a && ! SITTING.has( a.clip ) ? a.clip : 'idle' );

	}

	arrive( p ) {

		p.path = null; p.s = 0; p.chat = 0; onLine( p );
		if ( p.state === 'in' ) p.state = 'queue';
		else if ( p.state === 'leave' ) { if ( p.kind === 'driver' ) p.car.driverIn = true; p.state = 'gone'; }
		else if ( p.state === 'board' ) p.state = p.seat ? 'seated' : 'stand';
		if ( p.state !== 'gone' ) this.idle( p );

	}

	// Hold her while foot passengers are crossing the gangway (either way).
	holding() {

		return this.people.some( p => ( p.state === 'board' || p.state === 'leave' ) && p.kind === 'foot' && p.path && p.path.some( w => w[ 0 ] === 'T' ) && p.path.some( w => w[ 0 ] === 'S' ) );

	}

	// Read-only: everyone, what they are doing and where (aboard: in her frame).
	state() {

		const ship = this.ferry.ship;
		return {
			loaded: this.loaded,
			people: this.people.map( p => {

				const l = ship.toLocal( p.world || p.group.position, new Vector3() );
				return { id: p.id, cast: p.cast, kind: p.kind, state: p.state, terminal: p.terminal.name, aboard: !! p.aboard && !! ( p.local || ( ! p.path && p.at[ 0 ] === 'S' ) ),
					clip: p.model.current, greeted: p.greeted || null, look: + p.look.toFixed( 2 ), pitch: + p.pitch.toFixed( 2 ), tuck: + p.tuck.toFixed( 2 ), yaw: + p.yaw.toFixed( 3 ),
					lod: p.lod, posture: p.posture, knock: p.knock?.kind || null, item: p.item ? p.item.kind + ':' + p.item.state : null, off: p.off ? + p.off.length().toFixed( 2 ) : 0, slot: p.slot ? p.slot.obj.kind + ':' + p.slot.i : null, brain: p.brain.state(),
					world: [ p.world?.x, p.world?.y, p.world?.z ].map( v => + ( v ?? 0 ).toFixed( 2 ) ), local: [ l.x, l.y, l.z ].map( v => + v.toFixed( 2 ) ) };

			} ),
		};

	}

}

// The walk comes with its root motion (the Rocketbox static set has no walks): the pelvis's travel
// over the cycle is taken out, so they walk on the spot, and its pace (m/s at speed 1) is returned.
export function rootMotion( gltf ) {

	const pelvis = gltf.nodes.findIndex( n => n.name === 'Bip01 Pelvis' );
	const clip = gltf.animations.find( a => a.name === CLIP.walk );
	const ch = clip?.channels.find( c => c.node === pelvis && c.path === 'translation' );
	if ( ! ch ) return 1.3;
	const T = ch.times, V = ch.values, n = T.length, t0 = T[ 0 ], span = T[ n - 1 ] - t0 || 1;
	const d = [ 0, 1, 2 ].map( c => V[ ( n - 1 ) * 3 + c ] - V[ c ] );
	for ( let i = 0; i < n; i ++ ) for ( let c = 0; c < 3; c ++ ) V[ i * 3 + c ] -= d[ c ] * ( T[ i ] - t0 ) / span;
	// the pelvis's parent's scale (the armature's units) to metres
	let s = 1;
	for ( let i = gltf.nodes.findIndex( x => x.children?.includes( pelvis ) ); i >= 0; i = gltf.nodes.findIndex( x => x.children?.includes( i ) ) ) s *= gltf.nodes[ i ].s[ 0 ];
	return Math.hypot( ...d ) * s / span;

}
