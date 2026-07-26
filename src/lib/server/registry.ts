import { RESERVED_PROJECT_IDS } from '$lib/console';
import type { RegistryProject } from '$lib/agents';
import { getDb } from '$lib/server/db';
import { project } from '$lib/server/db/schema';
import { requireAuthAgent } from '$lib/server/auth-agent';
import { projectIdSchema } from '$lib/schemas/auth';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

/**
 * The project registry: which projects this installation owns.
 *
 * It lives in D1 on the dashboard Worker rather than inside an agent, because
 * it is a control-plane concern. A project will eventually have a db agent and
 * a storage agent as well as auth, so any agent owning the list would make
 * every other agent depend on that one — and deleting a project has to reach
 * all of them, which is why the fan-out below belongs here and not in the auth
 * worker.
 */

export const createProjectSchema = z.object({
	id: projectIdSchema.refine(
		(value) => !RESERVED_PROJECT_IDS.has(value),
		'that project id is reserved'
	),
	name: z.string().trim().min(1, 'name is required').max(64)
});

/** Ceiling on one installation, to keep an accidental loop from filling D1. */
const MAX_PROJECTS = 100;

function toDto(row: { id: string; name: string; createdAt: Date }): RegistryProject {
	return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
}

/**
 * Lists the installation's projects, oldest first. Returns an empty list
 * rather than throwing when the database cannot be reached, so a first-run
 * console renders its empty state instead of an error page.
 */
export async function listProjects(platform: App.Platform | undefined): Promise<RegistryProject[]> {
	try {
		const db = await getDb(platform);
		const rows = await db.select().from(project).orderBy(asc(project.createdAt));
		return rows.map(toDto);
	} catch (cause) {
		console.error('listing projects failed', cause);
		return [];
	}
}

export type CreateProjectResult =
	{ ok: true; project: RegistryProject } | { ok: false; status: number; error: string };

export async function createProject(
	platform: App.Platform | undefined,
	input: unknown
): Promise<CreateProjectResult> {
	const parsed = createProjectSchema.safeParse(input);
	if (!parsed.success) {
		return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? 'invalid project' };
	}

	const db = await getDb(platform);

	const [existing] = await db.select().from(project).where(eq(project.id, parsed.data.id)).limit(1);
	if (existing) {
		return { ok: false, status: 409, error: 'that project id is already taken' };
	}

	const rows = await db.select({ id: project.id }).from(project);
	if (rows.length >= MAX_PROJECTS) {
		return {
			ok: false,
			status: 409,
			error: `this installation is limited to ${MAX_PROJECTS} projects`
		};
	}

	const [created] = await db
		.insert(project)
		.values({ id: parsed.data.id, name: parsed.data.name, createdAt: new Date() })
		.returning();

	return { ok: true, project: toDto(created) };
}

export type DeleteProjectResult =
	{ ok: true; warning?: string } | { ok: false; status: number; error: string };

/**
 * Removes a project's registration and erases its data in every agent.
 *
 * Both halves matter: dropping only the row would strand Durable Objects still
 * holding real user records with nothing left that could reach or delete them.
 * The fan-out lives here because the console is the only component that knows
 * which agents exist — today that is the auth agent, and each new agent adds a
 * call rather than a dependency between agents.
 */
export async function deleteProject(
	platform: App.Platform | undefined,
	projectId: string
): Promise<DeleteProjectResult> {
	if (!projectIdSchema.safeParse(projectId).success) {
		return { ok: false, status: 400, error: 'invalid project id' };
	}

	const db = await getDb(platform);
	const deleted = await db.delete(project).where(eq(project.id, projectId)).returning();
	if (!deleted.length) {
		return { ok: false, status: 404, error: 'no such project' };
	}

	const failures = await eraseProjectData(platform, projectId);
	if (failures.length) {
		return { ok: true, warning: `data could not be erased in: ${failures.join(', ')}` };
	}
	return { ok: true };
}

/** Fan-out erase. Returns the names of agents that could not be reached. */
async function eraseProjectData(
	platform: App.Platform | undefined,
	projectId: string
): Promise<string[]> {
	const failures: string[] = [];

	try {
		const agent = requireAuthAgent(platform);
		const response = await agent.fetch(
			`https://auth-agent/internal/projects/${encodeURIComponent(projectId)}`,
			{ method: 'DELETE' }
		);
		if (!response.ok) throw new Error(`auth agent responded ${response.status}`);
	} catch (cause) {
		console.error(`failed to erase project "${projectId}" in the auth agent`, cause);
		failures.push('auth');
	}

	return failures;
}
