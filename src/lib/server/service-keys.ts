import * as Sentry from '@sentry/cloudflare';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from './db';
import { serviceKey } from './db/schema';

/**
 * Project service keys (SK1) - the credential a
 * SERVER can hold.
 *
 * The gap this closes: a browser app needs no API key by design, because the
 * signed-in user's own project JWT is the credential, and an SSR route can
 * RELAY the identity the user already sent it. But a cron, a queue consumer, a
 * webhook handler, or a seed script has no user to relay and nothing to
 * present. The only credential that would previously have worked is an
 * operator session - the whole account, sliding 30 days, unscoped.
 *
 * What makes this small: **the admin surface already exists**. Every agent
 * already serves mode-bypassing operator routes with exactly Admin-SDK
 * semantics; today the only thing that can reach them is a human session. So a
 * service key is an AUTHENTICATION change, not an authorization one - no agent
 * changes, no new bypass path, nothing new to get wrong inside a Durable
 * Object.
 */

/** `cfbs_` + 32 random bytes hex. */
export const SERVICE_KEY_PATTERN = /^cfbs_[0-9a-f]{64}$/;

export const MAX_SERVICE_KEYS_PER_PROJECT = 5;

export const serviceKeyNameSchema = z.string().trim().min(1).max(60);

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Which surfaces a service key opens. The DATA plane only, and only for its
 * own project.
 *
 * Everything absent from this list is refused with a plain 401 - notably
 * `/api/registry/**` (a key must never create, rename, or DELETE a project,
 * its own included), `/api/console/**` and `/api/cli/**` (no minting other
 * credentials, no touching operator accounts), and `/api/projects/<id>/keys`
 * itself (a key cannot mint or revoke keys - it must not be able to grow or
 * outlive itself).
 *
 * The containment property: a service key reads and writes ITS project's
 * data, and nothing else.
 */
export function isServiceKeySurface(pathname: string, projectId: string): boolean {
	const prefix = `/api/projects/${encodeURIComponent(projectId)}/`;
	const alt = `/api/projects/${projectId}/`;
	const rest = pathname.startsWith(prefix)
		? pathname.slice(prefix.length)
		: pathname.startsWith(alt)
			? pathname.slice(alt.length)
			: null;
	if (rest === null) return false;
	return (
		rest === 'db' ||
		rest.startsWith('db/') ||
		rest === 'storage' ||
		rest.startsWith('storage/') ||
		// The auth agent's operator surface: users, sessions, roles, settings -
		// the Admin-SDK equivalent. NOT `auth/*`, which is the end-user surface
		// and needs no key.
		rest === 'admin' ||
		rest.startsWith('admin/') ||
		rest === 'overview' ||
		rest === 'analytics'
	);
}

export interface ServiceKeyGrant {
	projectId: string;
	keyId: string;
}

/**
 * NO VERIFICATION CACHE, deliberately - and this was designed the other way
 * first.
 *
 * The draft cached verified digests for 30s, on the argument that a service
 * key is checked on every request a backend makes. But the surfaces a key
 * opens are parent-mediated: every one of them is a proxy hop into a
 * coordinator Durable Object, which dwarfs an indexed D1 read on the same
 * request. So the cache bought very little, and what it cost was REVOCATION
 * LATENCY on the most powerful credential in the system - an admin-grade key,
 * revoked precisely because it leaked, still working for half a minute across
 * every isolate that had seen it.
 *
 * Instant revocation is worth more than a saved read here. If service-key
 * throughput ever becomes the bottleneck, the fix is admitting keys on the
 * one-hop shard paths - not making a leaked credential outlive its revocation.
 *
 * Last-used stamps ARE debounced: a write per request would be a D1 write on
 * every data call, and the field exists only so an operator can see whether a
 * key is live before revoking it.
 */
const LAST_USED_DEBOUNCE_MS = 60_000;
const lastUsedStamped = new Map<string, number>();

/**
 * Verifies a `cfbs_` bearer. Null on any failure - the guard turns that into a
 * plain 401, never a session fallback.
 */
