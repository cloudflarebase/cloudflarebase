import { expect, request as playwrightRequest, test } from '@playwright/test';

/**
 * Smoke tests against the auth-agent worker directly (not through the web
 * worker). Only meaningful on the local stack — the agent has no public route
 * in production — so this file skips itself when BASE_URL targets a remote
 * stack (e.g. BrowserStack runs against a deployed URL).
 */
const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:8798';

test.describe('auth-agent worker (direct)', () => {
	test.skip(!!process.env.BASE_URL, 'agent worker is not directly reachable on remote stacks');

	test('health endpoint responds', async () => {
		const agent = await playwrightRequest.newContext({ baseURL: AGENT_URL });
		const response = await agent.get('/health');
		expect(response.ok()).toBe(true);
		expect(await response.json()).toEqual({ service: 'auth-agent', status: 'ok' });
		await agent.dispose();
	});

	test('unknown routes return 404', async () => {
		const agent = await playwrightRequest.newContext({ baseURL: AGENT_URL });
		const response = await agent.get('/definitely-not-a-route');
		expect(response.status()).toBe(404);
		await agent.dispose();
	});

	test('validates direct agent inputs without relying on the web worker', async () => {
		const agent = await playwrightRequest.newContext({ baseURL: AGENT_URL });
		const base = '/agents/auth-agent/e2e-agent-validation';

		const emptyChat = await agent.post(`${base}/chat`, { data: { question: '   ' } });
		expect(emptyChat.status()).toBe(400);

		const oversizedChat = await agent.post(`${base}/chat`, {
			data: { question: 'x'.repeat(501) }
		});
		expect(oversizedChat.status()).toBe(400);

		const invalidSettings = await agent.put(`${base}/admin/settings`, {
			data: {
				allowedOrigins: Array.from({ length: 11 }, (_, index) => `https://app${index}.example.com`),
				socialProviders: { github: { clientId: 'id', clientSecret: 'secret' } }
			}
		});
		expect(invalidSettings.status()).toBe(400);

		const unknownProvider = await agent.put(`${base}/admin/settings`, {
			data: { allowedOrigins: [], socialProviders: { unknown: { preserve: true } } }
		});
		expect(unknownProvider.status()).toBe(400);

		const invalidTimeZone = await agent.get(`${base}/analytics?timeZone=Definitely%2FNot_A_Zone`);
		expect(invalidTimeZone.status()).toBe(400);

		const oversizedId = await agent.delete(`${base}/admin/users/${'x'.repeat(129)}`);
		expect(oversizedId.status()).toBe(400);

		const invalidProject = await agent.get('/agents/auth-agent/Not_A_Valid_Project/overview');
		expect(invalidProject.status()).toBe(400);

		await agent.dispose();
	});
});
