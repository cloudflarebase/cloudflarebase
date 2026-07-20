import {
	agentUrl,
	assertProjectId,
	requireAuthAgent,
	toNativeResponse
} from '$lib/server/auth-agent';
import type { RequestHandler } from './$types';

/** Read or append the connecting client's durable project-agent conversation. */
const proxyChat: RequestHandler = async ({ params, request, url, platform }) => {
	const projectId = assertProjectId(params.projectId);
	const agent = requireAuthAgent(platform);

	const init: RequestInit = {
		method: 'POST',
		headers: [...request.headers]
	};
	if (request.method === 'POST') init.body = await request.arrayBuffer();
	else init.method = 'GET';
	const response = await agent.fetch(agentUrl(url.origin, projectId, '/chat'), init);
	return toNativeResponse(response as unknown as Response);
};

export const GET = proxyChat;
export const POST = proxyChat;
