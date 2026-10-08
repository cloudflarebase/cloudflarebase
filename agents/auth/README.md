# @frostbase-dev/auth

Better Auth on a Cloudflare Durable Object. One isolated instance per project,
each with its own embedded SQLite database, in your account. This is the auth
primitive behind [Frostbase](https://github.com/frostbase-dev/frostbase).

What each project's agent gives you: email/password, guest, and social sign-in;
cookie sessions and bearer tokens; project-signed JWTs (`GET /token`, keys on
`GET /jwks`) carrying role and permission claims; live state sync to connected
dashboards; and opt-in auth events into Workers Analytics Engine.

## Install

The easy way is the CLI, which does all of the wiring below:

```bash
npx @frostbase-dev/cli add auth
```

By hand: install the package, re-export the agent from your Worker entrypoint
(Wrangler needs the Durable Object class exported there), merge
[`template/wrangler-fragment.jsonc`](template/wrangler-fragment.jsonc) into
your `wrangler.jsonc`, and regenerate types.

```ts
// src/index.ts
export { AuthAgent, default } from '@frostbase-dev/auth';
```

```bash
npm install @frostbase-dev/auth
npx wrangler types
npx wrangler deploy
```

Use the fragment's `migrations` block as-is. It is a fresh `v1` on purpose;
don't copy the migration history out of the Frostbase repo.

## Bindings

The agent reads `Env` from your wrangler config, not from this package. To
catch a missing binding at compile time instead of on the first request, add
one line anywhere in your Worker:

```ts
import type { AssertAuthAgentEnv } from '@frostbase-dev/auth';
export type _AuthAgentBindings = AssertAuthAgentEnv<Env>;
```

Only one binding is required: `AuthAgent`, the Durable Object namespace.
Everything else degrades gracefully when absent: `AI` only powers `/chat`,
`EMAIL`/`EMAIL_FROM` only affect verification mail, and `BETTER_AUTH_SECRET`
is optional because each project generates its own signing key.

Auth-event analytics are opt-in for a deploy-time reason. Analytics Engine is
an account-level toggle only the Cloudflare dashboard can grant - no API, no
Wrangler flag - so declaring an `AUTH_EVENTS` dataset fails `wrangler deploy`
with `no_access_to_analytics_engine` (code 10089) until you enable it. Turn it
on there, then add the `analytics_engine_datasets` block and `WAE_DATASET`
shown in `template/wrangler-fragment.jsonc`. Without them every write is
skipped and nothing else changes.

A deployment trusts its own origin automatically, so sign-in works right after
deploy. `TRUSTED_ORIGINS` (the CSRF allowlist) is only for extra origins:
other domains serving your UI, or apps calling the API from elsewhere.

## What your Worker serves

Mounting the default export publishes two routes to the internet:

| Route                                       | Who calls it           |
| ------------------------------------------- | ---------------------- |
| `/agents/auth-agent/<projectId>/api/auth/*` | Better Auth - your app |
| `/agents/auth-agent/<projectId>/config`     | Public client config   |

Everything else - `/overview`, `/analytics`, `/chat`, `/admin/*` (users,
sessions, roles, sign-in settings), the state-sync socket, `/internal/*` -
is the **operator plane**, and it authenticates nobody. It is designed to sit
behind a console that has already checked who is calling. On your Worker there
is no such console, so those routes answer 404.

Reach them from your own code through the `AuthAgent` Durable Object namespace
binding, which no HTTP caller can:

```ts
import { getAgentByName } from 'agents';

const agent = await getAgentByName(env.AuthAgent, projectId);
const users = await agent.fetch(`https://agent/agents/auth-agent/${projectId}/admin/users`);
```

If you would rather serve the operator routes over HTTP, put your own
authentication in front of them and set `"EXPOSE_OPERATOR_API": "true"`. Only
do that on a Worker with no public hostname of its own. On the Worker that
serves your application, it publishes your user table and lets anyone grant
themselves the `*` permission via `PUT /admin/roles`.

## Requirements

`compatibility_flags: ["nodejs_compat", "nodejs_als"]` and
`new_sqlite_classes` for the Durable Object.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Not affiliated with
Cloudflare, Inc.
