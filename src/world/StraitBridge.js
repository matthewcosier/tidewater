import { BufferGeometry, BufferAttribute, Mesh, Group, Vector3 } from '../engine/index.js';
import { Material } from '../engine/render/Material.js';
import { ShaderModule } from '../engine/gpu/Shader.js';

// Monumental coastal suspension bridge linking Tidewater Island (West Headland bluff)
// to Joey Island (north ridge) across the ferry strait.
// Coordinates in metres, y up, sea level y = 0. See docs/strait-bridge.md.
const P0 = [ - 250, 138 ];
const P1 = [ 5, 722 ];
const DX = P1[ 0 ] - P0[ 0 ], DZ = P1[ 1 ] - P0[ 1 ];
const LENGTH = Math.hypot( DX, DZ ); // 637.24 m
const UX = DX / LENGTH, UZ = DZ / LENGTH;
const RX = UZ, RZ = - UX;
const YAW = Math.atan2( UX, UZ );

const Y0 = 16.0;          // m, north expansion joint deck surface (West Headland bluff)
const Y1 = 21.0;          // m, south expansion joint deck surface (Joey Island north cliff crest)
const ARCH = 18.0;        // m, sinusoidal deck arch rise (peak 36.5 m at mid-span)
const T1 = 105.0;         // m along bridge, north suspension tower (shoal seabed ~0 m)
const T2 = 532.0;         // m along bridge, south suspension tower (427 m main span)
const TOWER_TOP = 106.0;  // m above sea level
const SADDLE_Y = 104.2;   // m, main cable saddle centre
const CABLE_MID_Y = 39.5; // m, main cable lowest point at mid-span (64.7 m sag / 440 m main span)
const GIRDER_DEPTH = 2.2; // m, stiffening box girder depth below deck top
const ROAD_HALF = 3.7;    // m, 7.4 m two-lane asphalt carriageway
const TOWER_LAT = 6.1;    // m, half-spacing between twin tower legs and main cables
const PLATFORM_ID = 20;   // Avian kinematic platform id (1 ferry, 11-14 terminal barriers/booms)

function deckY( s ) {
	if ( s <= 0 ) return Y0 + s * ( ( Y1 - Y0 ) + ARCH * Math.PI ) / LENGTH;
	if ( s >= LENGTH ) return Y1 + ( s - LENGTH ) * ( ( Y1 - Y0 ) - ARCH * Math.PI ) / LENGTH;
	const u = s / LENGTH;
	return Y0 + ( Y1 - Y0 ) * u + ARCH * Math.sin( Math.PI * u );
}

function deckSlope( s ) {
	const u = Math.max( 0, Math.min( 1, s / LENGTH ) );
	return ( ( Y1 - Y0 ) + ARCH * Math.PI * Math.cos( Math.PI * u ) ) / LENGTH;
}

function cableY( s ) {
	const mid = ( T1 + T2 ) * 0.5, halfMain = ( T2 - T1 ) * 0.5;
	if ( s >= T1 && s <= T2 ) {
		const u = ( s - mid ) / halfMain;
		return CABLE_MID_Y + ( SADDLE_Y - CABLE_MID_Y ) * u * u;
	}
	if ( s < T1 ) {
		const anchorS = - 14, anchorY = Y0 + 1.4;
		const u = Math.max( 0, Math.min( 1, ( s - anchorS ) / ( T1 - anchorS ) ) );
		return anchorY + ( SADDLE_Y - anchorY ) * ( 0.45 * u + 0.55 * u * u );
	}
	const anchorS = LENGTH + 14, anchorY = Y1 + 1.4;
	const u = Math.max( 0, Math.min( 1, ( anchorS - s ) / ( anchorS - T2 ) ) );
	return anchorY + ( SADDLE_Y - anchorY ) * ( 0.45 * u + 0.55 * u * u );
}

function worldXZ( s, lat = 0 ) {
	return [ P0[ 0 ] + UX * s + RX * lat, P0[ 1 ] + UZ * s + RZ * lat ];
}

