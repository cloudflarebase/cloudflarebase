import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parse as parseJsonc } from 'jsonc-parser';
import { z } from 'zod';
import { loadConfig } from '../lib/config.js';
import { consoleFetch, errorText } from '../lib/console-api.js';
import { blank, bold, dim, error, info, step, success, UserError } from '../lib/log.js';

/**
 * `frostbase schema <generate|apply|drop>` - the schema workflow
 *. The column DSL stays the single source of
 * truth: `apply` speaks it (never SQL - the SQL endpoint refuses DDL), and
 * `generate` derives the drizzle schema from what the project has declared,
 * so the ORM's types cannot drift from the declared truth.
 *
 * Every subcommand takes `--project <id>` and optionally `--branch <name>`:
 * a branch IS `<project>--<branch>`, so targeting one is pure id
 * composition - apply to a branch, test, then apply to main.
 */

// Mirrors projectIdSchema in the console and both agents (48 chars: a branch
// id is `<root>--<branch>`, so the ceiling has to hold both).
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const BRANCH_NAME = /^[a-z0-9][a-z0-9-]{0,15}$/;

/** Mirrors the console's DbTableColumn/DbTableConfig zod (src/lib/agents.ts). */
const columnSchema = z.object({
	name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
	type: z.enum(['text', 'integer', 'real', 'boolean', 'json']),
	nullable: z.boolean().optional(),
	default: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
	unique: z.boolean().optional(),
	index: z.boolean().optional(),
	maxLength: z.number().int().min(0).optional(),
	min: z.number().optional(),
	max: z.number().optional(),
	enum: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
});
const tableConfigSchema = z.object({
	readAccess: z.enum(['public', 'auth', 'owner']),
	writeAccess: z.enum(['public', 'auth', 'owner']),
	readPermission: z.string().nullable().optional(),
	writePermission: z.string().nullable().optional(),
	columns: z.array(columnSchema).min(1),
	replication: z.enum(['off', 'auto']).optional()
});
const schemaFileSchema = z.object({ tables: z.record(z.string(), tableConfigSchema) });

type TableColumn = z.infer<typeof columnSchema>;
type TableConfig = z.infer<typeof tableConfigSchema>;

const SCHEMA_FILE = 'frostbase.schema.jsonc';
/** The pre-rename spelling, still read when the new one is absent. */
const LEGACY_SCHEMA_FILE = 'cloudflarebase.schema.jsonc';

interface Flags {
	project?: string;
	branch?: string;
	file?: string;
	out?: string;
	yes: boolean;
	dsl: boolean;
	positional: string[];
}

function parseFlags(rest: string[]): Flags {
	const flags: Flags = { yes: false, dsl: false, positional: [] };
	for (let i = 0; i < rest.length; i += 1) {
		const arg = rest[i];
		if (arg === undefined) continue;
		if (arg === '--project') flags.project = rest[++i];
		else if (arg === '--branch') flags.branch = rest[++i];
		else if (arg === '--file') flags.file = rest[++i];
		else if (arg === '--out') flags.out = rest[++i];
		else if (arg === '--yes') flags.yes = true;
		else if (arg === '--dsl') flags.dsl = true;
		else if (arg.startsWith('--')) throw new UserError(`Unknown flag "${arg}".`);
		else flags.positional.push(arg);
	}
	return flags;
}

/** `<project>` or `<project>--<branch>` - the branch is id composition. */
function targetProjectId(flags: Flags): string {
	if (!flags.project) {
		throw new UserError('Which project?', 'Pass --project <id> (and optionally --branch <name>).');
	}
	if (!PROJECT_ID.test(flags.project)) {
		throw new UserError(`"${flags.project}" is not a valid project id.`);
	}
	if (!flags.branch) return flags.project;
	if (flags.project.includes('--')) {
		throw new UserError('Pass the ROOT project with --branch - a branch cannot have branches.');
	}
	if (!BRANCH_NAME.test(flags.branch) || flags.branch.includes('--')) {
		throw new UserError(`"${flags.branch}" is not a valid branch name.`);
	}
	const id = `${flags.project}--${flags.branch}`;
	if (!PROJECT_ID.test(id)) {
		throw new UserError('The combined id exceeds 48 characters - use a shorter branch name.');
	}
	return id;
}

