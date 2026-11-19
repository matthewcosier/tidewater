// Where the GPU draws a batch's vertices: the CPU mirror of the vertex stage's piece transform
// (src/engine/render/PieceMotion.js, piecePose). Loose pieces keep their rest vertices in the batch,
// so a test of where a piece is drawn reads these, not the position array.
import { drawnPosition, drawnNormal } from '../../src/engine/render/PieceMotion.js';

const p = { x: 0, y: 0, z: 0 };

// Float32Array of the drawn positions of vertices [ start, start + count ) (previous: the last drawn frame's).
export function drawnRange( geo, start, count, previous = false ) {

	const out = new Float32Array( count * 3 );
	for ( let i = 0; i < count; i ++ ) {

		drawnPosition( geo, start + i, p, previous );
		out[ i * 3 ] = p.x;
		out[ i * 3 + 1 ] = p.y;
		out[ i * 3 + 2 ] = p.z;

	}

	return out;

}

export const drawnSpan = ( s, previous = false ) => drawnRange( s.geo, s.start, s.count, previous );
export const drawnGeometry = ( geo, previous = false ) => drawnRange( geo, 0, geo.attributes.position.count, previous );

// The drawn normal of one vertex, as { x, y, z }.
export function drawnNormalAt( geo, vertex ) {

	return drawnNormal( geo, vertex, { x: 0, y: 0, z: 0 } );

}
