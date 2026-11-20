import { test, expect, devices } from '@playwright/test';

const { userAgent, viewport, deviceScaleFactor } = devices[ 'iPhone 17 Pro' ];
test.use( { userAgent, viewport, deviceScaleFactor, isMobile: true, hasTouch: true } );

test( 'An iPhone player can enter the island after a bounded shader warm-up', async ( { page }, info ) => {
	let loads = 0;
	page.on( 'framenavigated', frame => { if ( frame === page.mainFrame() ) loads ++; } );
	await test.step( 'Given a fresh iPhone session loading the real island', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.addInitScript( () => {
			const counts = window.pipelineCounts = { active: 0, peak: 0, total: 0, characterEdge: 0, shadowEdge: 0, submissionsBeforeWarmup: 0, peakTextureBytes: 0 };
			const bytes = new WeakMap();
			let live = 0;
			const destroy = GPUTexture.prototype.destroy;
			GPUTexture.prototype.destroy = function () {
				live -= bytes.get( this ) || 0;
				bytes.delete( this );
				return destroy.call( this );
			};
			const texture = GPUDevice.prototype.createTexture;
			GPUDevice.prototype.createTexture = function ( desc ) {
				const edge = Math.max( desc.size.width ?? desc.size[ 0 ], desc.size.height ?? desc.size[ 1 ] ?? 1 );
				if ( /^char\d+$/.test( desc.label ) ) counts.characterEdge = Math.max( counts.characterEdge, edge );
				if ( desc.label === 'sunShadowMap' ) counts.shadowEdge = edge;
				const result = texture.call( this, desc );
				let w = result.width, h = result.height, d = result.depthOrArrayLayers, size = 0;
				const format = result.format;
				const bpp = /^r8/.test( format ) ? 1 : /^(rg8|r16|depth16)/.test( format ) ? 2 :
					/^(rgba16|rg32)/.test( format ) ? 8 : /^rgba32/.test( format ) ? 16 : 4;
				for ( let mip = 0; mip < result.mipLevelCount; mip ++ ) {
					size += w * h * d * bpp * result.sampleCount;
					w = Math.max( 1, w >> 1 ); h = Math.max( 1, h >> 1 );
					if ( result.dimension === '3d' ) d = Math.max( 1, d >> 1 );
				}
				live += size;
				bytes.set( result, size );
				counts.peakTextureBytes = Math.max( counts.peakTextureBytes, live );
				return result;
			};
			const submit = GPUQueue.prototype.submit;
			GPUQueue.prototype.submit = function ( buffers ) {
				if ( ! window.__app?.rally?.physics ) counts.submissionsBeforeWarmup ++;
				return submit.call( this, buffers );
			};
			for ( const key of [ 'createRenderPipelineAsync', 'createComputePipelineAsync' ] ) {
				const create = GPUDevice.prototype[ key ];
				GPUDevice.prototype[ key ] = function ( ...args ) {
					counts.total ++;
					counts.peak = Math.max( counts.peak, ++ counts.active );
					return create.apply( this, args ).finally( () => counts.active -- );
				};
			}
		} );
		await page.goto( '/' );
		await expect( page.getByRole( 'button', { name: 'Walk instead' } ) ).toBeVisible( { timeout: 145_000 } );
	} );
	await test.step( 'When the player taps to explore and skips the introduction', async () => {
		await page.getByRole( 'button', { name: 'Walk instead' } ).tap();
		const skip = page.getByRole( 'button', { name: 'Skip', exact: true } );
		await skip.tap();
		await expect( skip ).toBeHidden();
	} );
	await test.step( 'Then the island keeps drawing in the same document within its startup budget', async () => {
		const data = await page.evaluate( () => ( { ...window.pipelineCounts, pixels: document.querySelector( '#app canvas' ).width,
			width: innerWidth, draws: window.__app.engine.meshRenderer.stats.draws } ) );
		console.log( 'iPhone startup measurements', data );
		await page.screenshot( { path: info.outputPath( 'island.png' ) } );
		expect( loads ).toBe( 1 );
		expect( data.draws ).toBeGreaterThan( 0 );
		expect( data.total ).toBeGreaterThan( 2 );
		expect( data.peak ).toBeLessThanOrEqual( 2 );
		expect( data.pixels ).toBe( data.width );
		expect( data.peakTextureBytes ).toBeLessThan( 400 * 1024 ** 2 );
		expect( data.characterEdge ).toBeGreaterThan( 0 );
		expect( data.characterEdge ).toBeLessThanOrEqual( 256 );
		expect( data.shadowEdge ).toBe( 1024 );
		expect( data.submissionsBeforeWarmup ).toBeGreaterThan( 0 );
	} );
} );

