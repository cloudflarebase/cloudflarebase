# @frostbase-dev/db

Documents with live queries and schema-first SQL tables, one Durable Object per
collection or table. The largest agent in the repo and the one with the most
invariants worth knowing before touching it.

Read the root [AGENTS.md](../../AGENTS.md) first.

## Durable Object topology

Five classes, and the instance **name** is what decides behaviour:

| Class          | Instance name                     | What it is                              |
| -------------- | --------------------------------- | --------------------------------------- |
| `DbAgent`      | `<pid>`                           | per-project coordinator, registry, admin |
| `DbCollection` | `<pid>:<collection>`              | one schemaless JSON collection           |
| `DbTable`      | `<pid>:<table>`                   | one typed SQL table                      |
| `DbGateway`    | `<pid>:gw:<region>:<n>`           | one multiplexed client WebSocket         |
| `DbView`       | `<pid>:v:<view>:global:<n>`       | read-only join over 2–5 member tables    |

Collection and table replicas append `:r:<region>:<n>` to the primary's name.
Project and shard names cannot contain `:`, so the suffix is unambiguous;
`parseShardRole` in `src/replication.ts` derives the role from the name alone.

**The hot data path never touches `DbAgent`.** The worker entrypoint dispatches
`/collections/<c>/**` and `/tables/<t>/**` straight to the shard in one hop,
subscribe upgrades included. `DbAgent` is the single authority that creates
children and pushes config; a child with no config pulls it once, which is also
what heals a failed push.

Views materialize **one** instance, not one per region — a view already stores a
second copy of every member. The name grammar keeps the region slot so adding
real regions later is a routing change, not a data migration.

## Shape

```
src/index.ts         WorkerEntrypoint: hot-path dispatch, erase, region hints
src/agent.ts         DbAgent — registry, admin surface, demo TTL, erase fan-out
src/collection.ts    DbCollection — JSON documents
src/table.ts         DbTable — typed columns over a real SQLite table
src/view.ts          DbView — the join view (JOIN1)
src/gateway.ts       DbGateway — one socket for the whole database
src/live.ts          LiveShard — the live-query engine, SHARED by collection+table
src/access.ts        access gate + CORS, SHARED by collection+table
src/pitr.ts          point-in-time recovery over DO storage bookmarks
src/replication.ts   change-log append/read/prune, role parsing
src/client.ts        isomorphic end-user SDK
src/drizzle.ts       drizzle driver over the D1-shaped /sql endpoint
src/admin.ts         server-side admin client (targets the CONSOLE)
```

Pure modules with no Workers imports, so they run under `node:test`:
`query.ts`, `table-query.ts`, `table-schema.ts`, `table-sql.ts`, `rules.ts`,
`replication.ts`, `region.ts` (the first six are covered by `test:unit`). Keep
them that way — being importable outside workerd is the only reason the
compiler/matcher parity can be pinned by a unit test at all.

## What only holds here

- **`live.ts` and `access.ts` are extracted, not copied.** Collections and
  tables share them verbatim so the two engines cannot drift on subscription
  survival, windowed-diff semantics, or who gets in. Do not fork them.
- **The socket attachment holds only `{ connId }`.** The `subscriptions` table
  is the durable state, so a hibernation wake restores full context from SQLite
  with zero in-memory state.
- **One parsed `Query` drives both evaluators** — the SQL compiler (snapshots,
  REST) and the JS matcher (live evaluation on writes) — plus the order
  comparator the client SDK reuses. Their parity is the invariant
  `query.unit.test.ts` exists to pin. Change one, change both.
- **Windowed queries (orderBy + limit) re-run and diff ids** against
  `lastMembership`; unlimited queries get a predicate diff over old/new. That
  difference is what gets displacement right.
- **`pragma_table_info()` is SQLITE_AUTH.** The applied schema is our own record
  (`appliedColumns` in the child's cached meta), never introspection.
  `configure()` plans the DDL diff between declared and applied, and only
  advances the record once every statement landed.
- **Physical tables are named after the declared table** with plain `id` /
  `owner` / `created_at` / `updated_at` system columns — deliberately, so
  ORM-generated SQL runs unmodified. Renaming later would be a data migration.
- **SQLite affinity is not a type system.** Every write validates against the
  declared type in `table-schema.ts` *before* binding. Any new write path
  (imports, the SQL endpoint, replication apply) must reuse that module.
- **The raw-SQL gate does not parse SQL** — it refuses what must never run:
  anything but a single SELECT/INSERT/UPDATE/DELETE, any reference to internal
  tables (`subscriptions` carries token metadata, `changelog` carries every row
  image), and user-supplied `RETURNING`. The internal-name scan is a dumb
  case-insensitive word match over the whole statement, literals included. False
  positives are the cost of no parser; false negatives are the thing it exists
  to prevent.
- **Log writes must land in the same event-loop task as the mutation they
  describe.** DO write coalescing is what makes data+log atomic — *no `await`
  may separate them*. That is why `replication.ts` uses raw `ctx.storage.sql`
  rather than drizzle.
- **Rules-lite binds the public write path only.** Operator surfaces (dashboard
  editor, admin import) bypass it exactly like they bypass access modes,
  mirroring how Firestore security rules never bind the Admin SDK. PATCH is
  validated on the *merged* result.
- **`owner` mode tables may not sit in a view.** Row ownership does not survive
  a join — `todos JOIN users` over owner-scoped todos returns the `users` rows
  selected by *other* owners' todos.
- **The gateway is deliberately dumb.** Zero data, zero query state; it
  registers subscriptions *at* the shard and the shard delivers resolved frames
  back by RPC, which wakes a hibernated gateway. Never an outgoing socket — one
  dies with hibernation exactly when delivery must happen.
- **Views are eventually consistent (~3s).** Built for reporting reads, not
  invariants.
- **Remote Config gets versioning for free because a table is a Durable
  Object.** Its parameters live in a `DbTable` (`cfb_remote_config`), so publish
  is a PITR checkpoint on that instance, the change history is its restore
  points, and rollback is a restore that rewinds *only the config*. That is the
  whole reason the feature stores nothing of its own — and the reason it must
  never move into `DbAgent`, whose storage is the shard registry: restoring
  there would rewind every collection and table declaration with it.
- **A new `DbActivityEvent` type must reach the console mirror
  (`src/lib/agents.ts`) in the same commit.** The console parses agent state on
  every db page load; RC1's first `remote-config.changed` event 502'd the whole
  db workspace because only this side's union grew. The mirror now backstops
  unknown types by dropping the feed — still mirror it, or the event renders
  nowhere.
- **`cfb_` is the platform's namespace.** Shards named that way are created and
  configured by the feature that owns them; the generic collection/table/view
  routes refuse to touch one. The prefix is deliberate so the next platform-
  owned shard needs no new rule, and the owning feature must offer a teardown —
  reserving a name without a way to remove it is a trap.

## Routes

Public: `/collections/*`, `/tables/*`, `/views/*`, `/realtime`, `/config`.
Operator: `/overview`, `/admin/*`, plus the state-sync socket and `/internal/*`.

Same layer-2 rule as every agent — the operator plane is closed unless
`EXPOSE_OPERATOR_API=true`. Never pass `cors: true` to `routeAgentRequest`.

## Commands

```bash
npm run dev         # wrangler dev --env local, :8789
npm run typecheck
npm run test:unit   # query, rules, uuidv7, table-schema/query/sql, replication
npm run migrations
```
