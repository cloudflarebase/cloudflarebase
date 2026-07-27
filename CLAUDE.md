# Cloudflarebase

Firebase alternative built natively on Cloudflare (Workers, Durable Objects, D1, KV, R2, Workers AI, Agents SDK). Agent-first: each backend primitive is a Cloudflare Agent, one Durable Object instance per client project.

Also read [AGENTS.md](AGENTS.md). Cloudflare APIs change frequently; retrieve current official documentation before Workers, Durable Objects, Agents, bindings, or limits work.

## Repository layout

Separate npm projects with separate Wrangler configs and generated `Env` types. Never import runtime code or generated Worker types across them. Shared DTOs are deliberately copied and must be kept in sync.

| Path          | Worker                                                         | Purpose                                                                                           |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/`           | `cloudflarebase` (`cloudflarebase-com` in `env.production`)    | SvelteKit 2/Svelte 5 dashboard and marketing site, shadcn-svelte, Tailwind v4, Cloudflare adapter |
| `agents/auth` | `auth-agent` (`-local`, `-test`, or `-preview` by environment) | `AuthAgent` Durable Object, one per project; Better Auth and Drizzle over embedded DO SQLite      |
| `cli`         | none (Node on the consumer's machine)                          | `@cloudflarebase/cli`, the `cloudflarebase` bin: `init` / `add <agent>` / `deploy`                |

The root Worker binds `AUTH_AGENT` (agent service) and `DB` (control-plane D1). Agent instances live at `/agents/auth-agent/<projectId>/...`.

**The top level of both Wrangler configs is the self-hosted default, not this project's deployment.** It publishes to workers.dev, claims no custom domain, and leaves `DEMO_MODE` unset so a fresh install is private. cloudflarebase.com lives in `env.production`, deployed with `npm run deploy:production`. Two names are pinned so they survive the top-level rename: the agent's `env.production` stays `auth-agent` (what the service binding resolves) and the web `env.preview` stays `cloudflarebase-com-preview`.

## Commands

| Location      | Command                               | Purpose                                                                                   |
| ------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| root          | `npm run dev`                         | Auth Agent on :8788, then Vite on :5173                                                   |
| root          | `npm run check` / `npm run lint`      | Svelte diagnostics / Prettier and ESLint                                                  |
| root          | `npm run demo:video`                  | Self-driving demo tour for screen recording (`--check` for headless validation)           |
| root          | `npm run build`                       | Production SvelteKit Cloudflare build                                                     |
| root          | `npm test` / `npm run test:e2e`       | Full Playwright suite against Workers on :8797/:8798 (`test:e2e:ui` for the UI)           |
| root          | `npm run cf-typegen`                  | Regenerate `src/worker-configuration.d.ts` after binding changes                          |
| root          | `npm run deploy`                      | Deploy the self-hosted default (workers.dev, no demo mode)                                |
| root          | `npm run deploy:all`                  | Deploy agent then dashboard in order (the service binding needs the agent to exist first) |
| root          | `npm run deploy:production`           | Deploy cloudflarebase.com (`--env production`)                                            |
| `agents/auth` | `npx tsc --noEmit`                    | Typecheck the Auth Agent                                                                  |
| `agents/auth` | `npm run migrations`                  | Generate migrations after schema edits, then inline them into `src/migrations.ts`         |
| `agents/auth` | `npx wrangler types`                  | Regenerate Auth Agent Worker types                                                        |
| `agents/auth` | `npm run build`                       | Emit `dist/` for the published `@cloudflarebase/auth` package                             |
| `cli`         | `npm run build` / `npm run typecheck` | Emit / typecheck the published `@cloudflarebase/cli` package                              |

## Architecture decisions

- **`agents/auth` is published as `@cloudflarebase/auth`.** Supabase's distribution model: the agent is a versioned artifact you depend on, not source you fork. A consumer owns their `wrangler.jsonc` and entrypoint. `files` ships `dist`, `template`, and `NOTICE` only. Mechanism and constraints in `agents/auth/CLAUDE.md`.
- **Releases are tag-driven** (`.github/workflows/release.yaml`). Pushing `auth-v<x.y.z>` or `cli-v<x.y.z>` publishes that one package; the workflow refuses a tag/package.json version mismatch and runs the full typecheck (which is what executes `bindings.test-d.ts`; the build config excludes it). Publishing is npm trusted publishing (OIDC): no token exists anywhere, npmjs.com accepts only this repo + workflow + `release` environment, whose required reviewers gate every publish. Provenance requires a public repo, so tag releases only after open-sourcing.
- **The CLI is the delivery mechanism.** `add <agent>` npm-installs the agent, merges its `template/wrangler-fragment.jsonc` (jsonc-parser; comments survive, user values never overwritten, collections merge by binding name, DO migrations append under the next free tag), prepends the entrypoint re-export with the `AssertAuthAgentEnv` check, and reruns `wrangler types`. Every step idempotent. Fragments and templates ship inside each agent's package, so a new primitive is one registry entry in `cli/src/lib/agents.ts`. Agents are DO classes in the consumer's single Worker; `add` never means another deploy. `deploy` deploys once and reports the URL (the agent trusts its own origin, so nothing needs configuring first). `CLOUDFLAREBASE_<AGENT>_SPEC` overrides the install source.
- Drizzle is the database layer (`drizzle-orm/durable-sqlite`); drizzle-kit output is inlined into `src/migrations.ts` as string literals and applied in `onStart`. Inlining instead of `.sql` text modules is what lets the agent ship as a plain npm dependency. Better Auth runs inside each `AuthAgent` with the Drizzle SQLite adapter, `transaction: false`, and project-scoped cookie prefixes.
- Simple RBAC: `user.role` (default `user`) is a Better Auth additional field with `input: false`; the dashboard's `PUT /admin/users/:id/role` proxy is the only writer. Roles are a per-project registry of `{ name, permissions[] }` (`PUT /admin/roles`, agent state, built-in `user`/`admin` always present). The `jwt` plugin issues project-signed JWTs on `GET /token` (keys on `GET /jwks`, keypair in the agent's `jwks` table) with `email`, `role`, and `permissions` claims.
- The browser uses same-origin `/api/projects/<id>/...` SvelteKit endpoints, proxied over `AUTH_AGENT` preserving cookies, origin, and the edge-resolved country header.
- **Console auth.** Every operator surface requires a session, enforced by `consoleGuardHandle` in `src/hooks.server.ts` across `/dashboard/*`, `/api/*`, and the `/agents/*` passthrough (which reaches the DO without a proxy). Public by exception only: `/api/projects/<id>/auth/*`, `/config`, `/openapi.json`; anything else under `/api` is operator-only until deliberately opened. Operators authenticate against the `AuthAgent` under reserved project id `console`. First run claims it by creating the owner; after that the agent refuses sign-ups and never issues guest sessions there, enforced agent-side (the guard never sees `/api/auth/*`) and again in the user-creation database hook, because social sign-in creates users implicitly on the OAuth callback. `/login` shows Google/GitHub buttons when the console's public `/config` reports them (sign-in only; unknown social accounts bounce). Under `DEMO_MODE` the claim is refused entirely and `/login` explains that instead of offering a doomed form. Three distinct surfaces: anonymous demo, `/admin` behind `ADMIN_SECRET`, session-gated dashboard.
- **Demo mode.** `DEMO_MODE=true` lets anonymous visitors drive ephemeral `demo-<hex>` projects; named projects still require a session. Unset means a private console. In the agent the flag makes demo projects throwaway: capped users, daily inference ceiling, no outbound mail, self-erasure after `DEMO_TTL_HOURS` via `this.schedule(..., { idempotent: true })` so repeated wakes reuse one row. `e2e/demo-project.api.spec.ts` pins that the Integration-tab REST flow works unauthenticated.
- **Control plane vs project state.** Installation-wide state is D1 on the dashboard Worker (`DB`, schema in `src/lib/server/db/schema.ts`); per-project state is that project's DO. The registry is not in an agent on purpose: any agent owning the list makes every other agent depend on it. `database_id` is omitted from deployable configs so deploys provision it; schema is applied at runtime by `src/lib/server/db` (move to generated migrations once it grows past one table).
- **Deleting a project fans out from the console.** `deleteProject` in `src/lib/server/registry.ts` drops the row, then calls each agent's erase route (`DELETE /internal/projects/:id`, outside `/agents/*`, service-binding-only). A new agent adds a call there, not a dependency between agents. `AuthAgent.destroy()` defers `ctx.abort()` a tick so the response survives.
- **The API reference is generated.** `src/lib/agents.ts` is zod schemas; `src/lib/openapi.ts` emits an OpenAPI 3.1 document per project (`z.toJSONSchema` emits draft 2020-12) with the project's real base URL, served at `/api/projects/<id>/openapi.json`, rendered by Scalar at `/dashboard/<id>/api`. Every registry schema needs `.meta({ id })`; construction throws at import.
- Realtime state uses `AgentClient` from `agents/client`. Dev connects to :8788 directly; the built Worker proxies `/agents/*` through `src/hooks.server.ts`.
- `AuthAgent` owns CORS and CSRF trust: a deployment trusts its own origin automatically (same-origin is never CSRF; the trustedOrigins function adds the request URL's origin), plus environment `TRUSTED_ORIGINS` and per-project allowed origins for everything else. Exact-origin echo, credentials, exposes `set-auth-token`. Never enable `routeAgentRequest(..., { cors: true })`; its wildcard overrides the project policy. Rate limiting keys on `CF-Connecting-IP` via `advanced.ipAddress.ipAddressHeaders`; without it Better Auth falls back to one shared bucket.
- DO SQLite is authoritative for users and sessions. Auth events go to Analytics Engine; local/test mirror them to D1 for deterministic queries. Reads use the SQL API; dashboard polling and the agent cache are both 5 seconds; daily buckets use the browser's IANA timezone (cache entries are timezone-specific) and the dashboard filters 7/30/90-day windows client-side.
- Workers AI chat is grounded in the project's auth data. Conversations persist in agent SQLite under a project-scoped SHA-256 of the connecting IP; raw IPs and user IDs are never stored in chat rows. Only `/chat` calls `env.AI`; inference failure is a 502 that touches nothing else. Real AI e2e coverage is opt-in and never faked.
- Theme state is owned by root `ModeWatcher`; all theme buttons use `$lib/components/mode-toggle.svelte`. Never touch the root `dark` class or storage directly.
- The project agent is a docked, resizable right pane (PaneForge via the shadcn `resizable` wrapper), open by default on desktop, collapsible to a rail. Open state and sizes persist in the `cfbase-copilot` cookie, read by `+layout.server.ts` so SSR renders without a resize flash. Below 768px (shared `IsMobile` hook) a bottom tab bar swaps in a full-screen agent view. The shell is viewport-height; pages and chat scroll inside `ScrollArea` viewports, not the window. Exception: the API reference page opts out (layout branches on `isApi`) because Scalar pins its sidebar with `position: sticky` against its nearest scroll container; the page's own `overflow-auto` wrapper is the scrollport, mirroring Scalar's embedded layout.
- `/admin` is the fleet dashboard, gated by `ADMIN_SECRET` (plain var only in local/test; a secret elsewhere). The cookie stores a SHA-256 digest, so rotating the secret signs admins out. No registry involved: the agent worker's `GET /fleet/overview` lists projects from auth-event analytics, then asks each project DO for counts and colo over RPC (`getFleetCounts`). `/fleet/*` sits outside `/agents/*` so it is service-binding-only.
- Shared DTOs in `src/lib/agents.ts` mirror `agents/auth/src/agent.ts` and `fleet.ts`. Keep the copies synchronized.

## Playwright e2e

`npm test` boots a production-mirroring stack: the built SvelteKit Worker on :8797 (`wrangler.e2e.jsonc`) and the agent on :8798 (env `test`), with real workerd, service binding, DO SQLite, and API seeding.

- The web build sets `E2E_BUILD=true`, sending adapter output to `.svelte-kit-e2e/cloudflare` so a running dev process cannot lock the e2e build on Windows. Keep `wrangler.e2e.jsonc` aligned with root compatibility flags and bindings.
- State lives in `.wrangler/test-state/`, cleared when Playwright starts a server. Local runs reuse servers, so seeds are idempotent and generated identities must be unique; CI never reuses. Rate limiting is disabled only in `env.test`; the fixed test secret belongs only in `env.test.vars`.
- Projects run `console` → `seed` → `api` and `chromium`. `console.setup.ts` claims the owner and saves the session to `e2e/.auth/console.json`, loaded as `storageState` by later projects; without it everything is 401. On reused stacks the second claim 403s by design and the sign-in after it is what matters.
- Specs proving a route is closed opt out with empty `storageState` (`console-guard.api.spec.ts`, `demo-project.api.spec.ts`). Tests that create users target `SCRATCH_PROJECT`, never `SEED_PROJECT`, whose counts are asserted exactly.
- API contexts must send `Origin`. Set `BASE_URL` for a deployed target; local server startup is then skipped, along with the direct-agent smoke test (no public route) and the admin fleet spec (unknown `ADMIN_SECRET`).
- UI tests use `data-testid` contracts. Auth dashboard tests call `gotoAuthPage()`, which waits for `data-hydrated="true"`; clicking an SSR-rendered tab earlier loses the event.
- `RUN_AI_E2E=1` includes real Workers AI inference tests.

## Gotchas

- DO SQLite blocks `pragma_table_info()` and explicit `BEGIN`/`COMMIT` with `SQLITE_AUTH`. No Better Auth Kysely migrations; Drizzle migrations with `transaction: false`.
- Miniflare service bindings are realm-sensitive: call `binding.fetch(url, init)`, never a Node-realm `Request`, and convert responses with `toNativeResponse` before returning from SvelteKit.
- Run agent Wrangler commands from `agents/auth` (at the root they target the web Worker). `--env preview` for `auth-agent-preview`.
- `BETTER_AUTH_SECRET` is a plain var only in local/test; `wrangler secret put` elsewhere. Analytics writes need no token; SQL reads need `CF_ACCOUNT_ID` + `CF_ANALYTICS_API_TOKEN` (Account Analytics Read).
- Never hand-edit generated `worker-configuration.d.ts`; regenerate, and put optional-secret augmentations in a separate `.d.ts`. Both generated files are lint-ignored.
- The agent entrypoint may only export handlers and DO classes. A value export fails at boot with `Incorrect type for map entry`, which reads like a config error. Type-only exports are fine.
- Sentry DSNs are never committed; empty disables reporting. A committed DSN would collect every fork's errors.
- `TRUSTED_ORIGINS` is only for origins other than the deployment's own (the agent trusts its own origin automatically). A cross-origin request from an unlisted origin gets an explicit 403 `INVALID_ORIGIN`, never a credential error.
- On Windows, killing only a listening workerd leaves its Wrangler parent alive with children that lock persistence dirs. `scripts/kill-port.mjs` kills the full tree (match scoped to Wrangler); `scripts/clean-dir.mjs` only accepts `.wrangler/test-state` targets and retries `EBUSY`/`EPERM`.

## Conventions

- Svelte 5 runes, shadcn-svelte under `$lib/components/ui`, LayerChart, `mode-watcher`, tabs, single quotes.
- Routes are grouped: `(marketing)` holds the landing page; `(app)` holds `login`, `admin`, `dashboard`. `api/` and the root layout/error stay ungrouped (groups do nothing for `+server.ts` routes but would churn their route ids). Groups appear in `resolve()` route ids (`/(app)/dashboard/[projectId]`), never in URLs.
- Dynamic segments are named for what they hold: `[projectId]`, `[userId]`, `[sessionId]`, never `[id]`.
- New primitives follow the auth shape: separate npm project under `agents/<name>`, `Agent<Env, State>` DO, `routeAgentRequest` entrypoint, root service bindings per environment, same-origin dashboard proxies.
