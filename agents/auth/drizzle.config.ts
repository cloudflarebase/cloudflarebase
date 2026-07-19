import { defineConfig } from 'drizzle-kit';

// Durable Object SQLite: drizzle-kit emits an importable migrations bundle
// (./drizzle/migrations.js) that the agent applies at runtime via
// drizzle-orm/durable-sqlite/migrator.
export default defineConfig({
	out: './drizzle',
	schema: './src/db/schema.ts',
	dialect: 'sqlite',
	driver: 'durable-sqlite',
});
