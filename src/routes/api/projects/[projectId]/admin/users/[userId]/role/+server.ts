import {
	agentUrl,
	assertProjectId,
	requireAuthAgent,
	toNativeResponse
} from '$lib/server/auth-agent';
import { roleUpdateSchema } from '$lib/schemas/auth';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ params, request, url, platform }) => {
	const projectId = assertProjectId(params.projectId);
	const agent = requireAuthAgent(platform);
	const payload = roleUpdateSchema.safeParse(await request.json().catch(() => null));
	if (!payload.success) {
		return json(
			{ error: 'Invalid role', issues: payload.error.flatten().fieldErrors },
			{ status: 400 }
		);
	}
	const response = await agent.fetch(
		agentUrl(url.origin, projectId, `/admin/users/${encodeURIComponent(params.userId)}/role`),
		{
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload.data)
		}
	);
	return toNativeResponse(response as unknown as Response);
};
