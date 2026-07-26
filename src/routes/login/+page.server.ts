import { consoleOwnerExists } from '$lib/server/console';
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
 * decides which of the two forms to show.
 */
export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	if (locals.consoleUser) redirect(303, next);

	return {
		next,
		ownerExists: await consoleOwnerExists(platform, url.origin),
		demoMode: locals.demoMode
	};
};
