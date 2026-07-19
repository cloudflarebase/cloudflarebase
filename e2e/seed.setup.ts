import { expect, request as requestFactory, test as setup } from '@playwright/test';
import {
	analyticsPath,
	authPath,
	overviewPath,
	SEED_PROJECT,
	SEED_TOTAL_USERS,
	SEED_USERS
} from './helpers';

/**
 * Seeds the baseline dataset through the public API — the same path a real
 * client takes. Idempotent so it works both against a freshly-wiped stack
 * (CI) and a reused local server: existing users sign in instead of signing
 * up (which also records today's activity for DAU), and the single anonymous
 * guest is only created once per stack.
 */
setup('seed baseline auth data', async ({ request }) => {
	// One anonymous guest — created first (before any session cookie exists).
	for (const user of SEED_USERS) {
		const signUp = await request.post(authPath(SEED_PROJECT, 'sign-up/email'), { data: user });
		if (!signUp.ok()) {
			// Already seeded on this stack — sign in to record today's activity.
			const signIn = await request.post(authPath(SEED_PROJECT, 'sign-in/email'), {
				data: { email: user.email, password: user.password }
			});
			expect(signIn.ok(), `seed sign-in failed for ${user.email}: ${await signIn.text()}`).toBe(
				true
			);
		}
	}

	const analytics = await (await request.get(analyticsPath(SEED_PROJECT))).json();
	if (analytics.anonymousUsers === 0) {
		const baseURL = process.env.BASE_URL ?? 'http://localhost:8797';
		const guest = await requestFactory.newContext({
			baseURL,
			extraHTTPHeaders: { origin: baseURL }
		});
		const anon = await guest.post(authPath(SEED_PROJECT, 'sign-in/anonymous'), { data: {} });
		expect(anon.ok(), `anonymous seed sign-in failed: ${await anon.text()}`).toBe(true);
		await guest.dispose();
	}

	await expect
		.poll(async () => {
			const overview = await (await request.get(overviewPath(SEED_PROJECT))).json();
			return overview.users.length;
		})
		.toBe(SEED_TOTAL_USERS);
});