export const BRIDGE = Object.freeze( {
	P0, P1, LENGTH, ux: UX, uz: UZ, rx: RX, rz: RZ, yaw: YAW,
	Y0, Y1, ARCH, T1, T2, TOWER_TOP, SADDLE_Y, GIRDER_DEPTH, ROAD_HALF, TOWER_LAT, PLATFORM_ID,
	deckY, deckSlope, cableY, worldXZ,
} );

// Lightweight indexed geometry accumulator for merging each bridge material into one draw call.
class MeshBuilder {
	constructor() { this.pos = []; this.norm = []; this.uv = []; this.idx = []; }
	vertex( x, y, z, nx, ny, nz, u = 0, v = 0 ) {
		this.pos.push( x, y, z ); this.norm.push( nx, ny, nz ); this.uv.push( u, v );
		return this.pos.length / 3 - 1;
	}
	quad( a, b, c, d ) { this.idx.push( a, b, c, a, c, d ); }
	// Axis-aligned box in bridge-local coordinates (s along, y up, lat right), rotated to world.
	localBox( s0, s1, y0, y1, lat0, lat1 ) {
		const sm = ( s0 + s1 ) * 0.5, ym = ( y0 + y1 ) * 0.5, lm = ( lat0 + lat1 ) * 0.5;
		const hs = Math.abs( s1 - s0 ) * 0.5, hy = Math.abs( y1 - y0 ) * 0.5, hl = Math.abs( lat1 - lat0 ) * 0.5;
		const axes = [
			[ UX, 0, UZ, hs ],
			[ 0, 1, 0, hy ],
			[ RX, 0, RZ, hl ],
		];
		const [ cx, cz ] = worldXZ( sm, lm );
		const c = [ cx, ym, cz ];
		for ( let f = 0; f < 3; f ++ ) for ( const sign of [ - 1, 1 ] ) {
			const N = axes[ f ], U = axes[ ( f + 1 ) % 3 ], V = axes[ ( f + 2 ) % 3 ];
			const nx = N[ 0 ] * sign, ny = N[ 1 ] * sign, nz = N[ 2 ] * sign;
			const pt = ( a, b ) => this.vertex(
				c[ 0 ] + N[ 0 ] * N[ 3 ] * sign + U[ 0 ] * U[ 3 ] * a + V[ 0 ] * V[ 3 ] * b,
				c[ 1 ] + N[ 1 ] * N[ 3 ] * sign + U[ 1 ] * U[ 3 ] * a + V[ 1 ] * V[ 3 ] * b,
				c[ 2 ] + N[ 2 ] * N[ 3 ] * sign + U[ 2 ] * U[ 3 ] * a + V[ 2 ] * V[ 3 ] * b,
				nx, ny, nz, a * U[ 3 ], b * V[ 3 ]
			);
			const a0 = pt( - 1, - 1 ), b0 = pt( 1, - 1 ), c0 = pt( 1, 1 ), d0 = pt( - 1, 1 );
			// Orient outward to agree with face normal.
			const p = this.pos;
			const ux = p[ b0 * 3 ] - p[ a0 * 3 ], uy = p[ b0 * 3 + 1 ] - p[ a0 * 3 + 1 ], uz = p[ b0 * 3 + 2 ] - p[ a0 * 3 + 2 ];
			const vx = p[ c0 * 3 ] - p[ a0 * 3 ], vy = p[ c0 * 3 + 1 ] - p[ a0 * 3 + 1 ], vz = p[ c0 * 3 + 2 ] - p[ a0 * 3 + 2 ];
			const dot = ( uy * vz - uz * vy ) * nx + ( uz * vx - ux * vz ) * ny + ( ux * vy - uy * vx ) * nz;
			if ( dot >= 0 ) this.quad( a0, b0, c0, d0 ); else this.quad( a0, d0, c0, b0 );
		}
	}
	// Extruded prismatic beam between two world points A and B with square half-radius r (or custom sides).
	strut( ax, ay, az, bx, by, bz, r, sides = 6 ) {
		const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot( dx, dy, dz );
		if ( len < 1e-4 ) return;
		const tx = dx / len, ty = dy / len, tz = dz / len;
		let upx = 0, upy = 1, upz = 0;
		if ( Math.abs( ty ) > 0.92 ) { upx = 1; upy = 0; upz = 0; }
		let bx1 = ty * upz - tz * upy, by1 = tz * upx - tx * upz, bz1 = tx * upy - ty * upx;
		const bl1 = Math.hypot( bx1, by1, bz1 ) || 1; bx1 /= bl1; by1 /= bl1; bz1 /= bl1;
		const bx2 = ty * bz1 - tz * by1, by2 = tz * bx1 - tx * bz1, bz2 = tx * by1 - ty * bx1;
		const ring0 = [], ring1 = [];
		for ( let k = 0; k < sides; k ++ ) {
			const ang = k / sides * Math.PI * 2, ca = Math.cos( ang ), sa = Math.sin( ang );
			const nx = bx1 * ca + bx2 * sa, ny = by1 * ca + by2 * sa, nz = bz1 * ca + bz2 * sa;
			ring0.push( this.vertex( ax + nx * r, ay + ny * r, az + nz * r, nx, ny, nz, k / sides, 0 ) );
			ring1.push( this.vertex( bx + nx * r, by + ny * r, bz + nz * r, nx, ny, nz, k / sides, len ) );
		}
		for ( let k = 0; k < sides; k ++ ) {
			const k2 = ( k + 1 ) % sides;
			this.quad( ring0[ k ], ring1[ k ], ring1[ k2 ], ring0[ k2 ] );
		}
	}
	// Sweep a closed 2D cross-section [lat, dy] along samples of s, positioned relative to deckY(s).
	extrudeProfile( samples, profile, closed = true ) {
		const rings = [], m = profile.length;
		for ( const s of samples ) {
			const yBase = deckY( s ), slope = deckSlope( s ), inv = 1 / Math.hypot( 1, slope );
			const nyUp = inv, nsUp = - slope * inv;
			const ring = [];
			for ( let j = 0; j < m; j ++ ) {
				const [ lat, dy ] = profile[ j ];
				const [ lat0, dy0 ] = profile[ ( j + m - 1 ) % m ];
				const [ lat1, dy1 ] = profile[ ( j + 1 ) % m ];
				const tLat = lat1 - lat0, tDy = dy1 - dy0, tl = Math.hypot( tLat, tDy ) || 1;
				// Outward 2D normal (CCW profile) in (lat, y)
				const nLat = tDy / tl, nY = - tLat / tl;
				const [ wx, wz ] = worldXZ( s, lat );
				const nx = RX * nLat + UX * nsUp * nY, ny = nyUp * nY, nz = RZ * nLat + UZ * nsUp * nY;
				const nl = Math.hypot( nx, ny, nz ) || 1;
				ring.push( this.vertex( wx, yBase + dy, wz, nx / nl, ny / nl, nz / nl, lat, s ) );
			}
			rings.push( ring );
		}
		const segs = closed ? m : m - 1;
		for ( let i = 0; i < rings.length - 1; i ++ ) {
			const r0 = rings[ i ], r1 = rings[ i + 1 ];
			for ( let j = 0; j < segs; j ++ ) {
				const j2 = ( j + 1 ) % m;
				this.quad( r0[ j ], r1[ j ], r1[ j2 ], r0[ j2 ] );
			}
		}
	}
	geometry() {
		const g = new BufferGeometry();
		g.setAttribute( 'position', new BufferAttribute( new Float32Array( this.pos ), 3 ) );
		g.setAttribute( 'normal', new BufferAttribute( new Float32Array( this.norm ), 3 ) );
		g.setAttribute( 'uv', new BufferAttribute( new Float32Array( this.uv ), 2 ) );
		g.setIndex( this.idx );
		g.computeBoundingSphere();
		return g;
	}
}

