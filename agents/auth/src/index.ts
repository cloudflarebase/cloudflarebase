import * as Sentry from '@sentry/cloudflare';
import { getAgentByName, routeAgentRequest } from 'agents';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { AuthAgent as AuthAgentBase } from './agent';
import { getFleetOverview } from './fleet';
import { projectIdSchema } from './schemas';

export type {
	AgentChatReply,
	AgentChatMessage,
	AuthActivityEvent,
	AuthAgentState,
	AuthAnalytics,
	AuthOverview,
	FleetProjectCounts,
} from './agent';
export type { FleetOverview, FleetProject, FleetTotals } from './fleet';
export type { AssertAuthAgentEnv, AuthAgentBindings } from './bindings';

const sentryOptions = (env: Env) => ({
	dsn: env.SENTRY_DSN,
	environment: env.SENTRY_ENV,
	tracesSampleRate: 0.1,
	enableRpcTracePropagation: true,
});

export const AuthAgent = Sentry.instrumentDurableObjectWithSentry(sentryOptions, AuthAgentBase);

/**
 * Auth service for Cloudflarebase. Each project gets its own AuthAgent — a
 * SQLite-backed Durable Object running Better Auth with realtime state sync.
 *
 * Reached two ways:
 * - Service binding fetch from the dashboard worker (AUTH_AGENT binding)
 * - Directly over HTTP/WebSocket at /agents/auth-agent/<projectId>/...
 */
class AuthService extends WorkerEntrypoint<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/health') {
			return Response.json({ service: 'auth-agent', status: 'ok' });
		}

		// Erases one project's auth data. Outside /agents/* for the same reason
		// the fleet rollup is: reachable only over the dashboard's service
		// binding. The console owns the fan-out across agents, so this endpoint
		// knows nothing about any agent but its own.
		const erase = url.pathname.match(/^\/internal\/projects\/([^/]+)$/);
		if (erase && request.method === 'DELETE') {
			const projectId = decodeURIComponent(erase[1]);
			if (!projectIdSchema.safeParse(projectId).success) {
				return Response.json({ error: 'invalid project id' }, { status: 400 });
			}
			const agent = await getAgentByName<Env, AuthAgentBase>(this.env.AuthAgent, projectId);
			await agent.destroy();
			return Response.json({ erased: true });
		}

		// Fleet rollup for the platform admin dashboard. Not under /agents/*, so
		// it is only reachable via the dashboard's service binding — the worker
		// has no public route and the dashboard forwards only /agents/* paths.
		if (url.pathname === '/fleet/overview') {
			const requestedLimit = Number(url.searchParams.get('limit'));
			const limit =
				Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : undefined;
			return Response.json(await getFleetOverview(this.env, limit));
		}

		const response =
			(await routeAgentRequest(request, this.env)) ??
			Response.json({ error: 'not found' }, { status: 404 });

		if (response.status >= 500) {
			const body = await response
				.clone()
				.text()
				.then((value) => value.slice(0, 2048))
				.catch(() => '<unavailable>');

			Sentry.captureMessage(`Auth agent returned HTTP ${response.status}`, {
				level: 'error',
				tags: {
					'http.method': request.method,
					'http.status_code': response.status,
				},
				contexts: {
					response: {
						body,
						contentType: response.headers.get('content-type'),
					},
				},
				extra: {
					pathname: url.pathname,
				},
			});
		}

		return response;
	}
}

export default Sentry.withSentry(sentryOptions, AuthService);
