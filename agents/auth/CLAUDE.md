# Auth Agent Worker

One `AuthAgent` Durable Object exists per Cloudflarebase project; the instance name is the project ID. It runs Better Auth over embedded Durable Object SQLite through Drizzle and broadcasts live auth state through Agents SDK state sync. See the repository `CLAUDE.md` for the overall system and e2e stack.

## Key files

- `src/agent.ts`: `AuthAgent` state, HTTP/admin routes, analytics, Workers AI chat, email delivery, project CORS, and Better Auth dispatch. Its DTOs are mirrored in the app's `src/lib/agents.ts`.
- `src/auth.ts`: Better Auth factory with Drizzle adapter, email/password, anonymous and bearer plugins, social providers, rate limiting, project cookie prefix, and database hooks.
- `src/index.ts`: Worker entrypoint, `/health`, and the internal `/fleet/overview`; delegates agent routes through `routeAgentRequest` without default CORS.
- `src/fleet.ts`: cross-project fleet rollup for the dashboard's `/admin` page. Lists projects from auth-event analytics (Analytics Engine SQL API, or `LOCAL_ANALYTICS` D1 locally), then fans out to each project's Durable Object via `getAgentByName` RPC (`getFleetCounts`, capped and batched). Its DTOs are mirrored in the app's `src/lib/agents.ts`.
- `src/db/schema.ts`: Better Auth user, session, account, and verification tables. Property names must match Better Auth field names.
- `drizzle/`: generated migrations. `drizzle/migrations.js` is imported and applied from `onStart`.
- `src/env.d.ts`: optional secrets and variables not represented by generated Wrangler types.

## Schema changes

1. Edit `src/db/schema.ts`.
2. Run `npx drizzle-kit generate` using the `durable-sqlite` driver in `drizzle.config.ts`.
3. Do not hand-edit generated migrations.
4. Migrations apply idempotently when each agent wakes.

If a Better Auth upgrade changes expected fields, compare the schema against `getAuthTables({})` from `@better-auth/core/db`.

## HTTP surface

