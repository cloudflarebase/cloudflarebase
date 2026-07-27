# @cloudflarebase/cli

Scaffold and deploy a [Cloudflarebase](https://github.com/cloudflarebase/cloudflarebase.com) backend on your own Cloudflare account.

```sh
npm install -g @cloudflarebase/cli

cloudflarebase init my-backend
cd my-backend
npx wrangler login   # first time only
cloudflarebase deploy
```

That is a working auth backend: one Durable Object per project running Better Auth over its own SQLite database, in your account, with no secrets to configure.

## Commands

### `cloudflarebase init <name>`

Scaffolds a Worker and installs the auth agent into it. The scaffold is deliberately thin — a name, an empty entrypoint, dev tooling. Everything that makes it a Cloudflarebase backend arrives through `add`, from the agent package's own configuration fragment, so there is exactly one definition of a working setup.

### `cloudflarebase add <agent>`

Installs an agent into an existing Worker project:

1. `npm install` the agent package.
2. Merge its wrangler fragment into your `wrangler.jsonc` — comments and formatting preserved, and **nothing you set is ever overwritten**: absent keys are filled in, present ones are left alone, collections are matched by binding name and appended only when missing.
3. Re-export the agent's Durable Object class from your entrypoint (a DO class must be exported from the Worker's own entrypoint for Wrangler to find it), along with a one-line type assertion that turns a missing binding into a named compile-time error.
4. Regenerate your Worker types.

Every step is idempotent — a failed run can simply be re-run, and `add` on an already-configured project changes nothing.

Run `cloudflarebase add` with no argument to list installable agents. All agents are Durable Object classes in the **same** Worker: adding more never means deploying more.

### `cloudflarebase deploy`

Deploys the Worker, then closes the most common first-run trap: if `TRUSTED_ORIGINS` (the CSRF allowlist) is empty, it reads the deployed `workers.dev` URL back, writes it into the allowlist, and deploys again — automatically, once. Sign-in from an unlisted origin is refused as a _bad credential_, not a configuration error, so leaving this to memory sends people hunting for an auth bug they don't have.

## Pinning a version

`CLOUDFLAREBASE_<AGENT>_SPEC` overrides what `add` installs, e.g.:

```sh
CLOUDFLAREBASE_AUTH_SPEC=@cloudflarebase/auth@0.2.0-beta.1 cloudflarebase add auth
```

## Design notes

- **One runtime dependency** ([jsonc-parser](https://www.npmjs.com/package/jsonc-parser), for comment-preserving config edits). A tool that edits your project should be auditable in one sitting.
- `wrangler.toml` projects are declined honestly rather than half-supported: rewriting a TOML file would destroy its comments. Convert to `wrangler.jsonc` or merge the fragment by hand.
- If your entrypoint already has a default export, `add` refuses to guess and shows you the two lines to wire yourself.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Cloudflarebase is an independent open-source project, not affiliated with or endorsed by Cloudflare, Inc.
