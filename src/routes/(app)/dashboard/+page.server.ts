import { listProjects } from '$lib/server/registry';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const COOKIE = 'cfb-demo-project';
const PROJECT_PATTERN = /^demo-[a-f0-9]{20}$/;

/**
 * The console entry point, which behaves differently for the two audiences
 * this deployment serves.
 *
 * On the public demo an anonymous visitor is handed their own throwaway
 * project, remembered in a cookie so a reload returns to the same one. For a
 * signed-in operator - the only case on a self-hosted install - it lists the
 * projects in the registry, skipping the list when there is exactly one.
 */
export const load: PageServerLoad = async ({ cookies, locals, platform }) => {
	if (locals.demoMode && !locals.consoleUser) {
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
		redirect(307, `/dashboard/${projectId}`);
	}

	const projects = await listProjects(platform);
	if (projects.length === 1) redirect(307, `/dashboard/${projects[0].id}`);

	return { projects };
};
