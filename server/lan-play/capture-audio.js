// Capture only the private game tab's Web Audio output. The worklet emits silence to the host speakers.
(() => {
	const buses = new WeakMap(), connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
	let nextId = 0;
	const contexts = new Set(), sleeping = new Set();
	window.setLanAudioIdle = async idle => {
		for ( const ctx of contexts ) {
			if ( ctx.state === 'closed' ) { contexts.delete( ctx ); sleeping.delete( ctx ); continue; }
			if ( idle && ctx.state === 'running' ) { sleeping.add( ctx ); await ctx.suspend(); }
			else if ( ! idle && sleeping.delete( ctx ) ) await ctx.resume();
		}
	};
	function worklet() {
		class Capture extends AudioWorkletProcessor {
			constructor() { super(); this.pcm = new Int16Array( 2048 ); this.offset = 0; }
			process( inputs ) {
				const l = inputs[ 0 ][ 0 ], r = inputs[ 0 ][ 1 ] || l;
				if ( ! l ) return true;
				for ( let i = 0; i + 1 < l.length; i += 2 ) {
					this.pcm[ this.offset ++ ] = Math.round( Math.max( -1, Math.min( 1, ( l[i] + l[i+1] ) / 2 ) ) * 32767 );
					this.pcm[ this.offset ++ ] = Math.round( Math.max( -1, Math.min( 1, ( r[i] + r[i+1] ) / 2 ) ) * 32767 );
					if ( this.offset === this.pcm.length ) {
						this.port.postMessage( this.pcm.buffer, [ this.pcm.buffer ] );
						this.pcm = new Int16Array( 2048 ); this.offset = 0;
					}
				}
				return true;
			}
		}
		registerProcessor( 'tidewater-tab-audio', Capture );
	}
	function busFor( ctx ) {
		if ( buses.has( ctx ) ) return buses.get( ctx );
		const bus = ctx.createGain(), id = nextId ++;
		buses.set( ctx, bus ); contexts.add( ctx );
		connect.call( bus, ctx.destination );
		const url = URL.createObjectURL( new Blob( [ '(' + worklet.toString() + ')()' ], { type: 'text/javascript' } ) );
		ctx.audioWorklet.addModule( url ).then( () => {
			const tap = new AudioWorkletNode( ctx, 'tidewater-tab-audio', { channelCount: 2, channelCountMode: 'explicit' } );
			tap.port.onmessage = ( { data } ) => {
				window.sendGameAudio( id, ctx.sampleRate / 2, btoa( String.fromCharCode( ...new Uint8Array( data ) ) ) ).catch( () => {} );
			};
			connect.call( bus, tap );
			connect.call( tap, ctx.destination );
		} ).catch( e => console.error( 'Game audio capture:', e.message ) ).finally( () => URL.revokeObjectURL( url ) );
		return bus;
	}
	AudioNode.prototype.connect = function ( dest, ...args ) {
		if ( dest !== this.context.destination ) return connect.call( this, dest, ...args );
		connect.call( this, busFor( this.context ), ...args ); return dest;
	};
	AudioNode.prototype.disconnect = function ( ...args ) {
		if ( args[0] === this.context.destination && buses.has( this.context ) ) args[0] = buses.get( this.context );
		return disconnect.apply( this, args );
	};
	// A phone alternates between looking and tapping the captured menus.
	Element.prototype.requestPointerLock = async () => {};
})();
