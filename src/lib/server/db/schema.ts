import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Control-plane schema, held in D1 on the dashboard Worker.
 *
 * This is deliberately not in an agent. The registry lists projects, and a
 * project will eventually have a db agent and a storage agent as well as auth
 * - so no single agent can own it without every other agent depending on that
 * one. D1 binds directly to the dashboard, which is the control plane, and
 * needs no Durable Object (the SvelteKit adapter cannot export one anyway).
 */
export const project = sqliteTable(
	'project',
	{
		/** Becomes the Durable Object name and the API base path. Immutable.
		 * A BRANCH row's id is `<parentId>--<branchName>` - the derived id IS
		 * the isolation: every agent already keys on
		 * project id, so a branch gets its own instances, keys, and replicas
		 * with zero agent changes. */
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		/** Root project this row branches from; null = a root project. The
		 * registry decides what is a branch - never the string shape (ids
		 * containing `--` from before the rule are grandfathered roots). */
		parentId: text('parent_id'),
		/** The branch's short name (`staging`); null on roots (`main`). */
		branchName: text('branch_name'),
		/** Owning organization - a row in the console AuthAgent's org tables
		 *. The registry knows which org owns a
		 * project; the agent knows who is in the org; the guard joins the two
		 * per request. Null = legacy/self-hosted row, visible to any operator -
		 * exactly the pre-Phase-A behaviour, so a claimed-mode install never
		 * notices ownership exists. Branch rows copy the root's value. */
		orgId: text('org_id'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`)
	},
	(table) => [
		index('project_created_at').on(table.createdAt),
		index('project_parent').on(table.parentId),
		index('project_org').on(table.orgId)
	]
);

export type ProjectRow = typeof project.$inferSelect;

/**
 * Append-only log of demo projects, written when the dashboard mints a
 * `demo-<hex>` id for an anonymous visitor. Demo Durable Objects self-erase
 * after DEMO_TTL_HOURS and their auth events age out of Analytics Engine after
 * 90 days, so this log is the only all-time record - the fleet dashboard reads
 * its count as the "demos created" total. Rows are never deleted.
 */
export const demoProject = sqliteTable(
	'demo_project',
	{
		id: text('id').primaryKey(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`)
	},
	(table) => [index('demo_project_created_at').on(table.createdAt)]
);

/**
 * Project service keys - the credential a SERVER
 * can hold, for the cases with no user to relay: crons, queue consumers,
 * webhook handlers, seed scripts, and backends.
 *
 * Scoped to ONE registry row, deliberately NOT to a root-and-branches family:
 * for data the branch IS the isolation boundary, and a preview key that reached production rows would make branches a lie.
 *
 * Only the SHA-256 digest is stored, so a control-plane leak yields no working
 * credential, and the secret is unrecoverable after the one-time reveal.
 */
export const serviceKey = sqliteTable(
	'service_key',
	{
		id: text('id').primaryKey(),
		projectId: text('project_id').notNull(),
		name: text('name').notNull(),
		keyHash: text('key_hash').notNull(),
		/** Operator user id, so a key has an author in the audit trail. */
		createdBy: text('created_by'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' })
	},
	(table) => [
		index('service_key_project').on(table.projectId),
		index('service_key_hash').on(table.keyHash)
	]
);

export type ServiceKeyRow = typeof serviceKey.$inferSelect;

/**
 * Which agents a project has enabled. Groundwork from the agent contract: v1
 * default-enables every registry agent and offers no opt-out UI, and deletion
 * deliberately does NOT read this table - erase fans out to every registry
 * agent even when a row is missing, so a gap can never strand user data.
 */
export const projectAgent = sqliteTable(
	'project_agent',
	{
		projectId: text('project_id').notNull(),
		agent: text('agent').notNull(),
		enabledAt: integer('enabled_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`)
	},
	(table) => [primaryKey({ columns: [table.projectId, table.agent] })]
);
