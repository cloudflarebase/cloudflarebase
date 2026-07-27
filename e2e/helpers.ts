/** Shared constants + helpers for the e2e suite. */

/** Project seeded once per stack by seed.setup.ts - treat as read-only in tests. */
export const SEED_PROJECT = 'e2e-seed';

/**
 * Scratch project for tests that must create users. The seed project's counts
 * are asserted exactly, so writing into it breaks unrelated specs.
 */
export const SCRATCH_PROJECT = 'e2e-scratch';

/**
 * Reserved project id backing the console's own operator auth. Every console
 * surface requires a session on it, so the suite claims an owner before
 * anything else runs (console.setup.ts) and reuses that storage state.
 */
export const CONSOLE_PROJECT = 'console';

export const CONSOLE_OWNER = {
	name: 'E2E Operator',
	email: 'operator@example.com',
	password: 'e2e-console-owner-1'
} as const;

/** Where console.setup.ts parks the operator session for the other projects. */
export const CONSOLE_STORAGE_STATE = 'e2e/.auth/console.json';

export function consoleAuthPath(endpoint: string): string {
	return authPath(CONSOLE_PROJECT, endpoint);
}

export const SEED_PASSWORD = 'seeded-user-password-1';

export const SEED_USERS = [
	{ name: 'Grace Hopper', email: 'grace@example.com', password: SEED_PASSWORD },
	{ name: 'Alan Turing', email: 'alan@example.com', password: SEED_PASSWORD }
] as const;

/** Registered seed users + exactly one anonymous guest. */
export const SEED_TOTAL_USERS = SEED_USERS.length + 1;

let counter = 0;

/** Unique-per-run email so re-runs and retries never collide. */
export function uniqueEmail(prefix: string): string {
	counter += 1;
	return `${prefix}-${Date.now()}-${counter}@example.com`;
}

export function authPath(projectId: string, endpoint: string): string {
	return `/api/projects/${projectId}/auth/${endpoint}`;
}

export function overviewPath(projectId: string): string {
	return `/api/projects/${projectId}/overview`;
}

export function analyticsPath(projectId: string): string {
	return `/api/projects/${projectId}/analytics`;
}

export function chatPath(projectId: string): string {
	return `/api/projects/${projectId}/chat`;
}

export function adminUserPath(projectId: string, userId: string): string {
	return `/api/projects/${projectId}/admin/users/${encodeURIComponent(userId)}`;
}

export function adminSessionPath(projectId: string, sessionId: string): string {
	return `/api/projects/${projectId}/admin/sessions/${encodeURIComponent(sessionId)}`;
}

export function settingsPath(projectId: string): string {
	return `/api/projects/${projectId}/admin/settings`;
}

export function configPath(projectId: string): string {
	return `/api/projects/${projectId}/config`;
}

export function authPage(projectId: string): string {
	return `/dashboard/${projectId}/auth`;
}
