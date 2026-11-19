const $ = selector => document.querySelector( selector );
const canvas = $( 'canvas' ), view = canvas.getContext( '2d', { alpha: false } );
const controls = $( '#controls' ), lobby = $( '#lobby' );
let ws, retry, heartbeat, playing = false, suspended = false, sound;
let choosing = false;
let pendingFrame = null, decoding = false, frameEpoch = 0;
const nextAudio = new Map(), pressed = new Map();
function send( object ) { if ( ws?.readyState === WebSocket.OPEN ) ws.send( JSON.stringify( object ) ); }
function release() {
	pressed.clear();
	for ( const b of controls.querySelectorAll( '.held' ) ) b.classList.remove( 'held' );
	send( { type: 'release' } );
}
function closeChoices() { if ( $( '#choice' ).open ) $( '#choice' ).close(); }
$( '#cancel' ).onclick = closeChoices;
function showChoices( m ) {
	const dialog = $( '#choice' ), list = dialog.querySelector( 'div' );
	dialog.querySelector( 'h2' ).textContent = m.name;
	list.replaceChildren();
	m.items.forEach( ( item, index ) => {
		const button = document.createElement( 'button' );
		button.textContent = item.label; button.disabled = item.disabled;
		button.setAttribute( 'aria-pressed', String( item.selected ) );
		button.onclick = () => { send( { type: 'option', index } ); closeChoices(); };
		list.append( button );
	} );
	if ( ! dialog.open ) dialog.showModal();
}
function showMenu() {
	closeChoices();
	release(); playing = false; controls.inert = true; lobby.hidden = false; $( '#menu' ).hidden = true;
}
function state( s ) {
	controls.dataset.hostKeys = ( s.keys || [] ).join( ' ' );
	controls.dataset.turnRate = String( s.turnRate || 0 );
	if ( ! choosing ) $( '#status' ).textContent = s.ready ? ( playing ? ( s.driving ? s.speed + ' km/h' : 'On foot' ) : 'Mac ready' ) : 'Loading the island on the Mac…';
	$( '#drive' ).disabled = $( '#walk' ).disabled = ! s.ready || choosing;
	$( '#resume' ).hidden = ! ( s.ready && s.started );
	$( '[data-key=KeyW]' ).textContent = s.driving ? 'Throttle' : 'Forward';
	$( '[data-key=KeyS]' ).textContent = s.driving ? 'Brake' : 'Back';
	$( '[data-key=Space]' ).textContent = s.driving ? 'Handbrake' : 'Jump';
	$( '[data-key=KeyE]' ).textContent = s.driving ? 'Exit' : 'Interact';
	$( '[data-key=KeyR]' ).hidden = ! s.driving;
	if ( ! s.ready && playing ) showMenu();
}
async function paint() {
	if ( decoding ) return;
	decoding = true;
	try {
		while ( pendingFrame ) {
			const frame = pendingFrame, epoch = frameEpoch;
			pendingFrame = null;
			const url = URL.createObjectURL( new Blob( [ frame ], { type: 'image/jpeg' } ) );
			try {
				const picture = new Image();
				await new Promise( ( resolve, reject ) => { picture.onload = resolve; picture.onerror = reject; picture.src = url; } );
				if ( epoch === frameEpoch ) {
					view.drawImage( picture, 0, 0, canvas.width, canvas.height );
					canvas.dataset.frames = String( ( Number( canvas.dataset.frames ) || 0 ) + 1 );
				}
			} finally { URL.revokeObjectURL( url ); }
		}
	} catch { /* the next independent JPEG can recover */ }
	finally { decoding = false; }
}
function pcm( data ) {
	if ( ! playing || sound?.state !== 'running' || data.byteLength < 10 || ( data.byteLength - 6 ) % 4 ) return;
	const header = new DataView( data ), id = header.getUint8( 1 ), hz = header.getUint32( 2, true );
	if ( hz < 8000 || hz > 96000 ) return;
	const samples = new Int16Array( data, 6 ), count = samples.length / 2;
	const now = sound.currentTime, scheduled = nextAudio.get( id ) || 0;
	if ( scheduled - now > .22 ) return;
	let audible = false;
	const buffer = sound.createBuffer( 2, count, hz );
	for ( let channel = 0; channel < 2; channel ++ ) {
		const dst = buffer.getChannelData( channel );
		for ( let i = 0; i < count; i ++ ) {
			const sample = samples[2*i+channel];
			if ( Math.abs( sample ) > 20 ) audible = true;
			dst[i] = sample / 32768;
		}
	}
	const source = sound.createBufferSource(); source.buffer = buffer; source.connect( sound.destination );
	const start = scheduled < now + .005 ? now + .045 : scheduled;
	source.start( start ); nextAudio.set( id, start + buffer.duration );
	if ( audible ) canvas.dataset.audible = 'true';
	canvas.dataset.audioPackets = String( ( Number( canvas.dataset.audioPackets ) || 0 ) + 1 );
}
function connect() {
	if ( suspended || ( ws && ws.readyState < WebSocket.CLOSING ) ) return;
	clearTimeout( retry );
	const socket = new WebSocket( ( location.protocol === 'https:' ? 'wss://' : 'ws://' ) + location.host + '/play' );
	ws = socket; socket.binaryType = 'arraybuffer';
	socket.onopen = () => { clearInterval( heartbeat ); heartbeat = setInterval( () => send( { type: 'heartbeat' } ), 1200 ); };
	socket.onmessage = ( { data } ) => {
		if ( socket !== ws ) return;
		if ( typeof data !== 'string' ) {
			const type = new Uint8Array( data, 0, 1 )[0];
			if ( type === 1 ) { pendingFrame = new Uint8Array( data, 1 ); paint(); }
			if ( type === 2 ) pcm( data );
			return;
		}
		const m = JSON.parse( data );
		if ( m.type === 'state' ) state( m );
		if ( m.type === 'options' ) showChoices( m );
		if ( m.type === 'playing' ) { choosing = false; playing = true; controls.inert = false; lobby.hidden = true; $( '#menu' ).hidden = false; }
		if ( m.type === 'error' ) { choosing = false; $( '#status' ).textContent = m.text; $( '#drive' ).disabled = $( '#walk' ).disabled = false; }
		if ( m.type === 'busy' ) $( '#status' ).textContent = 'Another phone is playing. Waiting to connect…';
	};
	socket.onclose = e => {
		if ( socket !== ws ) return;
		clearInterval( heartbeat ); choosing = false; frameEpoch ++; pendingFrame = null; nextAudio.clear(); showMenu();
		$( '#drive' ).disabled = $( '#walk' ).disabled = true; $( '#resume' ).hidden = true;
		if ( e.reason !== 'Controller in use' ) $( '#status' ).textContent = 'Reconnecting to the Mac…';
		if ( ! suspended ) retry = setTimeout( connect, 1400 );
	};
}
function openMode( mode ) {
	if ( choosing ) return;
	choosing = true;
	$( '#status' ).textContent = mode === 'gt3' ? 'Starting the GT3…' : 'Opening the island…';
	if ( ! sound ) { const AC = window.AudioContext || window.webkitAudioContext; if ( AC ) sound = new AC(); }
	sound?.resume().catch( () => {} );
	$( '#drive' ).disabled = $( '#walk' ).disabled = true;
	send( mode === 'resume' ? { type: 'resume' } : { type: 'start', mode } );
}
$( '#drive' ).onclick = () => openMode( 'gt3' );
$( '#walk' ).onclick = () => openMode( 'walk' );
$( '#resume' ).onclick = () => openMode( 'resume' );
$( '#menu' ).onclick = showMenu;
for ( const button of controls.querySelectorAll( '[data-key]' ) ) {
	const key = button.dataset.key;
	button.onpointerdown = e => {
		if ( ! playing ) return;
		e.preventDefault(); button.setPointerCapture( e.pointerId );
		if ( ! [ ...pressed.values() ].includes( key ) ) send( { type: 'key', key, down: true } );
		pressed.set( e.pointerId, key ); button.classList.add( 'held' );
	};
	const up = e => {
		if ( ! pressed.delete( e.pointerId ) || [ ...pressed.values() ].includes( key ) ) return;
		button.classList.remove( 'held' ); send( { type: 'key', key, down: false } );
	};
	button.onpointerup = button.onpointercancel = button.onlostpointercapture = up;
}
let finger;
canvas.onpointerdown = e => {
	if ( ! playing || finger ) return;
	e.preventDefault(); canvas.setPointerCapture( e.pointerId );
	finger = { id: e.pointerId, x: e.clientX, y: e.clientY, firstX: e.clientX, firstY: e.clientY, dragged: false };
};
canvas.onpointermove = e => {
	if ( ! finger || e.pointerId !== finger.id ) return;
	if ( Math.hypot( e.clientX - finger.firstX, e.clientY - finger.firstY ) > 5 ) finger.dragged = true;
	if ( finger.dragged ) {
		const factor = canvas.width / canvas.getBoundingClientRect().width;
		send( { type: 'look', x: Math.max( -200, Math.min( 200, ( e.clientX - finger.x ) * factor ) ), y: Math.max( -200, Math.min( 200, ( e.clientY - finger.y ) * factor ) ) } );
	}
	finger.x = e.clientX; finger.y = e.clientY;
};
canvas.onpointerup = e => {
	if ( ! finger || e.pointerId !== finger.id ) return;
	const rect = canvas.getBoundingClientRect();
	if ( ! finger.dragged ) send( { type: 'tap', x: ( e.clientX - rect.left ) / rect.width, y: ( e.clientY - rect.top ) / rect.height } );
	finger = null;
};
canvas.onlostpointercapture = canvas.onpointercancel = () => { finger = null; };
function visibility( hidden ) {
	suspended = hidden;
	if ( hidden ) { release(); finger = null; clearTimeout( retry ); ws?.close(); }
	else connect();
}
document.addEventListener( 'visibilitychange', () => visibility( document.hidden ) );
window.addEventListener( 'blur', release );
window.addEventListener( 'pagehide', () => visibility( true ) );
window.addEventListener( 'pageshow', () => visibility( false ) );
connect();
