import { error } from '@sveltejs/kit';
import { projectIdSchema } from '$lib/schemas/auth';

/** Project ids become Durable Object names and cookie prefixes — keep them tame. */
export function assertProjectId(projectId: string | undefined): string {
	const parsed = projectIdSchema.safeParse(projectId);
	if (!parsed.success) {
		error(400, 'invalid project id — use lowercase letters, digits and dashes (max 32 chars)');
	}
	return parsed.data;
}

export function requireAuthAgent(platform: App.Platform | undefined) {
	const agent = platform?.env?.AUTH_AGENT;
	if (!agent) {
		error(500, 'AUTH_AGENT service binding is not available');
	}
	return agent;
}

/**
 * Builds the agent-worker URL for a project sub-path, preserving the caller's
 * origin so Better Auth resolves cookies/redirects against the dashboard.
 */
export function agentUrl(origin: string, projectId: string, subPath: string): string {
	return `${origin}/agents/auth-agent/${projectId}${subPath}`;
}

/**
 * Re-wraps a service-binding response into a native Response. In dev the
 * binding returns miniflare's proxied Response, which fails SvelteKit's
 * `instanceof Response` check for endpoint handlers. Set-Cookie headers are
 * copied individually so multiple cookies survive the round trip.
 */
export function toNativeResponse(response: Response): Response {
	const headers = new Headers();
	response.headers.forEach((value, key) => {
		if (key.toLowerCase() !== 'set-cookie') headers.set(key, value);
	});
	for (const cookie of response.headers.getSetCookie?.() ?? []) {
		headers.append('set-cookie', cookie);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
