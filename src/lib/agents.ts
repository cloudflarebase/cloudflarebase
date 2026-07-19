/**
 * Contract between the SvelteKit dashboard and the auth-agent worker.
 *
 * Kept as local copies (not imported from agents/auth) so the two workers stay
 * separate TypeScript projects with their own generated Env types. Keep in
 * sync with agents/auth/src/agent.ts.
 */

export interface AuthActivityEvent {
	id: string;
	type:
		'project.provisioned' | 'user.created' | 'user.deleted' | 'session.created' | 'session.revoked';
	message: string;
	at: string;
}

/** Synced in realtime from the AuthAgent via WebSocket state sync. */
export interface AuthAgentState {
	projectId: string;
	provisionedAt: string | null;
	allowedOrigins: string[];
	enabledSocialProviders: string[];
	users: number;
	activeSessions: number;
	totalEvents: number;
	lastEventAt: string | null;
	events: AuthActivityEvent[];
}

export interface OverviewUser {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	isAnonymous: boolean;
	providers: string[];
	createdAt: string;
}

export interface OverviewSession {
	id: string;
	userId: string;
	email: string | null;
	ipAddress: string | null;
	userAgent: string | null;
	country: string | null;
	createdAt: string;
	expiresAt: string;
}

export interface AuthOverview {
	projectId: string;
	users: OverviewUser[];
	sessions: OverviewSession[];
	state: AuthAgentState;
}

export interface AuthAnalytics {
	projectId: string;
	dau: number;
	wau: number;
	mau: number;
	totalUsers: number;
	registeredUsers: number;
	anonymousUsers: number;
	gmailUsers: number;
	activeSessions: number;
	providers: { provider: string; users: number }[];
	countries: { country: string; sessions: number }[];
	signupsLast7Days: { day: string; count: number }[];
	/** Workers Analytics Engine metrics pipeline. */
	engine: {
		dataset: string;
		enabled: boolean;
		status: 'connected' | 'local' | 'write-only' | 'error';
		error?: string;
	};
	/** Event counts from the Analytics Engine SQL API — only when enabled. */
	eventsLast24h?: { eventType: string; count: number }[];
}

export interface AgentChatReply {
	question: string;
	topic: 'ai-analysis';
	answer: string;
	mode: 'workers-ai';
	model: string;
}
