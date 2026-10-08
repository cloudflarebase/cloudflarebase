import { z } from 'zod';

/**
 * Every boundary schema for the db agent: the query DSL, document CRUD
 * bodies, the live-query WebSocket frames, collection configuration, and the
 * untrusted third-party shapes (JWKS). Conventions mirror the auth agent:
 * strictObject for request bodies, `.catch` for env/storage reads, and a
 * schema - never a cast - for anything that crosses a trust boundary.
 *
 * The app's `src/lib/agents.ts` carries hand-copied mirrors of the DTO
 * schemas with `.meta({ id })` so they double as OpenAPI components. Keep the
 * copies in sync. The client SDK imports THESE schemas directly (same
 * package), so client and server cannot drift.
 */

// 48 characters: branch ids are `<root>--<branch>`, so the ceiling has to hold
// a root plus a usable branch name. Mirrored in the console's
// src/lib/schemas/auth.ts and in agents/auth - keep all three in sync.
export const projectIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/);

/** Collection names become Durable Object name suffixes - keep them tame. */
export const collectionNameSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

// Demo roots are demo-<12..20 hex>; a demo BRANCH is demo-<hex>--<branch>
// (branches-design.md), and the whole family must share demo caps, TTL
// erasure, and the sibling-spawn exclusion - a branch escaping this pattern
// would be an uncapped anonymous instance. Mirrored in the console's
// $lib/console.ts and agents/auth.
export const DEMO_PROJECT_PATTERN = /^demo-[a-f0-9]{12,20}(?:--[a-z0-9][a-z0-9-]{0,15})?$/;

/** Bad env degrades to 24h instead of throwing in onStart. */
export const demoTtlHoursSchema = z.coerce.number().int().min(1).max(720).catch(24);

// ---------------------------------------------------------------------------
// Query DSL

/** Dotted JSON path, each segment an identifier; regex-validated so SQL
 * interpolation of `'$.a.b'` is injection-free. */
export const fieldPathSchema = z
	.string()
	.max(128)
	.regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,3}$/);

const scalarSchema = z.union([z.string().max(1024), z.number().finite(), z.boolean(), z.null()]);

export const whereClauseSchema = z
	.strictObject({
		field: fieldPathSchema,
		op: z.enum(['==', '!=', '<', '<=', '>', '>=', 'in', 'array-contains']),
		value: z.union([scalarSchema, z.array(scalarSchema).min(1).max(20)]),
	})
	.refine((clause) => (clause.op === 'in') === Array.isArray(clause.value), {
		message: "'in' takes an array of values; every other operator takes a scalar",
	})
	.refine((clause) => clause.op === '==' || clause.op === '!=' || !isNullish(clause.value), {
		message: 'null can only be compared with == or !=',
	});

function isNullish(value: unknown): boolean {
	return value === null || (Array.isArray(value) && value.some((entry) => entry === null));
}

export const orderBySchema = z.strictObject({
	field: fieldPathSchema,
	direction: z.enum(['asc', 'desc']),
});

export const MAX_QUERY_LIMIT = 200;

export const querySchema = z.strictObject({
	where: z.array(whereClauseSchema).max(10).optional(),
	orderBy: z.array(orderBySchema).max(2).optional(),
	limit: z.number().int().min(1).max(MAX_QUERY_LIMIT).optional(),
	/** Opaque continuation from a previous page. REST only - never subscriptions. */
	cursor: z.string().max(2048).optional(),
});

export type Query = z.infer<typeof querySchema>;
export type WhereClause = z.infer<typeof whereClauseSchema>;

// ---------------------------------------------------------------------------
// Aggregations (REST only)

const aggregateAliasSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/);

export const aggregateSpecSchema = z
	.strictObject({
		op: z.enum(['count', 'sum', 'avg']),
		field: fieldPathSchema.optional(),
	})
	.refine((spec) => (spec.op === 'count' ? spec.field === undefined : spec.field !== undefined), {
		message: "'count' takes no field; 'sum' and 'avg' require one",
	});

/** Firestore's aggregate set: count/sum/avg over the same where clauses as a
 * query. sum and avg consider only numeric field values (booleans and strings
 * are skipped, matching Firestore); sum of nothing is 0, avg of nothing null. */
export const aggregateRequestSchema = z
	.strictObject({
		where: z.array(whereClauseSchema).max(10).optional(),
		aggregates: z.record(aggregateAliasSchema, aggregateSpecSchema),
	})
	.refine(
		(request) => {
			const count = Object.keys(request.aggregates).length;
			return count >= 1 && count <= 5;
		},
		{ message: 'between 1 and 5 aggregates per request' },
	);

export type AggregateRequest = z.infer<typeof aggregateRequestSchema>;

export interface AggregateResult {
	results: Record<string, number | null>;
}

// ---------------------------------------------------------------------------
// Rules-lite: permission gates and document validators

/** The auth agent's permission-key grammar verbatim: `resource:action`
 * segments or `*`. Requiring `*` effectively means "admin tokens only". */
export const permissionKeySchema = z
	.string()
	.trim()
	.max(64)
	.regex(/^(\*|[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)*)$/);

/** Validators address top-level fields only - dotted paths would make PATCH
 * merge semantics ambiguous. */
const ruleFieldNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);

export const fieldRuleSchema = z.strictObject({
	type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'null', 'any']).default('any'),
	required: z.boolean().default(false),
	/** Strings and arrays: maximum length. */
	maxLength: z.number().int().min(0).max(131072).optional(),
	/** Numbers only. */
	min: z.number().optional(),
	max: z.number().optional(),
	enum: z.array(scalarSchema).min(1).max(20).optional(),
});

export const validatorSchema = z
	.strictObject({
		fields: z.record(ruleFieldNameSchema, fieldRuleSchema),
		additionalFields: z.enum(['allow', 'reject']).default('allow'),
	})
	.refine(
		(validator) => {
			const count = Object.keys(validator.fields).length;
			return count >= 1 && count <= 20;
		},
		{ message: 'a validator declares 1 to 20 top-level fields' },
	);

export type FieldRule = z.infer<typeof fieldRuleSchema>;
export type CollectionValidator = z.infer<typeof validatorSchema>;

