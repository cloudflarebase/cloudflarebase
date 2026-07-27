import {
	agentChatReplySchema,
	authAgentStateSchema,
	authAnalyticsSchema,
	authOverviewSchema,
	overviewSessionSchema,
	overviewUserSchema,
	roleDefinitionSchema
} from '$lib/agents';
import {
	chatRequestSchema,
	roleUpdateSchema,
	rolesUpdateSchema,
	settingsPayloadSchema,
	signInSchema,
	signUpSchema
} from '$lib/schemas/auth';
import { z } from 'zod';

/**
 * OpenAPI 3.1 document for a single project's API, generated from the same zod
 * schemas the routes validate with - so the reference cannot drift from the
 * implementation the way hand-written docs do.
 *
 * The document is per project and carries that project's real base URL, which
 * makes it directly usable: point codegen at it, or read it in the dashboard's
 * API tab with every example already addressed to the right endpoint.
 *
 * OpenAPI 3.1 is a superset of JSON Schema draft 2020-12, which is exactly
 * what z.toJSONSchema emits, so the component schemas need no translation.
 */

const AUTH_TAG = 'Authentication';
const CONSOLE_TAG = 'Console';

/** Named schemas that become components.schemas entries. */
const registry = z.registry<{ id: string }>();
for (const schema of [
	signUpSchema,
	signInSchema,
	chatRequestSchema,
	settingsPayloadSchema,
	rolesUpdateSchema,
	roleUpdateSchema,
	authOverviewSchema,
	authAnalyticsSchema,
	authAgentStateSchema,
	overviewUserSchema,
	overviewSessionSchema,
	roleDefinitionSchema,
	agentChatReplySchema
]) {
	const id = schema.meta()?.id;
	// Fail at import rather than per request: a schema without an id would
	// otherwise turn every document fetch into a 500 from ref() below.
	if (!id) throw new Error('every schema in the OpenAPI registry needs .meta({ id })');
	registry.add(schema, { id });
}

function ref(schema: { meta(): { id?: string } | undefined }): { $ref: string } {
	const id = schema.meta()?.id;
	if (!id) throw new Error('schema is missing a meta id');
	return { $ref: `#/components/schemas/${id}` };
}

function jsonBody(schema: Parameters<typeof ref>[0], description: string) {
	return {
		description,
		required: true,
		content: { 'application/json': { schema: ref(schema) } }
	};
}

function jsonResponse(schema: Parameters<typeof ref>[0], description: string) {
	return {
		description,
		content: { 'application/json': { schema: ref(schema) } }
	};
}

const UNAUTHORIZED = {
	description: 'No operator session. The console guard rejects the request.'
};

function buildComponents(): Record<string, unknown> {
	const { schemas } = z.toJSONSchema(registry, {
		target: 'draft-2020-12',
		io: 'input',
		uri: (id) => `#/components/schemas/${id}`
	}) as { schemas: Record<string, Record<string, unknown>> };

	// OpenAPI carries these at the document level, not per component schema.
	for (const schema of Object.values(schemas)) {
		delete schema.$schema;
		delete schema.$id;
	}
	return schemas;
}

export interface OpenApiOptions {
	projectId: string;
	/** Origin the document should address, e.g. https://console.example.com */
	origin: string;
}

