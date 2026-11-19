import * as THREE from '../engine/index.js';

// Shared world layout. Coordinates in meters, y up, sea level y = 0.
// The open ocean lies to the south (+z); the island to the north (-z).
// Sun rises in the east (+x) and sets in the west (-x).

// The pier's centreline. Its entrance arch posts stand at PIER_X +- pileOff (Pier.js), so the arch is centred
// on it and the start (below) is placed on it.
const PIER_X = 55; // m

export const WORLD = {
	// Heightmap domain, the one source of truth for every terrain grid (CPU heights, GPU textures,
	// rally WASM heightfield, masks, shore field). A rectangle at 1 m texels: x -1024..1024 and
	// z -1024..2304, so the ferry crossing south of the island runs over generated seabed. sizeZ may
	// grow again: derive every count as size / cell per axis, never hard-code it. Both sizes stay
	// multiples of 64 m (8 m grid A, 8-texel min/max tiles, 4 m shadow and shore cells, 8 x 8
	// compute workgroups).
	terrain: { sizeX: 2048, sizeZ: 3328, texel: 1, originX: - 1024, originZ: - 1024 }, // m

	// Central sandy beach inside the bay, shoreline near z ≈ -42 at x = 0.
	beach: { xMin: - 150, xMax: 170 },

	pier: {
		x: PIER_X,
		zStart: - 64, // on dry sand
		zEnd: 40, // end of pier (~4 m depth)
		deckHeight: 2.3, // deck surface above sea level
		width: 2.6,
		headWidth: 14, // T-shaped platform at the end
		headDepth: 7,
	},

	// Where the boat is moored: east side of the pier head, bow pointing south.
	boatDock: { position: new THREE.Vector3( 64.5, 0, 36.5 ), heading: 0 },

	village: { center: new THREE.Vector3( 40, 0, - 118 ), radius: 95 },

	reef: { center: new THREE.Vector3( - 78, 0, 58 ), radius: 58 },

	spawn: { position: new THREE.Vector3( 18, 0, - 60 ), yaw: Math.PI }, // kept clear of rocks, plants and debris
	start: { position: new THREE.Vector3( PIER_X, 0, - 71 ), yaw: Math.PI },

	// The ferry terminal (src/ferry/Terminal.js): where its glTF frame's origin (the docked ferry's
	// stern-ramp hinge line at sea level) sits, and its yaw (0: the berth opens south, out to sea).
	ferryTerminal: { position: new THREE.Vector3( 150, 0, 300 ), yaw: 0 },
	// Joey Island's terminal across the strait: the same terminal, its berth opening north-west
	// (yaw 220 degrees), its fill on the island's north-west corner. Moved 1150 m south (2026-10-05, was z 652) so
	// the open-water passage is 1400 m, 2 minutes at service speed (test/joey-strait.mjs). Joey's land,
	// ring road and jetski spots follow this one number (src/joey/JoeyFrame.js).
	joeyTerminal: { position: new THREE.Vector3( - 176, 0, 1802 ), yaw: 220 * Math.PI / 180 },

	// Incoming swell direction (unit, travel direction)
	swellDir: new THREE.Vector2( - 0.12, - 1 ).normalize(),
};
