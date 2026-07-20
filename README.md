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
- Near-real-time, local-time behavioral charts backed by Workers Analytics Engine
- A Workers AI project copilot grounded in operational and aggregated analytics data
- Per-client AI conversation history persisted in Durable Object SQLite using a project-scoped IP hash
- A public, isolated demo project created automatically for each browser

The Durable Object database is the source of truth for identities and active sessions. Workers Analytics Engine is the source for behavioral/time-series analytics. It is intentionally not used as an authoritative identity database because Analytics Engine is sampled and retains data for a limited window.

## Run locally

```bash
npm install
npm run dev
```

This starts the Auth Agent Worker on port `8788` and the SvelteKit dashboard on port `5173`.

Workers AI has no local simulator. Local chat uses the remote binding; the rest of Auth Agent works without AI.

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

## Deploy to your Cloudflare account

Authenticate Wrangler, install dependencies, update the Worker names/domains and resource IDs in the Wrangler configs, then deploy the Auth Agent before the web Worker:

```bash
npx wrangler login
npm install
```

Generate a Better Auth secret locally (at least 32 random bytes):

```bash
openssl rand -base64 48
cd agents/auth
npx wrangler secret put BETTER_AUTH_SECRET
```

Paste the generated value at the prompt. For preview, append `--env preview`.

Analytics Engine writes need no credentials. For dashboard SQL reads, create a custom Cloudflare API token in **My Profile → API Tokens** with **Account → Account Analytics → Read**, restricted to your account. Then, from `agents/auth`:

```bash
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_ANALYTICS_API_TOKEN
```

Use your 32-character account ID for `CF_ACCOUNT_ID` and the custom token for `CF_ANALYTICS_API_TOKEN`. Secrets are environment-specific; append `--env preview` when configuring preview.

Deploy both Workers:

```bash
cd agents/auth
npm run deploy
cd ../..
npm run deploy
```

Optional OAuth and email delivery require their corresponding secrets/bindings in `agents/auth/wrangler.jsonc`. Workers AI failure affects chat only; authentication remains available.

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
