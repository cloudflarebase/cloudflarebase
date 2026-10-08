#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCommand } from './commands/add.js';
import { deployCommand } from './commands/deploy.js';
import { initCommand } from './commands/init.js';
import { keyCommand } from './commands/key.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { schemaCommand } from './commands/schema.js';
import { blank, bold, dim, error, info, UserError } from './lib/log.js';

const usage = (): void => {
	info(`${bold('cloudflarebase')} - your backend, on your Cloudflare account`);
	blank();
	info('Usage:');
	info(`  cloudflarebase init <name>    ${dim('scaffold a Worker with the auth agent installed')}`);
	info(
		`  cloudflarebase init           ${dim('connect this directory to a managed console project')}`
	);
	info(`  cloudflarebase add <agent>    ${dim('install an agent into an existing Worker')}`);
	info(`  cloudflarebase deploy         ${dim('deploy this Worker with wrangler')}`);
	info(`  cloudflarebase key <cmd>      ${dim('create | list | revoke a project service key')}`);
	info(
		`  cloudflarebase login <url>    ${dim('authenticate against a console (browser approval)')}`
	);
	info(`  cloudflarebase logout         ${dim('revoke and forget the stored session')}`);
	info(
		`  cloudflarebase schema <cmd>   ${dim('generate | apply | drop, with --project and --branch')}`
	);
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
			await deployCommand(cwd, rest);
			return;
		case 'key':
			await keyCommand(cwd, rest);
			return;
		case 'login':
			await loginCommand(rest);
			return;
		case 'logout':
			await logoutCommand();
			return;
		case 'schema':
			await schemaCommand(rest);
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
