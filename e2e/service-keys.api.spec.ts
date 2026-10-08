import {
	expect,
	request as playwrightRequest,
	test,
	type APIRequestContext
} from '@playwright/test';
import {
	authPath,
	ensureProject,
	SCRATCH_PROJECT,
	storageProxyObjectPath,
	storageProxyObjectsPath
} from './helpers';

/**
 * Project service keys (SK1).
 *
 * A key is admin-grade on its project's DATA plane, so the tests that matter
 * most are the ones proving what it CANNOT do. In order of how badly each
 * would hurt:
 *
 * 1. it must not work from a browser (any request carrying `Origin`);
 * 2. it must not reach another project - a sibling branch included, because
 *    for data the branch IS the isolation boundary;
 * 3. it must not escalate: no registry (so it cannot delete its own project),
 *    no console, no CLI, and no minting or revoking keys;
 * 4. revocation must bite immediately.
 *
 * The suite's stored operator session is what mints keys, so the key-using
 * contexts here are deliberately cookie-less: a service key must stand on its
 * own, never on an ambient session.
 */

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const KEY_PROJECT = `svckey-${run}`.slice(0, 20);

function base(baseURL: string | undefined): string {
	return baseURL ?? process.env.BASE_URL ?? 'http://localhost:8797';
}

/**
 * No cookies, and NO Origin - exactly how a server calls.
 *
 * The blank `origin` is load-bearing, not decoration: the `api` project sets
 * `extraHTTPHeaders: { origin: baseURL }` for every context it makes, and a
 * context built here inherits it. Without the override this context looks like
 * a BROWSER to the guard, every request 401s, and the suite would "pass" on
 * nothing but negative assertions. Blanking it is how a test expresses the one
 * thing a browser can never do - omit the header.
 */
async function serverContext(baseURL: string | undefined): Promise<APIRequestContext> {
	return playwrightRequest.newContext({
		baseURL: base(baseURL),
		extraHTTPHeaders: { origin: '' }
	});
}

