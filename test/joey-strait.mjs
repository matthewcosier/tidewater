import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainData, BORDER_FADE } from '../src/world/TerrainData.js';
import { terminalToWorld, PLACES, BERTH } from '../src/ferry/Terminal.js';
import { GATE, CLEAR } from '../src/ferry/FerryService.js';

// Joey Island's strait (docs/ferry.md, design note 4). The crossing is the open-water passage the
// autopilot sails: from the end of her departure run (CLEAR out along the berth she leaves) to the
// far harbour's gate (GATE out along its berth). Full ahead the hull runs 1400 m in about 2 minutes
// at the 24 kn service top (test/ferry-speed.mjs), so each direction's passage is 1400 m +/- 100.

const berth = place => {

	const p = terminalToWorld( BERTH, undefined, place );
	return { x: p.x, z: p.z, yaw: place.yaw };

};
// a point d metres out along a berth's axis, as Autopilot.gate() takes it
const along = ( b, d ) => [ b.x + Math.sin( b.yaw ) * d, b.z + Math.cos( b.yaw ) * d ];

test( 'the open-water passage between the two harbours is 1400 m +/- 100 each way', () => {

	const tidewater = berth( PLACES.tidewater ), joey = berth( PLACES.joey );
	for ( const [ name, from, to ] of [ [ 'Tidewater to Joey', tidewater, joey ], [ 'Joey to Tidewater', joey, tidewater ] ] ) {

		const [ ax, az ] = along( from, CLEAR ), [ bx, bz ] = along( to, GATE );
		const leg = Math.hypot( bx - ax, bz - az );
		assert.ok( Math.abs( leg - 1400 ) <= 100, `${ name }: open-water passage ${ leg.toFixed( 0 ) } m, want 1400 +/- 100` );

	}

} );

// TerrainData pulls every texel within BORDER_FADE metres of the domain edge toward the -90 m deep
// floor: H = -90 + t ( H0 + 90 ), t = smoothstep( 0, BORDER_FADE, e ), e the distance to the edge.
// So a texel was land before the fade (H0 > 0) exactly when H + 90 > 90 t. None may be: a beach,
// a road bench or a yard in the band would sink, and nothing else would say so (moving Joey 1.15 km
// south onto a 3072 m deep domain put its south coast there).
test( 'no land lies in the border fade, so moving an island cannot sink a beach', () => {

	const terrain = new TerrainData();
	const { resX, resZ, texel, originX, originZ, heights } = terrain;
	const band = Math.ceil( BORDER_FADE / texel );
	let land = 0, first = null;
	for ( let j = 0; j < resZ; j ++ ) {

		const ej = Math.min( j, resZ - 1 - j );
		for ( let i = 0; i < resX; i ++ ) {

			if ( ej >= band && i >= band && i < resX - band ) i = resX - band; // skip the interior
			const e = Math.min( i, resX - 1 - i, ej ) * texel;
			if ( e <= 0 || e >= BORDER_FADE ) continue;
			const s = e / BORDER_FADE, t = s * s * ( 3 - 2 * s );
			if ( heights[ j * resX + i ] + 90 > 90 * t + 0.01 ) {

				land ++;
				first ??= `(${ ( originX + ( i + 0.5 ) * texel ).toFixed( 0 ) }, ${ ( originZ + ( j + 0.5 ) * texel ).toFixed( 0 ) }) ${ e.toFixed( 0 ) } m from the edge`;

			}

		}

	}

	assert.equal( land, 0, `${ land } land texels sit in the ${ BORDER_FADE } m border fade, first at ${ first }` );

} );