// ---------------------------------------------------------------------------
// Documents

export const documentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** JSON-serialized `data` ceiling; demo projects use the smaller cap. */
export const MAX_DOC_BYTES = 128 * 1024;

export const documentDataSchema = z.record(z.string().max(256), z.unknown());

export const createDocumentSchema = z.strictObject({
	id: documentIdSchema.optional(),
	data: documentDataSchema,
});

export const writeDocumentSchema = z.strictObject({
	data: documentDataSchema,
});

/** The wire shape of a document: metadata outside `data`, no collisions. */
export interface DbDocument {
	id: string;
	data: Record<string, unknown>;
	owner: string | null;
	createdAt: string;
	updatedAt: string;
}

// ---------------------------------------------------------------------------
// Replication (phase REP1)

export const replicationModeSchema = z.enum(['off', 'auto']);
export type ReplicationMode = z.infer<typeof replicationModeSchema>;

/** Session bookmark headers - the D1 Sessions contract, LSN-shaped. Writes
 * on a replicated primary answer with LSN_HEADER; clients echo the highest
 * seen value on reads via MIN_LSN_HEADER for read-your-writes on replicas. */
export const LSN_HEADER = 'cfb-lsn';
export const MIN_LSN_HEADER = 'cfb-min-lsn';

/** One change-log row (row images, never statements - deterministic apply,
 * engine-agnostic: the same substrate replicates documents and typed rows). */
export const logEntrySchema = z.object({
	lsn: z.number().int().min(1),
	op: z.enum(['put', 'del', 'cfg']),
	id: z.string(),
	/** DTO JSON for put, config JSON for cfg, null tombstone for del. */
	image: z.string().nullable(),
	ts: z.number(),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const REPLICATION_PULL_CHUNK = 500;
/** Log retention; a replica behind the horizon is FORCED to re-bootstrap. */
export const MAX_LOG_ROWS = 100_000;
/** REP1 freshness window: replica reads may lag this far unless the session
 * bookmark demands newer. Matches the dashboard's own polling cadence. */
export const MAX_REPLICA_LAG_MS = 3_000;

/** Sibling spawn: a region replica this close to the ~32k hibernatable-socket
 * ceiling stops taking NEW subscribers - the worker routes them to the next
 * sibling (`:r:<region>:2`…). 75% leaves headroom for one routing-cache TTL
 * of herd. Overridable per environment (env.test sets it to 2). */
export const SIBLING_SPAWN_SOCKETS = 24_000;
/** Sibling cap per region: bounds a socket-flood to this many data copies. */
export const MAX_REGION_SIBLINGS = 8;
/** Replicas report socket counts when they move at least this much - one
 * report per ~6% of the threshold keeps the primary current without a write
 * per socket. Always >= 1 so tiny test thresholds still report. */
export function socketReportStep(spawnAt: number): number {
	return Math.max(1, Math.floor(spawnAt / 16));
}

export type RepPullResult =
	| { resync: true; epoch: number }
	| { resync: false; entries: LogEntry[]; lastLsn: number; epoch: number };

/**
 * Who may follow a primary's feed. Two spellings, and the difference is the
 * whole reason the pattern is not just `r:`:
 *
 * - `r:<region>:<n>` - a region replica of THIS shard (REP1/REP2).
 * - `v:<view>:<region>:<n>` - a join view, which
 *   follows SEVERAL primaries into one SQLite. It registers in each member's
 *   `replicas` table like any other follower, so the erase fan-out reaches it.
 *
 * A deployed agent must carry this widening BEFORE any console can declare a
 * view: the id is refused by zod here, before any handler runs, so an older
 * agent answers a view's bootstrap with a parse failure rather than a feed.
 * (Same ordering lesson as widening the project-id ceiling to 48 characters
 * ahead of minting a longer id.)
 */
export const FOLLOWER_ID_PATTERN = /^(?:r:[a-z-]+|v:[a-z][a-z0-9_-]{0,63}:[a-z-]+):\d+$/;

export const repPullInputSchema = z.strictObject({
	since: z.number().int().min(0),
	replicaId: z.string().regex(FOLLOWER_ID_PATTERN),
	region: z.string().min(1).max(16),
});

/** Primary -> replica push (REP2): entries applied live, or a healing hint. */
export const repApplyInputSchema = z.strictObject({
	entries: z.array(logEntrySchema).min(1).max(REPLICATION_PULL_CHUNK),
	epoch: z.number().int().min(0),
});
export type RepApplyResult =
	/** Applied (or already had them) - keep pushing. */
	| { ok: true }
	/** Out of order / wrong epoch; the replica pulled to heal. */
	| { healed: true }
	/** No subscribers left here - stop pushing until they return. */
	| { stop: true };

/** Deliberately NOT widened to FOLLOWER_ID_PATTERN: live push and sibling
 * spawn are replica machinery, and a JOIN1 view is pull-only. Views gain a
 * push reason in JOIN2; until then this surface refuses them by shape. */
export const repSetPushInputSchema = z.strictObject({
	replicaId: z.string().regex(/^r:[a-z-]+:\d+$/),
	region: z.string().min(1).max(16),
	/** Omitted = leave the push flag alone (a sockets-only report). */
	push: z.boolean().optional(),
	/** Hibernatable-socket count, reported step-debounced for sibling spawn. */
	sockets: z.number().int().min(0).optional(),
});

/** Observability payloads (`/admin/replication/:name`, the replica map). */
export interface RepReplicaStatus {
	id: string;
	region: string;
	appliedLsn: number;
	lagLsn: number;
	/** Receiving live pushes (it holds subscribers). */
	push: boolean;
	/** Last reported hibernatable-socket count (drives sibling spawn). */
	sockets: number;
	lastSeenAt: string;
}
export interface RepStatus {
	enabled: boolean;
	epoch: number;
	lastLsn: number;
	horizonLsn: number;
	replicas: RepReplicaStatus[];
	/** The answering primary's own location (/cdn-cgi/trace; null in local
	 * dev), so the dashboard's map can place the hub where the DO really
	 * lives instead of guessing. */
	primary?: { colo: string | null; country: string | null };
}

// ---------------------------------------------------------------------------
// Collection configuration

/**
 * Who may reach a shard over the PUBLIC API, per side (read and write are set
 * independently).
 *
 * `none` is the closed one, and it exists because there was previously no way
 * to say "nobody writes this from a client". That is the shape of every
 * server-owned dataset - feature flags, pricing tiers, a country list, a
 * product catalog - and the closest approximation was `auth` plus a permission
 * key nobody's token carries, which works by accident and is one role edit
 * away from being wrong.
 *
 * `writeAccess: 'none'` is a read-only collection or table: Firestore's
 * `allow write: if false` expressed against the operator bypass that already
 * exists (console, `cfbs_` service key, admin SDK - none of which pass through
 * this gate at all). `readAccess: 'none'` falls out for free and is genuinely
 * useful: append-only ingest that clients may write but never read back.
 *
 * Widening an enum is backward-compatible - every stored config still parses.
 */
export const accessModeSchema = z.enum(['public', 'auth', 'owner', 'none']);
export type AccessMode = z.infer<typeof accessModeSchema>;

/**
 * The PUT /admin/collections/:name body. Permission gates and the validator
 * are three-state: omitted = leave unchanged (so a modes-only save can never
 * clobber rules configured earlier), explicit null = clear.
 */
export const collectionModesSchema = z.strictObject({
	readAccess: accessModeSchema.default('auth'),
	writeAccess: accessModeSchema.default('auth'),
	readPermission: permissionKeySchema.nullable().optional(),
	writePermission: permissionKeySchema.nullable().optional(),
	validator: validatorSchema.nullable().optional(),
	/** Three-state like the permission fields: omitted = unchanged. */
	replication: replicationModeSchema.optional(),
});

/** Pushed parent -> child on create/config change; cached in collection_meta. */
export const collectionConfigSchema = z.strictObject({
	projectId: projectIdSchema,
	collection: collectionNameSchema,
	readAccess: accessModeSchema,
	writeAccess: accessModeSchema,
	/** Permission the JWT's `permissions` claim must carry (`*` always passes).
	 * Only meaningful for auth/owner modes - public requests carry no token. */
	readPermission: z.string().nullable(),
	writePermission: z.string().nullable(),
	/** Document rules for the public write path; operator surfaces bypass. */
	validator: validatorSchema.nullable(),
	allowedOrigins: z.array(z.string()).max(10),
	demo: z.boolean(),
	/** Monotonic; lets a child ignore a stale push after a failed retry. */
	configVersion: z.number().int().min(0),
	/** Defaults keep configs stored before REP1 parseable. */
	replication: replicationModeSchema.default('off'),
	/** PARENT-owned restore epoch: bumped after a PITR restore so replicas
	 * discard and re-bootstrap. Lives in config (not the primary's storage)
	 * because a restore rewinds the primary's storage - including any epoch
	 * it would have kept itself. */
	repEpoch: z.number().int().min(0).default(0),
});
export type CollectionConfig = z.infer<typeof collectionConfigSchema>;

/** Parses untrusted DO storage in onStart-equivalents. */
export const storedConfigSchema = collectionConfigSchema.nullable().catch(null);

export const settingsRequestSchema = z.strictObject({
	allowedOrigins: z
		.array(
			z
				.string()
				.trim()
				.max(256)
				.transform((value, ctx) => {
					let parsed: URL;
					try {
						parsed = new URL(value);
					} catch {
						ctx.addIssue({ code: 'custom', message: `"${value}" is not a valid origin` });
						return z.NEVER;
					}
					const localhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
					if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localhost)) {
						ctx.addIssue({ code: 'custom', message: `"${value}" must be https` });
						return z.NEVER;
					}
					if (parsed.origin !== value) {
						ctx.addIssue({ code: 'custom', message: `"${value}" must be a bare origin` });
						return z.NEVER;
					}
					return parsed.origin;
				}),
		)
		.max(10)
		.transform((origins) => [...new Set(origins)]),
});

