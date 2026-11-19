
// Which quantity a draw is for. Each gets its own stream so the draws are independent.
export const STREAM = Object.freeze( {
	ignore: 1, // does this person ignore the warning
	kind: 2, // and if so, why: dawdle, film or walk out on the seabed
	react: 3, // reaction delay after the siren (everyone)
	speed: 4, // running pace
	notice: 5, // a dawdler's reaction delay once they notice the wave
	grip: 6, // the most drag force they can hold against on a pole
	endurance: 7, // how long they keep that hold (scales the Rohmert curve)
} );

// A fresh seed for a new event. Never 0, so `seed ?? fallback` checks stay meaningful.
export function freshSeed() {

	const out = new Uint32Array( 1 );
	globalThis.crypto.getRandomValues( out );
	return out[ 0 ] || 1;

}

// Uniform in [0, 1) for ( seed, person id, stream ). Integer mixing only (a murmur3-style
// finalizer), so it is cheap and the same on every machine.
export function draw( seed, id, stream ) {

	let h = Math.imul( ( seed >>> 0 ) ^ 0x9e3779b9, 0x85ebca6b );
	h ^= Math.imul( ( id | 0 ) + 0x632be5ab, 0xc2b2ae35 );
	h ^= Math.imul( stream + 0x165667b1, 0x27d4eb2f );
	h ^= h >>> 16;
	h = Math.imul( h, 0x7feb352d );
	h ^= h >>> 15;
	h = Math.imul( h, 0x846ca68b );
	h ^= h >>> 16;
	return ( h >>> 0 ) / 4294967296;

}

// Rayleigh quantile with scale sigma (same unit as sigma). Evacuation decision times are
// commonly modelled as Rayleigh distributed (Mas, Suppasri, Imamura and Koshimura 2012, the
// 2011 Tohoku evacuation model); the scale used with it here is a game choice, see the caller.
export function rayleigh( u, sigma ) {

	return sigma * Math.sqrt( - 2 * Math.log( 1 - Math.min( u, 0.999999 ) ) );

}