const bridgeAsphaltModule = new ShaderModule( { name: 'straitBridgeAsphalt', code: /* wgsl */`
fn sbHash( p: vec2f ) -> f32 { var q = fract( vec3f( p.x, p.y, p.x ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
fn sbNoise( p: vec2f ) -> f32 {
	let i = floor( p ); let f = fract( p ); let w = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( sbHash( i ), sbHash( i + vec2f( 1.0, 0.0 ) ), w.x ), mix( sbHash( i + vec2f( 0.0, 1.0 ) ), sbHash( i + vec2f( 1.0, 1.0 ) ), w.x ), w.y );
}
fn sbLine( x: f32, w: f32 ) -> f32 { let f = max( fwidth( x ), 1e-5 ); return clamp( ( w - abs( x ) ) / f + 0.5, 0.0, 1.0 ) * min( 1.0, 2.0 * w / f ); }
` } );

export class StraitBridge {
	constructor( scene, terrain, colliders = null ) {
		this.terrain = terrain;
		this.group = new Group();
		this.group.name = 'Strait suspension bridge';
		this.buildMeshes();
		if ( colliders ) this.registerColliders( colliders );
		scene.add( this.group );
	}

	buildMeshes() {
		const asphalt = new MeshBuilder();
		const steel = new MeshBuilder();
		const concrete = new MeshBuilder();
		const fittings = new MeshBuilder();
		const lights = new MeshBuilder();

		const samples = [];
		for ( let s = 0; s <= LENGTH; s += 8 ) samples.push( s );
		if ( samples.at( - 1 ) < LENGTH ) samples.push( LENGTH );

		// 1. Roadway asphalt deck (7.4 m wide carriageway, smooth parabolic arch)
		for ( let i = 0; i < samples.length; i ++ ) {
			const s = samples[ i ], y = deckY( s ) + 0.025, slope = deckSlope( s ), inv = 1 / Math.hypot( 1, slope );
			const nx = - UX * slope * inv, ny = inv, nz = - UZ * slope * inv;
			for ( const lat of [ - ROAD_HALF, 0, ROAD_HALF ] ) {
				const [ wx, wz ] = worldXZ( s, lat );
				asphalt.vertex( wx, y, wz, nx, ny, nz, lat, s );
			}
			if ( i > 0 ) {
				const a = ( i - 1 ) * 3, b = i * 3;
				asphalt.quad( a, b, b + 1, a + 1 );
				asphalt.quad( a + 1, b + 1, b + 2, a + 2 );
			}
		}

		// 2. Aerodynamic steel box stiffening girder beneath the deck + vertical stiffener ribs
		steel.extrudeProfile( samples, [
			[ - 5.7, - 0.08 ], [ - 5.7, - 1.35 ], [ - 4.2, - GIRDER_DEPTH ],
			[ 4.2, - GIRDER_DEPTH ], [ 5.7, - 1.35 ], [ 5.7, - 0.08 ],
		], true );
		// Stiffener web ribs and under-deck diaphragm brackets aligned with suspender spacing (16 m)
		for ( let s = 8; s <= LENGTH - 8; s += 16 ) {
			const y = deckY( s );
			steel.localBox( s - 0.22, s + 0.22, y - GIRDER_DEPTH - 0.12, y - 0.08, - 5.82, 5.82 );
		}

		// 3. Concrete Jersey safety barriers & raised pedestrian sidewalks flanking both lanes
		for ( const side of [ - 1, 1 ] ) {
			const prof = side > 0
				? [ [ 3.7, 0.0 ], [ 3.72, 0.35 ], [ 3.92, 1.05 ], [ 4.25, 1.05 ], [ 4.28, 0.28 ], [ 5.65, 0.28 ], [ 5.65, - 0.12 ], [ 3.7, - 0.12 ] ]
				: [ [ - 3.7, - 0.12 ], [ - 5.65, - 0.12 ], [ - 5.65, 0.28 ], [ - 4.28, 0.28 ], [ - 4.25, 1.05 ], [ - 3.92, 1.05 ], [ - 3.72, 0.35 ], [ - 3.7, 0.0 ] ];
			concrete.extrudeProfile( samples, prof, true );
		}

		// 4. Twin monumental 106 m Art Deco H-frame suspension towers & marine concrete caisson piers
		for ( const tS of [ T1, T2 ] ) {
			// Submerged + emergent chamfered marine concrete caisson foundation & fender pier
			concrete.localBox( tS - 4.8, tS + 4.8, - 24.0, 2.8, - 9.2, 9.2 );
			concrete.localBox( tS - 3.6, tS + 3.6, 2.8, 6.8, - 8.2, 8.2 );
			// Pier pedestals directly beneath each tower leg
			for ( const side of [ - 1, 1 ] ) {
				const l = side * TOWER_LAT;
				concrete.localBox( tS - 2.6, tS + 2.6, 6.5, 9.5, l - 2.1, l + 2.1 );
				// Stepped Art Deco tapered steel tower leg (9.5 m -> 106 m)
				steel.localBox( tS - 1.9, tS + 1.9, 9.5, 48.0, l - 1.5, l + 1.5 );
				steel.localBox( tS - 1.55, tS + 1.55, 48.0, 78.0, l - 1.25, l + 1.25 );
				steel.localBox( tS - 1.25, tS + 1.25, 78.0, TOWER_TOP, l - 1.05, l + 1.05 );
				// Cable saddle housing + aviation obstruction beacon on each tower peak
				steel.localBox( tS - 1.6, tS + 1.6, SADDLE_Y - 1.2, TOWER_TOP + 0.6, l - 1.35, l + 1.35 );
				const [ bx, bz ] = worldXZ( tS, l );
				lights.strut( bx, TOWER_TOP + 0.6, bz, bx, TOWER_TOP + 2.4, bz, 0.35, 8 );
			}
			// Lower strut beneath deck + four Art Deco portal cross-beams above the roadway (20+ m clearance)
			steel.localBox( tS - 1.3, tS + 1.3, 14.0, 17.2, - TOWER_LAT + 1.2, TOWER_LAT - 1.2 );
			const portals = [ 46.0, 66.0, 86.0, 101.5 ];
			for ( const py of portals ) {
				steel.localBox( tS - 1.15, tS + 1.15, py - 1.6, py + 1.6, - TOWER_LAT + 1.0, TOWER_LAT - 1.0 );
			}
			// Diagonal X-bracing inside the upper three tower portal bays
			for ( let p = 0; p < portals.length - 1; p ++ ) {
				const yLo = portals[ p ] + 1.4, yHi = portals[ p + 1 ] - 1.4;
				const [ ax, az ] = worldXZ( tS, - TOWER_LAT + 1.1 );
				const [ bx, bz ] = worldXZ( tS, TOWER_LAT - 1.1 );
				steel.strut( ax, yLo, az, bx, yHi, bz, 0.34, 6 );
				steel.strut( bx, yLo, bz, ax, yHi, az, 0.34, 6 );
			}
		}

		// 5. Shore concrete cable anchorages and abutment bearing walls embedded into both bluffs
		for ( const [ sJoint, sBack, yBase ] of [ [ 0, - 16, Y0 ], [ LENGTH, LENGTH + 16, Y1 ] ] ) {
			const sLo = Math.min( sJoint, sBack ), sHi = Math.max( sJoint, sBack );
			// Bearing seat strictly beneath the expansion joint and girder + flush joint apron (never protrudes above road)
			concrete.localBox( sJoint - 2.5, sJoint + 2.5, yBase - 14.0, yBase - 0.75, - 4.6, 4.6 );
			concrete.localBox( sJoint - 0.35, sJoint + 0.35, yBase - 0.85, yBase - 0.01, - 5.65, 5.65 );
			// Stepped flanking cable anchorage pylons outside the roadway and sidewalks
			for ( const side of [ - 1, 1 ] ) {
				const lIn = side > 0 ? 4.8 : - 8.2, lOut = side > 0 ? 8.2 : - 4.8;
				concrete.localBox( sLo, sHi, yBase - 14.0, yBase + 1.8, lIn, lOut );
				const sCap0 = sJoint === 0 ? - 12 : LENGTH - 1, sCap1 = sJoint === 0 ? 1 : LENGTH + 12;
				concrete.localBox( sCap0, sCap1, yBase + 1.8, yBase + 2.9, side > 0 ? 5.1 : - 7.7, side > 0 ? 7.7 : - 5.1 );
			}
		}

		// 6. Sweeping parabolic main suspension cables (both sides, anchored into both shore blocks)
		const cableSamples = [];
		for ( let s = - 14; s <= LENGTH + 14; s += 8 ) cableSamples.push( s );
		if ( cableSamples.at( - 1 ) < LENGTH + 14 ) cableSamples.push( LENGTH + 14 );
		for ( const side of [ - 1, 1 ] ) {
			const lat = side * TOWER_LAT;
			for ( let i = 0; i < cableSamples.length - 1; i ++ ) {
				const s0 = cableSamples[ i ], s1 = cableSamples[ i + 1 ];
				const [ x0, z0 ] = worldXZ( s0, lat ), [ x1, z1 ] = worldXZ( s1, lat );
				steel.strut( x0, cableY( s0 ), z0, x1, cableY( s1 ), z1, 0.40, 8 );
			}
			// 7. Galvanised vertical suspender cables every 16 m from main cables down to stiffening girder
			for ( let s = 12; s <= LENGTH - 12; s += 16 ) {
				if ( Math.abs( s - T1 ) < 10 || Math.abs( s - T2 ) < 10 ) continue;
				const cy = cableY( s ), dy = deckY( s ) - 0.8;
				if ( cy - dy < 1.2 ) continue;
				const [ sx, sz ] = worldXZ( s, lat );
				fittings.strut( sx, dy, sz, sx, cy, sz, 0.075, 6 );
				// Cable band collar where suspender clamps onto main cable
				steel.localBox( s - 0.35, s + 0.35, cy - 0.48, cy + 0.48, lat - 0.48, lat + 0.48 );
			}
			// 8. Outer pedestrian steel handrails & posts along the entire 650 m deck
			const railLat = side * 5.48;
			for ( let i = 0; i < samples.length - 1; i ++ ) {
				const s0 = samples[ i ], s1 = samples[ i + 1 ];
				const [ x0, z0 ] = worldXZ( s0, railLat ), [ x1, z1 ] = worldXZ( s1, railLat );
				for ( const h of [ 0.72, 1.38 ] ) {
					fittings.strut( x0, deckY( s0 ) + h, z0, x1, deckY( s1 ) + h, z1, 0.045, 5 );
				}
			}
			for ( let s = 4; s <= LENGTH - 4; s += 8 ) {
				const [ px, pz ] = worldXZ( s, railLat ), py = deckY( s );
				fittings.strut( px, py + 0.25, pz, px, py + 1.42, pz, 0.05, 5 );
			}
			// 9. Tapered bridge streetlamp poles & glowing warm luminaires every 36 m
			for ( let s = 22; s <= LENGTH - 22; s += 36 ) {
				if ( Math.abs( s - T1 ) < 12 || Math.abs( s - T2 ) < 12 ) continue;
				const py = deckY( s ), poleLat = side * 4.18, headLat = side * 3.15;
				const [ px, pz ] = worldXZ( s, poleLat ), [ hx, hz ] = worldXZ( s, headLat );
				fittings.strut( px, py + 1.0, pz, px, py + 7.2, pz, 0.08, 6 );
				fittings.strut( px, py + 7.1, pz, hx, py + 7.55, hz, 0.05, 5 );
				lights.localBox( s - 0.35, s + 0.35, py + 7.42, py + 7.62, Math.min( headLat - 0.18, headLat + 0.18 ), Math.max( headLat - 0.18, headLat + 0.18 ) );
			}
		}

		const addMesh = ( geometry, material, shadow = false ) => {
			const mesh = new Mesh( geometry, material );
			mesh.staticVelocity = true;
			mesh.castShadow = shadow;
			mesh.receiveShadow = true;
			this.group.add( mesh );
			return mesh;
		};

		addMesh( asphalt.geometry(), new Material( {
			name: 'Strait bridge asphalt',
			modules: [ bridgeAsphaltModule ],
			roughness: 0.88,
			side: 'front',
			surface: /* wgsl */`
let u = in.uv.x; let au = abs( u ); let along = in.uv.y; let P = in.P;
let blotch = sbNoise( P.xz * 0.06 ) * 0.6 + sbNoise( P.xz * 0.25 ) * 0.4;
let grain = sbNoise( P.xz * 3.2 ) * 0.5 + sbNoise( P.xz * 9.5 ) * 0.5;
var road = vec3f( 0.185, 0.18, 0.172 ) * ( 0.8 + blotch * 0.32 + ( grain - 0.5 ) * 0.16 );
var rough = 0.84 + ( grain - 0.5 ) * 0.14;
let w1 = ( au - 0.85 ) / 0.35; let w2 = ( au - 2.05 ) / 0.35;
let wheel = exp( - w1 * w1 ) + exp( - w2 * w2 );
road *= 1.0 - wheel * 0.12; rough -= wheel * 0.08;
// Expansion joints at abutments and towers
let ej = min( min( abs( along ), abs( along - ${ LENGTH.toFixed( 2 ) } ) ), min( abs( along - ${ T1.toFixed( 1 ) } ), abs( along - ${ T2.toFixed( 1 ) } ) ) );
let joint = sbLine( ej, 0.18 );
road = mix( road, vec3f( 0.28, 0.29, 0.30 ), joint * 0.78 ); rough = mix( rough, 0.45, joint );
// Crisp highway markings aligned with island roads: 3.5 m centre dashes + edge lines at +/-2.55 m
let fa = max( fwidth( along ), 1e-4 );
let dp = along - floor( along / 12.0 ) * 12.0;
let centreLine = sbLine( u, 0.055 ) * clamp( ( 1.75 - abs( dp - 1.75 ) ) / fa + 0.5, 0.0, 1.0 );
let edgeLine = sbLine( au - 2.55, 0.065 );
let paint = max( centreLine, edgeLine ) * ( 0.78 + 0.22 * grain );
s.albedo = mix( road, vec3f( 0.84, 0.83, 0.78 ), paint );
s.roughness = mix( rough, 0.62, paint );
`
		} ), false );

		addMesh( steel.geometry(), new Material( {
			name: 'Strait bridge steel',
			color: 0xb8371f, // International Orange painted structural steel
			roughness: 0.46,
			metalness: 0.38,
			side: 'front',
		} ), true );

		addMesh( concrete.geometry(), new Material( {
			name: 'Strait bridge concrete',
			color: 0xa9a69c, // weathered marine concrete
			roughness: 0.88,
			metalness: 0.0,
			side: 'front',
		} ), true );

		addMesh( fittings.geometry(), new Material( {
			name: 'Strait bridge fittings',
			color: 0x9aa2a6, // galvanised steel suspenders, handrails, lamp posts
			roughness: 0.42,
			metalness: 0.78,
			side: 'front',
		} ), false );

		addMesh( lights.geometry(), new Material( {
			name: 'Strait bridge lights',
			color: 0xffd7a1,
			emissive: 0xff6b35,
			emissiveIntensity: 3.2,
			roughness: 0.3,
			side: 'front',
		} ), false );
	}

