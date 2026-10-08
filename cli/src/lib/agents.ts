import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { UserError } from './log.js';
import { parseJsonc, type WranglerFragment } from './wrangler-config.js';

/**
 * The registry of installable agents. Adding a primitive here is all the CLI
 * work a new agent needs: everything else - the wrangler fragment, the
 * entrypoint line, the binding contract - ships inside that agent's own npm
 * package under `template/`, so the CLI never hard-codes knowledge that
 * belongs to the agent.
 */

export interface AgentSpec {
	/** npm package installed into the user's project. */
	packageName: string;
	/** One-line description for `cloudflarebase add` with no arguments. */
	description: string;
}

/**
 * Everything beyond the package name - Durable Object classes, the entrypoint
 * export lines, the binding contract - comes from the package's own
 * cloudflarebase.agent.json at add time (see manifest.ts), so a registry
 * entry is genuinely just a name.
 */
export const AGENTS: Record<string, AgentSpec> = {
	auth: {
		packageName: '@cloudflarebase/auth',
		description: 'Better Auth on a Durable Object - one isolated instance per project'
	},
	db: {
		packageName: '@cloudflarebase/db',
		description: 'Firestore-style documents with live queries - one Durable Object per collection'
	},
	storage: {
		packageName: '@cloudflarebase/storage',
		description: 'Object storage on R2 - buckets of files with per-bucket access modes'
	}
};

/**
 * What `npm install` is actually given. Normally the package name, resolving
 * to the latest release; `CLOUDFLAREBASE_<AGENT>_SPEC` overrides it for
 * pinning a prerelease - or, in this repository's own e2e tests, a packed
 * tarball that has never been published.
 */
export function installSpec(agentName: string, spec: AgentSpec): string {
	return process.env[`CLOUDFLAREBASE_${agentName.toUpperCase()}_SPEC`] ?? spec.packageName;
}

export function resolveAgent(name: string): AgentSpec {
	const spec = AGENTS[name];
	if (!spec) {
		const known = Object.keys(AGENTS)
			.map((key) => `  ${key}  ${AGENTS[key]?.description ?? ''}`)
			.join('\n');
		throw new UserError(`Unknown agent "${name}".`, `Available agents:\n${known}`);
	}
	return spec;
}

/**
 * Reads the wrangler fragment out of the *installed* package rather than
 * bundling a copy in the CLI. The fragment is versioned with the agent - a new
 * binding lands in the same release that starts reading it, and a CLI from
 * last month still installs it correctly.
 */
export async function readFragment(
	projectDir: string,
	spec: AgentSpec
): Promise<{ fragment: WranglerFragment; fragmentPath: string }> {
	const fragmentPath = path.join(
		projectDir,
		'node_modules',
		...spec.packageName.split('/'),
		'template',
		'wrangler-fragment.jsonc'
	);
	try {
		await access(fragmentPath);
	} catch {
		throw new UserError(
			`${spec.packageName} is installed but ships no template/wrangler-fragment.jsonc.`,
			'The package may be too old for this CLI - upgrade it and try again.'
		);
	}
	const text = await readFile(fragmentPath, 'utf8');
	return { fragment: parseJsonc<WranglerFragment>(text, fragmentPath), fragmentPath };
}
