
const random = ( n ) => {

	let x = Math.imul( n ^ 0x5bd1e995, 0x45d9f3b );
	x = Math.imul( x ^ ( x >>> 16 ), 0x45d9f3b );
	return ( ( x ^ ( x >>> 16 ) ) >>> 0 ) / 4294967296;

};

// add weighted octaves of tiling value noise (quintic fade) into acc; `periods` are lattice cells per tile
function addOctaves( acc, size, periods, weights, seed, billow ) {

	const i0 = new Int32Array( size ), i1 = new Int32Array( size ), fade = new Float32Array( size );
	for ( let o = 0; o < periods.length; o ++ ) {

		const p = periods[ o ], cell = size / p, w = weights[ o ], pp = p * p;
		const lattice = new Float32Array( pp * p );
		for ( let i = 0; i < lattice.length; i ++ ) lattice[ i ] = random( seed * 7919 + o * 104729 + i );
		for ( let v = 0; v < size; v ++ ) {

			const u = v / cell, a = Math.floor( u ), f = u - a;
			i0[ v ] = a % p;
			i1[ v ] = ( a + 1 ) % p; // wraps: the tile repeats seamlessly
			fade[ v ] = f * f * f * ( f * ( f * 6 - 15 ) + 10 );

		}
		let k = 0;
		for ( let z = 0; z < size; z ++ ) {

			const z0 = i0[ z ] * pp, z1 = i1[ z ] * pp, fz = fade[ z ];
			for ( let y = 0; y < size; y ++ ) {

				const y0 = i0[ y ] * p, y1 = i1[ y ] * p, fy = fade[ y ];
				for ( let x = 0; x < size; x ++ ) {

					const x0 = i0[ x ], x1 = i1[ x ], fx = fade[ x ];
					const a00 = lattice[ z0 + y0 + x0 ] + ( lattice[ z0 + y0 + x1 ] - lattice[ z0 + y0 + x0 ] ) * fx;
					const a10 = lattice[ z0 + y1 + x0 ] + ( lattice[ z0 + y1 + x1 ] - lattice[ z0 + y1 + x0 ] ) * fx;
					const a01 = lattice[ z1 + y0 + x0 ] + ( lattice[ z1 + y0 + x1 ] - lattice[ z1 + y0 + x0 ] ) * fx;
					const a11 = lattice[ z1 + y1 + x0 ] + ( lattice[ z1 + y1 + x1 ] - lattice[ z1 + y1 + x0 ] ) * fx;
					const b0 = a00 + ( a10 - a00 ) * fy, b1 = a01 + ( a11 - a01 ) * fy;
					const v = b0 + ( b1 - b0 ) * fz;
					acc[ k ++ ] += w * ( billow ? 1 - Math.abs( 2 * v - 1 ) : v );

				}

			}

		}

	}

}

// write acc into channel c of data, its 1st..99th percentile stretched over 0..255
function stretch( acc, data, c ) {

	const bins = new Uint32Array( 1024 );
	for ( let i = 0; i < acc.length; i ++ ) bins[ Math.min( 1023, Math.max( 0, Math.floor( acc[ i ] * 1024 ) ) ) ] ++;
	const edge = ( q ) => {

		let s = 0;
		for ( let b = 0; b < 1024; b ++ ) { s += bins[ b ]; if ( s >= q * acc.length ) return b / 1024; }
		return 1;

	};
	const lo = edge( 0.01 ), hi = Math.max( edge( 0.99 ), lo + 1 / 1024 );
	for ( let i = 0; i < acc.length; i ++ ) data[ i * 4 + c ] = Math.round( 255 * Math.min( 1, Math.max( 0, ( acc[ i ] - lo ) / ( hi - lo ) ) ) );

}

let cached = null;

export function volumeNoise() {

	if ( cached ) return cached;
	const size = 64, n3 = size * size * size, data = new Uint8Array( n3 * 4 );
	const channels = [
		[ [ 4, 8, 16, 32 ], [ 0.5, 0.25, 0.15, 0.1 ], 11, false ],
		[ [ 8, 16, 32 ], [ 0.5, 0.3, 0.2 ], 23, false ],
		[ [ 4, 8, 16 ], [ 0.55, 0.3, 0.15 ], 37, true ],
	];
	const acc = new Float32Array( n3 );
	channels.forEach( ( [ periods, weights, seed, billow ], c ) => {

		acc.fill( 0 );
		addOctaves( acc, size, periods, weights, seed, billow );
		stretch( acc, data, c );

	} );
	for ( let i = 3; i < data.length; i += 4 ) data[ i ] = 255;
	cached = { data, size, channels: 4 };
	return cached;

}