// ---------------------------------------------------------------------------
// Tables: the typed-column DSL (phase T1)

/** Table names are DO name suffixes exactly like collection names; the
 * physical SQLite table inside the instance is always `rows`. */
/**
 * Names the shard's OWN migrations already occupy.
 *
 * A declared table becomes a real SQLite table of that name, created with
 * `CREATE TABLE IF NOT EXISTS` - so a declaration colliding with one of these
 * creates nothing and silently adopts internal storage instead. The DDL
 * planner then ALTERs the internal table to add the declared columns, writes
 * land in it, and reads serve its rows: `subscriptions` carries subscriber
 * token metadata, `changelog` carries every row image the replication feed
 * ships. It also disables the raw-SQL gate's internal-name refusal for
 * exactly that name, since a table may legitimately reference itself.
 *
 * Both kinds are refused, not just tables: registry names are unique across
 * kinds, so letting a COLLECTION take one of these names would only reserve
 * it for a table that can never be declared.
 */
export const RESERVED_SHARD_TABLES = new Set([
	'collections',
	'documents',
	'subscriptions',
	'restore_points',
	'collection_meta',
	'changelog',
	'replicas',
	'replica_meta',
	'gateways',
	'gateway_subs',
	'view_sources',
]);

export const tableNameSchema = collectionNameSchema.refine(
	(name) => !RESERVED_SHARD_TABLES.has(name),
	'that name belongs to internal storage',
);

/**
 * No leading underscore (reserved for future system use) and no hyphens
 * (column names appear as dotted query field-path segments). Quoted in all
 * generated SQL regardless. The system columns are PLAIN reserved names -
 * `id`, `owner`, `created_at`, `updated_at` - so ORM-generated SQL reads
 * like a normal table; the reservation lives in tableColumnsSchema.
 */
export const columnNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

/** Owned by the platform: the row envelope's fields as real SQL columns. */
export const RESERVED_COLUMN_NAMES = ['id', 'owner', 'created_at', 'updated_at'] as const;

export const columnTypeSchema = z.enum(['text', 'integer', 'real', 'boolean', 'json']);
export type ColumnType = z.infer<typeof columnTypeSchema>;

export const MAX_TABLE_COLUMNS = 64;
/** unique + index combined. */
export const MAX_TABLE_INDEXES = 16;

