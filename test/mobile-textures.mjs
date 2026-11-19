import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { decodePNG } from '../src/world/marine/WhaleTextures.js';

test( 'The iPhone whale atlas retains the mean of all four packed channels at one eighth scale', async () => {
	const file = await readFile( new URL( '../public/models/whale/humpback_albedo.png', import.meta.url ) );
	const blob = file.buffer.slice( file.byteOffset, file.byteOffset + file.byteLength );
	const full = await decodePNG( blob ), mobile = await decodePNG( blob, 512 );
	assert.equal( mobile.data.byteLength, 512 * 256 * 4 );
	assert.equal( mobile.width, 512 );
	assert.equal( mobile.height, 256 );
	for ( const [ x, y ] of [ [ 40, 72 ], [ 64, 128 ], [ 370, 194 ], [ 511, 255 ] ] ) {
		for ( let c = 0; c < 4; c ++ ) {
			let sum = 0;
			for ( let j = 0; j < 8; j ++ ) for ( let i = 0; i < 8; i ++ ) sum += full.data[ ( ( y * 8 + j ) * full.width + x * 8 + i ) * 4 + c ];
			assert.equal( mobile.data[ ( y * mobile.width + x ) * 4 + c ], Math.round( sum / 64 ) );
		}
	}
} );
