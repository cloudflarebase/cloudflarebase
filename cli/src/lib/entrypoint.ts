import { readFile, writeFile } from 'node:fs/promises';
import { UserError } from './log.js';

/**
 * A Durable Object class must be exported from the Worker's own entrypoint for
 * Wrangler to find it, so wiring an agent in means editing the user's main
 * file. The edit is one line and idempotent: presence of the package name
 * anywhere in the file means the agent is already wired, because any import
 * from the package pulls in the class re-export possibilities and a second
 * `export { default }` would be a syntax error anyway.
 */

export interface EntrypointPatch {
	/** True when the file changed; false when the agent was already wired. */
	changed: boolean;
}

export async function patchEntrypoint(
	entrypointPath: string,
	packageName: string,
	exportLine: string
): Promise<EntrypointPatch> {
	let source: string;
	try {
		source = await readFile(entrypointPath, 'utf8');
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new UserError(
				`The Worker entrypoint ${entrypointPath} does not exist.`,
				'Check the `main` field in wrangler.jsonc, or run `cloudflarebase init` in an empty directory instead.'
			);
		}
		throw cause;
	}

	if (source.includes(packageName)) {
		return { changed: false };
	}

	/*
	 * A Worker can only have one default export. If the user already has one,
	 * re-exporting ours would not compile; they need to route to the agent from
	 * their own fetch handler instead, which is a decision, not a patch.
	 */
	if (/export\s+default|export\s*\{[^}]*\bdefault\b/.test(source)) {
		throw new UserError(
			`${entrypointPath} already has a default export.`,
			`Export the agent class yourself and route to it from your fetch handler:\n` +
				`  ${exportLine.replace(', default', '')}\n` +
				`  // inside fetch: return (await import('agents')).routeAgentRequest(request, env);`
		);
	}

	const eol = source.includes('\r\n') ? '\r\n' : '\n';
	await writeFile(entrypointPath, `${exportLine}${eol}${eol}${source}`, 'utf8');
	return { changed: true };
}
