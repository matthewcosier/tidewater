import { test, expect } from '@playwright/test';

// Given/When/Then on the real island: other people's cars at the ferry terminal roll on their wheels
// and steer them through their turns (docs/cars.md, Traffic wheels). Red before 2026-10-05: every
// traffic car was one welded mesh and its wheels never turned. Only the free camera is posed from
// the test (the F-key camera a player flies by hand); the cars are driven by the game's own traffic.
const OUT = process.env.PW_OUT || 'test-results';

// Every traffic car driving now: how far along its road it is, and what its wheels did (rad).
const moving = page => page.evaluate( () => {

	const t = window.__app.ferry.traffic;
	return t.cars.filter( c => c.path && c.v > 0.8 ).map( c => ( { id: c.id, s: c.s, v: c.v, state: c.state, rig: c.wheels ? { turned: c.wheels.turned, steer: c.wheels.steer, radius: c.wheels.radius } : null, drawn: t.drawnWheel ? t.drawnWheel( c ) : null } ) );

} );

test( 'Watching the ferry queue, the cars driving aboard turn their wheels and steer them', async ( { page } ) => {

	await test.step( 'Given a solo player on the real island with the ferry and her traffic loaded', async () => {

		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=0.5&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120_000 } );
		await page.keyboard.press( 'Enter' );
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).click();
		await expect.poll( () => page.evaluate( () => !! window.__app.ferry?.traffic?.parts ), { timeout: 60_000 } ).toBe( true );

	} );

	await test.step( 'When the player takes the free camera (F) and watches the terminal lanes', async () => {

		await page.keyboard.press( 'f' );
		await expect.poll( () => page.evaluate( () => window.__app.freeCam ) ).toBeTruthy();
		// look only: the free camera posed over the marshalling lanes, facing the linkspan
		await page.evaluate( () => {

			const app = window.__app, t = app.terminal;
			const eye = t.toWorld( [ - 9, 9, - 66 ] ), at = t.toWorld( [ 2.4, 3.6, - 46 ] );
			app.fly.setPose( eye, Math.atan2( eye.x - at.x, eye.z - at.z ), Math.atan2( at.y - eye.y, Math.hypot( at.x - eye.x, at.z - eye.z ) ) );
			app.fly.velocity.set( 0, 0, 0 );

		} );

	} );

	await test.step( 'Then a car on the move turns its wheels once per tyre circumference of road', async () => {

		// the queue starts aboard once her ramp is down: wait for a car to be driving
		await expect.poll( async () => ( await moving( page ) ).length, { timeout: 150_000, intervals: [ 1000 ] } ).toBeGreaterThan( 0 );
		const first = ( await moving( page ) )[ 0 ];
		expect( first.rig, 'the car has a wheel rig' ).not.toBeNull();
		await page.waitForTimeout( 3_000 );
		const later = ( await page.evaluate( () => window.__app.ferry.traffic.cars.map( c => ( { id: c.id, s: c.s, rig: c.wheels ? { turned: c.wheels.turned } : null } ) ) ) ).find( c => c.id === first.id );
		const road = Math.abs( later.s - first.s ), rolled = Math.abs( later.rig.turned - first.rig.turned ) * first.rig.radius;
		console.log( `car ${ first.id } (${ first.state }) drove ${ road.toFixed( 2 ) } m of road; its wheels rolled ${ rolled.toFixed( 2 ) } m` );
		expect( road ).toBeGreaterThan( 1 );
		expect( Math.abs( rolled - road ) ).toBeLessThan( 0.05 * road + 0.05 );

	} );

	await test.step( 'And the wheels drawn on screen are the ones turning, and the front pair steer through a turn', async () => {

		let steered = 0, drawnSpin = 0, drawnSteer = 0;
		for ( let k = 0; k < 40 && ! ( steered > 0.1 && drawnSteer > 0.1 ); k ++ ) {

			for ( const c of await moving( page ) ) {

				if ( ! c.rig || ! c.drawn ) continue;
				steered = Math.max( steered, Math.abs( c.rig.steer ) );
				// the drawn front wheel's yaw against the body follows the rig's steer
				if ( Math.abs( c.rig.steer ) > 0.1 ) drawnSteer = Math.max( drawnSteer, Math.abs( c.drawn.steer ) );
				drawnSpin = Math.max( drawnSpin, Math.abs( c.drawn.spinError ) < 0.02 ? 1 : 0 );

			}
			await page.waitForTimeout( 500 );

		}
		console.log( `largest steer seen ${ steered.toFixed( 3 ) } rad, drawn ${ drawnSteer.toFixed( 3 ) } rad; drawn spin matches the rig: ${ drawnSpin === 1 }` );
		await page.screenshot( { path: `${ OUT }/traffic-wheels-lanes.png` } );
		expect( drawnSpin, 'a drawn wheel sits at the rig\'s spin angle' ).toBe( 1 );
		expect( steered, 'a car on the move steered its front wheels' ).toBeGreaterThan( 0.1 );
		expect( drawnSteer, 'the drawn front wheel turned with it' ).toBeGreaterThan( 0.1 );

	} );

	await test.step( 'And the wheels stay inside their draw budget, and close up a turning car shows its front wheels steered', async () => {

		// cost: each visible car draws one wheel mesh per wheel material (docs/cars.md budget: at most 7)
		const cost = await page.evaluate( () => {

			const t = window.__app.ferry.traffic, seen = t.cars.filter( c => c.group.visible && c.group.wheelMeshes?.length );
			const draws = seen.map( c => c.group.wheelMeshes.length ), tris = m => ( m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count ) / 3;
			return { cars: seen.length, draws: draws.reduce( ( a, b ) => a + b, 0 ), most: Math.max( 0, ...draws ), triangles: seen.reduce( ( n, c ) => n + c.group.wheelMeshes.reduce( ( k, m ) => k + 4 * tris( m ), 0 ), 0 ) };

		} );
		console.log( `cars drawn ${ cost.cars }, wheel draws ${ cost.draws } (most a car ${ cost.most }), wheel triangles ${ Math.round( cost.triangles ) }` );
		expect( cost.most ).toBeLessThanOrEqual( 7 );
		// look only: the free camera off the front quarter of a car turning on its way aboard
		let staged = false;
		for ( let k = 0; k < 60 && ! staged; k ++ ) {

			staged = await page.evaluate( () => {

				const app = window.__app, t = app.ferry.traffic;
				const car = t.cars.find( c => c.path && c.v > 0.5 && c.wheels && Math.abs( c.wheels.steer ) > 0.08 && c.group.visible );
				if ( ! car ) return false;
				const g = car.group, V = app.camera.position.constructor, h = car.heading;
				const at = g.position.clone().add( new V( 0, 0.5, 0 ) ), eye = at.clone().add( new V( Math.sin( h ) * 10 + Math.cos( h ) * 4.5, 2.2, Math.cos( h ) * 10 - Math.sin( h ) * 4.5 ) );
				app.fly.setPose( eye, Math.atan2( eye.x - at.x, eye.z - at.z ), Math.atan2( at.y - eye.y, Math.hypot( at.x - eye.x, at.z - eye.z ) ) );
				app.fly.velocity.set( 0, 0, 0 );
				return true;

			} );
			if ( ! staged ) await page.waitForTimeout( 500 );

		}
		await page.waitForTimeout( 600 );
		await page.screenshot( { path: `${ OUT }/traffic-wheels-closeup.png` } );
		expect( staged, 'a car turning on its way aboard was found to look at' ).toBe( true );

	} );

	await test.step( 'Then the queue and the car park are everyday cars in factory colours (docs/cars.md, Everyday traffic)', async () => {

		// look only: the free camera over the middle of the car park's bays
		const park = await page.evaluate( () => {

			const app = window.__app, t = app.terminal, m = app.camera.matrixWorld.clone(), V = app.camera.position.constructor;
			const paints = new Set(), models = new Set();
			let x = 0, z = 0, n = 0;
			for ( const mesh of t.parkedMeshes || [] ) {

				if ( mesh.material.name !== 'Paint' ) continue;
				for ( let i = 0; i < mesh.count; i ++ ) {

					const a = mesh.instanceColor ? mesh.instanceColor.array : [ 1, 1, 1 ], k = mesh.instanceColor ? i * 3 : 0;
					paints.add( [ a[ k ], a[ k + 1 ], a[ k + 2 ] ].map( v => v.toFixed( 3 ) ).join() );
					mesh.getMatrixAt( i, m );
					x += m.elements[ 12 ]; z += m.elements[ 14 ]; n ++;

				}

			}
			for ( const c of app.ferry.traffic.cars ) models.add( c.name );
			if ( n ) {

				const at = new V( x / n, t.toWorld( [ 0, 3.2, 0 ] ).y, z / n ), eye = at.clone().add( new V( 14, 11, 14 ) );
				app.fly.setPose( eye, Math.atan2( eye.x - at.x, eye.z - at.z ), Math.atan2( at.y - eye.y, Math.hypot( at.x - eye.x, at.z - eye.z ) ) );
				app.fly.velocity.set( 0, 0, 0 );

			}
			return { painted: n, paints: paints.size, models: [ ...models ] };

		} );
		console.log( `car park: ${ park.painted } painted bodies in ${ park.paints } colours; traffic models ${ park.models.join( ', ' ) }` );
		await page.waitForTimeout( 1200 );
		await page.screenshot( { path: `${ OUT }/traffic-carpark.png` } );
		const everyday = [ 'ParkedHatch', 'ParkedSedan', 'ParkedSuv', 'ParkedUte', 'ParkedVan', 'ParkedJeep' ];
		expect( park.models.every( n => everyday.includes( n ) ), `traffic models ${ park.models }` ).toBe( true );
		expect( park.painted, 'everyday bodies parked in the bays' ).toBeGreaterThan( 10 );
		expect( park.paints, 'a car park of more than one or two colours' ).toBeGreaterThanOrEqual( 4 );

	} );

	await test.step( 'And each car waiting in the lanes is drawn in its own factory colour, a white car white (ledger -3)', async () => {

		// look only: the free camera almost straight down over the cars waiting in the lanes, so their roofs are in view.
		// Red on 2026-10-06: every traffic car drew near-black while the car park's tints showed.
		const waiting = await page.evaluate( () => {

			const app = window.__app, V = app.camera.position.constructor;
			const queue = app.ferry.traffic.cars.filter( c => c.group.visible && c.state === 'queue' );
			if ( ! queue.length ) return 0;
			const at = new V();
			for ( const c of queue ) at.add( c.group.position );
			at.multiplyScalar( 1 / queue.length );
			const eye = at.clone().add( new V( 3, 22, 3 ) );
			app.fly.setPose( eye, Math.atan2( eye.x - at.x, eye.z - at.z ), Math.atan2( at.y - eye.y, Math.hypot( at.x - eye.x, at.z - eye.z ) ) );
			app.fly.velocity.set( 0, 0, 0 );
			return queue.length;

		} );
		await page.waitForTimeout( 1500 );
		// where each waiting car's painted roof lands on screen, and the tint the game gave it
		const roofs = await page.evaluate( () => {

			const app = window.__app, cam = app.camera, V = cam.position.constructor;
			const canvas = [ ...document.querySelectorAll( 'canvas' ) ].sort( ( a, b ) => b.width * b.height - a.width * a.height )[ 0 ];
			const r = canvas.getBoundingClientRect(), out = [], why = [];
			for ( const c of app.ferry.traffic.cars ) {

				if ( ! c.group.visible || c.state !== 'queue' ) continue;
				const paint = c.group.children.find( m => m.isInstancedMesh && m.material.name === 'Paint' );
				if ( ! paint || ! paint.instanceColor ) {

					// what the body is drawn with instead (the red run's evidence)
					why.push( c.name + ': ' + c.group.children.filter( m => m.isMesh ).map( m => `${ m.type }/${ m.material.name }/${ m.instanceColor ? 'tinted' : 'untinted' }` ).join( ',' ) );
					continue;

				}
				if ( ! paint.geometry.boundingBox ) paint.geometry.computeBoundingBox();
				const b = paint.geometry.boundingBox, a = paint.instanceColor.array;
				const p = new V( ( b.min.x + b.max.x ) / 2, b.max.y - 0.02, ( b.min.z + b.max.z ) / 2 ).applyMatrix4( paint.matrixWorld ).project( cam );
				const x = r.left + ( p.x + 1 ) / 2 * r.width, y = r.top + ( 1 - p.y ) / 2 * r.height;
				// clear of the HUD chips along the top and the minimap in the corner
				if ( p.z > 1 || x < innerWidth * 0.12 || x > innerWidth * 0.82 || y < innerHeight * 0.18 || y > innerHeight * 0.8 ) continue;
				out.push( { name: c.name, x, y, tint: 0.2126 * a[ 0 ] + 0.7152 * a[ 1 ] + 0.0722 * a[ 2 ] } );

			}
			return { out, why };

		} );
		console.log( `traffic bodies without a tint: ${ roofs.why.join( '; ' ) || 'none' }` );
		const shot = await page.screenshot( { path: `${ OUT }/traffic-colours.png` } );
		const drawn = await page.evaluate( async ( { png, roofs } ) => {

			const img = await createImageBitmap( await ( await fetch( 'data:image/png;base64,' + png ) ).blob() );
			const cv = new OffscreenCanvas( img.width, img.height ), g = cv.getContext( '2d' ), k = img.width / innerWidth;
			g.drawImage( img, 0, 0 );
			return roofs.map( s => {

				const d = g.getImageData( Math.round( s.x * k ) - 3, Math.round( s.y * k ) - 3, 7, 7 ).data;
				let luma = 0;
				for ( let i = 0; i < d.length; i += 4 ) luma += 0.2126 * d[ i ] + 0.7152 * d[ i + 1 ] + 0.0722 * d[ i + 2 ];
				return { ...s, luma: luma / 49 };

			} );

		}, { png: shot.toString( 'base64' ), roofs: roofs.out } );
		console.log( `traffic colours (${ waiting } waiting): ${ drawn.map( s => `${ s.name } tint ${ s.tint.toFixed( 2 ) } drawn ${ s.luma.toFixed( 0 ) }` ).join( '; ' ) }` );
		// the bug left no Paint part on any everyday car, so none could be sampled; the paint mix is random per car,
		// so a white or silver one is not always waiting, and only those roofs carry the brightness check below
		expect( drawn.length, 'a painted everyday car waiting in the lanes, in view' ).toBeGreaterThan( 0 );
		const light = drawn.filter( s => s.tint >= 0.5 );
		// a white or silver roof in daylight draws far above the near-black (about 30 of 255) the bug drew
		for ( const s of light ) expect( s.luma, `${ s.name } painted ${ s.tint.toFixed( 2 ) } draws its roof at ${ s.luma.toFixed( 0 ) } of 255` ).toBeGreaterThan( 100 );

	} );

} );
