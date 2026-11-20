// Pass the original BigSoundBank 2370 and 2371 MP3s in that order.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decode, gain, makeLoop, peak, rms, SR } from './lib.mjs';

const files = process.argv.slice( 2 );
if ( files.length !== 2 ) throw new Error( 'Usage: node tools/audio/build-tyre-squeal.mjs 2370.mp3 2371.mp3' );
const filters = 'highpass=f=480,lowpass=f=7600,equalizer=f=2550:t=o:w=1.2:g=2.7';
const [ a, b ] = files.map( ( file, i ) => {
	const take = decode( file, 1, i ? 4.6 : 0.105, i ? 1.75 : 1.695, filters );
	return gain( take, 1 / rms( take ) )[ 0 ];
} );
const overlap = Math.round( SR * 0.18 );
const joined = new Float32Array( a.length + b.length - overlap );
joined.set( a );
joined.set( b, a.length - overlap );
for ( let i = 0; i < overlap; i ++ ) {
	const theta = ( i + 0.5 ) / overlap * Math.PI / 2;
	joined[ a.length - overlap + i ] = a[ a.length - overlap + i ] * Math.cos( theta ) + b[ i ] * Math.sin( theta );
}
const loop = makeLoop( [ joined ], joined.length - overlap, overlap );
gain( loop, 10 ** ( -1 / 20 ) / peak( loop ) );
const dest = fileURLToPath( new URL( '../../public/rally/audio/tyre-squeal.wav', import.meta.url ) );
execFileSync( 'ffmpeg', [ '-v', 'error', '-y', '-f', 'f32le', '-ar', String( SR ), '-ac', '1', '-i', 'pipe:0',
	'-ar', '32000', '-c:a', 'pcm_s16le', '-fflags', '+bitexact', dest ], { input: Buffer.from( loop[ 0 ].buffer ) } );
