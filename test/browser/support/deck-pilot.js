
// The car in her frame, its speed (km/h, unsigned), heading, uprightness and the game clock.
export const carInHerFrame = page => page.evaluate( () => {

	const app = window.__app, s = app.rally.state, ship = app.ferry.ship, V = app.camera.position.constructor;
	const at = new V( s[ 0 ], s[ 1 ], s[ 2 ] ), p = ship.toLocal( at, new V() ), q = new ship.quaternion.constructor( s[ 3 ], s[ 4 ], s[ 5 ], s[ 6 ] );
	const nose = ship.toLocal( at.clone().add( new V( 0, 0, 1 ).applyQuaternion( q ) ), new V() ).sub( p );
	return { x: p.x, y: p.y, z: p.z, kmh: Math.abs( s[ 7 ] ), heading: Math.atan2( nose.x, nose.z ), up: new V( 0, 1, 0 ).applyQuaternion( q ).y, world: { x: s[ 0 ], y: s[ 1 ], z: s[ 2 ] }, t: app.ferry.service.time, down: [ ...( window.__hands?.down.keys() ?? [] ) ] };

} );

// From the car's own lane, merging onto her centreline well astern of the linkspan (the lanes end
// at her z -58; a car starts at terminal x -5.85 beside the queue lanes, Terminal.js queueSpot), then
// up her centreline over the linkspan and her ramp onto her deck.
export const ONTO_HER_DECK = car => [ ...( car.z < - 80 ? [ [ car.x, car.z ] ] : [] ), [ 0, - 75 ], [ 0, - 58 ], [ 0, - 12 ], [ 0, 40 ] ];
// Straight back down her centreline, off her stern and up the linkspan.
export const OFF_HER_STERN = [ [ 0, 40 ], [ 0, - 58 ], [ 0, - 90 ] ];

const LOOK = 12; // m: pursuit look-ahead along her z, about two and a half car lengths
const DEAD = 0.04; // rad: heading deadband, so the wheel rests on a straight run
const GAIN = 0.35; // s of lock per rad of error: a full-lock pulse turns the car about 0.6 rad/s at 10 km/h
const PULSE = [ 0.03, 0.15 ]; // s game time: at least one frame at 20 fps, never long enough to swing her
const DAMP = 0.3; // s: heading-rate damping, so a late read that finds the nose already swinging holds off
const wrap = a => Math.atan2( Math.sin( a ), Math.cos( a ) );

// x on the path at her z, linear between points (the path runs one way along z).
function pathX( path, z ) {

	const p = [ ...path ].sort( ( a, b ) => a[ 1 ] - b[ 1 ] );
	if ( z <= p[ 0 ][ 1 ] ) return p[ 0 ][ 0 ];
	for ( let i = 1; i < p.length; i ++ ) if ( z <= p[ i ][ 1 ] ) return p[ i - 1 ][ 0 ] + ( p[ i ][ 0 ] - p[ i - 1 ][ 0 ] ) * ( z - p[ i - 1 ][ 1 ] ) / ( p[ i ][ 1 ] - p[ i - 1 ][ 1 ] );
	return p[ p.length - 1 ][ 0 ];

}

// What is round the car: other people's cars within 12 m in her frame, and any wheel the car has lost.
const nearby = page => page.evaluate( () => {

	const app = window.__app, ship = app.ferry.ship, s = app.rally.state, V = app.camera.position.constructor;
	const me = ship.toLocal( new V( s[ 0 ], s[ 1 ], s[ 2 ] ), new V() ), out = [];
	for ( const c of app.ferry.traffic?.cars || [] ) {

		const p = c.group ? ship.toLocal( c.group.position.clone(), new V() ) : null;
		if ( p && Math.hypot( p.x - me.x, p.z - me.z ) < 12 ) out.push( `${ c.state } at her (${ p.x.toFixed( 1 ) }, ${ p.z.toFixed( 1 ) })` );

	}
	return `${ out.join( '; ' ) || 'no traffic car' }; wheels lost ${ app.rally.damage?.lost ?? '?' }`;

} );

