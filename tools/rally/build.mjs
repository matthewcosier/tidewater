import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath( new URL( '../../', import.meta.url ) );
const run = ( command, args, env = process.env ) => {
	const result = spawnSync( command, args, { cwd: root, stdio: 'inherit', env } );
	if ( result.error ) throw result.error;
	if ( result.status !== 0 ) process.exit( result.status || 1 );
};

const candidates = process.env.WASM_BINDGEN ? [ process.env.WASM_BINDGEN ] : [
	'wasm-bindgen', ...( process.env.RALLY_DIR ? [ resolve( process.env.RALLY_DIR, 'target/tools/bin/wasm-bindgen' ) ] : [] ),
];
const bindgen = candidates.find( command => {
	const result = spawnSync( command, [ '--version' ], { encoding: 'utf8' } );
	return result.status === 0 && result.stdout.trim() === 'wasm-bindgen 0.2.114';
} );
if ( ! bindgen ) throw new Error( 'Install wasm-bindgen-cli 0.2.114, or set WASM_BINDGEN to its executable. See docs/rally-integration.md.' );

// Panic messages embed source file paths: remap the home directory to ~ for reproducible output.
const rustflags = [ process.env.RUSTFLAGS, `--remap-path-prefix=${ homedir() }=~` ].filter( Boolean ).join( ' ' );
run( 'cargo', [ 'build', '--locked', '--manifest-path', 'rally-physics/Cargo.toml', '--target', 'wasm32-unknown-unknown', '--release', '-j', '6' ],
	{ ...process.env, RUSTFLAGS: rustflags } );
run( bindgen, [ '--target', 'web', '--out-dir', 'public/rally', '--out-name', 'rally_physics',
	'rally-physics/target/wasm32-unknown-unknown/release/tidewater_rally_physics.wasm' ] );
console.log( 'Built the Rally physics module in public/rally.' );
