import {
	agentUrl,
	assertProjectId,
	requireAuthAgent,
	toNativeResponse
} from '$lib/server/auth-agent';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ params, request, url, platform }) => {
	const projectId = assertProjectId(params.projectId);
	const agent = requireAuthAgent(platform);
	const response = await agent.fetch(agentUrl(url.origin, projectId, '/admin/settings'), {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: await request.text()
	});
	return toNativeResponse(response as unknown as Response);
};
