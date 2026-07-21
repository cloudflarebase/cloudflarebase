import { expect, test } from '@playwright/test';
import { SEED_PROJECT, SEED_TOTAL_USERS } from './helpers';

/**
 * Platform admin fleet dashboard (/admin). Uses the fixed test-only
 * ADMIN_SECRET from wrangler.e2e.jsonc, so this file skips itself on remote
 * stacks where the deployed secret is not known to the suite.
 */
const ADMIN_SECRET = 'e2e-admin-secret';

test.describe('platform admin fleet dashboard', () => {
	test.skip(!!process.env.BASE_URL, 'ADMIN_SECRET of a deployed stack is not known to the suite');

	test('rejects a wrong password', async ({ page }) => {
		await page.goto('/admin');
		await expect(page.getByTestId('admin-login')).toBeVisible();
		await page.getByTestId('admin-password').fill('definitely-not-the-secret');
		await page.getByTestId('admin-login-submit').click();
		await expect(page.getByTestId('admin-login-error')).toBeVisible();
		await expect(page.getByTestId('admin-page')).not.toBeVisible();
	});

	test('unlocks the fleet view and lists the seeded project with its users', async ({ page }) => {
		await page.goto('/admin');
		await page.getByTestId('admin-password').fill(ADMIN_SECRET);
		await page.getByTestId('admin-login-submit').click();
		await expect(page.getByTestId('admin-page')).toBeVisible();

		// The seeded project is listed with authoritative counts from its agent.
		const seedRow = page.getByTestId('admin-project-row').filter({ hasText: SEED_PROJECT }).first();
		await expect(seedRow).toBeVisible();
		const seedUsers = Number(await seedRow.getByTestId('admin-project-users').innerText());
		expect(seedUsers).toBeGreaterThanOrEqual(SEED_TOTAL_USERS);

		// Fleet totals aggregate at least the seeded users.
		const totalUsers = Number(
			await page.getByTestId('admin-stat-users').getByTestId('stat-value').innerText()
		);
		expect(totalUsers).toBeGreaterThanOrEqual(SEED_TOTAL_USERS);

		// Local/test stacks read the D1 mirror instead of Analytics Engine.
		await expect(page.getByTestId('admin-source')).toContainText('local D1 mirror');
	});

	test('keeps the session across reloads and signs out', async ({ page }) => {
		await page.goto('/admin');
		await page.getByTestId('admin-password').fill(ADMIN_SECRET);
		await page.getByTestId('admin-login-submit').click();
		await expect(page.getByTestId('admin-page')).toBeVisible();

		await page.reload();
		await expect(page.getByTestId('admin-page')).toBeVisible();

		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page.getByTestId('admin-login')).toBeVisible();
	});
});
