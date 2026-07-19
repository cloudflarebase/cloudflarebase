import type { AuthAnalytics, AuthOverview } from '$lib/agents';
import { agentUrl, assertProjectId, requireAuthAgent } from '$lib/server/auth-agent';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, platform }) => {
	const projectId = assertProjectId(params.projectId);
	const agent = requireAuthAgent(platform);

	const [overviewRes, analyticsRes] = await Promise.all([
		agent.fetch(agentUrl(url.origin, projectId, '/overview')),
		agent.fetch(agentUrl(url.origin, projectId, '/analytics'))
	]);
	if (!overviewRes.ok || !analyticsRes.ok) {
		error(502, `auth agent responded with ${overviewRes.status}/${analyticsRes.status}`);
	}

	return {
		projectId,
		overview: (await overviewRes.json()) as AuthOverview,
		analytics: (await analyticsRes.json()) as AuthAnalytics
	};
};
