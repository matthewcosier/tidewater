// Disaster sounds for src/disasters/DisasterSound.js: the flood running past the listener, the roar of a breaking
// tsunami front, a tornado's vortex roar, a far low rumble, the ground rumble of an earthquake, and the one-shots of
// things breaking (timber cracking, roots and soil tearing, a tree crown landing, a building part letting go, glass,
// heavy debris striking). Real recordings, all CC0 1.0 Freesound previews (sources in public/audio/CREDITS.md).
//
//   node dl.mjs 588180:Auxide_Audio 530170:Osiruswaltz 613467:rifualk 203281:metrostock99 217657:Reitanna \
//     222521:uagadugu 869103:ozymandias37 637912:kyles 645349:studio-cill 486263:craigsmith 675900:craigsmith \
//     487142:craigsmith 712918:greyfeather 758207:LukaCafuka 221528:unfa 397596:Nightflame
//   node build-disaster.mjs          # -> out/dis_*.ogg + disaster-bank.json
//   cp out/dis_*.ogg ../../public/audio/   # then copy the entries of disaster-bank.json into src/audio/soundBank.js
//
// Loops: the steadiest stretch of the window (by 0.1 s RMS: loud, the least variation), equal-power crossfaded at the
// wrap, loudness-normalised to -23 LUFS integrated; `lufs` in the bank is the median momentary loudness. Sprites:
// slices peak-normalised to -1 dBFS; `lufs` is each slice's maximum momentary loudness. Opus 48 kb/s mono: the
// beds are low and broadband and the mixer low-passes them with distance, so the top octave is never heard at full.
import fs from 'node:fs';
import { SR, decode, writeWav, makeLoop, lufsOf, gain, peak, encode, momentary, env, db, fade } from './lib.mjs';

const OUT = 'out', W = 'work', KBPS = 48;
for ( const d of [ OUT, W ] ) fs.mkdirSync( d, { recursive: true } );
const hp = ( f ) => `highpass=f=${ f }:p=2`;
const bank = {};

// the steadiest `len` s stretch between `from` and `to` (s) of a source, scored as mean minus 3 standard deviations
// of the 0.1 s RMS level (dB), as build-rocket.mjs picks its burn
function steadiest( src, from, to, len ) {

	const x = decode( `raw/${ src }.ogg`, 1 )[ 0 ];
	const M = Array.from( env( x, SR / 10 ), db );
	let best = null;
	for ( let t = from; t + len <= Math.min( to, x.length / SR - 0.6 ); t += 0.25 ) {

		const w = M.slice( Math.floor( t * 10 ), Math.floor( ( t + len ) * 10 ) ).filter( Number.isFinite );
		if ( w.length < 4 ) continue;
		const mean = w.reduce( ( a, b ) => a + b, 0 ) / w.length;
		const sd = Math.sqrt( w.reduce( ( a, b ) => a + ( b - mean ) ** 2, 0 ) / w.length );
		const score = mean - 3 * sd;
		if ( ! best || score > best.score ) best = { t, mean, sd, score };

	}
	return best;

}

// ---------------------------------------------------------------- loops: [ src, search from s, to s, length s, crossfade s, high-pass Hz ]
const LOOPS = {
	// a large mountain river in spate: the flood running past the listener (depth and current at the camera)
	dis_rush: [ 588180, 2, 48, 8, 0.5, 40 ],
	// a waterfall's steady roar: breaking water, the tsunami front's roar (low-passed with its distance)
	dis_roar: [ 530170, 0, 16, 8, 0.5, 30 ],
	// a freight train passing close: the tornado's vortex roar, as survivors describe it
	dis_vortex: [ 613467, 2, 30, 6, 0.5, 30 ],
	// a far low rumble: what is left of a roar beyond a kilometre once the air has absorbed the highs
	dis_rumble: [ 203281, 1, 30, 8, 0.5, 20 ],
	// ground rumble: the earthquake's shaking heard through the ground and the buildings
	dis_quake: [ 217657, 1, 41, 8, 0.5, 20 ],
};
for ( const [ name, [ src, from, to, len, xf, hpf ] ] of Object.entries( LOOPS ) ) {

	const best = steadiest( src, from, to - xf, len );
	const N = Math.round( len * SR ), X = Math.round( xf * SR );
	const seg = decode( `raw/${ src }.ogg`, 1, best.t, len + xf + 0.05, hp( hpf ) );
	const loop = makeLoop( seg, N, X );
	writeWav( `${ W }/${ name }.wav`, loop );
	const m = lufsOf( `${ W }/${ name }.wav` );
	gain( loop, 10 ** ( ( - 23 - m.I ) / 20 ) );
	const pk = peak( loop );
	if ( pk > 0.89 ) gain( loop, 0.89 / pk );
	writeWav( `${ W }/${ name }.wav`, loop );
	encode( `${ W }/${ name }.wav`, `${ OUT }/${ name }.ogg`, KBPS, 1 );
	const Mo = momentary( decode( `${ OUT }/${ name }.ogg`, 1 ) ).filter( Number.isFinite ).sort( ( a, b ) => a - b );
	bank[ name ] = { file: `${ name }.ogg`, loop: true, lufs: + Mo[ Math.floor( Mo.length / 2 ) ].toFixed( 1 ), src: [ src ], from: best.t };
	console.log( `loop   ${ name.padEnd( 11 ) } src ${ src } from ${ best.t } s  ${ len } s  lufs(before) ${ m.I } -> -23  median M ${ bank[ name ].lufs }  ${ fs.statSync( `${ OUT }/${ name }.ogg` ).size } B` );

}

