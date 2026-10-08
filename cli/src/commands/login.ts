import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { saveConfig } from '../lib/config.js';
import { blank, bold, dim, info, step, success, UserError } from '../lib/log.js';

/**
 * `frostbase login <console-url>` - authenticate the CLI against a
 * console.
 *
 * Default is the wrangler-style browser hand-off: the CLI listens on a
 * localhost port with a one-time code and opens `<origin>/cli-auth`; the
 * signed-in operator approves, and the page form-POSTs the session token to
 * the listener (top-level navigations are exempt from CORS, so the listener
 * stays trivially simple). `--email`/`--password` drive the public console
 * sign-in surface directly for headless use; social-only operators use the
 * browser flow.
 */

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function normalizeOrigin(raw: string): string {
	const candidate = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
	try {
		return new URL(candidate).origin;
	} catch {
		throw new UserError(`"${raw}" is not a valid console URL.`);
	}
}

/** Best effort - the URL is printed either way. */
function openBrowser(url: string): void {
	const [command, args]: [string, string[]] =
		process.platform === 'win32'
			? ['cmd', ['/c', 'start', '', url]]
			: process.platform === 'darwin'
				? ['open', [url]]
				: ['xdg-open', [url]];
	try {
		const child = spawn(command, args, { stdio: 'ignore', detached: true });
		child.on('error', () => {});
		child.unref();
	} catch {
		/* the printed URL is the fallback */
	}
}

async function passwordLogin(origin: string, email: string, password: string): Promise<string> {
	const response = await fetch(`${origin}/api/projects/console/auth/sign-in/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin },
		body: JSON.stringify({ email, password })
	}).catch((cause: unknown) => {
		throw new UserError(
			`Could not reach ${origin}.`,
			cause instanceof Error ? cause.message : undefined
		);
	});
	if (!response.ok) {
		throw new UserError(
			'Sign-in failed.',
			'Check the email and password. Social-only operators should omit --email and use the browser flow.'
		);
	}
	const token = response.headers.get('set-auth-token');
	if (!token) throw new UserError('The console did not return a session token.');
	return token;
}

function browserLogin(origin: string): Promise<string> {
	const code = randomUUID();
	return new Promise<string>((resolvePromise, rejectPromise) => {
		const server = createServer((request, response) => {
			if (request.method !== 'POST') {
				response.writeHead(404).end();
				return;
			}
			let body = '';
			request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
			request.on('end', () => {
				const params = new URLSearchParams(body);
				const token = params.get('token');
				if (params.get('code') !== code || !token) {
					response
						.writeHead(403, { 'content-type': 'text/html' })
						.end(
							'<p style="font-family:system-ui">Stale login attempt - run the command again.</p>'
						);
					return;
				}
				response
					.writeHead(200, { 'content-type': 'text/html' })
					.end(
						'<p style="font-family:system-ui">Signed in - close this tab and return to the terminal.</p>'
					);
				clearTimeout(timer);
				server.close();
				resolvePromise(token);
			});
		});
		const timer = setTimeout(() => {
			server.close();
			rejectPromise(new UserError('Timed out waiting for the browser approval.'));
		}, LOGIN_TIMEOUT_MS);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			const url = `${origin}/cli-auth?port=${port}&code=${code}`;
			step('Approve CLI access in the browser:');
			info(`  ${dim(url)}`);
			openBrowser(url);
		});
	});
}

async function whoAmI(origin: string, token: string): Promise<string | null> {
	const response = await fetch(`${origin}/api/projects/console/auth/get-session`, {
		headers: { authorization: `Bearer ${token}`, origin }
	}).catch(() => null);
	if (!response?.ok) return null;
	const body = (await response.json().catch(() => null)) as { user?: { email?: string } } | null;
	return body?.user?.email ?? null;
}

export async function loginCommand(rest: string[]): Promise<void> {
	let originArg: string | undefined;
	let email: string | undefined;
	let password: string | undefined;
	for (let i = 0; i < rest.length; i += 1) {
		const arg = rest[i];
		if (arg === undefined) continue;
		if (arg === '--email') email = rest[++i];
		else if (arg === '--password') password = rest[++i];
		else if (!arg.startsWith('--')) originArg = arg;
		else throw new UserError(`Unknown flag "${arg}".`);
	}
	if (!originArg) {
		throw new UserError('Which console?', 'Example: frostbase login https://console.example.com');
	}
	const origin = normalizeOrigin(originArg);
	if ((email && !password) || (!email && password)) {
		throw new UserError('--email and --password go together.');
	}

	const token =
		email && password ? await passwordLogin(origin, email, password) : await browserLogin(origin);

	// Verify before storing: a token that cannot answer get-session would only
	// fail later with a vaguer error.
	const who = await whoAmI(origin, token);
	if (!who) throw new UserError('The received token did not verify against the console.');

	const file = await saveConfig({ origin, token });
	blank();
	success(`Signed in to ${origin} as ${bold(who)}`);
	info(
		`  ${dim('·')} Session stored in ${file}; revoke it any time from the console's sessions list.`
	);
}
