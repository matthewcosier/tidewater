// Room between people on foot (docs/people.md, Solid trunks, cars and room). The townsfolk walk authored routes
// (src/ferry/Crowd.js, src/people/Beach.js); before this each walked theirs at its own pace through everyone else
// (in 54 s of the terminal crowd at loading, 1,196 of 3,251 frames had two upright people overlapping by more than
// 5 cm). Each frame, before its owner advances a walker along the leg it is on, room() sets the pace it may walk
// (p.walkV, m/s) and its side step off the route's line (p.lat, m, + to its left), from the people around it in
// the hub's grid of feet and the player on foot:
//   - someone walking its way ahead of it in its lane: it follows a person's depth behind (FOLLOW), easing its pace
//     over the last EASE before that;
//   - someone coming the other way: both step aside to pass on the side the other is on, keeping left when dead
//     ahead (two people pass with their centres about 0.7 m apart, each a third of a metre aside);
//   - someone standing (or anyone not taking part, the player included) in its way: it steps round them when its
//     route goes on past them, and stops a person's depth behind them when its route ends there (a queue);
//   - someone crossing its way: it waits for them;
//   - a side step eases at SIDE_V and back onto the line once past, and before a corner or the route's end; it
//     goes out only where the owner's clear( p, x, z ) says a body can stand (ashore the walls and the ground,
//     aboard her deck boxes);
//   - held below a third of its pace by someone it cannot pass for HOLD, it squeezes past at half pace, so a corridor
//     too narrow to pass in (her 1 m side corridor) never holds anyone for good. Following and queueing never
//     squeeze: the person ahead moves on, or the queue does.
// The owner reads p.walkV for this frame's step and adds p.lat along the leg's left normal (hz, -hx) after placing
// them on the line, and sets p.walkV = 0 whenever they are not walking (it is how others tell walking from standing).
// p.room marks a person who steps aside for others (the owners' walkers), so two of them share a pass.
// Cost: per walking person one grid query within LOOK and a few products per neighbour (about 30 walkers and 10
// neighbours each in the terminal crowd); clear() only while stepping off the line. No allocation per call.
//   room( hub, p, hx, hz, segLeft, bx, bz, last, dt, owner )
//     hub: app.people (grid, player, app); p: the walker (world, pace, heading, lat, held, walkV);
//     ( hx, hz ): the leg's unit heading (world); segLeft: m left on the leg; ( bx, bz ): the leg's end (world);
//     last: the leg ends the route; owner.clear( p, x, z ): may their body stand at ( x, p.world.y, z )

const R = 0.27;           // m: a person's body (Contact.js BODY_R; shoulders about 0.45 m, chest 0.3 m: Fruin 1971)
const PLAYER_R = 0.3;     // m: the player's (Player.js RADIUS)
const FOLLOW = 0.66;      // m centre to centre: a follower's place behind the person ahead (a body and a hand's width)
const EASE = 0.5;         // m over which a follower's pace eases to the leader's
const CLEAR = 0.6;        // m between centres across the way: two bodies (0.54 m) that no longer touch
const PASS = 0.72;        // m between centres as two people pass (each about a third of a metre aside)
const LOOK = 3.5;         // m: how far round a walker looks for others
const MEET = 3.0;         // m ahead: someone coming the other way, time to step aside (closing at 2.6 m/s, 0.5 s to step)
const STAND = 1.6;        // m ahead: someone standing in the way, time to step round at a walk
const SIDE_V = 0.7;       // m/s: a side step (declared: about half a walking pace, sideways)
const RETURN = 0.8;       // m before a corner or the route's end: back onto the line, so a turn never jumps them sideways
const HOLD = 2.5;         // s held before squeezing past
const SQUEEZE = 0.5;      // of their pace, squeezing past
const UP = 1.0;           // m of height between two people on the same floor (stairs, decks above)

const _near = [];
const _player = { world: null, walkV: 0, heading: 0, posture: 'walk', room: false, player: true };

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

