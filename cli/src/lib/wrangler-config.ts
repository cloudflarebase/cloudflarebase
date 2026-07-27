import { applyEdits, modify, parse, type FormattingOptions, type ParseError } from 'jsonc-parser';
import { UserError } from './log.js';

/**
 * Merges an agent's `template/wrangler-fragment.jsonc` into the user's own
 * `wrangler.jsonc`.
 *
 * Two rules govern every case below:
 *
 * 1. **Never overwrite a value the user set.** Their compatibility date may be
 *    newer than ours, their dataset name is theirs, and a var they edited is a
 *    decision. Absent keys get filled in; present ones are left alone.
 * 2. **Merge, do not replace, collections.** A Worker can host more than one
 *    agent, so `add db` must not clobber what `add auth` wrote. Entries are
 *    matched on their identifying field and appended only when missing.
 *
 * Edits go through jsonc-parser so comments and formatting in the user's file
 * survive - the fragment is heavily commented, and so is anything they wrote.
 */

export interface WranglerFragment {
	main?: string;
	compatibility_date?: string;
	compatibility_flags?: string[];
	migrations?: Array<{ tag?: string; new_sqlite_classes?: string[]; new_classes?: string[] }>;
	durable_objects?: { bindings?: Array<{ name: string; class_name: string }> };
	analytics_engine_datasets?: Array<{ binding: string; dataset?: string }>;
	ai?: { binding: string };
	send_email?: Array<{ name: string }>;
	vars?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface MergeChange {
	summary: string;
}

export interface MergeResult {
	text: string;
	changes: MergeChange[];
}

/** Reads a JSONC document, refusing to guess at a file it cannot parse. */
export function parseJsonc<T>(text: string, filename: string): T {
	const errors: ParseError[] = [];
	const value = parse(text, errors, { allowTrailingComma: true }) as T;
	if (errors.length > 0) {
		const first = errors[0];
		throw new UserError(
			`${filename} is not valid JSONC (error at offset ${first?.offset ?? 0}).`,
			'Fix the file by hand, then run this again.'
		);
	}
	return value;
}

/**
 * Matches the file's existing indentation so the merge does not reformat lines
 * it never touched. Wrangler's own template uses tabs; plenty of projects do
 * not.
 */
function detectFormatting(text: string): FormattingOptions {
	// Only structural lines count - an indented ` * comment` line would
	// otherwise read as one-space indentation.
	const indented = text.split('\n').find((line) => /^[\t ]+["{[\]}]/.test(line)) ?? '\t"';
	const usesSpaces = indented.startsWith(' ');
	const width = indented.length - indented.trimStart().length;
	return {
		tabSize: usesSpaces ? Math.max(width, 1) : 4,
		insertSpaces: usesSpaces,
		eol: text.includes('\r\n') ? '\r\n' : '\n'
	};
}

/** Next unused `vN` migration tag. */
function nextMigrationTag(existing: WranglerFragment['migrations']): string {
	const highest = (existing ?? []).reduce((max, migration) => {
		const match = /^v(\d+)$/.exec(migration.tag ?? '');
		return match?.[1] ? Math.max(max, Number(match[1])) : max;
	}, 0);
	return `v${highest + 1}`;
}

export function mergeWranglerConfig(text: string, fragment: WranglerFragment): MergeResult {
	const config = parseJsonc<WranglerFragment>(text, 'wrangler.jsonc');
	const formattingOptions = detectFormatting(text);
	const changes: MergeChange[] = [];
	let output = text;

	const edit = (path: (string | number)[], value: unknown, summary: string): void => {
		output = applyEdits(output, modify(output, path, value, { formattingOptions }));
		changes.push({ summary });
	};

	// Scalars: fill in only what is missing.
	if (fragment.main !== undefined && config.main === undefined) {
		edit(['main'], fragment.main, `set main to ${fragment.main}`);
	}
	if (fragment.compatibility_date !== undefined && config.compatibility_date === undefined) {
		edit(
			['compatibility_date'],
			fragment.compatibility_date,
			`set compatibility_date to ${fragment.compatibility_date}`
		);
	}

	// Flags: union. Better Auth needs both of ours; the user may need others.
	for (const flag of fragment.compatibility_flags ?? []) {
		const current =
			parseJsonc<WranglerFragment>(output, 'wrangler.jsonc').compatibility_flags ?? [];
		if (!current.includes(flag)) {
			edit(['compatibility_flags', current.length], flag, `added compatibility flag ${flag}`);
		}
	}

	// Durable Object bindings, matched on binding name.
	for (const binding of fragment.durable_objects?.bindings ?? []) {
		const current =
			parseJsonc<WranglerFragment>(output, 'wrangler.jsonc').durable_objects?.bindings ?? [];
		if (!current.some((existing) => existing.name === binding.name)) {
			edit(
				['durable_objects', 'bindings', current.length],
				binding,
				`bound Durable Object ${binding.class_name} as ${binding.name}`
			);
		}
	}

	/*
	 * Migrations are append-only history, not configuration: a tag that has been
	 * deployed must never change meaning. So the class list decides whether
	 * anything is needed, and a new migration is appended under the next free
	 * tag rather than reusing or editing an existing one.
	 */
	for (const migration of fragment.migrations ?? []) {
		const currentConfig = parseJsonc<WranglerFragment>(output, 'wrangler.jsonc');
		const current = currentConfig.migrations ?? [];
		const registered = new Set(
			current.flatMap((entry) => [
				...(entry.new_sqlite_classes ?? []),
				...(entry.new_classes ?? [])
			])
		);
		const missing = (migration.new_sqlite_classes ?? []).filter(
			(className) => !registered.has(className)
		);
		if (missing.length > 0) {
			const tag = nextMigrationTag(current);
			edit(
				['migrations', current.length],
				{ tag, new_sqlite_classes: missing },
				`added migration ${tag} for ${missing.join(', ')}`
			);
		}
	}

	// Analytics Engine datasets, matched on binding name.
	for (const dataset of fragment.analytics_engine_datasets ?? []) {
		const current =
			parseJsonc<WranglerFragment>(output, 'wrangler.jsonc').analytics_engine_datasets ?? [];
		if (!current.some((existing) => existing.binding === dataset.binding)) {
			edit(
				['analytics_engine_datasets', current.length],
				dataset,
				`bound Analytics Engine dataset ${dataset.binding}`
			);
		}
	}

	// Email bindings, matched on binding name.
	for (const sender of fragment.send_email ?? []) {
		const current = parseJsonc<WranglerFragment>(output, 'wrangler.jsonc').send_email ?? [];
		if (!current.some((existing) => existing.name === sender.name)) {
			edit(['send_email', current.length], sender, `bound email sender ${sender.name}`);
		}
	}

	if (fragment.ai !== undefined && config.ai === undefined) {
		edit(['ai'], fragment.ai, `bound Workers AI as ${fragment.ai.binding}`);
	}

	// Vars: fill in missing keys, never touch a value the user chose.
	for (const [key, value] of Object.entries(fragment.vars ?? {})) {
		const current = parseJsonc<WranglerFragment>(output, 'wrangler.jsonc').vars ?? {};
		if (!(key in current)) {
			edit(['vars', key], value, `set var ${key}`);
		}
	}

	return { text: output, changes };
}

/**
 * Reads `vars.TRUSTED_ORIGINS` so `deploy` can report it. The deployment
 * trusts its own origin automatically; this allowlist only matters for extra
 * origins, so the CLI reports it rather than managing it.
 */
export function readTrustedOrigins(text: string): string {
	const config = parseJsonc<WranglerFragment>(text, 'wrangler.jsonc');
	const value = config.vars?.['TRUSTED_ORIGINS'];
	return typeof value === 'string' ? value : '';
}