	registerColliders( colliders ) {
		const c = new Vector3(), h = new Vector3();
		// Solid tower caisson piers (y = -24 .. +6.8 m: block ferries/walkers, 19+ m below roadway).
		for ( const tS of [ T1, T2 ] ) {
			const [ tx, tz ] = worldXZ( tS, 0 );
			colliders.addBox( c.set( tx, - 8.6, tz ), h.set( 9.2, 15.4, 4.8 ), YAW, { solid: true, tag: 'bridge-pier' } );
			for ( const side of [ - 1, 1 ] ) {
				const [ lx, lz ] = worldXZ( tS, side * TOWER_LAT );
				colliders.addBox( c.set( lx, 56.0, lz ), h.set( 1.7, 48.0, 1.8 ), YAW, { solid: true, tag: 'bridge-pier' } );
			}
		}
		// Walkable deck slabs (stepped every 2 m, <= 0.19 m step, solid:false so cars use the smooth pitched platform
		// and road-clearance.spec.js ignores elevated overpass support above joeyLoop).
		for ( let s = 0; s <= LENGTH; s += 2.0 ) {
			const [ wx, wz ] = worldXZ( s, 0 );
			const y = deckY( s );
			colliders.addBox( c.set( wx, y - 0.35, wz ), h.set( 5.4, 0.35, 1.15 ), YAW, { walkable: true, solid: false, tag: 'bridge-deck' } );
		}
		// Walker outer side railings over open water (stopping short of Joey's shore road overpass at s = 616).
		for ( const side of [ - 1, 1 ] ) {
			for ( let s = 18; s < 580; s += 20 ) {
				const sm = s + 10, [ wx, wz ] = worldXZ( sm, side * 5.5 );
				const y = deckY( sm );
				colliders.addBox( c.set( wx, y + 0.75, wz ), h.set( 0.15, 0.9, 10.2 ), YAW, { solid: true, tag: 'bridge-rail' } );
			}
		}
	}

