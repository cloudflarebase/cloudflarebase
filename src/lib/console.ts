/**
 * Console identity shared by browser and server code. The server-only session
 * helpers live in $lib/server/console.ts.
 */

/**
 * Reserved project id for the dashboard's own operator auth - Frostbase
 * authenticating its console with the same stack it sells. Mirrored in
 * agents/auth/src/agent.ts; keep both in sync.
 */
export const CONSOLE_PROJECT_ID = 'console';

/** Same-origin base for the console's Better Auth endpoints. */
export const CONSOLE_AUTH_BASE = `/api/projects/${CONSOLE_PROJECT_ID}/auth`;

/**
 * Project ids the registry refuses. `console` is the operator auth instance;
 * the rest would collide with dashboard routes or read as system endpoints.
 *
 * Refusing to MINT them is only half the contract - the guard also refuses to
 * ROUTE to them (`consoleGuardHandle`). No session can legitimately own a
 * reserved id, so a project-scoped request naming one is either a mistake or
 * an attempt to address the console's own instance, where every operator
 * account on the deployment lives.
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
	'fleet',
	'organization'
]);

/**
 * Static children of `/dashboard` - console pages, not projects. SvelteKit
 * resolves them ahead of `[projectId]`, so the guard must classify them as
 * project-LESS operator pages or they would be refused as reserved project
 * ids. Every entry MUST also appear in RESERVED_PROJECT_IDS: a project able to
 * take one of these ids would be permanently shadowed by the static route.
 */
export const CONSOLE_DASHBOARD_PAGES = new Set(['organization']);

/**
 * Demo projects are minted per visitor by the demo landing flow. Roots are
 * `demo-<hex>` (12 hex since demo branches shipped, 20 before - both stay
 * valid), and a demo BRANCH is `demo-<hex>--<branch>` with the registry's
 * branch-name grammar: demos get production/preview branches like any other
 * project, so the whole demo family must share the demo caps, TTL erasure,
 * and anonymous access. Mirrored in agents/auth and agents/db schemas.ts;
 * keep all three in sync.
 */
const DEMO_PROJECT_PATTERN = /^demo-[a-f0-9]{12,20}(?:--[a-z0-9][a-z0-9-]{0,15})?$/;

export function isDemoProjectId(projectId: string): boolean {
	return DEMO_PROJECT_PATTERN.test(projectId);
}

/** Root demo id for a possibly-branched demo id: `demo-x--stg` -> `demo-x`. */
export function demoRootId(projectId: string): string {
	const separator = projectId.indexOf('--');
	return separator === -1 ? projectId : projectId.slice(0, separator);
}

/**
 * The console operator's identity: session plus organization memberships,
 * resolved in ONE round trip by the console AuthAgent's GET /console/me
 * (mirrored in agents/auth/src/agent.ts; keep both in sync) and memoized per
 * request as `locals.consoleIdentity`.
 */
export interface ConsoleOrgMembership {
	id: string;
	name: string;
	slug: string;
	/** The operator's role INSIDE the org (owner/admin/member). */
	role: string;
}

export interface ConsolePendingInvitation {
	id: string;
	organizationId: string;
	organizationName: string;
	role: string | null;
	inviterEmail: string | null;
	expiresAt: string;
}

export interface ConsoleIdentity {
	user: {
		id: string;
		email: string;
		name: string;
		role: string;
		emailVerified: boolean;
		image: string | null;
	};
	/** The org the operator is acting as - session state, set via the Better
	 * Auth organization plugin's set-active endpoint. Falls back to the first
	 * membership when null. */
	activeOrganizationId: string | null;
	organizations: ConsoleOrgMembership[];
	pendingInvitations: ConsolePendingInvitation[];
}

/**
 * Whether an org role may administer the org and the projects it owns:
 * rename or delete a project, rename the org, invite and remove people.
 *
 * `owner` and `admin` may; a plain `member` may not. This mirrors what Better
 * Auth's organization plugin already enforces server-side for its own
 * endpoints (its default `memberAc` grants nothing but `ac: read`), and it is
 * defined here so the console's own destructive surfaces - project deletion
 * above all - cannot drift from that. Membership is permission to USE a
 * project, never permission to erase it.
 *
 * A null role means the project has no owning org (a legacy or self-hosted
 * row), where there is nobody to outrank and every operator is the same
 * person.
 */
export function canAdministerOrg(role: string | null | undefined): boolean {
	return role === 'owner' || role === 'admin';
}

/** The org an identity acts as: the active one, else the first membership. */
export function activeOrg(identity: ConsoleIdentity): ConsoleOrgMembership | null {
	return (
		identity.organizations.find((org) => org.id === identity.activeOrganizationId) ??
		identity.organizations[0] ??
		null
	);
}

/**
 * Surfaces that must never be indexed, and must never describe themselves in a
 * link preview.
 *
 * Two consumers, one list, deliberately: `hooks.server.ts` sets
 * `x-robots-tag: noindex` from it, and the root layout suppresses
 * page-specific Open Graph from it. Splitting them is what produced the bug
 * this exists to prevent - the header was right while the markup still told
 * every scraper the page was `demo-19a63aad9478`.
 */
export const PRIVATE_SURFACES = ['/dashboard', '/login', '/cli-auth', '/api', '/agents'];

export function isPrivateSurface(pathname: string): boolean {
	return PRIVATE_SURFACES.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
	);
}
