/**
 * The project copilot: a console-orchestrated Workers AI tool loop.
 *
 * The loop runs in the dashboard Worker (this is the control plane, and the
 * only place that can see EVERY agent) and answers from live project data by
 * calling the auth and db agents over their service bindings. Conversation
 * history lives in the CONSOLE project's own db agent (`./copilot-store`) -
 * Frostbase's dashboard eating its own database, the way it already eats
 * its own auth.
 *
 * The response contract mirrors the auth agent's retired /chat surface
 * exactly (AgentChatMessage / AgentChatReply, 400 / 429 / 502 shapes), so the
 * dashboard pane and the e2e specs keep working unchanged.
 */
import { z } from 'zod';
import { AGENT_REGISTRY, type AppAgentEntry } from '$lib/agent-registry';
import { dbQuerySchema, type AgentChatMessage } from '$lib/agents';
import { agentSegment, agentUrl, requireAgent } from '$lib/server/agents';
import type { RequestEvent } from '@sveltejs/kit';

const DEFAULT_CHAT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Tool budget per question; a fifth call runs without tools to force text. */
const MAX_TOOL_ROUNDS = 4;

/** Tool output ceiling so one large collection cannot flood the context. */
const TOOL_RESULT_MAX_CHARS = 6_000;

/** Mirrors the auth agent's demo ceiling: neurons are an account-level quota. */
export const DEMO_MAX_CHAT_PER_DAY = 50;

/**
 * Identifies a conversation thread. Operators converse under their user id
 * (stable across devices); anonymous demo visitors under a project-scoped
 * SHA-256 of their connecting IP. Raw IPs are never stored - the same privacy
 * invariant the auth agent's chat kept.
 */
export async function chatClientKey(event: RequestEvent, projectId: string): Promise<string> {
	const operator = event.locals.consoleUser;
	if (operator) return operator.id;

	let address = event.request.headers.get('cf-connecting-ip');
	if (!address) {
		try {
			address = event.getClientAddress();
		} catch {
			address = 'local';
		}
	}
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(`${projectId}:${address}`)
	);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Tool registry: read-only views over both agents, reached exactly like the
// dashboard proxies reach them - agentUrl() + the registry's service binding.

interface ToolContext {
	platform: App.Platform | undefined;
	origin: string;
	projectId: string;
}

interface CopilotTool {
	name: string;
	description: string;
	parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
	execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
}

async function fetchAgentTool(
	ctx: ToolContext,
	entry: AppAgentEntry,
	subPath: string,
	init?: RequestInit
): Promise<string> {
	const agent = requireAgent(ctx.platform, entry);
	const response = await agent.fetch(agentUrl(ctx.origin, entry, ctx.projectId, subPath), init);
	const text = await (response as unknown as Response).text();
	if (!response.ok) {
		return `request failed with status ${response.status}: ${truncate(text, 500)}`;
	}
	return truncate(text, TOOL_RESULT_MAX_CHARS);
}

const dbSqlArgsSchema = z.object({
	table: z.string().min(1).max(64),
	sql: z.string().min(1).max(4000)
});

const dbQueryArgsSchema = z
	.object({
		collection: z.string().min(1).max(64).optional(),
		table: z.string().min(1).max(64).optional(),
		limit: z.number().int().min(1).max(20).optional(),
		where: dbQuerySchema.shape.where,
		orderBy: dbQuerySchema.shape.orderBy
	})
	.refine((args) => (args.collection === undefined) !== (args.table === undefined), {
		message: 'name exactly one of collection or table'
	});

