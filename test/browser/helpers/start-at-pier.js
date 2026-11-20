// The unfocused Enter shortcut keeps the original walk from the village boardwalk.
export async function startAtPier( page ) {
	await page.getByRole( 'button', { name: 'Walk instead', exact: true } ).waitFor();
	await page.keyboard.press( 'Enter' );
}
