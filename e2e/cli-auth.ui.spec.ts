import { createServer, type Server } from 'node:http';
import { expect, request as playwrightRequest, test } from '@playwright/test';

/**
 * The `frostbase login` browser hand-off, frontend half
 *: /cli-auth renders for a signed-in operator,
 * and Approve fetches the session token then form-POSTs it to the CLI's
 * localhost listener - played here by a real node:http server on an
 * ephemeral port, mirroring the CLI's exactly.
 */

test.describe('cli-auth hand-off', () => {
	test('approve delivers a working token to the localhost listener', async ({ page, baseURL }) => {
		const code = `e2e-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

		let deliver!: (value: { token: string; code: string }) => void;
		const delivery = new Promise<{ token: string; code: string }>((resolve) => {
			deliver = resolve;
		});
		const server: Server = createServer((request, response) => {
			let body = '';
			request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
			request.on('end', () => {
				response
					.writeHead(200, { 'content-type': 'text/html' })
					.end('<p>Signed in - close this tab.</p>');
				const params = new URLSearchParams(body);
				deliver({ token: params.get('token') ?? '', code: params.get('code') ?? '' });
			});
		});
		await new Promise<void>((resolve, reject) => {
			server.on('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const address = server.address();
		const port = typeof address === 'object' && address ? address.port : 0;
		expect(port).toBeGreaterThan(0);

		try {
			await page.goto(`/cli-auth?port=${port}&code=${encodeURIComponent(code)}`);
			await expect(page.getByTestId('cli-auth-approve')).toBeVisible();
			await page.getByTestId('cli-auth-approve').click();

			// The listener got exactly what the CLI expects: the one-time code it
			// minted plus a non-empty session token, never in a URL.
			const received = await delivery;
			expect(received.code).toBe(code);
			expect(received.token.length).toBeGreaterThan(0);

			// The form POST is a top-level navigation, so the browser now shows
			// the listener's confirmation answer.
			await expect(page.locator('body')).toContainText('Signed in');

			// And the delivered token authenticates a cookie-less client against
			// an operator route - the whole point of the hand-off.
			const bearer = await playwrightRequest.newContext({
				baseURL,
				extraHTTPHeaders: { origin: baseURL ?? '', authorization: `Bearer ${received.token}` }
			});
			try {
				const projects = await bearer.get('/api/registry/projects');
				expect(projects.status(), await projects.text()).toBe(200);
			} finally {
				await bearer.dispose();
			}
		} finally {
			server.close();
		}
	});

	test('explains itself without the port and code', async ({ page }) => {
		await page.goto('/cli-auth');
		await expect(page.getByTestId('cli-auth-invalid')).toBeVisible();
		await expect(page.getByTestId('cli-auth-approve')).toHaveCount(0);
	});
});

test.describe('cli-auth guard', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('signed-out visitors bounce through /login, demo mode included', async ({ page }) => {
		await page.goto('/cli-auth?port=8123&code=x');
		await expect(page).toHaveURL(/\/login\?next=%2Fcli-auth/);
	});
});
