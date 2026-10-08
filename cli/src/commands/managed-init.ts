import readline from 'node:readline/promises';
import { loadConfig } from '../lib/config.js';
import { consoleFetch, errorText } from '../lib/console-api.js';
import { blank, bold, dim, info, success, UserError } from '../lib/log.js';
import { writeManagedConfig } from '../lib/managed.js';

/**
 * Bare `cloudflarebase init` - connect the CURRENT directory to a project on a
 * managed console. `init <name>` stays the self-hosted scaffold; the
 * wrangler-style bare form is "initialize cloudflarebase here": pick (or
 * create) a project and write `cloudflarebase.json`, which is what `key`
 * reads to know which project it acts on.
 */

interface Flags {
	project?: string;
}

function parseFlags(rest: string[]): Flags {
	const flags: Flags = {};
	for (let i = 0; i < rest.length; i += 1) {
		const arg = rest[i];
		if (arg === '--project') flags.project = rest[++i];
		else throw new UserError(`Unknown flag "${arg}".`);
	}
	return flags;
}

interface RegistryProject {
	id: string;
	name: string;
	parentId: string | null;
}

export async function managedInitCommand(projectDir: string, rest: string[]): Promise<void> {
	const flags = parseFlags(rest);
	const config = await loadConfig();

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	try {
		// Pick or create the ROOT project; commands take --branch for branches.
		let projectId = flags.project;
		if (!projectId) {
			const response = await consoleFetch(config, '/api/registry/projects');
			if (!response.ok) {
				throw new UserError(`Could not list projects: ${await errorText(response)}`);
			}
			const { projects } = (await response.json()) as { projects: RegistryProject[] };
			const roots = projects.filter((project) => !project.parentId);

			if (roots.length) {
				info('Projects on this console:');
				roots.forEach((project, index) => {
					info(`  ${dim(`${index + 1}.`)} ${bold(project.id)} ${dim(project.name)}`);
				});
				blank();
			}
			const answer = (
				await rl.question('Project (number to pick, or a new id to create): ')
			).trim();
			const picked = roots[Number(answer) - 1];
			if (picked) {
				projectId = picked.id;
			} else if (answer) {
				const created = await consoleFetch(config, '/api/registry/projects', {
					method: 'POST',
					body: JSON.stringify({ id: answer, name: answer })
				});
				if (!created.ok) {
					throw new UserError(`Could not create "${answer}": ${await errorText(created)}`);
				}
				projectId = answer;
				success(`Created project ${bold(answer)}`);
			} else {
				throw new UserError('Which project?', 'Pick a number or type a new project id.');
			}
		}
		if (projectId.includes('--')) {
			throw new UserError(
				'Initialize against the ROOT project - commands take --branch for branches.'
			);
		}

		const file = await writeManagedConfig(projectDir, {
			project: projectId,
			origin: config.origin
		});

		blank();
		success(`Initialized: ${bold(projectId)} on ${config.origin}`);
		info(`  ${dim('·')} ${file} written - commit it.`);
		info(`  ${dim('·')} Next: \`cloudflarebase key create <name> --env-file\` mints a server key.`);
	} finally {
		rl.close();
	}
}