test( 'After an interrupted iPhone load the player can choose when to try again', async ( { page } ) => {
	const retry = page.getByRole( 'button', { name: 'Load island again' } );
	await test.step( 'Given this tab was interrupted during a previous load', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.addInitScript( () => sessionStorage.setItem( 'tidewater.mobileLoading', '1' ) );
		await page.goto( '/' );
		await expect( retry ).toBeVisible();
		expect( await page.locator( '#app canvas' ).count() ).toBe( 0 );
	} );
	await test.step( 'When the player taps Load island again', async () => {
		await retry.tap();
	} );
	await test.step( 'Then the island opens and the interruption marker clears', async () => {
		await expect( page.getByRole( 'button', { name: 'Walk instead' } ) ).toBeVisible( { timeout: 145_000 } );
		expect( await page.evaluate( () => sessionStorage.getItem( 'tidewater.mobileLoading' ) ) ).toBeNull();
	} );
} );

test( 'An iPhone keeps rendering and playing audio after Explore and can enter the GT3', async ( { page }, info ) => {
	const errors = [];
	page.on( 'pageerror', e => errors.push( e.message ) );
	await test.step( 'Given a fresh iPhone loads the island with audio enabled', async () => {
		await page.route( 'https://fonts.googleapis.com/**', route => route.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.addInitScript( () => {
			const m = window.playBudget = { tap: 0, submits: 0, backlog: 0, decodePeak: 0, decoded: 0 };
			let outstanding = 0, decodes = 0;
			document.addEventListener( 'click', e => { if ( e.target.closest?.( '.tw-start-cta' ) ) m.tap = performance.now(); }, true );
			const submit = GPUQueue.prototype.submit;
			GPUQueue.prototype.submit = function ( commands ) {
				submit.call( this, commands );
				outstanding ++;
				if ( m.tap ) { m.submits ++; m.backlog = Math.max( m.backlog, outstanding ); }
				this.onSubmittedWorkDone().then( () => outstanding --, () => outstanding -- );
			};
			const decode = BaseAudioContext.prototype.decodeAudioData;
			BaseAudioContext.prototype.decodeAudioData = function ( bytes, ...args ) {
				m.decodePeak = Math.max( m.decodePeak, ++ decodes );
				return decode.call( this, bytes, ...args ).then( buffer => {
					m.decoded += buffer.length * buffer.numberOfChannels * 4;
					return buffer;
				} ).finally( () => decodes -- );
			};
		} );
		await page.goto( '/' );
		await expect( page.getByRole( 'button', { name: 'Walk instead' } ) ).toBeVisible( { timeout: 150000 } );
	} );
	await test.step( 'When the player taps Explore and skips the introduction', async () => {
		await page.getByRole( 'button', { name: 'Walk instead' } ).tap();
		await page.getByRole( 'button', { name: 'Skip', exact: true } ).tap();
	} );
	await test.step( 'Then the walking scene stays responsive with bounded rendering and sound work', async () => {
		await page.waitForFunction( () => playBudget.tap && performance.now() - playBudget.tap >= 12000 && playBudget.submits >= 120 && playBudget.decoded > 0, null, { timeout: 90000 } );
		const m = await page.evaluate( () => ( { ...playBudget, tris: __app.engine.meshRenderer.stats.triangles } ) );
		console.log( 'Explore on iPhone', m );
		expect( m.backlog ).toBeLessThanOrEqual( 1 );
		expect( m.decodePeak ).toBe( 1 );
		expect( m.tris ).toBeLessThan( 7_000_000 );
		await page.screenshot( { path: info.outputPath( 'walking.png' ) } );
	} );
	await test.step( 'When the player chooses the GT3 and taps Drive, then the driving HUD appears', async () => {
		await page.getByLabel( 'Vehicle', { exact: true } ).selectOption( 'gt3rs' );
		await page.getByLabel( 'Start at', { exact: true } ).selectOption( 'coast' );
		await page.getByRole( 'button', { name: 'Drive COSIER GT3 RS', exact: true } ).tap();
		await expect.poll( () => page.evaluate( () => __app.rally.active && __app.rally.vehicleKey ) ).toBe( 'gt3rs' );
		await expect( page.getByRole( 'status', { name: 'Rally telemetry' } ) ).toBeVisible();
		expect( errors ).toEqual( [] );
	} );
} );
