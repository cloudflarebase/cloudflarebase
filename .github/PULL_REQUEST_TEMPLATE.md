## What this changes

<!-- What was wrong or missing, and why this is the fix. -->

## How to verify

<!-- What a reviewer should do to see it working. -->

## Checklist

- [ ] `npm run check` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `npx tsc --noEmit` passes in each agent you changed
      (`agents/auth`, `agents/db`), plus `npm run test:unit` in `agents/db`

If applicable:

- [ ] Shared DTOs updated on **both** sides - `src/lib/agents.ts` and the
      matching file under `agents/auth/src/` or `agents/db/src/`
- [ ] Schema change has a generated migration (`npm run migrations` in that
      agent; never hand-edit `src/migrations.ts`)
- [ ] Binding change has regenerated types (`npm run cf-typegen`,
      `npx wrangler types`)
- [ ] New agent route declared in that agent's `frostbase.agent.json` -
      the console guard is generated from it, and undeclared routes are
      operator-only
- [ ] Caught errors that become an error response also
      `Sentry.captureException` - the hooks only see errors that escape
- [ ] `CLAUDE.md` updated if this changes an architecture decision or adds a
      gotcha worth not rediscovering
