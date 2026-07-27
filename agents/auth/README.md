# @cloudflarebase/auth

Better Auth on a Cloudflare Durable Object — one isolated instance per project, each with its own embedded SQLite database, at the edge, in your account.

This is the auth primitive behind [Cloudflarebase](https://github.com/cloudflarebase/cloudflarebase.com). It is a Worker you host, not a service you sign up for.

## What you get

One `AuthAgent` Durable Object per project, addressed by project id at `/agents/auth-agent/<projectId>/...`:

- Email/password, anonymous, and bearer sessions via [Better Auth](https://better-auth.com), over Drizzle on embedded DO SQLite.
- Project-signed JWTs on `GET /token`, public keys on `GET /jwks`, carrying `email`, `role`, and `permissions` claims.
- Simple RBAC — a per-project registry of `{ name, permissions[] }` roles. `user.role` cannot be self-assigned at sign-up.
- Live state sync to connected dashboards over WebSocket (Agents SDK).
- Per-project CORS: environment trusted origins combined with per-project allowed origins.
- Auth events to Workers Analytics Engine, with the aggregate queries the dashboard renders.

## Install

```sh
npm install @cloudflarebase/auth
```

## Wire it up

A Durable Object class must be exported from your Worker's own entrypoint for Wrangler to find it, so the re-export is how the binding resolves — not optional plumbing.

```ts
// src/index.ts
export { AuthAgent, default } from '@cloudflarebase/auth';
```

Merge [`template/wrangler-fragment.jsonc`](template/wrangler-fragment.jsonc) into your `wrangler.jsonc`, then regenerate your types:

```sh
npx wrangler types
npx wrangler deploy
```

The fragment's `migrations` block is a fresh `v1`. Do not copy the tag history out of the Cloudflarebase repository — it carries a rename of an earlier class, and replaying it against a new Worker tries to delete a class you never had.

## The binding contract

The agent reads `Env` from **your** wrangler configuration, not from this package. That is what makes it portable: the published declarations name `Env` rather than inlining ours, so it resolves to your `wrangler types` output.

The cost is that nothing would otherwise check you declared the bindings the agent reads — a missing one would surface as a runtime failure on the first request. So assert it once, anywhere in your Worker:

```ts
import type { AssertAuthAgentEnv } from '@cloudflarebase/auth';
export type _AuthAgentBindings = AssertAuthAgentEnv<Env>;
```

Forget the Analytics Engine dataset and you get a named error in your own file instead:

```
error TS2344: Type 'Env' does not satisfy the constraint 'AuthAgentBindings'.
  Property 'AUTH_EVENTS' is missing in type 'Env' but required in type 'AuthAgentBindings'.
```

### Bindings

| Binding                                     | Required | Purpose                                                                                            |
| ------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `AuthAgent`                                 | yes      | The Durable Object namespace. Without it there is no agent to route to.                            |
| `AUTH_EVENTS`                               | yes      | Analytics Engine dataset. Auto-creates on first write; writes need no credentials.                 |
| `AI`                                        | no       | Workers AI. Only `POST /chat` uses it, and only that route fails without it.                       |
| `EMAIL` / `EMAIL_FROM`                      | no       | Cloudflare Email Service for verification and password reset. Sign-up and sign-in work without it. |
| `TRUSTED_ORIGINS`                           | no       | CSRF allowlist, comma separated. See the warning below.                                            |
| `WAE_DATASET`                               | no       | Dataset name for Analytics Engine SQL reads.                                                       |
| `CF_ACCOUNT_ID` / `CF_ANALYTICS_API_TOKEN`  | no       | Analytics **reads**. Without them analytics is write-only.                                         |
| `BETTER_AUTH_SECRET`                        | no       | Overrides the per-project signing key for the whole deployment.                                    |
| `DEMO_MODE` / `DEMO_TTL_HOURS`              | no       | Makes `demo-<hex>` projects throwaway. Only wanted on a public demo.                               |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no       | Social sign-in, also settable per project.                                                         |

The agent guards every optional binding so a degraded one never breaks authentication. That resilience is deliberate, and is not an invitation to omit them.

> **Set `TRUSTED_ORIGINS` after your first deploy.** It is the CSRF allowlist, and sign-in is refused from an origin that is not on it — which surfaces as a _rejected credential_, not a configuration error. It is worth getting right before you go looking for bugs.

## No secrets required

`BETTER_AUTH_SECRET` is optional. When unset, each project generates a 32-byte signing key on first start and keeps it in its own Durable Object storage, so a fresh install needs nothing set by hand and no two projects share a key. Set it only if you want to own and rotate the value yourself — it then applies to every project on the deployment.

## Requirements

- `compatibility_flags: ["nodejs_compat", "nodejs_als"]`
- `new_sqlite_classes` for the Durable Object — the classic key-value backend cannot run the embedded database.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Cloudflarebase is an independent open-source project, not affiliated with or endorsed by Cloudflare, Inc.
