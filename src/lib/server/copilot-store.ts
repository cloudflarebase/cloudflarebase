import * as Sentry from '@sentry/sveltekit';
import { AGENT_REGISTRY } from '$lib/agent-registry';
import { CONSOLE_PROJECT_ID } from '$lib/console';
import { agentUrl, requireAgent } from '$lib/server/agents';
import type { AgentChatMessage } from '$lib/agents';

/**
 * Copilot transcripts, stored in the CONSOLE project's db agent.
 *
 * They used to be a D1 table, and D1 was the wrong home: the control plane
 * holds what must be found by something other than a project id - a token
 * digest, a subdomain, a repo id - because a Durable Object can be addressed
 * but never searched. A transcript is none of those. It is per-project,
 * per-client rows with a retention window and a per-day count, which is a
 * collection with a `where` clause.
 *
 * The CONSOLE project rather than the customer's, deliberately. Frostbase
 * already runs its own operators on a real AuthAgent under this id; this is the
 * same move for the database, and it keeps copilot history out of the
 * customer's own Collections list, where it would be visible, editable, and
 * droppable by the operator whose conversation it records.
 *
 * Nothing external can reach it: `console` is a reserved project id the guard
 * refuses to route to, so the only path here is this module over the service
 * binding. The collection is closed on both sides anyway.
 */

const COLLECTION = 'copilot_chat';

/** Demo Durable Objects self-erase; this is the matching retention backstop. */
const RETENTION_DAYS = 30;

/** One page of the pruning walk. The admin query ceiling is 200. */
const PRUNE_PAGE = 200;

interface StoredChat {
	projectId: string;
	clientKey: string;
	role: AgentChatMessage['role'];
	content: string;
	/** Epoch ms, INSIDE the document body on purpose: the query DSL orders and
	 * filters on paths into `data`, and the envelope's own timestamp is not
	 * addressable from a `where` clause. */
	createdAt: number;
}

interface AdminDoc {
	id: string;
	data: Partial<StoredChat>;
}

/**
 * One admin call. Returns null on any failure rather than throwing: the
 * copilot is a convenience surface, and a transcript that cannot be read must
 * degrade to an empty history rather than take the chat pane down with it.
 * Failures are captured, because silence here would hide a broken control
 * plane behind a chat that merely looks new every time.
 */
