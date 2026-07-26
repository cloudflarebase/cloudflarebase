/**
 * Contract between the SvelteKit dashboard and the auth-agent worker.
 *
 * Kept as local copies (not imported from agents/auth) so the two workers stay
 * separate TypeScript projects with their own generated Env types. Keep in
 * sync with agents/auth/src/agent.ts.
 *
 * These are zod schemas rather than bare interfaces so one definition serves
 * three jobs: the exported types, runtime parsing of responses that cross the
 * service binding, and the OpenAPI document in $lib/openapi. `.meta({ id })`
 * names the component in that document; `.describe()` becomes its docs.
 */
import { z } from 'zod';

export const authActivityEventSchema = z
	.object({
		id: z.string(),
		type: z.enum([
			'project.provisioned',
			'user.created',
			'user.deleted',
			'user.role-changed',
			'session.created',
			'session.revoked'
		]),
		message: z.string(),
		at: z.iso.datetime()
	})
	.meta({ id: 'AuthActivityEvent' });

export const roleDefinitionSchema = z
	.object({
		name: z.string().describe('Lowercase role slug, e.g. "admin".'),
		permissions: z
			.array(z.string())
			.describe('Permission keys like "posts:write", or "*" for everything.')
	})
	.meta({ id: 'RoleDefinition', description: 'An assignable RBAC role and the keys it grants.' });

export const authAgentStateSchema = z
	.object({
		projectId: z.string(),
		provisionedAt: z.iso.datetime().nullable(),
		roles: z
			.array(roleDefinitionSchema)
			.describe('Role registry; always contains the built-in `user` and `admin`.'),
		allowedOrigins: z.array(z.string()),
		enabledSocialProviders: z.array(z.string()),
		users: z.number().int(),
		activeSessions: z.number().int(),
		totalEvents: z.number().int(),
		lastEventAt: z.iso.datetime().nullable(),
		events: z.array(authActivityEventSchema)
	})
	.meta({
		id: 'AuthAgentState',
		description: 'Synced in realtime from the AuthAgent via WebSocket state sync.'
	});

export const overviewUserSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		email: z.string(),
		emailVerified: z.boolean(),
		isAnonymous: z.boolean(),
		role: z.string(),
		providers: z.array(z.string()),
		createdAt: z.iso.datetime()
	})
	.meta({ id: 'OverviewUser' });

export const overviewSessionSchema = z
	.object({
		id: z.string(),
		userId: z.string(),
		email: z.string().nullable(),
		ipAddress: z.string().nullable(),
		userAgent: z.string().nullable(),
		country: z.string().nullable(),
		createdAt: z.iso.datetime(),
		expiresAt: z.iso.datetime()
	})
	.meta({ id: 'OverviewSession' });

export const authOverviewSchema = z
	.object({
		projectId: z.string(),
		users: z.array(overviewUserSchema),
		sessions: z.array(overviewSessionSchema),
		state: authAgentStateSchema
	})
	.meta({ id: 'AuthOverview' });

export const authAnalyticsSchema = z
	.object({
		projectId: z.string(),
		dau: z.number().int().describe('Daily active users.'),
		wau: z.number().int().describe('Weekly active users.'),
		mau: z.number().int().describe('Monthly active users.'),
		totalUsers: z.number().int(),
		registeredUsers: z.number().int(),
		anonymousUsers: z.number().int(),
		gmailUsers: z.number().int(),
		activeSessions: z.number().int(),
		providers: z.array(z.object({ provider: z.string(), users: z.number().int() })),
		countries: z.array(z.object({ country: z.string(), sessions: z.number().int() })),
		activityByDay: z.array(
			z.object({
				day: z.string(),
				signups: z.number().int(),
				signins: z.number().int()
			})
		),
		engine: z
			.object({
				dataset: z.string(),
				enabled: z.boolean(),
				status: z.enum(['connected', 'local', 'write-only', 'error']),
				error: z.string().optional()
			})
			.describe('Workers Analytics Engine metrics pipeline.'),
		eventsLast24h: z
			.array(z.object({ eventType: z.string(), count: z.number().int() }))
			.optional()
			.describe('Event counts from the Analytics Engine SQL API — only when enabled.')
	})
	.meta({ id: 'AuthAnalytics' });