const record = page => page.evaluate( () => {

	if ( window.__frames ) return;
	const app = window.__app, V = app.camera.position.constructor, ship = app.ferry.ship, physics = app.rally.physics;
	const frames = window.__frames = [], calls = window.__calls = [], keys = new Set();
	addEventListener( 'keydown', e => keys.add( e.key ), true );
	addEventListener( 'keyup', e => keys.delete( e.key ), true );
	for ( let o = Object.getPrototypeOf( physics ); o && o !== Object.prototype; o = Object.getPrototypeOf( o ) ) for ( const name of Object.getOwnPropertyNames( o ) ) {

		const f = Object.getOwnPropertyDescriptor( o, name ).value;
		if ( name === 'constructor' || typeof f !== 'function' || Object.hasOwn( physics, name ) ) continue;
		physics[ name ] = function ( ...a ) {

			calls.push( { t: app.ferry.service.time, name, a: typeof a[ 0 ] === 'number' ? a[ 0 ] : '' } );
			if ( calls.length > 40_000 ) calls.splice( 0, 20_000 );
			return f.apply( this, a );

		};

	}
	const tick = () => {

		const s = app.rally.state, at = new V( s[ 0 ], s[ 1 ], s[ 2 ] ), p = ship.toLocal( at.clone(), new V() ), q = new ship.quaternion.constructor( s[ 3 ], s[ 4 ], s[ 5 ], s[ 6 ] );
		const nose = ship.toLocal( at.clone().add( new V( 0, 0, 1 ).applyQuaternion( q ) ), new V() ).sub( p ), near = [];
		for ( const c of app.ferry.traffic?.cars || [] ) {

			const r = c.group && ship.toLocal( c.group.position.clone(), new V() );
			if ( r && Math.hypot( r.x - p.x, r.z - p.z ) < 8 ) near.push( `${ c.state }#${ c.id }(${ r.x.toFixed( 2 ) },${ r.z.toFixed( 2 ) } v ${ ( c.v ?? 0 ).toFixed( 2 ) })` );

		}
		frames.push( { t: app.ferry.service.time, x: p.x, y: p.y, z: p.z, h: Math.atan2( nose.x, nose.z ), v: s[ 7 ], keys: [ ...keys ].join( '' ), near: near.join( ' ' ) } );
		if ( frames.length > 8_000 ) frames.splice( 0, 4_000 );
		requestAnimationFrame( tick );

	};
	requestAnimationFrame( tick );

} );

// The recorder between game times `from` and `to`: frames where anything moved (plus every 15th), and
// the car-physics calls rarer than one a frame (platforms, statics, remotes added or dropped).
const replay = ( page, from, to ) => page.evaluate( ( [ from, to ] ) => {

	const f = window.__frames.filter( r => r.t >= from && r.t <= to ), c = window.__calls.filter( r => r.t >= from && r.t <= to ), n = {};
	for ( const r of c ) n[ r.name ] = ( n[ r.name ] || 0 ) + 1;
	const out = [ `  ${ f.length } frames, calls ${ Object.entries( n ).map( ( [ k, v ] ) => `${ k } ${ v }` ).join( ', ' ) }` ];
	f.forEach( ( r, i ) => {

		const p = f[ i - 1 ];
		if ( p && i % 15 && Math.abs( r.h - p.h ) < 0.01 && Math.abs( r.v - p.v ) < 0.5 && Math.hypot( r.x - p.x, r.z - p.z ) < 0.15 && r.keys === p.keys && r.near === p.near ) return;
		out.push( `  f ${ r.t.toFixed( 3 ) } dt ${ p ? ( r.t - p.t ).toFixed( 3 ) : '-' } x ${ r.x.toFixed( 2 ) } y ${ r.y.toFixed( 2 ) } z ${ r.z.toFixed( 2 ) } hdg ${ r.h.toFixed( 3 ) } v ${ r.v.toFixed( 2 ) } keys [${ r.keys }] ${ r.near }` );

	} );
	for ( const r of c ) if ( n[ r.name ] < f.length / 2 ) out.push( `  call ${ r.t.toFixed( 3 ) } ${ r.name }(${ r.a })` );
	return out.join( '\n' );

}, [ from, to ] );

