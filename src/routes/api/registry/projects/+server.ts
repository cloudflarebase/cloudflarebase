import { forwardToRegistry, listProjects } from '$lib/server/registry';
import { toNativeResponse } from '$lib/server/auth-agent';
import type { RequestHandler } from './$types';

/**
 * Project registry for this installation. Operator-only: the console guard in
 * hooks.server.ts rejects everything under /api that is not explicitly public,
 * so these handlers never run without a session.
 */

export const GET: RequestHandler = async ({ platform, url }) => {
	return Response.json({ projects: await listProjects(platform, url.origin) });
};

export const POST: RequestHandler = async ({ platform, request, url }) => {
	const response = await forwardToRegistry(platform, url.origin, '/projects', {
		method: 'POST',
		body: await request.arrayBuffer()
	});
	return toNativeResponse(response);
};
