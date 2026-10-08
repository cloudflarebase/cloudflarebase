/**
 * The ADMIN client for `@frostbase/storage` - buckets and object bytes
 * from a server.
 *
 * The twin of the db and auth admin clients: it targets the CONSOLE (a `cfbs_`
 * service key is verified in the console guard and never reaches this agent as
 * a bearer), it is admin-grade (per-bucket access modes and owner checks are
 * bypassed), and it is server-only.
 *
 * Object bytes travel over the console's STREAMING proxy - the one route in
 * the console that does not buffer, because the agent's whole design is that
 * bytes never enter a Durable Object. `put` accepts a stream and passes it
 * through untouched.
 */

export interface StorageAdminOptions {
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

export class StorageAdminError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = 'StorageAdminError';
	}
}

/** A 404 from a route the DEPLOYED console or agent lacks, told apart from
 * the agent's own misses (`no such object`, `no such bucket`, the guard's
 * `no such project`), which all name what is missing. Conflating them is
 * data-loss-shaped: a pre-S2 console has no object proxy at all, and its
 * routing 404 would read as "object absent" - the db and auth clients carry
 * the same guard for the same reason. */
export class StorageAgentTooOldError extends Error {
	constructor(path: string) {
		super(
			`the console did not recognise ${path}. Deploy a console (and @frostbase/storage) that ` +
				`ships the storage object proxy before calling this - an older deployment answers a 404 ` +
				`that looks like a missing object.`,
		);
		this.name = 'StorageAgentTooOldError';
	}
}

/** The agent and the console guard name what a real 404 is missing. */
function isEntityMiss(message: string | undefined): boolean {
	return /^no such /i.test(message ?? '');
}

export interface StorageObjectSummary {
	key: string;
	size: number;
	contentType: string | null;
	owner: string | null;
	uploadedAt: string;
}

function assertServerOnly(): void {
	if (typeof (globalThis as { document?: unknown }).document !== 'undefined') {
		throw new Error(
			'@frostbase/storage/admin is server-only: it carries a service key, which can read, ' +
				'overwrite, and delete every object in your project regardless of bucket access modes. ' +
				'Never import it into browser code - upload from the browser with the signed-in user’s ' +
				'project JWT against the public object path instead.',
		);
	}
}

function resolve(
	options: StorageAdminOptions,
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
		`@frostbase/storage/admin needs ${label}: pass it explicitly, or set ${names.join(' or ')}. ` +
			`Inside a Worker, secrets live on \`env\` rather than a global process - pass \`{ env }\`.`,
	);
}

/** Object keys carry literal slashes as path segments; every other character
 * is encoded. Dot segments are refused by the agent, and the console proxy
 * re-checks the resolved path stays inside this bucket. */
function encodeKey(key: string): string {
	return key
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');
}