test.describe('service keys', () => {
	let key = '';
	let keyId = '';

	test.beforeAll(async ({ playwright, baseURL }) => {
		const operator = await playwright.request.newContext({
			baseURL: base(baseURL),
			extraHTTPHeaders: { origin: base(baseURL) },
			storageState: 'e2e/.auth/console.json'
		});
		try {
			await ensureProject(operator, KEY_PROJECT);
			const minted = await operator.post(`/api/projects/${KEY_PROJECT}/keys`, {
				data: { name: 'ci' }
			});
			expect(minted.status(), await minted.text()).toBe(201);
			const body = await minted.json();
			expect(body.key).toMatch(/^fsb_[0-9a-f]{64}$/);
			key = body.key;
			keyId = body.id;

			// The secret is shown exactly once: listing returns metadata only.
			const listed = await operator.get(`/api/projects/${KEY_PROJECT}/keys`);
			expect(listed.ok()).toBeTruthy();
			const { keys } = await listed.json();
			expect(keys).toHaveLength(1);
			expect(JSON.stringify(keys)).not.toContain(key);
		} finally {
			await operator.dispose();
		}
	});

	test('reads and writes its own project, with no user and no session', async ({ baseURL }) => {
		const server = await serverContext(baseURL);
		try {
			const collection = `svc-${run}`;
			// An `auth`-mode collection: a tokenless caller could not touch this
			// through the public path. Admin-grade is the whole point.
			const declare = await server.put(
				`/api/projects/${KEY_PROJECT}/db/admin/collections/${collection}`,
				{
					headers: { authorization: `Bearer ${key}` },
					data: { readAccess: 'auth', writeAccess: 'auth' }
				}
			);
			expect(declare.ok(), await declare.text()).toBeTruthy();

			const write = await server.put(
				`/api/projects/${KEY_PROJECT}/db/admin/collections/${collection}/documents/seed-1`,
				{
					headers: { authorization: `Bearer ${key}` },
					data: { data: { title: 'from a cron' } }
				}
			);
			expect(write.ok(), await write.text()).toBeTruthy();

			const read = await server.post(`/api/projects/${KEY_PROJECT}/db/admin/query`, {
				headers: { authorization: `Bearer ${key}` },
				data: { collection, query: { limit: 10 } }
			});
			expect(read.ok(), await read.text()).toBeTruthy();
			const { docs } = await read.json();
			expect(docs.map((doc: { id: string }) => doc.id)).toContain('seed-1');
		} finally {
			await server.dispose();
		}
	});

	/**
	 * Storage OBJECTS, not just bucket config.
	 *
	 * Bucket metadata always worked. The BYTES did not and could not: the object
	 * routes existed only under `/agents/*`, which a service key is refused on,
	 * so a key could create a bucket and then never put anything in it. That
	 * made storage - a whole primitive - unreachable from a server.
	 *
	 * This test is its own positive control by construction: every assertion
	 * fails with 404 if the proxy route is missing, which is distinguishable
	 * from the 401 a rejected key produces. It cannot pass on nothing.
	 */
	test('reads and writes storage OBJECTS, not just bucket config', async ({ baseURL }) => {
		const server = await serverContext(baseURL);
		try {
			const bucket = 'svc-objects';
			// A folder-shaped key: slashes are legitimate in object keys, and the
			// proxy has to carry them through without the URL parser eating them.
			const objectKey = `cron/note-${run}.txt`;
			const body = `written with no user and no session at ${run}`;
			const auth = { authorization: `Bearer ${key}` };

			const declare = await server.put(
				`/api/projects/${KEY_PROJECT}/storage/admin/buckets/${bucket}`,
				{ headers: auth, data: {} }
			);
			expect(declare.ok(), await declare.text()).toBeTruthy();

			// NOT text/plain, and that is not an arbitrary choice: SvelteKit's CSRF
			// check runs before any hook and forbids PUT with a FORM content type
			// (text/plain, multipart/form-data, x-www-form-urlencoded) when the
			// request carries no Origin - which is exactly what a service key is.
			// Known and accepted; everything else on this surface passes.
			const put = await server.put(storageProxyObjectPath(KEY_PROJECT, bucket, objectKey), {
				headers: { ...auth, 'content-type': 'application/octet-stream' },
				data: body
			});
			expect(put.ok(), await put.text()).toBeTruthy();

			const got = await server.get(storageProxyObjectPath(KEY_PROJECT, bucket, objectKey), {
				headers: auth
			});
			expect(got.status(), await got.text()).toBe(200);
			expect(await got.text()).toBe(body);

			const listed = await server.get(storageProxyObjectsPath(KEY_PROJECT, bucket), {
				headers: auth
			});
			expect(listed.ok(), await listed.text()).toBeTruthy();
			expect((await listed.json()).objects.map((o: { key: string }) => o.key)).toContain(objectKey);

			const removed = await server.delete(storageProxyObjectPath(KEY_PROJECT, bucket, objectKey), {
				headers: auth
			});
			expect(removed.ok(), await removed.text()).toBeTruthy();

			const gone = await server.get(storageProxyObjectPath(KEY_PROJECT, bucket, objectKey), {
				headers: auth
			});
			expect(gone.status()).toBe(404);
		} finally {
			await server.dispose();
		}
	});

	/**
	 * Reading and merging ONE record by id.
	 *
	 * The admin surface used to be write-only per record: PUT and DELETE
	 * existed, GET and PATCH did not, and `/admin/query` cannot stand in -
	 * compileQuery turns every `where.field` into a JSON path into `data`, so
	 * `id` (a system column) is unreachable by any query the DSL can express. A
	 * server could write a document and then never read it back.
	 *
	 * Both kinds, because they must not need different idioms for the same
	 * operation - tables could already do this through admin SQL, which is not
	 * an API for a single-row read.
	 */
	test('reads and merges a single record by id, collections and tables alike', async ({
		baseURL
	}) => {
		const server = await serverContext(baseURL);
		try {
			const auth = { authorization: `Bearer ${key}` };
			const collection = `svc-doc-${run}`;
			const table = `svc-row-${run}`;
			const docPath = `/api/projects/${KEY_PROJECT}/db/admin/collections/${collection}/documents/item-1`;
			const rowPath = `/api/projects/${KEY_PROJECT}/db/admin/tables/${table}/rows/row-1`;

			// --- documents ---
			const declareCollection = await server.put(
				`/api/projects/${KEY_PROJECT}/db/admin/collections/${collection}`,
				{ headers: auth, data: { readAccess: 'auth', writeAccess: 'auth' } }
			);
			expect(declareCollection.ok(), await declareCollection.text()).toBeTruthy();

			const wrote = await server.put(docPath, {
				headers: auth,
				data: { data: { title: 'first', keep: 'untouched' } }
			});
			expect(wrote.ok(), await wrote.text()).toBeTruthy();

			const readBack = await server.get(docPath, { headers: auth });
			expect(readBack.status(), await readBack.text()).toBe(200);
			expect((await readBack.json()).data.title).toBe('first');

			const patched = await server.patch(docPath, {
				headers: auth,
				data: { data: { title: 'second' } }
			});
			expect(patched.ok(), await patched.text()).toBeTruthy();

			// A MERGE, not a replace: the field the patch never mentioned survives.
			const merged = await server.get(docPath, { headers: auth });
			const doc = await merged.json();
			expect(doc.data.title).toBe('second');
			expect(doc.data.keep).toBe('untouched');

			// Absent ids are 404 on both verbs - and PATCH must never CREATE, or
			// it would invent a record missing every field the caller assumed was
			// already there.
			const missing = await server.get(`${docPath}-nope`, { headers: auth });
			expect(missing.status()).toBe(404);
			const patchMissing = await server.patch(`${docPath}-nope`, {
				headers: auth,
				data: { data: { title: 'ghost' } }
			});
			expect(patchMissing.status()).toBe(404);

			// --- typed rows, same idiom ---
			const declareTable = await server.put(
				`/api/projects/${KEY_PROJECT}/db/admin/tables/${table}`,
				{
					headers: auth,
					data: {
						readAccess: 'auth',
						writeAccess: 'auth',
						replication: 'off',
						columns: [
							{ name: 'title', type: 'text' },
							{ name: 'done', type: 'boolean', nullable: true }
						]
					}
				}
			);
			expect(declareTable.ok(), await declareTable.text()).toBeTruthy();

			const wroteRow = await server.put(rowPath, {
				headers: auth,
				data: { data: { title: 'first', done: false } }
			});
			expect(wroteRow.ok(), await wroteRow.text()).toBeTruthy();

			const readRow = await server.get(rowPath, { headers: auth });
			expect(readRow.status(), await readRow.text()).toBe(200);
			expect((await readRow.json()).data.title).toBe('first');

			const patchedRow = await server.patch(rowPath, {
				headers: auth,
				data: { data: { done: true } }
			});
			expect(patchedRow.ok(), await patchedRow.text()).toBeTruthy();

			const mergedRow = await (await server.get(rowPath, { headers: auth })).json();
			expect(mergedRow.data.done).toBe(true);
			expect(mergedRow.data.title).toBe('first');
		} finally {
			await server.dispose();
		}
	});

	/**
	 * User management with no sign-up flow.
	 *
	 * The auth admin surface could list, re-role, and delete. It could not
	 * CREATE an account, read one by id, update one, or set a password - so
	 * seeding, invite-first products, and migrating off another provider were
	 * all impossible from a server. The end-user sign-up route is not a
	 * substitute: it obeys the project's sign-up mode and starts a verification
	 * mail.
	 *
	 * The positive control is deliberately the strongest one available: the
	 * created account SIGNS IN through the ordinary public route, which is the
	 * only thing that proves the password was hashed the way Better Auth
	 * expects rather than merely written somewhere.
	 */
	test('creates, reads, updates, and re-passwords a user with no sign-up flow', async ({
		baseURL
	}) => {
		const server = await serverContext(baseURL);
		// Signing in is a browser-shaped act, so it needs a real Origin - the
		// opposite of the service-key contract, and the point: two different
		// credentials, two different doors, one account.
		const enduser = await playwrightRequest.newContext({
			baseURL: base(baseURL),
			extraHTTPHeaders: { origin: base(baseURL) }
		});
		try {
			const auth = { authorization: `Bearer ${key}` };
			const email = `svc-user-${run}@example.com`;
			const first = 'seeded-password-1';
			const second = 'rotated-password-2';

			const created = await server.post(`/api/projects/${KEY_PROJECT}/admin/users`, {
				headers: auth,
				data: { email, password: first, name: 'Seeded By Cron' }
			});
			expect(created.status(), await created.text()).toBe(201);
			const user = await created.json();
			expect(user.email).toBe(email);
			// Not verified merely because an admin made it.
			expect(user.emailVerified).toBe(false);
			const userId = user.id;

			const read = await server.get(`/api/projects/${KEY_PROJECT}/admin/users/${userId}`, {
				headers: auth
			});
			expect(read.status(), await read.text()).toBe(200);
			expect((await read.json()).name).toBe('Seeded By Cron');

			// Email is the identity: a second account on it is a 409, never a
			// silent duplicate that makes sign-in resolve to the wrong person.
			const duplicate = await server.post(`/api/projects/${KEY_PROJECT}/admin/users`, {
				headers: auth,
				data: { email }
			});
			expect(duplicate.status()).toBe(409);

			const patched = await server.patch(`/api/projects/${KEY_PROJECT}/admin/users/${userId}`, {
				headers: auth,
				data: { name: 'Renamed', emailVerified: true }
			});
			expect(patched.ok(), await patched.text()).toBeTruthy();
			const updated = await patched.json();
			expect(updated.name).toBe('Renamed');
			expect(updated.emailVerified).toBe(true);

			// The control: a real sign-in with the admin-set password.
			const signIn = await enduser.post(authPath(KEY_PROJECT, 'sign-in/email'), {
				data: { email, password: first }
			});
			expect(signIn.ok(), await signIn.text()).toBeTruthy();

			// Rotate it, then prove BOTH halves - the old one stops working and
			// the new one starts. Only asserting the new one would pass just as
			// well if the write had done nothing at all.
			const rotated = await server.put(
				`/api/projects/${KEY_PROJECT}/admin/users/${userId}/password`,
				{ headers: auth, data: { newPassword: second } }
			);
			expect(rotated.ok(), await rotated.text()).toBeTruthy();

			const stale = await enduser.post(authPath(KEY_PROJECT, 'sign-in/email'), {
				data: { email, password: first }
			});
			expect(stale.ok()).toBeFalsy();

			const fresh = await enduser.post(authPath(KEY_PROJECT, 'sign-in/email'), {
				data: { email, password: second }
			});
			expect(fresh.ok(), await fresh.text()).toBeTruthy();

			// And role is NOT writable through the general update - the lockout
			// guards on /role must not be reachable around.
			const escalate = await server.patch(`/api/projects/${KEY_PROJECT}/admin/users/${userId}`, {
				headers: auth,
				data: { role: 'admin' }
			});
			expect(escalate.status()).toBe(400);

			// The OTHER branch of writePassword: an account created with no
			// password has no credential row at all, so setting one has to LINK
			// rather than update. That is the same branch the local-dev reset
			// hatch relies on for social-only accounts, and nothing else in the
			// suite reaches it (that route only exists under
			// DISABLE_EMAIL_VERIFICATION, which env.test does not set).
			const invited = `svc-invite-${run}@example.com`;
			const passwordless = await server.post(`/api/projects/${KEY_PROJECT}/admin/users`, {
				headers: auth,
				data: { email: invited, name: 'No Credential Yet' }
			});
			expect(passwordless.status(), await passwordless.text()).toBe(201);
			const invitedId = (await passwordless.json()).id;

			const cannotSignIn = await enduser.post(authPath(KEY_PROJECT, 'sign-in/email'), {
				data: { email: invited, password: second }
			});
			expect(cannotSignIn.ok()).toBeFalsy();

			const linked = await server.put(
				`/api/projects/${KEY_PROJECT}/admin/users/${invitedId}/password`,
				{ headers: auth, data: { newPassword: second } }
			);
			expect(linked.ok(), await linked.text()).toBeTruthy();

			const nowSignsIn = await enduser.post(authPath(KEY_PROJECT, 'sign-in/email'), {
				data: { email: invited, password: second }
			});
			expect(nowSignsIn.ok(), await nowSignsIn.text()).toBeTruthy();

			await server.delete(`/api/projects/${KEY_PROJECT}/admin/users/${invitedId}`, {
				headers: auth
			});

			const cleanup = await server.delete(`/api/projects/${KEY_PROJECT}/admin/users/${userId}`, {
				headers: auth
			});
			expect(cleanup.ok(), await cleanup.text()).toBeTruthy();

			const gone = await server.get(`/api/projects/${KEY_PROJECT}/admin/users/${userId}`, {
				headers: auth
			});
			expect(gone.status()).toBe(404);
		} finally {
			await server.dispose();
			await enduser.dispose();
		}
	});

	/**
	 * CSRF, credential-aware (`csrfHandle` in src/hooks.server.ts).
	 *
	 * `fetch` defaults a string body - `JSON.stringify(...)` included - to
	 * `text/plain;charset=UTF-8`, one of the three FORM content types the CSRF
	 * rule refuses on a write with no Origin. A service key never sends an
	 * Origin, so SvelteKit's blanket version refused the most natural raw-HTTP
	 * call a server can write, before the key was ever read, on the PRIMARY
	 * documented path rather than some edge.
	 *
	 * The replacement skips the check only when an `Authorization` header is
	 * present, which a browser cannot attach cross-origin without a preflight
	 * this app does not answer. The cookie case keeps the full check - pinned
	 * in `security.api.spec.ts`, because relaxing this wrongly would make the
	 * whole console API CSRF-able, sign-in included.
	 */
	test('a bearer write is not treated as a cross-site form submission', async ({ baseURL }) => {
		const server = await serverContext(baseURL);
		try {
			// Self-contained: this test must not depend on a collection another
			// test happened to create, or running it alone fails on its own setup.
			const collection = `csrf-${run}`;
			const declare = await server.put(
				`/api/projects/${KEY_PROJECT}/db/admin/collections/${collection}`,
				{ headers: { authorization: `Bearer ${key}` }, data: {} }
			);
			expect(declare.ok(), await declare.text()).toBeTruthy();

			// Control: the explicit-JSON spelling, which always worked.
			const asJson = await server.fetch(`/api/projects/${KEY_PROJECT}/db/admin/query`, {
				method: 'POST',
				headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
				data: JSON.stringify({ collection, query: { limit: 1 } })
			});
			expect(asJson.ok(), await asJson.text()).toBeTruthy();

			// And the spelling `body: JSON.stringify(...)` actually produces. This
			// answered 403 before csrfHandle existed.
			const asTextPlain = await server.fetch(`/api/projects/${KEY_PROJECT}/db/admin/query`, {
				method: 'POST',
				headers: { authorization: `Bearer ${key}`, 'content-type': 'text/plain;charset=UTF-8' },
				data: JSON.stringify({ collection, query: { limit: 1 } })
			});
			expect(asTextPlain.ok(), await asTextPlain.text()).toBeTruthy();

			// Storage was the other casualty: a .txt upload is legitimate content,
			// not a mistake, and it could not be uploaded at all.
			const bucket = 'svc-objects';
			await server.put(`/api/projects/${KEY_PROJECT}/storage/admin/buckets/${bucket}`, {
				headers: { authorization: `Bearer ${key}` },
				data: {}
			});
			const upload = await server.put(
				storageProxyObjectPath(KEY_PROJECT, bucket, `notes-${run}.txt`),
				{
					headers: { authorization: `Bearer ${key}`, 'content-type': 'text/plain' },
					data: 'a plain text file, which is a normal thing to store'
				}
			);
			expect(upload.ok(), await upload.text()).toBeTruthy();
		} finally {
			await server.dispose();
		}
	});

	test('is refused from a browser - any Origin at all', async ({ baseURL }) => {
		// The single highest-value guard: a key pasted into frontend code fails
		// at the developer's desk instead of shipping inside a JS bundle.
		const browser = await playwrightRequest.newContext({
			baseURL: base(baseURL),
			extraHTTPHeaders: { origin: base(baseURL) }
		});
		try {
			const denied = await browser.post(`/api/projects/${KEY_PROJECT}/db/admin/query`, {
				headers: { authorization: `Bearer ${key}` },
				data: { collection: 'anything', query: { limit: 1 } }
			});
			expect(denied.status()).toBe(401);

			// Even a foreign origin - the refusal is on the header's PRESENCE,
			// not on whether it is trusted, so no allowlist can ever admit one.
			const foreign = await playwrightRequest.newContext({
				baseURL: base(baseURL),
				extraHTTPHeaders: { origin: 'https://evil.example' }
			});
			try {
				const denied2 = await foreign.post(`/api/projects/${KEY_PROJECT}/db/admin/query`, {
					headers: { authorization: `Bearer ${key}` },
					data: { collection: 'anything', query: { limit: 1 } }
				});
				expect(denied2.status()).toBe(401);
			} finally {
				await foreign.dispose();
			}
		} finally {
			await browser.dispose();
		}
	});

	test('cannot reach another project, or escalate anywhere', async ({ baseURL }) => {
		const server = await serverContext(baseURL);
		try {
			// POSITIVE CONTROL FIRST. Every other assertion here expects 401, so
			// without this they would all pass just as happily if the key never
			// worked at all - which is exactly the state an earlier run of this
			// spec was in. Prove the key is live in THIS context before proving
			// what it cannot reach.
			const live = await server.get(`/api/projects/${KEY_PROJECT}/db/overview`, {
				headers: { authorization: `Bearer ${key}` }
			});
			expect(live.ok(), await live.text()).toBeTruthy();

			// Another project's data - the tenant boundary.
			const other = await server.post(`/api/projects/${SCRATCH_PROJECT}/db/admin/query`, {
				headers: { authorization: `Bearer ${key}` },
				data: { collection: 'anything', query: { limit: 1 } }
			});
			expect(other.status()).toBe(401);

			// A key must not be able to grow, outlive itself, or destroy what it
			// belongs to. Every one of these is a plain 401, never a session.
			const escalations: [string, string][] = [
				['GET', `/api/projects/${KEY_PROJECT}/keys`],
				['POST', `/api/projects/${KEY_PROJECT}/keys`],
				['DELETE', `/api/projects/${KEY_PROJECT}/keys/${keyId}`],
				['GET', `/api/registry/projects`],
				['DELETE', `/api/registry/projects/${KEY_PROJECT}`],
				['POST', `/api/projects/${KEY_PROJECT}/branches`],
				['POST', `/api/cli/token`]
			];
			for (const [method, path] of escalations) {
				const response = await server.fetch(path, {
					method,
					headers: { authorization: `Bearer ${key}` },
					data: {}
				});
				expect(response.status(), `${method} ${path}`).toBe(401);
			}

			// And the project still exists after all that.
			const operator = await playwrightRequest.newContext({
				baseURL: base(baseURL),
				extraHTTPHeaders: { origin: base(baseURL) },
				storageState: 'e2e/.auth/console.json'
			});
			try {
				const alive = await operator.get(`/api/projects/${KEY_PROJECT}/keys`);
				expect(alive.ok()).toBeTruthy();
			} finally {
				await operator.dispose();
			}
		} finally {
			await server.dispose();
		}
	});

	test('a garbage or revoked key is a plain 401, never a session fallback', async ({ baseURL }) => {
		const server = await serverContext(baseURL);
		try {
			// Positive control, same reason as above: the revocation assertion
			// below is only meaningful if the key worked immediately before it.
			const before = await server.get(`/api/projects/${KEY_PROJECT}/db/overview`, {
				headers: { authorization: `Bearer ${key}` }
			});
			expect(before.ok(), await before.text()).toBeTruthy();

			// Both prefixes - current `fsb_` and pre-rename `cfbs_` - reach the
			// verifier, so a well-formed key that matches no digest must 401 on each.
			for (const prefix of ['fsb_', 'cfbs_']) {
				const garbage = await server.post(`/api/projects/${KEY_PROJECT}/db/admin/query`, {
					headers: { authorization: `Bearer ${prefix}${'0'.repeat(64)}` },
					data: { collection: 'anything', query: { limit: 1 } }
				});
				expect(garbage.status(), prefix).toBe(401);
			}

			const operator = await playwrightRequest.newContext({
				baseURL: base(baseURL),
				extraHTTPHeaders: { origin: base(baseURL) },
				storageState: 'e2e/.auth/console.json'
			});
			try {
				const revoked = await operator.delete(`/api/projects/${KEY_PROJECT}/keys/${keyId}`);
				expect(revoked.ok(), await revoked.text()).toBeTruthy();
			} finally {
				await operator.dispose();
			}

			// Immediately - there is no verification cache in front of the digest
			// lookup, precisely so a leaked key cannot outlive its revocation.
			const dead = await server.post(`/api/projects/${KEY_PROJECT}/db/admin/query`, {
				headers: { authorization: `Bearer ${key}` },
				data: { collection: 'anything', query: { limit: 1 } }
			});
			expect(dead.status()).toBe(401);
		} finally {
			await server.dispose();
		}
	});

	/**
	 * LAST, because it deletes the project. A key outlives its registry row only
	 * after a delete fan-out that half-failed - and reaching an unregistered id
	 * is precisely how a Durable Object gets minted by URL, which is the hole
	 * the guard's registry check exists to close. The key verifies fine here;
	 * the missing row is what refuses it.
	 */
	test('a key whose project is gone is refused, even though the key verifies', async ({
		baseURL
	}) => {
		const operator = await playwrightRequest.newContext({
			baseURL: base(baseURL),
			extraHTTPHeaders: { origin: base(baseURL) },
			storageState: 'e2e/.auth/console.json'
		});
		// Wrapped rather than assigned into a pre-declared `let`: the initial ''
		// was never read (eslint no-useless-assignment), and returning from the
		// try keeps disposal guaranteed without one.
		const orphan: string = await (async () => {
			try {
				const minted = await operator.post(`/api/projects/${KEY_PROJECT}/keys`, {
					data: { name: 'orphan' }
				});
				expect(minted.status(), await minted.text()).toBe(201);
				return (await minted.json()).key as string;
			} finally {
				await operator.dispose();
			}
		})();

		const server = await serverContext(baseURL);
		try {
			// Positive control: live while the project is.
			const alive = await server.get(`/api/projects/${KEY_PROJECT}/db/overview`, {
				headers: { authorization: `Bearer ${orphan}` }
			});
			expect(alive.ok(), await alive.text()).toBeTruthy();

			const operator2 = await playwrightRequest.newContext({
				baseURL: base(baseURL),
				extraHTTPHeaders: { origin: base(baseURL) },
				storageState: 'e2e/.auth/console.json'
			});
			try {
				const removed = await operator2.delete(`/api/registry/projects/${KEY_PROJECT}`);
				expect([200, 207]).toContain(removed.status());
			} finally {
				await operator2.dispose();
			}

			const orphaned = await server.get(`/api/projects/${KEY_PROJECT}/db/overview`, {
				headers: { authorization: `Bearer ${orphan}` }
			});
			expect(orphaned.status()).toBe(401);
		} finally {
			await server.dispose();
		}
	});
});
