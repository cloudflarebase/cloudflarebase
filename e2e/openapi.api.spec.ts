import { expect, test } from '@playwright/test';
import { SEED_PROJECT } from './helpers';

/**
 * The OpenAPI document is generated from the same zod schemas the routes
 * validate with, so these assertions are really checking that the generator
 * still produces a usable document — not that someone updated a hand-written
 * file.
 */
test.describe('openapi document', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('is public and describes this project', async ({ request, baseURL }) => {
		const response = await request.get(`/api/projects/${SEED_PROJECT}/openapi.json`);
		expect(response.ok(), 'the document must be fetchable by API tooling').toBeTruthy();

		const doc = await response.json();
		expect(doc.openapi).toMatch(/^3\.1/);
		expect(doc.info.title).toContain(SEED_PROJECT);

		// Addressed at the project's real base URL, not a placeholder host.
		expect(doc.servers[0].url).toBe(`${baseURL}/api/projects/${SEED_PROJECT}`);
	});

	test('covers the public auth surface and the console surface', async ({ request }) => {
		const doc = await (await request.get(`/api/projects/${SEED_PROJECT}/openapi.json`)).json();

		for (const path of [
			'/auth/sign-up/email',
			'/auth/sign-in/email',
			'/auth/sign-in/anonymous',
			'/auth/get-session',
			'/auth/token',
			'/auth/jwks',
			'/config',
			'/overview',
			'/analytics',
			'/chat',
			'/admin/settings',
			'/admin/roles',
			'/admin/users/{userId}',
			'/admin/sessions/{sessionId}'
		]) {
			expect(doc.paths[path], `${path} should be documented`).toBeTruthy();
		}
	});

	test('resolves every schema reference it emits', async ({ request }) => {
		const doc = await (await request.get(`/api/projects/${SEED_PROJECT}/openapi.json`)).json();
		const components = doc.components.schemas;

		// A $ref pointing at a component that was never emitted renders as a
		// broken, empty section in the reference — catch it here instead.
		const refs = [...JSON.stringify(doc).matchAll(/"#\/components\/schemas\/([A-Za-z0-9_]+)"/g)];
		expect(refs.length).toBeGreaterThan(0);

		for (const [, name] of refs) {
			expect(components[name], `component ${name} is referenced but missing`).toBeTruthy();
		}

		// Document-level keywords must not leak into component schemas.
		for (const schema of Object.values(components) as Record<string, unknown>[]) {
			expect(schema.$schema).toBeUndefined();
			expect(schema.$id).toBeUndefined();
		}
	});
});
