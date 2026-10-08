import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../lib/config.js';
import { blank, bold, dim, info, success, UserError, warn } from '../lib/log.js';
import { projectFetch, readManagedConfig, targetProjectId } from '../lib/managed.js';

/**
 * `frostbase key create|list|revoke` - project service keys.
 *
 * The credential a SERVER holds when there is no signed-in user to relay. The
 * console can mint one too; this exists so the whole loop - link a directory,
 * mint a key, write it into `.env.local` - never leaves the terminal.
 *
 * OPERATOR SESSIONS ONLY, by the guard: a service key cannot mint or revoke
 * service keys, or it could grow and outlive itself. So this command needs
 * `frostbase login`, exactly like `secret put`.
 *
 * Keys are scoped to ONE project - never a root and its branches - because
 * for data the branch IS the isolation boundary.
 * `--branch` therefore targets a specific registry row rather than a family.
 */

const ENV_VAR = 'FROSTBASE_SERVICE_KEY';

interface KeySummary {
	id: string;
	name: string;
	createdAt: string;
	lastUsedAt: string | null;
}

function usage(): never {
	throw new UserError(
		'Usage: frostbase key create <name> [--env-file [path]] [--branch <name>]\n' +
			'       frostbase key list [--branch <name>]\n' +
			'       frostbase key revoke <id> [--branch <name>]'
	);
}

/** Upsert `FROSTBASE_SERVICE_KEY=` into a dotenv file, replacing any
 * existing line rather than appending a second one that the last read wins. */
async function writeEnvFile(file: string, secret: string): Promise<'created' | 'updated'> {
	const existing = await readFile(file, 'utf8').catch(() => null);
	const line = `${ENV_VAR}=${secret}`;
	if (existing === null) {
		await writeFile(file, `${line}\n`, 'utf8');
		return 'created';
	}
	const pattern = new RegExp(`^${ENV_VAR}=.*$`, 'm');
	const next = pattern.test(existing)
		? existing.replace(pattern, line)
		: `${existing.replace(/\n*$/, '\n')}${line}\n`;
	await writeFile(file, next, 'utf8');
	return 'updated';
}

export async function keyCommand(projectDir: string, rest: string[]): Promise<void> {
	const [subcommand, ...args] = rest;
	if (!subcommand || !['create', 'list', 'revoke'].includes(subcommand)) usage();

	const positional: string[] = [];
	let branchFlag: string | undefined;
	let envFile: string | undefined;
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === undefined) continue;
		if (arg === '--branch') branchFlag = args[++i];
		else if (arg === '--env-file') {
			// Optional value: a bare `--env-file` means `.env.local`.
			const next = args[i + 1];
			envFile = next !== undefined && !next.startsWith('--') ? args[++i] : '.env.local';
		} else if (arg.startsWith('--')) throw new UserError(`Unknown flag "${arg}".`);
		else positional.push(arg);
	}

	const managed = await readManagedConfig(projectDir);
	if (!managed) {
		throw new UserError('This directory is not initialized.', 'Run `frostbase init` first.');
	}
	const config = await loadConfig();
	if (config.origin !== managed.origin) {
		throw new UserError(
			`This directory is linked to ${managed.origin}, but you are signed in to ${config.origin}.`,
			`Run \`frostbase login ${managed.origin}\` first.`
		);
	}

	// No git-branch inference here, deliberately: a key is a credential you
	// paste somewhere and keep, so it targets the root unless you say otherwise.
	const target = targetProjectId(managed.project, branchFlag ?? null);
	const route = `/api/projects/${target}/keys`;

	if (subcommand === 'list') {
		const response = await projectFetch(managed.origin, config.token, route);
		if (!response.ok) throw await failure(response, 'Listing service keys failed');
		const { keys } = (await response.json()) as { keys: KeySummary[] };
		blank();
		if (!keys.length) {
			info(`No service keys on ${bold(target)}.`);
			info(dim('Create one with `frostbase key create <name>`.'));
			return;
		}
		info(`Service keys on ${bold(target)}:`);
		for (const entry of keys) {
			const used = entry.lastUsedAt ? `last used ${entry.lastUsedAt}` : 'never used';
			info(`  ${bold(entry.name)}  ${dim(entry.id)}  ${dim(used)}`);
		}
		return;
	}

	if (subcommand === 'revoke') {
		const [id] = positional;
		if (!id) usage();
		const response = await projectFetch(managed.origin, config.token, `${route}/${id}`, {
			method: 'DELETE'
		});
		if (!response.ok) throw await failure(response, 'Revoking the service key failed');
		blank();
		success(`Service key ${bold(id)} revoked. It stops working immediately.`);
		return;
	}

	const [name] = positional;
	if (!name) usage();

	const response = await projectFetch(managed.origin, config.token, route, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name })
	});
	if (!response.ok) throw await failure(response, 'Creating the service key failed');
	const created = (await response.json()) as { id: string; key: string };

	blank();
	success(`Service key ${bold(name)} created on ${bold(target)}.`);

	if (envFile) {
		const file = path.resolve(projectDir, envFile);
		const outcome = await writeEnvFile(file, created.key);
		info(`${outcome === 'created' ? 'Wrote' : 'Updated'} ${bold(envFile)} (${ENV_VAR}).`);
		blank();
		warn('Make sure that file is git-ignored - this key is admin-grade on the project.');
	} else {
		blank();
		info(`${ENV_VAR}=${created.key}`);
		blank();
		warn('Shown once. Nothing can recover it - only its digest is stored.');
	}

	blank();
	info(dim('Server-side only. Any request carrying an Origin header is refused,'));
	info(dim('so this key cannot be used from browser code.'));
}

async function failure(response: Response, prefix: string): Promise<UserError> {
	const body = (await response.json().catch(() => null)) as { error?: string } | null;
	return new UserError(`${prefix}: ${body?.error ?? `the console responded ${response.status}`}`);
}
