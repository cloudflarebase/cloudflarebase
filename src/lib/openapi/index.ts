import { z } from 'zod';
import { authOpenApi } from './auth';
import { consoleOpenApi } from './console';
import { dbOpenApi } from './db';
import { storageOpenApi } from './storage';
import type { AgentOpenApiModule } from './shared';

/**
 * OpenAPI 3.1 document for a single project's API, generated from the same zod
 * schemas the routes validate with - so the reference cannot drift from the
 * implementation the way hand-written docs do.
 *
 * Each agent contributes a module (tags, component schemas, path items); this
 * composer merges them into one document per project carrying that project's
 * real base URL, which makes it directly usable: point codegen at it, or read
 * it in the dashboard's API tab with every example already addressed to the
 * right endpoint.
 *
 * OpenAPI 3.1 is a superset of JSON Schema draft 2020-12, which is exactly
 * what z.toJSONSchema emits, so the component schemas need no translation.
 */

const MODULES: AgentOpenApiModule[] = [authOpenApi, dbOpenApi, storageOpenApi, consoleOpenApi];

/** Named schemas that become components.schemas entries. */
const registry = z.registry<{ id: string }>();
for (const module of MODULES) {
	for (const schema of module.schemas) {
		const id = schema.meta()?.id;
		// Fail at import rather than per request: a schema without an id would
		// otherwise turn every document fetch into a 500 from ref().
		if (!id) throw new Error('every schema in the OpenAPI registry needs .meta({ id })');
		registry.add(schema as z.ZodType, { id });
	}
}

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
		tags: MODULES.flatMap((module) => module.tags),
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
				},
				serviceKey: {
					type: 'http',
					scheme: 'bearer',
					description:
						'A project service key (`cfbs_...`), minted on the project Settings page and shown once. ' +
						'The credential a SERVER holds when there is no signed-in user to relay - a cron, a queue ' +
						'consumer, a webhook handler, a seed script. Admin-grade on this project’s data plane: ' +
						'it bypasses access modes, document validators, and permission keys exactly as an operator ' +
						'session does, and it is scoped to THIS project only - not to sibling branches, because for ' +
						'data the branch is the isolation boundary. It cannot mint credentials, re-role operators, ' +
						'or delete its own project. ' +
						'**Any request carrying an `Origin` header is refused, whatever the key**, so a key pasted ' +
						'into frontend code fails at your desk instead of shipping in a JS bundle; server HTTP ' +
						'clients send no Origin. Note that SvelteKit refuses form content types (`text/plain`, ' +
						'`multipart/form-data`, `application/x-www-form-urlencoded`) on originless writes - send ' +
						'`application/json` or `application/octet-stream`.'
				}
			}
		},
		paths: Object.assign({}, ...MODULES.map((module) => module.paths)) as Record<string, unknown>
	};
}
