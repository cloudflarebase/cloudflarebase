# Contributing

Thanks for looking. This is a small project and PRs are genuinely welcome.

## Getting it running

```bash
npm install
npm run dev
```

No secrets to configure: each project generates its own signing key on first
start and keeps it in its own Durable Object storage.

That starts the auth agent on `:8788` and the dashboard on `:5173`. Open
`http://localhost:5173/dashboard`.

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
production-mirroring stack — the built SvelteKit worker and the auth agent, both
in real workerd, with real service bindings and Durable Object SQLite. It takes
a few minutes and it is the check that actually catches things.

One gotcha: `npm run build` writes the bundled Worker to `.svelte-kit/cloudflare/`,
which `svelte-check` then scans, so running `check` after `build` reports
thousands of errors in generated code. Delete that directory first. CI is
unaffected — it checks a fresh checkout before building.

Typecheck the agent separately, since it is its own TypeScript project:

```bash
cd agents/auth && npx tsc --noEmit
```

## Repository shape

Two separate npm projects with separate Wrangler configs and separate generated
`Env` types:

| Path          | Worker       | What it is                          |
| ------------- | ------------ | ----------------------------------- |
| `/`           | web          | SvelteKit dashboard and marketing   |
| `agents/auth` | `auth-agent` | `AuthAgent` + `ProjectRegistry` DOs |

**Never import runtime code or generated Worker types across that boundary.**
Shared DTOs are deliberately copied — `src/lib/agents.ts` mirrors
`agents/auth/src/agent.ts` and `agents/auth/src/registry.ts`. If you change one
side, change the other in the same PR.

Read [CLAUDE.md](CLAUDE.md) and [agents/auth/CLAUDE.md](agents/auth/CLAUDE.md)
before anything structural. They record the architecture decisions and the
gotchas that are expensive to rediscover — Durable Object SQLite refusing
`pragma_table_info()` and explicit transactions, why `routeAgentRequest` must
not be given `cors: true`, and why Miniflare service bindings need
`binding.fetch(url, init)` rather than a `Request`.

## Things worth knowing

- **Validation is zod, everywhere.** Route inputs and anything crossing the
  service binding get parsed, not cast. The OpenAPI document is generated from
  those same schemas, so adding a documented field means editing one place.
- **Schema changes need a migration.** Edit `agents/auth/src/db/schema.ts`, then
  `npx drizzle-kit generate`. Never hand-edit a generated migration.
- **After changing bindings**, regenerate types: `npm run cf-typegen` at the
  root, `npx wrangler types` in `agents/auth`. Never hand-edit
  `worker-configuration.d.ts`.
- **UI tests need `data-testid`.** Auth dashboard tests must go through
  `gotoAuthPage()`, which waits for hydration — clicking an SSR-rendered tab
  before Svelte attaches its handler silently loses the event.
- **Security-sensitive paths deserve a test that attacks them.** See
  `e2e/console-guard.api.spec.ts`, which asserts endpoints reject anonymous
  callers rather than asserting they work when authenticated.

## Commit messages

Explain why the change is needed, not just what it does. If you fixed a bug,
say what was broken and how it showed up.

## Reporting security issues

Do not open an issue. See [SECURITY.md](SECURITY.md).
