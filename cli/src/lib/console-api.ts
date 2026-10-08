import type { CliConfig } from './config.js';
import { UserError } from './log.js';

/**
 * Authenticated JSON fetch against a console. The bearer token is the
 * operator session token - the auth agent accepts it anywhere the session
 * cookie works, so the console's operator surface needs no CLI-specific
 * routes beyond `/api/cli/token`.
 */
export async function consoleFetch(
	config: CliConfig,
	route: string,
	init: { method?: string; body?: string } = {}
): Promise<Response> {
	const response = await fetch(`${config.origin}${route}`, {
		method: init.method ?? 'GET',
		headers: {
			authorization: `Bearer ${config.token}`,
			origin: config.origin,
			...(init.body !== undefined ? { 'content-type': 'application/json' } : {})
		},
		body: init.body
	}).catch((cause: unknown) => {
		throw new UserError(
			`Could not reach ${config.origin}.`,
			cause instanceof Error ? cause.message : undefined
		);
	});

	if (response.status === 401) {
		throw new UserError(
			'The stored session is no longer valid.',
			'Run `frostbase login` again (or check the sessions list in the console).'
		);
	}
	return response;
}

/** The server's `{ error }` body when present, else the status line. */
export async function errorText(response: Response): Promise<string> {
	const body = (await response.json().catch(() => null)) as { error?: string } | null;
	return body?.error ?? `the console responded ${response.status}`;
}
