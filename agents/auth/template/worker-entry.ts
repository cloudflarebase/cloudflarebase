/**
 * Worker entrypoint for a Worker that hosts `@cloudflarebase/auth`.
 *
 * Copy this to the file your `wrangler.jsonc` names as `main`.
 *
 * A Durable Object class has to be exported from the Worker's own entrypoint
 * for Wrangler to find it, so re-exporting is not optional plumbing — it is how
 * the binding resolves. The default export is the fetch handler that routes
 * `/agents/auth-agent/<projectId>/...` to the right instance.
 */
export { AuthAgent, default } from '@cloudflarebase/auth';

/**
 * Compile-time check that your generated `Env` carries the bindings the agent
 * reads. Delete it and a missing binding becomes a runtime failure on the first
 * request instead of a named type error here.
 *
 * Run `npx wrangler types` after editing `wrangler.jsonc` to regenerate `Env`.
 */
import type { AssertAuthAgentEnv } from '@cloudflarebase/auth';
export type _AuthAgentBindings = AssertAuthAgentEnv<Env>;
