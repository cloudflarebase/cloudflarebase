import { expect, request as playwrightRequest, test } from '@playwright/test';

/**
 * CLI console auth, API half: POST /api/cli/token
 * hands the signed-in operator their own session token, and the console guard
 * accepts that token as `Authorization: Bearer` on every operator surface -
 * the mechanism `frostbase login` and every `schema` command ride. No
 * new token store: the bearer IS the operator session.
 */

/** An operator route with no side effects, for proving a bearer works. */
const OPERATOR_ROUTE = '/api/registry/projects';

function bearerContext(baseURL: string | undefined, token: string) {
	return playwrightRequest.newContext({
		baseURL,
		extraHTTPHeaders: { origin: baseURL ?? '', authorization: `Bearer ${token}` }
	});
}

test.describe('cli token endpoint', () => {
	test('hands out the session token and it authenticates as a bearer', async ({
		request,
		baseURL
	}) => {
		const response = await request.post('/api/cli/token');
		expect(response.status(), await response.text()).toBe(200);
		const { token } = (await response.json()) as { token?: string };
		expect(typeof token).toBe('string');
		expect(token!.length).toBeGreaterThan(0);

		// A fresh cookie-less context: the bearer header is the only credential,
		// exactly how the CLI calls the console.
		const bearer = await bearerContext(baseURL, token!);
		try {
			const projects = await bearer.get(OPERATOR_ROUTE);
			expect(projects.status(), await projects.text()).toBe(200);
			const body = (await projects.json()) as { projects?: unknown };
			expect(Array.isArray(body.projects)).toBe(true);
		} finally {
			await bearer.dispose();
		}
	});

	test('a wrong bearer token is refused', async ({ baseURL }) => {
		const bearer = await bearerContext(baseURL, 'not-a-real-session-token');
		try {
			const projects = await bearer.get(OPERATOR_ROUTE);
			expect(projects.status()).toBe(401);
		} finally {
			await bearer.dispose();
		}
	});

	test('a cross-origin POST is refused even with a session', async ({ request }) => {
		const response = await request.post('/api/cli/token', {
			headers: { origin: 'https://evil.example' }
		});
		expect(response.status()).toBe(403);
	});
});

test.describe('cli token guard', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('anonymous requests get 401', async ({ request }) => {
		const response = await request.post('/api/cli/token');
		expect(response.status()).toBe(401);
	});
});
