import { clearSpawn, recoverySpot } from '../rally/Spawn.js';

// Effortless vehicle recovery and recall:
//  - Remembers the player's last used vehicle (car, jetski, or boat) when dismounting or wiping out.
//  - Opens an 8-second quick-remount window after a wipeout or car yeet: one tap of R hops back in.
//  - Pressing G on foot or in the water (or using the Radial Menu) summons the ride right beside you
//    so a runaway jetski or distant car never forces a long swim or hike back.
export const REMOUNT_WINDOW_MS = 8000;

export class VehicleRecall {

	constructor( app ) {

		this.app = app;
		this.lastKind = null;
		this.lastExitAt = - 1e9;
		this.lastWipeout = false;
		this.remountUntil = 0;
		this._prompt = { key: 'R', text: '' };

	}

	noteExit( kind, { wipeout = false, now = performance.now() } = {} ) {

		this.lastKind = kind;
		this.lastExitAt = now;
		this.lastWipeout = !! wipeout;
		this.remountUntil = wipeout ? now + REMOUNT_WINDOW_MS : 0;

	}

	clearRemount() {

		this.remountUntil = 0;

	}

	quickRemountPrompt( now = performance.now() ) {

		if ( now >= this.remountUntil || ! this.lastKind ) return null;
		const app = this.app, p = app.player;
		if ( ! p || ( p.mode !== 'walk' && p.mode !== 'swim' ) ) return null;
		if ( app.freeCam || app.rally?.active || app.jetskis?.riding || app.aviation?.active || app.glider?.active || app.chairlift?.active ) return null;
		if ( this.lastKind === 'jetski' && app.jetskis?.live ) {

			this._prompt.key = 'R';
			this._prompt.text = 'Back on jetski   ·   G  call ski';
			return this._prompt;

		}
		if ( this.lastKind === 'car' && app.rally?.model ) {

			this._prompt.key = 'R';
			this._prompt.text = 'Back in car   ·   G  deliver car here';
			return this._prompt;

		}
		return null;

	}

	tryQuickRemount( now = performance.now() ) {

		if ( ! this.quickRemountPrompt( now ) ) return false;
		const kind = this.lastKind;
		this.clearRemount();
		if ( kind === 'jetski' ) return this.recallJetski( { mount: true } );
		if ( kind === 'car' ) {

			const rally = this.app.rally;
			if ( ! rally ) return false;
			if ( rally.up && rally.up.y < 0.35 ) rally.recover();
			rally.enter();
			return true;

		}
		return false;

	}

	recall( { mount = null, kind = null } = {} ) {

		const app = this.app, p = app.player;
		if ( ! p || ! Number.isFinite( p.position.x + p.position.z ) ) return false;
		if ( app.chairlift?.active ) {

			app.chairlift.message?.( 'Exit the chairlift at a terminal before recalling a ride.' );
			return false;

		}
		const fx = - Math.sin( p.yaw || 0 ), fz = - Math.cos( p.yaw || 0 );
		let target = kind;
		if ( ! target ) {

			if ( p.mode === 'swim' ) target = this.lastKind === 'boat' && app.boatCtl ? 'boat' : 'jetski';
			else if ( this.lastKind === 'jetski' && app.terrainData?.heightAt( p.position.x + fx * 6, p.position.z + fz * 6 ) < 0.6 ) target = 'jetski';
			else target = 'car';

		}
		if ( target === 'jetski' ) return this.recallJetski( { mount: mount ?? ( p.mode === 'swim' ) } );
		if ( target === 'boat' ) return this.recallBoat( { mount: mount ?? false } );
		return this.recallCar( { mount: mount ?? false } );

	}

