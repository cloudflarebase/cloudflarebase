import { expect, test } from '@playwright/test';
import {
	adminUserPath,
	analyticsPath,
	authPath,
	chatPath,
	configPath,
	CONSOLE_OWNER,
	consoleAuthPath,
	overviewPath,
	SCRATCH_PROJECT,
	SEED_PROJECT,
	settingsPath,
	uniqueEmail
} from './helpers';

/**
 * The console guard is the boundary that makes this repository safe to publish:
 * without it, anyone holding a project id could read that project's users and
 * delete them. These tests run deliberately unauthenticated.
 */
test.describe('console guard', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('operator endpoints reject anonymous callers', async ({ request }) => {
		const forbidden = [
			overviewPath(SEED_PROJECT),
			analyticsPath(SEED_PROJECT),
			settingsPath(SEED_PROJECT),
			'/api/registry/projects'
		];

		for (const path of forbidden) {
			const response = await request.get(path);
			expect(response.status(), `${path} should require an operator session`).toBe(401);
		}
	});

	test('destructive admin routes reject anonymous callers', async ({ request }) => {
		const response = await request.delete(adminUserPath(SEED_PROJECT, 'any-user-id'));
		expect(response.status()).toBe(401);
	});

	test('the chat endpoint is not a free anonymous AI proxy', async ({ request }) => {
		const response = await request.post(chatPath(SEED_PROJECT), {
			data: { question: 'who are the users?' }
		});
		expect(response.status()).toBe(401);
	});

	test('the agents passthrough is guarded too', async ({ request }) => {
		// The same Durable Object, reached by its public path rather than the
		// dashboard proxy — the guard has to cover both or it covers neither.
		const response = await request.get(`/agents/auth-agent/${SEED_PROJECT}/overview`);
		expect(response.status()).toBe(401);
	});

	test('the product API stays public', async ({ request }) => {
		// A customer's app must be able to sign users up without an operator.
		// Writes go to the scratch project — the seed project's counts are
		// asserted exactly elsewhere.
		const signUp = await request.post(authPath(SCRATCH_PROJECT, 'sign-up/email'), {
			data: {
				name: 'Guard Probe',
				email: uniqueEmail('guard-probe'),
				password: 'guard-probe-password-1'
			}
		});
		expect(signUp.ok(), await signUp.text()).toBeTruthy();

		const config = await request.get(configPath(SCRATCH_PROJECT));
		expect(config.ok()).toBeTruthy();
	});

	test('the demo dashboard needs no operator to be useful', async ({ request }) => {
		// The three surfaces are distinct: the demo is anonymous, /admin is the
		// operator's own monitoring, and the dashboard needs a session only where
		// it holds real projects. A demo deployment refuses console claims
		// entirely — nobody is meant to operate it — which is why the agent under
		// test does not set DEMO_MODE even though the web Worker does.
		const config = await request.get(configPath('console'));
		expect(config.ok(), 'the console instance is reachable for the login page').toBeTruthy();
	});

	test('the console instance refuses a second owner and guest sign-in', async ({ request }) => {
		const second = await request.post(consoleAuthPath('sign-up/email'), {
			data: {
				name: 'Interloper',
				email: uniqueEmail('interloper'),
				password: 'interloper-password-1'
			}
		});
		expect(second.status(), 'the console must accept exactly one owner').toBe(403);

		// Sent with a body so a rejection can only come from the console rule,
		// never from Better Auth's content-type check.
		const guest = await request.post(consoleAuthPath('sign-in/anonymous'), { data: {} });
		expect(guest.status(), 'the console must never issue guest sessions').toBe(403);
	});

	test('a valid operator session unlocks the same endpoints', async ({ request }) => {
		const signIn = await request.post(consoleAuthPath('sign-in/email'), {
			data: { email: CONSOLE_OWNER.email, password: CONSOLE_OWNER.password }
		});
		expect(signIn.ok(), await signIn.text()).toBeTruthy();

		const overview = await request.get(overviewPath(SEED_PROJECT));
		expect(overview.ok()).toBeTruthy();
	});
});
