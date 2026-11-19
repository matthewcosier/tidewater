import { GPU } from '../../engine/gpu/GPU.js';
import { Texture } from '../../engine/gpu/Texture.js';
import { generateMipmaps } from '../../engine/gpu/Mipmaps.js';

// Minimal PNG decoder (8-bit RGBA, non-interlaced, all five filters) built on DecompressionStream,
// so the whale's baked maps load identically in the browser and in headless tests, and upload
// as plain data textures (no image element / ImageBitmap orientation or colour-space surprises).
export async function decodePNG( buffer, maxEdge = Infinity ) {

	const u8 = new Uint8Array( buffer );
	const dv = new DataView( buffer );
	let p = 8;
	let width = 0, height = 0;
	const idat = [];
	while ( p < u8.length ) {

		const len = dv.getUint32( p );
		const type = String.fromCharCode( u8[ p + 4 ], u8[ p + 5 ], u8[ p + 6 ], u8[ p + 7 ] );
		if ( type === 'IHDR' ) {

			width = dv.getUint32( p + 8 );
			height = dv.getUint32( p + 12 );
			if ( u8[ p + 16 ] !== 8 || u8[ p + 17 ] !== 6 || u8[ p + 20 ] !== 0 ) throw new Error( 'decodePNG: expects 8-bit RGBA, non-interlaced' );

		} else if ( type === 'IDAT' ) idat.push( u8.subarray( p + 8, p + 8 + len ) );
		else if ( type === 'IEND' ) break;
		p += 12 + len;

	}

	const stream = new Blob( idat ).stream().pipeThrough( new DecompressionStream( 'deflate' ) );
	const raw = new Uint8Array( await new Response( stream ).arrayBuffer() );
	const stride = width * 4;
	// Unfilter in place. The scanline's one-byte prefix stays in raw until the packed data is reduced.
	// Alpha is a material channel in these assets; canvas premultiplication would discard its RGB.
	const step = Math.max( 1, Math.ceil( Math.max( width, height ) / maxEdge ) );
	const w = Math.ceil( width / step ), h = Math.ceil( height / step );
	const out = new Uint8Array( w * h * 4 );
	const sums = step > 1 ? new Uint32Array( w * 4 ) : null;
	for ( let y = 0; y < height; y ++ ) {

		const f = raw[ y * ( stride + 1 ) ];
		const dst = y * ( stride + 1 ) + 1, prev = dst - stride - 1;
		if ( f > 4 ) throw new Error( 'Unsupported PNG filter ' + f );
		if ( f === 2 && y ) {

			for ( let i = 0; i < stride; i ++ ) raw[ dst + i ] += raw[ prev + i ];

		} else if ( f && f !== 2 ) {

			for ( let i = 0; i < stride; i ++ ) {

				const a = i >= 4 ? raw[ dst + i - 4 ] : 0, b = y ? raw[ prev + i ] : 0;
				if ( f === 1 ) raw[ dst + i ] += a;
				else if ( f === 3 ) raw[ dst + i ] += ( a + b ) >> 1;
				else {

					const c = i >= 4 && y ? raw[ prev + i - 4 ] : 0, p = a + b - c;
					const pa = Math.abs( p - a ), pb = Math.abs( p - b ), pc = Math.abs( p - c );
					raw[ dst + i ] += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;

				}

			}

		}
		if ( step === 1 ) { out.set( raw.subarray( dst, dst + stride ), y * stride ); continue; }
		for ( let x = 0; x < width; x ++ ) {

			const off = Math.floor( x / step ) * 4;
			for ( let c = 0; c < 4; c ++ ) sums[ off + c ] += raw[ dst + x * 4 + c ];

		}
		if ( ( y + 1 ) % step === 0 || y === height - 1 ) {

			const row = Math.floor( y / step ), rows = y - row * step + 1;
			for ( let x = 0; x < w; x ++ ) {

				const n = rows * Math.min( step, width - x * step );
				for ( let c = 0; c < 4; c ++ ) out[ ( row * w + x ) * 4 + c ] = Math.round( sums[ x * 4 + c ] / n );

			}
			sums.fill( 0 );

		}

	}

	return { width: w, height: h, data: out };

}

export async function loadTexture( url, srgb ) {

	const buf = await fetch( url ).then( ( r ) => r.arrayBuffer() );
	const img = await decodePNG( buf, GPU.mobileStartup ? 512 : Infinity );
	// sampled with the shared anisotropic clamp sampler (was ClampToEdge, trilinear, anisotropy 8)
	const tex = new Texture( {
		label: url.split( '/' ).pop(),
		width: img.width, height: img.height,
		format: srgb ? 'rgba8unorm-srgb' : 'rgba8unorm',
		mips: true,
		usage: [ 'sample', 'copyDst' ],
		sampler: 'anisoClamp',
		data: img.data,
	} );
	tex.getGPU();
	generateMipmaps( tex );
	return tex;

}
