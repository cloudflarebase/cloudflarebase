import { z } from 'zod';

/**
 * Trust-boundary schemas: strictObject for request bodies, `.catch` for
 * env/storage reads, and a schema - never a cast - for anything that crosses
 * a trust boundary.
 */

// 48 characters: branch ids are `<root>--<branch>`, so the ceiling has to hold
// a root plus a usable branch name. Mirrored in the console's
// src/lib/schemas/auth.ts and in agents/auth + agents/db -
// keep all five in sync.
export const projectIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/);

// Demo roots are demo-<12..20 hex>; a demo BRANCH is demo-<hex>--<branch>
// (branches-design.md). Storage refuses the whole family in v1 - anonymous
// object hosting is a phishing machine (the synthetic read-only demo bucket
// is the planned S2 replacement) - so the pattern is the refusal key here,
// not a cap selector. Mirrored in the console's $lib/console.ts and the
// other agents.
export const DEMO_PROJECT_PATTERN = /^demo-[a-f0-9]{12,20}(?:--[a-z0-9][a-z0-9-]{0,15})?$/;

/**
 * Bucket names: 2-63 chars of DNS-label charset. The grammar is load-bearing,
 * not cosmetic: a bucket name can never contain `/` or `:`, so the
 * `p/<projectId>/<bucket>/` R2 prefix and the `<projectId>:<bucket>` Durable
 * Object instance name are both unambiguous by construction.
 */
export const bucketNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);

/**
 * Mirrors the db agent's `accessModeSchema` - the gate below is a copy of its
 * `access.ts`, so the mode set has to match or the two drift.
 *
 * `none` closes a side of a bucket to the public API entirely: `write: 'none'`
 * is a read-only bucket (assets only an operator uploads - a marketing site's
 * images, a published price list), `read: 'none'` an ingest bucket clients may
 * write but never enumerate or fetch back. Operator surfaces (`/admin/*`, a
 * `cfbs_` service key) never pass through this gate, so `none` closes the
 * public plane without closing the bucket.
 */
export const accessModeSchema = z.enum(['public', 'auth', 'owner', 'none']);
export type AccessMode = z.infer<typeof accessModeSchema>;

/** Permission keys follow the auth agent grammar: `resource:action` or `*`. */
export const permissionKeySchema = z
	.string()
	.regex(/^(\*|[a-z][a-z0-9-]*:[a-z][a-z0-9-]*)$/)
	.max(64);

/**
 * `PUT /admin/buckets/:name` body - db's omitted-field-means-unchanged
 * semantics: omitted keeps the stored value, explicit null clears it, so a
 * modes-only save can never clobber rules configured earlier.
 */
export const bucketConfigInputSchema = z.strictObject({
	read: accessModeSchema.optional(),
	write: accessModeSchema.optional(),
	readPermission: permissionKeySchema.nullable().optional(),
	writePermission: permissionKeySchema.nullable().optional(),
	/** Deliberately separate from `read: 'public'`: serving one known key to
	 * anyone is not the same as letting anyone enumerate every key. */
	publicListing: z.boolean().optional(),
	/** Per-object byte ceiling; null restores the deployment default. */
	maxObjectBytes: z.number().int().min(1).nullable().optional(),
	/** Write-time content-type allowlist (`image/png` or `image/*`); null
	 * clears it. Inline RENDERING stays a serve-time allowlist either way. */
	allowedContentTypes: z
		.array(
			z
				.string()
				.regex(/^[a-z0-9!#$&^_.+-]+\/(\*|[a-z0-9!#$&^_.+-]+)$/i)
				.max(128),
		)
		.max(20)
		.nullable()
		.optional(),
	/** Response Cache-Control for public reads; null restores the default. */
	cacheControl: z
		.string()
		.max(128)
		.regex(/^[\x20-\x7e]+$/)
		.nullable()
		.optional(),
});
export type BucketConfigInput = z.infer<typeof bucketConfigInputSchema>;

/** The resolved per-bucket config the worker enforces on the object paths. */
export const bucketConfigSchema = z.object({
	name: bucketNameSchema,
	read: accessModeSchema,
	write: accessModeSchema,
	readPermission: permissionKeySchema.nullable(),
	writePermission: permissionKeySchema.nullable(),
	publicListing: z.boolean(),
	maxObjectBytes: z.number().int().nullable(),
	allowedContentTypes: z.array(z.string()).nullable(),
	cacheControl: z.string().nullable(),
	/** Monotonic - a stale push can never regress a child. */
	configVersion: z.number().int(),
});
export type BucketConfig = z.infer<typeof bucketConfigSchema>;

/** Keyset cursor for object listings: the last key of the previous page. */
export const objectCursorSchema = z.string().max(1024).optional().catch(undefined);

/**
 * `POST /buckets/:name/signed-urls` body. Supabase's storage vocabulary on
 * purpose - `createSignedUrl(path, expiresIn)` and its batch sibling are what
 * people already have in their fingers - so `expiresIn` is seconds and one
 * call takes either `key` or `keys`.
 *
 * GET and HEAD only: a signed URL bypasses the bucket's read mode, and write
 * capabilities have a protocol of their own.
 */
export const signedUrlRequestSchema = z
	.strictObject({
		key: z.string().min(1).max(1024).optional(),
		keys: z.array(z.string().min(1).max(1024)).min(1).max(100).optional(),
		method: z.enum(['GET', 'HEAD']).optional(),
		expiresIn: z.number().int().min(1).optional(),
	})
	.refine(
		(value) => Boolean(value.key) !== Boolean(value.keys),
		'provide exactly one of `key` or `keys`',
	);
export type SignedUrlRequest = z.infer<typeof signedUrlRequestSchema>;

/**
 * `POST /buckets/:name/uploads` body - the multipart control plane.
 *
 * `size` is DECLARED, not measured, and that is deliberate: it is what lets
 * the write rules, the quota reservation, and the part size all be settled
 * before a single byte moves. Completion verifies the real size against it.
 */
export const createUploadRequestSchema = z.strictObject({
	key: z.string().min(1).max(1024),
	size: z.number().int().min(1),
	// No control characters: the value is signed into the NUL-separated upload
	// envelope, where an embedded NUL would shift the field boundaries.
	contentType: z
		.string()
		.max(255)
		// eslint-disable-next-line no-control-regex -- the keys.ts idiom
		.regex(/^[^\x00-\x1f\x7f]*$/, 'contentType must not contain control characters')
		.optional(),
});
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;

/** `POST /buckets/:name/uploads/:id/complete` body. Part numbers are R2's:
 * 1-based, ascending, every part but the last identically sized. */
export const completeUploadRequestSchema = z.strictObject({
	parts: z
		.array(
			z.strictObject({
				partNumber: z.number().int().min(1).max(10_000),
				etag: z.string().min(1).max(256),
			}),
		)
		.min(1)
		.max(10_000),
});
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;

// ---------------------------------------------------------------------------
// Third-party responses

/** The auth agent's JWKS endpoint - untrusted input across a binding. */
export const jwksResponseSchema = z.object({
	keys: z.array(z.record(z.string(), z.unknown())).max(10),
});

/** JWT payload after signature verification - claims we rely on. */
export const jwtClaimsSchema = z.object({
	sub: z.string().min(1),
	email: z.string().optional(),
	role: z.string().optional(),
	permissions: z.array(z.string()).optional(),
});
export type JwtClaims = z.infer<typeof jwtClaimsSchema>;
