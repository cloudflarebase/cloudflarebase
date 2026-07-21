import {
	agentUrl,
	assertProjectId,
	requireAuthAgent,
	toNativeResponse
} from '$lib/server/auth-agent';
import { rolesUpdateSchema } from '$lib/schemas/auth';
import { json, type RequestHandler } from '@sveltejs/kit';

export const PUT: RequestHandler = async ({ params, request, url, platform }) => {
	const projectId = assertProjectId(params.projectId);
	const agent = requireAuthAgent(platform);
	const payload = rolesUpdateSchema.safeParse(await request.json().catch(() => null));
	if (!payload.success) {
		return json(
			{ error: 'Invalid roles', issues: payload.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}
	const response = await agent.fetch(agentUrl(url.origin, projectId, '/admin/roles'), {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload.data)
	});
	return toNativeResponse(response as unknown as Response);
};