/**
 * One declared column. SQLite affinity is NOT the type system - it would
 * happily store text in an INTEGER column - so the write path validates
 * values against `type` in JS before binding. The rules-lite bounds
 * (maxLength/min/max/enum) are enforced in the same place, never as CHECK
 * constraints (CHECK cannot be added or altered after the fact).
 */
export const tableColumnSchema = z
	.strictObject({
		name: columnNameSchema,
		type: columnTypeSchema,
		nullable: z.boolean().default(true),
		/** Materialized by the WRITE PATH (missing column -> default), so
		 * changing it later is metadata-only. The SQL DEFAULT clause is only
		 * emitted where SQLite demands one: ADD COLUMN ... NOT NULL. */
		default: scalarSchema.optional(),
		/** Implemented as a UNIQUE index; implies `index`. */
		unique: z.boolean().default(false),
		index: z.boolean().default(false),
		/** text columns: maximum string length. */
		maxLength: z.number().int().min(0).max(131072).optional(),
		/** integer/real columns only. */
		min: z.number().optional(),
		max: z.number().optional(),
		/** text/integer/real columns: allowed values. */
		enum: z.array(scalarSchema).min(1).max(20).optional(),
	})
	.superRefine((column, ctx) => {
		const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
		if (column.default !== undefined && !valueFitsType(column.type, column.default)) {
			fail(`"${column.name}": default must be a ${column.type}`);
		}
		if (column.type === 'json' && column.default !== undefined) {
			fail(`"${column.name}": json columns cannot declare a default`);
		}
		// NOT NULL without a default is legal and useful - it means "required on
		// write". Only ADDING such a column to an existing table is refused (the
		// DDL planner owns that rule: SQLite must backfill existing rows).
		if (column.maxLength !== undefined && column.type !== 'text') {
			fail(`"${column.name}": maxLength applies to text columns`);
		}
		if (
			(column.min !== undefined || column.max !== undefined) &&
			column.type !== 'integer' &&
			column.type !== 'real'
		) {
			fail(`"${column.name}": min/max apply to integer and real columns`);
		}
		if (column.enum !== undefined && (column.type === 'json' || column.type === 'boolean')) {
			fail(`"${column.name}": enum applies to text, integer, and real columns`);
		}
	});
export type TableColumn = z.infer<typeof tableColumnSchema>;

/** Scalar-vs-declared-type check shared by the schema and the write path. */
export function valueFitsType(type: ColumnType, value: string | number | boolean | null): boolean {
	if (value === null) return true;
	switch (type) {
		case 'text':
			return typeof value === 'string';
		case 'integer':
			return typeof value === 'number' && Number.isInteger(value);
		case 'real':
			return typeof value === 'number';
		case 'boolean':
			return typeof value === 'boolean';
		case 'json':
			return true;
	}
}

export const tableColumnsSchema = z
	.array(tableColumnSchema)
	.min(1)
	.max(MAX_TABLE_COLUMNS)
	.superRefine((columns, ctx) => {
		const names = new Set<string>();
		for (const column of columns) {
			if (names.has(column.name)) {
				ctx.addIssue({ code: 'custom', message: `duplicate column "${column.name}"` });
			}
			names.add(column.name);
			if ((RESERVED_COLUMN_NAMES as readonly string[]).includes(column.name)) {
				ctx.addIssue({
					code: 'custom',
					message: `"${column.name}" is a system column (id, owner, created_at, updated_at are reserved)`,
				});
			}
		}
		const indexes = columns.filter((column) => column.unique || column.index).length;
		if (indexes > MAX_TABLE_INDEXES) {
			ctx.addIssue({
				code: 'custom',
				message: `a table is limited to ${MAX_TABLE_INDEXES} indexed columns`,
			});
		}
	});

/**
 * The PUT /admin/tables/:name body. Permissions are three-state exactly like
 * collections (omitted = unchanged, null = clear); `columns` is the full
 * desired schema - the parent diffs it against the registry's stored columns
 * and refuses destructive changes before anything is pushed.
 */
export const tableModesSchema = z.strictObject({
	readAccess: accessModeSchema.default('auth'),
	writeAccess: accessModeSchema.default('auth'),
	readPermission: permissionKeySchema.nullable().optional(),
	writePermission: permissionKeySchema.nullable().optional(),
	columns: tableColumnsSchema,
	/** Three-state like the permission fields: omitted = unchanged. */
	replication: replicationModeSchema.optional(),
});

/** Pushed parent -> child; cached in collection_meta alongside a record of
 * what DDL has actually been applied (pragma_table_info is SQLITE_AUTH). */
export const tableConfigSchema = z.strictObject({
	kind: z.literal('table'),
	projectId: projectIdSchema,
	table: tableNameSchema,
	readAccess: accessModeSchema,
	writeAccess: accessModeSchema,
	readPermission: z.string().nullable(),
	writePermission: z.string().nullable(),
	columns: tableColumnsSchema,
	allowedOrigins: z.array(z.string()).max(10),
	demo: z.boolean(),
	configVersion: z.number().int().min(0),
	replication: replicationModeSchema.default('off'),
	repEpoch: z.number().int().min(0).default(0),
});
export type TableConfig = z.infer<typeof tableConfigSchema>;

export const storedTableConfigSchema = tableConfigSchema.nullable().catch(null);

/**
 * The child's cached meta row: the pushed config plus the record of what DDL
 * has actually been applied - which replaces introspection, because
 * `pragma_table_info()` is SQLITE_AUTH. `appliedColumns` only moves after
 * every planned statement succeeded.
 */
export const storedTableMetaSchema = z
	.object({ config: tableConfigSchema, appliedColumns: tableColumnsSchema })
	.nullable()
	.catch(null);
export type TableMeta = { config: TableConfig; appliedColumns: TableColumn[] };

/**
 * A row's wire shape is deliberately the document envelope - `data` is the
 * column-value map (json columns parsed, booleans as true/false) - so the
 * live-query frames, the SDK subscribe machinery, and the dashboard change
 * handling are shared with collections rather than forked.
 */
export type DbRow = DbDocument;

