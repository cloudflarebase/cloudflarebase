import { assertProjectId, toNativeResponse } from '$lib/server/auth-agent';
import { forwardToRegistry } from '$lib/server/registry';
import type { RequestHandler } from './$types';

/** Deletes a project's registration and erases its AuthAgent. Operator-only. */
export const DELETE: RequestHandler = async ({ params, platform, url }) => {
	const projectId = assertProjectId(params.projectId);
	const response = await forwardToRegistry(
		platform,
		url.origin,
		`/projects/${encodeURIComponent(projectId)}`,
		{ method: 'DELETE' }
	);
	return toNativeResponse(response);
};
