<p align="center">
  <img src="static/brand/github-header.png" alt="Cloudflarebase" width="100%" />
</p>

<p align="center">
  <a href="https://cloudflarebase.com/dashboard"><strong>Live demo</strong></a> ·
  <a href="#deploy-your-own">Deploy your own</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" /></a>
  <a href="../../actions/workflows/quality.yaml"><img alt="Quality" src="../../actions/workflows/quality.yaml/badge.svg" /></a>
  <a href="../../actions/workflows/e2e.yaml"><img alt="E2E" src="../../actions/workflows/e2e.yaml/badge.svg" /></a>
</p>

An open-source Firebase alternative that runs entirely on your Cloudflare
account. Each project gets its own Durable Object running Better Auth on
embedded SQLite, plus a dashboard with live counters, analytics, an AI copilot,
and a generated API reference.

Auth is the first primitive. Database, storage, and the rest will follow the
same shape.

## Run it locally

```bash
git clone https://github.com/cloudflarebase/cloudflarebase.com.git
cd cloudflarebase.com
npm install
npm run dev
```

Open <http://localhost:5173/dashboard>. There are no secrets to set up. Local
dev runs in demo mode, so you get a throwaway project without signing in.

## Deploy your own

Two Workers. The agent goes first because the dashboard binds to it by name
(Cloudflare's deploy button does one Worker per click).

1. Agent: [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflarebase/cloudflarebase.com/tree/main/agents/auth)
2. Dashboard: [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflarebase/cloudflarebase.com)

Or from a clone: `npm run deploy:all`.

Then open the dashboard and create the first account. That account owns the
console and sign-up closes behind it. Your install is private by default.

A deployment trusts its own origin automatically, so sign-in works right
after deploy with nothing to configure. If you serve the console from another
domain or call the API from other apps, add those origins to
`TRUSTED_ORIGINS` (the CSRF allowlist) or per project under Settings.

Optional extras, all off until configured: Google/GitHub sign-in, email
delivery, Sentry, and analytics SQL reads (`CF_ACCOUNT_ID` +
`CF_ANALYTICS_API_TOKEN` with Account Analytics Read).

## Add auth to a Worker you already have

The console is optional. The agent is a normal npm package, and the CLI wires
it into an existing Worker project:

```bash
npm install -g @cloudflarebase/cli

cloudflarebase init my-backend   # or `cloudflarebase add auth` in an existing project
cd my-backend
npx wrangler login
cloudflarebase deploy            # sign-in works right away
```

`add` merges the agent's wrangler config into yours without overwriting
anything you set, exports the Durable Object class from your entrypoint, and
adds a type assertion so a missing binding fails at compile time with its name.

## Use it from your app

The API is Better Auth, so its client works as-is:

```ts
import { createAuthClient } from 'better-auth/client';

const authClient = createAuthClient({
	baseURL: 'https://your-dashboard.workers.dev/api/projects/my-app/auth'
});

await authClient.signUp.email({ name, email, password });
```

Browsers get a cookie; everything else uses the `set-auth-token` bearer token.
Add your app's origin under the project's Settings tab first. Each project also
serves an OpenAPI 3.1 document at `/api/projects/<id>/openapi.json`, rendered
in the dashboard under API Reference.

## Checks

```bash
npm run check   # svelte-check
npm run lint    # prettier + eslint
npm test        # Playwright against real workerd
```

## Security

Report vulnerabilities privately via [SECURITY.md](SECURITY.md). Keep
`DEMO_MODE` unset anywhere real users live.

## License

[Apache-2.0](LICENSE). Cloudflarebase is an independent project, not
affiliated with or endorsed by Cloudflare, Inc. See [NOTICE](NOTICE).
