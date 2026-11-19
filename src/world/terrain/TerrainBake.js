import { DataUtils } from '../../engine/index.js';

// CPU bakes of the terrain maps sampled by the terrain material (and the water):
//   normal RGBA8: nx * 0.5 + 0.5, nz * 0.5 + 0.5, rock mask, ambient occlusion
//   splat  RGBA8: loose sand, worn paths / trampled ground, gullies (land) or seagrass
//                 meadows (seabed), coral rubble / rock heads on the seabed
// The ambient occlusion combines a horizon-based term (4 m grid, 8 directions, up to ~110 m)
// with a small-scale cavity term from the height Laplacian.

const AO_STEPS = [ 4, 8, 13, 19, 27, 38, 52, 72, 100 ];
const AO_DIRS = 8;

export function bakeTerrainMaps( terrain ) {

	const t0 = performance.now();
	const { resX, resZ, heights: H, rock, texel, originX, originZ } = terrain;

	// ---- horizon AO on a coarse grid
	const F = 4; // texels per AO cell
	const NX = resX / F, NZ = resZ / F; // AO cells per axis (row stride NX)
	const cell = texel * F;
	const hc = new Float32Array( NX * NZ );
	for ( let j = 0; j < NZ; j ++ ) for ( let i = 0; i < NX; i ++ ) {

		let s = 0;
		for ( let b = 0; b < F; b ++ ) {

			const row = ( j * F + b ) * resX + i * F;
			for ( let a = 0; a < F; a ++ ) s += H[ row + a ];

		}

		hc[ j * NX + i ] = s / ( F * F );

	}

	const ao = new Float32Array( NX * NZ ).fill( 1 );
	const dirs = [];
	for ( let d = 0; d < AO_DIRS; d ++ ) {

		const a = ( d + 0.5 ) / AO_DIRS * Math.PI * 2;
		dirs.push( [ Math.cos( a ), Math.sin( a ) ] );

	}

	for ( let j = 1; j < NZ - 1; j ++ ) for ( let i = 1; i < NX - 1; i ++ ) {

		const h0 = hc[ j * NX + i ];
		if ( h0 < - 25 ) continue;
		let vis = 0;
		for ( let d = 0; d < AO_DIRS; d ++ ) {

			const [ dx, dz ] = dirs[ d ];
			let maxT = 0;
			for ( let s = 0; s < AO_STEPS.length; s ++ ) {

				const dist = AO_STEPS[ s ];
				const x = Math.round( i + dx * dist / cell ), z = Math.round( j + dz * dist / cell );
				if ( x < 0 || z < 0 || x >= NX || z >= NZ ) break;
				const t = ( hc[ z * NX + x ] - h0 - 0.3 ) / dist;
				if ( t > maxT ) maxT = t;

			}

			vis += 1 / ( 1 + maxT * maxT ); // cos^2 of the horizon elevation

		}

		ao[ j * NX + i ] = vis / AO_DIRS;

	}

	const t1 = performance.now();

	// ---- per texel maps
	const normal = new Uint8Array( resX * resZ * 4 );
	const splat = new Uint8Array( resX * resZ * 4 );
	const sand = terrain.sand, path = terrain.path, gully = terrain.gully;
	const seagrass = terrain.seagrass, rubble = terrain.rubble, scarp = terrain.scarp;
	const inv2t = 1 / ( 2 * texel );
	for ( let j = 0; j < resZ; j ++ ) {

		const jm = j > 0 ? j - 1 : 0, jp = j < resZ - 1 ? j + 1 : resZ - 1;
		const j2m = j > 1 ? j - 2 : 0, j2p = j < resZ - 2 ? j + 2 : resZ - 1;
		// AO grid coordinate (cell centres at (i + 0.5) * F texels)
		let fz = ( j + 0.5 ) / F - 0.5;
		fz = fz < 0 ? 0 : fz > NZ - 1.001 ? NZ - 1.001 : fz;
		const az = fz | 0, tz = fz - az;
		for ( let i = 0; i < resX; i ++ ) {

			const k = j * resX + i;
			const im = i > 0 ? i - 1 : 0, ip = i < resX - 1 ? i + 1 : resX - 1;
			const hx = ( H[ j * resX + ip ] - H[ j * resX + im ] ) * inv2t;
			const hz = ( H[ jp * resX + i ] - H[ jm * resX + i ] ) * inv2t;
			const il = 1 / Math.sqrt( hx * hx + 1 + hz * hz );
			const nx = - hx * il, nz = - hz * il;

			// cavity from the Laplacian over a 2 m baseline (negative = convex)
			const i2m = i > 1 ? i - 2 : 0, i2p = i < resX - 2 ? i + 2 : resX - 1;
			const h = H[ k ];
			const lap = ( H[ j * resX + i2m ] + H[ j * resX + i2p ] + H[ j2m * resX + i ] + H[ j2p * resX + i ] - 4 * h ) * 0.25;
			let cav = 0.5 + lap * 0.9;
			cav = cav < 0 ? 0 : cav > 1 ? 1 : cav;

			let fx = ( i + 0.5 ) / F - 0.5;
			fx = fx < 0 ? 0 : fx > NX - 1.001 ? NX - 1.001 : fx;
			const ax = fx | 0, tx = fx - ax;
			const q = az * NX + ax;
			const aoL = ( ao[ q ] * ( 1 - tx ) + ao[ q + 1 ] * tx ) * ( 1 - tz ) + ( ao[ q + NX ] * ( 1 - tx ) + ao[ q + NX + 1 ] * tx ) * tz;
			let aoT = aoL * ( 1 - Math.max( 0, cav - 0.5 ) * 0.7 );
			aoT = aoT < 0 ? 0 : aoT;

			const o = k * 4;
			normal[ o ] = ( nx * 0.5 + 0.5 ) * 255 + 0.5;
			normal[ o + 1 ] = ( nz * 0.5 + 0.5 ) * 255 + 0.5;
			normal[ o + 2 ] = rock[ k ] * 255 + 0.5;
			normal[ o + 3 ] = aoT * 255 + 0.5;
			splat[ o ] = sand[ k ];
			splat[ o + 1 ] = path[ k ];
			splat[ o + 2 ] = seagrass ? Math.max( gully[ k ], seagrass[ k ] ) : gully[ k ];
			// alpha: seabed rubble below the sea, the eroded beach scarp face on land
			splat[ o + 3 ] = Math.max( rubble ? rubble[ k ] : 0, scarp ? scarp[ k ] : 0 );

		}

	}

	// trampled ground around the building pads carved by the village
	if ( terrain.pads ) {

		for ( const p of terrain.pads ) {

			const R = p.radius + 3.5;
			const i0 = Math.max( 0, Math.floor( ( p.x - R - originX ) / texel ) ), i1 = Math.min( resX - 1, Math.ceil( ( p.x + R - originX ) / texel ) );
			const j0 = Math.max( 0, Math.floor( ( p.z - R - originZ ) / texel ) ), j1 = Math.min( resZ - 1, Math.ceil( ( p.z + R - originZ ) / texel ) );
			for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

				const x = originX + ( i + 0.5 ) * texel, z = originZ + ( j + 0.5 ) * texel;
				const d = Math.hypot( x - p.x, z - p.z );
				const a = Math.atan2( z - p.z, x - p.x );
				// ragged edge: worn patches reach out unevenly around each building
				const reach = 1.2 + 1.8 * ( 0.5 + 0.5 * Math.sin( a * 3 + p.x ) * Math.sin( a * 5 - p.z ) );
				const t = d < p.radius ? 1 : Math.max( 0, 1 - ( d - p.radius ) / reach );
				const o = ( j * resX + i ) * 4 + 1;
				const v = Math.round( t * t * 150 );
				if ( v > splat[ o ] ) splat[ o ] = v;

			}

		}

	}

	return { normal, splat, ms: { ao: t1 - t0, maps: performance.now() - t1 } };

}

