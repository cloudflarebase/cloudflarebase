import { expect, test } from '@playwright/test';
import { authPath, uniqueEmail } from './helpers';

/**
 * The project registry, which lives in D1 on the dashboard Worker rather than
 * inside an agent. These run with the stored operator session, because every
 * registry route is operator-only.
 */

/** Unique per run so a locally reused stack never collides. */
function scratchId(): string {
	return `reg-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`.slice(
		0,
		32
	);
}

async function listIds(request: import('@playwright/test').APIRequestContext): Promise<string[]> {
	const response = await request.get('/api/registry/projects');
	expect(response.ok(), await response.text()).toBeTruthy();
	const body = await response.json();
	return body.projects.map((p: { id: string }) => p.id);
}

test.describe('project registry', () => {
	test('creates a project and lists it', async ({ request }) => {
		const id = scratchId();

		const created = await request.post('/api/registry/projects', {
			data: { id, name: 'Registry Test' }
		});
		expect(created.status(), await created.text()).toBe(201);

		const body = await created.json();
		expect(body.project.id).toBe(id);
		expect(body.project.name).toBe('Registry Test');
		// Serialised from a D1 timestamp column, so this must survive the round trip.
		expect(Date.parse(body.project.createdAt)).not.toBeNaN();

		expect(await listIds(request)).toContain(id);
	});

	test('rejects a duplicate id', async ({ request }) => {
		const id = scratchId();
		await request.post('/api/registry/projects', { data: { id, name: 'First' } });

		const second = await request.post('/api/registry/projects', {
			data: { id, name: 'Second' }
		});
		expect(second.status()).toBe(409);
	});

	test('rejects reserved and malformed ids', async ({ request }) => {
		for (const id of ['console', 'admin', 'api', 'Not Valid', '']) {
			const response = await request.post('/api/registry/projects', {
				data: { id, name: 'Nope' }
			});
			expect(response.status(), `"${id}" should be refused`).toBe(400);
		}
	});

	test('deleting a project erases its auth data', async ({ request }) => {
		const id = scratchId();
		await request.post('/api/registry/projects', { data: { id, name: 'Doomed' } });

		// Give the project a real user, so the fan-out has something to erase.
		const signUp = await request.post(authPath(id, 'sign-up/email'), {
			data: { name: 'Doomed User', email: uniqueEmail('doomed'), password: 'doomed-password-1' }
		});
		expect(signUp.ok(), await signUp.text()).toBeTruthy();

		const before = await (await request.get(`/api/projects/${id}/overview`)).json();
		expect(before.users.length).toBe(1);

		const deleted = await request.delete(`/api/registry/projects/${id}`);
		expect(deleted.ok(), await deleted.text()).toBeTruthy();

		// Gone from the registry...
		expect(await listIds(request)).not.toContain(id);

		// ...and the agent's database is empty rather than merely unreferenced.
		// Dropping only the row would strand a Durable Object holding real users.
		await expect
			.poll(
				async () => {
					const after = await (await request.get(`/api/projects/${id}/overview`)).json();
					return after.users?.length ?? -1;
				},
				{ timeout: 15_000 }
			)
			.toBe(0);
	});

	test('deleting an unknown project is a 404', async ({ request }) => {
		const response = await request.delete(`/api/registry/projects/${scratchId()}`);
		expect(response.status()).toBe(404);
	});
});