const hands = page => page.evaluate( () => {

	if ( window.__hands ) return;
	const app = window.__app, armed = new Map(), down = new Map(), log = [], now = () => app.ferry.service.time;
	window.__hands = { armed, down, log };
	addEventListener( 'keydown', e => {

		if ( e.repeat || ! armed.has( e.code ) ) return;
		const a = armed.get( e.code );
		armed.delete( e.code );
		a.t0 = now();
		if ( a.seconds != null ) a.until = a.t0 + a.seconds;
		down.set( e.code, a );

	}, true );
	addEventListener( 'keyup', e => {

		const a = down.get( e.code );
		if ( ! a ) return;
		down.delete( e.code );
		log.push( { key: e.key, seconds: a.seconds ?? null, held: now() - a.t0, by: e.isTrusted ? 'test' : a.by } );

	}, true );
	let last = now(), dt = 0;
	const tick = () => {

		// the game's frame step is about one frame: let go when the next step would land nearer past the
		// asked time than this one stands short of it
		const t = now(), kmh = Math.abs( app.rally.state[ 7 ] );
		if ( t > last ) dt = t - last;
		last = t;
		for ( const [ code, a ] of down ) {

			const by = a.until != null && t + dt / 2 >= a.until ? 'time' : ( a.above != null && kmh > a.above ) || ( a.below != null && kmh < a.below ) ? 'speed' : null;
			if ( ! by ) continue;
			a.by = by;
			( document.activeElement || document.body ).dispatchEvent( new KeyboardEvent( 'keyup', { key: a.key, code, bubbles: true, cancelable: true } ) );

		}
		requestAnimationFrame( tick );

	};
	requestAnimationFrame( tick );

} );
const codeOf = key => `Key${ key.toUpperCase() }`;
// Tells the page what to let go at: { seconds } of game time from the keydown, or a speed { above } or
// { below } km/h; {} holds until the test lets go.
const arm = ( page, key, limit ) => page.evaluate( ( [ code, a ] ) => window.__hands.armed.set( code, a ), [ codeOf( key ), { key, ...limit } ] );

// Holds `key` down for `seconds` of game time, then lets go (the page lets go; the test's keyup after
// it only squares Playwright's own key state, and the game ignores a keyup for a key already up).
async function pulse( page, key, seconds ) {

	await arm( page, key, { seconds } );
	await page.keyboard.down( key );
	await page.waitForFunction( code => ! window.__hands.down.has( code ), codeOf( key ), { polling: 'raf', timeout: 5_000 } ).catch( () => {} );
	await page.keyboard.up( key );

}

