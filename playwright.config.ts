import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests against a production-mirroring local stack:
 *  - web: the BUILT SvelteKit worker running in workerd (`wrangler dev --env test`, :8797)
 *  - auth-agent: agent worker in workerd (`wrangler dev --env test`, :8798)
 *  - real service bindings via the wrangler dev registry, fresh DO/DB state per run
 *
 * Remote / BrowserStack usage:
 *  - All tests navigate via `baseURL` and relative paths only. Set BASE_URL to
 *    target any deployed (or tunnelled) stack; the local servers are then not
 *    started. With BrowserStack, run through `browserstack-node-sdk` (or a
 *    `connectOptions` endpoint) and expose the local stack with BrowserStack
 *    Local — no test changes required.
 *  - The only exception is the direct agent smoke test, which skips itself
 *    when BASE_URL is set (the agent worker has no public route).
 */
const baseURL = process.env.BASE_URL ?? 'http://localhost:8797';

export default defineConfig({
	testDir: './e2e',
	// Keep tests within a file sequential (stateful flows); files run in parallel.
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	reporter: process.env.CI
		? [['github'], ['html', { open: 'never' }]]
		: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL,
		trace: 'on-first-retry'
	},
	projects: [
		// Seeds baseline data through the public API; everything depends on it.
		// Better Auth requires an Origin header on cookie-carrying POSTs, which
		// browsers send automatically — API contexts must set it themselves
		// (individual tests can still override it, e.g. the CSRF spec).
		{
			name: 'seed',
			testMatch: /.*\.setup\.ts/,
			use: { extraHTTPHeaders: { origin: baseURL } }
		},
		// Backend/API tests — no browser, Playwright request contexts only.
		{
			name: 'api',
			testMatch: /.*\.api\.spec\.ts/,
			dependencies: ['seed'],
			use: { extraHTTPHeaders: { origin: baseURL } }
		},
		// Frontend tests — real browser against the built app.
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
			testMatch: /.*\.ui\.spec\.ts/,
			dependencies: ['seed']
		}
	],
	// Locally, running servers are reused (fast re-runs, works with the VSCode
	// Test Explorer keeping servers alive) — seeding is idempotent to support
	// this. CI always starts from wiped state for a strict fresh-DB guarantee.
	// kill-port clears zombie workerd processes that survive a killed wrangler
	// wrapper on Windows and would otherwise hold ports/file locks.
	webServer: process.env.BASE_URL
		? undefined
		: [
				{
					command:
						'node scripts/kill-port.mjs 8798 && node scripts/clean-dir.mjs .wrangler/test-state/auth-agent && npm run dev:test --prefix agents/auth',
					url: 'http://localhost:8798/health',
					reuseExistingServer: !process.env.CI,
					timeout: 120_000
				},
				{
					command:
						'node scripts/kill-port.mjs 8797 && cross-env E2E_BUILD=true npm run build && node scripts/clean-dir.mjs .wrangler/test-state/web && wrangler dev --config wrangler.e2e.jsonc --port 8797 --persist-to .wrangler/test-state/web',
					url: 'http://localhost:8797/',
					reuseExistingServer: !process.env.CI,
					timeout: 300_000
				}
			]
});
