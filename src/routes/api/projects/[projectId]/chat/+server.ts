import {
	agentUrl,
	assertProjectId,
	requireAuthAgent,
	toNativeResponse
} from '$lib/server/auth-agent';
import type { RequestHandler } from './$types';

/** Ask the project's AuthAgent a question about its own auth data. */
export const POST: RequestHandler = async ({ params, request, url, platform }) => {
	const projectId = assertProjectId(params.projectId);
	const agent = requireAuthAgent(platform);

	const response = await agent.fetch(agentUrl(url.origin, projectId, '/chat'), {
		method: 'POST',
		headers: [...request.headers],
		body: await request.arrayBuffer()
	});
	return toNativeResponse(response as unknown as Response);
};