// --- The D1-shaped SQL endpoint (T2; db-table-design.md §10) ---

const sqlStatementSchema = z.strictObject({
	sql: z.string().min(1).max(10_000),
	params: z
		.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
		.max(100)
		.optional(),
});

/** One statement, or an atomic batch (transactionSync under the hood). */
export const tableSqlRequestSchema = z.union([
	sqlStatementSchema,
	z.strictObject({ batch: z.array(sqlStatementSchema).min(1).max(20) }),
]);

/** D1-shaped per-statement result. `raw` + `columns` exist for ORM drivers
 * (drizzle's sqlite-proxy wants value arrays in column order). */
export interface TableSqlResult {
	results: Record<string, unknown>[];
	columns: string[];
	raw: unknown[][];
	meta: { changes: number; rows_read: number; rows_written: number };
}

export type TableSqlResponse =
	| { success: true; result: TableSqlResult }
	| { success: true; batch: TableSqlResult[] }
	| { success: false; error: string };

// ---------------------------------------------------------------------------
// Join views (JOIN1)

/** A view name is a registry name like any other - unique ACROSS kinds, and
 * a Durable Object name segment, so the same tame grammar applies. */
export const viewNameSchema = collectionNameSchema;

/** Small on purpose. Every member is a full local COPY of that table, so a
 * view's storage is the sum of its members against one 10 GB shard budget,
 * and its bootstrap is the sum of their sizes. */
export const MIN_VIEW_MEMBERS = 2;
export const MAX_VIEW_MEMBERS = 5;
export const MAX_VIEWS_PER_PROJECT = 3;

/** How stale a view read may be before it pulls its members first. REP1's
 * window: a view is a replica, and joins are explicitly stale-tolerant. */
export const MAX_VIEW_LAG_MS = MAX_REPLICA_LAG_MS;

/**
 * The `PUT /admin/views/:name` body.
 *
 * No `writeAccess`: a view serves SELECT and nothing else. No `readAccess`
 * either, and that absence is deliberate rather than an omission - a view is
 * a raw-SQL surface, and raw SQL ALWAYS requires a project JWT (the table
 * endpoint's rule). A mode field could only ever say `auth`, so instead the
 * gate is stated once and exactly: a valid token, plus this key, plus EVERY
 * member's own key. Members in `public` mode are read through a token here,
 * which is stricter than reading them directly - never looser.
 */
export const viewModesSchema = z.strictObject({
	members: z.array(collectionNameSchema).min(MIN_VIEW_MEMBERS).max(MAX_VIEW_MEMBERS),
	/** In ADDITION to every member's own key - never instead of one. */
	readPermission: permissionKeySchema.nullable().optional(),
});

/**
 * Pushed parent -> view child. Deliberately carries only member NAMES: each
 * member's columns and access config arrive from that member's own feed
 * (`repBootstrap` answers with its TableConfig, and later `cfg` entries
 * replicate changes in write order), so the view never has to ask the parent
 * about a table and can never hold a config the feed disagrees with.
 */
export const viewConfigSchema = z.strictObject({
	kind: z.literal('view'),
	projectId: projectIdSchema,
	view: viewNameSchema,
	members: z.array(collectionNameSchema).min(MIN_VIEW_MEMBERS).max(MAX_VIEW_MEMBERS),
	readPermission: z.string().nullable(),
	allowedOrigins: z.array(z.string()).max(10),
	demo: z.boolean(),
	configVersion: z.number().int().min(0),
});
export type ViewConfig = z.infer<typeof viewConfigSchema>;

export const storedViewConfigSchema = viewConfigSchema.nullable().catch(null);

/** Per-member follow position and the member config the feed last delivered. */
export const viewSourceStateSchema = z.object({
	table: collectionNameSchema,
	epoch: z.number().int().min(0),
	appliedLsn: z.number().int().min(0),
	pulledAt: z.number().int().min(0),
	config: tableConfigSchema.nullable(),
});
export type ViewSourceState = z.infer<typeof viewSourceStateSchema>;

/** `GET /admin/views/:name` - what the parent reports about a view's follow
 * state, one row per member (the multi-source answer to `RepStatus`). */
export interface ViewSourceStatus {
	table: string;
	appliedLsn: number;
	/** Null when the member's primary could not be reached. */
	lagLsn: number | null;
	epoch: number;
	pulledAt: string | null;
	bootstrapped: boolean;
}

export interface ViewStatus {
	view: string;
	members: ViewSourceStatus[];
	/** The oldest member pull - what the freshness window is judged on. */
	stalestPulledAt: string | null;
}

// ---------------------------------------------------------------------------
// Export / import / point-in-time restore

export const MAX_IMPORT_DOCS = 1000;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
/** Lines per parent->child RPC call, well under the RPC payload ceiling. */
export const IMPORT_RPC_CHUNK = 100;
export const EXPORT_CHUNK = 500;

/**
 * One NDJSON import line. An exported document round-trips exactly (id,
 * owner, and timestamps are preserved - import is operator-only, so the
 * caller is trusted with them); a bare `{ data }` line mints a fresh id.
 * Unknown keys are stripped rather than refused.
 */
export const importLineSchema = z.object({
	id: documentIdSchema.optional(),
	data: documentDataSchema,
	owner: z.string().max(256).nullable().optional(),
	createdAt: z.iso.datetime().optional(),
	updatedAt: z.iso.datetime().optional(),
});
export type ImportLine = z.infer<typeof importLineSchema>;

export interface ImportReport {
	imported: number;
	updated: number;
	errors: { line: number; error: string }[];
}

/**
 * Named PITR bookmarks the parent persists per collection and the dashboard
 * lists, D1-Time-Travel-style. These are MARKERS, not the recovery window:
 * restore-by-timestamp reaches any moment in the platform's 30 days
 * regardless. The cap only stops a scripted importer from growing the marker
 * list without bound; 30-day pruning is the real limit.
 */
export const MAX_RESTORE_POINTS = 200;

export const checkpointRequestSchema = z.strictObject({
	reason: z.string().trim().min(1).max(80).optional(),
});

