# @frostbase/cli

Scaffold and deploy a [Frostbase](https://github.com/frostbase-dev/frostbase)
backend on your own Cloudflare account.

```bash
npm install -g @frostbase/cli

frostbase init my-backend
cd my-backend
frostbase add db          # optional: documents with live queries
npx wrangler login
frostbase deploy
```

That gets you a working backend on your own account, with no secrets to
configure: auth as one Durable Object per project running Better Auth on its
own SQLite database, and - if you add it - a Firestore-style document
database where every collection is its own Durable Object, with live queries.

## Commands

`init <name>` scaffolds a Worker project and installs the auth agent into it.

`add <agent>` installs an agent into an existing Worker project: npm-installs
the package, merges its wrangler config fragment into yours, exports the
Durable Object class from your entrypoint, and reruns `wrangler types`. It
never overwrites values you set, and running it twice changes nothing. Run it
with no argument to list available agents. All agents are Durable Object
classes in the same Worker, so adding one never means another deploy.

`deploy` deploys the Worker and reports the URL. Sign-in works immediately:
the deployment trusts its own origin automatically. `TRUSTED_ORIGINS` (the
CSRF allowlist) is only for extra origins, like another domain serving your
UI; cross-origin requests from unlisted origins get an explicit 403
`INVALID_ORIGIN`.

Available agents today: `auth` and `db`.

To pin a version: `FROSTBASE_DB_SPEC=@frostbase/db@0.1.3
frostbase add db` (and `FROSTBASE_AUTH_SPEC` for auth).

## Notes

One runtime dependency (jsonc-parser), so you can audit the whole thing in a
sitting. Config edits preserve your comments and formatting. `wrangler.toml`
projects are declined rather than half-supported; convert to `wrangler.jsonc`
or merge the fragment by hand. If your entrypoint already has a default
export, `add` shows you the two lines to wire yourself instead of guessing.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Not affiliated with
Cloudflare, Inc.
