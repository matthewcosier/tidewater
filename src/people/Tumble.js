// Knocked flat (Contact.js, a 'tumble'): the player's own ragdoll (src/player/Ragdoll.js) on a townsperson.
// Crowd models and player.glb are both Bip01 rigs under the same 0.01 armature, so:
//  - the capsules are player.glb's scene extras `ragdoll`, every radius and length scaled by the person's
//    size (their idle's pelvis height against the player's idle);
//  - the get-ups are the player's keyed getup_back and getup_belly, retargeted by bone name (as
//    src/jetski/Mate.js does the ski clips): the rotations as they are, the pelvis translation scaled the same.
// Each model keeps its Ragdoll once built (a one-key clip over its nodes). At most MAX run at once; a knock
// past that is the sit-down fall instead. The sim is the player's at SUB substeps a frame (he runs 6).
// The owner (Crowd.js, Beach.js) puts the person's groups at the origin while one runs and calls
// Contact.rag() in place of its own update and pose; the ragdoll draws the model's group in the world.
import { Ragdoll } from '../player/Ragdoll.js';

export const MAX = 2;   // the people budget (1 ms): each ragdoll is about 0.3 ms at SUB 3
const SUB = 3, GETUPS = [ 'getup_back', 'getup_belly' ], CLIPS = [ ...GETUPS, 'tread', 'swim' ];   // tread and swim: overboard (Contact.js)
const PELVIS = 'Bip01 Pelvis';
const cache = new WeakMap();   // the cast's glTF nodes -> { clips, k }

// the pelvis's height in a clip's first key (armature units): how tall the rig stands
function hips( m, clip ) {

	const pn = m.gltf.nodes.findIndex( x => x.name === PELVIS );
	const ch = clip?.channels.find( c => c.node === pn && c.path === 'translation' );
	return ch ? Math.hypot( ch.values[ 0 ], ch.values[ 1 ], ch.values[ 2 ] ) : 0;

}

function retarget( src, dst, k ) {

	const dn = dst.gltf.nodes, sn = src.gltf.nodes, map = sn.map( n => dn.findIndex( d => d.name === n.name ) );
	const out = new Map();
	for ( const name of CLIPS ) {

		const a = src.clips.get( name );
		if ( ! a ) continue;
		const channels = a.channels.filter( ch => map[ ch.node ] >= 0 && ( ch.path === 'rotation' || ( ch.path === 'translation' && sn[ ch.node ].name === PELVIS ) ) )
			.map( ch => ( { ...ch, node: map[ ch.node ], values: ch.path === 'translation' ? ch.values.map( v => v * k ) : ch.values } ) );
		out.set( name, { ...a, name, channels } );

	}
	return out;

}

export class Tumbles {

	constructor( hub ) {

		this.hub = hub;
		this.live = new Set();
		this.count = 0;
		this.ms = 0;
		// the ground the ragdoll meets is the player's (terrain, walkable boxes, walls), whatever he is doing now
		const P = () => hub.app.player;
		this.world = { get terrain() { return P().terrain; }, get colliders() { return P().colliders; }, reef: null };

	}

	// the player's rig, when it has the capsules and the get-ups
	src() {

		const a = this.hub.app.player?.avatar, m = a?.model, json = m?.gltf?.json;
		const spec = json?.scenes?.[ json.scene || 0 ]?.extras?.ragdoll;
		return m && Array.isArray( spec ) && GETUPS.every( n => m.clips.has( n ) ) && m.clips.has( 'idle' ) ? { m, spec } : null;

	}

	can( p ) { return this.live.size < MAX && !! p.model?.gltf && !! p.clipOf?.( 'idle' ) && !! this.src(); }

	rig( p ) {

		const m = p.model;
		if ( m._tumble ) return m._tumble;
		const S = this.src(), idle = m.clips.get( p.clipOf( 'idle' ) );
		let c = cache.get( m.gltf.nodes );
		if ( ! c ) {

			const k = hips( m, idle ) / ( hips( S.m, S.m.clips.get( 'idle' ) ) || 1 ) || 1;
			c = { k, clips: retarget( S.m, m, k ) };
			cache.set( m.gltf.nodes, c );

		}
		for ( const [ n, clip ] of c.clips ) if ( ! m.clips.has( n ) ) { m.clips.set( n, clip ); m.clipSet?.add( n ); }
		const spec = S.spec.map( s => ( { ...s, radius: s.radius * c.k, length: s.length * c.k } ) );
		const rd = new Ragdoll( this.world, { spec, sub: SUB } );
		const avatar = { model: m, group: m.group, neckH: 1.5 * c.k, idle: { clip: idle, time: 0, weight: 0, target: 0, fade: 1e-3, loop: true, speed: 1, ended: false } };
		return ( m._tumble = { rd, avatar, k: c.k } );

	}

	// Down they go from where they stand (p.group's place and yaw): the body moving at `v`, knocked by the
	// impulse J (N s) at `point`, both world. Null when there is no room for another or no rig.
	start( p, v, J, point ) {

		if ( ! this.can( p ) ) return null;
		const r = this.rig( p ), y = p.yaw || 0, g = p.group.position;
		r.rd.waterY = - Infinity;
		if ( ! r.rd.start( r.avatar, { x: g.x, y: g.y, z: g.z }, { x: 0, y: Math.sin( y / 2 ), z: 0, w: Math.cos( y / 2 ) }, v, { impulse: J, point } ) ) return null;
		this.live.add( p );
		this.count ++;
		return r;

	}

	// Up again (or afloat): the model's group back under the person's, the idle (or the tread) on
	end( p, r, wet = false ) {

		this.live.delete( p );
		r.rd.phase = 'idle';
		const g = p.model.group;
		g.position.set( 0, 0, 0 ); g.quaternion.set( 0, 0, 0, 1 );
		const m = p.model, idle = wet && r.rd.tread ? r.rd.tread : r.rd.idle || r.avatar.idle;   // the get-up's own layer, already running
		idle.weight = idle.target = 1;
		m.layers = [ idle ];

	}

	state() {

		const out = [];
		for ( const p of this.live ) { const r = p.model._tumble.rd; out.push( { id: p.id, phase: r.phase, t: + r.t.toFixed( 2 ), ms: + ( r.stats?.ms || 0 ).toFixed( 3 ), at: [ r.focus.x, r.focus.y, r.focus.z ].map( x => + x.toFixed( 2 ) ) } ); }
		return { live: out, count: this.count };

	}

}
