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
});
