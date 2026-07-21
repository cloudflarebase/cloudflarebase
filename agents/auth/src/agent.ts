import { Agent, type AgentContext } from 'agents';
import { count, desc, eq, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
import migrations from '../drizzle/migrations';
import { createProjectAuth, type AuthDatabase, type ProjectAuth } from './auth';
import * as schema from './db/schema';
import {
	analyticsApiResponseSchema,
	chatRequestSchema,
	projectIdSchema,
	resourceIdSchema,
	roleRequestSchema,
	rolesRequestSchema,
	sessionActivityResponseSchema,
	settingsRequestSchema,
	socialCredentialsSchema,
	timeZoneSchema,
	workersAiResponseSchema,
	type ProviderUpdates,
	type SocialCredentials,
} from './schemas';

const MAX_EVENTS = 50;
// Analytics Engine ingestion is asynchronous. Keep this short so a query that
// races a new write is retried quickly instead of holding stale graph data.
const ANALYTICS_CACHE_MS = 5_000;
function applySocialCredentials(
	value: ProviderUpdates,
	existing: SocialCredentials,
): SocialCredentials {
	const credentials: SocialCredentials = {};
	for (const provider of ['google', 'github'] as const) {
		const entry = value[provider];
		if (!entry) continue;
		if ('preserve' in entry) {
			if (!existing[provider]) continue;
			credentials[provider] = existing[provider];
			continue;
		}
		credentials[provider] = entry;
	}
	return credentials;
}

export interface AuthActivityEvent {
	id: string;
	type:
		| 'project.provisioned'
		| 'user.created'
		| 'user.deleted'
		| 'user.role-changed'
		| 'session.created'
		| 'session.revoked';
	message: string;
	at: string;
}

/** An assignable RBAC role and the permission keys it grants. */
export interface RoleDefinition {
	name: string;
	permissions: string[];
}

/** Synced in realtime to every dashboard connected to this agent. */
export interface AuthAgentState {
	projectId: string;
	provisionedAt: string | null;
	/** Role registry; always contains the built-in `user` and `admin`. */
	roles: RoleDefinition[];
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
	role: string;
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
	activityByDay: { day: string; signups: number; signins: number }[];
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

/** Per-project counts for the platform admin fleet view — cheap SQLite reads only. */
export interface FleetProjectCounts {
	projectId: string;
	users: number;
	registeredUsers: number;
	anonymousUsers: number;
	activeSessions: number;
	provisionedAt: string | null;
	lastEventAt: string | null;
	/** Cloudflare data center (IATA code) this project's Durable Object runs in. */
	colo: string | null;
	/** ISO country of that data center — approximates where the demo's visitor is. */
	coloCountry: string | null;
}

export interface AgentChatReply {
	question: string;
	topic: 'ai-analysis';
	answer: string;
	mode: 'workers-ai';
	model: string;
	userMessage: AgentChatMessage;
	agentMessage: AgentChatMessage;
}

export interface AgentChatMessage {
	id: string;
	role: 'user' | 'agent';
	content: string;
	createdAt: string;
}

interface BehavioralAnalytics {
	dau: number;
	wau: number;
	mau: number;
	gmailUsers: number;
	providers: { provider: string; users: number }[];
	countries: { country: string; sessions: number }[];
	activityByDay: { day: string; signups: number; signins: number }[];
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
const DEFAULT_ROLES: RoleDefinition[] = [
	{ name: 'user', permissions: [] },
	{ name: 'admin', permissions: ['*'] },
];

export class AuthAgent extends Agent<Env, AuthAgentState> {
	initialState: AuthAgentState = {
		projectId: '',
		provisionedAt: null,
		roles: DEFAULT_ROLES,
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
			getRolePermissions: (role) =>
				(this.state.roles ?? DEFAULT_ROLES).find((entry) => entry.name === role)?.permissions ?? [],
			google:
				this.socialCredentials.google ??
				(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET
					? { clientId: this.env.GOOGLE_CLIENT_ID, clientSecret: this.env.GOOGLE_CLIENT_SECRET }
					: undefined),
			github: this.socialCredentials.github,
			sendEmail:
				this.env.EMAIL && this.env.EMAIL_FROM
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
		this.socialCredentials = socialCredentialsSchema.parse(
			await this.ctx.storage.get('social-provider-credentials'),
		);

		const rolesValid =
			Array.isArray(this.state.roles) &&
			this.state.roles.every(
				(entry) => entry && typeof entry === 'object' && typeof entry.name === 'string',
			);
		if (!this.state.projectId) {
			this.setState({
				...this.state,
				projectId: this.name,
				provisionedAt: new Date().toISOString(),
				roles: DEFAULT_ROLES,
				allowedOrigins: [],
				enabledSocialProviders: this.configuredSocialProviders,
			});
			this.writeAuthEvent('project.provisioned');
			await this.recordEvent('project.provisioned', `auth provisioned for project "${this.name}"`);
		} else if (
			!Array.isArray(this.state.allowedOrigins) ||
			!Array.isArray(this.state.enabledSocialProviders) ||
			!rolesValid
		) {
			// State schema upgrade for agents provisioned before origin/role settings.
			this.setState({
				...this.state,
				roles: rolesValid ? this.state.roles : DEFAULT_ROLES,
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
		throw new Error('Cloudflare Email Service is not configured');
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
		if (!projectIdSchema.safeParse(this.name).success) {
			return Response.json({ error: 'invalid project id' }, { status: 400 });
		}
		// Requests arrive with the full /agents/auth-agent/<name>/... path.
		const subPath = url.pathname.match(/\/agents\/[^/]+\/[^/]+(\/.*)?$/)?.[1] ?? '/';

		if (subPath === '/overview') {
			return Response.json(await this.getOverview());
		}

		if (subPath === '/analytics') {
			const requestedTimeZone = url.searchParams.get('timeZone') ?? 'Etc/UTC';
			const timeZone = timeZoneSchema.safeParse(requestedTimeZone);
			if (!timeZone.success) {
				return Response.json({ error: 'invalid timeZone' }, { status: 400 });
			}
			return Response.json(await this.getAnalytics(timeZone.data));
		}

		if (subPath === '/config' && request.method === 'GET') {
			return Response.json({
				projectId: this.name,
				providers: ['email-password', 'anonymous', ...this.configuredSocialProviders],
				availableSocialProviders: ['google', 'github'],
				bearerTokens: true,
				emailDeliveryConfigured: !!(this.env.EMAIL && this.env.EMAIL_FROM),
			});
		}

		if (subPath === '/chat' && request.method === 'GET') {
			const clientKey = await this.chatClientKey(request);
			return Response.json({ messages: await this.getChatMessages(clientKey) });
		}

		if (subPath === '/chat' && request.method === 'POST') {
			const body = chatRequestSchema.safeParse(await request.json().catch(() => null));
			if (!body.success) {
				return Response.json({ error: 'question is required' }, { status: 400 });
			}
			const clientKey = await this.chatClientKey(request);
			try {
				return Response.json(await this.answerQuestion(body.data.question, clientKey));
			} catch (error) {
				console.error('AuthAgent AI request failed', error);
				return Response.json(
					{ error: 'Workers AI could not answer this request' },
					{ status: 502 },
				);
			}
		}

		const roleUpdate = subPath.match(/^\/admin\/users\/([^/]+)\/role$/);
		if (roleUpdate && request.method === 'PUT') {
			return this.setUserRole(this.decodeResourceId(roleUpdate[1]), request);
		}

		const userDelete = subPath.match(/^\/admin\/users\/([^/]+)$/);
		if (userDelete && request.method === 'DELETE') {
			return this.deleteUser(this.decodeResourceId(userDelete[1]));
		}

		const sessionDelete = subPath.match(/^\/admin\/sessions\/([^/]+)$/);
		if (sessionDelete && request.method === 'DELETE') {
			return this.revokeSession(this.decodeResourceId(sessionDelete[1]));
		}

		if (subPath === '/admin/roles' && request.method === 'PUT') {
			return this.updateRoles(request);
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
				const session = sessionActivityResponseSchema.safeParse(
					await response
						.clone()
						.json()
						.catch(() => null),
				);
				if (session.success && session.data) {
					await this.trackSessionActivity(session.data.user.id, session.data.session.id);
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

	private decodeResourceId(encoded: string): string {
		try {
			const parsed = resourceIdSchema.safeParse(decodeURIComponent(encoded));
			return parsed.success ? parsed.data : '';
		} catch {
			return '';
		}
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

	/** Replaces the assignable-role registry; built-in roles always remain. */
	private async updateRoles(request: Request): Promise<Response> {
		const body = rolesRequestSchema.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return Response.json(
				{ error: 'invalid roles — use 1-32 lowercase letters, digits or dashes' },
				{ status: 400 },
			);
		}
		this.setState({ ...this.state, roles: body.data.roles });
		return Response.json({ roles: body.data.roles });
	}

	private async setUserRole(userId: string, request: Request): Promise<Response> {
		if (!userId) {
			return Response.json({ error: 'invalid user id' }, { status: 400 });
		}
		const body = roleRequestSchema.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return Response.json(
				{ error: 'invalid role — use 1-32 lowercase letters, digits or dashes' },
				{ status: 400 },
			);
		}
		const knownRoles = this.state.roles ?? DEFAULT_ROLES;
		if (!knownRoles.some((entry) => entry.name === body.data.role)) {
			return Response.json(
				{ error: `unknown role "${body.data.role}" — define it in the Roles tab first` },
				{ status: 400 },
			);
		}
		const [existing] = await this.db
			.select({ id: schema.user.id, role: schema.user.role })
			.from(schema.user)
			.where(eq(schema.user.id, userId))
			.limit(1);
		if (!existing) return Response.json({ error: 'user not found' }, { status: 404 });
		if (existing.role !== body.data.role) {
			await this.db
				.update(schema.user)
				.set({ role: body.data.role, updatedAt: new Date() })
				.where(eq(schema.user.id, userId));
			await this.recordEvent('user.role-changed', `role "${body.data.role}" assigned`);
		}
		return Response.json({ id: userId, role: body.data.role });
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
		const body = settingsRequestSchema.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return Response.json(
				{ error: 'invalid settings', issues: body.error.flatten().fieldErrors },
				{ status: 400 },
			);
		}
		if (body.data.socialProviders !== undefined) {
			this.socialCredentials = applySocialCredentials(
				body.data.socialProviders,
				this.socialCredentials,
			);
			await this.ctx.storage.put('social-provider-credentials', this.socialCredentials);
		}
		const enabledSocialProviders = this.configuredSocialProviders;
		this.setState({
			...this.state,
			allowedOrigins: body.data.allowedOrigins,
			enabledSocialProviders,
		});
		this._auth = null;
		return Response.json({
			allowedOrigins: body.data.allowedOrigins,
			enabledSocialProviders,
		});
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
				role: schema.user.role,
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
			activityByDay: behavioral.activityByDay,
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
			activityByDay: [],
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
		const result = analyticsApiResponseSchema.parse(await response.json());
		return (result.data ?? []) as T[];
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
		if (!config && this.env.LOCAL_ANALYTICS) return this.queryLocalBehavioralAnalytics(timeZone);
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
		// Day buckets in the viewer's timezone; the dashboard filters 7/30/90-day
		// windows client-side from this 90-day series.
		const dailyCounts = (eventType: string) =>
			this.analyticsSql<{ day: string; count: number | string }>(
				`SELECT formatDateTime(timestamp, '%Y-%m-%d', '${timeZone}') AS day, SUM(_sample_interval) AS count ${from} AND blob1 = '${eventType}' AND timestamp > NOW() - INTERVAL '90' DAY GROUP BY day ORDER BY day`,
			);
		const [dau, wau, mau, providers, countries, signups, signins, gmail, events] =
			await Promise.all([
				activeUsers(1),
				activeUsers(7),
				activeUsers(30),
				this.analyticsSql<{ provider: string; users: number | string }>(
					`SELECT blob3 AS provider, count(DISTINCT blob4) AS users ${from} AND blob1 = 'user.active' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY provider ORDER BY users DESC`,
				),
				this.analyticsSql<{ country: string; sessions: number | string }>(
					`SELECT blob2 AS country, SUM(_sample_interval) AS sessions ${from} AND blob1 = 'session.created' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY country ORDER BY sessions DESC LIMIT 10`,
				),
				dailyCounts('user.created'),
				dailyCounts('session.created'),
				this.analyticsSql<{ users: number | string }>(
					`SELECT count(DISTINCT blob4) AS users ${from} AND blob1 = 'user.created' AND blob6 = 'gmail.com'`,
				),
				this.analyticsSql<{ eventType: string; count: number | string }>(
					`SELECT blob1 AS eventType, SUM(_sample_interval) AS count ${from} AND timestamp > NOW() - INTERVAL '1' DAY GROUP BY eventType ORDER BY count DESC`,
				),
			]);
		const activityByDay = new Map<string, { day: string; signups: number; signins: number }>();
		const dayEntry = (day: string) => {
			let entry = activityByDay.get(day);
			if (!entry) {
				entry = { day, signups: 0, signins: 0 };
				activityByDay.set(day, entry);
			}
			return entry;
		};
		for (const row of signups) dayEntry(row.day.slice(0, 10)).signups += Number(row.count);
		for (const row of signins) dayEntry(row.day.slice(0, 10)).signins += Number(row.count);
		const data: BehavioralAnalytics = {
			dau: Number(dau[0]?.users ?? 0),
			wau: Number(wau[0]?.users ?? 0),
			mau: Number(mau[0]?.users ?? 0),
			gmailUsers: Number(gmail[0]?.users ?? 0),
			providers: providers.map((row) => ({ ...row, users: Number(row.users) })),
			countries: countries.map((row) => ({ ...row, sessions: Number(row.sessions) })),
			activityByDay: [...activityByDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
			eventsLast24h: events.map((row) => ({ ...row, count: Number(row.count) })),
		};
		this.behavioralCache = { expiresAt: Date.now() + ANALYTICS_CACHE_MS, timeZone, data };
		return data;
	}

	private async queryLocalBehavioralAnalytics(timeZone: string): Promise<BehavioralAnalytics> {
		const db = this.env.LOCAL_ANALYTICS!;
		const since = (days: number) => Date.now() - days * 86_400_000;
		const bind = (sql: string, ...values: unknown[]) => db.prepare(sql).bind(this.name, ...values);
		const [dau, wau, mau, providers, countries, activity, gmail, events] = await db.batch([
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
				`SELECT timestamp, event_type FROM auth_events WHERE project_id=? AND event_type IN ('user.created','session.created') AND timestamp>?`,
				since(90),
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
		// D1's SQLite cannot group by an IANA-timezone day, so bucket activity
		// timestamps here in the viewer's timezone, matching the remote
		// formatDateTime(timestamp, '%Y-%m-%d', timeZone) queries.
		const dayFormatter = new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		});
		const activityByDay = new Map<string, { day: string; signups: number; signins: number }>();
		for (const row of rows<{ timestamp: number; event_type: string }>(activity)) {
			const day = dayFormatter.format(row.timestamp);
			let entry = activityByDay.get(day);
			if (!entry) {
				entry = { day, signups: 0, signins: 0 };
				activityByDay.set(day, entry);
			}
			if (row.event_type === 'user.created') entry.signups += 1;
			else entry.signins += 1;
		}
		return {
			dau: scalar(dau),
			wau: scalar(wau),
			mau: scalar(mau),
			gmailUsers: scalar(gmail),
			providers: rows(providers),
			countries: rows(countries),
			activityByDay: [...activityByDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
			eventsLast24h: rows(events),
		};
	}

	/**
	 * Answers a natural-language question about this project's auth data.
	 * Workers AI is mandatory: failures are surfaced to the caller and are
	 * never replaced with a response that only looks model-generated.
	 */
	private async chatClientKey(request: Request): Promise<string> {
		const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
		const address =
			request.headers.get('cf-connecting-ip') ??
			request.headers.get('x-real-ip') ??
			forwarded ??
			'local';
		const digest = await crypto.subtle.digest(
			'SHA-256',
			new TextEncoder().encode(`${this.name}:${address}`),
		);
		return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
			'',
		);
	}

	private async getChatMessages(clientKey: string, limit = 50): Promise<AgentChatMessage[]> {
		const rows = await this.db
			.select()
			.from(schema.chatMessage)
			.where(eq(schema.chatMessage.clientKey, clientKey))
			.orderBy(desc(schema.chatMessage.createdAt))
			.limit(limit);
		return rows.reverse().map((message) => ({
			id: message.id,
			role: message.role,
			content: message.content,
			createdAt: message.createdAt.toISOString(),
		}));
	}

	private async saveChatMessage(
		clientKey: string,
		role: AgentChatMessage['role'],
		content: string,
		createdAt: Date,
	): Promise<AgentChatMessage> {
		const message = { id: crypto.randomUUID(), clientKey, role, content, createdAt };
		await this.db.insert(schema.chatMessage).values(message);
		return { id: message.id, role, content, createdAt: createdAt.toISOString() };
	}

	async answerQuestion(question: string, clientKey: string): Promise<AgentChatReply> {
		const a = await this.getAnalytics();
		if (!this.env.AI) {
			throw new Error('Workers AI binding is required for the AuthAgent');
		}

		const history = await this.getChatMessages(clientKey, 20);
		const model = this.env.CHAT_MODEL ?? DEFAULT_CHAT_MODEL;
		const result = workersAiResponseSchema.parse(
			await this.env.AI.run(model as keyof AiModels, {
				messages: [
					{
						role: 'system',
						content:
							`You are the Cloudflarebase auth analytics agent for project "${this.name}". ` +
							'Answer only from the aggregated JSON supplied by the user. Never invent metrics. ' +
							'Be concise, explain useful ratios or trends when the data supports them, and say when there is not enough data. ' +
							'Do not claim you can modify users, sessions, or configuration.',
					},
					...history.map((message) => ({
						role: message.role === 'agent' ? ('assistant' as const) : ('user' as const),
						content: message.content,
					})),
					{
						role: 'user',
						content: `Question: ${question}\n\nAggregated auth analytics:\n${JSON.stringify(a)}`,
					},
				],
				max_tokens: 350,
				temperature: 0.2,
			}),
		);

		const answer = result.response?.trim();
		if (!answer) throw new Error('Workers AI returned an empty response');
		const createdAt = Date.now();
		const userMessage = await this.saveChatMessage(
			clientKey,
			'user',
			question,
			new Date(createdAt),
		);
		const agentMessage = await this.saveChatMessage(
			clientKey,
			'agent',
			answer,
			new Date(createdAt + 1),
		);
		return {
			question,
			topic: 'ai-analysis',
			answer,
			mode: 'workers-ai',
			model,
			userMessage,
			agentMessage,
		};
	}

	/** Resolved once per instance; a DO stays in one colo for its lifetime. */
	private coloCache: { colo: string | null; coloCountry: string | null } | null = null;

	/**
	 * Where this Durable Object physically runs. A cdn-cgi trace subrequest
	 * egresses at the DO's own data center, so `colo`/`loc` reveal its location
	 * (DOs are created near their first requester, approximating the visitor's
	 * region). Failures return nulls and are not cached, so a network hiccup
	 * does not pin "unknown" for the instance's lifetime.
	 */
	private async resolveColo(): Promise<{ colo: string | null; coloCountry: string | null }> {
		if (this.coloCache) return this.coloCache;
		try {
			const response = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
				signal: AbortSignal.timeout(1_500),
			});
			if (!response.ok) throw new Error(`trace responded with ${response.status}`);
			const fields = new Map(
				(await response.text()).split('\n').map((line) => line.split('=', 2) as [string, string]),
			);
			this.coloCache = {
				colo: fields.get('colo') ?? null,
				coloCountry: fields.get('loc') ?? null,
			};
			return this.coloCache;
		} catch {
			return { colo: null, coloCountry: null };
		}
	}

	/**
	 * Counts for the fleet admin rollup, called over Durable Object RPC from the
	 * worker entrypoint (/fleet/overview). Deliberately avoids getAnalytics() so
	 * a fleet sweep never fans out Analytics Engine SQL queries per project.
	 */
	async getFleetCounts(): Promise<FleetProjectCounts> {
		const [users] = await this.db.select({ n: count() }).from(schema.user);
		const [anonymousUsers] = await this.db
			.select({ n: count() })
			.from(schema.user)
			.where(eq(schema.user.isAnonymous, true));
		const [activeSessions] = await this.db
			.select({ n: count() })
			.from(schema.session)
			.where(gt(schema.session.expiresAt, new Date()));
		const total = users?.n ?? 0;
		const anonymous = anonymousUsers?.n ?? 0;
		return {
			projectId: this.name,
			users: total,
			registeredUsers: total - anonymous,
			anonymousUsers: anonymous,
			activeSessions: activeSessions?.n ?? 0,
			provisionedAt: this.state.provisionedAt,
			lastEventAt: this.state.lastEventAt,
			...(await this.resolveColo()),
		};
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
