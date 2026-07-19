import { expect, test } from '@playwright/test';
import { adminSessionPath, adminUserPath, authPath, overviewPath, uniqueEmail } from './helpers';

const PROJECT = 'e2e-api-flow';
const PASSWORD = 'a-strong-password-42';

test.describe('auth lifecycle (backend)', () => {
	test('sign up → session → sign out', async ({ request }) => {
		const email = uniqueEmail('lifecycle');

		const signUp = await request.post(authPath(PROJECT, 'sign-up/email'), {
			data: { email, password: PASSWORD, name: 'Lifecycle User' }
		});
		expect(signUp.status()).toBe(200);
		const created = await signUp.json();
		expect(created.user.email).toBe(email);
		expect(created.token).toBeTruthy();

		// The session cookie set by sign-up authenticates follow-up requests.
		const session = await (await request.get(authPath(PROJECT, 'get-session'))).json();
		expect(session.user.email).toBe(email);
		expect(new Date(session.session.expiresAt).getTime()).toBeGreaterThan(Date.now());

		const signOut = await request.post(authPath(PROJECT, 'sign-out'), { data: {} });
		expect(signOut.ok()).toBe(true);

		const afterSignOut = await (await request.get(authPath(PROJECT, 'get-session'))).json();
		expect(afterSignOut).toBeNull();
	});

	test('sign in with wrong password is rejected', async ({ request }) => {
		const email = uniqueEmail('wrong-pass');
		await request.post(authPath(PROJECT, 'sign-up/email'), {
			data: { email, password: PASSWORD, name: 'Wrong Pass' }
		});

		const signIn = await request.post(authPath(PROJECT, 'sign-in/email'), {
			data: { email, password: 'not-the-password' }
		});
		expect(signIn.status()).toBe(401);
	});

	test('duplicate email sign-up is rejected', async ({ request }) => {
		const email = uniqueEmail('duplicate');
		const first = await request.post(authPath(PROJECT, 'sign-up/email'), {
			data: { email, password: PASSWORD, name: 'First' }
		});
		expect(first.ok()).toBe(true);

		const second = await request.post(authPath(PROJECT, 'sign-up/email'), {
			data: { email, password: PASSWORD, name: 'Second' }
		});
		expect(second.status()).toBeGreaterThanOrEqual(400);
		expect(second.status()).toBeLessThan(500);
	});

	test('requests from untrusted origins are rejected (CSRF)', async ({ request }) => {
		const signIn = await request.post(authPath(PROJECT, 'sign-in/email'), {
			data: { email: uniqueEmail('csrf'), password: PASSWORD },
			headers: { origin: 'https://evil.example.com' }
		});
		expect(signIn.status()).toBe(403);
	});

	test('project administrator can revoke a session', async ({ request }) => {
		const project = 'e2e-api-revoke';
		const email = uniqueEmail('revoke');
		await request.post(authPath(project, 'sign-up/email'), {
			data: { email, password: PASSWORD, name: 'Revoke Me' }
		});
		const overview = await (await request.get(overviewPath(project))).json();
		const session = overview.sessions.find((item: { email: string }) => item.email === email);
		expect(session).toBeTruthy();
		const revoked = await request.delete(adminSessionPath(project, session.id));
		expect(revoked.ok()).toBe(true);
		expect(await (await request.get(authPath(project, 'get-session'))).json()).toBeNull();
	});

	test('project administrator can delete a user and cascading sessions', async ({ request }) => {
		const project = 'e2e-api-delete-user';
		const email = uniqueEmail('delete');
		await request.post(authPath(project, 'sign-up/email'), {
			data: { email, password: PASSWORD, name: 'Delete Me' }
		});
		const before = await (await request.get(overviewPath(project))).json();
		const user = before.users.find((item: { email: string }) => item.email === email);
		expect(user).toBeTruthy();
		const deleted = await request.delete(adminUserPath(project, user.id));
		expect(deleted.ok()).toBe(true);
		const after = await (await request.get(overviewPath(project))).json();
		expect(after.users.map((item: { email: string }) => item.email)).not.toContain(email);
		expect(after.sessions.map((item: { email: string }) => item.email)).not.toContain(email);
	});

	test('management mutations return 404 for unknown records', async ({ request }) => {
		expect((await request.delete(adminUserPath(PROJECT, 'missing-user'))).status()).toBe(404);
		expect((await request.delete(adminSessionPath(PROJECT, 'missing-session'))).status()).toBe(404);
	});
});