// Drives along `path` (her frame) ahead, or astern with `astern`, feathering W/S to `kmh`, until
// `until( car )` or `budget` s of game time. `throttle: false` coasts (brakes only if over `kmh` + 5).
// `recover: false` leaves a stalled car where it stopped (a scenario that expects a barrier to stop it);
// otherwise a car stalled for 3 s of game time backs a car length on the opposite lock and carries on.
export async function pilot( page, { path, until, astern = false, kmh = 10, throttle = true, recover = true, budget = 90, label = 'pilot' } ) {

	const go = astern ? 's' : 'w', brake = astern ? 'w' : 's';
	// W and S are let go by the page at the speed they were pressed for, so a slow read cannot carry the
	// car past it; the next read presses again if the car has dropped back under it.
	const held = new Set(), hold = async ( key, on, limit = {} ) => {

		if ( on && held.has( key ) && ! car.down?.includes( codeOf( key ) ) ) { await page.keyboard.up( key ); held.delete( key ); }
		if ( on && ! held.has( key ) ) { await arm( page, key, limit ); await page.keyboard.down( key ); held.add( key ); }
		if ( ! on && held.has( key ) ) { await page.keyboard.up( key ); held.delete( key ); }

	};
	await record( page );
	await hands( page );
	await page.evaluate( () => window.__hands.log.splice( 0 ) );
	let car = await carInHerFrame( page ), last = car, anchor = car;
	if ( typeof path === 'function' ) path = path( car );
	const t0 = car.t, wall = Date.now(), track = [], early = [];
	let recoveries = 0, swung = false;
	while ( ! until( car ) && car.t - t0 < budget && Date.now() - wall < budget * 8_000 ) {

		// aim: the point LOOK m along the path from the car, nose-first ahead, tail-first astern
		const tz = car.z + ( astern ? - LOOK : LOOK ), tx = pathX( path, tz );
		const toAim = Math.atan2( tx - car.x, tz - car.z );
		const want = astern ? wrap( toAim + Math.PI ) : toAim;
		const dt = Math.max( car.t - last.t, 1e-3 ), rate = wrap( car.heading - last.heading ) / dt;
		const err = wrap( want - car.heading ) - ( car.t > last.t ? DAMP * rate : 0 );
		// ahead, A swings the nose to port (+heading); astern the same key swings it the other way
		const key = Math.abs( err ) < DEAD ? null : ( err > 0 ) !== astern ? 'a' : 'd';
		const ms = key ? Math.min( PULSE[ 1 ], Math.max( PULSE[ 0 ], GAIN * Math.abs( err ) ) ) : 0;

		await hold( go, throttle && car.kmh < kmh, { above: kmh } );
		await hold( brake, car.kmh > kmh + 5, { below: kmh + 2 } );
		// stalled: under power but less than 0.3 m of progress in 3 s of game time (a speed read alone
		// can show a wheel spinning against a lip as motion)
		if ( ! held.has( go ) || Math.hypot( car.x - anchor.x, car.z - anchor.z ) > 0.3 ) anchor = car;
		if ( recover && car.t - anchor.t > 3 ) {

			// stalled against something: back a car length on the opposite lock, then carry on
			await hold( go, false );
			await hold( brake, true );
			await pulse( page, err > 0 ? 'd' : 'a', 1.5 );
			await hold( brake, false );
			recoveries ++;
			console.log( `${ label } stalled at her z ${ car.z.toFixed( 2 ) }, x ${ car.x.toFixed( 2 ) }, y ${ car.y.toFixed( 2 ) }, heading ${ car.heading.toFixed( 3 ) }: recovery ${ recoveries }` );
			// what it stalled against: other people's cars within 12 m in her frame, and any wheel the car has lost
			console.log( '  near: ' + await nearby( page ) );
		console.log( `${ label } frames before the stall:\n${ await replay( page, car.t - 4, car.t ) }` );
			anchor = await carInHerFrame( page );

		} else if ( key ) await pulse( page, key, ms );
		else await page.waitForTimeout( 30 );
		if ( car.t - t0 < 3 ) early.push( `t ${ ( car.t - t0 ).toFixed( 2 ) } x ${ car.x.toFixed( 2 ) } z ${ car.z.toFixed( 1 ) } hdg ${ car.heading.toFixed( 3 ) } want ${ want.toFixed( 3 ) } ${ car.kmh.toFixed( 1 ) } km/h ${ key || '-' } ${ ( ms * 1000 ).toFixed( 0 ) } ms` );
		last = car;
		car = await carInHerFrame( page );
		track.push( car );
		const aim = Math.atan2( pathX( path, car.z + ( astern ? - LOOK : LOOK ) ) - car.x, astern ? - LOOK : LOOK );
		if ( ! swung && Math.abs( wrap( ( astern ? wrap( aim + Math.PI ) : aim ) - car.heading ) ) > 0.7 ) {

			swung = true;
			console.log( `${ label } swung ${ wrap( ( astern ? wrap( aim + Math.PI ) : aim ) - car.heading ).toFixed( 2 ) } rad off its aim at her z ${ car.z.toFixed( 2 ) }, x ${ car.x.toFixed( 2 ) }; last reads:\n  ${ track.slice( - 6 ).map( c => `t ${ ( c.t - t0 ).toFixed( 2 ) } x ${ c.x.toFixed( 2 ) } y ${ c.y.toFixed( 2 ) } z ${ c.z.toFixed( 2 ) } hdg ${ c.heading.toFixed( 3 ) } ${ c.kmh.toFixed( 1 ) } km/h` ).join( '\n  ' ) }\n  near: ${ await nearby( page ) }` );
			console.log( `${ label } frames round the swing:\n${ await replay( page, car.t - 6, car.t ) }` );

		}

	}
	for ( const key of [ ...held ] ) await hold( key, false );
	const keys = await page.evaluate( () => window.__hands.log.splice( 0 ) ), most = ( list, f ) => list.reduce( ( m, k ) => f( k ) > f( m ) ? k : m, list[ 0 ] );
	const steer = keys.filter( k => k.seconds != null && k.seconds <= PULSE[ 1 ] ), backs = keys.filter( k => k.seconds > PULSE[ 1 ] ), pedal = keys.filter( k => k.seconds == null );
	const long = steer.length ? most( steer, k => k.held ) : null, late = steer.length ? most( steer, k => k.held - k.seconds ) : null;
	const fmt = k => k ? `${ k.key.toUpperCase() } ${ k.held.toFixed( 3 ) } s on ${ k.seconds?.toFixed( 3 ) ?? 'a speed' }, let go by ${ k.by }` : 'none';
	console.log( `${ label } keys: ${ steer.length } steering pulses, longest ${ fmt( long ) }, worst overrun ${ late ? ( late.held - late.seconds ).toFixed( 3 ) : '-' } s; ${ backs.length } recovery holds${ backs.length ? `, longest ${ fmt( most( backs, k => k.held ) ) }` : '' }; ${ pedal.length } W/S presses, ${ pedal.filter( k => k.by === 'speed' ).length } let go by the page at speed, longest ${ fmt( pedal.length ? most( pedal, k => k.held ) : null ) }` );
	if ( long && long.held > 0.2 ) throw new Error( `${ label }: the pilot held ${ long.key.toUpperCase() } for ${ long.held.toFixed( 3 ) } s of game time on a ${ long.seconds.toFixed( 3 ) } s pulse (at most 0.2 s): its hands, not the car` );
	if ( ! until( car ) ) console.log( `${ label } OUT OF BUDGET, last reads:\n  ${ track.slice( - 8 ).map( c => `t ${ ( c.t - t0 ).toFixed( 1 ) } x ${ c.x.toFixed( 2 ) } y ${ c.y.toFixed( 2 ) } z ${ c.z.toFixed( 2 ) } hdg ${ c.heading.toFixed( 3 ) } ${ c.kmh.toFixed( 1 ) } km/h up ${ c.up.toFixed( 3 ) }` ).join( '\n  ' ) }` );
	const top = Math.max( 0, ...track.map( c => c.kmh ) ), swing = Math.max( 0, ...track.map( c => Math.abs( c.heading ) ) );
	const offAxis = Math.max( 0, ...track.map( c => Math.abs( c.x - pathX( path, c.z ) ) ) );
	console.log( `${ label } first 3 s:\n  ${ early.join( '\n  ' ) }` );
	console.log( `${ label } to her frame z ${ car.z.toFixed( 1 ) }, x ${ car.x.toFixed( 2 ) }: ${ ( car.t - t0 ).toFixed( 1 ) } s game time, ${ ( ( Date.now() - wall ) / 1000 ).toFixed( 0 ) } s wall, top ${ top.toFixed( 1 ) } km/h, most ${ swing.toFixed( 2 ) } rad off her axis, most ${ offAxis.toFixed( 2 ) } m off the path, ${ recoveries } recoveries, ${ track.length } reads` );
	return { car, track };

}