// ---------------------------------------------------------------- sprites: [ src, start s, duration s, fade in s, fade out s, high-pass Hz ]
// Slice starts come from the onset detector in lib.mjs (events(): minGap 0.4 s, threshold 14 dB over the floor).
const SPRITES = {
	// timber letting go: a trunk cracking through, a dead stem splintering, a beam snapping
	dis_crack: [ [ 645349, 0.95, 0.4 ], [ 637912, 5.03, 0.98 ], [ 869103, 2.39, 1.6, 0.003, 0.4 ] ],
	// roots and soil tearing out under an uprooting tree (cracking soil and stone)
	dis_tear: [ [ 222521, 1.19, 1.08 ], [ 222521, 2.25, 0.78 ], [ 222521, 3.01, 0.42 ] ],
	// a tree's crown and stem landing on the ground
	dis_treefall: [ [ 486263, 11.21, 1.7, 0.003, 0.5 ], [ 486263, 22.56, 1.8, 0.003, 0.5 ], [ 486263, 26.43, 1.25, 0.003, 0.4 ], [ 869103, 5.9, 2.8, 0.003, 0.8 ] ],
	// a building part letting go: a wooden house collapsing, walls and roof crashing down
	dis_collapse: [ [ 675900, 0.11, 0.72 ], [ 675900, 1.15, 1.3, 0.003, 0.4 ], [ 487142, 0.37, 2.86, 0.003, 0.8 ], [ 487142, 3.23, 0.8 ], [ 712918, 0, 2.98, 0.003, 0.8, 30 ] ],
	// a window pane shattering
	dis_glass: [ [ 758207, 0, 0.9, 0.002, 0.3, 120 ], [ 221528, 0.3, 0.6, 0.002, 0.25, 120 ] ],
	// heavy debris landing or striking: wood and metal masses hitting hard
	dis_impact: [ [ 397596, 0.21, 0.42 ], [ 397596, 1.62, 0.38 ], [ 397596, 3.18, 0.3 ], [ 397596, 6.28, 0.36 ], [ 397596, 7.58, 0.52 ], [ 397596, 9.52, 0.5 ] ],
};
const GAP = 0.08;
for ( const [ name, slices ] of Object.entries( SPRITES ) ) {

	const parts = [], table = [], lufs = [];
	let t = GAP;
	for ( const [ src, st, d, fi = 0.003, fo = Math.min( 0.12, d * 0.35 ), hpf = 40 ] of slices ) {

		const pre = 0.004;
		const [ x ] = decode( `raw/${ src }.ogg`, 1, Math.max( 0, st - pre ), d + pre, hp( hpf ) );
		fade( [ x ], Math.round( fi * SR ), Math.round( fo * SR ) );
		gain( [ x ], 0.89 / Math.max( peak( [ x ] ), 1e-6 ) );
		parts.push( x );
		table.push( [ + t.toFixed( 4 ), + ( x.length / SR ).toFixed( 4 ) ] );
		t += x.length / SR + GAP;

	}
	const buf = new Float32Array( Math.ceil( ( t + 0.02 ) * SR ) );
	let o = Math.round( GAP * SR );
	for ( const x of parts ) {

		buf.set( x, o );
		o += x.length + Math.round( GAP * SR );

	}
	writeWav( `${ W }/${ name }.wav`, [ buf ] );
	encode( `${ W }/${ name }.wav`, `${ OUT }/${ name }.ogg`, KBPS, 1 );
	const y = decode( `${ OUT }/${ name }.ogg`, 1 );
	for ( const [ ts, d ] of table ) lufs.push( + Math.max( ...momentary( [ y[ 0 ].slice( Math.floor( ts * SR ), Math.floor( ( ts + d ) * SR ) ) ] ) ).toFixed( 1 ) );
	bank[ name ] = { file: `${ name }.ogg`, slices: table, lufs, src: [ ...new Set( slices.map( ( s ) => s[ 0 ] ) ) ] };
	console.log( `sprite ${ name.padEnd( 11 ) } ${ table.length } slices  lufs ${ lufs.join( ' ' ) }  ${ fs.statSync( `${ OUT }/${ name }.ogg` ).size } B` );

}
fs.writeFileSync( 'disaster-bank.json', JSON.stringify( bank, null, 1 ) );
