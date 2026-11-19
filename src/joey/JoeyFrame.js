import { WORLD } from '../world/WorldLayout.js';

// Joey Island's frame. Its outline and ridges (src/world/terrain/IslandShape.js), its ring road
// (JOEY_LOOP, JOEY_SEAM and JOEY_START in src/world/CoastalRoute.js) and its jetski spots
// (src/jetski/spots.js) were laid out in world metres while its terminal stood at JOEY_LAYOUT
// (-176, 652). They stay written in that layout and joeyAt() carries them to wherever
// WORLD.joeyTerminal stands now, so moving the island is one number. The move is a pure
// translation: the island keeps its compass bearing (its south coast faces the open ocean and
// the swell), and the village, the terminal fill and the ATM already live in the terminal frame.
export const JOEY_LAYOUT = Object.freeze( { x: - 176, z: 652 } ); // m, world xz of the terminal in the layout

// [x, z] in the layout (m) -> [x, z] in the world now (m)
export function joeyAt( x, z ) {

	const p = WORLD.joeyTerminal.position;
	return [ x + p.x - JOEY_LAYOUT.x, z + p.z - JOEY_LAYOUT.z ];

}
