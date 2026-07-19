// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
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
