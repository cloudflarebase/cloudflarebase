/**
 * The binding contract for consumers of `@cloudflarebase/auth`.
 *
 * The Agents SDK constrains `Agent<Env, State>` against `Cloudflare.Env`, which
 * is an empty declaration-merge target that `wrangler types` fills in from your
 * own wrangler configuration. That is what makes this package portable: the
 * emitted declarations name `Env` rather than inlining ours, so in your project
 * `Env` is *your* generated type, not this repository's.
 *
 * The cost of that portability is that nothing would otherwise check you
 * actually declared the bindings the agent reads - a missing one would surface
 * as a runtime failure on first request. `AssertAuthAgentEnv` closes that gap.
 *
 * Required vs optional here describes what a correct deployment provides, not
 * what the runtime happens to tolerate. The agent guards its optional bindings
 * (analytics writes are wrapped, `WAE_DATASET` falls back, `/chat` fails alone)
 * so that a degraded binding never breaks authentication. That resilience is
 * deliberate and is not an invitation to omit them.
 */

/**
 * `DurableObjectNamespace` is branded by its agent class, and the class you
 * bind is the Sentry-instrumented subclass rather than `AuthAgent` itself. The
 * brand is not worth reproducing across a package boundary - `fleet.ts` already
 * casts through it internally - so the contract checks that the binding exists
 * and is a namespace, and leaves the instance type to the caller.
 *
 * `any` is the only argument that accepts every parameterisation: the namespace
 * is effectively invariant, so `never` and `unknown` each fail one direction of
 * the assignability check that a consumer's concrete class has to pass.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDurableObjectNamespace = DurableObjectNamespace<any>;

export interface AuthAgentBindings {
	/**
	 * The `AuthAgent` Durable Object namespace. The only binding with no
	 * fallback anywhere in the agent: without it there is no agent to route to.
	 */
	AuthAgent: AnyDurableObjectNamespace;

	/**
	 * Workers Analytics Engine dataset for auth events. Writes need no API
	 * credentials and the dataset auto-creates on first write, so there is no
	 * reason for a deployment to lack it - every environment in the shipped
	 * wrangler configuration declares it.
	 */
	AUTH_EVENTS: AnalyticsEngineDataset;

	/** Workers AI. Required only for `POST /chat`, which 502s without it. */
	AI?: Ai;
	/** Defaults to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. */
	CHAT_MODEL?: string;

	/** Cloudflare Email Service binding, with the address to send as. */
	EMAIL?: SendEmail;
	EMAIL_FROM?: string;

	/**
	 * CSRF allowlist for origins beyond the deployment's own, comma separated.
	 * The agent trusts its own origin automatically, so this stays empty until
	 * another domain serves your UI or calls the API with cookies.
	 */
	TRUSTED_ORIGINS?: string;

	/**
	 * Overrides the per-project signing key for every project on the
	 * deployment. Unset is the supported default: each project generates and
	 * stores its own, so a fresh install needs no secret set by hand.
	 */
	BETTER_AUTH_SECRET?: string;

	/** Dataset name for Analytics Engine SQL reads. */
	WAE_DATASET?: string;
	/** SQL read credentials. Writes need neither; without them analytics is write-only. */
	CF_ACCOUNT_ID?: string;
	CF_ANALYTICS_API_TOKEN?: string;
	/** D1 mirror of auth events, for local and test analytics without credentials. */
	LOCAL_ANALYTICS?: D1Database;

	/**
	 * Makes `demo-<hex>` projects throwaway: capped users, a daily inference
	 * ceiling, no outbound mail, and self-erasure after `DEMO_TTL_HOURS`. Also
	 * refuses the console owner claim. Only wanted on a public demo.
	 */
	DEMO_MODE?: 'true';
	DEMO_TTL_HOURS?: string;

	/** Social sign-in, also configurable per project from the console. */
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;

	/** Empty disables reporting, which is the default - no DSN is committed. */
	SENTRY_DSN?: string;
	SENTRY_ENV?: string;

	/** Test-only. Exhausting persisted rate-limit buckets breaks reused stacks. */
	DISABLE_RATE_LIMIT?: 'true';
}

/**
 * Checks a generated `Env` against the agent's binding contract at compile time.
 * A missing or wrongly typed binding is named in the error instead of failing
 * on first request. Use it once, anywhere in your Worker:
 *
 * ```ts
 * import type { AssertAuthAgentEnv } from '@cloudflarebase/auth';
 * type _AuthBindings = AssertAuthAgentEnv<Env>;
 * ```
 */
export type AssertAuthAgentEnv<E extends AuthAgentBindings> = E;
