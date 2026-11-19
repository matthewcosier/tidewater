// Factory paint for the everyday traffic and parked cars (docs/cars.md, Everyday traffic).
// The five everyday models paint their bodies with one shared material, Paint, white at 0.8 linear
// (tools/ferry/everyday_cars.py). Each car multiplies it by one of these tints through an instance
// colour (MeshShader INSTANCE_COLOR), so a colour costs no material and no draw: the car park's
// instanced bodies take one per bay, a traffic car's body one per car.
// Shares: a game choice after the global colour-popularity reports (white about a third, then grey,
// black and silver, blue, red, a few earth tones); the tints are linear, relative to the 0.8 base.
const PAINTS = [
	[ 0.30, 1.0, 1.0, 1.0 ],          // white
	[ 0.18, 0.15, 0.156, 0.163 ],     // mid grey
	[ 0.14, 0.55, 0.56, 0.58 ],       // silver
	[ 0.14, 0.022, 0.024, 0.026 ],    // black
	[ 0.10, 0.025, 0.05, 0.14 ],      // dark blue
	[ 0.07, 0.48, 0.025, 0.019 ],     // red
	[ 0.04, 0.375, 0.275, 0.175 ],    // bronze
	[ 0.03, 0.04, 0.085, 0.06 ],      // dark green
];

// each tint as an object InstancedMesh.setColorAt can write (it calls toArray), built once
const TINTS = PAINTS.map( ( [ share, r, g, b ] ) => ( { share, r, g, b, toArray( a, o = 0 ) { a[ o ] = this.r; a[ o + 1 ] = this.g; a[ o + 2 ] = this.b; return a; } } ) );

// The tint for a number u in [0, 1): a bay's hash in the car park (fixed), a random draw in the traffic.
export function paintFor( u ) {

	for ( const t of TINTS ) {

		if ( u < t.share ) return t;
		u -= t.share;

	}
	return TINTS[ 0 ];

}
