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
			/** Whether this deployment runs as a public demo (DEMO_MODE=true). */
			demoMode: boolean;
		}

		interface Platform {
			env: Env & {
				/** Service binding to the auth-agent worker (fetch-only interface). */
				AUTH_AGENT: Fetcher;
			};
			cf: CfProperties;
			ctx: ExecutionContext;
		}
	}
}

export {};