The Worker exposes `GET /health` and `GET /fleet/overview` (internal fleet rollup — outside `/agents/*` so it is only reachable over the dashboard's service binding; the worker has no public route). `AuthAgent.getFleetCounts()` serves the per-project half over Durable Object RPC, including the DO's colo resolved once per instance from a cdn-cgi trace subrequest. Agent requests use `/agents/auth-agent/<projectId>/...` and support:

- `GET /overview`: current users, sessions, and synchronized state.
- `GET /analytics`: operational and behavioral aggregates; accepts a validated `timeZone` query parameter for signup-day buckets.
- `GET /config`: safe public client configuration; never returns provider secrets.
- `POST /chat`: Workers AI answer grounded in project analytics.
- `PUT /admin/settings`: trusted origins and per-project social credentials.
- `PUT /admin/roles`: replace the role registry — `{ roles: [{ name, permissions[] }] }` with lowercase slug names and `resource:action` (or `*`) permission keys. Built-in `user` and `admin` always remain. Stored in agent state and synced to dashboards.
- `PUT /admin/users/:id/role`: assign a registry role (default `user`); anonymous users can hold roles too. Recorded in the activity feed.
- `DELETE /admin/users/:id`: delete a user and related sessions.
- `DELETE /admin/sessions/:id`: revoke one session.
- `/api/auth/*`: Better Auth endpoints, including `GET /token` (project-signed JWT with `role` and `email` claims) and `GET /jwks` from the jwt plugin.

The worker also serves `DELETE /internal/projects/:projectId`, which erases one project by calling that project agent's `destroy()`. Like `/fleet/overview` it sits outside `/agents/*`, so it is reachable only over the dashboard's service binding. The console owns the fan-out across agents; this endpoint knows nothing about any agent but its own.

The SvelteKit Worker exposes matching `/api/projects/<projectId>/...` same-origin proxies over the `AUTH_AGENT` service binding, plus `/api/registry/projects` for the registry. Every one of them except `/api/auth/*`, `/config`, and `/openapi.json` requires an operator session — see the console guard in the app's `src/hooks.server.ts`.

## Authentication and CORS

- Better Auth uses `drizzleAdapter(db, { provider: 'sqlite', schema, transaction: false })`.
- Cookies have a `cfb-<projectId>` prefix so projects on the same dashboard origin do not overwrite each other.
- Email/password and anonymous sessions are enabled. The bearer plugin returns `set-auth-token` for external clients.
- `user.role` is an additional field with `input: false` — only the admin role route writes it. The jwt plugin's signing keys live in the `jwks` table; keys are generated on the first `GET /token`.
- Cookie-carrying POSTs require an `Origin` in the effective trusted-origin list.
- `AuthAgent.corsHeaders()` is the only CORS authority. It combines `TRUSTED_ORIGINS` with validated per-project `allowedOrigins`, echoes the exact origin, permits credentials, and exposes `set-auth-token`.
- Never pass `cors: true` to `routeAgentRequest`. The Agents SDK default adds `Access-Control-Allow-Origin: *`, overriding the project's dynamic header.
- Rate limiting is enabled in normal environments. `DISABLE_RATE_LIMIT=true` is test-only so locally reused Playwright state cannot exhaust persisted buckets.

## Social providers and email

- Google credentials may come from environment secrets. Google and GitHub may also be configured per project.
- Per-project credentials live in Durable Object storage. API responses expose only enabled provider names and never secrets.
- Verification and password-reset mail prefers the `EMAIL` Cloudflare Email Service binding with `EMAIL_FROM`.
- Core sign-up/sign-in remains usable when Cloudflare Email Service is not configured.

## Analytics and AI

- Every auth event writes a best-effort data point to `AUTH_EVENTS` (Workers Analytics Engine). Analytics failures must never fail authentication.
- Local/test mirror the same event dimensions to `LOCAL_ANALYTICS` D1 for DAU/WAU/MAU, provider, country, and trend queries without Cloudflare credentials.
- Production Analytics Engine SQL reads require `CF_ACCOUNT_ID` and a `CF_ANALYTICS_API_TOKEN` with Account Analytics Read; otherwise analytics reports write-only mode. Writes require no token.
- Behavioral results are cached for 5 seconds. Cache entries include the validated IANA timezone because daily activity (sign-ups and sign-ins, 90-day window) is grouped in the viewer's local day.
- `/chat` does not require Better Auth. It stores successful user/agent message pairs in `chat_message`, scoped by a project-specific SHA-256 hash of `CF-Connecting-IP` (with proxy-header and local fallbacks). Never persist the raw address. Shared IPs share history; changed IPs start a new history. Recent history is model context. It is the only route that calls the `AI` binding; inference errors return 502 and must not affect auth or analytics. Workers AI has no local simulator, so the local binding is remote.

## Console instance and demo projects

Two project ids get behaviour no other project has. Both are decided in `onRequest` before Better Auth sees the request, because `/api/auth/*` is deliberately public and never passes through the dashboard's console guard.

- **`console`** is the dashboard's own operator auth. It refuses guest sign-in outright, and accepts exactly one `sign-up/email` — the first-run owner claim — rejecting the rest with 403. Under `DEMO_MODE` it refuses the claim entirely: a demo deployment has no operators, so leaving a first-come claim open on a public URL would only let a stranger take a console nobody is meant to use. Mirrored as `CONSOLE_PROJECT_ID` in the app's `src/lib/console.ts`.
- **`demo-<20 hex>`** projects are throwaway, but only when `DEMO_MODE=true`. Both halves matter: a self-hosted install must never expire a project merely named `demo-...`, and the public deployment must never expire a named one. They cap users (`DEMO_MAX_USERS`, counting guests, since anonymous sign-in is the cheapest way to fill someone else's database), cap inference per day (`DEMO_MAX_CHAT_PER_DAY`, because Workers AI neurons are an account-level quota), send no mail, and erase themselves after `DEMO_TTL_HOURS`.

Expiry uses `this.schedule(seconds, 'expireDemoProject', undefined, { idempotent: true })` from `onStart`, so repeated Durable Object wakes reuse one row instead of stacking them — which also means the deadline runs from first provision rather than the visitor's last page load. `expireDemoProject()` re-checks the flag before erasing, so pending timers cannot delete real projects if `DEMO_MODE` is later turned off.

`destroy()` wipes the project: `ctx.storage.deleteAll()` drops the whole SQLite database, SQL tables and key-value entries alike. The `ctx.abort()` that follows is deferred by a tick, because aborting immediately destroys the RPC's own response and every successful delete would surface to the caller as a failure.

The ceilings are chosen to bound cost without costing a visitor what they came for. `e2e/demo-project.api.spec.ts` pins that: a demo project still serves the whole REST flow the Integration tab advertises, unauthenticated.

## Constraints and gotchas

- DO SQLite blocks `pragma_table_info()` and explicit `BEGIN`/`COMMIT` (`SQLITE_AUTH`). This is why the adapter disables transactions and migrations use Drizzle instead of Better Auth's Kysely path.
- `AuthAgentState` is broadcast to every connected dashboard. Keep it small; activity is capped by `MAX_EVENTS`.
- SQL files are Wrangler Text modules. Preserve the Wrangler `rules` entry and `src/modules.d.ts` declaration.
- Service-binding calls through Node/miniflare must use `fetch(url, init)`, not a Node-realm `Request`.
- Run Wrangler commands from `agents/auth`; use `--env preview` for `auth-agent-preview` and `--env production` for cloudflarebase.com's own agent.
- The top level of `wrangler.jsonc` is the **self-hosted default**, not this project's deployment: empty `TRUSTED_ORIGINS` and `EMAIL_FROM`, no `DEMO_MODE`. cloudflarebase.com's values are in `env.production`, whose `name` is pinned to `auth-agent` so the dashboard's service binding still resolves it. Wrangler does not inherit top-level config into environments, so each one repeats it in full.
- `src/index.ts` may only export handlers and Durable Object classes. A value export — even a string constant — fails at boot with `Incorrect type for map entry`, which reads like a configuration problem rather than a stray export. Type-only exports are erased and safe.
- `BETTER_AUTH_SECRET` is optional everywhere. When unset, each project generates a 32-byte key in `onStart` and keeps it in its own Durable Object storage under `signing-secret`, so a fresh install needs no secret set by hand and no two projects share a key. Setting the variable overrides that for every project on the deployment. The fixed value in `env.test.vars` is pinned so a reused local stack keeps sessions valid across restarts, and belongs nowhere else.
- Do not edit `worker-configuration.d.ts`. Run `npx wrangler types` after binding or variable changes.

## Development and tests

`npm run dev` starts `wrangler dev --env local` on :8788 with state in `../../.wrangler/state/`, shared with the root app's development proxy.

Playwright starts `auth-agent-test` on :8798 with persistence in `../../.wrangler/test-state/auth-agent`, local D1 analytics, a fixed test-only auth secret, and disabled rate limiting. Windows cleanup is coordinated by the root `scripts/kill-port.mjs` and `scripts/clean-dir.mjs`; do not replace those with unscoped process kills or directory deletion.
