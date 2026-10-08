/**
 * Who may call which route - enforced by the agent itself, not only by
 * whatever sits in front of it. (`access.ts` is the per-request gate on the
 * customer data paths: access modes, JWT, CORS. This is the coarser question
 * of which routes a deployment serves over HTTP at all.)
 *
 * On frostbase.dev the console guard IS the gate for the operator
 * plane, and that is sound there: this worker has no public hostname
 * (`workers_dev` and `preview_urls` false), so the only way in is the
 * dashboard's service binding, and every request through it has already been
 * classified against the manifest's route table and checked for an operator
 * session.
 *
 * A consumer of the published package deploys the opposite shape: the
 * documented install re-exports the default handler from THEIR public
 * Worker. The object paths are fine - `/buckets/*` is public by design and
 * carries `access.ts` with it. The OPERATOR paths are not: `/admin/*` reads
 * and writes any bucket whatever its access mode, and the state-sync socket
 * broadcasts the registry.
 *
 * So the operator plane is CLOSED unless the deployment declares its Worker
 * control-plane-only. Two properties matter:
 *
 * - Default deny. An undeclared route is operator, the same default
 *   the agent contract states for the console guard. Drift between
 *   this table and the manifest can only ever close something that should be
 *   open - a loud, testable failure - never open something that should be
 *   closed.
 * - The refusal is the ordinary 404, byte for byte, so a closed surface is
 *   not enumerable either.
 *
 * `ROUTES` mirrors `frostbase.agent.json` and
 * `route-access.unit.test.ts` fails if the two disagree, so the manifest
 * stays the single declaration. It is a copy rather than an import because
 * the JSON sits outside the build's `rootDir`, and the manifest has to stay
 * at the package root where the console and the CLI read it.
 */

export type RouteAccess = 'public' | 'operator';

export interface RouteRule {
	path: string;
	access: RouteAccess;
}

/** Mirrors the `routes` block of `frostbase.agent.json`. */
export const ROUTES: readonly RouteRule[] = [
	{ path: '/buckets/*', access: 'public' },
	{ path: '/overview', access: 'operator' },
	{ path: '/admin/*', access: 'operator' },
];

/** `/agents/<worker>/<projectId>` plus the sub-path the agent dispatches on. */
const AGENT_PATH = /^\/agents\/[^/]+\/[^/]+(\/.*)?$/;

/**
 * The declared access for one agent sub-path. Undeclared is `operator`: the
 * SDK's state-sync socket (sub-path `/`) lands here too, and broadcasting
 * agent state to an anonymous caller is exactly the leak this prevents.
 */
export function routeAccess(subPath: string): RouteAccess {
	for (const rule of ROUTES) {
		if (rule.path.endsWith('/*')) {
			const prefix = rule.path.slice(0, -2);
			if (subPath === prefix || subPath.startsWith(`${prefix}/`)) return rule.access;
		} else if (subPath === rule.path) {
			return rule.access;
		}
	}
	return 'operator';
}

/**
 * Set only on a Worker that serves no public hostname of its own, where a
 * control plane in front has already authorized the caller.
 */
export function operatorApiExposed(env: { EXPOSE_OPERATOR_API?: string }): boolean {
	return env.EXPOSE_OPERATOR_API === 'true';
}

/**
 * The 404 to answer with, or null to carry on. Everything that is not a
 * declared-public agent route is refused, `/internal/*` included - that one
 * is service-binding-only by deployment shape alone, which is a property of
 * our topology and not of the package.
 */
export function gateOperatorRoutes(
	url: URL,
	env: { EXPOSE_OPERATOR_API?: string },
): Response | null {
	if (operatorApiExposed(env)) return null;
	// `new URL` resolves real dot segments before anything reads the path, but
	// it leaves `%2e` alone - and classifying an encoded dot segment means
	// betting on whether something downstream decodes it. Object KEYS never
	// legitimately need one either (parseObjectKey refuses dot segments), so
	// refuse rather than guess.
	if (/%2e/i.test(url.pathname)) return notFound();
	const match = AGENT_PATH.exec(url.pathname);
	if (match && routeAccess(match[1] ?? '/') === 'public') return null;
	return notFound();
}

function notFound(): Response {
	return Response.json({ error: 'not found' }, { status: 404 });
}
