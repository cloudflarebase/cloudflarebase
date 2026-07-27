import { consoleOwnerExists, consoleSocialProviders } from '$lib/server/console';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Same-origin paths only — never let ?next= drive an open redirect. */
function safeNext(value: string | null): string {
	if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
	return value;
}

/**
 * The console sign-in page. Sign-in and first-run owner claim both POST from
 * the browser to the same-origin proxy at /api/projects/console/auth/*, which
 * relays Better Auth's Set-Cookie headers back unchanged — so this loader only
 * decides which of the two forms to show, and which social buttons the
 * console's own auth instance can honour.
 */
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	if (locals.consoleUser) redirect(303, next);

	const [ownerExists, socialProviders] = await Promise.all([
		consoleOwnerExists(platform, url.origin),
		consoleSocialProviders(platform, url.origin)
	]);

	return {
		next,
		ownerExists,
		socialProviders,
		demoMode: locals.demoMode
	};
};
