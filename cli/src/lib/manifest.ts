import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { UserError } from './log.js';

/**
 * The agent manifest: frostbase.agent.json shipped inside every agent
 * package, declaring what the platform must do to host it. This schema is a
 * deliberate copy of the one in the dashboard's `src/lib/agent-registry.ts` -
 * the CLI is its own npm project, same copy rule as the DTO mirrors.
 */
export const agentManifestSchema = z.strictObject({
	manifestVersion: z.literal(1),
	name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
	title: z.string().min(1).max(64),
	description: z.string().min(1).max(256),
	packageName: z.string().min(1),
	worker: z.string().regex(/^[a-z][a-z0-9-]{0,53}$/),
	durableObjects: z
		.array(
			z.strictObject({
				class: z.string().min(1),
				scope: z.enum(['perProject', 'perCollection', 'perTable', 'perBucket', 'perView'])
			})
		)
		.min(1),
	entrypoint: z.strictObject({ assertEnvType: z.string().min(1) }),
	erase: z.strictObject({ method: z.literal('DELETE'), path: z.string().startsWith('/') }),
	claim: z.strictObject({ method: z.literal('PUT'), path: z.string().startsWith('/') }).optional(),
	bindings: z.strictObject({
		ai: z.boolean().optional(),
		sendEmail: z.array(z.string()).optional(),
		analyticsEngine: z
			.array(z.strictObject({ binding: z.string(), dataset: z.string() }))
			.optional(),
		services: z
			.array(
				z.strictObject({
					binding: z.string(),
					service: z.string(),
					optional: z.boolean().optional()
				})
			)
			.optional(),
		r2: z
			.array(
				z.strictObject({
					binding: z.string(),
					bucketName: z.string().optional(),
					optional: z.boolean().optional()
				})
			)
			.optional()
	}),
	secrets: z.strictObject({
		generated: z.array(z.string()),
		optional: z.array(z.string())
	}),
	vars: z.record(
		z.string(),
		z.strictObject({ default: z.string().optional(), hint: z.string().optional() })
	),
	routes: z.array(
		z.strictObject({ path: z.string().startsWith('/'), access: z.enum(['public', 'operator']) })
	),
	proxy: z.strictObject({ apiPrefix: z.string().min(1), agentBasePath: z.string() }),
	permissions: z.array(z.string()),
	// Deliberately NOT strict, unlike every other block: the CLI reads nothing
	// under `console` - it is the dashboard's presentation contract - and an
	// install must never fail because the installed agent package ships a
	// console field this CLI version predates.
	console: z.object({
		section: z.string().min(1),
		icon: z.string().min(1),
		pages: z.array(
			z.object({
				path: z.string().startsWith('/'),
				title: z.string().min(1),
				testId: z.string().min(1),
				icon: z.string().min(1).optional()
			})
		)
	})
});

export type AgentManifest = z.infer<typeof agentManifestSchema>;

/** Reads and validates the manifest from the *installed* package. */
export async function readManifest(
	projectDir: string,
	packageName: string
): Promise<AgentManifest> {
	const manifestPath = path.join(
		projectDir,
		'node_modules',
		...packageName.split('/'),
		'frostbase.agent.json'
	);

	let text: string;
	try {
		text = await readFile(manifestPath, 'utf8');
	} catch {
		throw new UserError(
			`${packageName} is installed but ships no frostbase.agent.json.`,
			'The package may be too old for this CLI - upgrade it and try again.'
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new UserError(`${manifestPath} is not valid JSON.`);
	}

	// Friendly version gate before strict validation: a future manifest should
	// say "upgrade the CLI", not spray schema issues.
	const version = (parsed as { manifestVersion?: unknown } | null)?.manifestVersion;
	if (version !== 1) {
		throw new UserError(
			`${packageName} declares agent manifest version ${String(version)}, which this CLI does not understand.`,
			'Upgrade @frostbase-dev/cli and try again.'
		);
	}

	const result = agentManifestSchema.safeParse(parsed);
	if (!result.success) {
		throw new UserError(
			`${packageName}'s frostbase.agent.json is invalid.`,
			result.error.issues
				.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
				.join('\n')
		);
	}
	return result.data;
}

export interface ExportLines {
	/** Classes + the default fetch handler - for an entrypoint without one. */
	full: string;
	/** Classes only - when a frostbase agent already owns `default`. */
	classOnly: string;
}

/**
 * Derives the entrypoint re-export from the manifest instead of hardcoding it
 * per agent. The type assertion travels with the wiring on purpose: it is
 * what turns a missing binding into a named compile-time error instead of a
 * runtime failure on the first request.
 */
export function deriveExportLines(manifest: AgentManifest): ExportLines {
	const classes = manifest.durableObjects.map((entry) => entry.class).join(', ');
	const assertType = manifest.entrypoint.assertEnvType;
	const alias = `_${assertType.replace(/^Assert/, '').replace(/Env$/, '')}Bindings`;
	const assertLines = [
		`import type { ${assertType} } from '${manifest.packageName}';`,
		`export type ${alias} = ${assertType}<Env>;`
	];
	return {
		full: [`export { ${classes}, default } from '${manifest.packageName}';`, ...assertLines].join(
			'\n'
		),
		classOnly: [`export { ${classes} } from '${manifest.packageName}';`, ...assertLines].join('\n')
	};
}
