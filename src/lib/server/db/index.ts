import { serverError } from '$lib/server/agents';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type ControlPlaneDatabase = DrizzleD1Database<typeof schema>;

/**
 * Ordered, idempotent schema statements for the control-plane database.
 *
 * Applied at runtime rather than through `wrangler d1 migrations apply`, which
 * would be a setup step between cloning this repository and having a working
 * console - and the whole point of the D1 binding auto-provisioning is that
 * there are none. `schema.ts` stays the typed source of truth for queries;
 * when this grows past a couple of tables it should become drizzle-kit
 * generated migrations with an applied-migrations table.
 */
const SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS project (
		id text PRIMARY KEY NOT NULL,
		name text NOT NULL,
		parent_id text,
		branch_name text,
		org_id text,
		created_at integer DEFAULT (unixepoch() * 1000) NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS project_created_at ON project (created_at)`,
	`CREATE TABLE IF NOT EXISTS demo_project (
		id text PRIMARY KEY NOT NULL,
		created_at integer DEFAULT (unixepoch() * 1000) NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS demo_project_created_at ON demo_project (created_at)`,
	`CREATE TABLE IF NOT EXISTS project_agent (
		project_id text NOT NULL,
		agent text NOT NULL,
		enabled_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
		PRIMARY KEY (project_id, agent)
	)`,
	`CREATE TABLE IF NOT EXISTS chat_message (
		id text PRIMARY KEY NOT NULL,
		project_id text NOT NULL,
		client_key text NOT NULL,
		role text NOT NULL,
		content text NOT NULL,
		created_at integer DEFAULT (unixepoch() * 1000) NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS chat_message_thread ON chat_message (project_id, client_key, created_at)`,
	`CREATE TABLE IF NOT EXISTS service_key (
		id text PRIMARY KEY NOT NULL,
		project_id text NOT NULL,
		name text NOT NULL,
		key_hash text NOT NULL,
		created_by text,
		created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
		last_used_at integer
	)`,
	`CREATE INDEX IF NOT EXISTS service_key_project ON service_key (project_id)`,
	`CREATE INDEX IF NOT EXISTS service_key_hash ON service_key (key_hash)`
];

/**
 * Column additions for databases created before the column existed. SQLite
 * has no ADD COLUMN IF NOT EXISTS, so these run individually and a
 * "duplicate column" answer (fresh installs - CREATE TABLE above already
 * carries the column) is the expected no-op, not an error. Statements that
 * DEPEND on upgraded columns (the index) run after them, same tolerance.
 */
const UPGRADE_STATEMENTS = [
	`ALTER TABLE project ADD COLUMN parent_id text`,
	`ALTER TABLE project ADD COLUMN branch_name text`,
	`ALTER TABLE project ADD COLUMN org_id text`,
	`CREATE INDEX IF NOT EXISTS project_parent ON project (parent_id)`,
	`CREATE INDEX IF NOT EXISTS project_org ON project (org_id)`
];

/**
 * Runs the schema once per isolate. Keyed on the binding itself so a reused
 * isolate does not re-issue the statements on every request, and so tests that
 * swap databases still bootstrap the new one.
 */
const bootstrapped = new WeakMap<D1Database, Promise<void>>();

function ensureSchema(d1: D1Database): Promise<void> {
	let pending = bootstrapped.get(d1);
	if (!pending) {
		pending = d1
			.batch(SCHEMA_STATEMENTS.map((statement) => d1.prepare(statement)))
			.then(async () => {
				for (const statement of UPGRADE_STATEMENTS) {
					try {
						await d1.prepare(statement).run();
					} catch (cause) {
						const message = cause instanceof Error ? cause.message : String(cause);
						if (!/duplicate column/i.test(message)) throw cause;
					}
				}
			})
			.catch((cause) => {
				// Let the next request retry rather than caching a failure for the
				// lifetime of the isolate.
				bootstrapped.delete(d1);
				throw cause;
			});
		bootstrapped.set(d1, pending);
	}
	return pending;
}

/**
 * Drizzle handle over the control-plane D1 database, with its schema ensured.
 */
export async function getDb(platform: App.Platform | undefined): Promise<ControlPlaneDatabase> {
	const d1 = platform?.env?.DB;
	if (!d1) {
		serverError(500, 'the DB binding is not available - add a d1_databases entry named DB');
	}

	await ensureSchema(d1);
	return drizzle(d1, { schema });
}
