// Both replays run at 120 Hz. Count one launch per continuous flight of at least 0.125 s.
const LAUNCH_TICKS = 15;

export class LaunchCounter {
	count = 0;
	longest = 0;
	airborne = 0;

	observe( snapshot ) {
		const loadedWheels = snapshot[ 10 ];
		this.airborne = loadedWheels === 0 ? this.airborne + 1 : 0;
		if ( this.airborne === LAUNCH_TICKS ) this.count ++;
		this.longest = Math.max( this.longest, this.airborne );
	}
}
