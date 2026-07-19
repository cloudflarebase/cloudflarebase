import { routeAgentRequest } from 'agents';
import { WorkerEntrypoint } from 'cloudflare:workers';

export { AuthAgent } from './agent';
export type {
	AgentChatReply,
	AuthActivityEvent,
	AuthAgentState,
	AuthAnalytics,
	AuthOverview,
} from './agent';

/**
 * Auth service for Cloudflarebase. Each project gets its own AuthAgent — a
 * SQLite-backed Durable Object running Better Auth with realtime state sync.
 *
 * Reached two ways:
 * - Service binding fetch from the dashboard worker (AUTH_AGENT binding)
 * - Directly over HTTP/WebSocket at /agents/auth-agent/<projectId>/...
 */
export default class AuthService extends WorkerEntrypoint<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/health') {
			return Response.json({ service: 'auth-agent', status: 'ok' });
		}

		return (
			(await routeAgentRequest(request, this.env)) ??
			Response.json({ error: 'not found' }, { status: 404 })
		);
	}
}