/**
 * The human line a publish's restore point carries: which keys were added,
 * edited, and removed, in words - the version list and the rollback dialog
 * are where an operator decides what a version IS, and "publish (3)" told
 * them nothing. Keys are listed until the checkpoint reason's 80-char cap
 * would clip them, then the tail collapses to a count; a publish with no
 * pending work (never reachable today) answers plain "publish".
 */
export function remoteConfigPublishSummary(delta: {
	added: string[];
	edited: string[];
	removed: string[];
}): string {
	const groups = (['added', 'edited', 'removed'] as const)
		.filter((verb) => delta[verb].length)
		.map((verb) => ({ verb, keys: delta[verb] }));
	if (!groups.length) return 'publish';

	// Longest first keeps the label meaningful as it degrades: full key lists,
	// then per-group counts from the back.
	for (let collapsed = 0; collapsed <= groups.length; collapsed++) {
		const line = groups
			.map((group, index) => {
				const asCount = index >= groups.length - collapsed;
				return asCount
					? `${group.verb} ${group.keys.length}`
					: `${group.verb} ${group.keys.join(', ')}`;
			})
			.join(' · ');
		if (line.length <= 80) return line;
	}
	return groups
		.map((group) => `${group.verb} ${group.keys.length}`)
		.join(' · ')
		.slice(0, 80);
}

/**
 * Ids of restore-point rows that repeat an earlier row's bookmark.
 *
 * Capturing with no writes since the last capture yields the SAME bookmark -
 * publish checkpoints, then an immediate "before rollback" capture, is the
 * ordinary way to get there. Two rows for one bookmark list a single storage
 * state twice, and the dashboard keys its version list by bookmark, so the
 * duplicate breaks the very page it appears on. Rows arrive newest-first;
 * the OLDEST row per bookmark is the keeper - it carries the label the state
 * was created under (usually the publish), not the label of whatever
 * captured it again.
 */
export function duplicateRestorePointIds(rows: { id: number; bookmark: string }[]): number[] {
	const keeperByBookmark = new Map<string, number>();
	for (const row of rows) {
		const held = keeperByBookmark.get(row.bookmark);
		// Autoincrement ids: the smallest id is the oldest capture.
		if (held === undefined || row.id < held) keeperByBookmark.set(row.bookmark, row.id);
	}
	const keepers = new Set(keeperByBookmark.values());
	return rows.filter((row) => !keepers.has(row.id)).map((row) => row.id);
}

export interface RestorePoint {
	bookmark: string;
	reason: string;
	capturedAt: string;
}

/** Restore to a wall-clock time (30-day window) or to an exact bookmark - the
 * undo path: every successful restore returns the bookmark that reverses it. */
export const restoreRequestSchema = z
	.strictObject({
		timestamp: z.iso.datetime().optional(),
		bookmark: z.string().min(1).max(256).optional(),
	})
	.refine((request) => (request.timestamp === undefined) !== (request.bookmark === undefined), {
		message: 'exactly one of timestamp or bookmark is required',
	});

export type RestoreRequest = z.infer<typeof restoreRequestSchema>;

export type RestoreOutcome =
	| { ok: true; undoBookmark: string }
	| { ok: false; code: 'unsupported' | 'failed'; message?: string };

/** Timestamp -> closest-available-bookmark resolution (D1-restore-style). */
export type BookmarkOutcome =
	{ ok: true; bookmark: string } | { ok: false; code: 'unsupported' | 'failed'; message?: string };

// ---------------------------------------------------------------------------
// Live-query protocol frames (shared verbatim with the client SDK)

export const subscribeFrameSchema = z.strictObject({
	type: z.literal('subscribe'),
	id: z.string().min(1).max(64),
	query: querySchema.omit({ cursor: true }),
	token: z.string().max(8192).optional(),
});

export const unsubscribeFrameSchema = z.strictObject({
	type: z.literal('unsubscribe'),
	id: z.string().min(1).max(64),
});

export const clientFrameSchema = z.union([subscribeFrameSchema, unsubscribeFrameSchema]);
export type ClientFrame = z.infer<typeof clientFrameSchema>;

// ---------------------------------------------------------------------------
// Gateway protocol (one client socket for the whole database)

/** Which shard a gateway subscription addresses. */
export const shardAddressSchema = z.strictObject({
	kind: z.enum(['collection', 'table']),
	name: collectionNameSchema,
});
export type ShardAddress = z.infer<typeof shardAddressSchema>;

/** The per-shard subscribe frame plus a shard address - the only difference
 * between the gateway socket and a direct shard socket. */
export const gatewaySubscribeFrameSchema = subscribeFrameSchema.extend({
	shard: shardAddressSchema,
});
export const gatewayClientFrameSchema = z.union([
	gatewaySubscribeFrameSchema,
	unsubscribeFrameSchema,
]);
export type GatewayClientFrame = z.infer<typeof gatewayClientFrameSchema>;

/** Cross-shard subscriptions one gateway connection may hold (per-shard caps
 * still apply at each shard). Demo cap mirrors the 5-shard x 5-sub ceiling. */
export const GATEWAY_MAX_SUBSCRIPTIONS_PER_CONNECTION = 100;
export const DEMO_GATEWAY_MAX_SUBSCRIPTIONS_PER_CONNECTION = 25;
export const MAX_GATEWAY_SIBLINGS = 8;

/** Shard-side registration of one gateway-held subscription. The shard runs
 * the SAME live engine over it; only delivery differs (RPC to the gateway
 * instead of a local socket send). The token is re-verified by the shard -
 * the gateway is never trusted with authorization. */
export const remoteSubscribeInputSchema = z.strictObject({
	gateway: z.string().min(1).max(256),
	connId: z.string().min(1).max(64),
	subId: z.string().min(1).max(64),
	query: querySchema.omit({ cursor: true }),
	token: z.string().max(8192).optional(),
});
export type RemoteSubscribeInput = z.infer<typeof remoteSubscribeInputSchema>;

export type RemoteSubscribeResult =
	| { ok: true; docs: DbDocument[] }
	| {
			ok: false;
			code: 'invalid-query' | 'unauthorized' | 'subscription-limit' | 'shard-unavailable';
			message: string;
	  }
	/** A replica that cannot serve (failed bootstrap); retry on the primary. */
	| { forward: true };

