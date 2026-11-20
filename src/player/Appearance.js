// The player's original Rocketbox rig and animations are used for every look.
export const SKIN_TONES = [ 'Original', 'Tan', 'Deep' ];
export const SHIRTS = [ 'Original', 'Lagoon', 'Coral' ];

export function playerAppearance( value ) {
	const index = ( i, labels ) => Number.isInteger( i ) && i >= 0 && i < labels.length ? i : 0;
	return { tone: index( value?.tone, SKIN_TONES ), shirt: index( value?.shirt, SHIRTS ), hat: value?.hat !== false };
}

// player.glb has a single body atlas. Its authored roughness is 0.74 for the
// printed shirt and 0.88 for shorts. The centre and sleeve UV islands isolate
// that fabric from exposed skin with similar roughness.
export function appearanceMaterial( name ) {
	if ( name !== 'head' && name !== 'body' ) return null;
	const masks = name === 'body' ? `
		let side = in.uv.x < 0.32 || in.uv.x > 0.68;
		let garment = !side || in.uv.y < 0.065 || (in.uv.y > 0.435 && in.uv.y < 0.65);
		let cloth = select(0.0, 1.0 - smoothstep(0.008, 0.035, abs(orm.g - 0.74)), garment);
		let limbs = side && ((in.uv.y > 0.245 && in.uv.y < 0.46) || in.uv.y > 0.61);
		let skin = select(0.0, warmth * (1.0 - cloth), limbs);
	` : `
		let cloth = 0.0;
		let skin = select(0.0, warmth, in.uv.y < 0.815);
	`;
	return {
		uniforms: { shirtStyle: [ 'f32', 0 ], skinTone: [ 'f32', 0 ] },
		surface: `
			let base = s.albedo;
			let warmth = smoothstep(0.07, 0.34, (base.r - base.g) / max(base.r, 0.001));
			${ masks }
			let dye = select(vec3f(0.34,1.25,1.25), vec3f(1.9,0.62,0.38), mat.shirtStyle > 1.5);
			let fabric = dot(base, vec3f(0.28,0.55,0.17)) * dye;
			s.albedo = mix(base, fabric, select(0.0, cloth * 0.87, mat.shirtStyle > 0.5));
			let pigment = select(vec3f(0.68,0.49,0.36), vec3f(0.36,0.22,0.16), mat.skinTone > 1.5);
			s.albedo *= mix(vec3f(1.0), pigment, select(0.0, skin, mat.skinTone > 0.5));
		`,
	};
}
