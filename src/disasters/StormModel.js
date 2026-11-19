// The storm a tornado comes out of: its geometry, cover, light and rain as plain functions
// (docs/tornado-visuals.md, "Design: the storm"). World metres, seconds, mm/h. No engine imports, so
// node tests read exactly what the game draws from. StormSky.js holds the state and feeds the
// shaders; STORM_WGSL below is the shader twin of stormCover and stormRain (same maths, plus the
// noise the CPU replaces by its mean).
//
// Geometry `g` (StormSky.geometry): on; x, z the storm's anchor (the tornado); fx, fz the unit
// vector it moves along; cx, cz the overcast shield's centre; edge the shield's edge radius (m);
// breaks 0..1; baseY the world height of the storm base (m); wallRadius (m); rain 0..1.

export const STORM = Object.freeze( {
	// A supercell's low deck is 10-30 km across under an anvil 100-300 km long (NWS SKYWARN Advanced
	// Spotters' Field Guide, NOAA PA 92055). Declared: opaque out to 16 km from a centre 5 km ahead of
	// the tornado, so its edge is 11-21 km from the tornado and the clear strip under a 750-1000 m base
	// stands 2-5 degrees tall.
	shieldRadius: 16000, // m, the opaque overcast
	shieldLead: 5000, // m, shield centre ahead of the tornado along its motion
	veil: 4500, // m, the thin leading edge: cover ramps from none to full across it
	ragged: 3000, // m, the edge wanders in and out by half this (shader only, zero mean)
	// Optical depth of the overcast along a line through it at full cover. A deep cumulonimbus is
	// 100-400; 14 already leaves under a millionth of the direct beam, which is what the eye can tell.
	sunDepth: 14,
	// Diffuse light reaching the ground under the deck, as a share of the clear global irradiance.
	// Two-stream transmittance of a thick conservative cloud, 1 / ( 1 + 0.75 tau ( 1 - g ) ), g 0.85:
	// 8 % at tau 100, 4.3 % at 200, 2.2 % at 400 (Bohren and Clothiaux 2006, ch. 5). Declared, the
	// violent end of a tornadic storm: 4.5 % (22x down).
	transmittance: 0.045,
	// Light through deep cloud is grey with a green cast (the frame's clear sky light is blue): the
	// deck keeps a fifth of the clear light's colour.
	keepColour: 0.2,
	cast: [ 0.94, 1.0, 0.95 ],
	// The clear strip under the far edge adds to the light at the ground: declared 30 % of the deck's.
	stripShare: 0.3,
	stripGain: 0.6, // radiance of the far strip as a share of the fine-day horizon (seen through storm haze)
	horizonShare: 0.45, // the frame's horizon colour (fog, side light) under the deck, as a share of the strip
	// The thin veil at the leading edge is sunlit cloud: declared 30 % of the clear global light as radiance.
	veilLight: 0.3,
	haze: 16000, // m, e-folding distance of the storm's own haze under the deck (visibility about 60 km / 3.9)
	// The eye and a camera only partly follow the light down. The meter's reference and its ceiling
	// both fall under the deck, so the frame stays about three stops under a fine day (declared).
	exposureRef: 0.5, // multiplier of the meter's reference luminance at full cover
	exposureMax: 0.4, // multiplier of the meter's highest exposure at full cover
	// Rain (Markowski and Richardson 2010, ch. 8): the forward-flank core ahead and left of the
	// tornado, the hook wrapped round its rear, the inflow notch ahead and right left dry. Positions
	// and radii in wall-cloud radii, so they scale with the seeded storm.
	coreAhead: 1.7, coreLeft: 0.8, coreRadius: 1.2,
	hookBehind: 0.5, hookLeft: 0.35, hookRadius: 0.8,
	notchAhead: 0.3, notchRight: 0.9, // a point in the dry inflow notch
	coreRate: 100, // mm/h (cores rain 50-150: the violent end)
	hookRate: 25, // mm/h (10-30)
	rainEdge: 0.35, // share of a disc's radius over which the rain rate falls to nothing
	rainEase: 30, // s of the clearing over which the rain stops
	fallSpeed: 9, // m/s, 4-5 mm drops (Gunn and Kinzer 1949, J. Meteor. 6)
	// Optical extinction of rain, 0.312 R^0.67 per km (Atlas 1953, J. Meteor. 10).
	extinctionK: 0.312e-3, extinctionP: 0.67, // 1/m at R mm/h
	centreTime: 6, // s, time constant with which the shield moves to a new storm during a clearing
	drift: 12, // m/s, the deck's texture moves with the storm's inflow
	// Lightning light (scene units, as the frame's sun colour): the glow inside the deck at a pulse's
	// peak, the share of it that reaches the ground as sky light, and the gain on the image-based light.
	flashRadiance: 9,
	flashRadius: 1500, // m, e-folding radius of an in-cloud flash's glow in the deck
	flashSky: 0.9, // added to the frame sky irradiance at the peak of a flash overhead
	flashEnv: 9, // image-based light multiplied by 1 + this at the peak of a flash overhead
	flashReach: 2500, // m, distance at which a flash's light on the ground has halved
} );

