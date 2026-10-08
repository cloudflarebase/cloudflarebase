import { z } from 'zod';
import authManifestJson from '../../agents/auth/cloudflarebase.agent.json';
import dbManifestJson from '../../agents/db/cloudflarebase.agent.json';
import storageManifestJson from '../../agents/storage/cloudflarebase.agent.json';

/**
 * The agent manifest contract - see "The agent contract" in AGENTS.md.
 *
 * Each agent package ships a cloudflarebase.agent.json declaring what it is
 * and what the platform must do to host it. The app imports those files
 * DIRECTLY from agents/<name>/ - static declarative data, deliberately not a
 * copy: the console guard is generated from `routes`, and a stale copy would
 * silently open or close the wrong surface. The cross-project import ban in
 * CLAUDE.md targets runtime code and generated Worker types; a manifest is
 * neither. The CLI keeps its own schema copy and reads manifests from the
 * installed package instead.
 */
const routeAccessSchema = z.enum(['public', 'operator']);

export const agentManifestSchema = z.strictObject({
	manifestVersion: z.literal(1),
	name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
	title: z.string().min(1).max(64),
	description: z.string().min(1).max(256),
	packageName: z.string().min(1),
	worker: z.string().regex(/^[a-z][a-z0-9-]{0,53}$/),
	durableObjects: z
		.array(
			z.strictObject({
				class: z.string().min(1),
				scope: z.enum(['perProject', 'perCollection', 'perTable', 'perBucket', 'perView'])
			})
		)
		.min(1),
	entrypoint: z.strictObject({ assertEnvType: z.string().min(1) }),
	erase: z.strictObject({ method: z.literal('DELETE'), path: z.string().startsWith('/') }),
	bindings: z.strictObject({
		ai: z.boolean().optional(),
		sendEmail: z.array(z.string()).optional(),
		analyticsEngine: z
			.array(z.strictObject({ binding: z.string(), dataset: z.string() }))
			.optional(),
		services: z
			.array(
				z.strictObject({
					binding: z.string(),
					service: z.string(),
					optional: z.boolean().optional()
				})
			)
			.optional(),
		r2: z
			.array(
				z.strictObject({
					binding: z.string(),
					bucketName: z.string().optional(),
					optional: z.boolean().optional()
				})
			)
			.optional()
	}),
	secrets: z.strictObject({
		generated: z.array(z.string()),
		optional: z.array(z.string())
	}),
	vars: z.record(
		z.string(),
		z.strictObject({ default: z.string().optional(), hint: z.string().optional() })
	),
	routes: z.array(z.strictObject({ path: z.string().startsWith('/'), access: routeAccessSchema })),
	proxy: z.strictObject({ apiPrefix: z.string().min(1), agentBasePath: z.string() }),
	permissions: z.array(z.string()),
	console: z.strictObject({
		section: z.string().min(1),
		icon: z.string().min(1),
		/**
		 * How many leading pages stay visible while the sidebar section is
		 * folded. Sections fold by default, so this is what the console shows
		 * of an agent before anyone opens it - the agent decides which of its
		 * pages represent it (the db agent needs two: documents AND tables).
		 */
		peek: z.number().int().min(1).max(4).optional(),
		pages: z.array(
			z.strictObject({
				path: z.string().startsWith('/'),
				title: z.string().min(1),
				testId: z.string().min(1),
				/** Per-page lucide icon name; omitted pages inherit the agent icon. */
				icon: z.string().min(1).optional(),
				/**
				 * Sidebar section this page belongs to, when it is not the agent's
				 * own. An agent is a PACKAGE, not a product boundary: Remote Config
				 * is stored by the db agent because building it on the database was
				 * the point, but to an operator it is its own feature - and filing
				 * it under "Database" would bury a feature-flag console where
				 * nobody looks for one.
				 */
				section: z.string().min(1).optional()
			})
		)
	})
});

export type AgentManifest = z.infer<typeof agentManifestSchema>;
export type RouteAccess = z.infer<typeof routeAccessSchema>;

