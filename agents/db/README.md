# @frostbase-dev/db

Firestore-style JSON documents with live queries, running on Cloudflare
Durable Objects - one isolated instance per collection. The database
primitive behind [Frostbase](https://github.com/frostbase-dev/frostbase).

```bash
npx @frostbase-dev/cli add db
```

The CLI installs this package, merges `template/wrangler-fragment.jsonc` into
your `wrangler.jsonc`, re-exports the Durable Object classes from your
entrypoint, and reruns `wrangler types`. Manual setup is the same three
steps; both templates ship in the package.

## What you get

- **Collections of JSON documents** - CRUD over REST, one Durable Object per
  collection, addressed as `/agents/db-agent/<projectId>/collections/<name>`.
- **Queries** - `where` (`==`, `!=`, `<`, `<=`, `>`, `>=`, `in`,
  `array-contains`), `orderBy`, `limit`, and keyset cursors.
- **Live queries** - subscribe to a filtered query over WebSocket and receive
  `added` / `modified` / `removed` deltas as writes happen. Subscriptions
  survive hibernation; you pay nothing while idle.
- **Access modes per collection** - `public`, `auth`, or `owner`, verified
  against `@frostbase-dev/auth` project JWTs. `owner` scopes every read and
  write to the token's subject. Optional permission keys additionally require
  that claim on the JWT (granted via auth roles; the admin role's `*` always
  passes).
- **Document rules** - a per-collection validator (type / required / bounds /
  enum over top-level fields, `additionalFields: reject`) enforced on public
  writes; operator surfaces bypass it like the Firestore Admin SDK bypasses
  security rules.
- **Aggregates** - `count`, `sum`, and `avg` computed server-side with the
  same where clauses as a query; `sum`/`avg` skip non-numeric values.
- **Backup and rollback** - NDJSON export (streamed, also from the client
  SDK), operator NDJSON import that round-trips exports exactly, and
  point-in-time restore of a single collection to any moment in the past 30
  days (deployed stacks; local development has no durable change log).
- **A typed client** - `@frostbase-dev/db/client` wraps REST, aggregates,
  export, and the subscribe protocol with the same zod schemas the server
  validates with.

```ts
import { createDbClient } from '@frostbase-dev/db/client';

const db = createDbClient({
	baseUrl: 'https://your-worker.workers.dev/agents/db-agent/my-app',
	getToken: async () => (await fetch('/api/auth/token')).json().then((t) => t.token),
});

const posts = db.collection('posts');
await posts.create({ title: 'Show HN: I built a Firebase on Cloudflare', votes: 1 });
const top = await posts.query({ orderBy: [{ field: 'votes', direction: 'desc' }], limit: 25 });

// A Reddit-style front page that re-ranks itself on every vote.
const unsubscribe = posts.subscribe(
	{ orderBy: [{ field: 'votes', direction: 'desc' }], limit: 25 },
	{ onSnapshot: (docs) => render(docs), onChange: (change) => apply(change) },
);
```

## Bindings

Required: the `DbAgent` and `DbCollection` Durable Object bindings and the
`DB_EVENTS` Analytics Engine dataset (auto-creates on first write). Optional:
an `AUTH_AGENT` service binding for multi-worker deployments - in the normal
single-worker install, having `@frostbase-dev/auth` in the same Worker is
enough for token verification. No secret is required for a working deploy.

## What your Worker serves

Mounting the default export publishes the data plane to the internet, which
is the point - your app calls it:

| Route                                        | Who calls it                |
| -------------------------------------------- | --------------------------- |
| `/agents/db-agent/<projectId>/collections/*` | Documents, queries, sockets |
| `/agents/db-agent/<projectId>/tables/*`      | Rows, SQL, sockets          |
| `/agents/db-agent/<projectId>/realtime`      | The one-socket gateway      |
| `/agents/db-agent/<projectId>/config`        | Public client config        |

Each of those enforces the collection's or table's access mode, its
permission keys, and its validators on every request.

`/admin/*` and `/overview` are the **operator plane**, and they enforce none
of that by design - `/admin/query` reads any collection whatever its access
mode, and `/admin/.../import` and `/restore` rewrite one. They are meant to
sit behind a console that has already checked who is calling. On your Worker
there is no such console, so they answer 404.

Reach them from your own code through the `DbAgent` Durable Object namespace
binding, which no HTTP caller can:

```ts
import { getAgentByName } from 'agents';

const agent = await getAgentByName(env.DbAgent, projectId);
const result = await agent.fetch(`https://agent/agents/db-agent/${projectId}/admin/query`, {
	method: 'POST',
	body: JSON.stringify({ collection: 'orders', query: { limit: 10 } }),
});
```

If you would rather serve them over HTTP, put your own authentication in
front and set `"EXPOSE_OPERATOR_API": "true"`. Only do that on a Worker with
no public hostname of its own.

## Limits (per collection)

A collection is one Durable Object: 10 GB of SQLite, roughly 1k requests/s,
and its own pool of hibernated subscribers. Collections are unlimited and
fully independent - there are no cross-collection queries or transactions,
which is exactly what lets a project scale collection by collection.
Documents are capped at 128 KB of JSON; queries return at most 200 documents
per page. Comparisons are defined between same-typed values; a missing field
is indistinguishable from `null`. Auto-generated document ids are ULIDs, so
the default id order is chronological - exports, cursor pages, and the
dashboard browser all read oldest-first without an `orderBy`.

## Requirements

`compatibility_date >= 2026-07-10`, `nodejs_compat` + `nodejs_als` flags, and
`new_sqlite_classes` migrations for both classes (the fragment declares
them).

## License

Apache-2.0. Frostbase is an independent project, not affiliated with or
endorsed by Cloudflare, Inc. See NOTICE.
