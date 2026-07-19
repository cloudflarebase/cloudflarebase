import * as Sentry from '@sentry/cloudflare';
import { routeAgentRequest } from 'agents';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { AuthAgent as AuthAgentBase } from './agent';

export type {
	AgentChatReply,
	AuthActivityEvent,
	AuthAgentState,
	AuthAnalytics,
	AuthOverview,
} from './agent';

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
