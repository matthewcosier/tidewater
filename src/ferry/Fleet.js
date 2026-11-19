// The ferries on the strait as one query (docs/ferry.md, Two ships). App.fleet is a Fleet: still the
// array of Ferry (the Tidewater Spirit, the lead, first, then the Sealion Spirit), so every
// `for ( const f of app.fleet )` and `fleet[ 0 ]` reads as before, plus the questions the other
// systems used to ask of app.ferry alone, which saw only the lead's hull: every hull out there
// (jetski and shark avoidance, disaster forces), the ship at a place (the mate's call, the dolphins'
// bow) and the ship carrying the player. World frame, metres, xz plane (FerryShip.position).

// m, centre to centre: a point this close to a hull is at that ship. Her hull is 50.4 m x 17.8 m
// (tools/ferry/ferry_build.py), so 40 m reaches past either end with a deck's margin.
export const SHIP_REACH = 40;

export class Fleet extends Array {

	// filter / map on the fleet (rivals, App.init) give plain arrays, not more fleets
	static get [ Symbol.species ]() { return Array; }

	// Every hull on the service, the lead's first: [ FerryShip ]. Rebuilt only when the fleet or a
	// hull changes (once, after App.init), so the per-frame readers allocate nothing.
	get ships() {

		const s = this._ships;
		let stale = ! s || s.length !== this.length;
		for ( let i = 0; ! stale && i < this.length; i ++ ) stale = s[ i ] !== this[ i ].ship;
		if ( stale ) this._ships = Array.from( this, f => f.ship ).filter( Boolean );
		return this._ships;

	}

	// The ship whose hull centre lies nearest `p` ({ x, z }, world m), within `reach` m; else null.
	shipAt( p, reach = SHIP_REACH ) {

		let best = null, bestD = reach;
		for ( const f of this ) {

			const s = f.ship;
			if ( ! s ) continue;
			const d = Math.hypot( s.position.x - p.x, s.position.z - p.z );
			if ( d <= bestD ) { best = f; bestD = d; }

		}
		return best;

	}

	// The ship the player is aboard (walking her decks or at her helm), else null.
	shipCarrying( player ) {

		const f = player?.vessel?.ferry;
		return f && ( player.mode === 'ferry' || player.mode === 'ferry-helm' ) && this.includes( f ) ? f : null;

	}

}
