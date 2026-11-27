// Shared Activity Wheel helper for browser specs. Clicks real visible UI controls.
import { expect } from '@playwright/test';

export async function pickWheel( page, ...path ) {
	await page.getByRole( 'button', { name: 'Activities menu' } ).click();
	const menu = page.getByRole( 'menu', { name: 'Activity Wheel' } );
	await expect( menu ).toBeVisible();
	for ( const step of path ) {
		await menu.getByRole( 'menuitem', { name: step, exact: true } ).click();
	}
	return menu;
}
