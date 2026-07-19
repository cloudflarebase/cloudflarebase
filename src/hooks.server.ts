import { dev } from '$app/environment';
import { handleErrorWithSentry, initCloudflareSentryHandle, sentryHandle } from '@sentry/sveltekit';
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
	applicationHandle
);
export const handleError = handleErrorWithSentry();
