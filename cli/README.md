# @cloudflarebase/cli

Scaffold and deploy a [Cloudflarebase](https://github.com/cloudflarebase/cloudflarebase.com)
backend on your own Cloudflare account.

```bash
npm install -g @cloudflarebase/cli

cloudflarebase init my-backend
cd my-backend
npx wrangler login
cloudflarebase deploy
```

That gets you a working auth backend: one Durable Object per project running
Better Auth on its own SQLite database, with no secrets to configure.

## Commands

`init <name>` scaffolds a Worker project and installs the auth agent into it.

`add <agent>` installs an agent into an existing Worker project: npm-installs
the package, merges its wrangler config fragment into yours, exports the
Durable Object class from your entrypoint, and reruns `wrangler types`. It
never overwrites values you set, and running it twice changes nothing. Run it
with no argument to list available agents. All agents are Durable Object
classes in the same Worker, so adding one never means another deploy.

`deploy` deploys the Worker. If the CSRF allowlist (`TRUSTED_ORIGINS`) is
empty, it reads the deployed URL back, writes it into the allowlist, and
deploys again, because sign-in from an unlisted origin fails looking like a
wrong password.

To pin a version: `CLOUDFLAREBASE_AUTH_SPEC=@cloudflarebase/auth@0.2.0-beta.1
cloudflarebase add auth`.

## Notes

One runtime dependency (jsonc-parser), so you can audit the whole thing in a
sitting. Config edits preserve your comments and formatting. `wrangler.toml`
projects are declined rather than half-supported; convert to `wrangler.jsonc`
or merge the fragment by hand. If your entrypoint already has a default
export, `add` shows you the two lines to wire yourself instead of guessing.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Not affiliated with
Cloudflare, Inc.
