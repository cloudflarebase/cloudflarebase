# Cloudflarebase

Cloudflarebase is an agentic backend-as-a-service built directly on Cloudflare. The first MVP is **Auth Agent**: every demo project receives an isolated Cloudflare Agent backed by one Durable Object and embedded SQLite.

## Auth Agent MVP

- Email/password signup, signin, signout, and session lookup through Better Auth
- Anonymous guest sessions
- Optional Google OAuth
- Cookie sessions for same-origin applications
- Bearer tokens for external and non-browser clients
- Per-project trusted-origin configuration and CORS preflight support
- User deletion and individual session revocation from the dashboard
- Realtime user/session counters and activity through Agents SDK state sync
- Behavioral analytics written to Workers Analytics Engine
- A Workers AI project copilot grounded in operational and aggregated analytics data
- A public, isolated demo project created automatically for each browser

The Durable Object database is the source of truth for identities and active sessions. Workers Analytics Engine is the source for behavioral/time-series analytics. It is intentionally not used as an authoritative identity database because Analytics Engine is sampled and retains data for a limited window.

## Run locally

```bash
npm install
npm run dev
```

This starts the Auth Agent Worker on port `8788` and the SvelteKit dashboard on port `5173`.

Workers AI has no local simulator. The local Wrangler AI binding is remote, so AI chat requires a logged-in Cloudflare account and consumes Workers AI usage. The rest of Auth Agent works locally without AI credentials.

## Integrate a project

Open `/dashboard`, then use **Authentication → Connect**. The public configuration endpoint is:

```text
GET /api/projects/:projectId/config
```

Email signup:

```ts
const response = await fetch(
	'https://cloudflarebase.com/api/projects/PROJECT_ID/auth/sign-up/email',
	{
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			origin: 'https://your-app.example'
		},
		body: JSON.stringify({
			name: 'Ada Lovelace',
			email: 'ada@example.com',
			password: 'correct-horse-battery'
		})
	}
);

const bearerToken = response.headers.get('set-auth-token');
```

Authenticate later requests with either the project-scoped cookie or:

```ts
await fetch('https://cloudflarebase.com/api/projects/PROJECT_ID/auth/get-session', {
	headers: { authorization: `Bearer ${bearerToken}` }
});
```

Add an external browser origin in **Authentication → Settings** before making requests from that origin. Exact HTTPS origins are accepted; HTTP is accepted only for localhost development.

## Architecture

There are two independently deployed Workers:

- `cloudflarebase-com`: SvelteKit marketing site, public demo console, and same-origin API gateway
- `agents/auth`: Auth Agent service, with one `AuthAgent` Durable Object instance per project ID

The web Worker reaches Auth Agent through a service binding. Auth endpoints preserve the caller origin so Better Auth can apply its CSRF and trusted-origin checks. The Auth Agent applies Drizzle migrations to embedded Durable Object SQLite when it starts.

## Production configuration

Auth Agent requires:

```bash
cd agents/auth
npx wrangler secret put BETTER_AUTH_SECRET
```

Optional Google OAuth:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Verification and password-reset delivery uses Cloudflare Email Service in deployed environments. Onboard the `notifications.cloudflarebase.com` sending subdomain in Email Service; the Worker sends from `auth@notifications.cloudflarebase.com` through the structured `EMAIL.send()` binding. A signed webhook remains available as a fallback:

```bash
npx wrangler secret put AUTH_EMAIL_WEBHOOK_URL
npx wrangler secret put AUTH_EMAIL_WEBHOOK_SECRET
```

When the native email binding is unavailable, Cloudflarebase sends `POST` JSON with `{ projectId, type, to, url }` and, when configured, `Authorization: Bearer <AUTH_EMAIL_WEBHOOK_SECRET>`. Without either delivery method, core signup/signin remains available and project config reports `emailDeliveryConfigured: false`.

Analytics Engine event writes require no token. Dashboard SQL reads require:

```bash
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_ANALYTICS_API_TOKEN
```

The API token needs `Account Analytics Read`. Local and test environments mirror the same event dimensions into a D1 time-series table, so DAU/MAU, providers, countries, and charts work without Cloudflare account credentials. Production remains Analytics Engine-first; if its read credentials are absent or querying fails, auth remains available and the dashboard reports `write-only` or `error`.

## Validation

```bash
npm run check
npm run lint
npm run build
npm test
```

The Playwright suite boots a built SvelteKit Worker and Auth Agent Worker with isolated test persistence. Real Workers AI tests are opt-in:

```bash
RUN_AI_E2E=1 npm test
```

CI does not fake model output. It skips AI inference unless explicitly configured against a real remote binding.
