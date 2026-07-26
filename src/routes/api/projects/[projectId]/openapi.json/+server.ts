import { buildOpenApiDocument } from '$lib/openapi';
import { assertProjectId } from '$lib/server/auth-agent';
import type { RequestHandler } from './$types';

/**
 * OpenAPI 3.1 description of this project's API.
 *
 * Deliberately public, like /config: it documents the endpoints a customer's
 * application already calls, contains no secrets, and being fetchable is the
 * point — client generators and API tools can be pointed straight at it.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const projectId = assertProjectId(params.projectId);

	return Response.json(buildOpenApiDocument({ projectId, origin: url.origin }), {
		headers: { 'cache-control': 'public, max-age=300' }
	});
};
