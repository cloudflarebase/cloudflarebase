import { redirect } from '@sveltejs/kit';

const COOKIE = 'cfb-demo-project';
const PROJECT_PATTERN = /^demo-[a-f0-9]{20}$/;

export function load({ cookies, url }) {
	let projectId = cookies.get(COOKIE);
	if (!projectId || !PROJECT_PATTERN.test(projectId)) {
		projectId = `demo-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
		cookies.set(COOKIE, projectId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			maxAge: 60 * 60 * 24 * 30
		});
	}
	const suffix = url.searchParams.has('auth') ? '/auth' : '';
	redirect(307, `/dashboard/${projectId}${suffix}`);
}
