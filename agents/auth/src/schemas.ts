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