export function room( hub, p, hx, hz, segLeft, bx, bz, last, dt, owner ) {

	const pace = p.pace, w = p.world, nx = hz, nz = - hx;
	let v = pace, want = 0, wantBy = Infinity, blocked = false;
	_near.length = 0;
	hub.grid.near( w.x, w.z, LOOK, _near );
	// the player on foot is a body too, standing or walking (he does not step aside: walkers go round him)
	const P = hub.player, pl = hub.app?.player;
	if ( P?.on && pl && ( pl.mode === 'walk' || pl.mode === 'ferry' || pl.mode === 'deck' ) ) {

		const vx = pl.velocity?.x || 0, vz = pl.velocity?.z || 0;
		_player.world = pl.position; _player.walkV = Math.hypot( vx, vz ); _player.heading = Math.atan2( vx, vz );
		if ( ( pl.position.x - w.x ) ** 2 + ( pl.position.z - w.z ) ** 2 < LOOK * LOOK ) _near.push( _player );

	}
	for ( let i = 0; i < _near.length; i ++ ) {

		const q = _near[ i ];
		if ( q === p || ! q.world || q.posture === 'sit' || Math.abs( q.world.y - w.y ) > UP ) continue;
		const rx = q.world.x - w.x, rz = q.world.z - w.z, ahead = rx * hx + rz * hz;
		if ( ahead <= 0.05 ) continue;   // beside or behind: the one behind gives the room
		const r = q.player ? R + PLAYER_R + 0.03 : CLEAR, side = rx * nx + rz * nz;
		if ( ahead > segLeft ) {

			// past this leg's end: someone at the route's end holds them short of it (a queue); someone still within a
			// body of a corner holds them short of it too, as anyone in their way does (two boarders in through her
			// port door: the one behind walked into the back of the one who had just turned up the corridor, 0.44 m
			// centre to centre); anyone else past a corner is met on the next leg
			const atEnd = Math.hypot( q.world.x - bx, q.world.z - bz );
			if ( last && atEnd < FOLLOW ) v = Math.min( v, pace * clamp01( ( ahead - FOLLOW ) / EASE ) );
			else if ( ! last && atEnd < r ) { v = Math.min( v, pace * clamp01( ( ahead - FOLLOW ) / EASE ) ); blocked = true; }
			continue;

		}
		// on their way (a route, even if held this frame) or walking (the player): which way, how fast along this one's
		const qv = q.walkV || 0, cos = Math.sin( q.heading || 0 ) * hx + Math.cos( q.heading || 0 ) * hz, along = qv * cos, moving = !! q.path || qv > 0.2;
		if ( moving && cos > 0.5 ) {

			// walking their way ahead of them: follow, a person's depth behind
			if ( Math.abs( side ) < r ) v = Math.min( v, Math.max( 0, along ) * clamp01( ahead / FOLLOW ) + pace * clamp01( ( ahead - FOLLOW ) / EASE ) );
			continue;

		}
		// where q stands across this walker's line (its side step taken out); a fellow walker coming the other way
		// steps the mirror of this one, so the two lines are compared and each takes half the pass
		const oncoming = moving && cos < - 0.5, shared = oncoming && q.room;
		const qline = p.lat + side + ( shared ? q.lat || 0 : 0 ), need = shared ? PASS : r;
		if ( Math.abs( qline ) >= need ) continue;
		if ( moving && ! oncoming ) {

			// crossing their way: wait for them
			if ( Math.abs( side ) < r && ahead < FOLLOW + EASE ) { v = Math.min( v, pace * clamp01( ( ahead - FOLLOW ) / EASE ) ); blocked = true; }
			continue;

		}
		if ( ! moving && last && segLeft - ahead < FOLLOW + 0.1 ) {

			// standing where this walker's route ends (the queue's next place, a door): stop behind them
			v = Math.min( v, pace * clamp01( ( ahead - FOLLOW ) / EASE ) );
			continue;

		}
		// in their way: step aside to the side q is not on (keep left when dead ahead), slowing until there is room
		if ( ahead < ( oncoming ? MEET : STAND ) && ahead < wantBy ) {

			const sgn = qline > 0.02 ? 1 : - 1;
			want = shared ? qline / 2 - sgn * PASS / 2 : qline - sgn * ( r + 0.02 );
			wantBy = ahead;

		}
		if ( Math.abs( side ) < r - 0.02 && ahead < FOLLOW + EASE ) { v = Math.min( v, pace * clamp01( ( ahead - FOLLOW ) / EASE ) ); blocked = true; }

	}
	// held behind someone they cannot pass: after HOLD, squeeze past at half pace
	p.held = blocked && v < 0.3 * pace ? ( p.held || 0 ) + dt : Math.max( 0, ( p.held || 0 ) - dt );
	if ( p.held > HOLD ) v = Math.max( v, SQUEEZE * pace );
	// the side step: out only where a body can stand, back onto the line once past and before a turn or the end
	if ( wantBy === Infinity || ( segLeft < RETURN && wantBy > segLeft ) ) want = 0;
	const lat = p.lat || 0, max = SIDE_V * dt, d = Math.max( - max, Math.min( max, want - lat ) );
	if ( d !== 0 ) {

		const tx = w.x + nx * d, tz = w.z + nz * d;
		let ok = Math.abs( lat + d ) <= Math.abs( lat ) || owner.clear( p, tx, tz );
		// never sideways into someone: a step that takes them closer to a body within its reach is not taken
		for ( let i = 0; ok && i < _near.length; i ++ ) {

			const q = _near[ i ];
			if ( q === p || ! q.world || q.posture === 'sit' || Math.abs( q.world.y - w.y ) > UP ) continue;
			const r = ( q.player ? R + PLAYER_R + 0.03 : CLEAR ) - 0.02, d0 = ( q.world.x - w.x ) ** 2 + ( q.world.z - w.z ) ** 2, d1 = ( q.world.x - tx ) ** 2 + ( q.world.z - tz ) ** 2;
			if ( d1 < r * r && d1 < d0 ) ok = false;

		}
		if ( ok ) p.lat = lat + d;

	}
	p.walkV = v;

}