	// Build smooth pitched asphalt roadway slabs + side concrete Jersey barriers + tower shafts
	// for Avian car physics (one stationary kinematic compound, PropSurface::Asphalt).
	attachPhysics( physics ) {
		if ( ! physics?.add_platform_pitched ) return false;
		const boxes = [];
		const step = 15.0, halfT = 0.85, barrierHalfW = 0.45, barrierHalfH = 0.90;
		// Extend 5 m past both abutments beneath the graded approach road for a bump-free expansion joint.
		for ( let s0 = - 5; s0 < LENGTH + 5; s0 += step ) {
			const s1 = Math.min( LENGTH + 5, s0 + step );
			const ds = s1 - s0, yA = deckY( s0 ), yB = deckY( s1 ), dy = yB - yA;
			const segLen = Math.hypot( ds, dy ), pitch = Math.atan2( dy, ds );
			const sm = ( s0 + s1 ) * 0.5, ym = ( yA + yB ) * 0.5;
			const cosP = Math.cos( pitch ), sinP = Math.sin( pitch );
			// Deck slab: top face lies exactly along (s0, yA) -> (s1, yB).
			const dsOff = sinP * halfT, dyOff = - cosP * halfT;
			const [ dcx, dcz ] = worldXZ( sm + dsOff, 0 );
			boxes.push( dcx, ym + dyOff, dcz, ROAD_HALF + 0.4, halfT, segLen * 0.5 + 0.12, YAW, - pitch, 0.95 );
			// Left & right raised concrete Jersey barriers matching the deck pitch (keep cars on the deck).
			const bSOff = - sinP * barrierHalfH, bYOff = cosP * barrierHalfH;
			for ( const side of [ - 1, 1 ] ) {
				const [ bcx, bcz ] = worldXZ( sm + bSOff, side * ( ROAD_HALF + barrierHalfW ) );
				boxes.push( bcx, ym + bYOff, bcz, barrierHalfW, barrierHalfH, segLen * 0.5 + 0.12, YAW, - pitch, 0.65 );
			}
		}
		// Tower shafts for car collision beside the deck
		for ( const tS of [ T1, T2 ] ) {
			for ( const side of [ - 1, 1 ] ) {
				const [ lx, lz ] = worldXZ( tS, side * TOWER_LAT );
				boxes.push( lx, 34.0, lz, 1.7, 28.0, 1.8, YAW, 0, 0.65 );
			}
		}
		const ok = physics.add_platform_pitched( PLATFORM_ID, new Float32Array( boxes ) );
		if ( ok ) physics.set_platform( PLATFORM_ID, new Float32Array( [ 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0 ] ) );
		return ok;
	}
}
