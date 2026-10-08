/**
 * The binding contract for consumers of `@frostbase-dev/auth`.
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
 * brand is not worth reproducing across a package boundary, so the contract
 * checks that the binding exists and is a namespace, and leaves the instance
 * type to the caller.
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
	 * Workers Analytics Engine dataset for auth events. OPTIONAL, and the reason
	 * is a deploy-time one rather than a runtime one: Analytics Engine is an
	 * account-level opt-in with no API and no Wrangler flag, so declaring this
	 * binding makes `wrangler deploy` fail outright with
	 * `no_access_to_analytics_engine` (code 10089) on any account that has never
	 * enabled it in the dashboard. Requiring it meant a first deploy could not
	 * succeed at all.
	 *
	 * It buys nothing on its own either: reading these events needs
	 * CF_ACCOUNT_ID + CF_ANALYTICS_API_TOKEN, both optional, so an install
	 * without them was writing datapoints nobody could ever read.
	 *
	 * Unset, every write is skipped (`this.env.AUTH_EVENTS?.writeDataPoint`) and
	 * the agent is otherwise unaffected - analytics simply report nothing.
	 */
	AUTH_EVENTS?: AnalyticsEngineDataset;

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

	/**
	 * Social sign-in for the CONSOLE instance (deployment-level secrets; the
	 * OAuth redirect URI is per project, so they never spread to other
	 * projects). Customer projects configure providers via PUT /admin/settings.
	 */
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;

	/** Empty disables reporting, which is the default - no DSN is committed. */
	SENTRY_DSN?: string;
	SENTRY_ENV?: string;

	/**
	 * Serves the operator routes (`/overview`, `/analytics`, `/chat`,
	 * `/admin/*`, the state-sync socket, `/internal/*`) over HTTP. They carry
	 * NO authentication of their own - the caller is trusted because of where
	 * the request could have come from - so set this only on a Worker with no
	 * public hostname, fronted by something that authenticates operators.
	 *
	 * Unset (the default, and what `template/wrangler-fragment.jsonc` ships)
	 * those routes 404 and only the manifest's `public` routes answer, which
	 * is what a Worker that also serves your app needs. Your own code reaches
	 * the agent through the Durable Object namespace either way.
	 */
	EXPOSE_OPERATOR_API?: 'true';

	/** Test-only. Exhausting persisted rate-limit buckets breaks reused stacks. */
	DISABLE_RATE_LIMIT?: 'true';

	/** Ceiling on organizations one user may create (default 5). */
	MAX_ORGS_PER_USER?: string;

	/**
	 * Local-dev only. Open console sign-ups normally refuse sign-in until the
	 * email is verified; local mail lands in wrangler's .eml files, so this
	 * lets sign-up flow straight into a session instead.
	 */
	DISABLE_EMAIL_VERIFICATION?: 'true';
}

/**
 * Checks a generated `Env` against the agent's binding contract at compile time.
 * A missing or wrongly typed binding is named in the error instead of failing
 * on first request. Use it once, anywhere in your Worker:
 *
 * ```ts
 * import type { AssertAuthAgentEnv } from '@frostbase-dev/auth';
 * type _AuthBindings = AssertAuthAgentEnv<Env>;
 * ```
 */
export type AssertAuthAgentEnv<E extends AuthAgentBindings> = E;
