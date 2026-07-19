import type { AuthOverview } from '$lib/agents';
import { agentUrl, assertProjectId, requireAuthAgent } from '$lib/server/auth-agent';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Project Overview — a light snapshot for the product cards. */
export const load: PageServerLoad = async ({ params, url, platform }) => {
	const projectId = assertProjectId(params.projectId);
	const agent = requireAuthAgent(platform);

	const response = await agent.fetch(agentUrl(url.origin, projectId, '/overview'));
	if (!response.ok) {
		error(502, `auth agent responded with ${response.status}`);
	}
	const overview = (await response.json()) as AuthOverview;

	return { projectId, overview };
};
