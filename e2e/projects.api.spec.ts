import { expect, test } from '@playwright/test';
import {
	authPath,
	configPath,
	overviewPath,
	SEED_PROJECT,
	SEED_TOTAL_USERS,
	SEED_USERS,
	settingsPath,
	uniqueEmail
} from './helpers';

test.describe('project agents (backend)', () => {
	test('fresh project self-provisions with an empty auth stack', async ({ request }) => {
		const project = 'e2e-api-fresh';
		const overview = await (await request.get(overviewPath(project))).json();

		expect(overview.projectId).toBe(project);
		expect(overview.users).toEqual([]);
		expect(overview.sessions).toEqual([]);
		expect(overview.state.provisionedAt).toBeTruthy();
		expect(overview.state.events.at(-1).type).toBe('project.provisioned');
	});

	test('projects are fully isolated from each other', async ({ request }) => {
		const projectA = 'e2e-api-iso-a';
		const projectB = 'e2e-api-iso-b';
		const email = uniqueEmail('isolation');

		const signUp = await request.post(authPath(projectA, 'sign-up/email'), {
			data: { email, password: 'isolation-password-1', name: 'Only In A' }
		});
		expect(signUp.ok()).toBe(true);

		const a = await (await request.get(overviewPath(projectA))).json();
		const b = await (await request.get(overviewPath(projectB))).json();

		expect(a.users.map((u: { email: string }) => u.email)).toContain(email);
		expect(b.users).toEqual([]);

		// The session cookie from project A must not authenticate against B.
		const sessionInB = await (await request.get(authPath(projectB, 'get-session'))).json();
		expect(sessionInB).toBeNull();
	});

	test('seeded project reports its baseline data', async ({ request }) => {
		const overview = await (await request.get(overviewPath(SEED_PROJECT))).json();

		expect(overview.state.users).toBe(SEED_TOTAL_USERS);
		// Sessions accumulate across runs on a reused local stack — only the
		// lower bound is deterministic.
		expect(overview.state.activeSessions).toBeGreaterThanOrEqual(1);
		const emails = overview.users.map((u: { email: string }) => u.email);
		for (const user of SEED_USERS) {
			expect(emails).toContain(user.email);
		}
	});

	test('invalid project ids are rejected', async ({ request }) => {
		const response = await request.get(overviewPath('Not_A_Valid_Project!'));
		expect(response.status()).toBe(400);
	});

	test('agent state sync surface is reachable through the web origin', async ({ request }) => {
		// Same path the dashboard's WebSocket uses (hooks.server.ts passthrough).
		const response = await request.get(`/agents/auth-agent/${SEED_PROJECT}/overview`);
		expect(response.ok()).toBe(true);
		const overview = await response.json();
		expect(overview.projectId).toBe(SEED_PROJECT);
	});

	test('exposes a public client configuration', async ({ request }) => {
		const config = await (await request.get(configPath(SEED_PROJECT))).json();
		expect(config.projectId).toBe(SEED_PROJECT);
		expect(config.authBaseUrl).toContain(`/api/projects/${SEED_PROJECT}/auth`);
		expect(config.endpoints.signUp).toBe('/sign-up/email');
	});

	test('persists validated trusted origins per isolated project', async ({ request }) => {
		const project = 'e2e-api-origins';
		const saved = await request.put(settingsPath(project), {
			data: { allowedOrigins: ['https://app.example.com', 'http://localhost:3000'] }
		});
		expect(saved.ok()).toBe(true);
		expect(await saved.json()).toMatchObject({
			allowedOrigins: ['https://app.example.com', 'http://localhost:3000'],
			enabledSocialProviders: []
		});
		const overview = await (await request.get(overviewPath(project))).json();
		expect(overview.state.allowedOrigins).toEqual([
			'https://app.example.com',
			'http://localhost:3000'
		]);

		const invalid = await request.put(settingsPath(project), {
			data: { allowedOrigins: ['http://insecure.example.com'] }
		});
		expect(invalid.status()).toBe(400);
	});

	test('configures social providers without exposing their secrets', async ({ request }) => {
		const project = 'e2e-api-social';
		const saved = await request.put(settingsPath(project), {
			data: {
				allowedOrigins: [],
				socialProviders: {
					google: { clientId: 'demo-google-id', clientSecret: 'demo-google-secret' }
				}
			}
		});
		expect(saved.ok()).toBe(true);
		expect(await saved.json()).toMatchObject({ enabledSocialProviders: ['google'] });

		const config = await (await request.get(configPath(project))).json();
		expect(config.providers).toContain('google');
		expect(JSON.stringify(config)).not.toContain('demo-google-secret');

		const preserved = await request.put(settingsPath(project), {
			data: {
				allowedOrigins: [],
				socialProviders: { google: { preserve: true } }
			}
		});
		expect(await preserved.json()).toMatchObject({ enabledSocialProviders: ['google'] });
	});

	test('trusted external origins receive CORS and bearer-token headers', async ({ request }) => {
		const project = 'e2e-api-cors';
		const origin = 'https://app.example.com';
		await request.put(settingsPath(project), { data: { allowedOrigins: [origin] } });
		const preflight = await request.fetch(authPath(project, 'sign-up/email'), {
			method: 'OPTIONS',
			headers: {
				origin,
				'access-control-request-method': 'POST',
				'access-control-request-headers': 'content-type'
			}
		});
		expect([200, 204]).toContain(preflight.status());
		expect(preflight.headers()['access-control-allow-origin']).toBe(origin);

		const signup = await request.post(authPath(project, 'sign-up/email'), {
			headers: { origin },
			data: {
				email: uniqueEmail('cors'),
				password: 'cors-password-123',
				name: 'External App User'
			}
		});
		expect(signup.ok()).toBe(true);
		expect(signup.headers()['access-control-allow-origin']).toBe(origin);
		expect(signup.headers()['access-control-expose-headers']).toContain('set-auth-token');
		expect(signup.headers()['set-auth-token']).toBeTruthy();
	});
});