const smooth = ( x ) => {

	const t = Math.min( 1, Math.max( 0, x ) );
	return t * t * ( 3 - 2 * t );

};

// Edge radius of the shield for an arrival state 0..1 (m): the veil's outer edge.
export function shieldEdge( shield ) {

	return shield * ( STORM.shieldRadius + STORM.veil );

}

// Share of the overcast left when the breaks have opened b (0..1). The shader opens holes where a
// low-frequency noise n (uniform over 0..1) is below the threshold: smoothstep( 1.3 b - 0.3, 1.3 b, n ).
// This is that function's mean over n.
export function breakShare( b ) {

	return Math.min( 1, Math.max( 0, 1.15 - 1.3 * b ) );

}

// Cover of the overcast (0..1) at world x, z: full inside the shield, a veil across its leading
// edge, less as the breaks open.
export function stormCover( g, x, z ) {

	if ( ! g.on ) return 0;
	const d = Math.hypot( x - g.cx, z - g.cz );
	return ( 1 - smooth( ( d - ( g.edge - STORM.veil ) ) / STORM.veil ) ) * breakShare( g.breaks );

}

// Cover on the line from a point toward a direction (unit vector, y up), where that line meets the
// storm base. 0 for a line that never meets it (from above the base, or level and below).
export function stormCoverToward( g, x, y, z, dx, dy, dz ) {

	const rise = g.baseY - y;
	if ( ! g.on || rise <= 1 || dy <= 0.002 ) return 0;
	const t = rise / dy;
	return stormCover( g, x + dx * t, z + dz * t );

}

// Transmittance of the storm for the direct beam: exp( -sunDepth cover^2 ). The veil dims the sun
// to a pale disk before the deck hides it. Exactly 1 with no storm.
export function stormTransmittance( cover ) {

	return cover > 0 ? Math.exp( - STORM.sunDepth * cover * cover ) : 1;

}

// The storm's light. clear: { sun: [r,g,b], sky: [r,g,b], horizon: [r,g,b] } in the frame's units
// (sun colour, sky irradiance over pi, horizon colour); mu: sine of the light's elevation.
// Fills out.deck, out.strip, out.veil (radiances the sky pass draws) and out.under (the sky
// irradiance over pi under full cover). Returns out.
export function stormLight( clear, mu, out ) {

	const m = Math.max( 0, mu );
	let lum = 0;
	const w = [ 0.2126, 0.7152, 0.0722 ];
	for ( let i = 0; i < 3; i ++ ) lum += w[ i ] * ( clear.sun[ i ] * m + clear.sky[ i ] );
	let hl = 0;
	for ( let i = 0; i < 3; i ++ ) hl += w[ i ] * clear.horizon[ i ];
	for ( let i = 0; i < 3; i ++ ) {

		const global = clear.sun[ i ] * m + clear.sky[ i ];
		const grey = lum * STORM.cast[ i ];
		out.deck[ i ] = STORM.transmittance * ( grey + ( global - grey ) * STORM.keepColour );
		out.under[ i ] = out.deck[ i ] * ( 1 + STORM.stripShare );
		out.veil[ i ] = STORM.veilLight * lum;
		// the far strip: the fine-day horizon, paler and greyer through the storm's haze
		out.strip[ i ] = STORM.stripGain * ( hl + ( clear.horizon[ i ] - hl ) * 0.3 );

	}
	return out;

}

