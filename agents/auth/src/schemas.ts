import { z } from 'zod';

export const resourceIdSchema = z.string().min(1).max(128);
export const projectIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);

export const timeZoneSchema = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.refine((value) => {
		try {
			new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
			return true;
		} catch {
			return false;
		}
	}, 'Invalid IANA time zone');

const roleSlugSchema = z
	.string()
	.trim()
	.regex(/^[a-z][a-z0-9-]{0,31}$/, 'invalid role');

// Clerk-style permission keys: `resource:action` segments, or `*` for all.
const permissionSchema = z
	.string()
	.trim()
	.max(64)
	.regex(/^(\*|[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)*)$/, 'invalid permission');

const roleDefinitionSchema = z.strictObject({
	name: roleSlugSchema,
	permissions: z.array(permissionSchema).max(50),
});

export const roleRequestSchema = z.strictObject({ role: roleSlugSchema });

// The built-in roles always exist so assignment and the dashboard default set
// can rely on them; duplicate names collapse to the last definition.
export const rolesRequestSchema = z
	.strictObject({ roles: z.array(roleDefinitionSchema).max(20) })
	.transform(({ roles }) => {
		const byName = new Map<string, string[]>();
		byName.set('user', []);
		byName.set('admin', ['*']);
		for (const role of roles) byName.set(role.name, [...new Set(role.permissions)]);
		return { roles: [...byName].map(([name, permissions]) => ({ name, permissions })) };
	});

/**
 * Project ids the registry refuses: `console` is the operator auth instance,
 * the rest would collide with dashboard routes or read as system endpoints.
 * Mirrored in the app's src/lib/console.ts; keep both in sync.
 */
export const RESERVED_PROJECT_IDS = new Set([
	'console',
	'admin',
	'api',
	'agents',
	'auth',
	'dashboard',
	'login',
	'logout',
	'setup',
	'new',
	'health',
	'fleet',
]);

export const createProjectRequestSchema = z.strictObject({
	id: projectIdSchema.refine(
		(value) => !RESERVED_PROJECT_IDS.has(value),
		'that project id is reserved',
	),
	name: z.string().trim().min(1, 'name is required').max(64),
});

export const chatRequestSchema = z.strictObject({
	question: z.string().trim().min(1, 'question is required').max(500),
});

const allowedOriginSchema = z
	.string()
	.max(2048)
	.transform((value, context) => {
		try {
			const url = new URL(value);
			const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
			if (
				(url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
				url.origin !== value
			) {
				throw new Error('invalid origin');
			}
			return url.origin;
		} catch {
			context.addIssue({ code: 'custom', message: `invalid origin: ${value}` });
			return z.NEVER;
		}
	});

export const socialCredentialsSchema = z
	.strictObject({
		google: z
			.strictObject({
				clientId: z.string().trim().min(1).max(512),
				clientSecret: z.string().trim().min(1).max(512),
			})
			.optional(),
		github: z
			.strictObject({
				clientId: z.string().trim().min(1).max(512),
				clientSecret: z.string().trim().min(1).max(512),
			})
			.optional(),
	})
	.catch({});

const providerUpdateSchema = z.union([
	z.strictObject({ preserve: z.literal(true) }),
	z.strictObject({
		clientId: z.string().trim().min(1).max(512),
		clientSecret: z.string().trim().min(1).max(512),
	}),
]);

export const settingsRequestSchema = z
	.strictObject({
		allowedOrigins: z.array(allowedOriginSchema).max(10),
		socialProviders: z
			.strictObject({
				google: providerUpdateSchema.optional(),
				github: providerUpdateSchema.optional(),
			})
			.optional(),
	})
	.transform((value) => ({
		...value,
		allowedOrigins: [...new Set(value.allowedOrigins)],
	}));

export const sessionActivityResponseSchema = z
	.object({
		user: z.object({ id: resourceIdSchema }),
		session: z.object({ id: resourceIdSchema }),
	})
	.nullable();

export const analyticsApiResponseSchema = z.object({ data: z.array(z.unknown()).optional() });

export const workersAiResponseSchema = z.object({ response: z.string().trim().min(1).max(20_000) });

export type SocialCredentials = z.infer<typeof socialCredentialsSchema>;
export type ProviderUpdates = NonNullable<z.infer<typeof settingsRequestSchema>['socialProviders']>;
