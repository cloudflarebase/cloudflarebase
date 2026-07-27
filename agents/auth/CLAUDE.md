# Auth Agent Worker

One `AuthAgent` Durable Object per Cloudflarebase project; the instance name is the project ID. Better Auth over embedded DO SQLite through Drizzle, with live state broadcast via Agents SDK state sync. See the repository `CLAUDE.md` for the overall system and e2e stack.

## Key files

- `src/agent.ts`: state, HTTP/admin routes, analytics, Workers AI chat, email, project CORS, Better Auth dispatch. DTOs mirrored in the app's `src/lib/agents.ts`.
- `src/auth.ts`: Better Auth factory - Drizzle adapter, email/password, anonymous and bearer plugins, social providers, rate limiting, project cookie prefix, database hooks.
- `src/index.ts`: Worker entrypoint, `/health`, internal `/fleet/overview`; delegates agent routes through `routeAgentRequest` without default CORS.
- `src/fleet.ts`: fleet rollup for `/admin`. Lists projects from auth-event analytics (SQL API, or `LOCAL_ANALYTICS` D1 locally), then fans out over `getAgentByName` RPC (`getFleetCounts`, capped and batched). DTOs mirrored in the app.
- `src/db/schema.ts`: Better Auth tables. Property names must match Better Auth field names.
- `drizzle/`: drizzle-kit output. `src/migrations.ts` inlines that SQL as string literals (via `scripts/generate-migrations.mjs`, never hand-edited) and is what `onStart` applies. Inlining means no Wrangler Text-module rule, so the agent works as a plain npm dependency.
- `src/env.d.ts`: optional secrets not in generated Wrangler types.

Schema changes: edit `src/db/schema.ts`, run `npm run migrations`, never hand-edit the output. Migrations apply idempotently on agent wake. If a Better Auth upgrade shifts fields, compare against `getAuthTables({})` from `@better-auth/core/db`.

## HTTP surface

