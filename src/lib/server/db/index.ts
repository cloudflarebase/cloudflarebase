import { error } from '@sveltejs/kit';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type ControlPlaneDatabase = DrizzleD1Database<typeof schema>;

/**
 * Ordered, idempotent schema statements for the control-plane database.
 *
 * Applied at runtime rather than through `wrangler d1 migrations apply`, which
 * would be a setup step between cloning this repository and having a working
 * console — and the whole point of the D1 binding auto-provisioning is that
 * there are none. `schema.ts` stays the typed source of truth for queries;
 * when this grows past a couple of tables it should become drizzle-kit
 * generated migrations with an applied-migrations table.
 */
const SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS project (
		id text PRIMARY KEY NOT NULL,
		name text NOT NULL,
		created_at integer DEFAULT (unixepoch() * 1000) NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS project_created_at ON project (created_at)`
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
			.then(() => undefined)
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
		error(500, 'the DB binding is not available — add a d1_databases entry named DB');
	}

	await ensureSchema(d1);
	return drizzle(d1, { schema });
}
