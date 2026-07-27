#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCommand } from './commands/add.js';
import { deployCommand } from './commands/deploy.js';
import { initCommand } from './commands/init.js';
import { blank, bold, dim, error, info, UserError } from './lib/log.js';

const usage = (): void => {
	info(`${bold('cloudflarebase')} - your backend, on your Cloudflare account`);
	blank();
	info('Usage:');
	info(`  cloudflarebase init <name>    ${dim('scaffold a Worker with the auth agent installed')}`);
	info(`  cloudflarebase add <agent>    ${dim('install an agent into an existing Worker')}`);
	info(`  cloudflarebase deploy         ${dim('deploy, and set TRUSTED_ORIGINS on first run')}`);
	blank();
	info(`Run ${dim('cloudflarebase add')} with no agent to list what is installable.`);
};

async function version(): Promise<string> {
	const packagePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
	const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as { version: string };
	return manifest.version;
}

async function main(): Promise<void> {
	const [command, ...rest] = process.argv.slice(2);
	const cwd = process.cwd();

	switch (command) {
		case 'init':
			await initCommand(cwd, rest);
			return;
		case 'add':
			await addCommand(cwd, rest);
			return;
		case 'deploy':
			await deployCommand(cwd);
			return;
		case '--version':
		case '-v':
			info(await version());
			return;
		case 'help':
		case '--help':
		case '-h':
		case undefined:
			usage();
			return;
		default:
			usage();
			throw new UserError(`Unknown command "${command}".`);
	}
}

main().catch((cause: unknown) => {
	blank();
	if (cause instanceof UserError) {
		error(cause.message);
		if (cause.hint) {
			info(dim(cause.hint));
		}
	} else {
		// A real bug in the CLI: keep the stack, it is ours to fix.
		console.error(cause);
	}
	process.exitCode = 1;
});
