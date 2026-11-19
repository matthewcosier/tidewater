// The tornado's wind field (src/disasters/Field.js, tornado block): one Burgers-Rott vortex shared
// with the drawn funnel, a vertical structure that holds the mass balance, and one seeded life
// cycle that the funnel follows. Everything is read from DisasterField.sampleRaw and the funnel
// state TornadoVisuals.updateStorm publishes, the same calls the game makes. SI units: m, s, m/s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DisasterField } from '../src/disasters/Field.js';
import { TornadoVisuals } from '../src/disasters/TornadoVisuals.js';
import { tornadoLifecycle } from '../src/disasters/TornadoFunnel.js';
import { Scene, Vector3 } from '../src/engine/index.js';

const BURGERS_PEAK = 0.6382, PEAK_X = 1.1209; // Burgers-Rott: peak 0.6382 VG at r = 1.1209 rc
const burgers = ( x ) => x < 1e-6 ? x : ( 1 - Math.exp( - x * x ) ) / x;

// A tornado standing still at the origin over flat ground, in its mature stage (after genesis).
function mature( config = {} ) {

	const field = new DisasterField( () => 0 ), e = field.start( 'tornado', { x: 0, z: 0, speed: 0, intensity: 65, radius: 100, duration: 90, seed: 11, ...config } );
	const life = tornadoLifecycle( e, {} );
	e.time = life.genesis + 2;
	return { field, e };

}

// Tangential, radial (positive outward) and vertical wind at radius r (m), height z (m), on the +x axis.
function components( field, r, z ) {

	const s = field.sampleRaw( r, z, 0, {} );
	return { v: s.wz, u: s.wx, w: s.wy, speed: Math.hypot( s.wx, s.wz ) };

}

test( 'One vortex: the wind that loads the island is the Burgers-Rott vortex the funnel is drawn from, fading into the ambient wind with no edge', () => {

	const { field, e } = mature();
	const rmax = e.radius * 0.18, rc = rmax / PEAK_X, z = 40;
	const peak = components( field, rmax, z ).v;
	assert.ok( peak > 30, `mature tangential wind at the radius of maximum wind is ${ peak.toFixed( 1 ) } m/s` );
	for ( let r = 2; r <= 0.6 * e.radius; r += 2 ) {

		const want = burgers( r / rc ) / burgers( PEAK_X ), got = components( field, r, z ).v / peak;
		assert.ok( Math.abs( got - want ) < 0.02, `r ${ r } m: tangential ${ got.toFixed( 3 ) } of peak, Burgers-Rott with the funnel's core gives ${ want.toFixed( 3 ) }` );

	}
	// beyond: monotone, no step between samples 0.5 m apart, and gone into the ambient by twice the radius
	let last = components( field, 0.6 * e.radius, z ).v, steepest = 0;
	for ( let r = 0.6 * e.radius + 0.5; r <= 2 * e.radius; r += 0.5 ) {

		const v = components( field, r, z ).v;
		assert.ok( v <= last + 1e-9, `r ${ r } m: the vortex wind rose from ${ last.toFixed( 3 ) } to ${ v.toFixed( 3 ) } m/s outside its core` );
		steepest = Math.max( steepest, last - v );
		last = v;

	}
	assert.ok( steepest < 0.01 * peak, `largest drop over 0.5 m outside 0.6 R is ${ steepest.toFixed( 3 ) } m/s (${ ( 100 * steepest / peak ).toFixed( 2 ) } % of the peak): an edge` );
	assert.ok( last < 0.002 * peak, `at twice the radius the vortex still blows ${ last.toFixed( 3 ) } m/s` );
	field.ambient = () => ( { x: 4, z: - 2 } );
	const far = field.sampleRaw( 2.5 * e.radius, 10, 0, {} );
	assert.ok( Math.abs( far.wx - 4 ) < 0.05 && Math.abs( far.wz + 2 ) < 0.05, `far from the vortex the wind is the ambient wind: ${ far.wx.toFixed( 2 ) }, ${ far.wz.toFixed( 2 ) } m/s` );

} );

