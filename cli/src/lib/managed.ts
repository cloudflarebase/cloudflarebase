import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { UserError } from './log.js';

/**
 * Managed projects: `frostbase.json` links a directory to a project on a
 * console, so commands that act on that project (`key`) know which one and
 * where without flags on every call. Written by bare `frostbase init`.
 */

export const MANAGED_FILE = 'frostbase.json';
/** The pre-rename spelling, still read when the new one is absent. */
const LEGACY_MANAGED_FILE = 'cloudflarebase.json';

// Mirrors projectIdSchema in the console and the agents (48 chars: a branch
// id is `<root>--<branch>`, so the ceiling has to hold both).
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

export interface ManagedConfig {
	/** The ROOT project id; commands take `--branch` to target a branch. */
	project: string;
	origin: string;
}

export async function readManagedConfig(projectDir: string): Promise<ManagedConfig | null> {
	let raw: string | null = null;
	for (const name of [MANAGED_FILE, LEGACY_MANAGED_FILE]) {
		raw = await readFile(path.join(projectDir, name), 'utf8').catch(() => null);
		if (raw !== null) break;
	}
	if (raw === null) return null;
	// Files written while managed hosting existed also carry `app`, `vars`,
	// and `assets`; those are ignored rather than refused.
	const parsed = JSON.parse(raw) as Partial<ManagedConfig>;
	if (
		typeof parsed.project !== 'string' ||
		typeof parsed.origin !== 'string' ||
		!PROJECT_ID.test(parsed.project)
	) {
		throw new UserError(
			`${MANAGED_FILE} is malformed.`,
			'Run `frostbase init` again to reconnect this directory.'
		);
	}
	const origin = new URL(parsed.origin).origin;
	// The hosted console moved domains; follow it rather than strand the link.
	return {
		project: parsed.project,
		origin: /^https:\/\/(www\.)?cloudflarebase\.com$/.test(origin)
			? 'https://frostbase.dev'
			: origin
	};
}

export async function writeManagedConfig(
	projectDir: string,
	config: ManagedConfig
): Promise<string> {
	const file = path.join(projectDir, MANAGED_FILE);
	await writeFile(file, `${JSON.stringify(config, null, '\t')}\n`, 'utf8');
	return file;
}

/** Authenticated fetch against a project surface on the linked console. */
export async function projectFetch(
	origin: string,
	token: string,
	route: string,
	init: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<Response> {
	return fetch(`${origin}${route}`, {
		method: init.method ?? 'GET',
		headers: {
			authorization: `Bearer ${token}`,
			origin,
			...(init.headers ?? {})
		},
		body: init.body
	}).catch((cause: unknown) => {
		throw new UserError(
			`Could not reach ${origin}.`,
			cause instanceof Error ? cause.message : undefined
		);
	});
}

/** Composes the target project id, honouring the 48-char ceiling. */
export function targetProjectId(root: string, branch: string | null): string {
	if (!PROJECT_ID.test(root) || root.includes('--')) {
		throw new UserError(`"${root}" is not a valid root project id.`);
	}
	if (!branch) return root;
	if (branch === 'main') return root; // main aliases the root everywhere
	const id = `${root}--${branch}`;
	if (!PROJECT_ID.test(id)) {
		throw new UserError(
			'The combined project id exceeds 48 characters - use a shorter branch name.'
		);
	}
	return id;
}
