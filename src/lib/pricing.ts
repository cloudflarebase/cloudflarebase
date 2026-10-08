/**
 * The /pricing calculator's rate card and cost model. Our price is $0 - the
 * page estimates what a WORKLOAD costs on the operator's own Cloudflare
 * account, and what the same workload would cost on Firebase and Supabase.
 *
 * Rates are STATIC CONSTANTS copied from the providers' published pricing and
 * reviewed on deploy - never a live API. When touching this file, re-check
 * every source below and move PRICING_AS_OF forward. The model constants
 * (rows per operation, messages per connection) are deliberately visible on
 * the page: an estimate whose assumptions are hidden is an ad, not a tool.
 */

export const PRICING_AS_OF = '2026-08-06';

export const PRICING_SOURCES = [
	{
		label: 'Cloudflare Workers pricing',
		url: 'https://developers.cloudflare.com/workers/platform/pricing/'
	},
	{
		label: 'Durable Objects pricing',
		url: 'https://developers.cloudflare.com/durable-objects/platform/pricing/'
	},
	{ label: 'Cloud Firestore pricing', url: 'https://firebase.google.com/docs/firestore/pricing' },
	{ label: 'Firebase pricing', url: 'https://firebase.google.com/pricing' },
	{
		label: 'Identity Platform pricing',
		url: 'https://cloud.google.com/identity-platform/pricing'
	},
	{ label: 'Supabase pricing', url: 'https://supabase.com/pricing' }
] as const;

/** Workers Paid plan + Durable Objects (SQLite storage backend). */
const CF = {
	baseUsd: 5,
	workersReqIncluded: 10_000_000,
	workersReqUsdPerM: 0.3,
	cpuMsIncluded: 30_000_000,
	cpuUsdPerMMs: 0.02,
	doReqIncluded: 1_000_000,
	doReqUsdPerM: 0.15,
	durationGbsIncluded: 400_000,
	durationUsdPerMGbs: 12.5,
	rowsReadIncluded: 25_000_000_000,
	rowsReadUsdPerM: 0.001,
	rowsWrittenIncluded: 50_000_000,
	rowsWrittenUsdPerM: 1,
	storageGbIncluded: 5,
	storageUsdPerGbMonth: 0.2
} as const;

/**
 * SQLite-backed Durable Objects are available on the WORKERS FREE plan - a
 * workload inside these daily allowances runs at $0. Daily limits are folded
 * to per-month here (steady traffic assumption, stated on the page).
 */
const CF_FREE = {
	doReqPerMonth: 100_000 * 30,
	rowsReadPerMonth: 5_000_000 * 30,
	rowsWrittenPerMonth: 100_000 * 30,
	storageGb: 5
} as const;

/** Firestore, nam5 multi-region rates; free tier folded in per month. */
const FIREBASE = {
	readsUsdPer100k: 0.06,
	writesUsdPer100k: 0.18,
	storageUsdPerGbMonth: 0.18,
	freeReadsPerMonth: 50_000 * 30,
	freeWritesPerMonth: 20_000 * 30,
	freeStorageGb: 1
} as const;

/**
 * Firebase Auth beyond the no-cost 50k MAU bills at Identity Platform's
 * graduated Tier-1 (email/social) rates: each band prices only the users
 * inside it.
 */
const FIREBASE_AUTH_TIERS = [
	{ upTo: 50_000, usdPerMau: 0 },
	{ upTo: 100_000, usdPerMau: 0.0055 },
	{ upTo: 1_000_000, usdPerMau: 0.0046 },
	{ upTo: 10_000_000, usdPerMau: 0.0032 },
	{ upTo: Infinity, usdPerMau: 0.0025 }
] as const;

/** Supabase Pro; the Free plan's limits decide the $0 case. */
const SUPABASE = {
	proBaseUsd: 25,
	mauIncluded: 100_000,
	mauUsd: 0.00325,
	dbGbIncluded: 8,
	dbUsdPerGb: 0.125,
	connectionsIncluded: 500,
	connectionsUsdPer1000: 10,
	messagesIncluded: 5_000_000,
	messagesUsdPerM: 2.5,
	free: {
		mau: 50_000,
		dbGb: 0.5,
		connections: 200,
		messagesPerMonth: 2_000_000
	}
} as const;

/**
 * Model assumptions, stated on the page:
 * - One API read/write = 1 Workers request (the proxy) + 1 Durable Object
 *   request, ~3ms of Worker CPU and ~5ms of DO wall time at 128 MB.
 * - A read touches ~4 SQLite rows (document + config/subscription lookups);
 *   a write touches ~3.
 * - Each realtime connection receives ~50 pushed updates a day. On
 *   Frostbase a pushed update is a WebSocket message (a DO request);
 *   on Firebase every document a listener receives bills as a READ.
 */
export const MODEL = {
	rowsPerRead: 4,
	rowsPerWrite: 3,
	messagesPerConnectionMonth: 1_500,
	cpuMsPerOp: 3,
	doGbsPerOp: 0.005 * 0.128
} as const;

