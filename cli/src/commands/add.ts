import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { installSpec, readFragment, resolveAgent, AGENTS } from '../lib/agents.js';
import { patchEntrypoint } from '../lib/entrypoint.js';
import { blank, dim, info, step, success, UserError, warn } from '../lib/log.js';
import { assertSafeArg, run, runOrFail } from '../lib/run.js';
import { mergeWranglerConfig, parseJsonc, type WranglerFragment } from '../lib/wrangler-config.js';

/**
 * `cloudflarebase add <agent>` — install an agent into an existing Worker.
 *
 * Four steps, in dependency order, each idempotent so a failed run can simply
 * be re-run: install the package, merge its wrangler fragment, wire the
 * entrypoint, regenerate types. Idempotence is what makes `init` free to call
 * this and what makes "it failed halfway" a non-event.
 */
export async function addCommand(projectDir: string, args: string[]): Promise<void> {
	const agentName = args[0];
	if (!agentName) {
		info('Available agents:');
		for (const [key, spec] of Object.entries(AGENTS)) {
			info(`  ${key.padEnd(8)} ${dim(spec.description)}`);
		}
		blank();
		info('Usage: cloudflarebase add <agent>');
		return;
	}

	const spec = resolveAgent(agentName);
	const configPath = await findWranglerConfig(projectDir);

	const packageSpec = installSpec(agentName, spec);
	step(`Installing ${packageSpec}`);
	await runOrFail('npm', ['install', assertSafeArg(packageSpec, 'package spec')], {
		cwd: projectDir,
		failure: `npm install ${packageSpec} failed.`
	});

	step('Merging wrangler configuration');
	const { fragment } = await readFragment(projectDir, spec);
	const configText = await readFile(configPath, 'utf8');
	const merged = mergeWranglerConfig(configText, fragment);
	if (merged.changes.length > 0) {
		await writeFile(configPath, merged.text, 'utf8');
		for (const change of merged.changes) {
			info(`  ${dim('·')} ${change.summary}`);
		}
	} else {
		info(`  ${dim('· already configured')}`);
	}

	step('Wiring the Worker entrypoint');
	const mainField = parseJsonc<WranglerFragment>(merged.text, configPath).main;
	if (typeof mainField !== 'string') {
		throw new UserError(
			`${path.basename(configPath)} has no \`main\` field.`,
			'Point it at your Worker entrypoint, then re-run this command.'
		);
	}
	const patched = await patchEntrypoint(
		path.resolve(projectDir, mainField),
		spec.packageName,
		spec.exportLine
	);
	info(
		`  ${dim(patched.changed ? `· exported ${agentName} agent from ${mainField}` : '· already wired')}`
	);

	step('Regenerating Worker types');
	const typegen = await run('npx', ['wrangler', 'types'], { cwd: projectDir, capture: true });
	if (typegen.code !== 0) {
		// Types are a developer convenience, not a deploy prerequisite.
		warn('`wrangler types` failed — run it yourself before relying on Env.');
	}

	blank();
	success(`${spec.packageName} is installed.`);
	info(`  Deploy with ${dim('cloudflarebase deploy')} — it will set TRUSTED_ORIGINS for you.`);
}

/**
 * `wrangler.jsonc` is what `init` writes and what the fragment format is
 * designed for; plain `.json` parses as JSONC, so it works too. TOML is
 * declined honestly rather than half-supported: a comment-destroying rewrite
 * of a config file is worse than asking the user to migrate.
 */
async function findWranglerConfig(projectDir: string): Promise<string> {
	for (const name of ['wrangler.jsonc', 'wrangler.json']) {
		const candidate = path.join(projectDir, name);
		try {
			await readFile(candidate, 'utf8');
			return candidate;
		} catch {
			// keep looking
		}
	}
	try {
		await readFile(path.join(projectDir, 'wrangler.toml'), 'utf8');
		throw new UserError(
			'This project uses wrangler.toml, which this CLI does not edit.',
			'Convert it to wrangler.jsonc (same keys, JSONC syntax), or merge node_modules/' +
				'@cloudflarebase/auth/template/wrangler-fragment.jsonc into it by hand.'
		);
	} catch (cause) {
		if (cause instanceof UserError) throw cause;
	}
	throw new UserError(
		'No wrangler.jsonc found — this does not look like a Worker project.',
		'Run `cloudflarebase init <name>` to scaffold one.'
	);
}
