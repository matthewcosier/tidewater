import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { attachMultiplayer } from './server/multiplayer.mjs';

export default defineConfig( ( { mode } ) => ( {
	plugins: [ mode === 'pages' ? {
		name: 'tidewater-public-site',
		transformIndexHtml() {
			return [
				{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: "connect-src 'self'; base-uri 'self'; object-src 'none'; form-action 'none'" }, injectTo: 'head-prepend' },
				{ tag: 'link', attrs: { rel: 'license', href: './LICENSE' }, injectTo: 'head' },
			];
		},
		generateBundle() {
			const read = file => readFileSync( new URL( file, import.meta.url ), 'utf8' );
			this.emitFile( { type: 'asset', fileName: 'LICENSE', source: read( './LICENSE' ) } );
			this.emitFile( { type: 'asset', fileName: 'CREDITS.md', source: read( './CREDITS.md' ).replaceAll( '](public/', '](' ) } );
			for ( const file of [ 'LICENSE-MIT', 'LICENSE-APACHE' ] ) {
				this.emitFile( { type: 'asset', fileName: 'licenses/avian3d/' + file, source: read( './rally-physics/vendor/avian3d/' + file ) } );
			}
		},
	} : {
		name: 'tidewater-shared-driving',
		configureServer( server ) { const close = attachMultiplayer( server.httpServer ); server.httpServer.on( 'close', close ); },
		configurePreviewServer( server ) { const close = attachMultiplayer( server.httpServer ); server.httpServer.on( 'close', close ); },
	} ],
	// relative asset paths: the build runs from any sub-path (GitHub Pages serves it under /tidewater/)
	base: './',
	build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
	// Test hosts disable HMR: parallel local lanes editing sources must not reload a running scenario.
	server: { port: 5188, strictPort: true, host: '127.0.0.1', hmr: process.env.TIDEWATER_NO_HMR ? false : undefined, watch: { ignored: [ '**/rally-physics/target/**', '**/assets/rally/**', '**/test-results*/**', '**/playwright-report/**' ] } },
} ) );
