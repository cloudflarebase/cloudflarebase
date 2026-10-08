import { getConsoleIdentity } from '$lib/server/console';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The landing page is frostbase.dev's marketing surface, which only the
 * public demo deployment has an audience for. On a private install (DEMO_MODE
 * unset) the deployment IS the product, so the root hands its operator
 * straight to the console - and the guard bounces to /login when there is no
 * session yet.
 */
export const load: PageServerLoad = async ({ locals, platform, request, url }) => {
	if (!locals.demoMode) {
		redirect(307, '/dashboard');
	}

	// The nav's account corner: Dashboard for a signed-in operator, Log in /
	// Sign up otherwise. The landing is an open route, so the guard never
	// resolved a session for it - done here instead, and only for visitors
	// carrying cookies at all (getConsoleIdentity short-circuits without any).
	const identity = await getConsoleIdentity(
		platform,
		url.origin,
		request.headers.get('cookie'),
		null,
		request.headers.get('cf-connecting-ip')
	).catch(() => null);

	return { signedIn: !!identity };
};
