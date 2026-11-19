// The cinematic tornado's physical model (src/disasters/TornadoFunnel.js): the Burgers-Rott
// condensation funnel, its genesis and rope-out from the event seed, and the storm state that
// darkens the shared sun and sky. Assertions are physical outcomes in SI units; the exact
// Burgers-Rott pressure profile is integrated here independently of the module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DisasterField } from '../src/disasters/Field.js';
import { FUNNEL, condensationX, funnelTip, tornadoLifecycle, stormLight, StormState } from '../src/disasters/TornadoFunnel.js';

// Exact deficit fraction F(x) = dp / ( rho VG^2 ) at x = r / rc for v = VG ( 1 - exp( -x^2 ) ) / x,
// dp( r ) = rho * integral_r^inf v^2 / r' dr' (cyclostrophic balance), by Simpson in s = ln x.
function exactF( x ) {

	const a = Math.log( x ), b = Math.log( 60 ), n = 4000, h = ( b - a ) / n;
	let sum = 0;
	for ( let i = 0; i <= n; i ++ ) {

		const u = Math.exp( a + i * h ), g = ( 1 - Math.exp( - u * u ) ) ** 2 / ( u * u ); // integrand * u (ds = du / u)
		sum += g * ( i === 0 || i === n ? 1 : i % 2 ? 4 : 2 );

	}
	return sum * h / 3 + 1 / ( 2 * 60 * 60 );

}

test( 'Burgers-Rott core deficit is 1.70 rho vmax^2 and the shader profile stays within 15% of the exact integral', () => {

	const centre = exactF( 1e-4 );
	assert.ok( Math.abs( centre - Math.LN2 ) < 2e-3, `central deficit fraction ${ centre.toFixed( 4 ) } should be ln 2` );
	const ratio = Math.LN2 / FUNNEL.burgersPeak ** 2;
	assert.ok( Math.abs( ratio - 1.70 ) < 0.01, `dp0 / ( rho vmax^2 ) = ${ ratio.toFixed( 3 ) }, Burgers-Rott gives 1.70` );
	for ( const x of [ 0.1, 0.3, 0.5, 0.8, 1, 1.5, 2, 3, 6 ] ) {

		// the module stores the inverse: x( f ); feed it the exact f and compare radii
		const f = exactF( x ), back = condensationX( f );
		assert.ok( Math.abs( back / x - 1 ) < 0.15, `x ${ x }: exact F ${ f.toFixed( 4 ) } maps back to x ${ back.toFixed( 3 ) }` );

	}

} );

test( 'The condensation funnel reaches the ground in an EF3 wind and hangs aloft in a weak one', () => {

	const H = 600; // m, wall-cloud base above the ground
	const strong = funnelTip( H, 65, 1 ), weak = funnelTip( H, 30, 1 );
	assert.ok( strong <= 0, `65 m/s: the funnel tip should reach the ground, got ${ strong.toFixed( 0 ) } m` );
	assert.ok( weak >= 300 && weak < H, `30 m/s: the funnel should hang 300-600 m up, got ${ weak.toFixed( 0 ) } m` );
	assert.equal( funnelTip( H, 0 ), H, 'with no vortex wind there is no condensation below the base' );
	// it flares into the cloud base and narrows toward the ground (cone, not a cylinder)
	const VG = 65 / FUNNEL.burgersPeak, kappa = FUNNEL.g / ( VG * VG );
	const nearBase = condensationX( kappa * 5 ), mid = condensationX( kappa * H / 2 ), ground = condensationX( kappa * H );
	assert.ok( nearBase > 4 && mid > ground && ground > 0.2 && ground < 1.5, `x near base ${ nearBase.toFixed( 2 ) }, mid ${ mid.toFixed( 2 ) }, ground ${ ground.toFixed( 2 ) }` );

} );