test( 'The updraft is zero at the ground, peaks aloft and decays above; the surface inflow feeds it and the flow holds its mass balance', () => {

	for ( const config of [ { intensity: 65, radius: 100 }, { intensity: 120, radius: 400 }, { intensity: 30, radius: 40 } ] ) {

		const { field, e } = mature( config );
		const label = `${ config.intensity } m/s, radius ${ config.radius } m`;
		const rc = e.radius * 0.18 / PEAK_X;
		const w1 = components( field, 0, 1 ).w;
		assert.ok( Math.abs( w1 ) < 1, `${ label }: updraft ${ w1.toFixed( 2 ) } m/s at 1 m on the axis` );
		let zPeak = 0, wPeak = 0;
		for ( let z = 0.5; z <= 1500; z += 0.5 ) {

			const w = components( field, 0, z ).w;
			if ( w > wPeak ) { wPeak = w; zPeak = z; }

		}
		assert.ok( zPeak >= 10 && zPeak <= 300, `${ label }: the updraft peaks ${ wPeak.toFixed( 1 ) } m/s at ${ zPeak } m, want aloft (10-300 m)` );
		assert.ok( components( field, 0, 4 * zPeak ).w < 0.5 * wPeak, `${ label }: updraft at 4 x the peak height is ${ components( field, 0, 4 * zPeak ).w.toFixed( 1 ) } m/s of ${ wPeak.toFixed( 1 ) }` );
		// the inflow is strongest in the surface layer, below the updraft peak; above it the air leaves outward
		let zIn = 0, uIn = 0;
		for ( let z = 0.5; z <= zPeak; z += 0.5 ) {

			const u = - components( field, e.radius * 0.18, z ).u;
			if ( u > uIn ) { uIn = u; zIn = z; }

		}
		assert.ok( zIn < 0.5 * zPeak && uIn > 0, `${ label }: strongest inflow ${ uIn.toFixed( 1 ) } m/s at ${ zIn } m, updraft peak at ${ zPeak } m` );
		assert.ok( components( field, e.radius * 0.18, 2 * zPeak ).u > 0, `${ label }: outflow above the updraft peak` );
		// mass balance (incompressible, axisymmetric): what flows in through the cylinder of radius Rc
		// below the updraft peak leaves upward through the disc of radius Rc at that height
		for ( const k of [ 0.5, 1, 2, 4 ] ) {

			const Rc = k * rc, nz = 2000, nr = 2000;
			let inflow = 0, up = 0;
			for ( let i = 0; i < nz; i ++ ) inflow += - components( field, Rc, ( i + 0.5 ) * zPeak / nz ).u * zPeak / nz;
			for ( let i = 0; i < nr; i ++ ) {

				const r = ( i + 0.5 ) * Rc / nr;
				up += components( field, r, zPeak ).w * r * Rc / nr;

			}
			inflow *= 2 * Math.PI * Rc;
			up *= 2 * Math.PI;
			assert.ok( Math.abs( inflow / up - 1 ) < 0.01, `${ label }: through ${ k } core radii ${ inflow.toFixed( 0 ) } m3/s flow in below ${ zPeak } m and ${ up.toFixed( 0 ) } m3/s rise through the disc` );

		}
		// continuity at every point: (1/r) d(r u)/dr + dw/dz = 0, by central differences
		const h = 0.05;
		for ( const r of [ 0.5 * rc, rc, 2 * rc, 5 * rc, 0.9 * e.radius, 1.3 * e.radius ] ) for ( const z of [ 2, 0.5 * zPeak, zPeak, 3 * zPeak ] ) {

			const ru = ( rr ) => rr * components( field, rr, z ).u;
			const div = ( ru( r + h ) - ru( r - h ) ) / ( 2 * h * r ), dw = ( components( field, r, z + h ).w - components( field, r, z - h ).w ) / ( 2 * h );
			const scale = Math.max( Math.abs( dw ), Math.abs( div ), 1e-3 * wPeak / zPeak );
			assert.ok( Math.abs( div + dw ) < 0.01 * scale, `${ label }: divergence ${ ( div + dw ).toExponential( 2 ) } /s at r ${ r.toFixed( 1 ) } m, z ${ z } m (terms ${ div.toExponential( 2 ) }, ${ dw.toExponential( 2 ) })` );

		}

	}

} );