// How far the global light at the ground falls under full cover: clear ( sun mu + sky ) over the
// light under the deck, by luminance.
export function stormLightDrop( clear, mu ) {

	const out = stormLight( clear, mu, { deck: [ 0, 0, 0 ], strip: [ 0, 0, 0 ], veil: [ 0, 0, 0 ], under: [ 0, 0, 0 ] } );
	const w = [ 0.2126, 0.7152, 0.0722 ], m = Math.max( 0, mu );
	let a = 0, b = 0;
	for ( let i = 0; i < 3; i ++ ) { a += w[ i ] * ( clear.sun[ i ] * m + clear.sky[ i ] ); b += w[ i ] * out.under[ i ]; }
	return a / b;

}

// Multipliers of the exposure meter's reference and ceiling for a cover overhead (both 1 with none).
export function stormExposure( cover, out ) {

	out.ref = 1 - ( 1 - STORM.exposureRef ) * cover;
	out.max = 1 - ( 1 - STORM.exposureMax ) * cover;
	return out;

}

const disc = ( x, z, cx, cz, r ) => 1 - smooth( ( Math.hypot( x - cx, z - cz ) / r - ( 1 - STORM.rainEdge ) ) / STORM.rainEdge );

// Centre of a place in the storm's own frame, `ahead` and `left` in wall-cloud radii (out.x, out.z).
export function stormPlace( g, ahead, left, out ) {

	// left of the motion, seen from above (+x east, -z north): ( fz, -fx )
	out.x = g.x + ( g.fx * ahead + g.fz * left ) * g.wallRadius;
	out.z = g.z + ( g.fz * ahead - g.fx * left ) * g.wallRadius;
	return out;

}

const PLACE = { x: 0, z: 0 };

// Rain rate at the ground at world x, z (mm/h): the forward-flank core or the hook, whichever is more.
export function stormRain( g, x, z ) {

	if ( ! g.on || g.rain <= 0 ) return 0;
	stormPlace( g, STORM.coreAhead, STORM.coreLeft, PLACE );
	const core = STORM.coreRate * disc( x, z, PLACE.x, PLACE.z, STORM.coreRadius * g.wallRadius );
	stormPlace( g, - STORM.hookBehind, STORM.hookLeft, PLACE );
	const hook = STORM.hookRate * disc( x, z, PLACE.x, PLACE.z, STORM.hookRadius * g.wallRadius );
	return g.rain * Math.max( core, hook );

}

// Share of the rain left for an arrival state and a clearing state: it starts once the deck has
// closed and stops over the first rainEase seconds of the clearing (clearTime: s of the whole clearing).
export function stormRainAmount( shield, breaks, clearTime ) {

	return smooth( ( shield - 0.6 ) / 0.4 ) * ( 1 - smooth( breaks * clearTime / STORM.rainEase ) );

}

// Optical extinction of rain falling at R mm/h, 1/m.
export function rainExtinction( R ) {

	return R > 0 ? STORM.extinctionK * Math.pow( R, STORM.extinctionP ) : 0;

}

const f = ( x ) => {

	const s = String( x );
	return /[.e]/.test( s ) ? s : s + '.0';

};