export const fleetProjectCountsSchema = z
	.object({
		projectId: z.string(),
		users: z.number().int(),
		registeredUsers: z.number().int(),
		anonymousUsers: z.number().int(),
		activeSessions: z.number().int(),
		provisionedAt: z.iso.datetime().nullable(),
		lastEventAt: z.iso.datetime().nullable(),
		colo: z
			.string()
			.nullable()
			.describe('Cloudflare data center (IATA code) this project runs in.'),
		coloCountry: z.string().nullable().describe('ISO country of that data center.')
	})
	.meta({ id: 'FleetProjectCounts' });

export const fleetProjectSchema = z
	.object({
		projectId: z.string(),
		demo: z.boolean().describe('Matches the browser-demo naming convention (`demo-<hex>`).'),
		firstSeenAt: z.iso.datetime().nullable(),
		lastSeenAt: z.iso.datetime().nullable(),
		events: z.number().int(),
		counts: fleetProjectCountsSchema
			.nullable()
			.describe('Null when the project was beyond the fan-out limit or unreachable.')
	})
	.meta({ id: 'FleetProject' });

export const fleetTotalsSchema = z
	.object({
		projects: z.number().int(),
		demoProjects: z.number().int(),
		users: z.number().int(),
		registeredUsers: z.number().int(),
		anonymousUsers: z.number().int(),
		activeSessions: z.number().int(),
		uncountedProjects: z.number().int()
	})
	.meta({ id: 'FleetTotals' });

export const fleetOverviewSchema = z
	.object({
		generatedAt: z.iso.datetime(),
		source: z
			.enum(['analytics-engine', 'local-d1', 'none'])
			.describe('Where the project list came from.'),
		projects: z.array(fleetProjectSchema),
		totals: fleetTotalsSchema,
		error: z.string().optional()
	})
	.meta({ id: 'FleetOverview' });

export const agentChatMessageSchema = z
	.object({
		id: z.string(),
		role: z.enum(['user', 'agent']),
		content: z.string(),
		createdAt: z.iso.datetime()
	})
	.meta({ id: 'AgentChatMessage' });

export const agentChatReplySchema = z
	.object({
		question: z.string(),
		topic: z.literal('ai-analysis'),
		answer: z.string(),
		mode: z.literal('workers-ai'),
		model: z.string(),
		userMessage: agentChatMessageSchema,
		agentMessage: agentChatMessageSchema
	})
	.meta({ id: 'AgentChatReply' });

export const registryProjectSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		createdAt: z.iso.datetime()
	})
	.meta({ id: 'RegistryProject', description: 'A project this installation owns.' });

export const projectRegistryStateSchema = z
	.object({ projects: z.array(registryProjectSchema) })
	.meta({ id: 'ProjectRegistryState' });

export type AuthActivityEvent = z.infer<typeof authActivityEventSchema>;
export type RoleDefinition = z.infer<typeof roleDefinitionSchema>;
export type AuthAgentState = z.infer<typeof authAgentStateSchema>;
export type OverviewUser = z.infer<typeof overviewUserSchema>;
export type OverviewSession = z.infer<typeof overviewSessionSchema>;
export type AuthOverview = z.infer<typeof authOverviewSchema>;
export type AuthAnalytics = z.infer<typeof authAnalyticsSchema>;
export type FleetProjectCounts = z.infer<typeof fleetProjectCountsSchema>;
export type FleetProject = z.infer<typeof fleetProjectSchema>;
export type FleetTotals = z.infer<typeof fleetTotalsSchema>;
export type FleetOverview = z.infer<typeof fleetOverviewSchema>;
export type AgentChatMessage = z.infer<typeof agentChatMessageSchema>;
export type AgentChatReply = z.infer<typeof agentChatReplySchema>;
export type RegistryProject = z.infer<typeof registryProjectSchema>;
export type ProjectRegistryState = z.infer<typeof projectRegistryStateSchema>;
