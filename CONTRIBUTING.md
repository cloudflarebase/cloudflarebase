# Contributing

Thanks for looking. This is a small project and PRs are genuinely welcome.

## Getting it running

```bash
npm install
npm run dev
```

No secrets to configure: each project generates its own signing key on first
start and keeps it in its own Durable Object storage.

That starts the auth agent on `:8788`, the db agent on `:8789`, and the
dashboard on `:5173`. Open `http://localhost:5173/dashboard`.

Local development runs with `DEMO_MODE=true`, so you get a throwaway project
without signing in. To exercise the real self-hosted path, unset it in
`wrangler.jsonc` under `env.local` and you will be asked to claim the console.

## Before you open a PR

```bash
npm run check   # svelte-check
npm run lint    # prettier + eslint
npm test        # full Playwright suite
```

All three run in CI and all three must pass. The e2e suite boots a
production-mirroring stack - the built SvelteKit worker on `:8797` plus both
agents on `:8798` and `:8799`, all in real workerd, with real service
bindings and Durable Object SQLite. It takes a few minutes and it is the check
that actually catches things.

One gotcha: `npm run build` writes the bundled Worker to `.svelte-kit/cloudflare/`,
which `svelte-check` then scans, so running `check` after `build` reports
thousands of errors in generated code. Delete that directory first. CI is
unaffected - it checks a fresh checkout before building.

Each agent is its own TypeScript project, so typecheck them separately - and
the db agent has unit tests for its pure modules (query compiler/matcher
parity, rules, ULIDs):

```bash
cd agents/auth && npx tsc --noEmit
cd agents/db && npx tsc --noEmit && npm run test:unit
```

## Repository shape

Separate npm projects with separate Wrangler configs and separate generated
`Env` types:

| Path          | Worker       | What it is                                     |
| ------------- | ------------ | ---------------------------------------------- |
| `/`           | web          | SvelteKit dashboard and marketing site         |
| `agents/auth` | `auth-agent` | `AuthAgent` DO - Better Auth per project       |
| `agents/db`   | `db-agent`   | `DbAgent` + `DbCollection` DOs - documents     |
| `cli`         | none         | `@frostbase/cli`, runs on a consumer's machine |

**Never import runtime code or generated Worker types across those
boundaries.** Shared DTOs are deliberately copied - `src/lib/agents.ts`
mirrors `agents/auth/src/{agent,fleet}.ts` and `agents/db/src/{agent,schemas}.ts`,
and `src/lib/ulid.ts` mirrors `agents/db/src/ulid.ts`. If you change one side,
change the other in the same PR. (Agent manifests are the one exception: the
app imports each `frostbase.agent.json` directly, on purpose, so the
console guard can never drift from what the package declares.)

Installation-wide state - the project registry - is D1 on the dashboard
Worker (`src/lib/server/db/schema.ts`), not an agent. Per-project state lives
in that project's Durable Objects.

Read [CLAUDE.md](CLAUDE.md), [agents/auth/CLAUDE.md](agents/auth/CLAUDE.md),
and [agents/db/CLAUDE.md](agents/db/CLAUDE.md) before anything structural.
They record the architecture decisions and the gotchas that are expensive to
rediscover - Durable Object SQLite refusing `pragma_table_info()` and explicit
transactions, why `routeAgentRequest` must not be given `cors: true`, why
Miniflare service bindings need `binding.fetch(url, init)` rather than a
`Request`, and why a Durable Object that aborts after replying can make a
completed operation look like a failure.

New primitives follow the agent contract in [AGENTS.md](AGENTS.md): a new
agent is its own npm project shipping a `frostbase.agent.json`, plus one
entry in `src/lib/agent-registry.ts` (which drives the console guard,
dispatch, proxies, sidebar, and delete fan-out) and one in
`cli/src/lib/agents.ts`.

## Things worth knowing

- **Validation is zod, everywhere.** Route inputs and anything crossing a
  service binding get parsed, not cast. The OpenAPI document is generated from
  those same schemas, so adding a documented field means editing one place.
- **Schema changes need a migration.** Edit the agent's `src/db/schema.ts`,
  then run `npm run migrations` in that agent, which generates the SQL and
  inlines it into `src/migrations.ts`. Never hand-edit either - the inlining
  is what lets the agents ship as plain npm dependencies.
- **After changing bindings**, regenerate types: `npm run cf-typegen` at the
  root, `npx wrangler types` in the agent. Never hand-edit
  `worker-configuration.d.ts`.
- **UI tests need `data-testid`.** Dashboard tests go through `gotoAuthPage()`
  / `gotoDbPage()`, which wait for hydration - clicking an SSR-rendered tab
  before Svelte attaches its handler silently loses the event.
- **Errors that are caught must still be reported.** Sentry's SvelteKit
  `handleError` hook and the Durable Object instrumentation only see errors
  that escape; anything you catch and turn into an error response needs an
  explicit `Sentry.captureException`, or the failure is invisible in
  production.
- **Security-sensitive paths deserve a test that attacks them.** See
  `e2e/console-guard.api.spec.ts`, which asserts endpoints reject anonymous
  callers rather than asserting they work when authenticated.

## Commit messages

Explain why the change is needed, not just what it does. If you fixed a bug,
say what was broken and how it showed up.

## Reporting security issues

Do not open an issue. See [SECURITY.md](SECURITY.md).
