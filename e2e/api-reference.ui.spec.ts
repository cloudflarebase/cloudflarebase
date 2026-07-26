import { expect, test } from '@playwright/test';
import { SEED_PROJECT } from './helpers';

/**
 * The API tab is the visible end of the zod → OpenAPI → Scalar chain. The
 * document having the right shape does not prove the reference renders it, so
 * this drives the actual page.
 */
test.describe('api reference (frontend)', () => {
	test("renders this project's endpoints", async ({ page }) => {
		await page.goto(`/dashboard/${SEED_PROJECT}/api`);

		const reference = page.getByTestId('api-reference');
		await expect(reference).toBeVisible();

		// Scalar loads and parses the document client-side, so wait for content
		// it can only have produced from our generated spec.
		await expect(reference.getByText('/auth/sign-up/email').first()).toBeVisible({
			timeout: 30_000
		});
		await expect(reference.getByText(SEED_PROJECT).first()).toBeVisible();
	});

	test('is reachable from the project sidebar', async ({ page }) => {
		await page.goto(`/dashboard/${SEED_PROJECT}`);

		const link = page.getByTestId('nav-api');
		await expect(link).toBeVisible();
		await link.click();

		await expect(page).toHaveURL(new RegExp(`/dashboard/${SEED_PROJECT}/api$`));
	});
});
