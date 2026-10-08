// Bindings that exist only in OTHER deployment shapes, so `wrangler types`
// never emits them from this repository's config - augmented here instead of
// hand-editing the generated worker-configuration.d.ts. Declaration inputs
// are not copied to dist, so nothing here ships.
interface Env {
	/**
	 * Single-worker consumer installs host the AuthAgent class beside this
	 * agent; JWKS fetches go through the namespace there. This repo's own
	 * deployment uses the AUTH_AGENT service binding instead.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	AuthAgent?: DurableObjectNamespace<any>;
}
