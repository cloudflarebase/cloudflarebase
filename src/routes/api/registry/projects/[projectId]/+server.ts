import { assertProjectId } from '$lib/server/auth-agent';
import { deleteProject } from '$lib/server/registry';
import type { RequestHandler } from './$types';

/**
 * Deletes a project's registration and erases its data in every agent.
 * Operator-only, via the console guard.
 */
export const DELETE: RequestHandler = async ({ params, platform }) => {
	const projectId = assertProjectId(params.projectId);
	const result = await deleteProject(platform, projectId);

	if (!result.ok) {
		return Response.json({ error: result.error }, { status: result.status });
	}

	// 207 when the registration is gone but an agent could not be reached: the
	// console is consistent, yet the project's data outlived its registration.
	return result.warning
		? Response.json({ deleted: true, warning: result.warning }, { status: 207 })
		: Response.json({ deleted: true });
};
