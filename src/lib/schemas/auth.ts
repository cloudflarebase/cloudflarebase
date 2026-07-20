import { z } from 'zod';

export const projectIdSchema = z
	.string()
	.regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'Use lowercase letters, numbers, and hyphens only.');

export const signUpSchema = z.object({
	name: z.string().trim().min(2, 'Enter at least 2 characters.').max(80),
	email: z.email('Enter a valid email address.'),
	password: z.string().min(8, 'Password must be at least 8 characters.').max(128)
});

export const signInSchema = z.object({
	email: z.email('Enter a valid email address.'),
	password: z.string().min(1, 'Enter your password.').max(128)
});

const providerCredentialsSchema = z.union([
	z.object({ preserve: z.literal(true) }),
	z.object({
		clientId: z.string().trim().min(1).max(512),
		clientSecret: z.string().min(1).max(2048)
	})
]);

export const settingsPayloadSchema = z.object({
	allowedOrigins: z.array(z.url()).max(50),
	socialProviders: z
		.object({
			google: providerCredentialsSchema.optional(),
			github: providerCredentialsSchema.optional()
		})
		.strict()
		.default({})
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
