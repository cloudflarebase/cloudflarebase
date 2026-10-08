/**
 * Shared building blocks for per-agent OpenAPI modules. Lives in its own
 * module (not index.ts) so agent modules can import helpers without a
 * circular import against the composer that imports them.
 */

/** Structural zod-schema surface the helpers need - keeps generics out. */
export interface NamedSchema {
	meta(): { id?: string } | undefined;
}

/** One agent's contribution to the per-project document. */
export interface AgentOpenApiModule {
	tags: { name: string; description: string }[];
	/** Schemas that become components.schemas entries; each needs .meta({ id }). */
	schemas: NamedSchema[];
	/** Path items keyed relative to the project base (/api/projects/<id>). */
	paths: Record<string, unknown>;
}

export function ref(schema: NamedSchema): { $ref: string } {
	const id = schema.meta()?.id;
	if (!id) throw new Error('schema is missing a meta id');
	return { $ref: `#/components/schemas/${id}` };
}

export function jsonBody(schema: NamedSchema, description: string) {
	return {
		description,
		required: true,
		content: { 'application/json': { schema: ref(schema) } }
	};
}

export function jsonResponse(schema: NamedSchema, description: string) {
	return {
		description,
		content: { 'application/json': { schema: ref(schema) } }
	};
}

export const UNAUTHORIZED = {
	description: 'No operator session. The console guard rejects the request.'
};

/**
 * Operator surfaces a SERVICE KEY also opens: an operator session or a
 * `cfbs_` bearer, either one.
 *
 * Apply this only where `isServiceKeySurface` actually admits a key - the db
 * and storage prefixes, the auth agent's `/admin/*`, `/overview`, and
 * `/analytics`. Everything else (the registry, `/chat`) stays
 * session-only, and saying otherwise in the reference would send people to
 * write code against a 401.
 */
export const OPERATOR_SECURITY = [{ sessionCookie: [] }, { serviceKey: [] }];
