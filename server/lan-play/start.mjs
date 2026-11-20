import { VEHICLES } from '../../src/rally/Vehicles.js';
import { STARTS } from '../../src/rally/StartLocations.js';
import { playerAppearance, SHIRTS, SKIN_TONES } from '../../src/player/Appearance.js';
import { createServer as http } from 'node:http';
import { createServer as https } from 'node:https';
import { readFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { openGame } from './host.mjs';

const host = process.env.HOST || '127.0.0.1', port = Number( process.env.PORT || 5193 );
const gameURL = process.env.GAME_URL || 'http://127.0.0.1:5189/';
const tls = process.env.HTTPS_CERT && process.env.HTTPS_KEY;
const files = new Map( [ [ '/', [ 'index.html', 'text/html' ] ], [ '/controller.css', [ 'controller.css', 'text/css' ] ], [ '/controller.js', [ 'controller.js', 'text/javascript' ] ] ] );
for ( const file of [ 'ui/IslandStart.js', 'rally/Vehicles.js', 'rally/StartLocations.js', 'player/Appearance.js', 'ui/island-start.css' ] )
	files.set( '/src/' + file, [ '../../src/' + file, file.endsWith( '.css' ) ? 'text/css' : 'text/javascript' ] );
const previews = [ ...Object.keys( VEHICLES ) ];
for ( const shirt of SHIRTS.keys() ) for ( const tone of SKIN_TONES.keys() ) for ( const hat of [ 0, 1 ] )
	previews.push( `player-${ shirt }-${ tone }-${ hat }` );
for ( const key of previews ) files.set( '/ui/garage/' + key + '.webp', [ '../../public/ui/garage/' + key + '.webp', 'image/webp' ] );

async function serve( req, res ) {
	const entry = files.get( req.url.split( '?' )[ 0 ] );
	if ( ! entry || ! [ 'GET', 'HEAD' ].includes( req.method ) ) { res.writeHead( 404 ).end(); return; }
	try {
		const bytes = await readFile( new URL( entry[0], import.meta.url ) );
		res.writeHead( 200, { 'Content-Type': entry[1], 'Content-Length': bytes.length, 'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
			'Content-Security-Policy': "default-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" } );
		res.end( req.method === 'HEAD' ? undefined : bytes );
	} catch { res.writeHead( 500 ).end(); }
}
const server = tls ? https( { cert: await readFile( process.env.HTTPS_CERT ), key: await readFile( process.env.HTTPS_KEY ) }, serve ) : http( serve );
const sockets = new WebSocketServer( { noServer: true, maxPayload: 1024, perMessageDeflate: false } );
let peer = null, game = null, ready = false, started = false, lastPicture, stopping = false, busy = false;
let serial = Promise.resolve(), lastState = { driving: false, car: '', speed: 0 };
let pending = 0, rendererId = 0;
const send = ( ws, obj ) => { if ( ws?.readyState === WebSocket.OPEN ) ws.send( JSON.stringify( obj ) ); };
const status = () => send( peer, { type: 'state', ready, started, ...lastState } );
function enqueue( job ) {
	serial = serial.then( job ).catch( error => { console.error( 'Game input:', error.message ); send( peer, { type: 'error', text: 'The game could not complete that action.' } ); } );
}
async function launch() {
	const id = ++ rendererId;
	ready = started = false; lastPicture = null; status();
	const failed = message => {
		if ( id !== rendererId || stopping ) return;
		rendererId ++; ready = started = false;
		console.error( message ); status();
		const old = game; game = null; old?.close().catch( () => {} );
		setTimeout( () => { if ( ! stopping ) launch(); }, 3000 );
	};
	try {
		const opened = await openGame( gameURL, {
			picture: data => {
				if ( id !== rendererId ) return;
				lastPicture = Buffer.concat( [ Buffer.from( [ 1 ] ), Buffer.from( data, 'base64' ) ] );
				if ( peer?.readyState === WebSocket.OPEN && peer.bufferedAmount < 160000 ) peer.send( lastPicture );
			},
			audio: ( stream, rate, data ) => {
				if ( id !== rendererId || peer?.readyState !== WebSocket.OPEN || peer.bufferedAmount > 180000 || ! started ) return;
				const header = Buffer.alloc( 6 ); header[0] = 2; header[1] = stream; header.writeUInt32LE( Math.round( rate ), 2 );
				peer.send( Buffer.concat( [ header, Buffer.from( data, 'base64' ) ] ) );
			},
			options: options => send( peer, { type: 'options', ...options } ),
			failure: failed,
		} );
		if ( id !== rendererId || stopping ) { await opened.close(); return; }
		game = opened; await game.setIdle( true ); lastState = await game.state(); ready = true; status(); console.log( 'Mac game ready' );
	} catch ( e ) { failed( e.message ); }
}
server.on( 'upgrade', ( req, socket, head ) => {
	if ( req.url !== '/play' || req.headers.origin !== ( tls ? 'https://' : 'http://' ) + req.headers.host ) { socket.destroy(); return; }
	sockets.handleUpgrade( req, socket, head, ws => sockets.emit( 'connection', ws ) );
} );
sockets.on( 'connection', ws => {
	if ( peer ) { send( ws, { type: 'busy' } ); ws.close( 1000, 'Controller in use' ); return; }
	peer = ws; ws.lastSeen = Date.now(); status();
	if ( lastPicture ) ws.send( lastPicture );
	ws.on( 'error', () => ws.terminate() );
	ws.on( 'pong', () => { ws.lastSeen = Date.now(); } );
	ws.on( 'message', ( bytes, binary ) => {
		if ( binary || ws !== peer ) return;
		let m; try { m = JSON.parse( bytes ); } catch { return; }
		if ( ! m || typeof m.type !== 'string' ) return;
		ws.lastSeen = Date.now();
		if ( m.type === 'heartbeat' || ! ready || !game ) return;
		if ( m.type === 'start' ) {
			// Older phone clients send just gt3 or walk.
			if ( m.mode === 'gt3' ) m = { type: 'start', mode: 'drive', car: 'gt3rs', location: 'coast' };
			if ( ! [ 'drive', 'walk' ].includes( m.mode ) ) return;
			if ( m.mode === 'drive' && ( ! Object.hasOwn( VEHICLES, m.car ) || ! Object.hasOwn( STARTS, m.location ) ) ) return;
			m.appearance = playerAppearance( m.appearance );
		}
		if ( pending >= 64 ) { ws.close( 1008, 'Input backlog' ); return; }
		pending ++;
		enqueue( async () => {
			try {
				if ( ws !== peer || ! game || ! ready ) return;
				if ( m.type === 'start' || m.type === 'resume' ) await game.setIdle( false );
				if ( m.type === 'resume' ) { send( ws, { type: 'playing' } ); return; }
				await game.input( m );
				if ( m.type === 'start' ) {
					started = true; lastState = await game.state(); status(); send( ws, { type: 'playing' } );
				}
			} finally { pending --; }
		} );
	} );
	ws.on( 'close', () => {
		if ( ws !== peer ) return;
		peer = null;
		enqueue( async () => { await game?.release(); await game?.setIdle( true ); } );
	} );
} );
const monitor = setInterval( async () => {
	if ( ! peer ) return;
	if ( Date.now() - peer.lastSeen > 5500 ) { peer.terminate(); return; }
	peer.ping();
	if ( ! ready || ! game || busy ) return;
	busy = true;
	try { lastState = await game.state(); status(); } catch { /* page restart owns its status */ }
	finally { busy = false; }
}, 800 );
server.listen( port, host, () => { console.log( 'LAN play listening on', server.address().port ); launch(); } );
async function shutdown() {
	if ( stopping ) return;
	stopping = true; clearInterval( monitor ); peer?.terminate(); sockets.close(); server.close();
	await game?.close(); process.exit( 0 );
}
for ( const signal of [ 'SIGTERM', 'SIGINT' ] ) process.once( signal, shutdown );
