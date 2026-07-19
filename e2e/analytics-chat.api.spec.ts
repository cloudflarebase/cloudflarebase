import { expect, test, type APIRequestContext } from '@playwright/test';
import { analyticsPath, chatPath, SEED_PROJECT, SEED_TOTAL_USERS, SEED_USERS } from './helpers';

test.describe('analytics (backend)', () => {
	test('reports user, activity, provider and country analytics', async ({ request }) => {
		const response = await request.get(analyticsPath(SEED_PROJECT));
		expect(response.ok()).toBe(true);
		const analytics = await response.json();

		expect(analytics.projectId).toBe(SEED_PROJECT);
		expect(analytics.totalUsers).toBe(SEED_TOTAL_USERS);
		expect(analytics.registeredUsers).toBe(SEED_USERS.length);
		expect(analytics.anonymousUsers).toBe(1);

		// Behavioral metrics are read exclusively from Analytics Engine. Local CI
		// has no account-level SQL credentials, so it validates the unavailable
		// state instead of silently querying the transactional SQLite database.
		expect(analytics.wau).toBeGreaterThanOrEqual(analytics.dau);
		expect(analytics.mau).toBeGreaterThanOrEqual(analytics.wau);
		expect(analytics.activeSessions).toBeGreaterThanOrEqual(1);

		// Workers Analytics Engine pipeline: writes always flow; SQL querying
		// is enabled only when account credentials are configured on the agent.
		expect(analytics.engine.dataset).toContain('auth_events');
		expect(typeof analytics.engine.enabled).toBe('boolean');
		expect(['connected', 'local', 'write-only', 'error']).toContain(analytics.engine.status);
		if (!analytics.engine.enabled) {
			expect(analytics.dau).toBe(0);
			expect(analytics.providers).toEqual([]);
			expect(analytics.countries).toEqual([]);
		}
	});
});

test.describe('agent chat (backend)', () => {
	test.skip(!process.env.RUN_AI_E2E, 'set RUN_AI_E2E=1 to test the real Workers AI binding');
	async function ask(request: APIRequestContext, question: string) {
		const response = await request.post(chatPath(SEED_PROJECT), { data: { question } });
		expect(response.ok()).toBe(true);
		const reply = await response.json();
		expect(reply.mode).toBe('workers-ai');
		expect(reply.model).toContain('@cf/');
		return reply;
	}

	test('answers DAU/MAU questions with live numbers', async ({ request }) => {
		const reply = await ask(request, "What's our DAU and MAU?");
		expect(reply.topic).toBe('ai-analysis');
		expect(reply.answer).toMatch(/DAU|daily active/i);
	});

	test('answers anonymous vs registered questions', async ({ request }) => {
		const reply = await ask(request, 'How many anonymous users do we have?');
		expect(reply.topic).toBe('ai-analysis');
		expect(reply.answer).toMatch(/anonymous|guest/i);
	});

	test('answers sign-in provider questions', async ({ request }) => {
		const reply = await ask(request, 'How many users signed in with Google?');
		expect(reply.topic).toBe('ai-analysis');
		expect(reply.answer).toMatch(/credential|Google/i);
	});

	test('answers country questions', async ({ request }) => {
		const reply = await ask(request, 'Where are our users from?');
		expect(reply.topic).toBe('ai-analysis');
		expect(reply.answer).toMatch(/countr|location|session/i);
	});

	test('falls back to a project summary for open questions', async ({ request }) => {
		const reply = await ask(request, 'Tell me about this project');
		expect(reply.topic).toBe('ai-analysis');
		expect(reply.answer.length).toBeGreaterThan(20);
	});

	test('rejects empty questions', async ({ request }) => {
		const response = await request.post(chatPath(SEED_PROJECT), { data: {} });
		expect(response.status()).toBe(400);
	});
});