export const remoteUnsubscribeInputSchema = z.strictObject({
	connId: z.string().min(1).max(64),
	/** Omitted = every subscription this connection holds on the shard. */
	subId: z.string().min(1).max(64).optional(),
});
export type RemoteUnsubscribeInput = z.infer<typeof remoteUnsubscribeInputSchema>;

const dbDocumentSchema = z.object({
	id: z.string(),
	data: z.record(z.string(), z.unknown()),
	owner: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const serverFrameSchema = z.union([
	z.strictObject({
		type: z.literal('snapshot'),
		id: z.string(),
		docs: z.array(dbDocumentSchema),
	}),
	z.strictObject({
		type: z.literal('change'),
		id: z.string(),
		kind: z.enum(['added', 'modified', 'removed']),
		doc: dbDocumentSchema,
	}),
	z.strictObject({ type: z.literal('unsubscribed'), id: z.string() }),
	z.strictObject({
		type: z.literal('error'),
		id: z.string().optional(),
		code: z.enum([
			'invalid-frame',
			'invalid-query',
			'unauthorized',
			'token-expired',
			'subscription-limit',
			'shard-unavailable',
			'internal',
		]),
		message: z.string(),
	}),
]);
export type ServerFrame = z.infer<typeof serverFrameSchema>;

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

// ---------------------------------------------------------------------------
// Remote Config (RC1)

/**
 * The platform's own namespace inside a project's shard registry.
 *
 * A shard whose name starts with this is created and owned by a Frostbase
 * feature, not by the operator: the generic table and collection routes refuse
 * to create, reconfigure, or drop one, so nobody can open Remote Config's
 * parameter table to public writes from the Tables page and quietly hand every
 * client the ability to rewrite their own feature flags.
 *
 * It is a PREFIX rather than a list because the next platform-owned shard
 * should need no new rule. The shards stay visible in the registry and
 * readable through the operator surfaces - this is the operator's project, and
 * hiding storage from them would be worse than reserving it.
 */
export const PLATFORM_SHARD_PREFIX = 'cfb_';

export function isPlatformShard(name: string): boolean {
	return name.startsWith(PLATFORM_SHARD_PREFIX);
}

/** Remote Config's parameter table. The row id IS the parameter key, so
 * uniqueness is the primary key rather than an index. */
export const REMOTE_CONFIG_TABLE = 'cfb_remote_config';

/**
 * A parameter key. Deliberately the document-id grammar - the key is the row
 * id - plus a leading-letter rule, because these are read in client code as
 * `config.get('checkoutV2')` and a key starting with a digit reads as a typo.
 */
export const remoteConfigKeySchema = z
	.string()
	.regex(
		/^[A-Za-z][A-Za-z0-9_-]{0,63}$/,
		'keys start with a letter and use letters, digits, _ and - (max 64)',
	);

export const remoteConfigValueTypeSchema = z.enum(['string', 'number', 'boolean', 'json']);
export type RemoteConfigValueType = z.infer<typeof remoteConfigValueTypeSchema>;

/** A parameter's default is bounded: it ships to every client on every fetch,
 * and a config payload is not a document store. */
export const MAX_REMOTE_CONFIG_VALUE_BYTES = 4 * 1024;
export const MAX_REMOTE_CONFIG_PARAMETERS = 100;

/**
 * The `PUT /admin/remote-config/:key` body.
 *
 * `defaultValue` is `unknown` here and checked against `valueType` by
 * `remoteConfigValueIssue` instead: the type is data, so the check cannot be
 * expressed as a static union without four near-identical branches, and the
 * message a operator sees ("checkoutV2 is a boolean") is worth more than the
 * zod union's.
 */
export const remoteConfigParameterInputSchema = z.strictObject({
	valueType: remoteConfigValueTypeSchema,
	defaultValue: z.unknown(),
	/** Shown in the console beside the key; never sent to clients. */
	description: z.string().trim().max(200).nullable().optional(),
	/** Ordered overrides; omitted leaves them unchanged, null clears them -
	 * the three-state rule the shard config schemas already use. */
	conditions: z
		.array(z.lazy(() => remoteConfigConditionSchema))
		.max(5)
		.nullable()
		.optional(),
});
export type RemoteConfigParameterInput = z.infer<typeof remoteConfigParameterInputSchema>;

// --- Targeting (RC2) -------------------------------------------------------

/**
 * ISO 3166-1 alpha-2, as `request.cf.country` reports it. Uppercase only, so a
 * rule cannot silently fail to match because someone typed `de`.
 */
const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'use an uppercase 2-letter country code');

/** `1.2.3`, `2.0`, or `4` - what an app actually reports as its version. */
export const appVersionSchema = z.string().regex(/^\d{1,6}(\.\d{1,6}){0,3}$/);

export const MAX_REMOTE_CONFIG_CONDITIONS = 5;

/**
 * One targeting predicate. Every field present must match (AND); a field
 * listing values matches if any of them do (OR within the field).
 *
 * Four predicates and no more, chosen by what the edge can establish rather
 * than by what would look complete on a feature list:
 *
 * - `country` comes from `request.cf` and the client never supplies it, so it
 *   is the only one an end user cannot influence at all.
 * - `role` and `permission` come from a VERIFIED project JWT. No token means
 *   they simply do not match - never a match by default.
 * - `appVersion` is client-reported, and honestly so: it targets a build, and
 *   a build that lies about its version is one you shipped.
 * - `rollout` buckets a caller by `uid`. Advisory by construction (see
 *   `rolloutBucket`), which is why the console says so next to the control.
 *
 * The absence of an `else`/priority language is deliberate: conditions are an
 * ordered list and the FIRST match wins, which is the whole evaluation rule.
 */
export const remoteConfigConditionSchema = z.strictObject({
	/** Shown in the console so a rule reads as something other than JSON. */
	label: z.string().trim().max(60).optional(),
	when: z
		.strictObject({
			country: z.array(countryCodeSchema).min(1).max(20).optional(),
			role: z.array(z.string().trim().min(1).max(64)).min(1).max(10).optional(),
			permission: permissionKeySchema.optional(),
			appVersion: z
				.strictObject({
					gte: appVersionSchema.optional(),
					lt: appVersionSchema.optional(),
				})
				.refine(
					(range) => range.gte !== undefined || range.lt !== undefined,
					'an appVersion rule needs gte, lt, or both',
				)
				.optional(),
			rollout: z
				.strictObject({
					/** 1-99: 0 and 100 are a rule that should just be deleted or
					 * made the default, and accepting them invites both. */
					percent: z.number().int().min(1).max(99),
					/** Two 10% rollouts with different salts hit DIFFERENT tenths -
					 * without it every rollout targets the same unlucky cohort. */
					salt: z.string().trim().min(1).max(64),
				})
				.optional(),
		})
		.refine(
			(when) => Object.keys(when).length > 0,
			'a condition needs at least one rule, or it matches everyone',
		),
	value: z.unknown(),
});
export type RemoteConfigCondition = z.infer<typeof remoteConfigConditionSchema>;

/** Parses what came back out of the json column; unreadable = no targeting. */
export const storedConditionsSchema = z
	.array(remoteConfigConditionSchema)
	.max(MAX_REMOTE_CONFIG_CONDITIONS)
	.nullable()
	.catch(null);

/** Null when the value fits its declared type, else the operator-facing why. */
export function remoteConfigValueIssue(type: RemoteConfigValueType, value: unknown): string | null {
	if (value === undefined) return 'a default value is required';
	const size = JSON.stringify(value ?? null)?.length ?? 0;
	if (size > MAX_REMOTE_CONFIG_VALUE_BYTES) {
		return `a default value is limited to ${MAX_REMOTE_CONFIG_VALUE_BYTES} bytes`;
	}
	switch (type) {
		case 'string':
			return typeof value === 'string' ? null : 'this parameter is declared a string';
		case 'number':
			return typeof value === 'number' && Number.isFinite(value)
				? null
				: 'this parameter is declared a number';
		case 'boolean':
			return typeof value === 'boolean' ? null : 'this parameter is declared a boolean';
		case 'json':
			// Anything JSON-serializable, including null - the escape hatch for a
			// structured value. `undefined` was already refused above.
			return value === null || typeof value === 'object'
				? null
				: 'a json parameter takes an object, an array, or null - use the scalar types otherwise';
	}
}

/**
 * A parameter's lifecycle, and the reason there are two value columns.
 *
 * Editing is a DRAFT and publishing is what reaches clients - Firebase's model,
 * and it is the right one for exactly the reason it exists there: a config
 * change usually means several parameters moving together, and an operator
 * halfway through editing must not be serving a half-changed config to
 * everyone. So the console writes drafts freely, and one publish flips them
 * atomically.
 *
 * - `draft`    - added but never published. Clients have never seen it.
 * - `published` - live. `draftValue` may still differ, which is an edit pending.
 * - `deleting` - published, and marked for removal on the next publish. Still
 *                served until then, because it is still live for clients.
 */
export const remoteConfigStateSchema = z.enum(['draft', 'published', 'deleting']);
export type RemoteConfigState = z.infer<typeof remoteConfigStateSchema>;

/**
 * The declared columns of the parameter table.
 *
 * Deliberately a plain `DbTable` rather than storage inside DbAgent: the table
 * then inherits point-in-time recovery, export/import, replication, and the
 * erase fan-out from machinery that is already tested - and a config rollback
 * rewinds ONLY the config, where restoring the coordinator would rewind the
 * whole shard registry with it.
 *
 * No `conditions` column yet. Targeting arrives in RC2 with the schema that
 * validates it and the evaluator that reads it; a nullable column can be added
 * to a live table then (the DDL planner allows exactly that), and declaring a
 * field nothing validates would be worse than declaring it late.
 */
export const REMOTE_CONFIG_COLUMNS = [
	{
		name: 'value_type',
		type: 'text',
		nullable: false,
		enum: ['string', 'number', 'boolean', 'json'],
	},
	/** What the console edits. */
	{ name: 'draft_value', type: 'json', nullable: true },
	/** What clients get - the public endpoint reads THIS column, never the draft. */
	{ name: 'published_value', type: 'json', nullable: true },
	/** Targeting rules, drafted and published in step with the values they
	 * override. Added in RC2 as nullable columns, which the DDL planner applies
	 * to a live table - a project provisioned by RC1 gains them on next touch. */
	{ name: 'draft_conditions', type: 'json', nullable: true },
	{ name: 'published_conditions', type: 'json', nullable: true },
	{
		name: 'state',
		type: 'text',
		nullable: false,
		default: 'draft',
		enum: ['draft', 'published', 'deleting'],
	},
	{ name: 'description', type: 'text', nullable: true, maxLength: 200 },
	/** Operator user id, so a parameter has an author in the audit trail. */
	{ name: 'updated_by', type: 'text', nullable: true },
] as const;

/** The wire shape of one parameter, as the console reads it. */
export interface RemoteConfigParameter {
	key: string;
	valueType: RemoteConfigValueType;
	/** What the editor shows. */
	draftValue: unknown;
	/** What clients currently get; null until first published. */
	publishedValue: unknown;
	/** Targeting, drafted and published in step with the values. */
	draftConditions: RemoteConfigCondition[] | null;
	publishedConditions: RemoteConfigCondition[] | null;
	state: RemoteConfigState;
	/** Whether this parameter differs from what clients are being served. */
	pending: boolean;
	description: string | null;
	updatedBy: string | null;
	updatedAt: string;
}

/** Whether a parameter is not yet what clients are being served - value AND
 * targeting, since a changed rule changes what someone receives just as much as
 * a changed value does. */
export function remoteConfigPending(parameter: {
	state: RemoteConfigState;
	draftValue: unknown;
	publishedValue: unknown;
	draftConditions?: unknown;
	publishedConditions?: unknown;
}): boolean {
	if (parameter.state !== 'published') return true;
	if (
		JSON.stringify(parameter.draftValue ?? null) !==
		JSON.stringify(parameter.publishedValue ?? null)
	) {
		return true;
	}
	return (
		JSON.stringify(parameter.draftConditions ?? null) !==
		JSON.stringify(parameter.publishedConditions ?? null)
	);
}
