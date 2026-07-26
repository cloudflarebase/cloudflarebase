import { dev } from '$app/environment';
import { getConsoleSession, isDemoMode, isDemoProjectId } from '$lib/server/console';
import { handleErrorWithSentry, initCloudflareSentryHandle, sentryHandle } from '@sentry/sveltekit';
import { redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';

let platform: App.Platform;

if (dev) {
	const { getPlatformProxy } = await import('wrangler');

	// @ts-expect-error wrangler dev local context
	platform = await getPlatformProxy({
		persist: true,
		environment: 'local'
	});
}

const platformHandle: Handle = async ({ event, resolve }) => {
	if (platform) {
		event.platform = {
			...event.platform,
			...platform
		};
	}

	if (event.platform?.ctx) {
		(event.platform as App.Platform & { context: ExecutionContext }).context = event.platform.ctx;
	}

	return resolve(event);
};

const applicationHandle: Handle = async ({ event, resolve }) => {
	// Agents SDK traffic (HTTP + WebSocket state sync) goes straight through to
	// the auth-agent worker. In local dev the dashboard connects directly to the
	// agent worker on :8788 instead, since Vite's dev server can't proxy
	// workerd WebSockets.
	if (event.url.pathname.startsWith('/agents/') && event.platform?.env?.AUTH_AGENT) {
		return event.platform.env.AUTH_AGENT.fetch(event.request) as unknown as Promise<Response>;
	}

	return resolve(event);
};

const apiRateLimitHandle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname === '/api' || event.url.pathname.startsWith('/api/')) {
		const limiter = event.platform?.env?.API_RATE_LIMITER;

		if (limiter) {
			const { success } = await limiter.limit({ key: event.getClientAddress() });

			if (!success) {
				return Response.json(
					{ error: 'rate limit exceeded' },
					{
						status: 429,
						headers: { 'Retry-After': '60' }
					}
				);
			}
		}
	}

	return resolve(event);
};

type Access =
	{ scope: 'open' } | { scope: 'operator'; projectId: string | null; kind: 'page' | 'api' };

/**
 * Splits project-scoped surfaces into public product API and operator console.
 *
 * Two things must stay public because they *are* the product: the Better Auth
 * endpoints a customer's app calls, and the safe client config. Everything
 * else — overview, analytics, chat, admin mutations, and the realtime
 * WebSocket — reads or mutates a project's user data and needs an operator.
 *
 * This is the single enforcement point for the `/agents/*` passthrough too.
 * The agent worker has no public route (`workers_dev` and `preview_urls` are
 * both false), so every external request to it arrives through here.
 */
function classifyAccess(pathname: string): Access {
	const segments = pathname.split('/').filter(Boolean);

	// /agents/auth-agent/<projectId>/<subPath...>
	if (segments[0] === 'agents') {
		const subPath = `/${segments.slice(3).join('/')}`;
		if (subPath === '/config') return { scope: 'open' };
		if (subPath === '/api/auth' || subPath.startsWith('/api/auth/')) return { scope: 'open' };
		return { scope: 'operator', projectId: segments[2] ?? null, kind: 'api' };
	}

	// Everything under /api is operator surface unless published below, so a
	// route added later is private until someone deliberately opens it.
	if (segments[0] === 'api') {
		if (segments[1] === 'projects') {
			const rest = segments.slice(3);
			if (rest[0] === 'auth') return { scope: 'open' };
			if (rest[0] === 'config' && rest.length === 1) return { scope: 'open' };
			return { scope: 'operator', projectId: segments[2] ?? null, kind: 'api' };
		}
		return { scope: 'operator', projectId: null, kind: 'api' };
	}

	if (segments[0] === 'dashboard') {
		return { scope: 'operator', projectId: segments[1] ?? null, kind: 'page' };
	}

	return { scope: 'open' };
}

/**
 * Requires an operator session for every console surface. Fails closed: an
 * install that never sets DEMO_MODE is private the moment it is deployed.
 */
const consoleGuardHandle: Handle = async ({ event, resolve }) => {
	event.locals.demoMode = isDemoMode(event.platform);
	event.locals.consoleUser = null;

	const access = classifyAccess(event.url.pathname);
	if (access.scope === 'open') return resolve(event);

	// Public demo: anonymous visitors may drive ephemeral demo projects, whose
	// ids are unguessable and whose data self-destructs. Named projects always
	// require an operator session, even on the demo deployment.
	if (event.locals.demoMode && access.projectId && isDemoProjectId(access.projectId)) {
		return resolve(event);
	}

	// The bare /dashboard entry decides for itself: in demo mode it hands the
	// visitor a throwaway project, otherwise its loader lists real ones and so
	// still needs a session.
	if (event.locals.demoMode && access.kind === 'page' && !access.projectId) {
		return resolve(event);
	}

	const user = await getConsoleSession(
		event.platform,
		event.url.origin,
		event.request.headers.get('cookie')
	);

	if (user) {
		event.locals.consoleUser = user;
		return resolve(event);
	}

	if (access.kind === 'page') {
		redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	}
	return Response.json({ error: 'authentication required' }, { status: 401 });
};

const cloudflareSentryHandle: Handle = async (input) => {
	const dsn = input.event.platform?.env?.SENTRY_DSN;

	if (!dsn) {
		return input.resolve(input.event);
	}

	return initCloudflareSentryHandle({
		dsn,
		environment: dev
			? 'development'
			: input.event.url.hostname === 'cloudflarebase.com'
				? 'production'
				: 'preview',
		tracesSampleRate: 0.1
	})(input);
};

export const handle = sequence(
	platformHandle,
	cloudflareSentryHandle,
	sentryHandle(),
	apiRateLimitHandle,
	// Must precede applicationHandle: that one forwards /agents/* straight to
	// the agent worker, so the guard is the last chance to reject.
	consoleGuardHandle,
	applicationHandle
);
export const handleError = handleErrorWithSentry();
