import { createProject, listProjects } from '$lib/server/registry';
import type { RequestHandler } from './$types';

/**
 * Project registry for this installation. Operator-only: the console guard in
 * hooks.server.ts rejects everything under /api that is not explicitly public,
 * so these handlers never run without a session.
 */

export const GET: RequestHandler = async ({ platform }) => {
	return Response.json({ projects: await listProjects(platform) });
};

export const POST: RequestHandler = async ({ platform, request }) => {
	const result = await createProject(platform, await request.json().catch(() => null));

	if (!result.ok) {
		return Response.json({ error: result.error }, { status: result.status });
	}
	return Response.json({ project: result.project }, { status: 201 });
};