export function createStorageAdmin(options: StorageAdminOptions = {}) {
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

	const base = `${url.replace(/\/$/, '')}/api/projects/${encodeURIComponent(projectId)}/storage`;
	const doFetch = options.fetch ?? fetch;

	async function json<R>(method: string, path: string, body?: unknown): Promise<R> {
		const headers: Record<string, string> = { authorization: `Bearer ${key}` };
		if (body !== undefined) headers['content-type'] = 'application/json';

		const response = await doFetch(`${base}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const payload = (await response.json().catch(() => null)) as (R & { error?: string }) | null;
		if (!response.ok) {
			if (response.status === 404 && !isEntityMiss(payload?.error)) {
				throw new StorageAgentTooOldError(path);
			}
			throw new StorageAdminError(
				response.status,
				payload?.error ?? `request failed (${response.status})`,
			);
		}
		return payload as R;
	}

	return {
		listBuckets: () => json<{ buckets: unknown[] }>('GET', '/admin/buckets'),

		bucket(name: string) {
			const bucketPath = `/admin/buckets/${encodeURIComponent(name)}`;
			const objectPath = (objectKey: string) => `${bucketPath}/objects/${encodeKey(objectKey)}`;

			return {
				/** Create or update. Omitted fields keep their stored value; a fresh
				 * bucket defaults to `auth` read AND write - never anonymous by
				 * accident - with listing not public. */
				configure: (config: Record<string, unknown>) => json<unknown>('PUT', bucketPath, config),

				drop: () => json<unknown>('DELETE', bucketPath),

				list: (opts: { prefix?: string; cursor?: string; limit?: number } = {}) => {
					const query = new URLSearchParams();
					if (opts.prefix) query.set('prefix', opts.prefix);
					if (opts.cursor) query.set('cursor', opts.cursor);
					if (opts.limit) query.set('limit', String(opts.limit));
					return json<{ objects: StorageObjectSummary[]; cursor?: string; total?: number }>(
						'GET',
						`${bucketPath}/objects${query.size ? `?${query}` : ''}`,
					);
				},

				/**
				 * The raw response, so a caller can stream the body rather than
				 * buffer it - `.body`, `.arrayBuffer()`, `.text()`, all still theirs.
				 * Returns null for a missing OBJECT instead of throwing, because
				 * "is it there" is the common question - but only for that answer.
				 * A missing bucket or project throws instead: a typo'd bucket name
				 * reading as "empty dataset" is how a sync job silently treats a
				 * misconfiguration as truth.
				 */
				async get(objectKey: string): Promise<Response | null> {
					const path = objectPath(objectKey);
					const response = await doFetch(`${base}${path}`, {
						headers: { authorization: `Bearer ${key}` },
					});
					if (response.status === 404) {
						const body = (await response.json().catch(() => null)) as { error?: string } | null;
						if (/^no such object$/i.test(body?.error ?? '')) return null;
						if (isEntityMiss(body?.error)) {
							throw new StorageAdminError(404, body?.error ?? 'not found');
						}
						throw new StorageAgentTooOldError(path);
					}
					if (!response.ok) {
						throw new StorageAdminError(response.status, `download failed (${response.status})`);
					}
					return response;
				},

				/**
				 * Upload. The body streams through the console to R2 - bytes never
				 * enter a Durable Object.
				 *
				 * `contentType` defaults to `application/octet-stream` deliberately:
				 * SvelteKit's CSRF check runs ahead of every hook and refuses FORM
				 * content types (`text/plain`, `multipart/form-data`,
				 * `application/x-www-form-urlencoded`) on a request with no Origin -
				 * and a service-key request has no Origin by construction. Passing
				 * `text/plain` here would 403 before the key was even read.
				 *
				 * A stream body needs an explicit `size`, because the agent requires
				 * `Content-Length` (411 without it) - a chunked body would have to be
				 * buffered, and a 100 MB buffer in a shared isolate is a memory bomb.
				 */
				put: async (
					objectKey: string,
					body: ArrayBuffer | ArrayBufferView | Blob | string | ReadableStream,
					opts: { contentType?: string; size?: number } = {},
				) => {
					const contentType = opts.contentType ?? 'application/octet-stream';
					if (
						/^(text\/plain|multipart\/form-data|application\/x-www-form-urlencoded)/i.test(
							contentType,
						)
					) {
						throw new StorageAdminError(
							400,
							`content type "${contentType}" cannot be uploaded with a service key: the console ` +
								`refuses form content types on requests without an Origin, and a service key never ` +
								`sends one. Use application/octet-stream, or a specific media type.`,
						);
					}

					const headers: Record<string, string> = {
						authorization: `Bearer ${key}`,
						'content-type': contentType,
					};
					if (opts.size !== undefined) headers['content-length'] = String(opts.size);
					else if (typeof body === 'string') {
						headers['content-length'] = String(new TextEncoder().encode(body).byteLength);
					} else if (body instanceof ArrayBuffer) {
						headers['content-length'] = String(body.byteLength);
					} else if (ArrayBuffer.isView(body)) {
						headers['content-length'] = String(body.byteLength);
					} else if (typeof Blob !== 'undefined' && body instanceof Blob) {
						headers['content-length'] = String(body.size);
					} else {
						throw new StorageAdminError(
							411,
							'a stream body needs an explicit `size`: the agent requires Content-Length, because ' +
								'a chunked body would have to be buffered in memory.',
						);
					}

					const response = await doFetch(`${base}${objectPath(objectKey)}`, {
						method: 'PUT',
						headers,
						body: body as BodyInit,
						// Required whenever a stream is the body; harmless otherwise.
						...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
					} as RequestInit);
					const payload = (await response.json().catch(() => null)) as {
						error?: string;
					} | null;
					if (!response.ok) {
						if (response.status === 404 && !isEntityMiss(payload?.error)) {
							throw new StorageAgentTooOldError(objectPath(objectKey));
						}
						throw new StorageAdminError(
							response.status,
							payload?.error ?? `upload failed (${response.status})`,
						);
					}
					return payload;
				},

				delete: (objectKey: string) => json<unknown>('DELETE', objectPath(objectKey)),
			};
		},

		overview: () => json<unknown>('GET', '/overview'),
	};
}