// --- generate -------------------------------------------------------------

const DRIZZLE_FACTORY: Record<TableColumn['type'], { fn: string; call: (name: string) => string }> =
	{
		text: { fn: 'text', call: (name) => `text('${name}')` },
		integer: { fn: 'integer', call: (name) => `integer('${name}')` },
		real: { fn: 'real', call: (name) => `real('${name}')` },
		// The physical column types (agents/db table-schema.ts): booleans are
		// INTEGER 0/1, json is serialized TEXT - drizzle's modes match both.
		boolean: { fn: 'integer', call: (name) => `integer('${name}', { mode: 'boolean' })` },
		json: { fn: 'text', call: (name) => `text('${name}', { mode: 'json' })` }
	};

function drizzleTable(
	name: string,
	columns: TableColumn[]
): { code: string; imports: Set<string> } {
	const imports = new Set<string>(['sqliteTable', 'text', 'integer']);
	const lines = [
		`export const ${name} = sqliteTable('${name}', {`,
		`\tid: text('id').primaryKey(),`,
		`\towner: text('owner'),`,
		`\tcreated_at: integer('created_at').notNull(),`,
		`\tupdated_at: integer('updated_at').notNull(),`
	];
	for (const column of columns) {
		const factory = DRIZZLE_FACTORY[column.type];
		imports.add(factory.fn);
		const notNull = column.nullable === true ? '' : '.notNull()';
		lines.push(`\t${column.name}: ${factory.call(column.name)}${notNull},`);
	}
	lines.push('});');
	const typeName = `${name.charAt(0).toUpperCase()}${name.slice(1)}Row`;
	lines.push(`export type ${typeName} = typeof ${name}.$inferSelect;`);
	return { code: lines.join('\n'), imports };
}

async function generate(flags: Flags): Promise<void> {
	const config = await loadConfig();
	const projectId = targetProjectId(flags);

	step(`Reading declared tables from ${projectId}`);
	const response = await consoleFetch(config, `/api/projects/${projectId}/db/overview`);
	if (!response.ok) throw new UserError(`Could not read the schema: ${await errorText(response)}`);
	const overview = (await response.json()) as {
		tables?: ({ name: string; columns: TableColumn[] } & TableConfig)[];
	};
	const tables = overview.tables ?? [];
	if (!tables.length) {
		throw new UserError(
			`Project ${projectId} declares no tables.`,
			'Declare them in the dashboard or with `frostbase schema apply`.'
		);
	}

	const imports = new Set<string>();
	const blocks: string[] = [];
	for (const table of tables) {
		const emitted = drizzleTable(table.name, table.columns);
		for (const name of emitted.imports) imports.add(name);
		blocks.push(emitted.code);
	}
	const header = [
		`// Generated by \`frostbase schema generate\` from project ${projectId}`,
		`// on ${new Date().toISOString()}. DDL stays server-side: change columns with`,
		'// `frostbase schema apply` (or the dashboard) and re-generate. This file',
		'// is for querying through @frostbase-dev/db/drizzle.',
		`import { ${[...imports].sort().join(', ')} } from 'drizzle-orm/sqlite-core';`
	].join('\n');

	const outPath = path.resolve(flags.out ?? 'frostbase.schema.ts');
	await writeFile(outPath, `${header}\n\n${blocks.join('\n\n')}\n`, 'utf8');
	success(`Wrote ${outPath} (${tables.length} table${tables.length === 1 ? '' : 's'})`);

	if (flags.dsl) {
		// The adopt-an-existing-project path: mirror declared state into the
		// DSL file that `apply` consumes.
		const dsl = {
			tables: Object.fromEntries(
				tables.map((table) => [
					table.name,
					{
						readAccess: table.readAccess,
						writeAccess: table.writeAccess,
						...(table.readPermission != null ? { readPermission: table.readPermission } : {}),
						...(table.writePermission != null ? { writePermission: table.writePermission } : {}),
						...(table.replication ? { replication: table.replication } : {}),
						columns: table.columns
					}
				])
			)
		};
		const dslPath = path.resolve(flags.file ?? SCHEMA_FILE);
		await writeFile(dslPath, `${JSON.stringify(dsl, null, '\t')}\n`, 'utf8');
		success(`Wrote ${dslPath}`);
	}
}

