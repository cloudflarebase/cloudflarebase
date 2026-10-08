// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			/**
			 * Operator session for the console, resolved once per request by the
			 * guard in hooks.server.ts. Null for anonymous demo traffic.
			 */
			consoleUser: import('$lib/server/console').ConsoleUser | null;
			/**
			 * The operator's full identity - session plus org memberships and
			 * pending invitations - from the console agent's /console/me, resolved
			 * once per request alongside consoleUser. The guard's ownership check
			 * and the org UI both read this instead of re-fetching.
			 */
			consoleIdentity: import('$lib/console').ConsoleIdentity | null;
			/** Whether this deployment runs as a public demo (DEMO_MODE=true). */
			demoMode: boolean;
			/**
			 * Grant when the request authenticated with a service key
			 *. Set only on its own project's DATA
			 * plane, and only when the request carried no `Origin` - a service
			 * key is a server credential and must never work from a browser.
			 */
			serviceKey: import('$lib/server/service-keys').ServiceKeyGrant | null;
		}

		interface Platform {
			env: Env & {
				/** Service binding to the auth-agent worker (fetch-only interface). */
				AUTH_AGENT: Fetcher;
				/** Service binding to the db-agent worker (fetch-only interface). */
				DB_AGENT: Fetcher;
				/**
				 * Optional per-tenant ceiling overrides (registry.ts defaults both
				 * to 5). Not in any deployed config's vars, so they are typed here
				 * instead of the generated worker-configuration.d.ts; the e2e stack
				 * raises the org ceiling because reused suites accumulate projects.
				 */
				MAX_PROJECTS_PER_ORG?: string;
				MAX_BRANCHES_PER_ROOT?: string;
			};
			cf: CfProperties;
			ctx: ExecutionContext;
		}
	}
}

export {};
