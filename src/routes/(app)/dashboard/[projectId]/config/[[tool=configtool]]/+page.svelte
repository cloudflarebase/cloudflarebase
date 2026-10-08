<script lang="ts">
	import { page } from '$app/state';
	import { buildConsoleNav } from '$lib/agent-registry';
	import {
		dbRemoteConfigSchema,
		dbRestorePointsSchema,
		type DbRemoteConfigCondition,
		type DbRemoteConfigParameter,
		type DbRestorePoint
	} from '$lib/agents';
	import CodeExamples from '$lib/components/code-examples.svelte';
	import ToolTabs from '$lib/components/tool-tabs.svelte';
	import { buildRemoteConfigIntegrationExamples } from '$lib/integration-examples';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		Eye,
		History,
		LoaderCircle,
		Pencil,
		Plus,
		RotateCcw,
		SlidersHorizontal,
		Target,
		Trash2,
		Undo2,
		Upload,
		X
	} from '@lucide/svelte';

	/**
	 * Remote Config - server-controlled parameters an app reads at startup:
	 * feature flags, kill switches, tuning values, changed without a redeploy.
	 *
	 * The interaction is Firebase's, and for Firebase's reason: edits are a
	 * DRAFT and publishing is what reaches clients. A config change usually
	 * means several parameters moving together, so an operator halfway through
	 * editing must never be serving a half-changed config to everyone. That is
	 * why the primary action in this page's header is Publish, why it counts
	 * what is pending, and why Discard exists beside it.
	 *
	 * Nothing here configures access, because there is nothing to configure: the
	 * parameters live in a platform-owned table closed on both sides, and the
	 * public endpoint serves them EVALUATED - so the targeting rules never leave
	 * the server even though clients can read the values they resolve to.
	 *
	 * Which is also why Preview calls that same public endpoint rather than
	 * re-implementing the rules here. A preview that could disagree with the
	 * real evaluation would be worse than no preview at all.
	 */

	let { data } = $props();

	const VALUE_TYPES = ['string', 'number', 'boolean', 'json'] as const;
	type ValueType = (typeof VALUE_TYPES)[number];

	const base = $derived(`/api/projects/${data.projectId}/db/admin/remote-config`);

	// Page-per-tool like the db workspace: /config is the parameter editor,
	// /config/integration shows how an app reads the values.
	const activeTab = $derived(page.params.tool ?? 'parameters');
	const toolTabs = $derived(
		buildConsoleNav(data.projectId)
			.flatMap((section) => section.items)
			.filter((item) => item.href.startsWith(`/dashboard/${data.projectId}/config`))
	);
	// page.url.origin is SSR-safe, so the snippets render without a flash.
	const dbBase = $derived(`${page.url.origin}/api/projects/${data.projectId}/db`);
	const snippets = $derived(buildRemoteConfigIntegrationExamples(dbBase));

	let parameters = $state<DbRemoteConfigParameter[]>([]);
	let pendingChanges = $state(0);
	let everPublished = $state(false);
	let limit = $state(100);
	let versions = $state<DbRestorePoint[]>([]);
	let versionsSupported = $state(true);
	let loading = $state(true);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	let editorOpen = $state(false);
	let confirmDiscard = $state(false);
	let rollbackTarget = $state<RollbackPlan | null>(null);

	/** The key being edited; empty means this is a new parameter. */
	let editingKey = $state('');
	let draftKey = $state('');
	let draftType = $state<ValueType>('boolean');
	/**
	 * Always edited as TEXT, whatever the declared type, and parsed on save. An
	 * input that re-parses per keystroke fights the person typing `-` before a
	 * number or `{` before a JSON object.
	 */
	let draftValue = $state('false');
	let draftDescription = $state('');
	let draftError = $state('');

	/**
	 * Conditions are edited as a small form per rule rather than as JSON.
	 * Targeting people cannot read is targeting they stop trusting, and an
	 * untrusted flag gets hardcoded back into the app - so the editor never
	 * shows the wire shape.
	 */
	type DraftCondition = {
		label: string;
		kind: 'country' | 'role' | 'permission' | 'appVersion' | 'rollout';
		/** country: `DE, AT`; role: `admin, staff`; permission: one key. */
		text: string;
		versionGte: string;
		versionLt: string;
		percent: number;
		salt: string;
		value: string;
	};
	let draftConditions = $state<DraftCondition[]>([]);

	const CONDITION_KINDS: { kind: DraftCondition['kind']; label: string; hint: string }[] = [
		{ kind: 'country', label: 'Country', hint: 'Resolved at the edge - a caller cannot claim it.' },
		{
			kind: 'role',
			label: 'User role',
			hint: 'From a verified sign-in. Signed-out never matches.'
		},
		{
			kind: 'permission',
			label: 'Permission key',
			hint: 'From a verified sign-in. Signed-out never matches.'
		},
		{ kind: 'appVersion', label: 'App version', hint: 'Reported by your app build.' },
		{
			kind: 'rollout',
			label: 'Percentage rollout',
			hint: 'Gradual exposure, not a lock - a client can re-roll its id. Use a role for anything that must not be reached.'
		}
	];

	function newCondition(): DraftCondition {
		return {
			label: '',
			kind: 'country',
			text: '',
			versionGte: '',
			versionLt: '',
			percent: 10,
			salt: '',
			value: draftType === 'boolean' ? 'true' : ''
		};
	}

	/** Wire condition -> the form. */
	function toDraftCondition(condition: DbRemoteConfigCondition): DraftCondition {
		const base = newCondition();
		base.label = condition.label ?? '';
		base.value =
			draftType === 'string'
				? String(condition.value ?? '')
				: JSON.stringify(condition.value ?? null);
		const when = condition.when ?? {};
		if (when.country?.length) return { ...base, kind: 'country', text: when.country.join(', ') };
		if (when.role?.length) return { ...base, kind: 'role', text: when.role.join(', ') };
		if (when.permission) return { ...base, kind: 'permission', text: when.permission };
		if (when.appVersion) {
			return {
				...base,
				kind: 'appVersion',
				versionGte: when.appVersion.gte ?? '',
				versionLt: when.appVersion.lt ?? ''
			};
		}
		if (when.rollout) {
			return { ...base, kind: 'rollout', percent: when.rollout.percent, salt: when.rollout.salt };
		}
		return base;
	}

	/** The form -> the wire, or a message naming what is missing. */
	function fromDraftCondition(
		draft: DraftCondition,
		index: number
	): { ok: true; condition: DbRemoteConfigCondition } | { ok: false; error: string } {
		const where = `Condition ${index + 1}`;
		const value = parseValue(draft.value);
		if (!value.ok) return { ok: false, error: `${where}: ${value.error}` };

		let when: DbRemoteConfigCondition['when'];
		if (draft.kind === 'country') {
			const codes = draft.text
				.split(',')
				.map((code) => code.trim().toUpperCase())
				.filter(Boolean);
			if (!codes.length) return { ok: false, error: `${where}: add at least one country code` };
			if (codes.some((code) => !/^[A-Z]{2}$/.test(code))) {
				return { ok: false, error: `${where}: use 2-letter country codes, e.g. DE` };
			}
			when = { country: codes };
		} else if (draft.kind === 'role') {
			const roles = draft.text
				.split(',')
				.map((role) => role.trim())
				.filter(Boolean);
			if (!roles.length) return { ok: false, error: `${where}: add at least one role` };
			when = { role: roles };
		} else if (draft.kind === 'permission') {
			if (!draft.text.trim()) return { ok: false, error: `${where}: add a permission key` };
			when = { permission: draft.text.trim() };
		} else if (draft.kind === 'appVersion') {
			const gte = draft.versionGte.trim();
			const lt = draft.versionLt.trim();
			if (!gte && !lt) return { ok: false, error: `${where}: set a minimum, a maximum, or both` };
			when = { appVersion: { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } };
		} else {
			if (!draft.salt.trim()) {
				return { ok: false, error: `${where}: name the rollout so it gets its own group` };
			}
			when = { rollout: { percent: draft.percent, salt: draft.salt.trim() } };
		}

		return {
			ok: true,
			condition: {
				...(draft.label.trim() ? { label: draft.label.trim() } : {}),
				when,
				value: value.value
			}
		};
	}

	async function load() {
		error = '';
		try {
			const [configResponse, versionsResponse] = await Promise.all([
				fetch(base),
				fetch(`${base}/versions`)
			]);
			if (!configResponse.ok) {
				const payload = (await configResponse.json().catch(() => null)) as {
					error?: string;
				} | null;
				error = payload?.error ?? 'could not load Remote Config';
				return;
			}
			const parsed = dbRemoteConfigSchema.safeParse(await configResponse.json());
			if (!parsed.success) {
				error = 'the db agent returned an unexpected shape';
				return;
			}
			parameters = parsed.data.parameters;
			pendingChanges = parsed.data.pendingChanges;
			everPublished = parsed.data.everPublished;
			limit = parsed.data.limit;

			// Versions are a nicety: local development has no point-in-time
			// recovery at all, and that must not take the editor down with it.
			if (versionsResponse.ok) {
				const points = dbRestorePointsSchema.safeParse(await versionsResponse.json());
				if (points.success) {
					// Belt and braces against an agent that still lists one bookmark
					// twice (publish + an immediate "before rollback" capture the same
					// moment): the list is keyed by bookmark, and a duplicate key kills
					// the whole render - which reads as the history being GONE. Keep
					// the oldest entry (the last in this newest-first list); it carries
					// the label the state was created under. Quadratic over a list the
					// agent caps at 200 - and no mutable built-in for the reactivity
					// lint to flag.
					versions = points.data.points.filter(
						(point, index, all) =>
							!all.some((other, at) => at > index && other.bookmark === point.bookmark)
					);
					versionsSupported = points.data.supported;
				}
			}
			// A failed versions fetch keeps whatever was on screen: "unsupported"
			// is a fact the agent REPORTS (supported: false), never a guess made
			// from a transient error - guessing here hid the entire history behind
			// "recovery is not available" whenever one request hiccuped.
		} catch {
			error = 'could not reach the db agent';
		} finally {
			loading = false;
		}
	}

	// Loaded once, and only when the editor is what's open: the first GET is
	// what lazily provisions the parameter table, and reading code samples must
	// not create a shard. Not onMount - the two tools share this component, so
	// landing on /config/integration and clicking over must still load.
	let editorLoaded = false;
	$effect(() => {
		if (activeTab === 'integration' || editorLoaded) return;
		editorLoaded = true;
		void load();
	});

	function openNew() {
		editingKey = '';
		draftKey = '';
		draftType = 'boolean';
		draftValue = 'false';
		draftDescription = '';
		draftConditions = [];
		draftError = '';
		editorOpen = true;
	}

	function openEdit(parameter: DbRemoteConfigParameter) {
		editingKey = parameter.key;
		draftKey = parameter.key;
		draftType = parameter.valueType;
		draftValue =
			parameter.valueType === 'string'
				? String(parameter.draftValue ?? '')
				: JSON.stringify(parameter.draftValue ?? null);
		draftDescription = parameter.description ?? '';
		draftConditions = (parameter.draftConditions ?? []).map(toDraftCondition);
		draftError = '';
		editorOpen = true;
	}

	/**
	 * Text -> the typed value the agent expects. A string takes the raw text -
	 * quoting your own strings is a papercut nobody wants - and every other type
	 * is JSON, which is what makes `null` expressible at all.
	 */
	function parseValue(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
		if (draftType === 'string') return { ok: true, value: raw };
		const text = raw.trim();
		if (!text) return { ok: false, error: 'a value is required' };
		try {
			return { ok: true, value: JSON.parse(text) as unknown };
		} catch {
			return {
				ok: false,
				error:
					draftType === 'json'
						? 'that is not valid JSON - try {"a": 1}, [1, 2], or null'
						: `that is not a valid ${draftType}`
			};
		}
	}

	function parseDraft() {
		return parseValue(draftValue);
	}

	async function send(path: string, init: RequestInit): Promise<Record<string, unknown> | null> {
		const response = await fetch(path, {
			...init,
			headers: init.body ? { 'content-type': 'application/json' } : undefined
		});
		const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
		if (!response.ok) {
			error = (payload?.error as string) ?? 'that did not work';
			return null;
		}
		return payload ?? {};
	}

	async function save() {
		draftError = '';
		const parsed = parseDraft();
		if (!parsed.ok) {
			draftError = parsed.error;
			return;
		}
		busy = true;
		try {
			const conditions: DbRemoteConfigCondition[] = [];
			for (const [index, draft] of draftConditions.entries()) {
				const built = fromDraftCondition(draft, index);
				if (!built.ok) {
					draftError = built.error;
					return;
				}
				conditions.push(built.condition);
			}

			const response = await fetch(`${base}/${encodeURIComponent(draftKey.trim())}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					valueType: draftType,
					defaultValue: parsed.value,
					description: draftDescription.trim() || null,
					// Always sent, never omitted: omission means "leave the rules
					// alone", and an editor that cannot REMOVE the last rule would
					// be a trap.
					conditions
				})
			});
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as { error?: string } | null;
				draftError = payload?.error ?? 'could not save that parameter';
				return;
			}
			editorOpen = false;
			notice = '';
			await load();
		} finally {
			busy = false;
		}
	}

	async function remove(key: string) {
		busy = true;
		error = '';
		notice = '';
		try {
			await send(`${base}/${encodeURIComponent(key)}`, { method: 'DELETE' });
			await load();
		} finally {
			busy = false;
		}
	}

	async function publish() {
		busy = true;
		error = '';
		notice = '';
		try {
			const result = await send(`${base}/publish`, {
				method: 'POST',
				body: JSON.stringify({ reason: 'publish' })
			});
			if (result) {
				notice =
					result.versionCaptured === false
						? 'Published. No version was captured - point-in-time recovery is unavailable here.'
						: 'Published. Clients now get these values.';
			}
			await load();
		} finally {
			busy = false;
		}
	}

	async function discard() {
		busy = true;
		error = '';
		notice = '';
		confirmDiscard = false;
		try {
			await send(`${base}/discard`, { method: 'POST' });
			notice = 'Draft changes discarded.';
			await load();
		} finally {
			busy = false;
		}
	}

	/**
	 * Every history entry's bookmark is the state AFTER the event it names -
	 * that is what makes a restored version one that was actually served. But
	 * an operator reads a row labeled "removed test" as a CHANGE, and expects
	 * the button to undo it - restoring that row's own snapshot would re-apply
	 * the removal. So a publish row's action is UNDO: it targets the PREVIOUS
	 * entry's snapshot, the state just before the change (which also undoes
	 * everything newer). A `before rollback` row is the opposite kind of thing
	 * - a saved snapshot of the state a rollback stepped away from - so its
	 * action is RESTORE, targeting its own bookmark; that is what keeps a
	 * rollback itself reversible.
	 */
	type RollbackPlan = {
		/** The row the operator clicked - what the dialog names. */
		entry: DbRestorePoint;
		/** The snapshot actually restored. */
		target: DbRestorePoint;
		kind: 'undo' | 'restore';
		/** Newer entries above the clicked row - undone along with it. */
		newer: number;
	};

	function planRollback(point: DbRestorePoint): RollbackPlan | null {
		const index = versions.indexOf(point);
		if (point.reason.startsWith('before rollback')) {
			return { entry: point, target: point, kind: 'restore', newer: index };
		}
		const previous = versions[index + 1];
		// The first publish has no earlier snapshot to return to.
		if (!previous) return null;
		return { entry: point, target: previous, kind: 'undo', newer: index };
	}

	async function rollback(plan: RollbackPlan) {
		busy = true;
		error = '';
		notice = '';
		rollbackTarget = null;
		try {
			const result = await send(`${base}/restore`, {
				method: 'POST',
				body: JSON.stringify({ bookmark: plan.target.bookmark })
			});
			if (result) {
				notice =
					plan.kind === 'undo'
						? `Undid "${plan.entry.reason}".`
						: `Restored the state saved ${new Date(plan.entry.capturedAt).toLocaleString()}.`;
			}
			await load();
		} finally {
			busy = false;
		}
	}

	// --- Preview -----------------------------------------------------------
	//
	// The control that makes targeting trustworthy. It calls the SAME public
	// endpoint an app calls, so what it shows is not a second implementation of
	// the rules that could disagree with the real one - it IS the real one.
	let previewOpen = $state(false);
	let previewCountry = $state('');
	let previewUid = $state('');
	let previewVersion = $state('');
	let previewResult = $state<Record<string, unknown> | null>(null);
	let previewError = $state('');
	let previewBusy = $state(false);

	async function runPreview() {
		previewBusy = true;
		previewError = '';
		previewResult = null;
		try {
			// Plain string building rather than URLSearchParams: this is used once
			// and thrown away, and the reactivity lint rightly flags a mutable
			// built-in held in component scope.
			const query = [
				previewUid.trim() ? `uid=${encodeURIComponent(previewUid.trim())}` : '',
				previewVersion.trim() ? `appVersion=${encodeURIComponent(previewVersion.trim())}` : ''
			]
				.filter(Boolean)
				.join('&');
			const headers: Record<string, string> = {};
			// The same test-only override the e2e stack uses; on a deployment
			// without it set, country comes from the edge and this is ignored -
			// which the panel says rather than pretending otherwise.
			if (previewCountry.trim()) headers['x-cfb-country'] = previewCountry.trim().toUpperCase();

			const response = await fetch(`/api/projects/${data.projectId}/db/remote-config?${query}`, {
				headers
			});
			if (!response.ok) {
				previewError = 'the preview request failed';
				return;
			}
			const body = (await response.json()) as { params?: Record<string, unknown> };
			previewResult = body.params ?? {};
		} catch {
			previewError = 'could not reach the config endpoint';
		} finally {
			previewBusy = false;
		}
	}

	/** What clients are being served right now, as text. */
	function shown(parameter: DbRemoteConfigParameter, which: 'draftValue' | 'publishedValue') {
		const value = parameter[which];
		if (parameter.state === 'draft' && which === 'publishedValue') return '—';
		if (parameter.valueType === 'string') return String(value ?? '');
		return JSON.stringify(value ?? null);
	}
</script>

<svelte:head>
	<title>{data.projectId} · Remote Config · Frostbase</title>
	<!-- No project id: the console is noindex, so the only consumer of this is a
	     link unfurler, and that card must not name a project. -->
	<meta
		name="description"
		content="Feature flags and tuning values your app reads at startup, changed without a redeploy."
	/>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-3 py-5 sm:space-y-8 sm:px-6 sm:py-8">
	<ToolTabs items={toolTabs} />

	{#if activeTab === 'integration'}
		<div>
			<h1 class="text-2xl font-semibold">Integration</h1>
			<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
				Read these values from your app - the client SDK, plain REST, or cURL. Evaluated per caller,
				revalidated with ETags.
			</p>
		</div>

		<Card.Root data-testid="config-integration">
			<Card.Header>
				<Card.Title>Read config in your app</Card.Title>
				<Card.Description>
					One public endpoint, answering values already evaluated for the caller - the targeting
					rules never leave the server. Ship defaults so the app renders before the first fetch
					answers, and keeps working if it never does.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-5">
				<div>
					<Label>Config endpoint</Label><code
						class="mt-2 block overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs"
						>{dbBase}/remote-config</code
					>
				</div>
				<CodeExamples examples={snippets} />
				<p class="text-xs text-muted-foreground">
					Role and permission rules follow the project JWT the caller sends; anonymous callers never
					match them. Percentage rollouts key on the signed-in user id, or on
					<code class="font-mono">uid</code> - generate one per install and persist it, or the same user
					re-rolls their bucket on every launch.
				</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-semibold">Remote Config</h1>
				<p class="mt-1 max-w-2xl text-sm text-muted-foreground">
					Values your app reads at startup - feature flags, kill switches, limits - changed from
					here without shipping a release. Edits are a draft until you publish.
				</p>
			</div>
			<div class="flex shrink-0 items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={loading}
					onclick={() => {
						previewOpen = true;
						void runPreview();
					}}
					data-testid="config-preview-open"
				>
					<Eye class="mr-1.5 h-3.5 w-3.5" /> Preview
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy || loading || pendingChanges === 0}
					onclick={() => (confirmDiscard = true)}
					data-testid="config-discard"
				>
					<Undo2 class="mr-1.5 h-3.5 w-3.5" /> Discard
				</Button>
				<Button
					size="sm"
					disabled={busy || loading || pendingChanges === 0}
					onclick={publish}
					data-testid="config-publish"
				>
					{#if busy}
						<LoaderCircle class="mr-1.5 h-3.5 w-3.5 animate-spin" />
					{:else}
						<Upload class="mr-1.5 h-3.5 w-3.5" />
					{/if}
					Publish changes
				</Button>
			</div>
		</div>

		{#if pendingChanges > 0}
			<div
				class="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
				data-testid="config-pending-banner"
			>
				<span class="font-medium">
					{pendingChanges}
					{pendingChanges === 1 ? 'change' : 'changes'} not published yet.
				</span>
				<span class="text-muted-foreground">
					Clients still get the last published values until you publish.
				</span>
			</div>
		{/if}

		{#if error}
			<p class="text-sm text-destructive" data-testid="config-error">{error}</p>
		{/if}
		{#if notice}
			<p class="text-sm text-muted-foreground" data-testid="config-notice">{notice}</p>
		{/if}

		<Card.Root>
			<Card.Header class="flex flex-row items-start justify-between gap-4 space-y-0">
				<div class="space-y-1.5">
					<Card.Title class="flex items-center gap-2">
						<SlidersHorizontal class="h-4 w-4 text-primary" /> Parameters
					</Card.Title>
					<Card.Description>
						{#if loading}
							Loading…
						{:else}
							{parameters.length} of {limit}. The key is what your app asks for.
						{/if}
					</Card.Description>
				</div>
				<Button
					size="sm"
					disabled={busy || loading || parameters.length >= limit}
					onclick={openNew}
					data-testid="config-new"
				>
					<Plus class="mr-1.5 h-3.5 w-3.5" /> Add parameter
				</Button>
			</Card.Header>
			<Card.Content>
				{#if loading}
					<div class="flex items-center gap-2 py-8 text-sm text-muted-foreground">
						<LoaderCircle class="h-4 w-4 animate-spin" /> Loading parameters…
					</div>
				{:else if parameters.length === 0}
					<div
						class="rounded-lg border border-dashed px-4 py-12 text-center"
						data-testid="config-empty"
					>
						<SlidersHorizontal class="mx-auto h-6 w-6 text-muted-foreground" />
						<p class="mt-3 text-sm font-medium">No parameters yet</p>
						<p class="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
							Add a flag like <code class="font-mono">checkoutV2</code>, read it in your app, and
							flip it from here without shipping anything.
						</p>
						<Button size="sm" class="mt-4" onclick={openNew} data-testid="config-new-empty">
							<Plus class="mr-1.5 h-3.5 w-3.5" /> Add your first parameter
						</Button>
					</div>
				{:else}
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Parameter</Table.Head>
								<Table.Head>Type</Table.Head>
								<Table.Head>Draft value</Table.Head>
								<Table.Head class="hidden md:table-cell">Serving now</Table.Head>
								<Table.Head class="w-24 text-right">Actions</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each parameters as parameter (parameter.key)}
								<Table.Row
									data-testid={`config-row-${parameter.key}`}
									class={parameter.state === 'deleting' ? 'opacity-60' : ''}
								>
									<Table.Cell>
										<div class="flex flex-wrap items-center gap-2">
											<span class="font-mono font-medium">{parameter.key}</span>
											{#if parameter.state === 'deleting'}
												<Badge variant="destructive" class="text-[10px]">removing on publish</Badge>
											{:else if parameter.state === 'draft'}
												<Badge variant="secondary" class="text-[10px]">new</Badge>
											{:else if parameter.pending}
												<Badge variant="secondary" class="text-[10px]">edited</Badge>
											{/if}
										</div>
										{#if parameter.draftConditions?.length}
											<p class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
												<Target class="h-3 w-3" />
												{parameter.draftConditions.length}
												{parameter.draftConditions.length === 1 ? 'rule' : 'rules'} before the default
											</p>
										{/if}
										{#if parameter.description}
											<p class="mt-0.5 max-w-md truncate text-xs text-muted-foreground">
												{parameter.description}
											</p>
										{/if}
									</Table.Cell>
									<Table.Cell class="font-mono text-xs text-muted-foreground">
										{parameter.valueType}
									</Table.Cell>
									<Table.Cell class="max-w-56 truncate font-mono text-xs">
										{shown(parameter, 'draftValue')}
									</Table.Cell>
									<Table.Cell
										class="hidden max-w-56 truncate font-mono text-xs text-muted-foreground md:table-cell"
									>
										{shown(parameter, 'publishedValue')}
									</Table.Cell>
									<Table.Cell class="text-right whitespace-nowrap">
										<Button
											variant="ghost"
											size="icon"
											disabled={busy}
											aria-label={`Edit ${parameter.key}`}
											data-testid={`config-edit-${parameter.key}`}
											onclick={() => openEdit(parameter)}
										>
											<Pencil class="h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											disabled={busy}
											aria-label={`Remove ${parameter.key}`}
											data-testid={`config-delete-${parameter.key}`}
											onclick={() => remove(parameter.key)}
										>
											<Trash2 class="h-3.5 w-3.5 text-destructive" />
										</Button>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="space-y-1.5">
				<Card.Title class="flex items-center gap-2">
					<History class="h-4 w-4 text-muted-foreground" /> Change history
				</Card.Title>
				<Card.Description>
					Every publish is a change you can undo - parameters return to how they were just before
					it, and every newer change is undone with it. A rollback saves the state it stepped away
					from as its own entry, so it can be restored too.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if !versionsSupported}
					<p class="text-sm text-muted-foreground" data-testid="config-versions-unsupported">
						Point-in-time recovery is not available in this environment, so publishing records no
						version here. It works on a deployed project.
					</p>
				{:else if versions.length === 0}
					<p class="text-sm text-muted-foreground" data-testid="config-versions-empty">
						{everPublished
							? 'No versions recorded yet.'
							: 'Nothing published yet - your first publish starts the history.'}
					</p>
				{:else}
					<ul class="divide-y" data-testid="config-versions">
						{#each versions as point (point.bookmark)}
							{@const plan = planRollback(point)}
							<li class="flex items-center justify-between gap-4 py-2.5">
								<div class="min-w-0">
									<p class="text-sm font-medium">{new Date(point.capturedAt).toLocaleString()}</p>
									<p class="truncate text-xs text-muted-foreground">{point.reason}</p>
								</div>
								{#if plan}
									<Button
										variant="outline"
										size="sm"
										disabled={busy}
										onclick={() => (rollbackTarget = plan)}
										data-testid={`config-rollback-${point.bookmark}`}
									>
										{#if plan.kind === 'undo'}
											<Undo2 class="mr-1.5 h-3.5 w-3.5" /> Undo
										{:else}
											<RotateCcw class="mr-1.5 h-3.5 w-3.5" /> Restore
										{/if}
									</Button>
								{:else}
									<!-- The first publish: no earlier snapshot exists to return
									     to, and a disabled button would promise one. -->
									<span class="shrink-0 text-xs text-muted-foreground">first version</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<Dialog.Root bind:open={editorOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{editingKey ? `Edit ${editingKey}` : 'Add parameter'}</Dialog.Title>
			<Dialog.Description>
				Saving stores a draft. Nothing reaches your app until you publish.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<div class="space-y-1.5">
				<Label for="config-key">Parameter key</Label>
				<Input
					id="config-key"
					bind:value={draftKey}
					disabled={Boolean(editingKey)}
					placeholder="checkoutV2"
					class="font-mono"
					data-testid="config-key"
				/>
				{#if editingKey}
					<p class="text-xs text-muted-foreground">
						The key is how your app addresses this value, so it cannot be renamed - add a new one
						and remove this.
					</p>
				{/if}
			</div>

			<div class="space-y-1.5">
				<Label>Type</Label>
				<Select.Root
					type="single"
					value={draftType}
					onValueChange={(value) => {
						draftType = (VALUE_TYPES as readonly string[]).includes(value)
							? (value as ValueType)
							: 'string';
						// Reset to something valid for the new type - the dialog should
						// never open onto an error the operator did not cause.
						draftValue = draftType === 'boolean' ? 'false' : draftType === 'number' ? '0' : '';
					}}
				>
					<Select.Trigger class="w-full font-mono" data-testid="config-type">
						{draftType}
					</Select.Trigger>
					<Select.Content>
						{#each VALUE_TYPES as type (type)}
							<Select.Item value={type} label={type} class="font-mono" />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="space-y-1.5">
				<Label for="config-value">Value</Label>
				{#if draftType === 'json'}
					<Textarea
						id="config-value"
						bind:value={draftValue}
						rows={4}
						placeholder={'{"variant": "b"}'}
						class="font-mono text-xs"
						data-testid="config-value"
					/>
				{:else}
					<Input
						id="config-value"
						bind:value={draftValue}
						placeholder={draftType === 'boolean' ? 'true' : draftType === 'number' ? '25' : 'eur'}
						class="font-mono"
						data-testid="config-value"
					/>
				{/if}
				<p class="text-xs text-muted-foreground">
					{#if draftType === 'string'}
						Typed as-is - no quoting.
					{:else if draftType === 'boolean'}
						<code class="font-mono">true</code> or <code class="font-mono">false</code>.
					{:else if draftType === 'number'}
						A finite number, e.g. <code class="font-mono">25</code>.
					{:else}
						Any JSON value - an object, an array, or <code class="font-mono">null</code>.
					{/if}
				</p>
			</div>

			<div class="space-y-1.5">
				<Label for="config-description">
					Description <span class="font-normal text-muted-foreground">(optional)</span>
				</Label>
				<Input
					id="config-description"
					bind:value={draftDescription}
					placeholder="What flipping this does"
					data-testid="config-description"
				/>
				<p class="text-xs text-muted-foreground">
					For whoever reads this page next. Never sent to clients.
				</p>
			</div>

			<div class="space-y-2 border-t pt-4">
				<div class="flex items-center justify-between">
					<div>
						<Label class="flex items-center gap-1.5">
							<Target class="h-3.5 w-3.5" /> Targeting
						</Label>
						<p class="mt-0.5 text-xs text-muted-foreground">
							Checked top to bottom - the first rule that matches wins, and anyone matching none
							gets the value above.
						</p>
					</div>
					<Button
						variant="outline"
						size="sm"
						disabled={draftConditions.length >= 5}
						onclick={() => (draftConditions = [...draftConditions, newCondition()])}
						data-testid="config-add-condition"
					>
						<Plus class="mr-1.5 h-3.5 w-3.5" /> Add rule
					</Button>
				</div>

				{#each draftConditions as condition, index (index)}
					{@const meta = CONDITION_KINDS.find((entry) => entry.kind === condition.kind)}
					<div class="space-y-2 rounded-lg border p-3" data-testid={`config-condition-${index}`}>
						<div class="flex items-center gap-2">
							<span class="text-xs font-medium text-muted-foreground">#{index + 1}</span>
							<Select.Root
								type="single"
								value={condition.kind}
								onValueChange={(value) => {
									condition.kind = (value ?? 'country') as DraftCondition['kind'];
								}}
							>
								<Select.Trigger
									class="h-8 flex-1 text-xs"
									data-testid={`config-condition-kind-${index}`}
								>
									{meta?.label ?? condition.kind}
								</Select.Trigger>
								<Select.Content>
									{#each CONDITION_KINDS as entry (entry.kind)}
										<Select.Item value={entry.kind} label={entry.label} />
									{/each}
								</Select.Content>
							</Select.Root>
							<Button
								variant="ghost"
								size="icon"
								class="h-8 w-8"
								aria-label={`Remove rule ${index + 1}`}
								data-testid={`config-remove-condition-${index}`}
								onclick={() => (draftConditions = draftConditions.filter((_, at) => at !== index))}
							>
								<X class="h-3.5 w-3.5" />
							</Button>
						</div>

						{#if condition.kind === 'country'}
							<Input
								bind:value={condition.text}
								placeholder="DE, AT, CH"
								class="h-8 font-mono text-xs"
								data-testid={`config-condition-value-${index}`}
							/>
						{:else if condition.kind === 'role'}
							<Input
								bind:value={condition.text}
								placeholder="admin, staff"
								class="h-8 font-mono text-xs"
								data-testid={`config-condition-value-${index}`}
							/>
						{:else if condition.kind === 'permission'}
							<Input
								bind:value={condition.text}
								placeholder="beta:read"
								class="h-8 font-mono text-xs"
								data-testid={`config-condition-value-${index}`}
							/>
						{:else if condition.kind === 'appVersion'}
							<div class="flex items-center gap-2">
								<Input
									bind:value={condition.versionGte}
									placeholder="from 2.1.0"
									class="h-8 font-mono text-xs"
								/>
								<Input
									bind:value={condition.versionLt}
									placeholder="before 3.0.0"
									class="h-8 font-mono text-xs"
								/>
							</div>
						{:else}
							<div class="flex items-center gap-2">
								<Input
									type="number"
									min="1"
									max="99"
									bind:value={condition.percent}
									class="h-8 w-20 font-mono text-xs"
									data-testid={`config-condition-percent-${index}`}
								/>
								<span class="text-xs text-muted-foreground">% of</span>
								<Input
									bind:value={condition.salt}
									placeholder="rollout name"
									class="h-8 flex-1 font-mono text-xs"
									data-testid={`config-condition-salt-${index}`}
								/>
							</div>
						{/if}

						<div class="flex items-center gap-2">
							<span class="w-10 shrink-0 text-xs text-muted-foreground">gets</span>
							<Input
								bind:value={condition.value}
								placeholder={draftType === 'boolean' ? 'true' : 'value'}
								class="h-8 font-mono text-xs"
								data-testid={`config-condition-result-${index}`}
							/>
						</div>
						{#if meta}
							<p class="text-xs text-muted-foreground">{meta.hint}</p>
						{/if}
					</div>
				{/each}
			</div>

			{#if draftError}
				<p class="text-sm text-destructive" data-testid="config-draft-error">{draftError}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (editorOpen = false)} disabled={busy}>Cancel</Button>
			<Button onclick={save} disabled={busy || !draftKey.trim()} data-testid="config-save">
				{#if busy}<LoaderCircle class="mr-1.5 h-3.5 w-3.5 animate-spin" />{/if}
				Save draft
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={confirmDiscard}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Discard draft changes?</AlertDialog.Title>
			<AlertDialog.Description>
				Every unpublished edit goes back to what your app is being served right now. Parameters you
				added but never published are removed. This cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Keep editing</AlertDialog.Cancel>
			<AlertDialog.Action onclick={discard} data-testid="config-discard-confirm">
				Discard
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root
	open={rollbackTarget !== null}
	onOpenChange={(open) => {
		if (!open) rollbackTarget = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{rollbackTarget?.kind === 'undo' ? 'Undo this change?' : 'Restore this state?'}
			</AlertDialog.Title>
			<AlertDialog.Description>
				{#if rollbackTarget}
					{#if rollbackTarget.kind === 'undo'}
						Every parameter goes back to how it was before
						<span class="font-medium text-foreground" data-testid="config-rollback-summary"
							>{rollbackTarget.entry.reason}</span
						>
						— the state of {new Date(rollbackTarget.target.capturedAt).toLocaleString()}, drafts
						included.
						{#if rollbackTarget.newer > 0}
							The {rollbackTarget.newer} newer {rollbackTarget.newer === 1 ? 'change' : 'changes'} above
							it {rollbackTarget.newer === 1 ? 'is' : 'are'} undone too.
						{/if}
					{:else}
						Every parameter returns to the state saved
						{new Date(rollbackTarget.entry.capturedAt).toLocaleString()}
						(<span class="font-medium text-foreground" data-testid="config-rollback-summary"
							>{rollbackTarget.entry.reason}</span
						>), drafts included.
					{/if}
					The action itself becomes an entry you can undo.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => rollbackTarget && rollback(rollbackTarget)}
				data-testid="config-rollback-confirm"
			>
				{rollbackTarget?.kind === 'undo' ? 'Undo' : 'Restore'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root bind:open={previewOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Eye class="h-4 w-4" /> Preview a caller
			</Dialog.Title>
			<Dialog.Description>
				What a given app would receive right now. This calls the same public endpoint your app
				calls, so it cannot disagree with the real thing - which also means it shows PUBLISHED
				values, not your drafts.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-3">
			<div class="grid grid-cols-3 gap-2">
				<div class="space-y-1.5">
					<Label class="text-xs" for="preview-country">Country</Label>
					<Input
						id="preview-country"
						bind:value={previewCountry}
						placeholder="DE"
						class="font-mono"
						data-testid="config-preview-country"
					/>
				</div>
				<div class="space-y-1.5">
					<Label class="text-xs" for="preview-uid">User / install id</Label>
					<Input
						id="preview-uid"
						bind:value={previewUid}
						placeholder="user-42"
						class="font-mono"
						data-testid="config-preview-uid"
					/>
				</div>
				<div class="space-y-1.5">
					<Label class="text-xs" for="preview-version">App version</Label>
					<Input
						id="preview-version"
						bind:value={previewVersion}
						placeholder="2.1.0"
						class="font-mono"
						data-testid="config-preview-version"
					/>
				</div>
			</div>
			<p class="text-xs text-muted-foreground">
				Role and permission rules follow the signed-in user's token, so they cannot be previewed
				from here - sign in as that user in your app to see them. Country preview works on local
				development; on a deployment the real caller's country always wins.
			</p>

			<Button
				size="sm"
				onclick={runPreview}
				disabled={previewBusy}
				data-testid="config-preview-run"
			>
				{#if previewBusy}<LoaderCircle class="mr-1.5 h-3.5 w-3.5 animate-spin" />{/if}
				Evaluate
			</Button>

			{#if previewError}
				<p class="text-sm text-destructive">{previewError}</p>
			{:else if previewResult}
				{#if Object.keys(previewResult).length === 0}
					<p class="text-sm text-muted-foreground" data-testid="config-preview-empty">
						Nothing published yet - this caller receives an empty config.
					</p>
				{:else}
					<div class="rounded-lg border" data-testid="config-preview-result">
						{#each Object.entries(previewResult) as [key, value] (key)}
							<div
								class="flex items-center justify-between gap-3 border-b px-3 py-1.5 last:border-b-0"
							>
								<span class="font-mono text-xs">{key}</span>
								<span class="truncate font-mono text-xs text-muted-foreground">
									{JSON.stringify(value)}
								</span>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