async function adminCall<T>(
	platform: App.Platform | undefined,
	origin: string,
	method: string,
	path: string,
	body?: unknown,
	operation = 'copilot-store'
): Promise<T | null> {
	try {
		const entry = AGENT_REGISTRY.db;
		const agent = requireAgent(platform, entry);
		const response = await agent.fetch(agentUrl(origin, entry, CONSOLE_PROJECT_ID, path), {
			method,
			headers: { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		if (!response.ok) {
			// A 404 from the document routes is an ordinary miss, not a fault.
			if (response.status === 404) return null;
			throw new Error(`db agent responded ${response.status}`);
		}
		return (await (response as unknown as Response).json()) as T;
	} catch (cause) {
		console.error('copilot transcript store failed', cause);
		Sentry.captureException(cause, { level: 'error', tags: { operation } });
		return null;
	}
}

/**
 * The transcript collection, closed on both sides.
 *
 * Provisioned on demand and idempotently - the admin PUT is an upsert - so a
 * fresh install needs no setup step and an install whose copilot is never used
 * never pays for the shard.
 */
async function ensureCollection(
	platform: App.Platform | undefined,
	origin: string
): Promise<boolean> {
	const result = await adminCall<unknown>(
		platform,
		origin,
		'PUT',
		`/admin/collections/${COLLECTION}`,
		// Nothing but this module writes here, and nothing at all reads it from
		// outside - `none` on both sides says so structurally rather than by
		// convention.
		{ readAccess: 'none', writeAccess: 'none', replication: 'off' },
		'copilot-store-provision'
	);
	return result !== null;
}

/** Last `limit` messages for one thread, oldest first. */
export async function getChatHistory(
	platform: App.Platform | undefined,
	origin: string,
	projectId: string,
	clientKey: string,
	limit = 50
): Promise<AgentChatMessage[]> {
	const result = await adminCall<{ docs: AdminDoc[] }>(
		platform,
		origin,
		'POST',
		'/admin/query',
		{
			collection: COLLECTION,
			query: {
				where: [
					{ field: 'projectId', op: '==', value: projectId },
					{ field: 'clientKey', op: '==', value: clientKey }
				],
				// Newest first with a limit, then reversed - the only way to get
				// the LAST n without reading the whole thread.
				orderBy: [{ field: 'createdAt', direction: 'desc' }],
				limit
			}
		},
		'copilot-history'
	);
	if (!result) return [];
	return result.docs
		.slice()
		.reverse()
		.map((doc) => ({
			id: doc.id,
			role: doc.data.role === 'agent' ? ('agent' as const) : ('user' as const),
			content: typeof doc.data.content === 'string' ? doc.data.content : '',
			createdAt: new Date(doc.data.createdAt ?? 0).toISOString()
		}));
}

export async function saveChatMessage(
	platform: App.Platform | undefined,
	origin: string,
	projectId: string,
	clientKey: string,
	role: AgentChatMessage['role'],
	content: string,
	createdAt: Date
): Promise<AgentChatMessage> {
	const id = crypto.randomUUID();
	const data: StoredChat = {
		projectId,
		clientKey,
		role,
		content,
		createdAt: createdAt.getTime()
	};
	await ensureCollection(platform, origin);
	await adminCall<unknown>(
		platform,
		origin,
		'PUT',
		`/admin/collections/${COLLECTION}/documents/${id}`,
		{ data },
		'copilot-save'
	);
	// The message is returned whether or not the write landed: the model already
	// answered, and dropping the reply on a storage failure would lose the one
	// thing the caller came for. A failed write is captured above.
	return { id, role, content, createdAt: createdAt.toISOString() };
}

/**
 * The demo ceiling and the retention sweep, both keyed on the project.
 *
 * Prunes past the retention window first, then counts today's questions. The
 * sweep is bounded to one page per call: it is a backstop against transcripts
 * outliving the demo projects they belong to, not a job that has to finish in
 * one request.
 */
export async function demoChatExhausted(
	platform: App.Platform | undefined,
	origin: string,
	projectId: string,
	dailyLimit: number
): Promise<boolean> {
	const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
	const stale = await adminCall<{ docs: AdminDoc[] }>(
		platform,
		origin,
		'POST',
		'/admin/query',
		{
			collection: COLLECTION,
			query: {
				where: [
					{ field: 'projectId', op: '==', value: projectId },
					{ field: 'createdAt', op: '<', value: cutoff }
				],
				limit: PRUNE_PAGE
			}
		},
		'copilot-prune'
	);
	for (const doc of stale?.docs ?? []) {
		await adminCall<unknown>(
			platform,
			origin,
			'DELETE',
			`/admin/collections/${COLLECTION}/documents/${doc.id}`,
			undefined,
			'copilot-prune'
		);
	}

	const startOfUtcDay = new Date(
		`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
	).getTime();
	const counted = await adminCall<{ results: Record<string, number | null> }>(
		platform,
		origin,
		'POST',
		'/admin/aggregate',
		{
			collection: COLLECTION,
			aggregate: {
				where: [
					{ field: 'projectId', op: '==', value: projectId },
					{ field: 'role', op: '==', value: 'user' },
					{ field: 'createdAt', op: '>=', value: startOfUtcDay }
				],
				aggregates: { questions: { op: 'count' } }
			}
		},
		'copilot-quota'
	);
	// A count that could not be read must not open the gate: the cap exists to
	// bound an account-level neuron spend, so an unreadable counter fails
	// CLOSED. `null` here means the control plane is broken, not that nobody
	// has asked anything today.
	if (!counted) return true;
	return (counted.results.questions ?? 0) >= dailyLimit;
}

/** Erases every transcript, for the console reset. */
export async function eraseCopilotTranscripts(
	platform: App.Platform | undefined,
	origin: string
): Promise<void> {
	await adminCall<unknown>(
		platform,
		origin,
		'DELETE',
		`/admin/collections/${COLLECTION}`,
		undefined,
		'copilot-erase'
	);
}
