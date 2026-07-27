import { spawn } from 'node:child_process';
import { UserError } from './log.js';

export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface RunOptions {
	cwd: string;
	/** Capture output instead of streaming it. Needed to read a deployed URL back. */
	capture?: boolean;
	env?: NodeJS.ProcessEnv;
}

/**
 * Node refuses to spawn `.cmd` shims without a shell (CVE-2024-27980), and on
 * Windows `npm` and `npx` are exactly that. So Windows needs `shell: true`,
 * which in turn means every argument reaching this function must already be
 * trusted - see `assertSafeArg`.
 */
const isWindows = process.platform === 'win32';

const SAFE_ARG = /^[A-Za-z0-9@/._:=+-]+$/;

/**
 * Arguments are built by this CLI, but some carry user input - a package name,
 * a project directory. On Windows they are handed to a shell, so anything
 * outside a conservative allowlist is refused rather than quoted and hoped for.
 */
export function assertSafeArg(value: string, what: string): string {
	if (!SAFE_ARG.test(value)) {
		throw new UserError(
			`Refusing to run a command with an unsafe ${what}: ${JSON.stringify(value)}`,
			'Use only letters, digits, and @ / . _ : = + -'
		);
	}
	return value;
}

export function run(command: string, args: string[], options: RunOptions): Promise<RunResult> {
	const binary = isWindows && (command === 'npm' || command === 'npx') ? `${command}.cmd` : command;

	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			shell: isWindows,
			stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
		});

		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
		child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

		child.on('error', (cause: NodeJS.ErrnoException) => {
			if (cause.code === 'ENOENT') {
				reject(new UserError(`\`${command}\` was not found on your PATH.`));
				return;
			}
			reject(cause);
		});

		child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
	});
}

/** Runs a command and fails the CLI if it does not exit cleanly. */
export async function runOrFail(
	command: string,
	args: string[],
	options: RunOptions & { failure: string }
): Promise<RunResult> {
	const result = await run(command, args, options);
	if (result.code !== 0) {
		throw new UserError(
			options.failure,
			result.stderr.trim().split('\n').slice(-3).join('\n') || undefined
		);
	}
	return result;
}