// Coarse heights for the heightfield sun shadow: `factor` x `factor` box average of the
// heightmap, then a mip chain of 2 x 2 maxima (ridges keep their height when marched from far).
// Returns half-float mip levels for a DataTexture.
export function buildShadowHeights( terrain, factor = 4 ) {

	const { resX, resZ, heights: H } = terrain;
	const nx = resX / factor, nz = resZ / factor;
	let cur = new Float32Array( nx * nz );
	let maxHeight = - Infinity;
	const inv = 1 / ( factor * factor );
	for ( let j = 0; j < nz; j ++ ) for ( let i = 0; i < nx; i ++ ) {

		let s = 0;
		for ( let b = 0; b < factor; b ++ ) {

			const row = ( j * factor + b ) * resX + i * factor;
			for ( let a = 0; a < factor; a ++ ) s += H[ row + a ];

		}

		const v = s * inv;
		cur[ j * nx + i ] = v;
		if ( v > maxHeight ) maxHeight = v;

	}

	const toHalf = ( src ) => {

		const out = new Uint16Array( src.length );
		for ( let i = 0; i < src.length; i ++ ) out[ i ] = DataUtils.toHalfFloat( src[ i ] );
		return out;

	};

	// The domain is a rectangle, so each axis halves on its own the way GPU mips do (round down,
	// never below 1): 512 x 832 -> 256 x 416 ... 8 x 13 -> 4 x 6 -> 2 x 3 -> 1 x 1. When an axis count
	// is odd its last parent also takes the dropped child, so a ridge is never lost from the max.
	const levels = [ { data: toHalf( cur ), width: nx, height: nz } ];
	let w = nx, h = nz;
	while ( w > 1 || h > 1 ) {

		const mw = Math.max( 1, w >> 1 ), mh = Math.max( 1, h >> 1 );
		const next = new Float32Array( mw * mh );
		for ( let j = 0; j < mh; j ++ ) {

			const jEnd = j === mh - 1 ? h - 1 : 2 * j + 1;
			for ( let i = 0; i < mw; i ++ ) {

				const iEnd = i === mw - 1 ? w - 1 : 2 * i + 1;
				let top = - Infinity;
				for ( let b = 2 * j; b <= jEnd; b ++ ) for ( let a = 2 * i; a <= iEnd; a ++ ) {

					if ( cur[ b * w + a ] > top ) top = cur[ b * w + a ];

				}

				next[ j * mw + i ] = top;

			}

		}

		levels.push( { data: toHalf( next ), width: mw, height: mh } );
		cur = next;
		w = mw;
		h = mh;

	}

	return { levels, texel: terrain.texel * factor, maxHeight };

}
