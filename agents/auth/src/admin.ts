/**
 * The ADMIN client for `@frostbase/auth` - user and session management
 * from a server.
 *
 * The twin of `@frostbase/db/admin`, and the same three properties hold:
 * it targets the CONSOLE (a `cfbs_` service key is verified in the console
 * guard and never reaches this agent as a bearer), it is admin-grade, and it
 * is server-only.
 *
 * This package ships no browser client on purpose - Better Auth's own
 * `better-auth/client` is that, and wrapping it would add a layer with nothing
 * in it. The admin surface is different: it is this agent's own `/admin/*`
 * routes, which nothing else describes.
 *
 * Deliberately NOT here: anything that mints a credential. A service key
 * cannot create sessions or issue project JWTs, and this client does not
 * pretend otherwise.
 */

export interface AuthAdminOptions {
	/** The console origin - e.g. `https://frostbase.dev`.
	 * Falls back to `FROSTBASE_URL` / `CLOUDFLAREBASE_URL`. */
	url?: string;
	/** Falls back to `FROSTBASE_PROJECT` / `CLOUDFLAREBASE_PROJECT`. */
	projectId?: string;
	/** A service key (`fsb_`, or a legacy `cfbs_`). Falls back to `FROSTBASE_SERVICE_KEY` /
	 * `CLOUDFLAREBASE_SERVICE_KEY`. */
	key?: string;
	fetch?: typeof fetch;
	/** Explicit environment, for Workers - where secrets arrive on `env`. */
	env?: Record<string, string | undefined>;
}

export class AuthAdminError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = 'AuthAdminError';
	}
}

/** A 404 from a route the DEPLOYED agent lacks, told apart from the agent's
 * own entity misses (`user not found`, `session not found`, the guard's
 * `no such project`). Conflating them is data-loss-shaped: a caller that
 * reads "not found" and then writes overwrites a record that exists. The
 * agent's ROUTING fallback body is a bare `not found`, which is exactly what
 * an older agent answers on these routes - so a bare `not found` must map
 * HERE, never to "missing record". */
export class AuthAgentTooOldError extends Error {
	constructor(path: string) {
		super(
			`the auth agent did not recognise ${path}. Deploy @frostbase/auth 0.7.0 or newer ` +
				`before calling this - an older agent answers a 404 that looks like a missing user.`,
		);
		this.name = 'AuthAgentTooOldError';
	}
}

export interface AdminUser {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	isAnonymous: boolean;
	role: string;
	providers: string[];
	createdAt: string;
}

function assertServerOnly(): void {
	// `document` on globalThis: this package builds against the Workers types,
	// which declare no DOM, and a Worker has no document either.
	if (typeof (globalThis as { document?: unknown }).document !== 'undefined') {
		throw new Error(
			'@frostbase/auth/admin is server-only: it carries a service key, which can read and ' +
				'delete every account in your project. Never import it into browser code. Use ' +
				'better-auth/client with the signed-in user’s own session instead.',
		);
	}
}

/** Most-explicit-first, the CLI's rule. `FROSTBASE_*` is canonical; the
 * `CLOUDFLAREBASE_*` and `CFBASE_*` spellings from before the rename are still
 * read so existing deployments keep working. */
function resolve(
	options: AuthAdminOptions,
	explicit: string | undefined,
	names: string[],
	label: string,
): string {
	if (explicit) return explicit;
	const ambient = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
		?.env;
	for (const name of names) {
		const value = options.env?.[name] ?? ambient?.[name];
		if (value) return value;
	}
	throw new Error(
		`@frostbase/auth/admin needs ${label}: pass it explicitly, or set ${names.join(' or ')}. ` +
			`Inside a Worker, secrets live on \`env\` rather than a global process - pass \`{ env }\`.`,
	);
}

