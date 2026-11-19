import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath( new URL( '../../', import.meta.url ) );
const gamePort = Number( process.env.LAN_TEST_GAME_PORT || 5350 );
const port = Number( process.env.LAN_TEST_PORT || 5351 );
export default defineConfig( {
	testDir: '.', testMatch: '*.spec.js', timeout: 180000, workers: 1, retries: 0,
	outputDir: process.env.PW_OUT || '../../test-results/lan-play',
	use: { ...devices[ 'iPhone 17 Pro landscape' ], browserName: 'webkit', baseURL: 'http://127.0.0.1:' + port },
	webServer: [
		{ cwd, command: 'node server/start.mjs', url: 'http://127.0.0.1:' + gamePort,
			env: { HOST: '127.0.0.1', PORT: String( gamePort ) }, reuseExistingServer: false },
		{ cwd, command: 'node server/lan-play/start.mjs', url: 'http://127.0.0.1:' + port,
			env: { HOST: '127.0.0.1', PORT: String( port ), GAME_URL: 'http://127.0.0.1:' + gamePort + '/' }, reuseExistingServer: false },
	],
} );
