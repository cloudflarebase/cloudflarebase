import { expect, request as playwrightRequest, test } from '@playwright/test';
import { createAuthAdmin } from '../agents/auth/src/admin';
import { createDbAdmin, DbAgentTooOldError } from '../agents/db/src/admin';
import { createStorageAdmin } from '../agents/storage/src/admin';
import { ensureProject } from './helpers';

/**
 * The per-agent ADMIN clients.
 *
 * These drive the REAL exported clients, not a hand-rolled fetch that happens
 * to hit the same URLs - the point is to prove the published surface works,
 * including its URL building, its bearer header, and its error mapping.
 *
 * Node's `fetch` sends no `Origin`, which is exactly the shape a service key
 * requires and exactly why these clients cannot be used from a browser. That
 * is not incidental to the test; it IS the deployment shape.
 */

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const SDK_PROJECT = `svcsdk-${run}`.slice(0, 20);

function base(baseURL: string | undefined): string {
	return baseURL ?? process.env.BASE_URL ?? 'http://localhost:8797';
}

test.describe('admin clients', () => {
	let key = '';
	let url = '';

	test.beforeAll(async ({ playwright, baseURL }) => {
		url = base(baseURL);
		const operator = await playwright.request.newContext({
			baseURL: url,
			extraHTTPHeaders: { origin: url },
			storageState: 'e2e/.auth/console.json'
		});
		try {
			await ensureProject(operator, SDK_PROJECT);
			const minted = await operator.post(`/api/projects/${SDK_PROJECT}/keys`, {
				data: { name: 'admin-sdk' }
			});
			expect(minted.status(), await minted.text()).toBe(201);
			key = (await minted.json()).key;
		} finally {
			await operator.dispose();
		}
	});

	test('db: collections and tables through @frostbase/db/admin', async () => {
		const db = createDbAdmin({ url, projectId: SDK_PROJECT, key });

		const posts = db.collection<{ title: string; votes: number }>(`posts-${run}`);
		await posts.configure({ readAccess: 'auth', writeAccess: 'auth' });

		await posts.put('one', { title: 'from a cron', votes: 1 });
		const fetched = await posts.get('one');
		expect(fetched.data.title).toBe('from a cron');

		// Merge, not replace: the untouched field survives.
		await posts.patch('one', { votes: 9 });
		const merged = await posts.get('one');
		expect(merged.data.votes).toBe(9);
		expect(merged.data.title).toBe('from a cron');

		expect(await posts.count()).toBe(1);
		const { docs } = await posts.query({ limit: 10 });
		expect(docs.map((doc) => doc.id)).toContain('one');

		// Typed rows, same handle shape - plus SQL, which the public route would
		// refuse without a project JWT.
		const orders = db.table<{ label: string; done: boolean }>(`orders-${run}`);
		await orders.configure({
			readAccess: 'auth',
			writeAccess: 'auth',
			replication: 'off',
			columns: [
				{ name: 'label', type: 'text' },
				{ name: 'done', type: 'boolean', nullable: true }
			]
		});
		await orders.put('row-1', { label: 'ship it', done: false });
		expect((await orders.get('row-1')).data.label).toBe('ship it');
		await orders.patch('row-1', { done: true });
		expect((await orders.get('row-1')).data.done).toBe(true);

		const result = await orders.sql(`SELECT label FROM "orders-${run}" WHERE id = ?`, ['row-1']);
		expect(result.success).toBeTruthy();

		await posts.delete('one');
		await expect(posts.get('one')).rejects.toThrow(/no such/i);
	});

	test('auth: user lifecycle through @frostbase/auth/admin', async () => {
		const auth = createAuthAdmin({ url, projectId: SDK_PROJECT, key });
		const email = `sdk-${run}@example.com`;

		const created = await auth.createUser({ email, password: 'sdk-password-1', name: 'SDK User' });
		expect(created.email).toBe(email);
		expect(created.emailVerified).toBe(false);

		expect((await auth.getUser(created.id)).name).toBe('SDK User');

		const updated = await auth.updateUser(created.id, { name: 'Renamed', emailVerified: true });
		expect(updated.name).toBe('Renamed');
		expect(updated.emailVerified).toBe(true);

		await auth.setPassword(created.id, 'sdk-password-2');

		// The control: the account signs in through the ordinary public route
		// with the password the client set. Only this proves the hash is the one
		// Better Auth expects rather than bytes written somewhere.
		const browser = await playwrightRequest.newContext({
			baseURL: url,
			extraHTTPHeaders: { origin: url }
		});
		try {
			const signIn = await browser.post(`/api/projects/${SDK_PROJECT}/auth/sign-in/email`, {
				data: { email, password: 'sdk-password-2' }
			});
			expect(signIn.ok(), await signIn.text()).toBeTruthy();
		} finally {
			await browser.dispose();
		}

		const { users } = await auth.listUsers({ limit: 10 });
		expect(users.map((user) => user.email)).toContain(email);

		await auth.deleteUser(created.id);
		await expect(auth.getUser(created.id)).rejects.toThrow(/not found/i);
	});

	test('storage: bucket and object bytes through @frostbase/storage/admin', async () => {
		const storage = createStorageAdmin({ url, projectId: SDK_PROJECT, key });
		const bucket = storage.bucket('sdk-files');
		await bucket.configure({});

		const objectKey = `reports/${run}.bin`;
		const body = `generated with no user at ${run}`;
		await bucket.put(objectKey, body);

		const downloaded = await bucket.get(objectKey);
		expect(downloaded).not.toBeNull();
		expect(await downloaded!.text()).toBe(body);

		const { objects } = await bucket.list({ prefix: 'reports/' });
		expect(objects.map((object) => object.key)).toContain(objectKey);

		await bucket.delete(objectKey);
		expect(await bucket.get(objectKey)).toBeNull();
	});

	/**
	 * Keys the URL grammar is hostile to. The SvelteKit proxy DECODES the path
	 * param, so the route must re-encode before rebuilding the agent URL: a raw
	 * `#` would truncate the key at parsing, `?` would become a query string,
	 * and a literal `%` would read as malformed encoding. Every one of these
	 * keys silently addressed the WRONG object before the re-encode (a `#`-key
	 * PUT overwrote its own prefix).
	 */
	test('storage: keys with URL-hostile characters round-trip intact', async () => {
		const storage = createStorageAdmin({ url, projectId: SDK_PROJECT, key });
		const bucket = storage.bucket('sdk-files');
		await bucket.configure({});

		for (const objectKey of [
			`odd/${run} notes #1.txt`,
			`odd/${run}-100%.txt`,
			`odd/${run}-a?b.txt`
		]) {
			const body = `stored under ${objectKey}`;
			await bucket.put(objectKey, body);

			const downloaded = await bucket.get(objectKey);
			expect(downloaded, objectKey).not.toBeNull();
			expect(await downloaded!.text(), objectKey).toBe(body);

			// The exact key is indexed - not a truncation of it.
			const { objects } = await bucket.list({ prefix: 'odd/' });
			expect(
				objects.map((object) => object.key),
				objectKey
			).toContain(objectKey);

			await bucket.delete(objectKey);
			expect(await bucket.get(objectKey), objectKey).toBeNull();
		}
	});

	/**
	 * The client refuses the content types SvelteKit's CSRF check would reject
	 * on an originless write - BEFORE the request leaves, so the developer gets
	 * a sentence explaining it rather than a bare 403 from a layer they have
	 * never heard of.
	 */
	test('storage: form content types are refused locally, with a reason', async () => {
		const storage = createStorageAdmin({ url, projectId: SDK_PROJECT, key });
		await expect(
			storage.bucket('sdk-files').put('note.txt', 'hello', { contentType: 'text/plain' })
		).rejects.toThrow(/without an Origin/i);
	});

	/**
	 * The deploy-ordering safety net, which is the whole reason a client beats
	 * raw fetch here: an agent that predates a route answers a ROUTING 404,
	 * indistinguishable from "no such document" to anyone reading the status
	 * code. Treating it as an absent record is data-loss-shaped - a caller
	 * reads not-found and then writes over a record that exists.
	 */
	test('db: a routing 404 is not reported as a missing record', async () => {
		const db = createDbAdmin({
			url,
			projectId: SDK_PROJECT,
			key,
			// Stands in for an older deployed agent: a 404 that is not the
			// agent's own `{ error: 'no such ...' }` answer.
			fetch: async () =>
				new Response(JSON.stringify({ error: 'not found' }), {
					status: 404,
					headers: { 'content-type': 'application/json' }
				})
		});
		await expect(db.collection('anything').get('some-id')).rejects.toThrow(DbAgentTooOldError);
	});

	/** Server-only, enforced at construction rather than left to documentation. */
	test('the clients refuse to construct in a browser', async () => {
		const globals = globalThis as { document?: unknown };
		globals.document = {};
		try {
			expect(() => createDbAdmin({ url, projectId: SDK_PROJECT, key })).toThrow(/server-only/i);
			expect(() => createAuthAdmin({ url, projectId: SDK_PROJECT, key })).toThrow(/server-only/i);
			expect(() => createStorageAdmin({ url, projectId: SDK_PROJECT, key })).toThrow(
				/server-only/i
			);
		} finally {
			delete globals.document;
		}
	});

	/** Zero-config construction: the env vars a server already has. */
	test('resolves url, project, and key from the environment', async () => {
		const db = createDbAdmin({
			env: {
				FROSTBASE_URL: url,
				FROSTBASE_PROJECT: SDK_PROJECT,
				FROSTBASE_SERVICE_KEY: key
			}
		});
		expect(await db.collection(`posts-${run}`).count()).toBeGreaterThanOrEqual(0);

		// And a missing one names the variable rather than failing at the first
		// request with a 401.
		expect(() => createDbAdmin({ env: {} })).toThrow(/FROSTBASE_URL/);
	});
});
