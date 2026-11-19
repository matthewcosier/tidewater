import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { devicePixelRatio: 1 };
const { TemporalUpscale } = await import( '../src/post/TemporalUpscale.js' );

const OUT_W = 1440; // px: the specs' viewport width

// the jitter offsets (input px) of one full cycle at this output / input ratio, from the shipped jitter()
function cycle( ratio, override = 4 ) {

	const offsets = [];
	const stub = {
		jitterPhaseOverride: override,
		jitterScale: 0.5,
		jitterMoving: 0.35,
		_outW: OUT_W,
		_jitterIndex: 0,
		_beautyTexture: () => ( { width: Math.round( OUT_W / ratio ) } ),
		_cameraMotion: () => 0,
		uniforms: { fields: { jitterPhases: { value: 0 } } },
		_jitterOffset: { value: { set( x, y ) { this.x = x; this.y = y; } } },
	};
	const jitter = TemporalUpscale.prototype.jitter;
	let phases = 0;
	for ( let n = 0; n < 1024; n ++ ) {

		stub._jitterIndex = n;
		offsets.push( jitter.call( stub ) );
		phases = stub.uniforms.fields.jitterPhases.value;
		if ( offsets.length >= phases ) break;

	}
	return { offsets, phases, inW: Math.round( OUT_W / ratio ) };

}

// largest distance (output px) from an output pixel centre to the nearest jittered sample over the cycle
function worstGap( ratio ) {

	const { offsets, inW } = cycle( ratio );
	const r = OUT_W / inW;
	let worst = 0;
	for ( let oy = 0; oy < 24; oy ++ ) for ( let ox = 0; ox < 24; ox ++ ) {

		const px = ( ox + 0.5 ) / r, py = ( oy + 0.5 ) / r; // output centre in input px
		let best = Infinity;
		for ( const [ jx, jy ] of offsets ) for ( let iy = Math.floor( py ) - 1; iy <= Math.floor( py ) + 1; iy ++ ) for ( let ix = Math.floor( px ) - 1; ix <= Math.floor( px ) + 1; ix ++ ) {

			best = Math.min( best, Math.hypot( ix + 0.5 + jx - px, iy + 0.5 + jy - py ) * r );

		}
		worst = Math.max( worst, best );

	}
	return worst;

}

test( 'below render scale 1 every output pixel gets a jittered sample of its own (no input-pixel blocks)', () => {

	for ( const scale of [ 0.85, 0.7, 0.5 ] ) {

		const gap = worstGap( 1 / scale );
		assert.ok( gap <= 0.5, `render scale ${ scale }: an output pixel's nearest sample is ${ gap.toFixed( 2 ) } output px away (over 0.5: neighbouring output pixels share samples and the frame draws in ${ ( 1 / scale ).toFixed( 2 ) }-px blocks)` );

	}

} );

test( 'native resolution keeps the tuned 4 phases at half-pixel amplitude (test/taa-pier.mjs settings)', () => {

	const { offsets, phases } = cycle( 1 );
	assert.equal( phases, 4, `native: ${ phases } jitter phases` );
	const reach = Math.max( ...offsets.map( ( [ x, y ] ) => Math.max( Math.abs( x ), Math.abs( y ) ) ) );
	assert.ok( reach <= 0.25, `native: jitter reaches ${ reach.toFixed( 3 ) } px from the pixel centre (half-pixel amplitude: 0.25)` );
	assert.ok( worstGap( 1 ) <= 0.5, `native gap ${ worstGap( 1 ).toFixed( 2 ) } px` );

} );
