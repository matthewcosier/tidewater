// The air the hang glider flies through. Frame: world metres, y up; wind in m/s, positive toward
// +x, +y, +z. Nothing here is a private wind or a private ground: the horizontal wind is the shared
// island field (DisasterField: ambient + tornado + wind farm wake) and the ground is the shared
// TerrainData height. This module only shapes that wind by the ground under it (docs/glider.md,
// "Design: flying properly"). Before 2026-10-05 the glider read the field as is: flat with height,
// no slope lift and no thermals, so ridge soaring was impossible and the wing could only sink.
export const AIR = Object.freeze( {
	reference: 10, // m AGL: the ambient field wind is the 10 m anemometer wind (WMO standard height)
	shear: 1 / 7, // Hellmann exponent for neutral air over open ground (the 1/7 power law)
	shearFloor: 2, // m AGL: below this the power law is held, so it never reaches zero at the feet
	shearTop: 300, // m AGL: the surface layer ends; above it the gradient stops growing (x 1.63)
	ridgeDepth: 120, // m: slope lift fades over about one ridge height (potential flow over a hill)
	probe: 12, // m: half the baseline the slope is measured over, so 1 m terrain steps do not spike it
	leeShare: 0.6, // lee sink as a share of the matching windward lift (declared: the flow separates)
	gustShare: 0.12, // horizontal gusts within about 12% of the mean (declared, light turbulence)
	thermalBase: 40, // m AGL: a thermal is still forming below this (it grows linearly from the ground)
	thermalTop: 900, // m AGL: convective layer top on a warm island day; lift fades over the last 200 m
} );

// Thermal sources over sun-facing ground (declared): the bare summit rock, the south flank above the
// road and the dunes behind the landing beach. peak in m/s at a full sun, radius in m (core 1/e).
// Real hang-gliding thermals: 1-4 m/s climbs, cores 30-80 m wide (BHPA Pilot Handbook).
export const THERMALS = Object.freeze( [
	Object.freeze( { x: - 120, z: - 330, radius: 45, peak: 2.4 } ),
	Object.freeze( { x: - 60, z: - 205, radius: 40, peak: 2.0 } ),
	Object.freeze( { x: - 175, z: - 140, radius: 50, peak: 2.2 } ),
] );

const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) );

export class GliderAir {

	// field(): the shared DisasterField (it may be created after the glider); terrainAt(x, z) and
	// waterAt(x, z): shared heights; daylight(): 0..1 sun strength; clock(): seconds for gusts.
	constructor( { field, terrainAt, waterAt = () => 0, daylight = () => 1, clock = () => 0 } ) {

		this.field = field;
		this.terrainAt = terrainAt;
		this.waterAt = waterAt;
		this.daylight = daylight;
		this.clock = clock;
		this.thermals = THERMALS;

	}

	// Fills and returns out { wx, wy, wz, ... } with no allocation (called at 120 Hz by the flight).
	sample( x, y, z, out ) {

		out.wx = out.wy = out.wz = 0;
		const field = this.field();
		if ( field ) field.sample( x, y, z, out );
		out.wx ||= 0;
		out.wy ||= 0;
		out.wz ||= 0;
		const ground = Math.max( this.terrainAt( x, z ), this.waterAt( x, z ) );
		const agl = y - ground;
		if ( ! Number.isFinite( agl ) || agl < 0 ) return out;
		// Wind gradient: scale only the ambient part, so tornado and wake winds stay as the field made them.
		const ambient = field?.ambient?.();
		if ( ambient ) {

			const t = this.clock(), gust = 1 + AIR.gustShare * ( Math.sin( t * 0.37 + x * 0.013 ) + Math.sin( t * 0.71 + 1.7 + z * 0.011 ) + Math.sin( t * 1.13 + 4.1 ) ) / 3;
			const scale = Math.pow( clamp( agl, AIR.shearFloor, AIR.shearTop ) / AIR.reference, AIR.shear ) * gust - 1;
			out.wx += ( ambient.x || 0 ) * scale;
			out.wz += ( ambient.z || 0 ) * scale;

		}
		// Slope lift: the wind component up the local ground slope, turned upward by the slope angle
		// (w = U·∇h / sqrt( 1 + |∇h|² ), at most U on a cliff), fading over AIR.ridgeDepth. Downslope
		// flow in the lee sinks at AIR.leeShare of that. Water is flat, so the open sea gives none.
		const d = AIR.probe, gx = ( this.terrainAt( x + d, z ) - this.terrainAt( x - d, z ) ) / ( 2 * d ), gz = ( this.terrainAt( x, z + d ) - this.terrainAt( x, z - d ) ) / ( 2 * d );
		if ( Number.isFinite( gx ) && Number.isFinite( gz ) && ground > this.waterAt( x, z ) ) {

			const up = ( out.wx * gx + out.wz * gz ) / Math.sqrt( 1 + gx * gx + gz * gz );
			out.wy += ( up > 0 ? up : up * AIR.leeShare ) * Math.exp( - agl / AIR.ridgeDepth );

		}
		// Thermals: Gaussian columns drifting downwind with height, scaled by the sun.
		const sun = clamp( this.daylight(), 0, 1 );
		if ( sun > 0 ) {

			const rise = clamp( agl / AIR.thermalBase, 0, 1 ) * clamp( ( AIR.thermalTop - agl ) / 200, 0, 1 );
			for ( let i = 0; i < this.thermals.length; i ++ ) {

				const th = this.thermals[ i ], lean = agl / Math.max( 1, th.peak );
				const dx = x - th.x - ( ambient?.x || 0 ) * lean, dz = z - th.z - ( ambient?.z || 0 ) * lean;
				out.wy += th.peak * sun * rise * Math.exp( - ( dx * dx + dz * dz ) / ( th.radius * th.radius ) );

			}

		}
		return out;

	}

}
