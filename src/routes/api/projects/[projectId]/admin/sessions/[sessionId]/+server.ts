import {
	agentUrl,
	assertProjectId,
	requireAuthAgent,
	toNativeResponse
} from '$lib/server/auth-agent';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, url, platform }) => {
	const projectId = assertProjectId(params.projectId);
	const agent = requireAuthAgent(platform);
	const response = await agent.fetch(
		agentUrl(url.origin, projectId, `/admin/sessions/${encodeURIComponent(params.sessionId)}`),
		{ method: 'DELETE' }
	);
	return toNativeResponse(response as unknown as Response);
};
