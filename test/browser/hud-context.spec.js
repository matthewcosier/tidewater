// Contextual HUD chips and Activity Wheel keyboard flow. Driven with the player's own keys.
import { test, expect } from '@playwright/test';

test( 'Fishing purse and ATM PIN stay off the beach during exploration, appear in context, and hide in free camera', async ( { page }, info ) => {

	const pin = page.getByLabel( /^Card PIN/ );
	const purse = page.locator( '.gm-purse' );
	await test.step( 'Given I land on the beach in open-world holiday exploration', async () => {

		await page.route( 'https://fonts.googleapis.com/**', r => r.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=.6&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
		await page.keyboard.press( 'Enter' );
		await expect( page.getByRole( 'dialog' ) ).toBeHidden();
		await expect( pin ).toBeHidden();
		await expect( purse ).toBeHidden();

	} );
	await test.step( 'When I press R to take out the fishing rod then the purse appears contextually', async () => {

		await page.keyboard.press( 'r' );
		await expect( purse ).toBeVisible();
		await expect( pin ).toBeHidden();

	} );
	await test.step( 'When I press F for the free camera then the purse leaves the screen', async () => {

		await page.keyboard.press( 'f' );
		await expect( page.locator( '.tw-mode' ) ).toHaveText( /Free camera/ );
		await expect( pin ).toBeHidden();
		await expect( purse ).toBeHidden();
		await page.screenshot( { path: info.outputPath( 'hud-freecam.png' ) } );

	} );
	await test.step( 'When I press F again to walk then free camera stowed the rod and pressing R brings the purse back', async () => {

		await page.keyboard.press( 'f' );
		await expect( page.locator( '.tw-mode' ) ).toHaveText( /Walking/ );
		await expect( purse ).toBeHidden();
		await page.keyboard.press( 'r' );
		await expect( purse ).toBeVisible();

	} );
	await test.step( 'When I stow the rod with R then the purse hides again', async () => {

		await page.keyboard.press( 'r' );
		await expect( purse ).toBeHidden();

	} );

} );

test( 'The Activity Wheel opens simulation panels from the keyboard and Escape returns focus to the launcher', async ( { page }, info ) => {

	const launcher = page.getByRole( 'button', { name: 'Activities menu' } );
	const wheel = page.getByRole( 'menu', { name: 'Activity Wheel' } );
	await test.step( 'Given I am on the beach with the compact Activities launcher replacing the old tool bar', async () => {

		await page.route( 'https://fonts.googleapis.com/**', r => r.fulfill( { contentType: 'text/css', body: '' } ) );
		await page.goto( '/?scale=.6&noAudio' );
		await expect( page.getByRole( 'status', { name: 'Loading Tidewater' } ) ).toBeHidden( { timeout: 120000 } );
		await page.keyboard.press( 'Enter' );
		await expect( launcher ).toBeVisible();
		await expect( page.getByRole( 'navigation', { name: 'World controls' } ) ).toBeHidden();

	} );
	await test.step( 'When I tap M and pick World then Wind Farm with the keyboard', async () => {

		await page.keyboard.press( 'm' );
		await expect( wheel ).toBeVisible();
		await expect( wheel.getByRole( 'menuitem' ) ).toHaveCount( 6 );
		await page.keyboard.press( 'Digit4' ); // World
		await page.keyboard.press( 'Digit5' ); // Wind Farm

	} );
	await test.step( 'Then the wind farm panel is open, and Escape closes it and returns focus to Activities', async () => {

		const panel = page.getByRole( 'region', { name: 'Wind farm controls' } );
		await expect( panel ).toBeVisible();
		await page.screenshot( { path: info.outputPath( 'tools-windfarm-open.png' ) } );
		await page.keyboard.press( 'Escape' );
		await expect( panel ).toBeHidden();
		await expect( launcher ).toBeFocused();

	} );

} );
