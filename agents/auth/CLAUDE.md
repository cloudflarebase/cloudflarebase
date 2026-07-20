# Auth Agent Worker

One `AuthAgent` Durable Object exists per Cloudflarebase project; the instance name is the project ID. It runs Better Auth over embedded Durable Object SQLite through Drizzle and broadcasts live auth state through Agents SDK state sync. See the repository `CLAUDE.md` for the overall system and e2e stack.

## Key files

- `src/agent.ts`: `AuthAgent` state, HTTP/admin routes, analytics, Workers AI chat, email delivery, project CORS, and Better Auth dispatch. Its DTOs are mirrored in the app's `src/lib/agents.ts`.
- `src/auth.ts`: Better Auth factory with Drizzle adapter, email/password, anonymous and bearer plugins, social providers, rate limiting, project cookie prefix, and database hooks.
- `src/index.ts`: Worker entrypoint and `/health`; delegates agent routes through `routeAgentRequest` without default CORS.
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

The Worker exposes `GET /health`. Agent requests use `/agents/auth-agent/<projectId>/...` and support:

- `GET /overview`: current users, sessions, and synchronized state.
- `GET /analytics`: operational and behavioral aggregates; accepts a validated `timeZone` query parameter for signup-day buckets.
- `GET /config`: safe public client configuration; never returns provider secrets.
- `POST /chat`: Workers AI answer grounded in project analytics.
- `PUT /admin/settings`: trusted origins and per-project social credentials.
- `DELETE /admin/users/:id`: delete a user and related sessions.
- `DELETE /admin/sessions/:id`: revoke one session.
- `/api/auth/*`: Better Auth endpoints.

The SvelteKit Worker exposes matching `/api/projects/<projectId>/...` same-origin proxies over the `AUTH_AGENT` service binding.

## Authentication and CORS

- Better Auth uses `drizzleAdapter(db, { provider: 'sqlite', schema, transaction: false })`.
- Cookies have a `cfb-<projectId>` prefix so projects on the same dashboard origin do not overwrite each other.
- Email/password and anonymous sessions are enabled. The bearer plugin returns `set-auth-token` for external clients.
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
- Behavioral results are cached for 5 seconds. Cache entries include the validated IANA timezone because signup dates are grouped in the viewer's local day.
- `/chat` does not require Better Auth. It stores successful user/agent message pairs in `chat_message`, scoped by a project-specific SHA-256 hash of `CF-Connecting-IP` (with proxy-header and local fallbacks). Never persist the raw address. Shared IPs share history; changed IPs start a new history. Recent history is model context. It is the only route that calls the `AI` binding; inference errors return 502 and must not affect auth or analytics. Workers AI has no local simulator, so the local binding is remote.

## Constraints and gotchas

- DO SQLite blocks `pragma_table_info()` and explicit `BEGIN`/`COMMIT` (`SQLITE_AUTH`). This is why the adapter disables transactions and migrations use Drizzle instead of Better Auth's Kysely path.
- `AuthAgentState` is broadcast to every connected dashboard. Keep it small; activity is capped by `MAX_EVENTS`.
- SQL files are Wrangler Text modules. Preserve the Wrangler `rules` entry and `src/modules.d.ts` declaration.
- Service-binding calls through Node/miniflare must use `fetch(url, init)`, not a Node-realm `Request`.
- Run Wrangler commands from `agents/auth`; use `--env preview` for `auth-agent-preview`.
- `BETTER_AUTH_SECRET` is a plain variable only in local/test; preview and production require a Wrangler secret. The fixed E2E value belongs only in `env.test.vars`.
- Do not edit `worker-configuration.d.ts`. Run `npx wrangler types` after binding or variable changes.

## Development and tests

`npm run dev` starts `wrangler dev --env local` on :8788 with state in `../../.wrangler/state/`, shared with the root app's development proxy.

Playwright starts `auth-agent-test` on :8798 with persistence in `../../.wrangler/test-state/auth-agent`, local D1 analytics, a fixed test-only auth secret, and disabled rate limiting. Windows cleanup is coordinated by the root `scripts/kill-port.mjs` and `scripts/clean-dir.mjs`; do not replace those with unscoped process kills or directory deletion.
