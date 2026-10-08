/**
 * The binding contract for a Worker hosting `@frostbase-dev/storage`.
 *
 * `AssertStorageAgentEnv<Env>` is an identity type whose CONSTRAINT does the
 * checking: the consumer's entrypoint template instantiates it with their
 * generated `Env`, so a missing or mistyped binding fails their typecheck
 * with the field named, before anything deploys. Required vs optional here
 * describes what a correct deployment provides, not what the runtime happens
 * to tolerate.
 */

// The namespace type is effectively invariant, so `never` and `unknown` each
// fail one direction; `any` is what accepts every concrete class.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDurableObjectNamespace = DurableObjectNamespace<any>;

export interface StorageAgentBindings {
	/** The orchestrator Durable Object, one instance per project. */
	StorageAgent: AnyDurableObjectNamespace;
	/** One index Durable Object per bucket (`<projectId>:<bucket>`). */
	StorageBucket: AnyDurableObjectNamespace;
	/**
	 * The shared R2 bucket, key-prefixed per project. Optional on purpose: R2
	 * is an account-level opt-in behind a dashboard checkout, and without it
	 * the agent answers object requests 503 instead of failing the whole
	 * install's deploy. NEVER enable r2.dev or attach a custom domain to this
	 * bucket - either one serves every tenant's keys raw, bypassing the
	 * per-bucket access modes this worker enforces.
	 */
	BUCKET?: R2Bucket;
	/** JWKS source for `auth`/`owner` buckets (multi-worker deployments). */
	AUTH_AGENT?: Fetcher;
	/** JWKS source in single-worker installs (`add auth` put the class here). */
	AuthAgent?: AnyDurableObjectNamespace;
	/** Extra origins the object paths trust for CORS, comma-separated. */
	TRUSTED_ORIGINS?: string;
	/**
	 * Hostname the worker serves objects on (e.g. cdn.example.com), for
	 * deployments that route a dedicated domain to this Worker. GET/HEAD only,
	 * path shape `/<projectId>/<bucket>/<key>`, same per-bucket enforcement as
	 * the agent path. This is a WORKER route - the R2 bucket itself must never
	 * carry a custom domain (see BUCKET above). Empty disables the path.
	 */
	STORAGE_SERVE_DOMAIN?: string;
	/**
	 * `"true"` when `STORAGE_SERVE_DOMAIN` is genuinely REACHABLE - routed at
	 * this Worker with DNS behind it - and may therefore be handed out in URLs.
	 *
	 * Deliberately a second fact, not folded into the first. A domain can be
	 * SET without being routed, which is what local dev and the e2e stack do:
	 * they name a host that resolves nowhere and reach the serving path through
	 * the `x-frostbase-host` stand-in. Advertising that host would mint URLs that
	 * resolve to nothing - the exact bug that made signed URLs build on the
	 * request's origin in the first place. Unset means "serve on it if a
	 * request somehow arrives, but never speak its name".
	 */
	STORAGE_SERVE_DOMAIN_ROUTED?: string;
	/**
	 * Comma-separated hostnames served exactly like `STORAGE_SERVE_DOMAIN` but
	 * never handed out in URLs - a domain the deployment moved away from, kept
	 * so object URLs already stored in apps keep resolving.
	 */
	STORAGE_SERVE_DOMAIN_ALIASES?: string;
	SENTRY_DSN?: string;
	SENTRY_ENV?: string;

	/**
	 * Serves the agent's own routes (`/overview`, `/admin/*`, the state-sync
	 * socket, `/internal/*`) over HTTP. They read and write every bucket
	 * whatever its access mode, and none authenticate a caller - set this only
	 * on a Worker with no public hostname, fronted by something that
	 * authenticates operators.
	 *
	 * Unset (the default, and what `template/wrangler-fragment.jsonc` ships)
	 * they 404. The public `/buckets/*` object paths are unaffected, and your
	 * own code reaches the agent through the Durable Object namespaces either
	 * way.
	 */
	EXPOSE_OPERATOR_API?: 'true';
}

export type AssertStorageAgentEnv<E extends StorageAgentBindings> = E;