const COPILOT_TOOLS: CopilotTool[] = [
	{
		name: 'auth_overview',
		description:
			"The project's current auth state: every user (name, email, role, providers, anonymous or registered), active sessions (with country and user agent), the role registry, allowed origins, and recent auth activity events.",
		parameters: { type: 'object', properties: {} },
		execute: (_args, ctx) => fetchAgentTool(ctx, AGENT_REGISTRY.auth, '/overview')
	},
	{
		name: 'auth_analytics',
		description:
			'Aggregated auth analytics: DAU/WAU/MAU, total vs registered vs anonymous users, sign-in providers, session countries, daily sign-up and sign-in activity, and event counts for the last 24 hours.',
		parameters: { type: 'object', properties: {} },
		execute: (_args, ctx) =>
			fetchAgentTool(ctx, AGENT_REGISTRY.auth, '/analytics?timeZone=Etc%2FUTC')
	},
	{
		name: 'db_overview',
		description:
			"The project's database state: every collection (name, document count, access modes) AND every SQL table (name, row count, access modes, and its full declared column schema - names, types, constraints), plus totals and recent database activity events.",
		parameters: { type: 'object', properties: {} },
		execute: (_args, ctx) => fetchAgentTool(ctx, AGENT_REGISTRY.db, '/overview')
	},
	{
		name: 'db_query',
		description:
			'Read actual documents from one collection OR rows from one SQL table (up to 20). Name exactly one of collection/table - use db_overview first for names and, for tables, the declared columns. Filters use dotted JSON field paths on collections and column names on tables (dotted paths reach into json columns).',
		parameters: {
			type: 'object',
			properties: {
				collection: {
					type: 'string',
					description: 'Collection name, exactly as db_overview reports it.'
				},
				table: {
					type: 'string',
					description:
						'SQL table name, exactly as db_overview reports it. Filter fields must be declared columns.'
				},
				limit: { type: 'number', description: 'Maximum documents to return (1-20, default 10).' },
				where: {
					type: 'array',
					description:
						'Optional AND-combined filters, e.g. [{"field":"status","op":"==","value":"active"}]. Ops: ==, !=, <, <=, >, >=, in, array-contains.',
					items: {
						type: 'object',
						properties: {
							field: { type: 'string' },
							op: { type: 'string' },
							value: { description: 'String, number, boolean, null, or an array for "in".' }
						},
						required: ['field', 'op', 'value']
					}
				},
				orderBy: {
					type: 'array',
					description: 'Optional sort, e.g. [{"field":"createdAt","direction":"desc"}].',
					items: {
						type: 'object',
						properties: {
							field: { type: 'string' },
							direction: { type: 'string', enum: ['asc', 'desc'] }
						},
						required: ['field', 'direction']
					}
				}
			},
			required: []
		},
		execute: async (args, ctx) => {
			const parsed = dbQueryArgsSchema.safeParse(args);
			if (!parsed.success) {
				const issues = parsed.error.issues
					.map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
					.join('; ');
				return `invalid arguments - ${issues}`;
			}
			const { collection, table, where, orderBy } = parsed.data;
			const query = {
				limit: Math.min(parsed.data.limit ?? 10, 20),
				...(where ? { where } : {}),
				...(orderBy ? { orderBy } : {})
			};
			return fetchAgentTool(ctx, AGENT_REGISTRY.db, '/admin/query', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(collection ? { collection, query } : { table, query })
			});
		}
	},
	{
		name: 'db_sql',
		description:
			'Run ONE read-only SQL SELECT over one SQL table - for sums, grouping, and shapes the query DSL cannot express. Single-table only; get table names and columns from db_overview first. Double-quote identifiers; always add a LIMIT.',
		parameters: {
			type: 'object',
			properties: {
				table: { type: 'string', description: 'SQL table name from db_overview.' },
				sql: {
					type: 'string',
					description:
						'One SELECT statement over that table, e.g. SELECT "status", COUNT(*) AS n FROM "orders" GROUP BY "status" LIMIT 20.'
				}
			},
			required: ['table', 'sql']
		},
		execute: async (args, ctx) => {
			const parsed = dbSqlArgsSchema.safeParse(args);
			if (!parsed.success) return 'invalid arguments - table and sql are required strings';
			// The copilot is a read-only surface: refuse DML before it ever
			// reaches the endpoint (which would happily run it as an operator).
			if (!/^\s*(select|with)\b/i.test(parsed.data.sql)) {
				return 'refused: only SELECT statements are allowed from the copilot';
			}
			return fetchAgentTool(
				ctx,
				AGENT_REGISTRY.db,
				// agentSegment, not encodeURIComponent: the latter leaves a bare
				// `..` intact, and this segment is chosen by the model - which
				// means by anything that reached the model, including data it
				// read out of this project. A dot segment resolves inside the
				// agent URL exactly like a decoded route parameter would.
				`/admin/tables/${agentSegment(parsed.data.table)}/sql`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ sql: parsed.data.sql })
				}
			);
		}
	}
];

