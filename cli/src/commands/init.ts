import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { addCommand } from './add.js';
import { blank, bold, dim, info, step, success, UserError } from '../lib/log.js';
import { runOrFail } from '../lib/run.js';

/**
 * `cloudflarebase init <name>` - scaffold a Worker and install the auth agent
 * into it.
 *
 * The scaffold is deliberately thin: a name, an empty entrypoint, and dev
 * tooling. Everything that makes it a Cloudflarebase backend - bindings,
 * migrations, compatibility flags, vars - arrives through `add auth` from the
 * agent package's own fragment, so there is exactly one definition of a
 * working configuration and `init` can never drift from it.
 */
export async function initCommand(cwd: string, args: string[]): Promise<void> {
	const name = args[0];
	if (!name) {
		throw new UserError('Usage: cloudflarebase init <name>');
	}
	if (!/^[a-z0-9]([a-z0-9-]{0,52}[a-z0-9])?$/.test(name)) {
		throw new UserError(
			`"${name}" is not a valid Worker name.`,
			'Use lowercase letters, digits, and dashes; start and end with a letter or digit.'
		);
	}

	const projectDir = path.resolve(cwd, name);
	await mkdir(projectDir, { recursive: true });
	if ((await readdir(projectDir)).length > 0) {
		throw new UserError(
			`${name}/ already exists and is not empty.`,
			'Use `cloudflarebase add auth` inside an existing Worker project instead.'
		);
	}

	step(`Creating ${name}/`);
	await mkdir(path.join(projectDir, 'src'), { recursive: true });
	for (const [file, content] of Object.entries(scaffold(name))) {
		await writeFile(path.join(projectDir, file), content, 'utf8');
		info(`  ${dim('·')} ${file}`);
	}

	step('Installing dev tooling');
	await runOrFail('npm', ['install'], {
		cwd: projectDir,
		failure: 'npm install failed.'
	});

	blank();
	await addCommand(projectDir, ['auth']);

	blank();
	success(`${bold(name)} is ready.`);
	info(`  ${dim('cd')} ${name}`);
	info(`  ${dim('npx')} wrangler login   ${dim('(first time only)')}`);
	info(`  ${dim('cloudflarebase')} deploy`);
}

function scaffold(name: string): Record<string, string> {
	return {
		'package.json': `${JSON.stringify(
			{
				name,
				private: true,
				version: '0.0.0',
				type: 'module',
				scripts: {
					deploy: 'cloudflarebase deploy',
					dev: 'wrangler dev',
					'cf-typegen': 'wrangler types'
				},
				devDependencies: {
					typescript: '^5.5.2',
					wrangler: '^4.110.0'
				}
			},
			null,
			'\t'
		)}\n`,

		// `main` and everything else arrive from the agent fragment in `add`.
		'wrangler.jsonc': `/**
 * Wrangler configuration for ${name}.
 * https://developers.cloudflare.com/workers/wrangler/configuration/
 */
{
\t"name": "${name}",
}
`,

		// The entrypoint starts empty; \`add\` prepends each agent's re-export.
		'src/index.ts': `/**
 * ${name} - a Cloudflarebase backend.
 *
 * Agents are wired in by \`cloudflarebase add <agent>\`, which re-exports each
 * agent's Durable Object class and fetch handler above this comment.
 */
`,

		'tsconfig.json': `${JSON.stringify(
			{
				compilerOptions: {
					target: 'es2022',
					lib: ['es2022'],
					module: 'es2022',
					moduleResolution: 'bundler',
					strict: true,
					noEmit: true,
					skipLibCheck: true,
					types: ['./worker-configuration.d.ts']
				},
				include: ['src/**/*', 'worker-configuration.d.ts']
			},
			null,
			'\t'
		)}\n`,

		'.gitignore': `node_modules\n.wrangler\n.dev.vars*\n!.dev.vars.example\n`
	};
}
