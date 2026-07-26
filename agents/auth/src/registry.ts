import { Agent, getAgentByName } from 'agents';
import type { AuthAgent } from './agent';
import { createProjectRequestSchema, projectIdSchema } from './schemas';

/**
 * The console's project registry — a single Durable Object listing every
 * project this installation owns.
 *
 * It deliberately stores nothing in KV or D1: a fresh self-hosted install has
 * no resources to provision beyond the two Workers, which is what keeps
 * "deploy and use it" a fifteen-minute job. The project list lives in Agent
 * state, so connected dashboards receive changes over the existing state sync
 * without polling.
 *
 * Addressed as /agents/project-registry/registry/... and reachable only
 * through the dashboard's console guard, which requires an operator session.
 */

export interface RegistryProject {
	id: string;
	name: string;
	createdAt: string;
}

export interface ProjectRegistryState {
	projects: RegistryProject[];
}

/** The registry is a singleton; this is its Durable Object instance name. */
export const REGISTRY_INSTANCE = 'registry';

const MAX_PROJECTS = 100;

export class ProjectRegistry extends Agent<Env, ProjectRegistryState> {
	initialState: ProjectRegistryState = { projects: [] };

	private get projects(): RegistryProject[] {
		return this.state?.projects ?? [];
	}

	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const subPath = url.pathname.match(/\/agents\/[^/]+\/[^/]+(\/.*)?$/)?.[1] ?? '/';

		if (subPath === '/projects' && request.method === 'GET') {
			return Response.json({ projects: this.projects });
		}

		if (subPath === '/projects' && request.method === 'POST') {
			return this.createProject(request);
		}

		const remove = subPath.match(/^\/projects\/([^/]+)$/);
		if (remove && request.method === 'DELETE') {
			return this.deleteProject(decodeURIComponent(remove[1]));
		}

		return Response.json({ error: 'not found' }, { status: 404 });
	}

	private async createProject(request: Request): Promise<Response> {
		const body = createProjectRequestSchema.safeParse(await request.json().catch(() => null));
		if (!body.success) {
			return Response.json(
				{ error: body.error.issues[0]?.message ?? 'invalid project' },
				{ status: 400 },
			);
		}

		const projects = this.projects;
		if (projects.some((project) => project.id === body.data.id)) {
			return Response.json({ error: 'that project id is already taken' }, { status: 409 });
		}
		if (projects.length >= MAX_PROJECTS) {
			return Response.json(
				{ error: `this installation is limited to ${MAX_PROJECTS} projects` },
				{ status: 409 },
			);
		}

		const project: RegistryProject = {
			id: body.data.id,
			name: body.data.name,
			createdAt: new Date().toISOString(),
		};
		this.setState({ projects: [...projects, project] });

		return Response.json({ project }, { status: 201 });
	}

	/**
	 * Removes a project from the registry and wipes its AuthAgent. Both halves
	 * matter: dropping only the listing would leave an orphaned Durable Object
	 * holding real user records that nothing can reach or delete.
	 */
	private async deleteProject(projectId: string): Promise<Response> {
		if (!projectIdSchema.safeParse(projectId).success) {
			return Response.json({ error: 'invalid project id' }, { status: 400 });
		}

		const projects = this.projects;
		if (!projects.some((project) => project.id === projectId)) {
			return Response.json({ error: 'no such project' }, { status: 404 });
		}

		this.setState({ projects: projects.filter((project) => project.id !== projectId) });

		try {
			const agent = await getAgentByName<Env, AuthAgent>(this.env.AuthAgent, projectId);
			await agent.destroy();
		} catch (cause) {
			// The listing is already gone, so the console stays consistent. Surface
			// the failure: the project's data outlived its registration.
			console.error(`failed to wipe auth agent for project "${projectId}"`, cause);
			return Response.json(
				{ deleted: true, warning: 'project data could not be erased' },
				{ status: 207 },
			);
		}

		return Response.json({ deleted: true });
	}
}
