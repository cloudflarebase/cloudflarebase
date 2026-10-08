import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { blank, dim, info, step, success, UserError } from '../lib/log.js';
import { run, runOrFail } from '../lib/run.js';
import { readTrustedOrigins } from '../lib/wrangler-config.js';

/**
 * `frostbase deploy` - deploy this Worker with wrangler. There is nothing
 * to configure before sign-in works: the agent trusts the deployment's own
 * origin automatically, so a fresh deploy is usable the moment the URL exists.
 */
export async function deployCommand(projectDir: string, rest: string[] = []): Promise<void> {
	if (rest.length) throw new UserError(`Unknown flag "${rest[0]}".`);
	const configPath = path.join(projectDir, 'wrangler.jsonc');
	let configText: string;
	try {
		configText = await readFile(configPath, 'utf8');
	} catch {
		throw new UserError(
			'No wrangler.jsonc found - nothing to deploy.',
			'Run `frostbase init <name>` to scaffold a project.'
		);
	}

	// Fail on missing auth before deploying, not mid-flight with piped output.
	const whoami = await run('npx', ['wrangler', 'whoami'], { cwd: projectDir, capture: true });
	if (whoami.code !== 0 || /not authenticated/i.test(whoami.stdout + whoami.stderr)) {
		throw new UserError(
			'Wrangler is not signed in to a Cloudflare account.',
			'Run `npx wrangler login` (or set CLOUDFLARE_API_TOKEN), then deploy again.'
		);
	}

	step('Deploying');
	const result = await runOrFail('npx', ['wrangler', 'deploy'], {
		cwd: projectDir,
		capture: true,
		failure: 'wrangler deploy failed.'
	});
	process.stdout.write(result.stdout);

	const url = (result.stdout + result.stderr).match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];
	const trusted = readTrustedOrigins(configText);

	blank();
	success(url ? `Deployed to ${url}` : 'Deployed.');
	info(`  ${dim('·')} Sign-in works from the deployed URL right away; it trusts its own origin.`);
	if (trusted !== '') {
		info(`  ${dim('·')} Extra trusted origins: ${trusted}`);
	} else {
		info(
			`  ${dim('·')} Serving the UI from another domain? Add it to TRUSTED_ORIGINS in wrangler.jsonc.`
		);
	}
}
