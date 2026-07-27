import { getAgentByName } from 'agents';
import type { AuthAgent, FleetProjectCounts } from './agent';
import { analyticsApiResponseSchema, DEMO_PROJECT_PATTERN, projectIdSchema } from './schemas';

/**
 * Cross-project fleet rollup for the platform admin dashboard.
 *
 * There is no registry of projects - an AuthAgent exists lazily per project
 * id. The only fleet-wide trace is the auth-event stream (Analytics Engine in
 * deployed environments, the LOCAL_ANALYTICS D1 mirror in local/test), so the
 * project list is derived from event data and each listed project's Durable
 * Object is then asked for authoritative counts over RPC.
 *
 * Served by the worker entrypoint at /fleet/overview - deliberately outside
 * /agents/*, so it is reachable only through the dashboard's AUTH_AGENT
 * service binding: the agent worker has no public route and the dashboard
 * only forwards /agents/* paths.
 */

export interface FleetProject {
	projectId: string;
	/** Matches the dashboard's browser-demo naming convention (`demo-<hex>`). */
	demo: boolean;
	/** Event-derived and approximate (sampling, 90-day retention window). */
	firstSeenAt: string | null;
	lastSeenAt: string | null;
	events: number;
	/**
	 * Authoritative Durable Object counts; null when the project was beyond the
	 * fan-out limit or its agent could not be reached.
	 */
	counts: FleetProjectCounts | null;
}

export interface FleetTotals {
	projects: number;
	demoProjects: number;
	/** Sums over projects with authoritative counts only. */
	users: number;
	registeredUsers: number;
	anonymousUsers: number;
	activeSessions: number;
	uncountedProjects: number;
}

export interface FleetOverview {
	generatedAt: string;
	/** Where the project list came from. */
	source: 'analytics-engine' | 'local-d1' | 'none';
	projects: FleetProject[];
	totals: FleetTotals;
	error?: string;
}

interface ProjectListing {
	projectId: string;
	firstSeenAt: string | null;
	lastSeenAt: string | null;
	events: number;
}

/** How many Durable Objects one fleet request may wake, and how fast. */
const DEFAULT_COUNT_LIMIT = 100;
const MAX_COUNT_LIMIT = 500;
const COUNT_CONCURRENCY = 10;

/** Accepts D1 epoch millis and Analytics Engine 'YYYY-MM-DD HH:MM:SS' (UTC). */
function toIso(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const date =
		typeof value === 'number'
			? new Date(value)
			: new Date(
					String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`,
				);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function listFromAnalyticsEngine(config: {
	accountId: string;
	token: string;
	dataset: string;
}): Promise<ProjectListing[]> {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.dataset)) {
		throw new Error('WAE_DATASET must be a valid Analytics Engine identifier');
	}
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/analytics_engine/sql`,
		{
			method: 'POST',
			headers: { authorization: `Bearer ${config.token}` },
			body: `SELECT index1 AS projectId, min(timestamp) AS firstSeen, max(timestamp) AS lastSeen, SUM(_sample_interval) AS events FROM ${config.dataset} WHERE timestamp > NOW() - INTERVAL '90' DAY GROUP BY projectId FORMAT JSON`,
		},
	);
	if (!response.ok) {
		throw new Error(`Analytics Engine fleet query failed (${response.status})`);
	}
	const result = analyticsApiResponseSchema.parse(await response.json());
	return ((result.data ?? []) as Record<string, unknown>[]).map((row) => ({
		projectId: String(row.projectId ?? ''),
		firstSeenAt: toIso(row.firstSeen),
		lastSeenAt: toIso(row.lastSeen),
		events: Number(row.events ?? 0),
	}));
}

async function listFromLocalAnalytics(db: D1Database): Promise<ProjectListing[]> {
	const result = await db
		.prepare(
			`SELECT project_id AS projectId, MIN(timestamp) AS firstSeen, MAX(timestamp) AS lastSeen, COUNT(*) AS events FROM auth_events GROUP BY project_id`,
		)
		.all<{ projectId: string; firstSeen: number; lastSeen: number; events: number }>();
	return (result.results ?? []).map((row) => ({
		projectId: row.projectId,
		firstSeenAt: toIso(row.firstSeen),
		lastSeenAt: toIso(row.lastSeen),
		events: Number(row.events ?? 0),
	}));
}

async function collectCounts(
	env: Env,
	projectIds: string[],
): Promise<Map<string, FleetProjectCounts | null>> {
	const counts = new Map<string, FleetProjectCounts | null>();
	for (let index = 0; index < projectIds.length; index += COUNT_CONCURRENCY) {
		const batch = projectIds.slice(index, index + COUNT_CONCURRENCY);
		await Promise.all(
			batch.map(async (projectId) => {
				try {
					const agent = await getAgentByName(
						env.AuthAgent as unknown as DurableObjectNamespace<AuthAgent>,
						projectId,
					);
					counts.set(projectId, await agent.getFleetCounts());
				} catch (error) {
					console.error(`fleet counts failed for project "${projectId}"`, error);
					counts.set(projectId, null);
				}
			}),
		);
	}
	return counts;
}

export async function getFleetOverview(
	env: Env,
	limit = DEFAULT_COUNT_LIMIT,
): Promise<FleetOverview> {
	const accountId = env.CF_ACCOUNT_ID;
	const token = env.CF_ANALYTICS_API_TOKEN;
	const dataset = env.WAE_DATASET;
	const waeConfig = accountId && token && dataset ? { accountId, token, dataset } : null;
	const source: FleetOverview['source'] = waeConfig
		? 'analytics-engine'
		: env.LOCAL_ANALYTICS
			? 'local-d1'
			: 'none';

	let listings: ProjectListing[] = [];
	let error: string | undefined;
	try {
		if (waeConfig) {
			listings = await listFromAnalyticsEngine(waeConfig);
		} else if (env.LOCAL_ANALYTICS) {
			listings = await listFromLocalAnalytics(env.LOCAL_ANALYTICS);
		}
	} catch (cause) {
		error = cause instanceof Error ? cause.message : 'fleet listing failed';
		console.error('fleet listing failed', cause);
	}

	listings = listings
		.filter((listing) => projectIdSchema.safeParse(listing.projectId).success)
		.sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));

	const capped = Math.min(Math.max(Math.trunc(limit), 0), MAX_COUNT_LIMIT);
	const counts = await collectCounts(
		env,
		listings.slice(0, capped).map((listing) => listing.projectId),
	);

	const projects: FleetProject[] = listings.map((listing) => ({
		...listing,
		demo: DEMO_PROJECT_PATTERN.test(listing.projectId),
		counts: counts.get(listing.projectId) ?? null,
	}));

	const counted = projects.filter((project) => project.counts !== null);
	return {
		generatedAt: new Date().toISOString(),
		source,
		projects,
		totals: {
			projects: projects.length,
			demoProjects: projects.filter((project) => project.demo).length,
			users: counted.reduce((sum, project) => sum + project.counts!.users, 0),
			registeredUsers: counted.reduce((sum, project) => sum + project.counts!.registeredUsers, 0),
			anonymousUsers: counted.reduce((sum, project) => sum + project.counts!.anonymousUsers, 0),
			activeSessions: counted.reduce((sum, project) => sum + project.counts!.activeSessions, 0),
			uncountedProjects: projects.length - counted.length,
		},
		error,
	};
}
