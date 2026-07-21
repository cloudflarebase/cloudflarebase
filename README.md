<p align="center">
  <img src="static/brand/github-header.png" alt="Cloudflarebase — the open-source backend built for Cloudflare" width="100%" />
</p>

<p align="center">
  An agentic, open-source backend-as-a-service built directly on Cloudflare.
</p>

## Auth Agent MVP

Each project gets an isolated Cloudflare Agent backed by a Durable Object and SQLite.

- Email/password, guest, Google, and GitHub authentication
- Cookie sessions and bearer tokens
- Simple RBAC: per-project roles with permissions, assigned from the dashboard and issued as JWT claims via `GET /token`
- Realtime users, sessions, and activity
- Local-time analytics through Workers Analytics Engine
- Project-scoped settings, CORS, and trusted origins
- AI copilot grounded in project analytics

## Run locally

The Auth Agent needs a Better Auth secret before it will start. Copy the example env file and fill in a generated value:

```bash
npm install
cp agents/auth/.env.example agents/auth/.dev.vars
openssl rand -base64 32   # paste the output into agents/auth/.dev.vars as BETTER_AUTH_SECRET
npm run dev
```

Open `http://localhost:5173/dashboard`. The web app runs on port `5173`; Auth Agent runs on `8788`.

## Deploy

Configure the bindings and Worker names in `wrangler.jsonc` and `agents/auth/wrangler.jsonc`, then deploy the agent before the web app. Generate a fresh secret per environment (`openssl rand -base64 32` again) — never reuse the local one:

```bash
cd agents/auth
npx wrangler secret put BETTER_AUTH_SECRET   # add --env preview for the preview Worker
npm run deploy

cd ../..
npm run deploy
```

Analytics reads require `CF_ACCOUNT_ID` and `CF_ANALYTICS_API_TOKEN` secrets on Auth Agent. OAuth providers require their corresponding credentials.

## Validate

```bash
npm run check
npm run lint
npm run build
npm test
```

> MVP: suitable for demos and evaluation. Review security, retention, email delivery, and operational requirements before production use.
