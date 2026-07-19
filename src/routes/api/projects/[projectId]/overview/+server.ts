import {
	agentUrl,
	assertProjectId,
	requireAuthAgent,
	toNativeResponse
} from '$lib/server/auth-agent';
import type { RequestHandler } from './$types';

/** Polling endpoint: snapshot of a project's auth state from its AuthAgent. */
export const GET: RequestHandler = async ({ params, url, platform }) => {
	const projectId = assertProjectId(params.projectId);
	const agent = requireAuthAgent(platform);

	const response = await agent.fetch(agentUrl(url.origin, projectId, '/overview'));
	return toNativeResponse(response as unknown as Response);
};
