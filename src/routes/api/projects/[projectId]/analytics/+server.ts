import {
	agentUrl,
	assertProjectId,
	requireAuthAgent,
	toNativeResponse
} from '$lib/server/auth-agent';
import type { RequestHandler } from './$types';

/** Aggregated auth analytics (DAU/MAU, user types, providers, countries). */
export const GET: RequestHandler = async ({ params, url, platform }) => {
	const projectId = assertProjectId(params.projectId);
	const agent = requireAuthAgent(platform);

	const response = await agent.fetch(agentUrl(url.origin, projectId, '/analytics'));
	return toNativeResponse(response as unknown as Response);
};