export function buildOpenApiDocument({ projectId, origin }: OpenApiOptions) {
	const base = `${origin}/api/projects/${projectId}`;

	return {
		openapi: '3.1.0',
		info: {
			title: `Cloudflarebase - ${projectId}`,
			version: '1.0.0',
			description: [
				`API for the \`${projectId}\` project.`,
				'',
				'**Authentication** endpoints are public - they are what your application calls.',
				'Browsers on the same origin receive a session cookie; other clients read the',
				'`set-auth-token` response header and send it as a bearer token.',
				'',
				'**Console** endpoints read and mutate the project itself and require an',
				'operator session on the console.'
			].join('\n')
		},
		servers: [{ url: base, description: 'This project' }],
		tags: [
			{ name: AUTH_TAG, description: 'Public endpoints your application calls.' },
			{ name: CONSOLE_TAG, description: 'Operator endpoints for managing the project.' }
		],
		components: {
			schemas: buildComponents(),
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					description: 'Token from the `set-auth-token` header returned on sign-in or sign-up.'
				},
				sessionCookie: {
					type: 'apiKey',
					in: 'cookie',
					name: `cfb-${projectId}.session_token`,
					description: 'Set automatically for same-origin browser clients.'
				}
			}
		},
		paths: {
			'/auth/sign-up/email': {
				post: {
					tags: [AUTH_TAG],
					summary: 'Create an account',
					description:
						'Signs the new user in and returns a session. External clients should read the `set-auth-token` response header.',
					requestBody: jsonBody(signUpSchema, 'The account to create.'),
					responses: {
						'200': { description: 'Account created and signed in.' },
						'422': { description: 'Validation failed, or the email is already registered.' },
						'429': { description: 'Rate limited, or a demo project reached its user ceiling.' }
					}
				}
			},
			'/auth/sign-in/email': {
				post: {
					tags: [AUTH_TAG],
					summary: 'Sign in',
					requestBody: jsonBody(signInSchema, 'Credentials.'),
					responses: {
						'200': { description: 'Signed in.' },
						'401': { description: 'Incorrect email or password.' },
						'429': { description: 'Rate limited.' }
					}
				}
			},
			'/auth/sign-in/anonymous': {
				post: {
					tags: [AUTH_TAG],
					summary: 'Sign in as a guest',
					description:
						'Creates a throwaway identity with no credentials. Guests can hold roles and can be upgraded later.',
					responses: {
						'200': { description: 'Guest session created.' },
						'403': { description: 'Guest sign-in is disabled for this project.' }
					}
				}
			},
			'/auth/get-session': {
				get: {
					tags: [AUTH_TAG],
					summary: 'Read the current session',
					security: [{ bearerAuth: [] }, { sessionCookie: [] }],
					responses: {
						'200': { description: 'The session and user, or null when signed out.' }
					}
				}
			},
			'/auth/sign-out': {
				post: {
					tags: [AUTH_TAG],
					summary: 'Sign out',
					security: [{ bearerAuth: [] }, { sessionCookie: [] }],
					responses: { '200': { description: 'Session revoked.' } }
				}
			},
			'/auth/token': {
				get: {
					tags: [AUTH_TAG],
					summary: 'Issue a project-signed JWT',
					description:
						"Returns a JWT carrying `email`, `role`, and `permissions` claims, signed with this project's key. Verify it offline against `/auth/jwks`.",
					security: [{ bearerAuth: [] }, { sessionCookie: [] }],
					responses: {
						'200': { description: 'The signed token.' },
						'401': { description: 'No session.' }
					}
				}
			},
			'/auth/jwks': {
				get: {
					tags: [AUTH_TAG],
					summary: 'Public keys for this project',
					description: 'JSON Web Key Set used to verify tokens from `/auth/token`.',
					responses: { '200': { description: 'The key set.' } }
				}
			},
			'/config': {
				get: {
					tags: [AUTH_TAG],
					summary: 'Public client configuration',
					description: 'Enabled providers and capabilities. Never returns provider secrets.',
					responses: { '200': { description: 'Safe client configuration.' } }
				}
			},
			'/overview': {
				get: {
					tags: [CONSOLE_TAG],
					summary: 'Users, sessions, and live project state',
					security: [{ sessionCookie: [] }],
					responses: {
						'200': jsonResponse(authOverviewSchema, 'Current users and sessions.'),
						'401': UNAUTHORIZED
					}
				}
			},
			'/analytics': {
				get: {
					tags: [CONSOLE_TAG],
					summary: 'Operational and behavioural aggregates',
					parameters: [
						{
							name: 'timeZone',
							in: 'query',
							required: false,
							schema: { type: 'string' },
							description: 'IANA time zone used to bucket daily activity. Defaults to Etc/UTC.'
						}
					],
					security: [{ sessionCookie: [] }],
					responses: {
						'200': jsonResponse(authAnalyticsSchema, 'Aggregates for this project.'),
						'400': { description: 'Invalid time zone.' },
						'401': UNAUTHORIZED
					}
				}
			},
			'/chat': {
				post: {
					tags: [CONSOLE_TAG],
					summary: 'Ask the project agent a question',
					description: "Workers AI answer grounded in this project's own auth data.",
					security: [{ sessionCookie: [] }],
					requestBody: jsonBody(chatRequestSchema, 'The question.'),
					responses: {
						'200': jsonResponse(agentChatReplySchema, 'The answer and the stored message pair.'),
						'401': UNAUTHORIZED,
						'429': { description: 'A demo project reached its daily inference ceiling.' },
						'502': { description: 'Inference failed. Auth and analytics are unaffected.' }
					}
				}
			},
			'/admin/settings': {
				put: {
					tags: [CONSOLE_TAG],
					summary: 'Update trusted origins and social credentials',
					security: [{ sessionCookie: [] }],
					requestBody: jsonBody(settingsPayloadSchema, 'Settings to apply.'),
					responses: {
						'200': { description: 'Settings applied.' },
						'400': { description: 'Validation failed.' },
						'401': UNAUTHORIZED
					}
				}
			},
			'/admin/roles': {
				put: {
					tags: [CONSOLE_TAG],
					summary: 'Replace the role registry',
					description: 'The built-in `user` and `admin` roles always remain.',
					security: [{ sessionCookie: [] }],
					requestBody: jsonBody(rolesUpdateSchema, 'The complete role registry.'),
					responses: {
						'200': { description: 'Registry replaced.' },
						'400': { description: 'Validation failed.' },
						'401': UNAUTHORIZED
					}
				}
			},
			'/admin/users/{userId}/role': {
				put: {
					tags: [CONSOLE_TAG],
					summary: "Assign a user's role",
					description: 'The only writer of `user.role`; sign-up cannot self-assign one.',
					security: [{ sessionCookie: [] }],
					parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
					requestBody: jsonBody(roleUpdateSchema, 'The role to assign.'),
					responses: {
						'200': { description: 'Role assigned.' },
						'400': { description: 'Unknown role.' },
						'401': UNAUTHORIZED
					}
				}
			},
			'/admin/users/{userId}': {
				delete: {
					tags: [CONSOLE_TAG],
					summary: 'Delete a user',
					description: 'Removes the user and every session belonging to them.',
					security: [{ sessionCookie: [] }],
					parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
					responses: {
						'200': { description: 'User deleted.' },
						'401': UNAUTHORIZED,
						'404': { description: 'No such user.' }
					}
				}
			},
			'/admin/sessions/{sessionId}': {
				delete: {
					tags: [CONSOLE_TAG],
					summary: 'Revoke a session',
					security: [{ sessionCookie: [] }],
					parameters: [
						{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }
					],
					responses: {
						'200': { description: 'Session revoked.' },
						'401': UNAUTHORIZED,
						'404': { description: 'No such session.' }
					}
				}
			}
		}
	};
}