/**
 * App-side registry entry: the manifest joined with deployment facts the
 * manifest must not know (they are this installation's concerns, not the
 * package's) - the service binding name on the web Worker and the dev port
 * the AgentClient dials when Vite cannot proxy workerd WebSockets.
 */
export interface AppAgentEntry {
	manifest: AgentManifest;
	binding: 'AUTH_AGENT' | 'DB_AGENT' | 'STORAGE_AGENT';
	devHost: string;
}

// Parsing throws at import on a malformed manifest - a broken declaration
// should fail the build, never an individual request.
export const AGENT_REGISTRY: Record<string, AppAgentEntry> = {
	auth: {
		manifest: agentManifestSchema.parse(authManifestJson),
		binding: 'AUTH_AGENT',
		devHost: 'localhost:8788'
	},
	db: {
		manifest: agentManifestSchema.parse(dbManifestJson),
		binding: 'DB_AGENT',
		devHost: 'localhost:8789'
	},
	storage: {
		manifest: agentManifestSchema.parse(storageManifestJson),
		binding: 'STORAGE_AGENT',
		devHost: 'localhost:8791'
	}
};

const byWorker = new Map<string, AppAgentEntry>(
	Object.values(AGENT_REGISTRY).map((entry) => [entry.manifest.worker, entry])
);
const byPrefix = new Map<string, AppAgentEntry>(
	Object.values(AGENT_REGISTRY).map((entry) => [entry.manifest.proxy.apiPrefix, entry])
);

/** `auth-agent` -> the auth entry; unknown segments -> undefined (guard fails closed). */
export function agentByWorkerSegment(segment: string): AppAgentEntry | undefined {
	return byWorker.get(segment);
}

/** `/api/projects/<id>/<prefix>/...` prefix -> entry; unknown -> undefined. */
export function agentByApiPrefix(prefix: string): AppAgentEntry | undefined {
	return byPrefix.get(prefix);
}

/**
 * Match an agent-relative sub-path against the manifest's route table.
 * `/x/*` matches `/x` and everything under it; other paths match exactly.
 * Undeclared paths return 'operator' - public is by declaration only.
 */
export function routeAccess(manifest: AgentManifest, subPath: string): RouteAccess {
	for (const route of manifest.routes) {
		if (route.path.endsWith('/*')) {
			const base = route.path.slice(0, -2);
			if (subPath === base || subPath.startsWith(`${base}/`)) return route.access;
		} else if (subPath === route.path) {
			return route.access;
		}
	}
	return 'operator';
}

export interface ConsoleNavItem {
	href: string;
	title: string;
	icon: string;
	testId: string;
}
export interface ConsoleNavSection {
	section: string;
	/** Leading items that stay visible while the section is folded. */
	peek: number;
	items: ConsoleNavItem[];
}

/** Sidebar/nav entries contributed by agents, grouped by manifest section. */
export function buildConsoleNav(projectId: string): ConsoleNavSection[] {
	const sections = new Map<string, ConsoleNavSection>();
	for (const { manifest } of Object.values(AGENT_REGISTRY)) {
		// An agent whose console pages have not shipped yet contributes no
		// section - a bare header with nothing under it reads as broken. Every
		// shipped agent has pages today, which is why nothing advertises a
		// primitive as coming soon any more, here or on the landing page.
		if (!manifest.console.pages.length) continue;
		for (const page of manifest.console.pages) {
			// A page may name its own section (see the manifest schema): the agent
			// that STORES a feature is not always the product it belongs to.
			const name = page.section ?? manifest.console.section;
			const section = sections.get(name) ?? { section: name, peek: 1, items: [] };
			// Two agents sharing a section name share one peek: the widest wins, so
			// neither agent's lead page can be folded away by the other's default.
			// A page in a section of its own keeps the default 1 - the agent's peek
			// counts its own pages, not the ones it lent elsewhere.
			if (!page.section) {
				section.peek = Math.max(section.peek, manifest.console.peek ?? 1);
			}
			section.items.push({
				href: `/dashboard/${projectId}${page.path}`,
				title: page.title,
				icon: page.icon ?? manifest.console.icon,
				testId: page.testId
			});
			sections.set(name, section);
		}
	}
	return [...sections.values()];
}
