// Which HUD chips belong on screen in each player context:
//   purse     money and cooler: shown only when actively fishing/shopping, near an ATM, or aboard the boat
//   pin       the ATM card PIN: shown only on foot near an ATM or while using an ATM
//   guidance  the evacuation hint: on foot only, it tells the walking player where to run
//
// Ordinary island exploration, driving, flight and free camera stay uncluttered.
import { ON_FOOT } from '../player/Player.js';

// ctx: { mode: Player.mode, freeCam: App.freeCam, driving: Rally.active, fishing: boolean, nearAtm: boolean }.
// `out` lets the per-frame caller (AppUI) reuse one object instead of allocating every frame.
export function hudChips( { mode, freeCam = false, driving = false, fishing = false, nearAtm = false }, out = {} ) {

	// the rally car keeps the player in 'walk' while it drives, hence the separate flag
	const onFoot = ON_FOOT.has( mode ) && ! driving && ! freeCam;
	const aboard = mode === 'boat' && ! freeCam;
	out.purse = ( onFoot && ( !! fishing || !! nearAtm ) ) || aboard;
	out.pin = onFoot && !! nearAtm;
	out.guidance = onFoot;
	return out;

}
