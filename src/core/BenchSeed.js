// ?bench: a seeded Math.random (imported first by main.js, before any module that draws random
// numbers), so the world is laid out the same on every load and reference shots can be compared.
export const benchMode = import.meta.env?.MODE !== 'pages' && typeof location !== 'undefined' && new URLSearchParams( location.search ).has( 'bench' );

if ( benchMode ) {

	let s = 0x9e3779b9;
	Math.random = () => {

		// mulberry32
		s = ( s + 0x6d2b79f5 ) | 0;
		let t = Math.imul( s ^ ( s >>> 15 ), 1 | s );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}
