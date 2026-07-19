// Wrangler bundles .sql files as text modules (see "rules" in wrangler.jsonc).
declare module '*.sql' {
	const content: string;
	export default content;
}

// drizzle-kit emits drizzle/migrations.js for the durable-sqlite migrator.
declare module '*drizzle/migrations' {
	const migrations: {
		journal: { entries: { idx: number; when: number; tag: string; breakpoints: boolean }[] };
		migrations: Record<string, string>;
	};
	export default migrations;
}
