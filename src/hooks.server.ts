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

	await event.platform?.env.AUTH_AGENT.helloWorld();

	const response = await resolve(event);
	return response;
}