export interface WorkloadInputs {
	/** Document/row reads per month. */
	reads: number;
	/** Document/row writes per month. */
	writes: number;
	/** Stored data in GB. */
	storageGb: number;
	/** Concurrent realtime connections. */
	connections: number;
	/** Monthly active (authenticated) users. */
	mau: number;
}

export interface CostItem {
	id: 'base' | 'requests' | 'rows' | 'storage';
	label: string;
	usd: number;
	/** What this line is made of, for the tooltip/legend. */
	detail: string;
}

export interface CloudflareEstimate {
	totalUsd: number;
	items: CostItem[];
	/** True when the workload fits the Workers FREE plan's DO allowances. */
	freeTier: boolean;
}

const overage = (used: number, included: number) => Math.max(0, used - included);

export function estimateCloudflare(inputs: WorkloadInputs): CloudflareEstimate {
	const ops = inputs.reads + inputs.writes;
	const messages = inputs.connections * MODEL.messagesPerConnectionMonth;

	// SQLite-backed Durable Objects run on the free plan; a workload inside
	// its allowances has no bill at all. MAU never matters here - auth
	// requests are ordinary requests, there is no per-user charge.
	const freeTier =
		ops + messages <= CF_FREE.doReqPerMonth &&
		inputs.reads * MODEL.rowsPerRead <= CF_FREE.rowsReadPerMonth &&
		inputs.writes * MODEL.rowsPerWrite <= CF_FREE.rowsWrittenPerMonth &&
		inputs.storageGb <= CF_FREE.storageGb;
	if (freeTier) {
		return {
			totalUsd: 0,
			freeTier,
			items: [
				{
					id: 'base',
					label: 'Workers Free plan',
					usd: 0,
					detail:
						'Durable Objects are on the free tier: 100k requests, 5M rows read, and 100k rows written per day, 5 GB stored.'
				}
			]
		};
	}

	const workersReqUsd = (overage(ops, CF.workersReqIncluded) / 1e6) * CF.workersReqUsdPerM;
	const cpuUsd = (overage(ops * MODEL.cpuMsPerOp, CF.cpuMsIncluded) / 1e6) * CF.cpuUsdPerMMs;
	const doReqUsd = (overage(ops + messages, CF.doReqIncluded) / 1e6) * CF.doReqUsdPerM;
	const durationUsd =
		(overage(ops * MODEL.doGbsPerOp, CF.durationGbsIncluded) / 1e6) * CF.durationUsdPerMGbs;

	const rowsReadUsd =
		(overage(inputs.reads * MODEL.rowsPerRead, CF.rowsReadIncluded) / 1e6) * CF.rowsReadUsdPerM;
	const rowsWrittenUsd =
		(overage(inputs.writes * MODEL.rowsPerWrite, CF.rowsWrittenIncluded) / 1e6) *
		CF.rowsWrittenUsdPerM;

	const storageUsd = overage(inputs.storageGb, CF.storageGbIncluded) * CF.storageUsdPerGbMonth;

	const items: CostItem[] = [
		{
			id: 'base',
			label: 'Workers Paid base',
			usd: CF.baseUsd,
			detail: 'The $5/month plan; most included allowances live here.'
		},
		{
			id: 'requests',
			label: 'Requests & compute',
			usd: workersReqUsd + cpuUsd + doReqUsd + durationUsd,
			detail: 'Worker + Durable Object requests (realtime pushes included) plus CPU and duration.'
		},
		{
			id: 'rows',
			label: 'Database rows',
			usd: rowsReadUsd + rowsWrittenUsd,
			detail: 'SQLite rows read ($0.001/M after 25 BILLION included) and written ($1/M after 50M).'
		},
		{
			id: 'storage',
			label: 'Storage',
			usd: storageUsd,
			detail: '$0.20/GB-month after the included 5 GB.'
		}
	];

	return {
		totalUsd: items.reduce((sum, item) => sum + item.usd, 0),
		items,
		freeTier
	};
}

export interface FirebaseEstimate {
	totalUsd: number;
	readsUsd: number;
	writesUsd: number;
	storageUsd: number;
	authUsd: number;
	/** The listener reads share of the reads bill - the structural difference. */
	listenerReads: number;
}

/** Graduated: each band prices only the MAU inside it. */
function firebaseAuthUsd(mau: number): number {
	let usd = 0;
	let previous = 0;
	for (const tier of FIREBASE_AUTH_TIERS) {
		const span = Math.min(mau, tier.upTo) - previous;
		if (span <= 0) break;
		usd += span * tier.usdPerMau;
		previous = tier.upTo;
	}
	return usd;
}

