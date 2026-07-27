import { expect, test } from '@playwright/test';
import { authPath, configPath, overviewPath, settingsPath, uniqueEmail } from './helpers';

/**
 * A demo project has to be a real, working backend - everything the dashboard's
 * Integration tab tells a visitor to paste must actually run against it, with
 * no account and no operator session. The demo's ceilings (user cap, daily AI
 * cap, no outbound mail, self-erasure) exist to bound cost and abuse, and none
 * of them may cost the visitor the thing they came to try.
 *
 * These tests run unauthenticated on purpose.
 */
const DEMO_PROJECT = `demo-${'a1b2c3d4e5f6a7b8c9d0'}`;

test.describe('demo project', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('serves the full REST auth flow the integration guide advertises', async ({ request }) => {
		const email = uniqueEmail('demo-rest');
		const password = 'demo-rest-password-1';
		const base = (endpoint: string) => authPath(DEMO_PROJECT, endpoint);

		// 1. Sign up - the first snippet on the Integration tab.
		const signUp = await request.post(base('sign-up/email'), {
			data: { name: 'Demo Visitor', email, password }
		});
		expect(signUp.ok(), await signUp.text()).toBeTruthy();

		// 2. Bearer token for clients that are not same-origin, which is what the
		// snippet reads off the response for external apps.
		const token = signUp.headers()['set-auth-token'];
		expect(token, 'set-auth-token must be exposed for external clients').toBeTruthy();

		// 3. Read the session back with that token alone.
		const session = await request.get(base('get-session'), {
			headers: { authorization: `Bearer ${token}` }
		});
		expect(session.ok()).toBeTruthy();
		const body = await session.json();
		expect(body.user.email).toBe(email);

		// 4. Sign in again with the credentials, as a returning user would.
		const signIn = await request.post(base('sign-in/email'), { data: { email, password } });
		expect(signIn.ok(), await signIn.text()).toBeTruthy();
	});

	test('guest sign-in works for demo projects', async ({ request }) => {
		// Better Auth requires the JSON content type even on a bodyless POST.
		const guest = await request.post(authPath(DEMO_PROJECT, 'sign-in/anonymous'), { data: {} });
		expect(guest.ok(), await guest.text()).toBeTruthy();
	});

	test('exposes its public client config', async ({ request }) => {
		const config = await request.get(configPath(DEMO_PROJECT));
		expect(config.ok()).toBeTruthy();

		const body = await config.json();
		expect(body.projectId).toBe(DEMO_PROJECT);
		expect(body.providers).toContain('email-password');
		expect(body.bearerTokens).toBe(true);
	});

	test('a visitor can drive the console for their own demo project', async ({ request }) => {
		// No operator session: the demo bypass has to cover the dashboard reads
		// and the settings write, or the Integration tab's "add your origin"
		// step would be impossible for the visitor it is written for.
		const overview = await request.get(overviewPath(DEMO_PROJECT));
		expect(overview.ok()).toBeTruthy();

		const settings = await request.put(settingsPath(DEMO_PROJECT), {
			data: { allowedOrigins: ['https://demo-visitor.example.com'] }
		});
		expect(settings.ok(), await settings.text()).toBeTruthy();
	});

	test('demo limits do not reach named projects', async ({ request }) => {
		// The ceilings key off the demo id pattern, so a self-hosted project
		// called something ordinary must be unaffected even on this deployment.
		const named = await request.get(configPath('e2e-scratch'));
		expect(named.ok()).toBeTruthy();
	});
});
