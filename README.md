<p align="center">
  <img src="static/brand/github-header.png" alt="Cloudflarebase — the open-source backend built for Cloudflare" width="100%" />
</p>

<p align="center">
  <strong>An open-source backend that runs entirely on Cloudflare.</strong><br />
  Every project gets its own agent — a Durable Object running Better Auth over its own SQLite database, at the edge, in your account.
</p>

<p align="center">
  <a href="https://cloudflarebase.com/dashboard"><strong>Live demo</strong></a> ·
  <a href="#deploy-it-to-your-own-cloudflare-account">Deploy it yourself</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" /></a>
  <a href="../../actions/workflows/quality.yaml"><img alt="Quality" src="../../actions/workflows/quality.yaml/badge.svg" /></a>
  <a href="../../actions/workflows/e2e.yaml"><img alt="E2E" src="../../actions/workflows/e2e.yaml/badge.svg" /></a>
</p>

---

## What this is

A Firebase-shaped backend built natively on Cloudflare primitives — Workers,
Durable Objects, D1, KV, R2, Workers AI, and the Agents SDK. It is agent-first:
each backend capability is a Cloudflare Agent, with **one Durable Object
instance per project**, so projects are isolated at the infrastructure level
rather than by a tenant column.

Authentication is the first agent and the one that works today.

- Email/password, guest, Google, and GitHub sign-in
- Cookie sessions and bearer tokens for non-browser clients
- Per-project RBAC — roles with permission keys, issued as JWT claims, verifiable
  offline against the project's JWKS
- Realtime users, sessions, and activity over WebSocket state sync
- Analytics through Workers Analytics Engine, bucketed in the viewer's timezone
- A generated OpenAPI document and live API reference per project
- An AI copilot grounded in that project's own auth data

## Try it locally

Five minutes, no Cloudflare account needed.

```bash
git clone https://github.com/cloudflarebase/cloudflarebase.com.git
cd cloudflarebase.com
npm install
npm run dev
```

No secrets to generate. Each project creates its own signing key on first
start and keeps it in its own storage.

Open <http://localhost:5173/dashboard>. The dashboard runs on `:5173`, the auth
agent on `:8788`.

Local development sets `DEMO_MODE=true`, so you get a throwaway project without
signing in — the same experience as the hosted demo. To see the real self-hosted
path instead, remove `DEMO_MODE` from `env.local` in `wrangler.jsonc` and you
will be asked to claim the console with an owner account.

## Deploy it to your own Cloudflare account

Two Workers, deployed in order — the dashboard binds to the agent, so the agent
has to exist first.

### 1. The auth agent

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflarebase/cloudflarebase.com/tree/main/agents/auth)

### 2. The dashboard

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflarebase/cloudflarebase.com)

Or from a clone, which is the path to use if you want to change anything first:

```bash
cd agents/auth && npm run deploy
cd ../..     && npm run deploy
```

No secrets are required. Wrangler provisions the D1 database on first deploy,
and each project generates its own signing key.

### Then do this — it is not optional

**Set `TRUSTED_ORIGINS` to your console's origin.** It is the CSRF allowlist,
and sign-in is refused from an origin that is not on it, so a fresh deploy
cannot be signed into until you set it:

```bash
cd agents/auth
npx wrangler deploy --var TRUSTED_ORIGINS:https://cloudflarebase.<your-subdomain>.workers.dev
```

Then open your dashboard and **claim the console**. The first account created is
the owner; sign-up closes immediately afterwards, and the console never issues
guest sessions. Cloudflarebase's own console authenticates against a
Cloudflarebase auth agent — it is its own first customer.

Your install is private by default. `DEMO_MODE` is unset, which means every
console surface requires an operator session.

### Optional

| Secret                                      | What it enables                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `CF_ACCOUNT_ID`, `CF_ANALYTICS_API_TOKEN`   | Analytics Engine SQL reads. Writes need no credentials.                         |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in. Can also be set per project in the console.                     |
| `SENTRY_DSN`, `PUBLIC_SENTRY_DSN`           | Error reporting. Off entirely when unset.                                       |
| `EMAIL_FROM`                                | Verification and password-reset mail, via Cloudflare Email.                     |
| `BETTER_AUTH_SECRET`                        | Pins one signing key across all projects instead of per-project generated ones. |

The analytics token needs Account Analytics Read. Without it the dashboard
reports write-only mode rather than failing.

## Use it in your app

Your application talks to `/api/projects/<projectId>/auth`, which is Better
Auth — so its client libraries work directly:

```ts
import { createAuthClient } from 'better-auth/client';

const authClient = createAuthClient({
	baseURL: 'https://your-console.workers.dev/api/projects/my-app/auth'
});

await authClient.signUp.email({ name, email, password });
const { data: session } = await authClient.getSession();
```

Same-origin browsers get a cookie. Everything else reads the `set-auth-token`
response header and sends it as a bearer token. Add your application's origin
under the project's **Settings** tab first, or its requests will be refused.

Every project publishes its own OpenAPI 3.1 document at
`/api/projects/<projectId>/openapi.json`, generated from the same schemas the
routes validate with and addressed at your real base URL — so client generators
and API tools can be pointed straight at it. The console renders it under
**API Reference**.

## How it fits together

```
┌──────────────────────────┐        ┌───────────────────────────────────┐
│  Dashboard Worker        │        │  Auth Agent Worker                │
│  SvelteKit + console     │───────▶│                                   │
│                          │service │  AuthAgent (DO) — one per project │
│  /dashboard/<id>         │binding │    Better Auth + Drizzle + SQLite │
│  /api/projects/<id>/*    │        │                                   │
└──────────────────────────┘        └───────────────────────────────────┘
```

| Path          | Worker       | What it is                                         |
| ------------- | ------------ | -------------------------------------------------- |
| `/`           | dashboard    | SvelteKit 2 / Svelte 5, shadcn-svelte, Tailwind v4 |
| `agents/auth` | `auth-agent` | `AuthAgent` Durable Object, one per project        |

They are separate npm projects with separate Wrangler configs and separate
generated types. Shared DTOs are deliberately copied, not imported.

Installation-wide state — the project registry — lives in D1 bound to the
dashboard Worker; per-project state lives in that project's Durable Object. No
agent owns the project list, because a project will have db and storage agents
too and any agent owning it would make every other agent depend on that one.

## Validate

```bash
npm run check   # svelte-check
npm run lint    # prettier + eslint
npm test        # Playwright, against a production-mirroring workerd stack
```

The e2e suite boots the built dashboard Worker and the agent Worker in real
workerd, with real service bindings and Durable Object SQLite.

## Security

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

One setting decides whether an install is exposed: `DEMO_MODE` must stay unset
anywhere real users live. Signing keys are generated per project and never
shared between environments; the fixed `BETTER_AUTH_SECRET` committed under
`env.test.vars` exists only so the test suite is deterministic.

## Status

Pre-1.0. The auth agent is complete and tested; more primitives are coming, and
the agent shape is what they will follow. Review retention, email delivery, and
your own operational requirements before putting real users on it.

## License

[Apache-2.0](LICENSE).

Cloudflarebase is an independent open-source project. It is not affiliated with,
endorsed by, or sponsored by Cloudflare, Inc. "Cloudflare", "Workers", and
"Durable Objects" are their trademarks, used here only to describe the platform
this runs on. See [NOTICE](NOTICE).