// Peak horizontal ground wind (m/s) on a ring at the radius of maximum wind, 2 m above the ground.
function groundWind( field, e ) {

	const c = field.center( e ), r = e.radius * 0.18;
	let best = 0;
	for ( let k = 0; k < 16; k ++ ) {

		const a = k * Math.PI / 8, s = field.sampleRaw( c.x + Math.cos( a ) * r, 2, c.z + Math.sin( a ) * r, {} );
		best = Math.max( best, Math.hypot( s.wx, s.wz ) );

	}
	return best;

}

test( 'One life: across 8 seeds the ground wind rises over genesis as the funnel comes down, decays, and only then is the event over', () => {

	const app = { scene: new Scene(), camera: { position: new Vector3( 0, 50, 120 ) }, sceneRenderer: { opaqueCopy: { depthTexture: null } } };
	for ( let seed = 1; seed <= 8; seed ++ ) {

		const field = new DisasterField( () => 0 ), visual = new TornadoVisuals( app, field );
		const e = field.start( 'tornado', { x: 0, z: 0, speed: 0, duration: 90, seed } );
		const rows = [];
		while ( field.events.has( 'tornado' ) && e.time < 400 ) {

			field.advance( 1 / 30 );
			if ( ! field.events.has( 'tornado' ) ) break;
			visual.updateStorm( 1 / 30, e );
			const f = visual.funnel;
			rows.push( { t: e.time, wind: groundWind( field, e ), tip: f.tip, base: f.base, vmax: f.vmax } );

		}
		const peak = Math.max( ...rows.map( ( r ) => r.wind ) ), end = rows[ rows.length - 1 ].t;
		const tag = `seed ${ seed }`;
		assert.ok( peak > 50, `${ tag }: the default-strength tornado peaked at ${ peak.toFixed( 1 ) } m/s on the ground` );
		const early = rows.find( ( r ) => r.t >= 1.2 );
		assert.ok( early.wind < 0.2 * peak, `${ tag }: ground wind ${ early.wind.toFixed( 1 ) } m/s at 1.2 s, ${ ( 100 * early.wind / peak ).toFixed( 0 ) } % of its peak: the wind did not wait for the vortex to organise` );
		for ( const r of rows ) {

			assert.ok( ! ( r.wind > 0.9 * peak && r.tip > 0.5 * r.base ), `${ tag } t ${ r.t.toFixed( 2 ) } s: ground wind ${ r.wind.toFixed( 1 ) } m/s (${ ( 100 * r.wind / peak ).toFixed( 0 ) } % of peak) while the funnel tip hangs ${ r.tip.toFixed( 0 ) } m up under a ${ r.base.toFixed( 0 ) } m base` );
			// the funnel reaches the ground only once the vortex's deficit (1.70 rho vmax^2) meets rho g H
			if ( r.tip <= 0 ) assert.ok( r.vmax >= Math.sqrt( 9.81 * r.base * BURGERS_PEAK ** 2 / Math.LN2 ) * 0.999, `${ tag } t ${ r.t.toFixed( 2 ) } s: the funnel is down at ${ r.vmax.toFixed( 1 ) } m/s under a ${ r.base.toFixed( 0 ) } m base` );

		}
		// the decay: the ground wind falls from 90 % to 10 % of its peak over seconds, not in a fade
		const last90 = rows.findLast( ( r ) => r.wind >= 0.9 * peak ).t, first10 = rows.find( ( r ) => r.t > last90 && r.wind <= 0.1 * peak )?.t ?? end;
		assert.ok( first10 - last90 >= 5, `${ tag }: the ground wind fell from 90 % to 10 % of its peak in ${ ( first10 - last90 ).toFixed( 1 ) } s` );
		// what it carried falls before the event is over: the vortex is gone well before the end
		const gone = rows.find( ( r ) => r.t > last90 && r.wind < 0.02 * peak )?.t ?? end;
		assert.ok( end - gone >= 3, `${ tag }: the event ended ${ ( end - gone ).toFixed( 1 ) } s after the ground wind fell below 2 % of its peak` );
		assert.ok( visual.storm.value > 0.9, `${ tag }: the storm is still dark (${ visual.storm.value.toFixed( 2 ) }) on the event's last frame` );

	}

} );
