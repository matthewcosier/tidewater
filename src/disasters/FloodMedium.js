import { ShaderModule, commonModule } from '../engine/webgpu.js';
import { turbidity, SED_ABSORB, SED_SCATTER, SED_WGSL } from './FloodLook.js';

// The water a camera is in while a flood runs (docs/disasters.md "Inside the water").
//
// Flood water that has crossed the land is opaque within centimetres (FloodLook.js: suspended sediment of order
// 1-10 kg/m^3, extinction 21-25 /m). The surface is drawn with those optics; a camera under that surface is in the
// same water, so the underwater pass and the particles at the lens take the same coefficients, weighted by the same
// decision: FloodLook.turbidity( depth, speed, bed ) of the water column the camera is in. 0 is the sea's own water
// (every dive with no event, and the open sea far from land during one), 1 is the flood.
//
// One model, two readers: the JS functions below (App each frame, tests) and FLOOD_MEDIUM_WGSL (the constants the
// underwater composite and the particles add to the sea's coefficients). Both come from FloodLook's SED_ABSORB and
// SED_SCATTER; change them there only.

// s: the medium follows the water at the camera with this time constant. The turbidity is continuous in space, so a
// moving camera never sees a step; the blend covers the one discontinuity in time, the frame an event's grids drop.
export const MEDIUM_BLEND = 0.35;

// Fraction of the scattering that turns light back up (the composite's own `bb = sigS * 0.035`). Daylight goes down
// through turbid water by the diffuse attenuation Kd ~ ( a + bb ) / mu, not the beam attenuation a + b: forward
// scattered light is still travelling down (Gordon 1989, Limnol. Oceanogr. 34; Kirk 1994, "Light and photosynthesis
// in aquatic ecosystems"). In the sea's clear water the two differ by under 5 %, and the sea keeps the beam value.
export const BACKSCATTER = 0.035;

const grid = { height: 0, ux: 0, uz: 0, depth: 0 }, far = { height: 0, depth: 0, ux: 0, uz: 0 };

// The medium at (x, z) from the solver's state: field is the DisasterField (or null with no disaster system), ground
// the terrain height there (m, sea level 0). Fills out.medium (0..1), out.ux, out.uz (the water's velocity, m/s) and
// out.depth (m). With no flood grid everything is 0: the sea's own water, at rest as far as the flood knows.
export function floodMediumAt( field, x, z, ground, out = {} ) {

	out.medium = out.ux = out.uz = out.depth = 0;
	const g = field && field.water ? field.gridAt( x, z ) : null;
	if ( ! g ) return out;
	g.sample( x, z, grid );
	let depth = grid.depth, ux = grid.ux, uz = grid.uz;
	// the analytic wall beyond the grids, and over them before the launch: it stands on the sea's own depth there
	if ( field.farFieldAt( x, z, far ) ) {

		depth = depth > 0.002 ? depth + far.height : far.depth;
		ux += far.ux;
		uz += far.uz;

	}
	if ( ! ( depth > 0.002 ) ) return out;
	// the bed as the surface's shader takes it: the grid's own ( eta - h ), capped by the shared terrain height
	const bed = grid.depth > 0.002 ? Math.min( grid.height - grid.depth, ground ) : ground;
	const medium = turbidity( depth, Math.hypot( ux, uz ), bed );
	if ( ! Number.isFinite( medium ) ) return out;
	out.medium = medium;
	out.ux = ux;
	out.uz = uz;
	out.depth = depth;
	return out;

}

// One step of the blend toward `target` over dt seconds. It lands exactly on the target, so with no flood the medium
// is exactly 0 and the underwater frame is the sea's own, bit for bit. A non-finite input gives the sea.
export function blendMedium( current, target, dt ) {

	if ( ! Number.isFinite( target ) || ! Number.isFinite( current ) ) return 0;
	const next = target + ( current - target ) * Math.exp( - Math.max( dt, 0 ) / MEDIUM_BLEND );
	return Math.abs( next - target ) < 1e-3 ? target : next;

}

// Absorption, scattering and extinction (1/m, per colour channel) of the water at `medium`, from the sea's own
// coefficients (Frame.js waterAbsorption, waterScattering: any object with x, y, z).
export function mediumOptics( medium, seaAbsorption, seaScattering, out = {} ) {

	const a = out.absorption ??= [ 0, 0, 0 ], s = out.scattering ??= [ 0, 0, 0 ], e = out.extinction ??= [ 0, 0, 0 ], sea = out.seaExtinction ??= [ 0, 0, 0 ];
	const A = [ seaAbsorption.x, seaAbsorption.y, seaAbsorption.z ], S = [ seaScattering.x, seaScattering.y, seaScattering.z ];
	for ( let i = 0; i < 3; i ++ ) {

		a[ i ] = A[ i ] + SED_ABSORB[ i ] * medium;
		s[ i ] = S[ i ] + SED_SCATTER[ i ] * medium;
		e[ i ] = a[ i ] + s[ i ];
		sea[ i ] = A[ i ] + S[ i ];

	}
	out.medium = medium;
	return out;

}

// The same sum in WGSL: m is the medium uniform. With m = 0 each returns the sea's own coefficient unchanged.
export const FLOOD_MEDIUM_WGSL = /* wgsl */`
fn floodMediumAbsorption( m: f32 ) -> vec3f { return frame.waterAbsorption + ${ SED_WGSL.absorb } * m; }
fn floodMediumScattering( m: f32 ) -> vec3f { return frame.waterScattering + ${ SED_WGSL.scatter } * m; }
`;
export const floodMediumModule = new ShaderModule( { name: 'floodMedium', deps: [ commonModule ], code: FLOOD_MEDIUM_WGSL } );
