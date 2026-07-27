# @cloudflarebase/auth

Better Auth on a Cloudflare Durable Object. One isolated instance per project,
each with its own embedded SQLite database, in your account. This is the auth
primitive behind [Cloudflarebase](https://github.com/cloudflarebase/cloudflarebase.com).

What each project's agent gives you: email/password, guest, and social sign-in;
cookie sessions and bearer tokens; project-signed JWTs (`GET /token`, keys on
`GET /jwks`) carrying role and permission claims; live state sync to connected
dashboards; auth events into Workers Analytics Engine.

## Install

The easy way is the CLI, which does all of the wiring below:

```bash
npx @cloudflarebase/cli add auth
```

By hand: install the package, re-export the agent from your Worker entrypoint
(Wrangler needs the Durable Object class exported there), merge
[`template/wrangler-fragment.jsonc`](template/wrangler-fragment.jsonc) into
your `wrangler.jsonc`, and regenerate types.

```ts
// src/index.ts
export { AuthAgent, default } from '@cloudflarebase/auth';
```

```bash
npm install @cloudflarebase/auth
npx wrangler types
npx wrangler deploy
```

Use the fragment's `migrations` block as-is. It is a fresh `v1` on purpose;
don't copy the migration history out of the Cloudflarebase repo.

## Bindings

The agent reads `Env` from your wrangler config, not from this package. To
catch a missing binding at compile time instead of on the first request, add
one line anywhere in your Worker:

```ts
import type { AssertAuthAgentEnv } from '@cloudflarebase/auth';
export type _AuthAgentBindings = AssertAuthAgentEnv<Env>;
```

Only two bindings are required: `AuthAgent` (the Durable Object namespace) and
`AUTH_EVENTS` (an Analytics Engine dataset; auto-creates on first write).
Everything else degrades gracefully when absent: `AI` only powers `/chat`,
`EMAIL`/`EMAIL_FROM` only affect verification mail, and `BETTER_AUTH_SECRET`
is optional because each project generates its own signing key.

A deployment trusts its own origin automatically, so sign-in works right after
deploy. `TRUSTED_ORIGINS` (the CSRF allowlist) is only for extra origins:
other domains serving your UI, or apps calling the API from elsewhere.

## Requirements

`compatibility_flags: ["nodejs_compat", "nodejs_als"]` and
`new_sqlite_classes` for the Durable Object.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Not affiliated with
Cloudflare, Inc.
