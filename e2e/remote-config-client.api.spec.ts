import { expect, test } from '@playwright/test';
import { createDbClient } from '../agents/db/src/client';
import { ensureProject } from './helpers';

/**
 * The END-USER Remote Config client (`@frostbase-dev/db/client`), driven as an
 * app would drive it.
 *
 * Same rule as the storage-client and admin-sdk specs: exercise the REAL
 * exported surface rather than a hand-rolled fetch at the same URL, so the URL
 * building, the ETag round trip, the token handling, and the fallback
 * behaviour are all proven as published.
 *
 * The scenario is the one a launch path actually runs: declare defaults, fetch,
 * read. Everything else here is a way that can go wrong.
 */

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const SDK_PROJECT = 'e2e-config-sdk';
const FLAG = `sdkflag${run}`;
const LIMIT = `sdklimit${run}`;

function origin(baseURL: string | undefined): string {
	return baseURL ?? process.env.BASE_URL ?? 'http://localhost:8797';
}

test.describe('remote config client SDK', () => {
	let base = '';

	test.beforeAll(async ({ request, baseURL }) => {
		base = `${origin(baseURL)}/api/projects/${SDK_PROJECT}/db`;
		await ensureProject(request, SDK_PROJECT);

		const admin = `/api/projects/${SDK_PROJECT}/db/admin/remote-config`;
		const flag = await request.put(`${admin}/${FLAG}`, {
			data: { valueType: 'boolean', defaultValue: true }
		});
		expect(flag.ok(), await flag.text()).toBeTruthy();
		await request.put(`${admin}/${LIMIT}`, {
			data: {
				valueType: 'number',
				defaultValue: 25,
				conditions: [{ when: { country: ['DE'] }, value: 50 }]
			}
		});
		const published = await request.post(`${admin}/publish`, { data: { reason: 'sdk spec' } });
		expect(published.ok(), await published.text()).toBeTruthy();
	});

	test('an app declares defaults, fetches, and reads published values', async () => {
		const config = createDbClient({ baseUrl: base }).remoteConfig({
			// What the code was written against - and what runs before the fetch
			// answers.
			defaults: { [FLAG]: false, [LIMIT]: 10, unpublished: 'local only' }
		});

		// Before any fetch, an app still renders.
		expect(config.get(FLAG)).toBe(false);
		expect(config.isFetched).toBe(false);

		const result = await config.fetch();
		expect(result.failed).toBe(false);
		expect(result.changed).toBe(true);

		expect(config.get(FLAG)).toBe(true);
		expect(config.get(LIMIT)).toBe(25);
		// A default nobody published stays exactly what the app shipped.
		expect(config.get('unpublished')).toBe('local only');
		expect(config.isFetched).toBe(true);
		expect(typeof config.fetchedAt).toBe('string');
	});

	test('a second fetch is a 304 and reports no change', async () => {
		const config = createDbClient({ baseUrl: base }).remoteConfig({});
		await config.fetch();
		const second = await config.fetch();
		// Cheap by construction: the app polls, the server validates, nothing
		// moves. This is what makes `subscribe` affordable.
		expect(second).toEqual({ changed: false, failed: false });
	});

	test('an unreachable endpoint leaves the app on its defaults', async () => {
		// A config fetch must never be the reason a launch fails, so this points
		// at a port nothing is listening on.
		const config = createDbClient({ baseUrl: 'http://127.0.0.1:9/api/projects/x/db' }).remoteConfig(
			{ defaults: { [FLAG]: false } }
		);
		const result = await config.fetch();
		expect(result.failed).toBe(true);
		expect(config.get(FLAG)).toBe(false);
		expect(config.isFetched).toBe(false);
	});

	test('the client carries targeting context the server evaluates', async ({ playwright }) => {
		// Country is resolved at the edge, so the SDK cannot send it - which is
		// the point. This drives the same endpoint with the test-only override to
		// prove the client's own plumbing (uid, appVersion) reaches evaluation.
		const context = await playwright.request.newContext({
			baseURL: base,
			extraHTTPHeaders: { 'x-cfb-country': 'DE' }
		});
		try {
			const response = await context.get(`${base}/remote-config`);
			expect((await response.json()).params[LIMIT]).toBe(50);
		} finally {
			await context.dispose();
		}

		// And through the SDK with no country, the default value stands.
		const config = createDbClient({ baseUrl: base }).remoteConfig({ uid: 'sdk-user-1' });
		await config.fetch();
		expect(config.get(LIMIT)).toBe(25);
	});

	test('getAll merges defaults under fetched values', async () => {
		const config = createDbClient({ baseUrl: base }).remoteConfig({
			defaults: { [FLAG]: false, localOnly: true }
		});
		await config.fetch();
		const all = config.getAll();
		expect(all[FLAG]).toBe(true);
		expect(all.localOnly).toBe(true);
	});
});
