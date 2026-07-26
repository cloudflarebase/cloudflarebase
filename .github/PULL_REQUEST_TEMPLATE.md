## What this changes

<!-- What was wrong or missing, and why this is the fix. -->

## How to verify

<!-- What a reviewer should do to see it working. -->

## Checklist

- [ ] `npm run check` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `cd agents/auth && npx tsc --noEmit` passes, if the agent changed

If applicable:

- [ ] Shared DTOs updated on **both** sides — `src/lib/agents.ts` and the
      matching file under `agents/auth/src/`
- [ ] Schema change has a generated migration (`npx drizzle-kit generate`)
- [ ] Binding change has regenerated types (`npm run cf-typegen`,
      `npx wrangler types`)
- [ ] New endpoint is classified in the console guard in `src/hooks.server.ts` —
      anything under `/api` is operator-only unless deliberately opened
- [ ] `CLAUDE.md` updated if this changes an architecture decision or adds a
      gotcha worth not rediscovering
