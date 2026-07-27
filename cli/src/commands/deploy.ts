import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { blank, dim, info, step, success, UserError, warn } from '../lib/log.js';
import { run, runOrFail } from '../lib/run.js';
import { readTrustedOrigins, setTrustedOrigins } from '../lib/wrangler-config.js';

/**
 * `cloudflarebase deploy` — deploy the Worker and close the TRUSTED_ORIGINS
 * trap.
 *
 * An empty TRUSTED_ORIGINS is the single most common first-run failure: it is
 * the CSRF allowlist, and sign-in from an unlisted origin is refused as a bad
 * credential rather than a configuration error — so people go looking for an
 * auth bug they do not have. The Worker's own URL is not knowable until the
 * first deploy assigns it, so the fix is mechanical: deploy, read the URL
 * back, write it into the allowlist, deploy again. That is exactly the kind
 * of step a human forgets and a tool should own.
 */
export async function deployCommand(projectDir: string): Promise<void> {
	const configPath = path.join(projectDir, 'wrangler.jsonc');
	let configText: string;
	try {
		configText = await readFile(configPath, 'utf8');
	} catch {
		throw new UserError(
			'No wrangler.jsonc found — nothing to deploy.',
			'Run `cloudflarebase init <name>` to scaffold a project.'
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
	const first = await runOrFail('npx', ['wrangler', 'deploy'], {
		cwd: projectDir,
		capture: true,
		failure: 'wrangler deploy failed.'
	});
	process.stdout.write(first.stdout);

	const url = (first.stdout + first.stderr).match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];
	const trusted = readTrustedOrigins(configText);

	if (trusted !== '') {
		blank();
		success(`Deployed. Trusted origins: ${trusted}`);
		return;
	}

	if (!url) {
		blank();
		warn('TRUSTED_ORIGINS is empty and no workers.dev URL was found in the deploy output.');
		info('  Sign-in is refused from origins not on that allowlist — and the failure looks');
		info('  like a bad credential, not a config error. Set it to your Worker or console');
		info(`  origin in wrangler.jsonc, then deploy again.`);
		return;
	}

	step(`Setting TRUSTED_ORIGINS to ${url}`);
	await writeFile(configPath, setTrustedOrigins(configText, url), 'utf8');

	step('Deploying again with the allowlist in place');
	await runOrFail('npx', ['wrangler', 'deploy'], {
		cwd: projectDir,
		capture: true,
		failure: 'The second wrangler deploy failed.'
	});

	blank();
	success(`Deployed to ${url}`);
	info(`  ${dim('·')} TRUSTED_ORIGINS was empty, so it now allows ${url}.`);
	info(`  ${dim('·')} Serving a console from another origin? Add it there too.`);
}
