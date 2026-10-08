import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UserError } from './log.js';

/**
 * Where `frostbase login` parks the console origin and the operator
 * session token. The token is an ordinary console session - visible in the
 * console's sessions list and revocable there - so the file holds nothing a
 * sign-out cannot invalidate.
 */

export interface CliConfig {
	origin: string;
	token: string;
}

const configDir = (): string => path.join(os.homedir(), '.frostbase');
export const configPath = (): string => path.join(configDir(), 'config.json');
/** Where logins lived before the Frostbase rename - read, never written. */
const legacyConfigPath = (): string => path.join(os.homedir(), '.cloudflarebase', 'config.json');

/** The hosted console moved domains; a session token is host-independent. */
function migrateOrigin(origin: string): string {
	return /^https:\/\/(www\.)?cloudflarebase\.com$/.test(origin) ? 'https://frostbase.dev' : origin;
}

export async function saveConfig(config: CliConfig): Promise<string> {
	await mkdir(configDir(), { recursive: true });
	const file = configPath();
	await writeFile(file, `${JSON.stringify(config, null, '\t')}\n`, 'utf8');
	// Best effort: POSIX perms tighten the file; Windows ACLs differ and a
	// failure here must not fail the login.
	try {
		await chmod(file, 0o600);
	} catch {
		/* ignore */
	}
	return file;
}

export async function loadConfig(): Promise<CliConfig> {
	for (const file of [configPath(), legacyConfigPath()]) {
		try {
			const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<CliConfig>;
			if (typeof raw.origin === 'string' && typeof raw.token === 'string') {
				return { origin: migrateOrigin(raw.origin), token: raw.token };
			}
		} catch {
			/* try the next file, then fall through to the error below */
		}
	}
	throw new UserError('Not signed in to a console.', 'Run `frostbase login <console-url>` first.');
}

export async function deleteConfig(): Promise<void> {
	await rm(configPath(), { force: true });
	await rm(legacyConfigPath(), { force: true });
}