// Shader twin (WGSL, prefix `storm`). Pure functions: the callers pass the uniforms.
//   stormField( q )                 q: world xz plus the deck's drift, m. The two low-frequency fields ( 0..1 ) the shield's
//                                   ragged edge and its breaks are cut from. Procedural (no texture: the sky module is part of
//                                   passes that already bind the device's 32 sampled textures).
//   stormFbm( p, octaves )          the value-noise sum behind it, 0..1 (also the relief of the base in the sky pass)
//   stormCover( p, shield, n )      shield ( centre x, centre z, edge radius m, breaks 0..1 ); n: stormField
//   stormRain( p, anchor, rain )    anchor ( x, z, fx, fz ); rain ( wall-cloud radius m, rain 0..1 ); returns mm/h
//   stormRainExtinction( R )        1/m
export const STORM_WGSL = /* wgsl */`
// hash without sine (D. Hoskins), as the sky's star hash: stable for large coordinates
fn stormHash( p: vec2f ) -> f32 {
	var p3 = fract( p.xyx * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
fn stormValue( p: vec2f ) -> f32 {
	let i = floor( p );
	let w = fract( p );
	let u = w * w * ( 3.0 - 2.0 * w );
	return mix( mix( stormHash( i ), stormHash( i + vec2f( 1.0, 0.0 ) ), u.x ), mix( stormHash( i + vec2f( 0.0, 1.0 ) ), stormHash( i + vec2f( 1.0, 1.0 ) ), u.x ), u.y );
}
fn stormFbm( p: vec2f, octaves: i32 ) -> f32 {
	var q = p;
	var a = 0.5;
	var sum = 0.0;
	var norm = 0.0;
	for ( var i = 0; i < octaves; i ++ ) {
		sum += a * stormValue( q );
		norm += a;
		q = q * 2.03 + vec2f( 17.1, 9.7 );
		a *= 0.5;
	}
	return sum / norm;
}
fn stormField( q: vec2f ) -> vec2f {
	return vec2f( stormFbm( q / 5200.0, 2 ), clamp( ( stormFbm( q / 3400.0 + vec2f( 31.7, 11.3 ), 2 ) - 0.5 ) * 2.4 + 0.5, 0.0, 1.0 ) );
}
fn stormCover( p: vec2f, shield: vec4f, n: vec2f ) -> f32 {
	let d = length( p - shield.xy ) + ( n.x - 0.5 ) * ${ f( STORM.ragged ) };
	let edge = 1.0 - smoothstep( shield.z - ${ f( STORM.veil ) }, shield.z, d );
	// breaks: holes open where the low-frequency field is lowest and grow until none is left
	let hole = smoothstep( shield.w * 1.3 - 0.3, shield.w * 1.3, n.y );
	return edge * hole;
}
fn stormDisc( p: vec2f, c: vec2f, r: f32 ) -> f32 {
	return 1.0 - smoothstep( ${ f( 1 - STORM.rainEdge ) }, 1.0, length( p - c ) / r );
}
fn stormRain( p: vec2f, anchor: vec4f, rain: vec2f ) -> f32 {
	let fwd = anchor.zw;
	let left = vec2f( fwd.y, - fwd.x );
	let core = anchor.xy + ( fwd * ${ f( STORM.coreAhead ) } + left * ${ f( STORM.coreLeft ) } ) * rain.x;
	let hook = anchor.xy + ( fwd * ${ f( - STORM.hookBehind ) } + left * ${ f( STORM.hookLeft ) } ) * rain.x;
	return rain.y * max( ${ f( STORM.coreRate ) } * stormDisc( p, core, ${ f( STORM.coreRadius ) } * rain.x ), ${ f( STORM.hookRate ) } * stormDisc( p, hook, ${ f( STORM.hookRadius ) } * rain.x ) );
}
fn stormRainExtinction( R: f32 ) -> f32 {
	return ${ f( STORM.extinctionK ) } * pow( max( R, 0.0 ), ${ f( STORM.extinctionP ) } );
}
`;
