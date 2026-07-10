// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Platform {
			env: Env & {
				AUTH_AGENT: Service<import('../agents/auth/src/index').default>;
			};
			cf: CfProperties;
			ctx: ExecutionContext;
		}
	}
}

export {};