test( 'Genesis, shrinking and rope-out come from the event seed: 20-40 s genesis, decay to zero at the end, exact replay', () => {

	const field = new DisasterField( () => 0 ), out = {}, genesis = [];
	for ( let seed = 1; seed <= 24; seed ++ ) {

		const e = field.start( 'tornado', { duration: 120, seed } );
		let last = - 1;
		for ( let t = 0; t <= 120; t += 0.5 ) {

			e.time = t;
			tornadoLifecycle( e, out );
			assert.ok( out.strength >= last - 1e-9 || t > out.shrinkStart, `seed ${ seed }: the ground wind only rises until the shrinking stage (t ${ t })` );
			last = out.strength;
			if ( t === 0 ) assert.equal( out.strength, 0, 'no vortex wind at t 0' );

		}
		e.time = 0;
		tornadoLifecycle( e, out );
		const g = out.genesis, rope = out.ropeStart;
		assert.ok( g >= 20 && g <= 40, `seed ${ seed }: genesis ${ g.toFixed( 1 ) } s` );
		assert.ok( rope >= g && rope < 120, `seed ${ seed }: rope-out starts ${ rope.toFixed( 1 ) } s, after genesis` );
		e.time = g * 0.5;
		tornadoLifecycle( e, out );
		assert.ok( out.wall > out.strength, 'the wall cloud forms before the vortex is at strength' );
		e.time = 120;
		tornadoLifecycle( e, out );
		assert.equal( out.ropeOut, 1, 'rope-out is complete at the end' );
		assert.equal( out.strength, 0, 'the vortex has decayed at the end' );
		genesis.push( g );

	}
	assert.ok( Math.max( ...genesis ) - Math.min( ...genesis ) > 10, `genesis must vary run to run, spread ${ ( Math.max( ...genesis ) - Math.min( ...genesis ) ).toFixed( 1 ) } s` );
	const a = field.start( 'tornado', { duration: 120, seed: 7 } ), first = {}, again = {};
	a.time = 13;
	tornadoLifecycle( a, first );
	const b = field.start( 'tornado', { duration: 120, seed: 7 } );
	b.time = 13;
	tornadoLifecycle( b, again );
	assert.deepEqual( again, first, 'a fixed seed replays the lifecycle exactly' );
	const short = field.start( 'tornado', { duration: 60, seed: 3 } );
	tornadoLifecycle( short, out );
	assert.ok( out.genesis <= 30, `a 60 s tornado must still finish genesis by half time, got ${ out.genesis.toFixed( 1 ) }` );

} );

test( 'The storm cuts global irradiance 3-5x and blends in and out over seconds, restoring the cloud cover', () => {

	const light = stormLight( 1, {} );
	// clear-sky split: about 85% direct beam and 15% diffuse at a high sun (Iqbal 1983, ch. 7)
	const ratio = 1 / ( 0.85 * light.sun + 0.15 * light.sky );
	assert.ok( ratio >= 3 && ratio <= 5, `global irradiance falls ${ ratio.toFixed( 2 ) }x under the storm` );
	const app = { clouds: { coverage: { value: 0.4 } } }, storm = new StormState();
	storm.update( 1 / 60, true, app );
	assert.ok( app.storm > 0 && app.storm < 0.05, `no snap on the first frame: storm ${ app.storm }` );
	for ( let i = 0; i < 60 * 40; i ++ ) storm.update( 1 / 60, true, app );
	assert.ok( app.storm > 0.95 && app.clouds.coverage.value > 0.7, `full storm after 40 s: ${ app.storm.toFixed( 2 ) }, cover ${ app.clouds.coverage.value.toFixed( 2 ) }` );
	storm.update( 1 / 60, false, app );
	assert.ok( app.storm > 0.9, 'the storm clears gradually, not in one frame' );
	for ( let i = 0; i < 60 * 120; i ++ ) storm.update( 1 / 60, false, app );
	assert.equal( app.storm, 0 );
	assert.equal( app.clouds.coverage.value, 0.4, 'the player\'s cloud cover comes back exactly' );

} );
