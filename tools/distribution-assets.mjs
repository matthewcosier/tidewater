// Lossless Git storage for the large runtime assets. The game uses ordinary GLB and WASM URLs.
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { brotliCompress, brotliDecompress, constants } from 'node:zlib';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const root = fileURLToPath( new URL( '../', import.meta.url ) );
const assets = {
	physics: 'rally/rally_physics_bg.wasm',
	carrier: 'aviation/carrier.glb',
};
const compress = promisify( brotliCompress ), decompress = promisify( brotliDecompress );
const [ action, name ] = process.argv.slice( 2 );
if ( ! [ 'pack', 'unpack' ].includes( action ) || ( name && ! Object.hasOwn( assets, name ) ) ) {
	throw new Error( 'Usage: node tools/distribution-assets.mjs pack|unpack [physics|carrier]' );
}

for ( const [ key, rel ] of Object.entries( assets ) ) {
	if ( name && name !== key ) continue;
	const raw = join( root, 'public', rel ), packed = join( root, 'assets/distribution', rel + '.br' );
	const packing = action === 'pack', target = packing ? packed : raw;
	const input = await readFile( packing ? raw : packed );
	const output = packing
		? await compress( input, { params: { [ constants.BROTLI_PARAM_QUALITY ]: 9 } } )
		: await decompress( input );
	const previous = await readFile( target ).catch( error => {
		if ( error.code !== 'ENOENT' ) throw error;
		return null;
	} );
	if ( previous?.equals( output ) ) continue;
	await mkdir( dirname( target ), { recursive: true } );
	const temporary = target + '.' + randomUUID();
	try {
		await writeFile( temporary, output );
		await rename( temporary, target );
	} finally {
		await rm( temporary, { force: true } );
	}
}

// This terminal differs only slightly from the existing island asset. Reuse its original
// bytes and apply the compact change list before serving the regular ferry model URL.
if ( action === 'unpack' && ! name ) {
	const base = await readFile( join( root, 'assets/distribution/ferry/terminal-base.glb' ) );
	const delta = JSON.parse( await decompress( await readFile( join( root, 'assets/distribution/ferry/terminal-change.json.br' ) ) ) );
	const hash = bytes => createHash( 'sha256' ).update( bytes ).digest( 'hex' );
	if ( hash( base ) !== delta.base ) throw new Error( 'Unexpected terminal base asset' );
	const model = Buffer.concat( delta.chunks.map( part => typeof part === 'string' ? Buffer.from( part, 'base64' ) : base.subarray( part[0], part[0] + part[1] ) ) );
	if ( hash( model ) !== delta.sha256 ) throw new Error( 'Invalid terminal asset' );
	const target = join( root, 'public/ferry/terminal.glb' );
	const temporary = target + '.' + randomUUID();
	try { await writeFile( temporary, model ); await rename( temporary, target ); }
	finally { await rm( temporary, { force: true } ); }
}
