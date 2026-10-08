/** Shared constants + helpers for the e2e suite. */

import type { APIRequestContext } from '@playwright/test';

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

/**
 * Unlocks the first-run claim. The console claim needs proof of deployment
 * control - a fresh deploy or this token (src/lib/server/console-setup.ts) -
 * so the suite takes the same path a self-hosted operator does. Value matches
 * `CONSOLE_SETUP_TOKEN` in wrangler.e2e.jsonc and root env.test.
 */
export const CONSOLE_SETUP_TOKEN = 'e2e-console-setup-token-not-a-secret';

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

/**
 * Registers a project so operator surfaces can reach it, the way the console's
 * "+ New project" does.
 *
 * There is no other way in: the guard refuses any id without a registry row,
 * because reaching one used to MINT a backend by URL - the agents provision a
 * Durable Object on first touch, so /dashboard/<anything> handed out an auth
 * stack and a database outside every ownership check. The suite used to lean
 * on exactly that shortcut, which is why this exists.
 *
 * Idempotent: 409 means a reused local stack already holds the row, which is
 * success here. Needs the operator storage state, like any registry call.
 */
export async function ensureProject(
	request: APIRequestContext,
	projectId: string,
	name = projectId
): Promise<void> {
	const response = await request.post('/api/registry/projects', { data: { id: projectId, name } });
	if (response.status() === 201 || response.status() === 409) return;
	throw new Error(`could not register ${projectId}: ${response.status()} ${await response.text()}`);
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

export function adminUsersPath(projectId: string): string {
	return `/api/projects/${projectId}/admin/users`;
}

export function adminSessionsPath(projectId: string): string {
	return `/api/projects/${projectId}/admin/sessions`;
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

/**
 * Project the db agent specs self-seed. Collections are idempotent upserts or
 * carry a per-run suffix so reused local stacks never collide, and nothing
 * else asserts on this project's contents.
 */
export const DB_PROJECT = 'e2e-db';

/**
 * Remote Config's PUBLIC spec gets a project of its own.
 *
 * It shares nothing with the operator spec on purpose: that one has a teardown
 * test that drops the whole parameter table, and files run in parallel - so
 * sharing a project meant the public spec occasionally read a config that had
 * just been deleted out from under it. Two projects, no coordination needed.
 */
export const CONFIG_PROJECT = 'e2e-config';

export function dbAdminCollectionPath(projectId: string, name: string): string {
	return `/api/projects/${projectId}/db/admin/collections/${encodeURIComponent(name)}`;
}

export function dbDocumentsPath(projectId: string, collection: string): string {
	return `/api/projects/${projectId}/db/collections/${collection}/documents`;
}

export function dbDocumentPath(projectId: string, collection: string, docId: string): string {
	return `/api/projects/${projectId}/db/collections/${collection}/documents/${encodeURIComponent(docId)}`;
}

export function dbQueryPath(projectId: string, collection: string): string {
	return `/api/projects/${projectId}/db/collections/${collection}/query`;
}

export function dbAggregatePath(projectId: string, collection: string): string {
	return `/api/projects/${projectId}/db/collections/${collection}/aggregate`;
}

export function dbExportPath(projectId: string, collection: string): string {
	return `/api/projects/${projectId}/db/collections/${collection}/export`;
}

export function dbAdminQueryPath(projectId: string): string {
	return `/api/projects/${projectId}/db/admin/query`;
}

export function dbAdminAggregatePath(projectId: string): string {
	return `/api/projects/${projectId}/db/admin/aggregate`;
}

export function dbAdminExportPath(projectId: string, name: string): string {
	return `${dbAdminCollectionPath(projectId, name)}/export`;
}

export function dbAdminImportPath(projectId: string, name: string): string {
	return `${dbAdminCollectionPath(projectId, name)}/import`;
}

export function dbAdminRestorePath(projectId: string, name: string): string {
	return `${dbAdminCollectionPath(projectId, name)}/restore`;
}

export function dbOverviewPath(projectId: string): string {
	return `/api/projects/${projectId}/db/overview`;
}

// --- SQL tables (schema-first; declared via the admin surface) ---

export function dbAdminTablePath(projectId: string, name: string): string {
	return `/api/projects/${projectId}/db/admin/tables/${encodeURIComponent(name)}`;
}

export function dbAdminTableRowPath(projectId: string, name: string, rowId: string): string {
	return `${dbAdminTablePath(projectId, name)}/rows/${encodeURIComponent(rowId)}`;
}

export function dbRowsPath(projectId: string, table: string): string {
	return `/api/projects/${projectId}/db/tables/${table}/rows`;
}

export function dbTableExportPath(projectId: string, table: string): string {
	return `/api/projects/${projectId}/db/tables/${table}/export`;
}

export function dbRowPath(projectId: string, table: string, rowId: string): string {
	return `/api/projects/${projectId}/db/tables/${table}/rows/${encodeURIComponent(rowId)}`;
}

export function dbTableQueryPath(projectId: string, table: string): string {
	return `/api/projects/${projectId}/db/tables/${table}/query`;
}

// --- Join views (JOIN1) ---

export function dbAdminViewPath(projectId: string, name: string): string {
	return `/api/projects/${projectId}/db/admin/views/${encodeURIComponent(name)}`;
}

export function dbViewSqlPath(projectId: string, view: string): string {
	return `/api/projects/${projectId}/db/views/${view}/sql`;
}

// --- Storage (S1) ---

/** Project the storage specs self-seed. Buckets use FIXED names (creates are
 * idempotent upserts) and objects carry per-run keys, so reused local stacks
 * never collide with the 5-bucket project cap. */
export const STORAGE_PROJECT = 'e2e-storage';

export function storageOverviewPath(projectId: string): string {
	return `/api/projects/${projectId}/storage/overview`;
}

export function storageBucketsPath(projectId: string): string {
	return `/api/projects/${projectId}/storage/admin/buckets`;
}

export function storageBucketPath(projectId: string, bucket: string): string {
	return `/api/projects/${projectId}/storage/admin/buckets/${encodeURIComponent(bucket)}`;
}

/** The PUBLIC object paths - the direct agent base. Bytes must not transit a
 * BUFFERING proxy, which is what every JSON proxy here is; the operator
 * object proxy below streams instead. */
export function storageObjectsPath(projectId: string, bucket: string): string {
	return `/agents/storage-agent/${projectId}/buckets/${bucket}/objects`;
}

export function storageObjectPath(projectId: string, bucket: string, key: string): string {
	return `${storageObjectsPath(projectId, bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** Signed-URL minting: the PUBLIC door (needs whatever reading needs) and the
 * operator/service-key mirror over the console proxy. */
export function storageSignedUrlsPath(projectId: string, bucket: string): string {
	return `/agents/storage-agent/${projectId}/buckets/${bucket}/signed-urls`;
}

export function storageAdminSignedUrlsPath(projectId: string, bucket: string): string {
	return `/api/projects/${projectId}/storage/admin/buckets/${encodeURIComponent(bucket)}/signed-urls`;
}

export function storageSigningRotatePath(projectId: string): string {
	return `/api/projects/${projectId}/storage/admin/signing/rotate`;
}

/** The OPERATOR object surface (console-guard gated, modes bypassed). */
export function storageAdminObjectsPath(projectId: string, bucket: string): string {
	return `/agents/storage-agent/${projectId}/admin/buckets/${bucket}/objects`;
}

export function storageAdminObjectPath(projectId: string, bucket: string, key: string): string {
	return `${storageAdminObjectsPath(projectId, bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * The operator object surface over the CONSOLE proxy - the only door a service
 * key can use, since `isServiceKeySurface` matches only under
 * `/api/projects/<id>/` and `/agents/*` refuses a service-key bearer outright.
 * Unlike every other proxy here it STREAMS the body through to the agent
 *.
 */
export function storageProxyObjectsPath(projectId: string, bucket: string): string {
	return `/api/projects/${projectId}/storage/admin/buckets/${encodeURIComponent(bucket)}/objects`;
}

export function storageProxyObjectPath(projectId: string, bucket: string, key: string): string {
	return `${storageProxyObjectsPath(projectId, bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function projectBranchesPath(projectId: string): string {
	return `/api/projects/${projectId}/branches`;
}

export function registryProjectPath(projectId: string): string {
	return `/api/registry/projects/${projectId}`;
}
