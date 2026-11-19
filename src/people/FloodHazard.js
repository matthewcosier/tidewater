
export const HU_ADULT = 0.6; // m²/s
export const HU_CHILD = 0.4; // m²/s

// The h*u line (m²/s) for this person.
export function huLimit( person ) {

	return person?.brain?.type === 'kid' ? HU_CHILD : HU_ADULT;

}

// Depth above the feet (m) times the flow speed (m/s). Dry feet or still water give 0.
export function floodHazard( waterY, feetY, ux, uz ) {

	const depth = waterY - feetY;
	if ( ! ( depth > 0 ) ) return 0;
	const hu = depth * Math.sqrt( ux * ux + uz * uz );
	return Number.isFinite( hu ) ? hu : 0;

}