export function createAuthAdmin(options: AuthAdminOptions = {}) {
	assertServerOnly();
	const url = resolve(
		options,
		options.url,
		['FROSTBASE_URL', 'CLOUDFLAREBASE_URL', 'CFBASE_URL'],
		'a console URL',
	);
	const projectId = resolve(
		options,
		options.projectId,
		['FROSTBASE_PROJECT', 'CLOUDFLAREBASE_PROJECT', 'CFBASE_PROJECT'],
		'a project id',
	);
	const key = resolve(
		options,
		options.key,
		['FROSTBASE_SERVICE_KEY', 'CLOUDFLAREBASE_SERVICE_KEY', 'CFBASE_SERVICE_KEY'],
		'a service key',
	);

	// The auth agent's operator routes sit at the project root, not under an
	// agent prefix - `/api/projects/<id>/admin/*` - because auth was the first
	// agent and its proxy predates the per-agent prefixes.
	const base = `${url.replace(/\/$/, '')}/api/projects/${encodeURIComponent(projectId)}`;
	const doFetch = options.fetch ?? fetch;

	async function request<R>(method: string, path: string, body?: unknown): Promise<R> {
		const headers: Record<string, string> = { authorization: `Bearer ${key}` };
		if (body !== undefined) headers['content-type'] = 'application/json';

		const response = await doFetch(`${base}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		const payload = (await response.json().catch(() => null)) as (R & { error?: string }) | null;
		if (!response.ok) {
			// Entity misses name their entity; an old agent's routing fallback is a
			// bare `not found` and must NOT read as one (it matched here once, which
			// made this guard unreachable).
			if (
				response.status === 404 &&
				!/^(?:user|session) not found$|^no such /i.test(payload?.error ?? '')
			) {
				throw new AuthAgentTooOldError(path);
			}
			throw new AuthAdminError(
				response.status,
				payload?.error ?? `request failed (${response.status})`,
			);
		}
		return payload as R;
	}

	const userPath = (userId: string) => `/admin/users/${encodeURIComponent(userId)}`;

	return {
		/**
		 * Create an account with no sign-up flow: the project's sign-up MODE and
		 * email verification are bypassed, which is what seeding, invite-first
		 * products, and migrations off another provider need.
		 *
		 * `emailVerified` defaults to false - an account is not verified merely
		 * because an admin made it. Omitting `password` creates an account with
		 * no credential, which `setPassword` can give one to later.
		 */
		createUser: (input: {
			email: string;
			password?: string;
			name?: string;
			emailVerified?: boolean;
		}) => request<AdminUser>('POST', '/admin/users', input),

		getUser: (userId: string) => request<AdminUser>('GET', userPath(userId)),

		/** Name, email, verified flag. NOT role - `setRole` is the only writer,
		 * so the console's lockout guards cannot be walked around from here. */
		updateUser: (
			userId: string,
			changes: { name?: string; email?: string; emailVerified?: boolean },
		) => request<AdminUser>('PATCH', userPath(userId), changes),

		deleteUser: (userId: string) => request<unknown>('DELETE', userPath(userId)),

		/**
		 * Set a password with no emailed token. An account with no credential
		 * GAINS one, so a social-only user can be given a password. Existing
		 * sessions are revoked unless you say otherwise - setting a password is
		 * how an account is recovered AND how one is stolen.
		 */
		setPassword: (userId: string, newPassword: string, opts: { revokeSessions?: boolean } = {}) =>
			request<{ status: boolean }>('PUT', `${userPath(userId)}/password`, {
				newPassword,
				...(opts.revokeSessions === undefined ? {} : { revokeSessions: opts.revokeSessions }),
			}),

		setRole: (userId: string, role: string) =>
			request<unknown>('PUT', `${userPath(userId)}/role`, { role }),

		/** One keyset page, newest first. Pass the previous `nextCursor` to
		 * continue; offset paging is deliberately not offered, because sign-ups
		 * landing mid-scan would skip or repeat rows. */
		listUsers: (opts: { cursor?: string; limit?: number } = {}) => {
			const query = new URLSearchParams();
			if (opts.cursor) query.set('cursor', opts.cursor);
			if (opts.limit) query.set('limit', String(opts.limit));
			return request<{ users: AdminUser[]; nextCursor?: string }>(
				'GET',
				`/admin/users${query.size ? `?${query}` : ''}`,
			);
		},

		listSessions: (opts: { cursor?: string; limit?: number } = {}) => {
			const query = new URLSearchParams();
			if (opts.cursor) query.set('cursor', opts.cursor);
			if (opts.limit) query.set('limit', String(opts.limit));
			return request<{ sessions: unknown[]; nextCursor?: string }>(
				'GET',
				`/admin/sessions${query.size ? `?${query}` : ''}`,
			);
		},

		revokeSession: (sessionId: string) =>
			request<unknown>('DELETE', `/admin/sessions/${encodeURIComponent(sessionId)}`),

		/** Replace the role registry. Built-in `user` and `admin` always remain. */
		setRoles: (roles: { name: string; permissions: string[] }[]) =>
			request<unknown>('PUT', '/admin/roles', { roles }),

		overview: () => request<unknown>('GET', '/overview'),
		analytics: (timeZone?: string) =>
			request<unknown>(
				'GET',
				`/analytics${timeZone ? `?timeZone=${encodeURIComponent(timeZone)}` : ''}`,
			),
	};
}