export async function verifyServiceKey(
	platform: App.Platform | undefined,
	secret: string
): Promise<ServiceKeyGrant | null> {
	if (!SERVICE_KEY_PATTERN.test(secret)) return null;
	const now = Date.now();

	try {
		const db = await getDb(platform);
		const [row] = await db
			.select()
			.from(serviceKey)
			.where(eq(serviceKey.keyHash, await sha256Hex(secret)))
			.limit(1);
		if (!row) return null;

		const stamped = lastUsedStamped.get(row.id) ?? 0;
		if (now - stamped >= LAST_USED_DEBOUNCE_MS) {
			lastUsedStamped.set(row.id, now);
			try {
				await db
					.update(serviceKey)
					.set({ lastUsedAt: new Date() })
					.where(eq(serviceKey.id, row.id));
			} catch {
				// The stamp is cosmetic; verification must not depend on a write.
			}
		}
		return { projectId: row.projectId, keyId: row.id };
	} catch (cause) {
		console.error('service key verification failed', cause);
		Sentry.captureException(cause, { level: 'error', tags: { operation: 'verify-service-key' } });
		return null;
	}
}

export type MintResult =
	| { ok: true; id: string; name: string; key: string; createdAt: string }
	| { ok: false; status: number; error: string };

export async function mintServiceKey(
	platform: App.Platform | undefined,
	projectId: string,
	name: unknown,
	createdBy: string | null
): Promise<MintResult> {
	const parsed = serviceKeyNameSchema.safeParse(name);
	if (!parsed.success) {
		return { ok: false, status: 400, error: 'a service key needs a name (1-60 characters)' };
	}

	const db = await getDb(platform);
	const existing = await db
		.select({ id: serviceKey.id })
		.from(serviceKey)
		.where(eq(serviceKey.projectId, projectId));
	if (existing.length >= MAX_SERVICE_KEYS_PER_PROJECT) {
		return {
			ok: false,
			status: 409,
			error: `projects are limited to ${MAX_SERVICE_KEYS_PER_PROJECT} service keys`
		};
	}

	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const secret = `cfbs_${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
	const [created] = await db
		.insert(serviceKey)
		.values({
			id: crypto.randomUUID(),
			projectId,
			name: parsed.data,
			keyHash: await sha256Hex(secret),
			createdBy,
			createdAt: new Date()
		})
		.returning();

	return {
		ok: true,
		id: created.id,
		name: created.name,
		// Shown exactly once. Nothing can recover it afterwards - only the
		// digest is stored.
		key: secret,
		createdAt: created.createdAt.toISOString()
	};
}

export interface ServiceKeySummary {
	id: string;
	name: string;
	createdAt: string;
	lastUsedAt: string | null;
}

export async function listServiceKeys(
	platform: App.Platform | undefined,
	projectId: string
): Promise<ServiceKeySummary[]> {
	const db = await getDb(platform);
	const rows = await db
		.select()
		.from(serviceKey)
		.where(eq(serviceKey.projectId, projectId))
		.orderBy(asc(serviceKey.createdAt));
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		createdAt: row.createdAt.toISOString(),
		lastUsedAt: row.lastUsedAt?.toISOString() ?? null
	}));
}

/** Revocation IS row deletion - a key not in the table is dead, and with no
 * verification cache in front of it that takes effect on the next request. */
export async function revokeServiceKey(
	platform: App.Platform | undefined,
	projectId: string,
	keyId: string
): Promise<boolean> {
	const db = await getDb(platform);
	const deleted = await db
		.delete(serviceKey)
		.where(and(eq(serviceKey.id, keyId), eq(serviceKey.projectId, projectId)))
		.returning();
	for (const row of deleted) lastUsedStamped.delete(row.id);
	return deleted.length > 0;
}

/** Project delete drops its keys with it (the registry fan-out). */
export async function deleteProjectServiceKeys(
	platform: App.Platform | undefined,
	projectId: string
): Promise<void> {
	const db = await getDb(platform);
	await db.delete(serviceKey).where(eq(serviceKey.projectId, projectId));
}
