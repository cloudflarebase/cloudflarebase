import { expect, test as setup } from '@playwright/test';
import { CONSOLE_OWNER, CONSOLE_STORAGE_STATE, consoleAuthPath } from './helpers';

/**
 * Claims the console owner and parks the session for every other project.
 *
 * Runs before seeding because the seed itself reads operator-only endpoints.
 * Idempotent for locally reused stacks: once an owner exists the agent refuses
 * further sign-ups on the console instance, so a 403 there is the expected
 * second-run outcome and the sign-in below is what actually matters.
 */
setup('claim the console owner', async ({ request }) => {
	const signUp = await request.post(consoleAuthPath('sign-up/email'), { data: CONSOLE_OWNER });
	if (!signUp.ok()) {
		expect(
			signUp.status(),
			'sign-up should either succeed or be refused because an owner exists'
		).toBe(403);
	}

	const signIn = await request.post(consoleAuthPath('sign-in/email'), {
		data: { email: CONSOLE_OWNER.email, password: CONSOLE_OWNER.password }
	});
	expect(signIn.ok(), await signIn.text()).toBeTruthy();

	await request.storageState({ path: CONSOLE_STORAGE_STATE });
});
