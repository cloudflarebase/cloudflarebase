/**
 * Console identity shared by browser and server code. The server-only session
 * helpers live in $lib/server/console.ts.
 */

/**
 * Reserved project id for the dashboard's own operator auth — Cloudflarebase
 * authenticating its console with the same stack it sells. Mirrored in
 * agents/auth/src/agent.ts; keep both in sync.
 */
export const CONSOLE_PROJECT_ID = 'console';

/** Same-origin base for the console's Better Auth endpoints. */
export const CONSOLE_AUTH_BASE = `/api/projects/${CONSOLE_PROJECT_ID}/auth`;

/**
 * Project ids the registry refuses. `console` is the operator auth instance;
 * the rest would collide with dashboard routes or read as system endpoints.
 */
export const RESERVED_PROJECT_IDS = new Set([
	'console',
	'admin',
	'api',
	'agents',
	'auth',
	'dashboard',
	'login',
	'logout',
	'setup',
	'new',
	'health',
	'fleet'
]);

/** Demo projects are minted per visitor by the demo landing flow. */
const DEMO_PROJECT_PATTERN = /^demo-[a-f0-9]{20}$/;

export function isDemoProjectId(projectId: string): boolean {
	return DEMO_PROJECT_PATTERN.test(projectId);
}