// ---------------------------------------------------------------------------
// The Workers AI function-calling loop.

interface LoopMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	name?: string;
}

/**
 * Narrow structural view of the AI binding. The generated `Ai["run"]` types
 * are keyed per model id, which a runtime-configured CHAT_MODEL cannot
 * satisfy; the response is zod-parsed instead of trusted.
 */
interface AiRunner {
	run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

/**
 * Workers AI accepts tool definitions in two shapes: the flat one its
 * function-calling docs show, and the OpenAI-compatible wrapper. Which one a
 * given inference backend ACCEPTS is not stable - instances rolling out a
 * stricter validator reject the flat shape with an 8007 "validation errors"
 * body naming `body.tools.N.function`, which is why the copilot could answer
 * one question and fail the next.
 *
 * So: try one shape, and on a validation error retry with the other and
 * remember it for the rest of this isolate. Nothing else in the loop cares.
 */
type ToolShape = 'openai' | 'flat';
let preferredToolShape: ToolShape = 'openai';

interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

function shapeTools(tools: ToolDefinition[], shape: ToolShape): unknown[] {
	return shape === 'openai' ? tools.map((tool) => ({ type: 'function', function: tool })) : tools;
}

function isToolSchemaRejection(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /validation error|8007|'tools'|"tools"/i.test(message);
}

/**
 * One inference call, tolerant of the tool-shape disagreement above. Without
 * tools (the forcing call) there is nothing to disagree about.
 */
async function runInference(
	runner: AiRunner,
	model: string,
	input: Record<string, unknown>,
	tools?: ToolDefinition[]
): Promise<unknown> {
	if (!tools) return runner.run(model, input);
	try {
		return await runner.run(model, { ...input, tools: shapeTools(tools, preferredToolShape) });
	} catch (error) {
		if (!isToolSchemaRejection(error)) throw error;
		const fallback: ToolShape = preferredToolShape === 'openai' ? 'flat' : 'openai';
		const result = await runner.run(model, { ...input, tools: shapeTools(tools, fallback) });
		// Only switch after the other shape actually worked.
		preferredToolShape = fallback;
		return result;
	}
}

const aiResultSchema = z.object({
	response: z.string().nullish(),
	tool_calls: z.array(z.unknown()).nullish()
});

const directCallSchema = z.object({ name: z.string(), arguments: z.unknown().optional() });
const nestedCallSchema = z.object({ function: directCallSchema });

interface NormalizedToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

/** Accepts both tool-call shapes Workers AI models emit; drops malformed entries. */
function normalizeToolCalls(raw: unknown[] | null | undefined): NormalizedToolCall[] {
	const calls: NormalizedToolCall[] = [];
	for (const entry of raw ?? []) {
		const direct = directCallSchema.safeParse(entry);
		const nested = nestedCallSchema.safeParse(entry);
		const call = direct.success ? direct.data : nested.success ? nested.data.function : null;
		if (!call) continue;
		let args = call.arguments;
		if (typeof args === 'string') {
			try {
				args = JSON.parse(args);
			} catch {
				args = {};
			}
		}
		calls.push({
			name: call.name,
			arguments:
				args && typeof args === 'object' && !Array.isArray(args)
					? (args as Record<string, unknown>)
					: {}
		});
	}
	return calls;
}

async function executeToolCall(call: NormalizedToolCall, ctx: ToolContext): Promise<string> {
	const tool = COPILOT_TOOLS.find((candidate) => candidate.name === call.name);
	if (!tool) {
		return `unknown tool "${call.name}" - available tools: ${COPILOT_TOOLS.map((t) => t.name).join(', ')}`;
	}
	return tool.execute(call.arguments, ctx);
}

function systemPrompt(projectId: string): string {
	return (
		`You are the Frostbase copilot for project "${projectId}" - the operator's assistant inside the project dashboard. ` +
		'Use the provided tools to read live project data: auth_overview and auth_analytics for users, sessions, and activity; db_overview for collections, SQL tables, and their declared column schemas; db_query for actual documents or rows. ' +
		'Answer only from tool results - never invent metrics or documents, and say when there is not enough data. ' +
		'Be concise, and explain useful ratios or trends when the data supports them. ' +
		'Do not claim you can modify users, documents, or configuration. ' +
		`Today's date is ${new Date().toISOString().slice(0, 10)}.`
	);
}

export interface CopilotOutcome {
	answer: string;
	model: string;
}

/**
 * Runs the agentic loop: ask the model, execute any tool calls it makes
 * against the agents, feed the results back, and repeat until it answers in
 * text (or the tool budget runs out, when a final tool-less call forces one).
 * Throws on inference failure - the route maps that to the 502 contract.
 */
export async function runCopilot(options: {
	platform: App.Platform | undefined;
	origin: string;
	projectId: string;
	question: string;
	history: AgentChatMessage[];
}): Promise<CopilotOutcome> {
	const { platform, origin, projectId, question, history } = options;
	const env = platform?.env;
	if (!env?.AI) throw new Error('the AI binding is not available');
	const runner = env.AI as unknown as AiRunner;
	const model = env.CHAT_MODEL ?? DEFAULT_CHAT_MODEL;
	const ctx: ToolContext = { platform, origin, projectId };

	const messages: LoopMessage[] = [
		{ role: 'system', content: systemPrompt(projectId) },
		...history.slice(-10).map((message) => ({
			role: message.role === 'agent' ? ('assistant' as const) : ('user' as const),
			content: message.content
		})),
		{ role: 'user', content: question }
	];
	const tools: ToolDefinition[] = COPILOT_TOOLS.map(({ name, description, parameters }) => ({
		name,
		description,
		parameters
	}));

	for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
		const result = aiResultSchema.parse(
			await runInference(runner, model, { messages, max_tokens: 600, temperature: 0.2 }, tools)
		);
		const calls = normalizeToolCalls(result.tool_calls);
		if (calls.length === 0) {
			const answer = result.response?.trim();
			if (answer) return { answer, model };
			// Neither tool calls nor text: small models do this on multi-part
			// questions. The forcing call below is exactly the recovery for it,
			// so break to it instead of failing the request outright.
			break;
		}
		messages.push({
			role: 'assistant',
			content: result.response?.trim() || JSON.stringify({ tool_calls: calls })
		});
		for (const call of calls) {
			messages.push({ role: 'tool', name: call.name, content: await executeToolCall(call, ctx) });
		}
	}

	// Tool budget spent (or the model went quiet): tool-less calls, nudged to
	// answer in prose, force a text response out of what was gathered.
	//
	// Twice, because an empty completion is a roll of the dice with a small
	// model rather than a real failure - the same question answers fine on the
	// next attempt, which is what made the copilot feel intermittently broken.
	// Temperature rises slightly on the retry so it does not repeat the roll.
	messages.push({
		role: 'user',
		content:
			'Answer now, in plain text, using the information gathered above. Do not call any more tools.'
	});
	for (const temperature of [0.2, 0.5]) {
		const final = aiResultSchema.parse(
			await runInference(runner, model, { messages, max_tokens: 600, temperature })
		);
		const answer = final.response?.trim();
		if (answer) return { answer, model };
	}
	throw new Error('Workers AI returned an empty response');
}