export function estimateFirebase(inputs: WorkloadInputs): FirebaseEstimate {
	// Firestore bills every document a realtime listener receives as a READ -
	// fan-out scales the bill by subscriber count.
	const listenerReads = inputs.connections * MODEL.messagesPerConnectionMonth;
	const reads = inputs.reads + listenerReads;

	const readsUsd =
		(overage(reads, FIREBASE.freeReadsPerMonth) / 100_000) * FIREBASE.readsUsdPer100k;
	const writesUsd =
		(overage(inputs.writes, FIREBASE.freeWritesPerMonth) / 100_000) * FIREBASE.writesUsdPer100k;
	const storageUsd =
		overage(inputs.storageGb, FIREBASE.freeStorageGb) * FIREBASE.storageUsdPerGbMonth;
	const authUsd = firebaseAuthUsd(inputs.mau);

	return {
		totalUsd: readsUsd + writesUsd + storageUsd + authUsd,
		readsUsd,
		writesUsd,
		storageUsd,
		authUsd,
		listenerReads
	};
}

export interface SupabaseEstimate {
	totalUsd: number;
	baseUsd: number;
	mauUsd: number;
	storageUsd: number;
	realtimeUsd: number;
	/** True when the workload fits the Free plan's limits. */
	freeTier: boolean;
}

export function estimateSupabase(inputs: WorkloadInputs): SupabaseEstimate {
	const messages = inputs.connections * MODEL.messagesPerConnectionMonth;

	const freeTier =
		inputs.mau <= SUPABASE.free.mau &&
		inputs.storageGb <= SUPABASE.free.dbGb &&
		inputs.connections <= SUPABASE.free.connections &&
		messages <= SUPABASE.free.messagesPerMonth;
	if (freeTier) {
		return { totalUsd: 0, baseUsd: 0, mauUsd: 0, storageUsd: 0, realtimeUsd: 0, freeTier };
	}

	// Reads/writes are deliberately NOT priced: Supabase meters compute, not
	// operations, so sustained load means bigger instances - unmodeled here,
	// in Supabase's favor. The $25 Pro base includes $10 compute credits
	// (one Micro instance).
	const baseUsd = SUPABASE.proBaseUsd;
	const mauUsd = overage(inputs.mau, SUPABASE.mauIncluded) * SUPABASE.mauUsd;
	const storageUsd = overage(inputs.storageGb, SUPABASE.dbGbIncluded) * SUPABASE.dbUsdPerGb;
	const realtimeUsd =
		(overage(inputs.connections, SUPABASE.connectionsIncluded) / 1_000) *
			SUPABASE.connectionsUsdPer1000 +
		(overage(messages, SUPABASE.messagesIncluded) / 1e6) * SUPABASE.messagesUsdPerM;

	return {
		totalUsd: baseUsd + mauUsd + storageUsd + realtimeUsd,
		baseUsd,
		mauUsd,
		storageUsd,
		realtimeUsd,
		freeTier
	};
}

// ---------------------------------------------------------------------------
// Presets and slider scales

export interface Preset {
	id: string;
	label: string;
	description: string;
	inputs: WorkloadInputs;
}

export const PRESETS: Preset[] = [
	{
		id: 'side',
		label: 'Side project',
		description: 'A few hundred users, evenings and weekends.',
		inputs: { reads: 200_000, writes: 50_000, storageGb: 0.5, connections: 25, mau: 500 }
	},
	{
		id: 'startup',
		label: 'Growing startup',
		description: 'Tens of thousands of users with live screens.',
		inputs: { reads: 20_000_000, writes: 3_000_000, storageGb: 20, connections: 2_000, mau: 25_000 }
	},
	{
		id: 'scale',
		label: '1M-user app',
		// Realtime-first on purpose: live queries REPLACE polling reads, so the
		// read count is modest while every open screen holds a subscription.
		description: 'Realtime-first: live queries replace polling.',
		inputs: {
			reads: 20_000_000,
			writes: 10_000_000,
			storageGb: 200,
			connections: 100_000,
			mau: 1_000_000
		}
	}
];

/** Stepped slider scales - clean values over a log-ish range. */
export const SCALES = {
	reads: [
		50_000, 100_000, 200_000, 500_000, 1e6, 2e6, 5e6, 10e6, 20e6, 50e6, 100e6, 200e6, 300e6, 500e6,
		1e9
	],
	writes: [
		10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1e6, 3e6, 5e6, 10e6, 20e6, 40e6, 100e6, 200e6
	],
	storageGb: [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000],
	connections: [10, 25, 100, 250, 500, 1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000],
	mau: [500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1e6, 2e6, 5e6]
} as const;

/** Nearest index into a scale for a preset value. */
export function scaleIndex(scale: readonly number[], value: number): number {
	let best = 0;
	for (let i = 1; i < scale.length; i += 1) {
		if (Math.abs(scale[i] - value) < Math.abs(scale[best] - value)) best = i;
	}
	return best;
}

export function formatCount(value: number): string {
	if (value >= 1e9) return `${(value / 1e9).toFixed(value % 1e9 ? 1 : 0)}B`;
	if (value >= 1e6) return `${(value / 1e6).toFixed(value % 1e6 ? 1 : 0)}M`;
	if (value >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
	return String(value);
}

export function formatUsd(value: number): string {
	if (value >= 1_000) {
		return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
	}
	return `$${value.toFixed(2)}`;
}
