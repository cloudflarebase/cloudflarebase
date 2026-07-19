# Cloudflarebase

Firebase alternative built natively on Cloudflare (Workers, Durable Objects, D1, KV, R2, Workers AI, and Agents SDK). The product is agent-first: each backend primitive is implemented as a Cloudflare Agent, with one Durable Object instance per client project.

Also read [AGENTS.md](AGENTS.md). Cloudflare APIs change frequently; retrieve current official documentation before Workers, Durable Objects, Agents, bindings, or limits work.

## Repository layout

These are separate npm projects with separate Wrangler configurations and generated `Env` types. Never import runtime code or generated Worker types across them. Shared DTOs are deliberately copied and must be kept in sync.

| Path          | Worker                                                         | Purpose                                                                                           |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/`           | `cloudflarebase-com` (`cloudflarebase-com-test` for e2e)       | SvelteKit 2/Svelte 5 dashboard and marketing site, shadcn-svelte, Tailwind v4, Cloudflare adapter |
| `agents/auth` | `auth-agent` (`-local`, `-test`, or `-preview` by environment) | `AuthAgent` Durable Object; Better Auth and Drizzle over embedded DO SQLite                       |

The root Worker binds `AUTH_AGENT` to the Auth Agent service. Agent instances use `/agents/auth-agent/<projectId>/...`.

## Commands

| Location      | Command                          | Purpose                                                          |
| ------------- | -------------------------------- | ---------------------------------------------------------------- |
| root          | `npm run dev`                    | Auth Agent on :8788, then Vite on :5173                          |
| root          | `npm run check` / `npm run lint` | Svelte diagnostics / Prettier and ESLint                         |
| root          | `npm run build`                  | Production SvelteKit Cloudflare build                            |
| root          | `npm test` / `npm run test:e2e`  | Full Playwright suite against Workers on :8797/:8798             |
| root          | `npm run test:e2e:ui`            | Playwright UI                                                    |
| root          | `npm run cf-typegen`             | Regenerate `src/worker-configuration.d.ts` after binding changes |
| `agents/auth` | `npx tsc --noEmit`               | Typecheck the Auth Agent                                         |
| `agents/auth` | `npx drizzle-kit generate`       | Generate migrations after schema edits                           |
| `agents/auth` | `npx wrangler types`             | Regenerate Auth Agent Worker types                               |

## Architecture decisions

- Drizzle ORM is the database layer. Auth agents use `drizzle-orm/durable-sqlite`; generated migrations are bundled through `drizzle/migrations.js` and applied in `onStart`.
- Better Auth runs inside each project's `AuthAgent`. It uses the Drizzle SQLite adapter with `transaction: false` and project-scoped cookie prefixes.
- The browser normally uses same-origin `/api/projects/<id>/...` SvelteKit endpoints. Those proxy over `AUTH_AGENT`, preserving cookies, origin, and the edge-resolved country header.
- Realtime state uses `AgentClient` from `agents/client`. Development connects directly to :8788; the built Worker proxies `/agents/*` through `src/hooks.server.ts`.
- `AuthAgent` owns CORS. It combines environment `TRUSTED_ORIGINS` with per-project allowed origins, echoes the exact trusted origin, permits credentials, and exposes `set-auth-token`. Do not enable `routeAgentRequest(..., { cors: true })`; its wildcard header overrides the project policy.
- DO SQLite is authoritative for users and sessions. Auth events go to Workers Analytics Engine; local/test also mirror them to D1 for deterministic analytics queries.
- Workers AI chat is grounded in the project's operational and aggregate auth data. Real AI e2e coverage is opt-in and is never replaced with fake model output.
- Shared DTOs in `src/lib/agents.ts` mirror types in `agents/auth/src/agent.ts`. Keep both copies synchronized.

## Playwright e2e

`npm test` boots a production-mirroring stack:

- Built SvelteKit Worker on :8797 using `wrangler.e2e.jsonc`.
- Auth Agent on :8798 using `agents/auth` environment `test`.
- Real workerd runtimes, service binding, Durable Object SQLite, KV/D1 bindings, and public API seeding.

The web build sets `E2E_BUILD=true`. `svelte.config.js` then sends the Cloudflare adapter output to `.svelte-kit-e2e/cloudflare`, separate from the normal `.svelte-kit/cloudflare`. This prevents a running Vite/Cloudflare development process from locking the e2e build on Windows. Keep `wrangler.e2e.jsonc` aligned with root compatibility flags and test bindings.

State lives under `.wrangler/test-state/` and is cleared whenever Playwright starts a server. Local runs use `reuseExistingServer`, so VS Code Test Explorer and repeated commands may reuse an existing stack; seed operations are idempotent and generated test identities must remain unique. CI never reuses servers. Better Auth throttling is disabled only in `env.test` because reused persistence would otherwise retain rate-limit buckets between runs.

Playwright projects are `seed`, then dependent `api` and `chromium` projects. API contexts supply the required `Origin` header. Set `BASE_URL` for a deployed or tunnelled target; Playwright then skips local server startup. The direct-agent smoke test skips remotely because the agent has no public route.

UI tests use stable `data-testid` contracts. Auth dashboard tests must call `gotoAuthPage()`, which waits until `data-testid="auth-page"` has `data-hydrated="true"`. Without this readiness check, a click on an SSR-rendered tab can happen before Svelte attaches its handler, losing the event and leaving the panel unmounted.

Set `RUN_AI_E2E=1` to include real Workers AI inference tests.

## Gotchas

- DO SQLite blocks `pragma_table_info()` and explicit `BEGIN`/`COMMIT` with `SQLITE_AUTH`. Do not use Better Auth's Kysely migration path; use Drizzle migrations and keep `transaction: false`.
- SQL migrations are Wrangler Text modules. Keep the `rules` entry in `agents/auth/wrangler.jsonc` and declarations in `src/modules.d.ts`.
- Miniflare service bindings are realm-sensitive. Call `binding.fetch(url, init)`, not `binding.fetch(new Request(...))`, and convert responses with `toNativeResponse` before returning them from SvelteKit.
- `BETTER_AUTH_SECRET` is a plain variable only in local/test. Set it with `wrangler secret put` for preview and production.
- Never hand-edit generated `worker-configuration.d.ts` files. Regenerate them and put optional secret augmentations in a separate `.d.ts`.
- On Windows, killing only a listening workerd can leave its Wrangler parent alive with ephemeral children that lock persistence directories. `scripts/kill-port.mjs` finds listeners plus Wrangler Node commands explicitly configured for the port and kills the full tree. Keep that process match scoped to Wrangler. `scripts/clean-dir.mjs` only accepts `.wrangler/test-state` targets and retries transient `EBUSY`/`EPERM` failures.

## Conventions

- Svelte 5 runes, shadcn-svelte components under `$lib/components/ui`, tabs, and single quotes.
- New primitives follow the auth shape: separate npm project under `agents/<name>`, `Agent<Env, State>` Durable Object, `routeAgentRequest` Worker entrypoint, root service bindings for every environment, and same-origin dashboard proxies.