	recallJetski( { mount = true } = {} ) {

		const app = this.app, p = app.player, js = app.jetskis;
		const ski = js?.live || js?.skis?.[ 0 ];
		if ( ! js || ! ski || ! js.ctl ) return false;
		if ( ski !== js.live && js.makeLive ) js.makeLive( ski );
		const fx = - Math.sin( p.yaw || 0 ), fz = - Math.cos( p.yaw || 0 );
		const water = js.waterLevel ? js.waterLevel() : 0;
		const terrain = app.terrainData;
		let tx = p.position.x + fx * 2.6, tz = p.position.z + fz * 2.6;
		if ( p.mode !== 'swim' && terrain ) {

			// Find nearby open water along the player's view, or fall back to beach hire shallows.
			let found = false;
			for ( let dist = 4; dist <= 28; dist += 2 ) {

				const x = p.position.x + fx * dist, z = p.position.z + fz * dist;
				if ( terrain.heightAt( x, z ) < water - 0.55 ) { tx = x; tz = z; found = true; break; }

			}
			if ( ! found ) { tx = 26; tz = - 32; }

		}
		const faceYaw = Math.atan2( fx, fz );
		js.ctl.capsized = false;
		js.ctl.righting = 0;
		js.ctl.disembarkBrake = 0;
		js.ctl.place( tx, water + 0.16, tz, faceYaw );
		js.ctl.velocity.set( 0, 0, 0 );
		js.ctl.angular.set( 0, 0, 0 );
		js.burst?.( js.ctl.position, 1.0, 0.5 );
		app.audio?.splash?.( 0.5, js.ctl.position );
		this.clearRemount();
		if ( mount ) {

			if ( app.rally?.active ) app.rally.leave();
			app.aviation?.leave();
			app.glider?.leave();
			app.freeCam = false;
			js.mount( ski );
			app.ui?.ui?.toast?.( 'Back on the jetski' );

		} else {

			app.ui?.ui?.toast?.( 'Jetski pulled up nearby · press E to ride' );

		}
		return true;

	}

	recallCar( { mount = false } = {} ) {

		const app = this.app, p = app.player, rally = app.rally;
		if ( ! rally || ! app.terrainData || ! app.colliders ) return false;
		const fx = - Math.sin( p.yaw || 0 ), fz = - Math.cos( p.yaw || 0 );
		const wantX = p.position.x + fx * 7.0, wantZ = p.position.z + fz * 7.0;
		const yaw = Math.atan2( fx, fz );
		const peers = [ { x: p.position.x, z: p.position.z }, ...( rally.peerPositions?.() || [] ) ];
		let spot = null;
		try {

			spot = clearSpawn( app.terrainData, app.colliders, { x: wantX, z: wantZ, yaw, trunks: rally.trunks }, peers );

		} catch {

			spot = recoverySpot( app.terrainData, app.colliders, { x: wantX, z: wantZ }, { x: fx, z: fz }, peers, rally.trunks );

		}
		if ( ! spot ) return false;
		rally.place( spot );
		this.clearRemount();
		if ( mount ) {

			if ( app.jetskis?.riding ) app.jetskis.dismount();
			app.aviation?.leave();
			app.glider?.leave();
			rally.enter();

		} else {

			app.ui?.ui?.toast?.( `${ rally.profile?.name || 'Car' } delivered nearby · press E to drive` );

		}
		return true;

	}

	recallBoat( { mount = false } = {} ) {

		const app = this.app, p = app.player, b = app.boatCtl;
		if ( ! b ) return false;
		const fx = - Math.sin( p.yaw || 0 ), fz = - Math.cos( p.yaw || 0 );
		const water = p.waterH ?? 0;
		const tx = p.position.x + fx * 5.0, tz = p.position.z + fz * 5.0;
		b.position.set( tx, water + 0.1, tz );
		b.velocity?.set( 0, 0, 0 );
		b.throttle = 0;
		this.clearRemount();
		if ( mount && p.boardBoat ) p.boardBoat();
		else app.ui?.ui?.toast?.( 'Boat pulled alongside · press E to board' );
		return true;

	}

	update() {

		const app = this.app, p = app.player, inp = app.input;
		if ( ! p || ! inp || ! inp.enabled ) return;
		if ( app.freeCam || app.rally?.active || app.jetskis?.riding || app.aviation?.active || app.glider?.active || app.chairlift?.active ) return;
		if ( app.radialMenu?.open || app.game?.hud?.invOpen || app.game?.hud?.standOpen || app.game?.atm?.open ) return;
		if ( p.mode !== 'walk' && p.mode !== 'swim' ) return;

		if ( inp.hit( 'KeyG' ) ) {

			this.recall( { mount: p.mode === 'swim' } );
			return;

		}
		const remount = this.quickRemountPrompt();
		if ( remount && ! p.prompt ) {

			p.prompt = remount;
			if ( inp.hit( 'KeyR' ) ) this.tryQuickRemount();

		}

	}

}