// --- apply ----------------------------------------------------------------

async function apply(flags: Flags): Promise<void> {
	const config = await loadConfig();
	const projectId = targetProjectId(flags);
	let filePath = path.resolve(flags.file ?? SCHEMA_FILE);

	let raw: string;
	try {
		raw = await readFile(filePath, 'utf8').catch((cause: unknown) => {
			if (flags.file) throw cause;
			filePath = path.resolve(LEGACY_SCHEMA_FILE);
			return readFile(filePath, 'utf8');
		});
	} catch {
		filePath = path.resolve(flags.file ?? SCHEMA_FILE);
		throw new UserError(
			`No schema file at ${filePath}.`,
			`Write a ${SCHEMA_FILE} (or --file <path>), or start from declared state with \`schema generate --dsl\`.`
		);
	}
	const parsed = schemaFileSchema.safeParse(parseJsonc(raw));
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new UserError(
			`${filePath} is not a valid schema file: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`
		);
	}

	step(`Applying ${Object.keys(parsed.data.tables).length} table(s) to ${projectId}`);
	const failures: string[] = [];
	for (const [name, table] of Object.entries(parsed.data.tables)) {
		const response = await consoleFetch(
			config,
			`/api/projects/${projectId}/db/admin/tables/${encodeURIComponent(name)}`,
			{ method: 'PUT', body: JSON.stringify(table) }
		);
		if (response.ok) {
			success(name);
		} else {
			// The agent's contract does the safety work: destructive diffs are
			// 400 before any DDL, child failures roll back and answer 409.
			error(`${name}: ${await errorText(response)}`);
			failures.push(name);
		}
	}
	if (failures.length) {
		throw new UserError(`${failures.length} table(s) were refused: ${failures.join(', ')}`);
	}
	blank();
	info(
		`  ${dim('·')} Regenerate ORM types with \`frostbase schema generate --project ${flags.project}${flags.branch ? ` --branch ${flags.branch}` : ''}\`.`
	);
}

// --- drop -----------------------------------------------------------------

async function drop(flags: Flags): Promise<void> {
	const config = await loadConfig();
	const projectId = targetProjectId(flags);
	const table = flags.positional[0];
	if (!table) throw new UserError('Which table? `frostbase schema drop <table> --project <id>`');

	if (!flags.yes) {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		const answer = await rl.question(
			`Dropping ${bold(table)} on ${bold(projectId)} deletes its rows. Type the table name to confirm: `
		);
		rl.close();
		if (answer.trim() !== table)
			throw new UserError('Confirmation did not match - nothing dropped.');
	}

	const response = await consoleFetch(
		config,
		`/api/projects/${projectId}/db/admin/tables/${encodeURIComponent(table)}`,
		{ method: 'DELETE' }
	);
	if (!response.ok) throw new UserError(`Could not drop "${table}": ${await errorText(response)}`);
	success(`Dropped ${table} on ${projectId}`);
}

// --- dispatch -------------------------------------------------------------

export async function schemaCommand(rest: string[]): Promise<void> {
	const [subcommand, ...args] = rest;
	const flags = parseFlags(args);
	switch (subcommand) {
		case 'generate':
			return generate(flags);
		case 'apply':
			return apply(flags);
		case 'drop':
			return drop(flags);
		default:
			throw new UserError(
				subcommand ? `Unknown schema subcommand "${subcommand}".` : 'Which schema action?',
				'Use `schema generate`, `schema apply`, or `schema drop <table>` with --project <id> [--branch <name>].'
			);
	}
}
