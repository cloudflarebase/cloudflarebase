import type { RegistryProject } from '$lib/agents';
import { requireAuthAgent } from '$lib/server/auth-agent';
import { z } from 'zod';

/**
 * Server-side client for the ProjectRegistry — the single Durable Object
 * listing every project this installation owns.
 *
 * KNOWN MISPLACEMENT: the registry is a control-plane concern but currently
 * ships inside the auth agent worker, so this reaches it over AUTH_AGENT. That
 * was a deployment tradeoff — a separate worker means another service binding
 * and another deploy step — and it does not survive a second agent:
 *
 *   - listing projects requires the auth worker to be running
 *   - a future db agent would depend on auth just to learn what exists
 *   - deleting a project must fan out to every agent, which would put
 *     knowledge of other agents inside the auth worker
 *
 * See docs/agent-contract.md. Every caller goes through this module, so the
 * move is a change to `registryService` and `registryUrl` below and nothing
 * else — keep it that way.
 */

/** Singleton instance name; mirrors REGISTRY_INSTANCE in the agent worker. */
const REGISTRY_INSTANCE = 'registry';

/**
 * The service binding the registry currently lives behind. Named for what it
 * is used for rather than which worker happens to host it, so relocating the
 * Durable Object changes this function alone.
 */
function registryService(platform: App.Platform | undefined) {
	return requireAuthAgent(platform);
}

const registryProjectSchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.string()
});

const projectListSchema = z.object({ projects: z.array(registryProjectSchema) });

function registryUrl(origin: string, subPath: string): string {
	return `${origin}/agents/project-registry/${REGISTRY_INSTANCE}${subPath}`;
}

/**
 * Lists the installation's projects. Returns an empty list rather than
 * throwing when the registry cannot be reached, so a first-run console still
 * renders its empty state instead of an error page.
 */
export async function listProjects(
	platform: App.Platform | undefined,
	origin: string
): Promise<RegistryProject[]> {
	const agent = registryService(platform);
	const response = await agent.fetch(registryUrl(origin, '/projects')).catch(() => null);
	if (!response || !response.ok) return [];

	const parsed = projectListSchema.safeParse(
		await (response as unknown as Response).json().catch(() => null)
	);
	return parsed.success ? parsed.data.projects : [];
}

/** Forwards a registry mutation, preserving the agent's status and body. */
export async function forwardToRegistry(
	platform: App.Platform | undefined,
	origin: string,
	subPath: string,
	init: { method: string; body?: ArrayBuffer }
): Promise<Response> {
	const agent = registryService(platform);
	return agent.fetch(registryUrl(origin, subPath), {
		method: init.method,
		headers: [['content-type', 'application/json']],
		body: init.body
	}) as unknown as Promise<Response>;
}