The Worker itself: `GET /health`, `GET /fleet/overview`, and `DELETE /internal/projects/:projectId` (erases one project via its agent's `destroy()`). The latter two sit outside `/agents/*`, so they are reachable only over the dashboard's service binding; the worker has no public route. The console owns cross-agent fan-out; this endpoint knows only its own agent. `AuthAgent.getFleetCounts()` serves the per-project half over DO RPC, including the colo resolved once per instance from a cdn-cgi trace.

Agent routes at `/agents/auth-agent/<projectId>/...`:

- `GET /overview`: users, sessions, synchronized state.
- `GET /analytics`: aggregates; validated `timeZone` query param for signup-day buckets.
- `GET /config`: safe public client configuration; never provider secrets.
- `POST /chat`: Workers AI answer grounded in project analytics.
- `PUT /admin/settings`: trusted origins, per-project social credentials.
- `PUT /admin/roles`: replace the role registry (`{ roles: [{ name, permissions[] }] }`, lowercase slugs, `resource:action` or `*` keys; built-in `user`/`admin` always remain). Agent state, synced to dashboards.
- `PUT /admin/users/:id/role`: assign a registry role; anonymous users can hold roles.
- `DELETE /admin/users/:id` / `DELETE /admin/sessions/:id`.
- `/api/auth/*`: Better Auth, including `GET /token` (project-signed JWT) and `GET /jwks`.

The SvelteKit Worker mirrors these as `/api/projects/<projectId>/...` proxies plus `/api/registry/projects`. Everything except `/api/auth/*`, `/config`, and `/openapi.json` requires an operator session (console guard in the app's `src/hooks.server.ts`).

## Authentication and CORS

- `drizzleAdapter(db, { provider: 'sqlite', schema, transaction: false })`.
- Cookies use a `cfb-<projectId>` prefix so projects on one origin don't clobber each other.
- Email/password and anonymous sessions; the bearer plugin returns `set-auth-token` for external clients.
- `user.role` is an additional field with `input: false`; only the admin role route writes it. JWT signing keys live in the `jwks` table, generated on first `GET /token`.
- Cookie-carrying POSTs need an `Origin` on the effective trusted-origin list.
- A deployment trusts its own origin automatically: the trustedOrigins function in `auth.ts` adds the request URL's origin, since a browser only sends an Origin equal to the page it is on and same-origin is never CSRF. `TRUSTED_ORIGINS` and per-project `allowedOrigins` are for everything else. `AuthAgent.corsHeaders()` is the only CORS authority (same-origin accepted, exact-origin echo, credentials, exposes `set-auth-token`). Never pass `cors: true` to `routeAgentRequest`; its wildcard overrides the project policy.
- Rate limiting keys on `CF-Connecting-IP` (`advanced.ipAddress.ipAddressHeaders`). Without it Better Auth cannot see an IP and falls back to a single shared per-path bucket, where one noisy client exhausts sign-in for everyone.
- Rate limiting is on everywhere except `env.test` (`DISABLE_RATE_LIMIT=true` exists so reused Playwright state cannot exhaust persisted buckets).

## Social providers, email, analytics, AI

- Google credentials can come from environment secrets; Google and GitHub can also be set per project. Per-project credentials live in DO storage; APIs expose enabled provider names only.
- Mail prefers the `EMAIL` binding with `EMAIL_FROM`; sign-up/sign-in work without it.
- Every auth event writes best-effort to `AUTH_EVENTS` (Analytics Engine); analytics failures must never fail authentication. Local/test mirror events to `LOCAL_ANALYTICS` D1 so queries work without credentials. SQL reads need `CF_ACCOUNT_ID` + `CF_ANALYTICS_API_TOKEN` (Account Analytics Read); otherwise analytics reports write-only mode.
- Behavioral results cache for 5 seconds, keyed by validated IANA timezone (daily activity is grouped in the viewer's local day).
- `/chat` needs no auth. Messages persist in `chat_message` under a project-scoped SHA-256 of `CF-Connecting-IP`; never the raw address. Shared IPs share history. Only `/chat` calls `AI`; inference errors 502 without touching auth or analytics. Workers AI has no local simulator, so the local binding is remote.

## Console instance and demo projects

Two project ids get special behaviour, decided in `onRequest` before Better Auth sees the request, because `/api/auth/*` is public and never passes the dashboard's console guard.

- **`console`** (mirrored as `CONSOLE_PROJECT_ID` in the app's `src/lib/console.ts`) is the dashboard's operator auth. It refuses guest sign-in, and accepts exactly one `sign-up/email` - the first-run owner claim - rejecting the rest with 403. Under `DEMO_MODE` it refuses the claim entirely: a demo deployment has no operators, and a first-come claim on a public URL would let a stranger take a console nobody is meant to use. The route check is not the whole story: social sign-in creates users implicitly on the OAuth callback, so the invariant (at most one console user, none under `DEMO_MODE`) is enforced again where every path converges - a `denyUserCreation` veto in the user-creation database hook in `auth.ts`. Without it, configuring Google credentials would reopen console registration. Social sign-in for the existing owner works; unknown accounts bounce with 403.
- **`demo-<20 hex>`** projects are throwaway only when `DEMO_MODE=true`. Both halves matter: a self-hosted install must never expire a project merely named `demo-...`, and the public deployment must never expire a named one. Caps: `DEMO_MAX_USERS` (counting guests - anonymous sign-in is the cheapest way to fill someone else's database), `DEMO_MAX_CHAT_PER_DAY` (Workers AI neurons are account-level), no mail, self-erasure after `DEMO_TTL_HOURS`.

Expiry uses `this.schedule(seconds, 'expireDemoProject', undefined, { idempotent: true })` from `onStart`: repeated wakes reuse one row, and the deadline runs from first provision. `expireDemoProject()` re-checks the flag before erasing, so pending timers cannot delete real projects if `DEMO_MODE` is later unset.

`destroy()` calls `ctx.storage.deleteAll()` (drops the whole SQLite database and KV entries), then defers `ctx.abort()` by a tick - aborting immediately would destroy the RPC's own response and make every successful delete look like a failure.

`e2e/demo-project.api.spec.ts` pins that a demo project still serves the whole Integration-tab REST flow unauthenticated.

## Publishing as `@cloudflarebase/auth`

`npm run build` (`tsconfig.build.json`) emits `dist/` from `src/` only. `files` ships `dist`, `template`, `NOTICE`; npm adds README and LICENSE. `npm pack --dry-run` should show ~19 files and none of our configuration.

- **Portability.** The Agents SDK constrains `Agent<Env, State>` against `Cloudflare.Env`, an empty declaration-merge target - strict here only because our generated types merge our bindings into it. Emitted declarations name `Env` rather than inlining it, so in a consumer's project it resolves to their `wrangler types` output. A hand-written env interface can never replace the ambient `Env` (rejected with "does not satisfy the constraint 'Env'"); `src/bindings.ts` is an assertion over it, not a substitute.
- **Never ship:** `worker-configuration.d.ts` (declares a global `interface Env`, would clobber the consumer's; it is a `types` entry, so never emitted) and `src/env.d.ts` (our deployment's secrets; declaration inputs are not copied to `outDir`).
- **Binding contract.** `AssertAuthAgentEnv<Env>` turns a missing or mistyped binding into a named compile-time error. Only `AuthAgent` and `AUTH_EVENTS` are required; every other binding is guarded so a degraded one never breaks authentication. `src/bindings.test-d.ts` locks the contract with `@ts-expect-error` negatives (excluded from the build), so weakening it fails the typecheck. `DurableObjectNamespace<any>` is deliberate: the namespace is effectively invariant, and `never`/`unknown` each fail one direction.
- **`template/`** is what a consumer copies: `worker-entry.ts` (the DO class must be re-exported from their entrypoint) and `wrangler-fragment.jsonc`, whose `migrations` is a fresh `v1` - replaying this repo's tag history against a new Worker tries to delete a class the consumer never had.

## Constraints and gotchas

- DO SQLite blocks `pragma_table_info()` and explicit `BEGIN`/`COMMIT` (`SQLITE_AUTH`); hence `transaction: false` and Drizzle migrations instead of Better Auth's Kysely path.
- `AuthAgentState` is broadcast to every connected dashboard. Keep it small; activity is capped by `MAX_EVENTS`.
- Service-binding calls through Node/miniflare must use `fetch(url, init)`, never a Node-realm `Request`.
- Run Wrangler commands from `agents/auth`; `--env preview` and `--env production` target the deployed agents.
- The top level of `wrangler.jsonc` is the self-hosted default (empty `TRUSTED_ORIGINS`/`EMAIL_FROM`, no `DEMO_MODE`); cloudflarebase.com lives in `env.production`, whose `name` is pinned to `auth-agent` for the service binding. Wrangler does not inherit top-level config into environments, so each repeats it in full.
- `src/index.ts` may only export handlers and DO classes. A value export fails at boot with `Incorrect type for map entry`; type-only exports are erased and safe.
- `BETTER_AUTH_SECRET` is optional everywhere: unset, each project generates a 32-byte key in `onStart` (DO storage key `signing-secret`), so fresh installs need no secret and no two projects share one. Setting it overrides every project. The fixed value in `env.test.vars` keeps reused test stacks' sessions valid and belongs nowhere else.
- Do not edit `worker-configuration.d.ts`; run `npx wrangler types` after binding changes.
- Never name a file `src/env.ts`: it collides with `src/env.d.ts` and silently kills the ambient `Env` augmentation. The binding contract lives in `src/bindings.ts` for this reason.
- `tsconfig.json` excludes `dist` and `template`: with `allowJs` on, `tsc --noEmit` would otherwise typecheck the build output, and the template files import `@cloudflarebase/auth` by name, which cannot resolve from inside the package.
- The root ESLint config ignores `agents/auth/dist/` explicitly; `includeIgnoreFile` reads only the root `.gitignore`, and linting the emitted bundle is slow enough to look like a hang.

## Development and tests

`npm run dev` starts `wrangler dev --env local` on :8788 with state in `../../.wrangler/state/`, shared with the root app's dev proxy.

Playwright starts `auth-agent-test` on :8798 with persistence in `../../.wrangler/test-state/auth-agent`, local D1 analytics, the fixed test secret, and rate limiting off. Windows cleanup goes through the root `scripts/kill-port.mjs` and `scripts/clean-dir.mjs`; never replace them with unscoped process kills or directory deletion.
