import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Control-plane schema, held in D1 on the dashboard Worker.
 *
 * This is deliberately not in an agent. The registry lists projects, and a
 * project will eventually have a db agent and a storage agent as well as auth
 * — so no single agent can own it without every other agent depending on that
 * one. D1 binds directly to the dashboard, which is the control plane, and
 * needs no Durable Object (the SvelteKit adapter cannot export one anyway).
 */
export const project = sqliteTable(
	'project',
	{
		/** Becomes the Durable Object name and the API base path. Immutable. */
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`)
	},
	(table) => [index('project_created_at').on(table.createdAt)]
);

export type ProjectRow = typeof project.$inferSelect;
