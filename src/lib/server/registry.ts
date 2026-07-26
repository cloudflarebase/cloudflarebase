import type { RegistryProject } from '$lib/agents';
import { requireAuthAgent } from '$lib/server/auth-agent';
import { z } from 'zod';

/**
 * Server-side client for the ProjectRegistry agent — the single Durable Object
 * listing every project this installation owns. Reached over the AUTH_AGENT
 * service binding at /agents/project-registry/registry/...
 */

/** Singleton instance name; mirrors REGISTRY_INSTANCE in the agent worker. */
const REGISTRY_INSTANCE = 'registry';

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
	const agent = requireAuthAgent(platform);
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
	const agent = requireAuthAgent(platform);
	return agent.fetch(registryUrl(origin, subPath), {
		method: init.method,
		headers: [['content-type', 'application/json']],
		body: init.body
	}) as unknown as Promise<Response>;
}
