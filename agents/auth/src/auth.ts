import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous, bearer, jwt } from 'better-auth/plugins';
import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import * as schema from './db/schema';

export type AuthDatabase = DrizzleSqliteDODatabase<typeof schema>;

export interface AuthHookUser {
	id: string;
	email: string;
	name: string;
	isAnonymous?: boolean | null;
}

export interface ProjectAuthConfig {
	/** Cloudflarebase project id — one AuthAgent (and one auth database) per project. */
	projectId: string;
	/** Drizzle handle over the Durable Object's embedded SQLite database. */
	db: AuthDatabase;
	secret: string;
	/** Origins allowed to call this project's auth endpoints (CSRF protection). */
	trustedOrigins: string[];
	/** Disable throttling only in an isolated automated-test environment. */
	disableRateLimit?: boolean;
	/** Country of the request currently being handled (from request.cf). */
	getRequestCountry?: () => string | null;
	/** Resolves a role name to its granted permission keys (from agent state). */
	getRolePermissions?: (role: string) => string[];
	/** Optional Google OAuth credentials (per-project social sign-in). */
	google?: { clientId: string; clientSecret: string };
	github?: { clientId: string; clientSecret: string };
	sendEmail?: (message: {
		type: 'email-verification' | 'password-reset';
		to: string;
		url: string;
	}) => Promise<void>;
	/**
	 * Veto over user creation, consulted at the database layer. Returning a
	 * reason string rejects the creation with 403. Route-level checks cannot
	 * cover every path that creates a user — social sign-in creates one
	 * implicitly on the OAuth callback without touching any sign-up route — so
	 * an instance that must not grow (the console) enforces it here.
	 */
	denyUserCreation?: () => Promise<string | null>;
	onUserCreated?: (user: AuthHookUser) => void | Promise<void>;
	onSessionActivity?: (
		session: { id: string; userId: string },
		kind: 'created' | 'refreshed',
	) => void | Promise<void>;
}

/**
 * Builds the Better Auth instance for a single project. All auth tables
 * (user, session, account, verification) live inside the project's Durable
 * Object SQLite database, so every project gets a fully isolated auth stack.
 */
export function createProjectAuth(config: ProjectAuthConfig) {
	return betterAuth({
		appName: `cloudflarebase:${config.projectId}`,
		basePath: '/api/auth',
		secret: config.secret,
		trustedOrigins: config.trustedOrigins,
		database: drizzleAdapter(config.db, {
			provider: 'sqlite',
			schema,
			// DO SQLite exposes only sync transactions; run operations sequentially.
			transaction: false,
		}),
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 8,
			maxPasswordLength: 128,
			revokeSessionsOnPasswordReset: true,
			sendResetPassword: config.sendEmail
				? async ({ user, url }) =>
						config.sendEmail?.({ type: 'password-reset', to: user.email, url })
				: undefined,
		},
		emailVerification: config.sendEmail
			? {
					sendOnSignUp: true,
					sendVerificationEmail: async ({ user, url }) =>
						config.sendEmail?.({ type: 'email-verification', to: user.email, url }),
				}
			: undefined,
		rateLimit: {
			enabled: !config.disableRateLimit,
			window: 60,
			max: 100,
			customRules: {
				'/sign-in/email': { window: 60, max: 10 },
				'/sign-up/email': { window: 60, max: 10 },
				'/sign-in/anonymous': { window: 60, max: 20 },
			},
		},
		// Guest sign-in (POST /sign-in/anonymous) — adds user.isAnonymous.
		plugins: [
			anonymous(),
			bearer(),
			// GET /token issues a project-signed JWT (public keys on GET /jwks)
			// carrying the user's role so external services can authorize offline.
			jwt({
				jwt: {
					issuer: `cloudflarebase:${config.projectId}`,
					audience: config.projectId,
					definePayload: ({ user }) => {
						const role = (user as { role?: string }).role ?? 'user';
						return {
							email: user.email,
							role,
							permissions: config.getRolePermissions?.(role) ?? [],
						};
					},
				},
			}),
		],
		socialProviders: {
			...(config.google ? { google: config.google } : {}),
			...(config.github ? { github: config.github } : {}),
		},
		user: {
			additionalFields: {
				// Simple RBAC. input: false blocks self-assignment at sign-up; the
				// dashboard's admin route is the only writer.
				role: { type: 'string', required: false, defaultValue: 'user', input: false },
			},
		},
		session: {
			additionalFields: {
				country: { type: 'string', required: false, input: false },
			},
		},
		advanced: {
			// Scope cookies per project so multiple project dashboards on the
			// same origin don't clobber each other's sessions.
			cookiePrefix: `cfb-${config.projectId}`,
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						const denied = await config.denyUserCreation?.();
						if (denied) {
							throw new APIError('FORBIDDEN', { message: denied });
						}
						return { data: user };
					},
					after: async (user) => {
						await config.onUserCreated?.(user as AuthHookUser);
					},
				},
			},
			session: {
				create: {
					// Stamp the session with the country Cloudflare resolved for
					// the request that created it.
					before: async (session) => ({
						data: { ...session, country: config.getRequestCountry?.() ?? null },
					}),
					after: async (session) => {
						await config.onSessionActivity?.(session, 'created');
					},
				},
				update: {
					after: async (session) => {
						await config.onSessionActivity?.(session, 'refreshed');
					},
				},
			},
		},
	});
}

export type ProjectAuth = ReturnType<typeof createProjectAuth>;
