import type { FleetOverview } from '$lib/agents';
import { requireAuthAgent } from '$lib/server/auth-agent';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * Platform admin fleet dashboard, gated by ADMIN_SECRET — a plain var in
 * local/test and a Wrangler secret in deployed environments. The session
 * cookie stores a SHA-256 digest of the secret (never the secret itself), so
 * rotating the secret signs every admin out. Both sides of the password check
 * are hashed first, which also keeps the comparison timing-neutral.
 */
const COOKIE = 'cfb-admin-session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const load: PageServerLoad = async ({ cookies, platform, url }) => {
	const secret = platform?.env?.ADMIN_SECRET;
	if (!secret) {
		return { configured: false, authed: false, fleet: null };
	}
	if (cookies.get(COOKIE) !== (await sha256Hex(secret))) {
		return { configured: true, authed: false, fleet: null };
	}

	const agent = requireAuthAgent(platform);
	const response = await agent.fetch(`${url.origin}/fleet/overview`);
	if (!response.ok) {
		error(502, `auth agent fleet endpoint responded with ${response.status}`);
	}
	const fleet = (await response.json()) as FleetOverview;
	return { configured: true, authed: true, fleet };
};

export const actions: Actions = {
	login: async ({ cookies, platform, request }) => {
		const secret = platform?.env?.ADMIN_SECRET;
		if (!secret) {
			return fail(503, { incorrect: false, unconfigured: true });
		}
		const password = (await request.formData()).get('password');
		const expected = await sha256Hex(secret);
		if (typeof password !== 'string' || (await sha256Hex(password)) !== expected) {
			return fail(403, { incorrect: true, unconfigured: false });
		}
		cookies.set(COOKIE, expected, {
			path: '/admin',
			httpOnly: true,
			sameSite: 'strict',
			secure: true,
			maxAge: SESSION_MAX_AGE
		});
		return { success: true };
	},
	logout: async ({ cookies }) => {
		cookies.delete(COOKIE, { path: '/admin' });
	}
};
