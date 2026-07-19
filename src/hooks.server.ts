import { dev } from '$app/environment';

let platform: App.Platform;

if (dev) {
	const { getPlatformProxy } = await import('wrangler');

	// @ts-expect-error wrangler dev local context
	platform = await getPlatformProxy({
		persist: true,
		environment: 'local'
	});
}

export async function handle({ event, resolve }) {
	if (platform) {
		event.platform = {
			...event.platform,
			...platform
		};

		if (event.platform.ctx) {
			// @ts-expect-error wrangler dev local context fix
			event.platform.context = event.platform.ctx;
		}
	}

	// Agents SDK traffic (HTTP + WebSocket state sync) goes straight through to
	// the auth-agent worker. In local dev the dashboard connects directly to the
	// agent worker on :8788 instead, since Vite's dev server can't proxy
	// workerd WebSockets.
	if (event.url.pathname.startsWith('/agents/') && event.platform?.env?.AUTH_AGENT) {
		return event.platform.env.AUTH_AGENT.fetch(event.request) as unknown as Promise<Response>;
	}

	const response = await resolve(event);
	return response;
}
