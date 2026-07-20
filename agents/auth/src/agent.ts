import { Agent, type AgentContext } from 'agents';
import { count, desc, eq, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
import migrations from '../drizzle/migrations';
import { createProjectAuth, type AuthDatabase, type ProjectAuth } from './auth';
import * as schema from './db/schema';

const MAX_EVENTS = 50;
// Analytics Engine ingestion is asynchronous. Keep this short so a query that
// races a new write is retried quickly instead of holding stale graph data.
const ANALYTICS_CACHE_MS = 5_000;
const TIME_ZONE_PATTERN = /^(?:Etc\/UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/;

type SocialCredentials = Partial<
	Record<'google' | 'github', { clientId: string; clientSecret: string }>
>;

function parseSocialCredentials(
	value: unknown,
	existing: SocialCredentials,
): { credentials: SocialCredentials } | { error: string } {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return { error: 'socialProviders must be an object' };
	}
	const credentials: SocialCredentials = {};
	for (const provider of ['google', 'github'] as const) {
		const entry = (value as Record<string, unknown>)[provider];
		if (entry === undefined || entry === null || entry === false) continue;
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			return { error: `${provider} credentials are invalid` };
		}
		if ((entry as Record<string, unknown>).preserve === true && existing[provider]) {
			credentials[provider] = existing[provider];
			continue;
		}
		const { clientId, clientSecret } = entry as Record<string, unknown>;
		if (
			typeof clientId !== 'string' ||
			typeof clientSecret !== 'string' ||
			!clientId.trim() ||
			!clientSecret.trim() ||
			clientId.length > 512 ||
			clientSecret.length > 512
		) {
			return { error: `${provider} requires a client ID and client secret` };
		}
		credentials[provider] = { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
	}
	return { credentials };
}

export interface AuthActivityEvent {
	id: string;
	type:
		'project.provisioned' | 'user.created' | 'user.deleted' | 'session.created' | 'session.revoked';
	message: string;
	at: string;
}

/** Synced in realtime to every dashboard connected to this agent. */
export interface AuthAgentState {
	projectId: string;
	provisionedAt: string | null;
	allowedOrigins: string[];
	enabledSocialProviders: string[];
	users: number;
	activeSessions: number;
	totalEvents: number;
	lastEventAt: string | null;
	events: AuthActivityEvent[];
}

export interface OverviewUser {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	isAnonymous: boolean;
	providers: string[];
	createdAt: string;
}

export interface OverviewSession {
	id: string;
	userId: string;
	email: string | null;
	ipAddress: string | null;
	userAgent: string | null;
	country: string | null;
	createdAt: string;
	expiresAt: string;
}

export interface AuthOverview {
	projectId: string;
	users: OverviewUser[];
	sessions: OverviewSession[];
	state: AuthAgentState;
}

export interface AuthAnalytics {
	projectId: string;
	dau: number;
	wau: number;
	mau: number;
	totalUsers: number;
	registeredUsers: number;
	anonymousUsers: number;
	gmailUsers: number;
	activeSessions: number;
	providers: { provider: string; users: number }[];
	countries: { country: string; sessions: number }[];
	signupsLast7Days: { day: string; count: number }[];
	/** Workers Analytics Engine metrics pipeline. */
	engine: {
		dataset: string;
		enabled: boolean;
		status: 'connected' | 'local' | 'write-only' | 'error';
		error?: string;
	};
	/** Event counts from the Analytics Engine SQL API — only when enabled. */
	eventsLast24h?: { eventType: string; count: number }[];
}

export interface AgentChatReply {
	question: string;
	topic: 'ai-analysis';
	answer: string;
	mode: 'workers-ai';
	model: string;
}

interface BehavioralAnalytics {
	dau: number;
	wau: number;
	mau: number;
	gmailUsers: number;
	providers: { provider: string; users: number }[];
	countries: { country: string; sessions: number }[];
	signupsLast7Days: { day: string; count: number }[];
	eventsLast24h?: { eventType: string; count: number }[];
}

const DEFAULT_CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * One AuthAgent per Cloudflarebase project. The agent is a SQLite-backed
 * Durable Object that runs a full Better Auth stack for the project — users,
 * sessions, accounts and verifications all live in the agent's own database
 * (via Drizzle ORM) — pushes live auth activity to connected dashboards
 * through the Agents SDK state sync, and answers analytics questions about
 * its own data (/analytics, /chat).
 *
 * Addressed as /agents/auth-agent/<projectId>/...
 */
export class AuthAgent extends Agent<Env, AuthAgentState> {
	initialState: AuthAgentState = {
		projectId: '',
		provisionedAt: null,
		allowedOrigins: [],
		enabledSocialProviders: [],
		users: 0,
		activeSessions: 0,
		totalEvents: 0,
		lastEventAt: null,
		events: [],
	};

	db: AuthDatabase;
	private _auth: ProjectAuth | null = null;
	private behavioralCache: {
		expiresAt: number;
		timeZone: string;
		data: BehavioralAnalytics;
	} | null = null;
	/** Country Cloudflare resolved for the request currently being handled. */
	private requestCountry: string | null = null;
	private socialCredentials: SocialCredentials = {};

	constructor(ctx: AgentContext, env: Env) {
		super(ctx, env);
		this.db = drizzle(ctx.storage, { schema });
	}

	private get auth(): ProjectAuth {
		const secret = this.env.BETTER_AUTH_SECRET;
		if (!secret) {
			throw new Error('BETTER_AUTH_SECRET is not configured for the auth-agent worker');
		}
		this._auth ??= createProjectAuth({
			projectId: this.name,
			db: this.db,
			secret,
			trustedOrigins: this.trustedOrigins,
			disableRateLimit: this.env.DISABLE_RATE_LIMIT === 'true',
			getRequestCountry: () => this.requestCountry,
			google:
				this.socialCredentials.google ??
				(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET
					? { clientId: this.env.GOOGLE_CLIENT_ID, clientSecret: this.env.GOOGLE_CLIENT_SECRET }
					: undefined),
			github: this.socialCredentials.github,
			sendEmail:
				(this.env.EMAIL && this.env.EMAIL_FROM) || this.env.AUTH_EMAIL_WEBHOOK_URL
					? (message) => this.sendAuthEmail(message)
					: undefined,
			onUserCreated: async (user) => {
				this.writeAuthEvent('user.created', {
					provider: user.isAnonymous ? 'anonymous' : 'credential',
					subjectId: user.id,
					emailDomain: user.email.split('@')[1]?.toLowerCase() ?? 'none',
				});
				await this.recordEvent(
					'user.created',
					user.isAnonymous ? 'guest user created' : 'registered user created',
				);
			},
			onSessionActivity: async (session, kind) => {
				await this.trackSessionActivity(session.userId, session.id, `session.${kind}`);
				if (kind === 'created') {
					await this.recordEvent('session.created', 'new session started');
				}
			},
		});
		return this._auth;
	}

	private get trustedOrigins(): string[] {
		return [
			...(this.env.TRUSTED_ORIGINS ?? '')
				.split(',')
				.map((origin) => origin.trim())
				.filter(Boolean),
			...(this.state.allowedOrigins ?? []),
		];
	}

	private corsHeaders(request: Request): Headers | null {
		const origin = request.headers.get('origin');
		if (!origin || !this.trustedOrigins.includes(origin)) return null;
		return new Headers({
			'access-control-allow-origin': origin,
			'access-control-allow-credentials': 'true',
			'access-control-allow-methods': 'GET, POST, OPTIONS',
			'access-control-allow-headers': 'authorization, content-type',
			'access-control-expose-headers': 'set-auth-token',
			vary: 'Origin',
		});
	}

	async onStart(): Promise<void> {
		// Idempotent — drizzle tracks applied migrations in its own table.
		await migrate(this.db, migrations);
		if (this.env.LOCAL_ANALYTICS) {
			await this.env.LOCAL_ANALYTICS.batch([
				this.env.LOCAL_ANALYTICS.prepare(
					`CREATE TABLE IF NOT EXISTS auth_events (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, timestamp INTEGER NOT NULL, event_type TEXT NOT NULL, country TEXT NOT NULL, provider TEXT NOT NULL, subject_id TEXT NOT NULL, session_id TEXT NOT NULL, email_domain TEXT NOT NULL)`,
				),
				this.env.LOCAL_ANALYTICS.prepare(
					`CREATE INDEX IF NOT EXISTS auth_events_project_time ON auth_events(project_id, timestamp)`,
				),
			]);
		}
		this.socialCredentials =
			(await this.ctx.storage.get<SocialCredentials>('social-provider-credentials')) ?? {};

		if (!this.state.projectId) {
			this.setState({
				...this.state,
				projectId: this.name,
				provisionedAt: new Date().toISOString(),
				allowedOrigins: [],
				enabledSocialProviders: this.configuredSocialProviders,
			});
			this.writeAuthEvent('project.provisioned');
			await this.recordEvent('project.provisioned', `auth provisioned for project "${this.name}"`);
		} else if (
			!Array.isArray(this.state.allowedOrigins) ||
			!Array.isArray(this.state.enabledSocialProviders)
		) {
			// State schema upgrade for agents provisioned before origin settings.
			this.setState({
				...this.state,
				allowedOrigins: this.state.allowedOrigins ?? [],
				enabledSocialProviders: this.configuredSocialProviders,
			});
		}
	}

	private get configuredSocialProviders(): string[] {
		return [
			...(this.socialCredentials.google ||
			(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET)
				? ['google']
				: []),
			...(this.socialCredentials.github ? ['github'] : []),
		];
	}

	/**
	 * Streams one data point per auth event to Workers Analytics Engine.
	 * Indexed by project id (fair per-project sampling); blob order is part of
	 * the dataset schema — keep it stable and documented below.
	 * Writes are fire-and-forget and must never break auth.
	 */
	private writeAuthEvent(
		eventType: string,
		fields: {
			country?: string | null;
			provider?: string | null;
			subjectId?: string | null;
			sessionId?: string | null;
			emailDomain?: string | null;
		} = {},
	): void {
		// A new event can change every behavioral card. Avoid serving a stale
		// country/provider snapshot after an authentication mutation.
		this.behavioralCache = null;
		try {
			this.env.AUTH_EVENTS?.writeDataPoint({
				indexes: [this.name],
				// Schema: event, country, provider, subject, session, email domain.
				blobs: [
					eventType,
					fields.country ?? 'unknown',
					fields.provider ?? 'none',
					fields.subjectId ?? 'none',
					fields.sessionId ?? 'none',
					fields.emailDomain ?? 'none',
				],
				doubles: [1],
			});
		} catch {
			// metrics failure is never allowed to fail the auth request
		}
		if (!this.waeConfig && this.env.LOCAL_ANALYTICS) {
			this.ctx.waitUntil(
				this.env.LOCAL_ANALYTICS.prepare(
					`INSERT INTO auth_events (project_id, timestamp, event_type, country, provider, subject_id, session_id, email_domain) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				)
					.bind(
						this.name,
						Date.now(),
						eventType,
						fields.country ?? 'unknown',
						fields.provider ?? 'none',
						fields.subjectId ?? 'none',
						fields.sessionId ?? 'none',
						fields.emailDomain ?? 'none',
					)
					.run(),
			);
		}
	}

	private get waeConfig(): { accountId: string; token: string; dataset: string } | null {
		const accountId = this.env.CF_ACCOUNT_ID;
		const token = this.env.CF_ANALYTICS_API_TOKEN;
		const dataset = this.env.WAE_DATASET;
		return accountId && token && dataset ? { accountId, token, dataset } : null;
	}

	private async sendAuthEmail(message: {
		type: 'email-verification' | 'password-reset';
		to: string;
		url: string;
	}): Promise<void> {
		if (this.env.EMAIL && this.env.EMAIL_FROM) {
			const action =
				message.type === 'password-reset' ? 'Reset your password' : 'Verify your email';
			const safeUrl = message.url
				.replaceAll('&', '&amp;')
				.replaceAll('"', '&quot;')
				.replaceAll('<', '&lt;');
			await this.env.EMAIL.send({
				to: message.to,
				from: { email: this.env.EMAIL_FROM, name: 'Cloudflarebase Auth' },
				subject: `${action} · Cloudflarebase`,
				text: `${action}: ${message.url}\n\nIf you did not request this, you can ignore this email.`,
				html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto"><h1 style="font-size:22px">${action}</h1><p>Continue securely with the button below.</p><p><a href="${safeUrl}" style="display:inline-block;background:#f6821f;color:white;padding:12px 18px;border-radius:8px;text-decoration:none">${action}</a></p><p style="color:#666;font-size:13px">If you did not request this, you can ignore this email.</p></div>`,
			});
			this.writeAuthEvent('email.sent', { provider: 'cloudflare-email-service' });
			return;
		}
		const endpoint = this.env.AUTH_EMAIL_WEBHOOK_URL;
		if (!endpoint) throw new Error('email delivery is not configured');
		const headers = new Headers({ 'content-type': 'application/json' });
		if (this.env.AUTH_EMAIL_WEBHOOK_SECRET) {
			headers.set('authorization', `Bearer ${this.env.AUTH_EMAIL_WEBHOOK_SECRET}`);
		}
		const response = await fetch(endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify({ projectId: this.name, ...message }),
		});
		if (!response.ok) throw new Error(`auth email webhook failed (${response.status})`);
		this.writeAuthEvent('email.sent', { provider: message.type });
	}

	private async trackSessionActivity(
		userId: string,
		sessionId: string,
		sessionEvent?: string,
	): Promise<void> {
		const [account] = await this.db
			.select({ provider: schema.account.providerId })
			.from(schema.account)
			.where(eq(schema.account.userId, userId))
			.limit(1);
		const dimensions = {
			country: this.requestCountry,
			provider: account?.provider ?? 'anonymous',
			subjectId: userId,
			sessionId,
		};
		if (sessionEvent) this.writeAuthEvent(sessionEvent, dimensions);
		this.writeAuthEvent('user.active', dimensions);
	}

	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		// Requests arrive with the full /agents/auth-agent/<name>/... path.
		const subPath = url.pathname.match(/\/agents\/[^/]+\/[^/]+(\/.*)?$/)?.[1] ?? '/';

		if (subPath === '/overview') {
			return Response.json(await this.getOverview());
		}

		if (subPath === '/analytics') {
			const requestedTimeZone = url.searchParams.get('timeZone') ?? 'Etc/UTC';
			const timeZone = TIME_ZONE_PATTERN.test(requestedTimeZone) ? requestedTimeZone : 'Etc/UTC';
			return Response.json(await this.getAnalytics(timeZone));
		}

		if (subPath === '/config' && request.method === 'GET') {
			return Response.json({
				projectId: this.name,
				providers: ['email-password', 'anonymous', ...this.configuredSocialProviders],
				availableSocialProviders: ['google', 'github'],
				bearerTokens: true,
				emailDeliveryConfigured:
					!!(this.env.EMAIL && this.env.EMAIL_FROM) || !!this.env.AUTH_EMAIL_WEBHOOK_URL,
			});
		}

		if (subPath === '/chat' && request.method === 'POST') {
			const body = (await request.json().catch(() => null)) as { question?: string } | null;
			const question = body?.question?.trim().slice(0, 500);
			if (!question) {
				return Response.json({ error: 'question is required' }, { status: 400 });
			}
			try {
				return Response.json(await this.answerQuestion(question));
			} catch (error) {
				console.error('AuthAgent AI request failed', error);
				return Response.json(
					{ error: 'Workers AI could not answer this request' },
					{ status: 502 },
				);
			}
		}

		const userDelete = subPath.match(/^\/admin\/users\/([^/]+)$/);
		if (userDelete && request.method === 'DELETE') {
			return this.deleteUser(decodeURIComponent(userDelete[1]));
		}

		const sessionDelete = subPath.match(/^\/admin\/sessions\/([^/]+)$/);
		if (sessionDelete && request.method === 'DELETE') {
			return this.revokeSession(decodeURIComponent(sessionDelete[1]));
		}

		if (subPath === '/admin/settings' && request.method === 'PUT') {
			return this.updateSettings(request);
		}

		if (subPath === '/api/auth' || subPath.startsWith('/api/auth/')) {
			if (!this.env.BETTER_AUTH_SECRET) {
				return Response.json(
					{ error: 'auth agent is missing BETTER_AUTH_SECRET' },
					{ status: 500 },
				);
			}
			const cors = this.corsHeaders(request);
			if (request.method === 'OPTIONS') {
				return cors
					? new Response(null, { status: 204, headers: cors })
					: Response.json({ error: 'origin is not trusted' }, { status: 403 });
			}
			this.requestCountry =
				(request.cf?.country as string | undefined) ?? request.headers.get('cf-ipcountry');
			// Better Auth sees the request at its basePath, on the caller's origin,
			// so cookies and redirect URLs resolve against the dashboard origin.
			const signingOut = /\/sign-out$/.test(subPath);
			const currentSession = signingOut
				? await this.auth.api.getSession({ headers: request.headers }).catch(() => null)
				: null;
			const authRequest = new Request(`${url.origin}${subPath}${url.search}`, request);
			const response = await this.auth.handler(authRequest);

			// Sign-out deletes the session row without a database hook — refresh
			// counters after any mutation so connected dashboards stay accurate.
			if (response.ok && signingOut) {
				this.writeAuthEvent('session.revoked', {
					country: this.requestCountry,
					subjectId: currentSession?.user.id,
					sessionId: currentSession?.session.id,
				});
				await this.recordEvent('session.revoked', 'user signed out');
			} else if (response.ok && request.method === 'GET' && /\/get-session$/.test(subPath)) {
				const session = (await response
					.clone()
					.json()
					.catch(() => null)) as {
					user?: { id?: string };
					session?: { id?: string };
				} | null;
				if (session?.user?.id && session.session?.id) {
					await this.trackSessionActivity(session.user.id, session.session.id);
				}
			} else if (request.method !== 'GET') {
				await this.syncCounters();
			}
			if (!cors) return response;
			const headers = new Headers(response.headers);
			cors.forEach((value, key) => headers.set(key, value));
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			});
		}

		return Response.json({ error: 'not found' }, { status: 404 });
	}

	private async deleteUser(userId: string): Promise<Response> {
		if (!userId || userId.length > 128) {
			return Response.json({ error: 'invalid user id' }, { status: 400 });
		}
		const [existing] = await this.db
			.select({ id: schema.user.id })
			.from(schema.user)
			.where(eq(schema.user.id, userId))
			.limit(1);
		if (!existing) return Response.json({ error: 'user not found' }, { status: 404 });
		await this.db.delete(schema.user).where(eq(schema.user.id, userId));
		this.writeAuthEvent('user.deleted', { subjectId: userId });
		await this.recordEvent('user.deleted', 'user deleted by project administrator');
		return Response.json({ ok: true });
	}

	private async revokeSession(sessionId: string): Promise<Response> {
		if (!sessionId || sessionId.length > 128) {
			return Response.json({ error: 'invalid session id' }, { status: 400 });
		}
		const [existing] = await this.db
			.select({ id: schema.session.id, userId: schema.session.userId })
			.from(schema.session)
			.where(eq(schema.session.id, sessionId))
			.limit(1);
		if (!existing) return Response.json({ error: 'session not found' }, { status: 404 });
		await this.db.delete(schema.session).where(eq(schema.session.id, sessionId));
		this.writeAuthEvent('session.revoked', {
			subjectId: existing.userId,
			sessionId: existing.id,
		});
		await this.recordEvent('session.revoked', 'session revoked by project administrator');
		return Response.json({ ok: true });
	}

	private async updateSettings(request: Request): Promise<Response> {
		const body = (await request.json().catch(() => null)) as {
			allowedOrigins?: unknown;
			socialProviders?: unknown;
		} | null;
		if (!Array.isArray(body?.allowedOrigins) || body.allowedOrigins.length > 10) {
			return Response.json(
				{ error: 'allowedOrigins must be an array with at most 10 entries' },
				{ status: 400 },
			);
		}
		const origins: string[] = [];
		for (const value of body.allowedOrigins) {
			if (typeof value !== 'string') {
				return Response.json({ error: 'every allowed origin must be a string' }, { status: 400 });
			}
			try {
				const url = new URL(value);
				const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
				if (
					(url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
					url.origin !== value
				) {
					throw new Error('invalid origin');
				}
				if (!origins.includes(url.origin)) origins.push(url.origin);
			} catch {
				return Response.json({ error: `invalid origin: ${value}` }, { status: 400 });
			}
		}
		if (body.socialProviders !== undefined) {
			const parsed = parseSocialCredentials(body.socialProviders, this.socialCredentials);
			if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
			this.socialCredentials = parsed.credentials;
			await this.ctx.storage.put('social-provider-credentials', this.socialCredentials);
		}
		const enabledSocialProviders = this.configuredSocialProviders;
		this.setState({ ...this.state, allowedOrigins: origins, enabledSocialProviders });
		this._auth = null;
		return Response.json({ allowedOrigins: origins, enabledSocialProviders });
	}

	/** Snapshot used by the dashboard's initial server-side load and polling. */
	async getOverview(): Promise<AuthOverview> {
		const now = new Date();
		const users = await this.db
			.select({
				id: schema.user.id,
				name: schema.user.name,
				email: schema.user.email,
				emailVerified: schema.user.emailVerified,
				isAnonymous: schema.user.isAnonymous,
				createdAt: schema.user.createdAt,
			})
			.from(schema.user)
			.orderBy(desc(schema.user.createdAt))
			.limit(100);

		const accounts = await this.db
			.select({ userId: schema.account.userId, providerId: schema.account.providerId })
			.from(schema.account);
		const providersByUser = new Map<string, string[]>();
		for (const row of accounts) {
			providersByUser.set(row.userId, [...(providersByUser.get(row.userId) ?? []), row.providerId]);
		}

		const sessions = await this.db
			.select({
				id: schema.session.id,
				userId: schema.session.userId,
				email: schema.user.email,
				ipAddress: schema.session.ipAddress,
				userAgent: schema.session.userAgent,
				country: schema.session.country,
				createdAt: schema.session.createdAt,
				expiresAt: schema.session.expiresAt,
			})
			.from(schema.session)
			.leftJoin(schema.user, eq(schema.user.id, schema.session.userId))
			.where(gt(schema.session.expiresAt, now))
			.orderBy(desc(schema.session.createdAt))
			.limit(100);

		return {
			projectId: this.name,
			users: users.map((u) => ({
				...u,
				isAnonymous: !!u.isAnonymous,
				providers: providersByUser.get(u.id) ?? (u.isAnonymous ? ['anonymous'] : []),
				createdAt: u.createdAt.toISOString(),
			})),
			sessions: sessions.map((s) => ({
				...s,
				createdAt: s.createdAt.toISOString(),
				expiresAt: s.expiresAt.toISOString(),
			})),
			state: this.state,
		};
	}

	/** Operational totals from SQLite plus behavioral analytics from Analytics Engine. */
	async getAnalytics(timeZone = 'Etc/UTC'): Promise<AuthAnalytics> {
		const [totalUsers] = await this.db.select({ n: count() }).from(schema.user);
		const [anonymousUsers] = await this.db
			.select({ n: count() })
			.from(schema.user)
			.where(eq(schema.user.isAnonymous, true));
		const [activeSessions] = await this.db
			.select({ n: count() })
			.from(schema.session)
			.where(gt(schema.session.expiresAt, new Date()));

		let analyticsError: string | undefined;
		let behavioral: BehavioralAnalytics;
		try {
			behavioral = await this.queryBehavioralAnalytics(timeZone);
		} catch (error) {
			analyticsError = error instanceof Error ? error.message : 'Analytics Engine query failed';
			console.error(analyticsError);
			behavioral = this.emptyBehavioralAnalytics();
		}

		const total = totalUsers?.n ?? 0;
		const anonymous = anonymousUsers?.n ?? 0;
		return {
			projectId: this.name,
			dau: behavioral.dau,
			wau: behavioral.wau,
			mau: behavioral.mau,
			totalUsers: total,
			registeredUsers: total - anonymous,
			anonymousUsers: anonymous,
			gmailUsers: behavioral.gmailUsers,
			activeSessions: activeSessions?.n ?? 0,
			providers: behavioral.providers,
			countries: behavioral.countries,
			signupsLast7Days: behavioral.signupsLast7Days,
			engine: {
				dataset: this.env.WAE_DATASET ?? 'cloudflarebase_auth_events',
				enabled: this.waeConfig !== null || !!this.env.LOCAL_ANALYTICS,
				status: analyticsError
					? 'error'
					: this.waeConfig
						? 'connected'
						: this.env.LOCAL_ANALYTICS
							? 'local'
							: 'write-only',
				error: analyticsError,
			},
			eventsLast24h: behavioral.eventsLast24h,
		};
	}

	private emptyBehavioralAnalytics(): BehavioralAnalytics {
		return {
			dau: 0,
			wau: 0,
			mau: 0,
			gmailUsers: 0,
			providers: [],
			countries: [],
			signupsLast7Days: [],
			eventsLast24h: undefined,
		};
	}

	private async analyticsSql<T>(query: string): Promise<T[]> {
		const config = this.waeConfig;
		if (!config) return [];
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/analytics_engine/sql`,
			{
				method: 'POST',
				headers: { authorization: `Bearer ${config.token}` },
				body: `${query} FORMAT JSON`,
			},
		);
		if (!response.ok) {
			throw new Error(`Analytics Engine query failed (${response.status})`);
		}
		const result = (await response.json()) as { data?: T[] };
		return result.data ?? [];
	}

	/** Behavioral analytics are exclusively sourced from Analytics Engine. */
	private async queryBehavioralAnalytics(timeZone: string): Promise<BehavioralAnalytics> {
		if (
			this.behavioralCache &&
			this.behavioralCache.timeZone === timeZone &&
			this.behavioralCache.expiresAt > Date.now()
		) {
			return this.behavioralCache.data;
		}
		const config = this.waeConfig;
		if (!config && this.env.LOCAL_ANALYTICS) return this.queryLocalBehavioralAnalytics();
		const empty = this.emptyBehavioralAnalytics();
		if (!config) {
			this.behavioralCache = {
				expiresAt: Date.now() + ANALYTICS_CACHE_MS,
				timeZone,
				data: empty,
			};
			return empty;
		}
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.dataset)) {
			throw new Error('WAE_DATASET must be a valid Analytics Engine identifier');
		}
		const project = this.name.replaceAll("'", "''");
		const from = `FROM ${config.dataset} WHERE index1 = '${project}'`;
		const activeUsers = (days: number) =>
			this.analyticsSql<{ users: number | string }>(
				`SELECT count(DISTINCT blob4) AS users ${from} AND blob1 = 'user.active' AND timestamp > NOW() - INTERVAL '${days}' DAY`,
			);
		const [dau, wau, mau, providers, countries, signups, gmail, events] = await Promise.all([
			activeUsers(1),
			activeUsers(7),
			activeUsers(30),
			this.analyticsSql<{ provider: string; users: number | string }>(
				`SELECT blob3 AS provider, count(DISTINCT blob4) AS users ${from} AND blob1 = 'user.active' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY provider ORDER BY users DESC`,
			),
			this.analyticsSql<{ country: string; sessions: number | string }>(
				`SELECT blob2 AS country, SUM(_sample_interval) AS sessions ${from} AND blob1 = 'session.created' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY country ORDER BY sessions DESC LIMIT 10`,
			),
			this.analyticsSql<{ day: string; count: number | string }>(
				`SELECT formatDateTime(timestamp, '%Y-%m-%d', '${timeZone}') AS day, SUM(_sample_interval) AS count ${from} AND blob1 = 'user.created' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY day ORDER BY day`,
			),
			this.analyticsSql<{ users: number | string }>(
				`SELECT count(DISTINCT blob4) AS users ${from} AND blob1 = 'user.created' AND blob6 = 'gmail.com'`,
			),
			this.analyticsSql<{ eventType: string; count: number | string }>(
				`SELECT blob1 AS eventType, SUM(_sample_interval) AS count ${from} AND timestamp > NOW() - INTERVAL '1' DAY GROUP BY eventType ORDER BY count DESC`,
			),
		]);
		const data: BehavioralAnalytics = {
			dau: Number(dau[0]?.users ?? 0),
			wau: Number(wau[0]?.users ?? 0),
			mau: Number(mau[0]?.users ?? 0),
			gmailUsers: Number(gmail[0]?.users ?? 0),
			providers: providers.map((row) => ({ ...row, users: Number(row.users) })),
			countries: countries.map((row) => ({ ...row, sessions: Number(row.sessions) })),
			signupsLast7Days: signups.map((row) => ({
				day: row.day.slice(0, 10),
				count: Number(row.count),
			})),
			eventsLast24h: events.map((row) => ({ ...row, count: Number(row.count) })),
		};
		this.behavioralCache = { expiresAt: Date.now() + ANALYTICS_CACHE_MS, timeZone, data };
		return data;
	}

	private async queryLocalBehavioralAnalytics(): Promise<BehavioralAnalytics> {
		const db = this.env.LOCAL_ANALYTICS!;
		const since = (days: number) => Date.now() - days * 86_400_000;
		const bind = (sql: string, ...values: unknown[]) => db.prepare(sql).bind(this.name, ...values);
		const [dau, wau, mau, providers, countries, signups, gmail, events] = await db.batch([
			bind(
				`SELECT COUNT(DISTINCT subject_id) users FROM auth_events WHERE project_id=? AND event_type='user.active' AND timestamp>?`,
				since(1),
			),
			bind(
				`SELECT COUNT(DISTINCT subject_id) users FROM auth_events WHERE project_id=? AND event_type='user.active' AND timestamp>?`,
				since(7),
			),
			bind(
				`SELECT COUNT(DISTINCT subject_id) users FROM auth_events WHERE project_id=? AND event_type='user.active' AND timestamp>?`,
				since(30),
			),
			bind(
				`SELECT provider, COUNT(DISTINCT subject_id) users FROM auth_events WHERE project_id=? AND event_type='user.active' AND timestamp>? GROUP BY provider ORDER BY users DESC`,
				since(30),
			),
			bind(
				`SELECT country, COUNT(DISTINCT session_id) sessions FROM auth_events WHERE project_id=? AND event_type='session.created' AND timestamp>? GROUP BY country ORDER BY sessions DESC LIMIT 10`,
				since(30),
			),
			bind(
				`SELECT date(timestamp / 1000, 'unixepoch') day, COUNT(*) count FROM auth_events WHERE project_id=? AND event_type='user.created' AND timestamp>? GROUP BY day ORDER BY day`,
				since(7),
			),
			bind(
				`SELECT COUNT(DISTINCT subject_id) users FROM auth_events WHERE project_id=? AND event_type='user.created' AND email_domain='gmail.com'`,
			),
			bind(
				`SELECT event_type eventType, COUNT(*) count FROM auth_events WHERE project_id=? AND timestamp>? GROUP BY event_type ORDER BY count DESC`,
				since(1),
			),
		]);
		const rows = <T>(result: D1Result<unknown>) => (result.results ?? []) as T[];
		const scalar = (result: D1Result) => Number(rows<{ users: number }>(result)[0]?.users ?? 0);
		return {
			dau: scalar(dau),
			wau: scalar(wau),
			mau: scalar(mau),
			gmailUsers: scalar(gmail),
			providers: rows(providers),
			countries: rows(countries),
			signupsLast7Days: rows(signups),
			eventsLast24h: rows(events),
		};
	}

	/**
	 * Answers a natural-language question about this project's auth data.
	 * Workers AI is mandatory: failures are surfaced to the caller and are
	 * never replaced with a response that only looks model-generated.
	 */
	async answerQuestion(question: string): Promise<AgentChatReply> {
		const a = await this.getAnalytics();
		if (!this.env.AI) {
			throw new Error('Workers AI binding is required for the AuthAgent');
		}

		const model = this.env.CHAT_MODEL ?? DEFAULT_CHAT_MODEL;
		const result = (await this.env.AI.run(model as keyof AiModels, {
			messages: [
				{
					role: 'system',
					content:
						`You are the Cloudflarebase auth analytics agent for project "${this.name}". ` +
						'Answer only from the aggregated JSON supplied by the user. Never invent metrics. ' +
						'Be concise, explain useful ratios or trends when the data supports them, and say when there is not enough data. ' +
						'Do not claim you can modify users, sessions, or configuration.',
				},
				{
					role: 'user',
					content: `Question: ${question}\n\nAggregated auth analytics:\n${JSON.stringify(a)}`,
				},
			],
			max_tokens: 350,
			temperature: 0.2,
		})) as { response?: string };

		const answer = result.response?.trim();
		if (!answer) throw new Error('Workers AI returned an empty response');
		return { question, topic: 'ai-analysis', answer, mode: 'workers-ai', model };
	}

	private async counters(): Promise<Pick<AuthAgentState, 'users' | 'activeSessions'>> {
		const [users] = await this.db.select({ n: count() }).from(schema.user);
		const [activeSessions] = await this.db
			.select({ n: count() })
			.from(schema.session)
			.where(gt(schema.session.expiresAt, new Date()));
		return { users: users?.n ?? 0, activeSessions: activeSessions?.n ?? 0 };
	}

	private async syncCounters(): Promise<void> {
		const counters = await this.counters();
		if (
			counters.users !== this.state.users ||
			counters.activeSessions !== this.state.activeSessions
		) {
			this.setState({ ...this.state, ...counters });
		}
	}

	private async recordEvent(type: AuthActivityEvent['type'], message: string): Promise<void> {
		const at = new Date().toISOString();
		const event: AuthActivityEvent = { id: crypto.randomUUID(), type, message, at };
		this.setState({
			...this.state,
			...(await this.counters()),
			events: [event, ...this.state.events].slice(0, MAX_EVENTS),
			totalEvents: this.state.totalEvents + 1,
			lastEventAt: at,
		});
	}
}
