/**
 * Worker entrypoint for a Worker that hosts `@frostbase-dev/db`.
 *
 * Copy this to the file your `wrangler.jsonc` names as `main`.
 *
 * Durable Object classes have to be exported from the Worker's own entrypoint
 * for Wrangler to find them, so re-exporting is not optional plumbing - it is
 * how the bindings resolve. The default export is the fetch handler that
 * routes `/agents/db-agent/<projectId>/...` to the right instances.
 *
 * Already have a default export (for example from `@frostbase-dev/auth`)?
 * Re-export only the classes - the existing agent handler routes to any
 * Durable Object binding by name:
 *
 *   export { DbAgent, DbCollection } from '@frostbase-dev/db';
 */
export { DbAgent, DbCollection, default } from '@frostbase-dev/db';

/**
 * Compile-time check that your generated `Env` carries the bindings the agent
 * reads. Delete it and a missing binding becomes a runtime failure on the
 * first request instead of a named type error here.
 *
 * Run `npx wrangler types` after editing `wrangler.jsonc` to regenerate `Env`.
 */
import type { AssertDbAgentEnv } from '@frostbase-dev/db';
export type _DbAgentBindings = AssertDbAgentEnv<Env>;
