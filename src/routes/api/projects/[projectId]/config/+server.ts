import { agentUrl, assertProjectId, requireAuthAgent } from '$lib/server/auth-agent';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, platform }) => {
	const projectId = assertProjectId(params.projectId);
	const agent = requireAuthAgent(platform);
	const response = await agent.fetch(agentUrl(url.origin, projectId, '/config'));
	if (!response.ok) return new Response(response.body, response);
	const capabilities = (await response.json()) as Record<string, unknown>;
	return Response.json(
		{
			...capabilities,
			authBaseUrl: `${url.origin}/api/projects/${projectId}/auth`,
			endpoints: {
				signUp: '/sign-up/email',
				signIn: '/sign-in/email',
				anonymous: '/sign-in/anonymous',
				session: '/get-session',
				signOut: '/sign-out',
				requestPasswordReset: '/request-password-reset',
				resetPassword: '/reset-password'
			}
		},
		{ headers: { 'access-control-allow-origin': '*' } }
	);
};
