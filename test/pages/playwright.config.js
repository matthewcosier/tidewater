import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const port = Number( process.env.PAGES_TEST_PORT || 5386 );
const local = `http://127.0.0.1:${ port }/tidewater/`;

export default defineConfig( {
	testDir: '.', testMatch: '*.spec.js', timeout: 150_000, workers: 1,
	use: {
		baseURL: process.env.PAGES_TEST_URL || local,
		viewport: { width: 1280, height: 720 },
		launchOptions: { args: [ '--enable-unsafe-webgpu', ...( process.platform === 'darwin' ? [ '--use-angle=metal' ] : [] ) ] },
	},
	webServer: process.env.PAGES_TEST_URL ? undefined : {
		command: `npm run preview -- --mode pages --host 127.0.0.1 --port ${ port } --strictPort --base /tidewater/`,
		cwd: fileURLToPath( new URL( '../../', import.meta.url ) ),
		url: local, reuseExistingServer: false,
	},
} );
