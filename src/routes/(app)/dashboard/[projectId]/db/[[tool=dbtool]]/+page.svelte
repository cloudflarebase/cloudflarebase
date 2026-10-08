<script lang="ts">
	import { browser, dev } from '$app/environment';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type {
		DbAccessMode,
		DbActivityEvent,
		DbAgentState,
		DbReplicationMode,
		DbDocument,
		DbFieldRule,
		DbImportReport,
		DbOverview,
		DbQueryResult,
		DbValidator
	} from '$lib/agents';
	import { dbAccessModeSchema, dbValidatorSchema } from '$lib/agents';
	import { buildConsoleNav } from '$lib/agent-registry';
	import CodeExamples from '$lib/components/code-examples.svelte';
	import ToolTabs from '$lib/components/tool-tabs.svelte';
	import ActivityCard from '../activity-card.svelte';
	import ReplicationTab from '../replication-tab.svelte';
	import RollbackDialog from '../rollback-dialog.svelte';
	import SqlEditor from '../sql-editor.svelte';
	import TablesTab from '../tables-tab.svelte';
	import { v7 as uuidv7 } from 'uuid';
	import type { CodeExample } from '$lib/integration-examples';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		Activity,
		ChevronLeft,
		ChevronRight,
		Database,
		Download,
		EllipsisVertical,
		FileText,
		History,
		Pencil,
		Plus,
		Trash2,
		Upload,
		X
	} from '@lucide/svelte';
	import { AgentClient } from 'agents/client';
	import { onMount, tick } from 'svelte';

	let { data } = $props();
	let hydrated = $state(false);

	// The browsed collection restores from the query string AT INIT, not in
	// onMount: page.url is the request URL during SSR, so the server already
	// renders the right state and the reload never flashes the default first.
	const initialCollection = page.url.searchParams.get('collection');

	onMount(() => {
		hydrated = true;
		void loadPermissions();
		// Documents can only load client-side; the card itself was SSR'd.
		if (selected) void loadDocuments(selected);
	});

	/** Mirror UI state into the query string without history spam. */
	function persistQueryParam(key: string, value: string | null) {
		if (!browser) return;
		try {
			const url = new URL(window.location.href);
			if (value) url.searchParams.set(key, value);
			else url.searchParams.delete(key);
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- same-page query param, not a route
			replaceState(url, {});
		} catch {
			// router not ready (first paint) - the selection itself still works
		}
	}

	// Initial values from the server load; kept in sync on navigation by the
	// $effect below and updated live via WebSocket state sync.
	// svelte-ignore state_referenced_locally
	let overview = $state<DbOverview>(data.overview);
	// svelte-ignore state_referenced_locally
	let agentState = $state<DbAgentState>(data.overview.state);
	let live = $state(false);
	// Page-per-tool (Neon-style): the tool IS the route - /db is the
	// collections browser, /db/tables, /db/sql, /db/access, /db/replication,
	// and /db/integration are sidebar siblings. Old ?tab= links redirect in
	// the server load.
	const activeTab = $derived(page.params.tool ?? 'collections');
	/** Desktop quick-switcher over this agent's tool pages (sidebar stays canonical). */
	const toolTabs = $derived(
		buildConsoleNav(data.projectId)
			.flatMap((section) => section.items)
			.filter((item) => item.href.startsWith(`/dashboard/${data.projectId}/db`))
	);
	const toolMeta: Record<string, { title: string; blurb: string }> = {
		collections: {
			title: 'Collections',
			blurb:
				'Like Firestore, but every collection is its own Durable Object - JSON documents, queries, and onSnapshot-style live subscriptions.'
		},
		tables: {
			title: 'Tables',
			blurb:
				'Schema-first SQL tables - typed columns, ORM-compatible storage, and the same live queries as collections.'
		},
		sql: {
			title: 'SQL Editor',
			blurb:
				'Operator SQL against a declared table - single statement or atomic batch, single-table, no DDL: the column DSL owns the schema.'
		},
		access: {
			title: 'Access',
			blurb: 'Per-shard access modes, permission keys, document rules, and replication opt-outs.'
		},
		replication: {
			title: 'Replication',
			blurb:
				'Where reads are served from right now - replicas materialize per region, on by default.'
		},
		integration: {
			title: 'Integration',
			blurb:
				'Connect your application: REST, the typed client SDK, the Drizzle driver, or a raw live-query WebSocket.'
		}
	};
	let busy = $state(false);

	// Document browser: which collection is open, and its latest page of docs.
	let selected = $state<string | null>(
		initialCollection && /^[a-z][a-z0-9_-]{0,63}$/.test(initialCollection)
			? initialCollection
			: null
	);
	let documents = $state<DbDocument[]>([]);
	let docsLoaded = $state(false);
	let docsError = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	// Third Miller column: which document's fields are open.
	let selectedDoc = $state<string | null>(null);
	const selectedDocData = $derived(documents.find((doc) => doc.id === selectedDoc) ?? null);

	// Paging is KEYSET, not offset - the query DSL takes an opaque `cursor` and
	// hands back the next one, so "previous" means walking back a stack of the
	// cursors that started each page. `docPageCursors[i]` starts page i, and
	// index 0 is always undefined (the first page needs no cursor).
	const DOC_PAGE_SIZE = 50;
	let docPage = $state(0);
	let docPageCursors = $state<(string | undefined)[]>([undefined]);
	let docsNextCursor = $state<string | null>(null);
	// Loads can overlap: the 5s poll re-reads while a Prev/Next click fetches
	// another page. Two rules keep them straight: only the NEWEST read may
	// land (docsLoadSeq - a stale response resolving late would yank the
	// operator off their page), and a poll re-reads the page the operator is
	// heading FOR (docDesiredPage, set by navigation before its fetch lands),
	// not the page last rendered - or a poll fired mid-navigation would
	// supersede the click with a re-read of the page being left.
	let docsLoadSeq = 0;
	let docDesiredPage = 0;
	const openCollectionDocs = $derived(
		agentState.collections.find((entry) => entry.name === selected)?.docs ?? 0
	);
	const docRangeStart = $derived(documents.length === 0 ? 0 : docPage * DOC_PAGE_SIZE + 1);
	const docRangeEnd = $derived(docPage * DOC_PAGE_SIZE + documents.length);

	function resetDocPaging() {
		docPage = 0;
		docDesiredPage = 0;
		docPageCursors = [undefined];
		docsNextCursor = null;
	}

	function nextDocPage() {
		if (!selected || !docsNextCursor) return;
		docPageCursors[docPage + 1] = docsNextCursor;
		void loadDocuments(selected, docPage + 1);
	}

	function prevDocPage() {
		if (!selected || docPage === 0) return;
		void loadDocuments(selected, docPage - 1);
	}

	function selectDocument(id: string) {
		selectedDoc = selectedDoc === id ? null : id;
		// Below lg the fields column sits BELOW the document list, which can be a
		// full page tall - selecting a row deep in the list would otherwise look
		// like nothing happened. On desktop the three columns share one bounded
		// height, so the fields are already on screen and this is a no-op.
		if (!selectedDoc || !browser || window.matchMedia('(min-width: 1024px)').matches) return;
		void tick().then(() => scrollIntoViewport('[data-testid="db-doc-fields"]'));
	}

	/**
	 * Scroll an element into view inside the shell's ScrollArea viewport, NEVER
	 * the window: the app shell is viewport-height, and window scrolling shoves
	 * the layout past the mobile tab bar.
	 */
	function scrollIntoViewport(selector: string) {
		const target = document.querySelector(selector);
		if (!(target instanceof HTMLElement)) return;
		const viewport = target.closest('[data-slot="scroll-area-viewport"]');
		if (!(viewport instanceof HTMLElement)) return;
		const top =
			target.getBoundingClientRect().top -
			viewport.getBoundingClientRect().top +
			viewport.scrollTop;
		viewport.scrollTo({ top: Math.max(0, top - 12), behavior: 'smooth' });
	}

	// Keep the snapshot in sync with the load, but only reset the browser when
	// the PROJECT actually changes - on first mount this effect runs after
	// onMount, and resetting then would wipe the ?collection= restore.
	// svelte-ignore state_referenced_locally
	let lastProject = data.projectId;
	$effect(() => {
		overview = data.overview;
		agentState = data.overview.state;
		if (data.projectId !== lastProject) {
			lastProject = data.projectId;
			closeBrowser();
		}
	});

	// Realtime: connect to this project's DbAgent. In dev the agent worker runs
	// on :8789; in production /agents/* is proxied by hooks.server.ts.
	$effect(() => {
		const projectId = data.projectId;
		const client = new AgentClient<DbAgentState>({
			agent: 'db-agent',
			name: projectId,
			host: dev ? 'localhost:8789' : window.location.host,
			onStateUpdate: (state) => {
				agentState = state;
				void refreshData(projectId);
			}
		});
		client.addEventListener('open', () => (live = true));
		client.addEventListener('close', () => (live = false));

		// Polling safety net for when the WebSocket can't connect.
		const poll = setInterval(() => void refreshData(projectId), 5_000);

		return () => {
			clearInterval(poll);
			client.close();
		};
	});

	/** Refetch the overview and, if a collection is open, its documents. */
	async function refreshData(projectId: string) {
		try {
			const response = await fetch(`/api/projects/${projectId}/db/overview`);
			if (projectId !== data.projectId) return;
			if (response.ok) {
				overview = await response.json();
				agentState = overview.state;
			}
		} catch {
			// agent unreachable - keep last snapshot
		}
		if (selected) void loadDocuments(selected);
	}

	async function loadDocuments(collection: string, page = docDesiredPage) {
		docDesiredPage = page;
		const seq = ++docsLoadSeq;
		const cursor = docPageCursors[page];
		try {
			const response = await fetch(`/api/projects/${data.projectId}/db/admin/query`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				// orderBy addresses the JSON data only (createdAt is metadata), so
				// the browser takes the agent's default order: document id.
				body: JSON.stringify({
					collection,
					query: { limit: DOC_PAGE_SIZE, ...(cursor ? { cursor } : {}) }
				})
			});
			if (selected !== collection || seq !== docsLoadSeq) return;
			const result = (await response.json().catch(() => null)) as
				(DbQueryResult & { error?: string }) | null;
			if (selected !== collection || seq !== docsLoadSeq) return;
			if (!response.ok || !result) {
				throw new Error(result?.error ?? `request failed (HTTP ${response.status})`);
			}
			// Deletions can empty the page the operator is standing on; fall back
			// to the first page rather than showing "no documents" for a
			// collection that still has plenty. Page 0 is the base case, so this
			// recurses at most once.
			if (result.docs.length === 0 && page > 0) {
				resetDocPaging();
				await loadDocuments(collection, 0);
				return;
			}
			documents = result.docs;
			docPage = page;
			docsNextCursor = result.nextCursor ?? null;
			// Remember where the next page starts, and forget pages that no longer
			// exist so Next cannot walk past the end after a delete.
			if (result.nextCursor) docPageCursors[page + 1] = result.nextCursor;
			else docPageCursors = docPageCursors.slice(0, page + 1);
			if (selectedDoc && !result.docs.some((doc) => doc.id === selectedDoc)) {
				selectedDoc = null;
			}
			docsError = null;
		} catch (error) {
			if (selected !== collection || seq !== docsLoadSeq) return;
			docsError = error instanceof Error ? error.message : String(error);
		} finally {
			if (selected === collection && seq === docsLoadSeq) docsLoaded = true;
		}
	}

	function closeBrowser() {
		selected = null;
		selectedDoc = null;
		documents = [];
		resetDocPaging();
		docsLoaded = false;
		docsError = null;
		actionError = null;
		editorOpen = false;
		docError = null;
		deletePanelOpen = false;
		deleteConfirmInput = '';
		deleteError = null;
		importReport = null;
		importError = null;
		rollbackOpen = false;
		persistQueryParam('collection', null);
	}

	function selectCollection(name: string, options: { persist?: boolean } = {}) {
		if (selected === name) {
			closeBrowser();
			return;
		}
		closeBrowser();
		selected = name;
		if (options.persist !== false) persistQueryParam('collection', name);
		void loadDocuments(name, 0);
		// The documents card mounts below the collections grid - off-screen on
		// phones, where a tap would otherwise appear to do nothing.
		void tick().then(() => scrollIntoViewport('[data-testid="db-documents-card"]'));
	}

	// Collection create / access-mode configuration. Both go through the same
	// PUT /admin/collections/:name upsert on the agent.
	const accessModes: DbAccessMode[] = ['public', 'auth', 'owner', 'none'];

	// Permission keys actually granted by this project's roles (Auth > Roles):
	// the permission selects offer real grants instead of free-typed text.
	// Sentinel because a Select item cannot carry the empty string.
	const NO_PERMISSION = '__none__';
	let projectPermissions = $state<string[]>([]);

	async function loadPermissions() {
		try {
			const response = await fetch(`/api/projects/${data.projectId}/overview`);
			if (!response.ok) return;
			const overview = (await response.json()) as {
				state?: { roles?: { permissions: string[] }[] };
			};
			const keys: Record<string, true> = {};
			for (const role of overview.state?.roles ?? []) {
				for (const key of role.permissions) keys[key] = true;
			}
			projectPermissions = Object.keys(keys).sort();
		} catch {
			// the selects still offer none + whatever is already stored
		}
	}

	/** Registry keys plus the stored value (in case its role was deleted). */
	function permissionOptions(current: string): string[] {
		const keys: Record<string, true> = {};
		for (const key of projectPermissions) keys[key] = true;
		if (current.trim()) keys[current.trim()] = true;
		return Object.keys(keys).sort();
	}

	function toAccessMode(value: string): DbAccessMode {
		const parsed = dbAccessModeSchema.safeParse(value);
		return parsed.success ? parsed.data : 'owner';
	}

	async function saveCollectionConfig(
		name: string,
		config: {
			readAccess: DbAccessMode;
			writeAccess: DbAccessMode;
			// Omitted = unchanged on the agent; explicit null clears.
			readPermission?: string | null;
			writePermission?: string | null;
			validator?: DbValidator | null;
			replication?: DbReplicationMode;
		}
	): Promise<string | null> {
		try {
			const response = await fetch(
				`/api/projects/${data.projectId}/db/admin/collections/${encodeURIComponent(name)}`,
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(config)
				}
			);
			if (!response.ok) {
				const result = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(result?.error ?? `request failed (HTTP ${response.status})`);
			}
			await refreshData(data.projectId);
			return null;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	}

	let newCollectionName = $state('');
	let newReadAccess = $state<DbAccessMode>('public');
	let newWriteAccess = $state<DbAccessMode>('owner');
	let createError = $state<string | null>(null);

	async function createCollection(event: SubmitEvent) {
		event.preventDefault();
		createError = null;
		const name = newCollectionName.trim().toLowerCase();
		// Same rule the agent enforces, validated locally for a readable error.
		if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name)) {
			createError = 'Collection names are lowercase letters, digits, _ and - (max 64 chars).';
			return;
		}
		// The agent route is an upsert on purpose (the Access tab reuses it);
		// the CREATE form must not silently reconfigure an existing collection.
		if (agentState.collections.some((collection) => collection.name === name)) {
			createError = `Collection "${name}" already exists - click its row to browse it, or change its rules under Access.`;
			return;
		}
		busy = true;
		createError = await saveCollectionConfig(name, {
			readAccess: newReadAccess,
			writeAccess: newWriteAccess
		});
		busy = false;
		if (!createError) newCollectionName = '';
	}

	// Access tab: pending edits per collection, applied explicitly per row.
	// Permission keys ride along with the modes ('' = none); the validator is
	// edited in its own dialog and deliberately NOT sent by Apply (omitted =
	// unchanged on the agent), so the two saves cannot clobber each other.
	type AccessEdit = {
		readAccess: DbAccessMode;
		writeAccess: DbAccessMode;
		readPermission: string;
		writePermission: string;
		replication: DbReplicationMode;
	};
	let accessEdits = $state<Record<string, AccessEdit>>({});
	let accessFeedback = $state<Record<string, { ok: boolean; message: string }>>({});

	function currentAccess(name: string): AccessEdit {
		const summary = agentState.collections.find((collection) => collection.name === name);
		return (
			accessEdits[name] ?? {
				readAccess: summary?.readAccess ?? 'owner',
				writeAccess: summary?.writeAccess ?? 'owner',
				readPermission: summary?.readPermission ?? '',
				writePermission: summary?.writePermission ?? '',
				replication: summary?.replication ?? 'auto'
			}
		);
	}

	function setAccessField<K extends keyof AccessEdit>(name: string, kind: K, value: AccessEdit[K]) {
		accessEdits[name] = { ...currentAccess(name), [kind]: value };
	}

	/**
	 * The teaching device of the Access tab: the current (possibly pending)
	 * configuration restated as one plain-English sentence, updated live as
	 * the selects change - so nobody has to decode mode names.
	 */
	function accessSentence(pending: AccessEdit, hasRules: boolean): string {
		const withKey = (key: string) => (key.trim() ? ` whose role grants ${key.trim()}` : '');
		const read =
			pending.readAccess === 'public'
				? 'anyone can read every document'
				: pending.readAccess === 'auth'
					? `any signed-in user${withKey(pending.readPermission)} can read every document`
					: pending.readAccess === 'none'
						? 'nothing can read this from your app - only this console, a service key, or the admin SDK'
						: `signed-in users${withKey(pending.readPermission)} can read only documents they created`;
		const write =
			pending.writeAccess === 'public'
				? 'anyone can create, edit, and delete documents'
				: pending.writeAccess === 'auth'
					? `any signed-in user${withKey(pending.writePermission)} can create, edit, and delete any document`
					: pending.writeAccess === 'none'
						? 'nothing can write from your app - this collection is read-only except from this console, a service key, or the admin SDK'
						: `signed-in users${withKey(pending.writePermission)} can create documents but edit or delete only their own`;
		const replication =
			pending.replication === 'auto'
				? ' Reads are served from a replica in the reader’s region.'
				: ' Replication is off - every read travels to the primary.';
		return `Read: ${read}. Write: ${write}.${hasRules ? ' New writes must also pass the document rules.' : ''}${replication}`;
	}

	async function applyAccess(name: string) {
		busy = true;
		const pending = currentAccess(name);
		const message = await saveCollectionConfig(name, {
			readAccess: pending.readAccess,
			writeAccess: pending.writeAccess,
			readPermission: pending.readPermission.trim() || null,
			writePermission: pending.writePermission.trim() || null,
			replication: pending.replication
		});
		busy = false;
		if (message) {
			accessFeedback[name] = { ok: false, message };
			return;
		}
		delete accessEdits[name];
		accessFeedback[name] = { ok: true, message: 'Saved' };
		setTimeout(() => {
			if (accessFeedback[name]?.ok) delete accessFeedback[name];
		}, 2_000);
	}

	// Rules-lite validator editor: JSON in a dialog, validated client-side
	// with the same schema shape the agent enforces.
	let rulesFor = $state<string | null>(null);
	let rulesJson = $state('');
	let rulesError = $state<string | null>(null);
	/** Only for EMPTY collections; anything with documents gets a template
	 * inferred from its real shape instead of a puzzling generic example. */
	const RULES_TEMPLATE = JSON.stringify(
		{ fields: { title: { type: 'string', required: true } }, additionalFields: 'allow' },
		null,
		2
	);

	function jsonTypeOf(value: unknown): DbFieldRule['type'] {
		if (value === null) return 'null';
		if (Array.isArray(value)) return 'array';
		const kind = typeof value;
		if (kind === 'string' || kind === 'number' || kind === 'boolean') return kind;
		return kind === 'object' ? 'object' : 'any';
	}

	/** Seed a validator from real documents: one rule per top-level field,
	 * typed when the type is consistent across the sample, required when
	 * every sampled document carries the field. Plain objects, not Map/Set -
	 * svelte/prefer-svelte-reactivity flags those even for pure local math. */
	function inferValidator(docs: DbDocument[]): DbValidator | null {
		const kindsByField: Record<string, Record<string, true>> = {};
		const seenIn: Record<string, number> = {};
		for (const doc of docs) {
			for (const [key, value] of Object.entries(doc.data)) {
				if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || value === undefined) continue;
				(kindsByField[key] ??= {})[jsonTypeOf(value)] = true;
				seenIn[key] = (seenIn[key] ?? 0) + 1;
			}
		}
		const fields: DbValidator['fields'] = {};
		for (const [key, kinds] of Object.entries(kindsByField).slice(0, 20)) {
			const kindNames = Object.keys(kinds);
			fields[key] = {
				type: kindNames.length === 1 ? (kindNames[0] as DbFieldRule['type']) : 'any',
				required: seenIn[key] === docs.length
			};
		}
		return Object.keys(fields).length ? { fields, additionalFields: 'allow' } : null;
	}

	async function openRules(name: string) {
		const summary = agentState.collections.find((collection) => collection.name === name);
		rulesError = null;
		rulesFor = name;
		if (summary?.validator) {
			rulesJson = JSON.stringify(summary.validator, null, 2);
			return;
		}
		// No rules yet: propose a starting point from the live documents.
		rulesJson = RULES_TEMPLATE;
		try {
			const response = await fetch(`/api/projects/${data.projectId}/db/admin/query`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ collection: name, query: { limit: 20 } })
			});
			const result = (await response.json().catch(() => null)) as DbQueryResult | null;
			if (rulesFor !== name || !response.ok || !result?.docs.length) return;
			const inferred = inferValidator(result.docs);
			if (inferred) rulesJson = JSON.stringify(inferred, null, 2);
		} catch {
			// keep the generic template
		}
	}

	async function saveRules(clear: boolean) {
		const name = rulesFor;
		if (!name) return;
		let validator: DbValidator | null = null;
		if (!clear) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(rulesJson);
			} catch (error) {
				rulesError = `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
				return;
			}
			const checked = dbValidatorSchema.safeParse(parsed);
			if (!checked.success) {
				rulesError = checked.error.issues
					.map((issue) => `${issue.path.join('.') || 'validator'}: ${issue.message}`)
					.join('; ');
				return;
			}
			validator = checked.data;
		}
		busy = true;
		const current = currentAccess(name);
		const message = await saveCollectionConfig(name, {
			readAccess: current.readAccess,
			writeAccess: current.writeAccess,
			validator
		});
		busy = false;
		if (message) {
			rulesError = message;
			return;
		}
		rulesFor = null;
	}

	// Export / import: operator surfaces over the admin proxy.
	const adminBase = $derived(`/api/projects/${data.projectId}/db/admin/collections`);
	let importBusy = $state(false);
	let importReport = $state<DbImportReport | null>(null);
	let importError = $state<string | null>(null);
	let importInput = $state<HTMLInputElement | null>(null);

	async function importFile(event: Event) {
		const collection = selected;
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!collection || !file) return;
		importBusy = true;
		importError = null;
		importReport = null;
		try {
			const response = await fetch(`${adminBase}/${encodeURIComponent(collection)}/import`, {
				method: 'POST',
				headers: { 'content-type': 'application/x-ndjson' },
				body: await file.text()
			});
			const result = (await response.json().catch(() => null)) as
				(DbImportReport & { error?: string }) | null;
			if (!response.ok || !result) {
				throw new Error(result?.error ?? `request failed (HTTP ${response.status})`);
			}
			importReport = result;
			await refreshData(data.projectId);
		} catch (error) {
			importError = error instanceof Error ? error.message : String(error);
		} finally {
			importBusy = false;
			if (importInput) importInput.value = '';
		}
	}

	// Point-in-time rollback: the D1-style flow lives in the shared
	// rollback-dialog.svelte (the Tables workspace mounts its own instance).
	let rollbackOpen = $state(false);

	function openRollback() {
		rollbackOpen = true;
	}

	// Inline document editor (PUT replaces an existing id, so it doubles as edit).
	let editorOpen = $state(false);
	let docIdInput = $state('');
	let docJsonInput = $state('{ "title": "Ship it", "done": false }');
	let docError = $state<string | null>(null);

	// Collection deletion is destructive enough that confirm() is not enough:
	// the collection name must be typed back before the button arms.
	let deletePanelOpen = $state(false);
	let deleteConfirmInput = $state('');
	let deleteError = $state<string | null>(null);

	async function deleteCollection() {
		const name = selected;
		if (!name || deleteConfirmInput.trim() !== name) return;
		busy = true;
		deleteError = null;
		try {
			const response = await fetch(
				`/api/projects/${data.projectId}/db/admin/collections/${encodeURIComponent(name)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const result = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(result?.error ?? `request failed (HTTP ${response.status})`);
			}
			closeBrowser();
			await refreshData(data.projectId);
		} catch (error) {
			deleteError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	/**
	 * Open the editor prefilled from a row. The id is locked in this mode:
	 * PUT is an upsert, so saving under a changed id would create a duplicate
	 * instead of renaming.
	 */
	let editingExisting = $state(false);
	function editDocument(doc: DbDocument) {
		docIdInput = doc.id;
		docJsonInput = JSON.stringify(doc.data, null, 2);
		docError = null;
		editingExisting = true;
		editorOpen = true;
	}

	async function saveDocument(event: SubmitEvent) {
		event.preventDefault();
		const collection = selected;
		if (!collection) return;
		docError = null;
		let parsed: unknown;
		try {
			parsed = JSON.parse(docJsonInput);
		} catch (error) {
			docError = `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
			return;
		}
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			docError = 'Document data must be a JSON object.';
			return;
		}
		busy = true;
		try {
			const id = docIdInput.trim() || uuidv7();
			// ADD refuses a taken id (409) so a typo cannot silently overwrite;
			// EDIT keeps the deliberate replace semantics.
			const guard = editingExisting ? '' : '?ifAbsent=1';
			const response = await fetch(
				`/api/projects/${data.projectId}/db/admin/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}${guard}`,
				{
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ data: parsed })
				}
			);
			if (!response.ok) {
				const result = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(result?.error ?? `request failed (HTTP ${response.status})`);
			}
			editorOpen = false;
			docIdInput = '';
			await refreshData(data.projectId);
		} catch (error) {
			docError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	// Deleting a document is confirmed in the app's own dialog rather than a
	// native confirm(): it can show WHICH document is about to go, and it keeps
	// its error where the rest of the browser's errors live.
	let deleteDocOpen = $state(false);
	let deleteDocTarget = $state<string | null>(null);
	const deleteDocPreview = $derived(documents.find((doc) => doc.id === deleteDocTarget) ?? null);

	function confirmDeleteDocument(id: string) {
		deleteDocTarget = id;
		actionError = null;
		deleteDocOpen = true;
	}

	async function deleteDocument() {
		const collection = selected;
		const id = deleteDocTarget;
		if (!collection || !id) return;
		busy = true;
		actionError = null;
		try {
			const response = await fetch(
				`/api/projects/${data.projectId}/db/admin/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`,
				{ method: 'DELETE' }
			);
			if (!response.ok) {
				const result = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(result?.error ?? `request failed (HTTP ${response.status})`);
			}
			deleteDocOpen = false;
			deleteDocTarget = null;
			if (selectedDoc === id) selectedDoc = null;
			await refreshData(data.projectId);
		} catch (error) {
			actionError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	/** Firestore names the JSON shapes it shows; documents are schemaless, so
	 * the type is inferred per field rather than declared anywhere. */
	function fieldType(value: unknown): string {
		if (value === null) return 'null';
		if (Array.isArray(value)) return 'array';
		if (typeof value === 'object') return 'map';
		return typeof value;
	}

	/** One line of value: strings as themselves, everything else as JSON. */
	function fieldPreview(value: unknown): string {
		const text = typeof value === 'string' ? value : JSON.stringify(value);
		return text.length > 160 ? `${text.slice(0, 160)}…` : text;
	}

	function timeAgo(iso: string): string {
		const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
		if (seconds < 5) return 'just now';
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	// The feed carries both engines, so browsing collections used to surface
	// table traffic (and the reverse). Each tool page renders only its own half:
	// `project.*` belongs to neither engine, so it rides with collections (the
	// default page) rather than being duplicated or dropped.
	const isTableEvent = (event: DbActivityEvent) =>
		event.type.startsWith('table.') || event.type.startsWith('rows.');
	const tableEvents = $derived(agentState.events.filter(isTableEvent));
	const collectionEvents = $derived(agentState.events.filter((event) => !isTableEvent(event)));

	const stats = $derived([
		{
			id: 'collections',
			label: 'Collections',
			value: agentState.collections.length,
			icon: Database
		},
		{ id: 'documents', label: 'Documents', value: agentState.totalDocs, icon: FileText },
		{
			id: 'activity',
			label: 'Last activity',
			value: agentState.lastEventAt ? timeAgo(agentState.lastEventAt) : '—',
			icon: Activity
		}
	]);

	// Integration snippets. page.url.origin is SSR-safe, so these render
	// without a hydration flash. CodeExample shape feeds the shared
	// CodeExamples component (shiki highlighting + copy), same as the auth tab.
	const origin = $derived(page.url.origin);
	const dbBase = $derived(`${origin}/api/projects/${data.projectId}/db`);
	const snippets = $derived<CodeExample[]>([
		{
			id: 'rest',
			label: 'REST',
			lang: 'bash',
			code: `# A project JWT for the SIGNED-IN USER. There is no ambient API key:
# the caller's own session is what mints it - a cookie in a browser, or a
# bearer session token anywhere else (what a server relays; see Server tab).
curl ${origin}/api/projects/${data.projectId}/auth/token \\
  -H 'authorization: Bearer <session-token>'

# Create a document (owner comes from the token subject)
curl -X POST ${dbBase}/collections/posts/documents \\
  -H 'authorization: Bearer <token>' \\
  -H 'content-type: application/json' \\
  -d '{"data":{"title":"Show HN: I built a Firebase on Cloudflare","votes":1}}'`
		},
		{
			id: 'sdk',
			label: 'Client SDK',
			lang: 'typescript',
			code: `import { createDbClient } from '@frostbase/db/client';

// IN THE BROWSER. This fetch sends no Authorization header - it works
// because the browser attaches the signed-in user's session cookie, so the
// token you get back is THAT USER's. On a server there is no cookie jar and
// no signed-in user, so this same call answers 401: see the Server tab.
const db = createDbClient({
	baseUrl: '${dbBase}',
	getToken: async () => {
		const response = await fetch('${origin}/api/projects/${data.projectId}/auth/token');
		return (await response.json()).token;
	}
});

const posts = db.collection('posts');
await posts.create({ title: 'Show HN: I built a Firebase on Cloudflare', votes: 1 });

// Server-side aggregates and NDJSON export
const total = await posts.count();
const { votes } = await posts.aggregate({ aggregates: { votes: { op: 'sum', field: 'votes' } } });

// The front page re-ranks itself on every vote, on every open screen.
const unsubscribe = posts.subscribe(
	{ orderBy: [{ field: 'votes', direction: 'desc' }], limit: 25 },
	{
		onSnapshot: (docs) => render(docs),
		onChange: (change, docs) => render(docs)
	}
);`
		},
		{
			id: 'ssr',
			label: 'Server (SSR)',
			lang: 'typescript',
			code: `import { createDbClient } from '@frostbase/db/client';

// ON A SERVER there is no ambient session, so you RELAY the identity the
// user already sent you: /auth/token accepts the session cookie or a bearer
// session token. You are not authenticating your server - you are acting as
// that signed-in user, with exactly their access.
export async function load({ request }) {
	const db = createDbClient({
		baseUrl: '${dbBase}',
		getToken: async () => {
			const response = await fetch('${origin}/api/projects/${data.projectId}/auth/token', {
				headers: { cookie: request.headers.get('cookie') ?? '' }
			});
			if (!response.ok) return null; // not signed in - public data still reads
			return (await response.json()).token;
		}
	});

	return { posts: await db.collection('posts').query({ limit: 25 }) };
}

// NO USER AT ALL - a cron, a queue consumer, a Stripe webhook, a seed
// script? There is nobody to relay, so none of the above applies. That is
// what an admin service key is for: see the Admin service key tab.`
		},
		{
			id: 'service-key',
			label: 'Admin service key',
			lang: 'typescript',
			code: `import { createDbAdmin } from '@frostbase/db/admin';

// SERVER ONLY. An admin service key is admin-grade over this project's whole
// data plane: it bypasses access modes, validators, and permission keys, exactly
// like the operator session it stands in for. Mint one under Settings - it
// is shown once, and it is scoped to THIS project, not to sibling branches.
//
// Two guards make a leak fail loudly instead of silently: this client
// refuses to construct in a browser, and the API refuses ANY request
// carrying an Origin header. A key pasted into frontend code breaks at your
// desk rather than shipping inside a JS bundle on a CDN.
const db = createDbAdmin({
	url: '${origin}',
	projectId: '${data.projectId}',
	key: process.env.FROSTBASE_SERVICE_KEY
});

// No user, no session, no token to relay.
const post = await db.collection('posts').get(id);
await db.collection('posts').patch(id, { votes: post.data.votes + 1 });

const { docs } = await db.collection('posts').query({ limit: 25 });
await db.table('orders').sql('SELECT * FROM orders WHERE id = ?', [id]);

// url, projectId, and key all fall back to FROSTBASE_URL /
// FROSTBASE_PROJECT / FROSTBASE_SERVICE_KEY, so on a server that
// already has them this is just createDbAdmin().
//
// Inside a Worker there is no global process - secrets arrive on env:
//   createDbAdmin({ env });`
		},
		{
			id: 'tables',
			label: 'SQL tables',
			lang: 'typescript',
			code: `import { createDbClient } from '@frostbase/db/client';

const db = createDbClient({
	baseUrl: '${dbBase}',
	getToken: async () => {
		const response = await fetch('${origin}/api/projects/${data.projectId}/auth/token');
		return (await response.json()).token;
	}
});

// Typed rows on a declared schema - the same handle surface as collections.
const todos = db.table<{ title: string; done: boolean }>('todos');
await todos.create({ title: 'ship it', done: false });

// Tables have live queries too: typed rows, same frames, same socket.
todos.subscribe(
	{ where: [{ field: 'done', op: '==', value: false }] },
	{ onSnapshot: (rows) => render(rows), onChange: (change, rows) => render(rows) }
);`
		},
		{
			id: 'drizzle',
			label: 'Drizzle',
			lang: 'typescript',
			code: `import { drizzleTable } from '@frostbase/db/drizzle';
import { desc } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// \`frostbase schema generate\` emits this from your declared columns.
const todos = sqliteTable('todos', {
	id: text('id').primaryKey(),
	title: text('title').notNull(),
	votes: integer('votes')
});

// Real SQL over the gated /tables/todos/sql endpoint - a project JWT is
// required; the gate keeps statements single-table and DDL-free.
const db = drizzleTable({
	baseUrl: '${dbBase}',
	table: 'todos',
	getToken: async () => {
		const response = await fetch('${origin}/api/projects/${data.projectId}/auth/token');
		return (await response.json()).token;
	}
});
await db.insert(todos).values({ id: '1', title: 'ship it' });
const top = await db.select().from(todos).orderBy(desc(todos.votes)).limit(10);`
		},
		{
			id: 'ws',
			label: 'Raw WebSocket',
			lang: 'javascript',
			code: `const ws = new WebSocket(
	'${origin.replace(/^http/, 'ws')}/agents/db-agent/${data.projectId}/collections/posts/subscribe'
);
ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', id: 'q1', query: { limit: 50 } }));
ws.onmessage = (event) => console.log(JSON.parse(event.data));
// -> { type: 'snapshot', ... } once, then { type: 'change', kind: 'added' | 'modified' | 'removed', ... }`
		}
	]);
</script>

<svelte:head>
	<title>{data.projectId} · Database · Frostbase</title>
	<!-- No project id: the console is noindex, so the only consumer of this is a
	     link unfurler, and that card must not name a project. -->
	<meta
		name="description"
		content="Browse collections and documents, tune access modes, and connect apps to your database."
	/>
</svelte:head>

<div
	class="mx-auto max-w-7xl space-y-5 px-3 py-5 sm:space-y-6 sm:px-6 sm:py-8"
	data-testid="db-page"
	data-hydrated={hydrated}
>
	<ToolTabs items={toolTabs} />

	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold">{toolMeta[activeTab]?.title ?? 'Database'}</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				{toolMeta[activeTab]?.blurb}
			</p>
		</div>
		<Badge variant="outline" class="gap-1.5" data-testid="connection-status">
			<span
				class={[
					'h-1.5 w-1.5 rounded-full',
					live ? 'animate-pulse bg-emerald-500' : 'bg-muted-foreground/40'
				]}
			></span>
			{live ? 'realtime' : 'polling'}
		</Badge>
	</div>

	<div>
		<!-- COLLECTIONS -->
		{#if activeTab === 'collections'}
			<div class="mt-4 space-y-5 sm:space-y-6">
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
					{#each stats as stat (stat.id)}
						<Card.Root class="py-4" data-testid={`db-stat-${stat.id}`}>
							<Card.Content class="flex items-center justify-between gap-2 px-3 sm:px-5">
								<div>
									<p class="text-xs tracking-wide text-muted-foreground uppercase">{stat.label}</p>
									<p class="mt-1 text-2xl font-semibold tabular-nums" data-testid="stat-value">
										{stat.value}
									</p>
								</div>
								<div
									class="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary min-[360px]:flex"
								>
									<stat.icon class="h-4.5 w-4.5" strokeWidth={1.8} />
								</div>
							</Card.Content>
						</Card.Root>
					{/each}
				</div>

				<!-- Firestore-style Miller-column browser: collections | documents |
				     fields, with the breadcrumb path across the top. -->
				<Card.Root class="min-w-0" data-testid="db-documents-card">
					<Card.Header class="border-b">
						<Card.Title class="flex min-w-0 items-center gap-1.5 font-mono text-sm font-normal">
							<Database class="h-4 w-4 shrink-0 text-primary" />
							<button
								type="button"
								class="text-muted-foreground transition-colors hover:text-foreground"
								onclick={closeBrowser}
							>
								{data.projectId}
							</button>
							{#if selected}
								<ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								<span class="truncate font-medium">{selected}</span>
							{/if}
							{#if selectedDocData}
								<ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								<span class="truncate text-muted-foreground">{selectedDocData.id}</span>
							{/if}
						</Card.Title>
					</Card.Header>
					<Card.Content class="p-0">
						<div
							class="grid grid-cols-1 max-lg:divide-y lg:h-[34rem] lg:grid-cols-[minmax(13rem,0.9fr)_minmax(0,1.1fr)_minmax(0,1.4fr)] lg:grid-rows-1 lg:divide-x"
						>
							<!-- Column 1: collections -->
							<div class="flex min-w-0 flex-col">
								<div class="flex items-center justify-between border-b px-3 py-2">
									<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
										Collections
									</span>
									<span class="text-xs text-muted-foreground tabular-nums">
										{agentState.collections.length}
									</span>
								</div>
								<div
									class="min-h-0 flex-1 overflow-y-auto p-1.5 max-lg:max-h-[22rem]"
									data-testid="db-collections-table"
								>
									{#if agentState.collections.length === 0}
										<div
											class="flex flex-col items-center gap-2 px-2 py-6 text-center text-sm text-muted-foreground"
										>
											<Database class="h-5 w-5 opacity-60" />
											No collections yet - create the first one below.
										</div>
									{:else}
										{#each agentState.collections as collection (collection.name)}
											<button
												type="button"
												class={[
													'flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-1.5 text-left text-[13px] transition-colors',
													selected === collection.name
														? 'bg-muted font-medium text-foreground'
														: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
												]}
												data-testid={`db-collection-${collection.name}`}
												onclick={() => selectCollection(collection.name)}
											>
												<span
													class={[
														'h-4 w-0.5 shrink-0 rounded-full',
														selected === collection.name ? 'bg-primary' : 'bg-transparent'
													]}
												></span>
												<Database
													class={[
														'h-3.5 w-3.5 shrink-0',
														selected === collection.name && 'text-primary'
													]}
												/>
												<span class="min-w-0 flex-1 truncate font-mono">{collection.name}</span>
												<span class="text-[11px] tabular-nums opacity-70">{collection.docs}</span>
												{#if selected === collection.name}
													<ChevronRight class="h-3.5 w-3.5 shrink-0" />
												{/if}
											</button>
										{/each}
									{/if}
								</div>

								<form
									class="flex flex-wrap items-end gap-2 border-t p-3"
									data-testid="db-create-collection"
									onsubmit={createCollection}
								>
									<div class="min-w-40 flex-1 space-y-2">
										<Label for="new-collection-name">New collection</Label>
										<Input
											id="new-collection-name"
											class="font-mono"
											placeholder="collection name…"
											bind:value={newCollectionName}
										/>
									</div>
									<div class="space-y-2">
										<Label>Read</Label>
										<Select.Root
											type="single"
											value={newReadAccess}
											onValueChange={(value) => (newReadAccess = toAccessMode(value))}
										>
											<Select.Trigger
												class="min-w-24 font-mono"
												size="sm"
												aria-label="Read access for the new collection"
											>
												{newReadAccess}
											</Select.Trigger>
											<Select.Content>
												{#each accessModes as mode (mode)}
													<Select.Item value={mode} label={mode} class="font-mono" />
												{/each}
											</Select.Content>
										</Select.Root>
									</div>
									<div class="space-y-2">
										<Label>Write</Label>
										<Select.Root
											type="single"
											value={newWriteAccess}
											onValueChange={(value) => (newWriteAccess = toAccessMode(value))}
										>
											<Select.Trigger
												class="min-w-24 font-mono"
												size="sm"
												aria-label="Write access for the new collection"
											>
												{newWriteAccess}
											</Select.Trigger>
											<Select.Content>
												{#each accessModes as mode (mode)}
													<Select.Item value={mode} label={mode} class="font-mono" />
												{/each}
											</Select.Content>
										</Select.Root>
									</div>
									<Button type="submit" size="sm" class="gap-1.5" disabled={busy}>
										<Plus class="h-4 w-4" /> Create
									</Button>
									{#if createError}
										<p class="basis-full text-sm text-destructive" data-testid="db-create-error">
											{createError}
										</p>
									{/if}
								</form>
							</div>

							<!-- Column 2: documents of the selected collection -->
							<div class="flex min-w-0 flex-col">
								{#if selected}
									<div class="flex items-center justify-between gap-1 border-b px-3 py-1.5">
										<span
											class="min-w-0 truncate text-xs font-medium tracking-wide text-muted-foreground uppercase"
										>
											Documents
										</span>
										<div class="flex shrink-0 items-center">
											<Button
												variant="ghost"
												size="icon"
												class="h-7 w-7"
												data-testid="db-add-document"
												aria-label="Add document"
												onclick={() => {
													editorOpen = !editorOpen;
													editingExisting = false;
													docIdInput = '';
													docError = null;
												}}
											>
												<Plus class="h-4 w-4" />
											</Button>
											<input
												bind:this={importInput}
												type="file"
												accept=".ndjson,.jsonl,.txt,application/x-ndjson"
												class="hidden"
												onchange={importFile}
											/>
											<Button
												variant="ghost"
												size="icon"
												class="h-7 w-7"
												data-testid="db-rollback"
												aria-label="Roll back in time"
												onclick={openRollback}
											>
												<History class="h-4 w-4" />
											</Button>
											<DropdownMenu.Root>
												<DropdownMenu.Trigger>
													{#snippet child({ props })}
														<Button
															{...props}
															variant="ghost"
															size="icon"
															class="h-7 w-7"
															aria-label="More collection actions"
															data-testid="db-actions-menu"
														>
															<EllipsisVertical class="h-4 w-4" />
														</Button>
													{/snippet}
												</DropdownMenu.Trigger>
												<DropdownMenu.Content align="end">
													<DropdownMenu.Item
														data-testid="db-export"
														onclick={() =>
															selected &&
															(window.location.href = `${adminBase}/${encodeURIComponent(selected)}/export`)}
													>
														<Download class="h-4 w-4" /> Export NDJSON
													</DropdownMenu.Item>
													<DropdownMenu.Item
														data-testid="db-import"
														disabled={importBusy}
														onclick={() => importInput?.click()}
													>
														<Upload class="h-4 w-4" />
														{importBusy ? 'Importing…' : 'Import NDJSON'}
													</DropdownMenu.Item>
													<DropdownMenu.Separator />
													<DropdownMenu.Item
														variant="destructive"
														data-testid="db-delete-collection"
														onclick={() => {
															deletePanelOpen = true;
															deleteConfirmInput = '';
															deleteError = null;
														}}
													>
														<Trash2 class="h-4 w-4" /> Delete
													</DropdownMenu.Item>
												</DropdownMenu.Content>
											</DropdownMenu.Root>
											<Button
												variant="ghost"
												size="icon"
												class="h-7 w-7"
												aria-label="Close document browser"
												onclick={closeBrowser}
											>
												<X class="h-4 w-4" />
											</Button>
										</div>
									</div>

									{#if editorOpen}
										<form
											class="space-y-3 border-b bg-muted/20 p-3"
											data-testid="db-doc-editor"
											onsubmit={saveDocument}
										>
											<div class="space-y-2">
												<Label for="doc-id">
													{editingExisting
														? 'Document id (fixed while editing)'
														: 'Document id (optional)'}
												</Label>
												<!-- Locked during edit: PUT is an upsert, so a changed id would
												     CREATE a second document and leave the original behind. -->
												<Input
													id="doc-id"
													class="font-mono"
													placeholder="auto-generated"
													disabled={editingExisting}
													bind:value={docIdInput}
												/>
											</div>
											<div class="space-y-2">
												<Label for="doc-json">Data (JSON object)</Label>
												<Textarea
													id="doc-json"
													class="min-h-28 font-mono text-xs"
													bind:value={docJsonInput}
												/>
											</div>
											{#if docError}
												<p class="text-sm text-destructive" data-testid="db-doc-error">
													{docError}
												</p>
											{/if}
											<div class="flex gap-2">
												<Button type="submit" size="sm" disabled={busy}>Save document</Button>
												<Button
													type="button"
													variant="ghost"
													size="sm"
													onclick={() => (editorOpen = false)}
												>
													Cancel
												</Button>
											</div>
										</form>
									{/if}

									<div
										class="min-h-0 flex-1 overflow-y-auto p-1.5 max-lg:max-h-[22rem]"
										data-testid="db-documents-table"
									>
										{#if actionError}
											<p class="px-2 py-1 text-sm text-destructive" data-testid="db-action-error">
												{actionError}
											</p>
										{/if}
										{#if docsError}
											<p class="px-2 py-1 text-sm text-destructive" data-testid="db-docs-error">
												{docsError}
											</p>
										{/if}
										{#if importError}
											<p class="px-2 py-1 text-sm text-destructive" data-testid="db-import-error">
												{importError}
											</p>
										{/if}
										{#if importReport}
											<p
												class="px-2 py-1 text-sm text-muted-foreground"
												data-testid="db-import-result"
											>
												Imported {importReport.imported} new and replaced {importReport.updated} documents{importReport
													.errors.length
													? `; ${importReport.errors.length} lines failed (first: line ${importReport.errors[0].line} - ${importReport.errors[0].error})`
													: '.'}
											</p>
										{/if}
										{#if !docsLoaded}
											<p class="py-6 text-center text-sm text-muted-foreground">
												Loading documents…
											</p>
										{:else if documents.length === 0}
											<div
												class="flex flex-col items-center gap-2 px-2 py-6 text-center text-sm text-muted-foreground"
											>
												<FileText class="h-5 w-5 opacity-60" />
												No documents yet.
												<Button
													variant="outline"
													size="sm"
													class="mt-1"
													onclick={() => {
														editorOpen = true;
														editingExisting = false;
														docIdInput = '';
														docError = null;
													}}
												>
													<Plus class="h-3.5 w-3.5" /> Add document
												</Button>
											</div>
										{:else}
											{#each documents as doc (doc.id)}
												<div
													class={[
														'group flex w-full items-center gap-1 rounded-md transition-colors',
														selectedDoc === doc.id ? 'bg-muted' : 'hover:bg-muted/50'
													]}
												>
													<button
														type="button"
														class="min-w-0 flex-1 px-2 py-1 text-left"
														title={doc.id}
														data-testid={`db-doc-${doc.id}`}
														onclick={() => selectDocument(doc.id)}
													>
														<span
															class={[
																'block truncate font-mono text-xs',
																selectedDoc === doc.id
																	? 'font-medium text-foreground'
																	: 'text-muted-foreground group-hover:text-foreground'
															]}
														>
															{doc.id}
														</span>
														<!-- Data preview line: keeps content assertions honest and the
														     list scannable without opening the third column. -->
														<span
															class="block truncate font-mono text-[10px] text-muted-foreground/70"
														>
															{JSON.stringify(doc.data)}
														</span>
													</button>
													<Button
														variant="ghost"
														size="icon"
														class="h-6 w-6 shrink-0 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-foreground max-lg:opacity-100"
														disabled={busy}
														aria-label={`Edit document ${doc.id}`}
														data-testid={`db-edit-${doc.id}`}
														onclick={() => editDocument(doc)}
													>
														<Pencil class="h-3 w-3" />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														class="mr-1 h-6 w-6 shrink-0 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-destructive max-lg:opacity-100"
														disabled={busy}
														aria-label={`Delete document ${doc.id}`}
														data-testid={`db-delete-${doc.id}`}
														onclick={() => confirmDeleteDocument(doc.id)}
													>
														<Trash2 class="h-3 w-3" />
													</Button>
													{#if selectedDoc === doc.id}
														<ChevronRight class="mr-1 h-3.5 w-3.5 shrink-0" />
													{/if}
												</div>
											{/each}
										{/if}
									</div>

									<!-- Keyset pager. The total is the registry's count, so the
									     range reads against the whole collection, not the page. -->
									{#if docsLoaded && (docPage > 0 || docsNextCursor || documents.length > 0)}
										<div
											class="flex shrink-0 items-center gap-2 border-t px-2.5 py-1.5 text-[11px] text-muted-foreground"
											data-testid="db-docs-pager"
										>
											<span class="tabular-nums" data-testid="db-docs-range">
												{docRangeStart}–{docRangeEnd} of {openCollectionDocs}
											</span>
											<div class="ml-auto flex items-center gap-0.5">
												<Button
													variant="ghost"
													size="icon"
													class="h-6 w-6"
													disabled={docPage === 0}
													aria-label="Previous page"
													data-testid="db-docs-prev"
													onclick={prevDocPage}
												>
													<ChevronLeft class="h-3.5 w-3.5" />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													class="h-6 w-6"
													disabled={!docsNextCursor}
													aria-label="Next page"
													data-testid="db-docs-next"
													onclick={nextDocPage}
												>
													<ChevronRight class="h-3.5 w-3.5" />
												</Button>
											</div>
										</div>
									{/if}
								{:else}
									<p class="m-auto px-4 py-10 text-center text-sm text-muted-foreground">
										Select a collection to browse its documents.
									</p>
								{/if}
							</div>

							<!-- Column 3: the selected document's fields, Firestore-style -
							     one row per field with its inferred type, then the metadata
							     the envelope keeps outside `data`. -->
							<div class="flex min-w-0 flex-col">
								{#if selectedDocData}
									{@const fields = Object.entries(selectedDocData.data)}
									<div class="flex items-center justify-between gap-2 border-b px-3 py-1.5">
										<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
											Fields
										</span>
										<div class="flex shrink-0 items-center gap-1.5">
											<span class="text-xs text-muted-foreground tabular-nums">
												{fields.length}
											</span>
											<Button
												variant="ghost"
												size="icon"
												class="h-7 w-7"
												aria-label={`Edit document ${selectedDocData.id}`}
												onclick={() => selectedDocData && editDocument(selectedDocData)}
											>
												<Pencil class="h-3.5 w-3.5" />
											</Button>
										</div>
									</div>
									<div
										class="min-h-0 flex-1 overflow-y-auto max-lg:max-h-[22rem]"
										data-testid="db-doc-fields"
									>
										{#if fields.length === 0}
											<p class="px-3 py-6 text-center text-sm text-muted-foreground">
												This document has no fields.
											</p>
										{:else}
											<dl class="divide-y">
												{#each fields as [field, value] (field)}
													<div class="px-3 py-2">
														<div class="flex items-baseline justify-between gap-2">
															<dt class="truncate font-mono text-xs font-medium">{field}</dt>
															<span
																class="shrink-0 rounded-sm bg-muted px-1.5 text-[10px] text-muted-foreground"
															>
																{fieldType(value)}
															</span>
														</div>
														<dd
															class="mt-0.5 font-mono text-xs break-all text-muted-foreground"
															title={JSON.stringify(value)}
														>
															{#if value === null}
																<span class="italic opacity-70">null</span>
															{:else}
																{fieldPreview(value)}
															{/if}
														</dd>
													</div>
												{/each}
											</dl>
										{/if}
										<dl
											class="space-y-1 border-t bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground"
										>
											<div class="flex items-baseline justify-between gap-2">
												<dt>id</dt>
												<dd class="truncate font-mono" title={selectedDocData.id}>
													{selectedDocData.id}
												</dd>
											</div>
											<div class="flex items-baseline justify-between gap-2">
												<dt>owner</dt>
												<dd class="truncate font-mono" title={selectedDocData.owner ?? undefined}>
													{selectedDocData.owner ?? '—'}
												</dd>
											</div>
											<div class="flex items-baseline justify-between gap-2">
												<dt>created</dt>
												<dd class="font-mono">{timeAgo(selectedDocData.createdAt)}</dd>
											</div>
											<div class="flex items-baseline justify-between gap-2">
												<dt>updated</dt>
												<dd class="font-mono">{timeAgo(selectedDocData.updatedAt)}</dd>
											</div>
										</dl>
									</div>
								{:else}
									<div
										class="m-auto flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground"
									>
										<FileText class="h-5 w-5 opacity-60" />
										{selected
											? 'Select a document to inspect its fields.'
											: 'Fields appear here once a document is open.'}
									</div>
								{/if}
							</div>
						</div>
					</Card.Content>
				</Card.Root>

				<ActivityCard events={collectionEvents} empty="No collection activity yet." />
			</div>
		{/if}

		<!-- ACCESS -->
		<!-- TABLES -->
		{#if activeTab === 'tables'}
			<TablesTab
				projectId={data.projectId}
				tables={agentState.tables ?? []}
				totalRows={agentState.totalRows ?? 0}
				events={tableEvents}
				{permissionOptions}
				refresh={() => refreshData(data.projectId)}
			/>
		{/if}

		{#if activeTab === 'replication'}
			<ReplicationTab
				projectId={data.projectId}
				collections={agentState.collections}
				tables={agentState.tables ?? []}
				agentLocation={overview.location}
			/>
		{/if}

		{#if activeTab === 'access'}
			<div class="mt-4">
				<Card.Root data-testid="db-access-modes">
					<Card.Header>
						<Card.Title>Access modes</Card.Title>
						<Card.Description class="space-y-1.5">
							<span class="block">
								Every collection has one read rule and one write rule.
								<span class="font-mono text-foreground">public</span> = no sign-in needed ·
								<span class="font-mono text-foreground">auth</span> = any signed-in user of this
								project · <span class="font-mono text-foreground">owner</span> = signed-in, and every
								document remembers who created it, so users only reach their own.
							</span>
							<span class="block">
								A permission key tightens auth/owner further: the user's role must grant that key.
								Roles and their permissions live under Auth &gt; Roles; the built-in admin role
								grants everything. Each row below explains itself in plain words as you change it.
							</span>
						</Card.Description>
					</Card.Header>
					<Card.Content>
						{#if agentState.collections.length === 0}
							<p
								class="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground"
							>
								No collections yet - create one under Collections.
							</p>
						{:else}
							<Table.Root class="min-w-[60rem]">
								<Table.Header>
									<Table.Row>
										<Table.Head>Collection</Table.Head>
										<Table.Head>Read</Table.Head>
										<Table.Head>Write</Table.Head>
										<Table.Head>Read permission</Table.Head>
										<Table.Head>Write permission</Table.Head>
										<Table.Head>Rules</Table.Head>
										<Table.Head>Replication</Table.Head>
										<Table.Head class="w-40 text-right">
											<span class="sr-only">Actions</span>
										</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each agentState.collections as collection (collection.name)}
										{@const feedback = accessFeedback[collection.name]}
										{@const pending = currentAccess(collection.name)}
										<Table.Row data-testid={`db-access-${collection.name}`}>
											<Table.Cell class="font-mono text-sm font-medium">
												{collection.name}
											</Table.Cell>
											<Table.Cell>
												<Select.Root
													type="single"
													value={pending.readAccess}
													onValueChange={(value) =>
														setAccessField(collection.name, 'readAccess', toAccessMode(value))}
												>
													<Select.Trigger
														class="min-w-24 font-mono"
														size="sm"
														disabled={busy}
														aria-label={`Read access for ${collection.name}`}
													>
														{pending.readAccess}
													</Select.Trigger>
													<Select.Content>
														{#each accessModes as mode (mode)}
															<Select.Item value={mode} label={mode} class="font-mono" />
														{/each}
													</Select.Content>
												</Select.Root>
											</Table.Cell>
											<Table.Cell>
												<Select.Root
													type="single"
													value={pending.writeAccess}
													onValueChange={(value) =>
														setAccessField(collection.name, 'writeAccess', toAccessMode(value))}
												>
													<Select.Trigger
														class="min-w-24 font-mono"
														size="sm"
														disabled={busy}
														aria-label={`Write access for ${collection.name}`}
													>
														{pending.writeAccess}
													</Select.Trigger>
													<Select.Content>
														{#each accessModes as mode (mode)}
															<Select.Item value={mode} label={mode} class="font-mono" />
														{/each}
													</Select.Content>
												</Select.Root>
											</Table.Cell>
											<Table.Cell>
												<Select.Root
													type="single"
													value={pending.readPermission || NO_PERMISSION}
													onValueChange={(value) =>
														setAccessField(
															collection.name,
															'readPermission',
															value === NO_PERMISSION ? '' : value
														)}
												>
													<Select.Trigger
														class="min-w-32 font-mono"
														size="sm"
														disabled={busy ||
															pending.readAccess === 'public' ||
															pending.readAccess === 'none'}
														aria-label={`Read permission for ${collection.name}`}
														data-testid={`db-perm-read-${collection.name}`}
													>
														{pending.readPermission || 'not required'}
													</Select.Trigger>
													<Select.Content>
														<Select.Item
															value={NO_PERMISSION}
															label="not required"
															class="font-mono"
														/>
														{#each permissionOptions(pending.readPermission) as key (key)}
															<Select.Item value={key} label={key} class="font-mono" />
														{/each}
													</Select.Content>
												</Select.Root>
											</Table.Cell>
											<Table.Cell>
												<Select.Root
													type="single"
													value={pending.writePermission || NO_PERMISSION}
													onValueChange={(value) =>
														setAccessField(
															collection.name,
															'writePermission',
															value === NO_PERMISSION ? '' : value
														)}
												>
													<Select.Trigger
														class="min-w-32 font-mono"
														size="sm"
														disabled={busy ||
															pending.writeAccess === 'public' ||
															pending.writeAccess === 'none'}
														aria-label={`Write permission for ${collection.name}`}
														data-testid={`db-perm-write-${collection.name}`}
													>
														{pending.writePermission || 'not required'}
													</Select.Trigger>
													<Select.Content>
														<Select.Item
															value={NO_PERMISSION}
															label="not required"
															class="font-mono"
														/>
														{#each permissionOptions(pending.writePermission) as key (key)}
															<Select.Item value={key} label={key} class="font-mono" />
														{/each}
													</Select.Content>
												</Select.Root>
											</Table.Cell>
											<Table.Cell>
												{@const ruleCount = Object.keys(collection.validator?.fields ?? {}).length}
												<Button
													size="sm"
													variant={collection.validator ? 'secondary' : 'ghost'}
													class="font-mono text-xs"
													disabled={busy}
													data-testid={`db-rules-${collection.name}`}
													onclick={() => void openRules(collection.name)}
												>
													{collection.validator
														? `${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'}`
														: 'none'}
												</Button>
											</Table.Cell>
											<Table.Cell>
												<Select.Root
													type="single"
													value={pending.replication}
													onValueChange={(value) =>
														setAccessField(
															collection.name,
															'replication',
															value === 'off' ? 'off' : 'auto'
														)}
												>
													<Select.Trigger
														class="min-w-24 font-mono"
														size="sm"
														disabled={busy}
														aria-label={`Replication for ${collection.name}`}
														data-testid={`db-replication-${collection.name}`}
													>
														{pending.replication}
													</Select.Trigger>
													<Select.Content>
														<Select.Item value="auto" label="auto" class="font-mono" />
														<Select.Item value="off" label="off" class="font-mono" />
													</Select.Content>
												</Select.Root>
											</Table.Cell>
											<Table.Cell>
												<div class="flex items-center justify-end gap-2">
													{#if feedback}
														<span
															class={[
																'text-xs',
																feedback.ok
																	? 'text-emerald-600 dark:text-emerald-400'
																	: 'text-destructive'
															]}
														>
															{feedback.message}
														</span>
													{/if}
													<Button
														size="sm"
														variant="outline"
														disabled={busy || !accessEdits[collection.name]}
														onclick={() => applyAccess(collection.name)}
													>
														Apply
													</Button>
												</div>
											</Table.Cell>
										</Table.Row>
										<!-- The row restated as a sentence, live-updated with pending
										     edits BEFORE Apply - the tab's teaching device. -->
										<Table.Row class="border-b hover:bg-transparent">
											<Table.Cell
												colspan={8}
												class="pt-2 pb-3 text-xs whitespace-normal text-muted-foreground"
												data-testid={`db-access-summary-${collection.name}`}
											>
												<span class="font-semibold text-destructive" aria-hidden="true">*</span>
												{accessSentence(pending, Boolean(collection.validator))}
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						{/if}
					</Card.Content>
				</Card.Root>
			</div>
		{/if}

		<!-- SQL EDITOR -->
		{#if activeTab === 'sql'}
			<div class="mt-4">
				<SqlEditor
					projectId={data.projectId}
					tables={agentState.tables?.map((table) => table.name) ?? []}
				/>
			</div>
		{/if}

		<!-- INTEGRATION -->
		{#if activeTab === 'integration'}
			<div class="mt-4">
				<Card.Root data-testid="db-integration">
					<Card.Header>
						<Card.Title>Connect your application</Card.Title>
						<Card.Description>
							REST with project JWTs, the typed client SDK, SQL tables with the Drizzle driver, or a
							raw live-query WebSocket.
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-5">
						<div>
							<Label>Database base URL</Label><code
								class="mt-2 block overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs"
								>{dbBase}</code
							>
						</div>
						<!-- Same component as the auth Integration tab: shiki highlighting,
						     tab pills, and the built-in copy button. -->
						<CodeExamples examples={snippets} />
						<p class="text-xs text-muted-foreground">
							auth and owner collections need a project JWT from the auth agent; external browser
							applications must be listed under the project's allowed origins. An
							<a
								href={resolve('/(app)/dashboard/[projectId]/settings', {
									projectId: data.projectId
								})}
								class="underline underline-offset-2 hover:text-foreground">admin service key</a
							> is the server-side credential, minted under Settings - never shipped to a browser.
						</p>
					</Card.Content>
				</Card.Root>
			</div>
		{/if}
	</div>
</div>

<!-- Document deletion: confirmed, and it shows exactly what is about to go. -->
<AlertDialog.Root bind:open={deleteDocOpen}>
	<AlertDialog.Content data-testid="db-delete-doc-panel">
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this document?</AlertDialog.Title>
			<AlertDialog.Description>
				This cannot be undone from here - a point-in-time rollback is the only way back.
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if deleteDocPreview}
			<div class="max-h-40 overflow-auto rounded-md border bg-muted/40 p-2.5">
				<p class="font-mono text-[11px] text-muted-foreground">{deleteDocPreview.id}</p>
				<pre class="mt-1 font-mono text-[11px] break-all whitespace-pre-wrap">{JSON.stringify(
						deleteDocPreview.data,
						null,
						2
					)}</pre>
			</div>
		{/if}
		{#if actionError}
			<p class="text-sm text-destructive">{actionError}</p>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={busy}>Cancel</AlertDialog.Cancel>
			<Button
				variant="destructive"
				disabled={busy}
				data-testid="db-delete-doc-submit"
				onclick={() => void deleteDocument()}
			>
				{busy ? 'Deleting…' : 'Delete document'}
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<!-- Collection deletion: destructive enough that the name must be typed back. -->
<Dialog.Root bind:open={deletePanelOpen}>
	<Dialog.Content data-testid="db-delete-panel">
		<Dialog.Header>
			<Dialog.Title>Delete {selected}?</Dialog.Title>
			<Dialog.Description>
				This permanently deletes <span class="font-mono font-semibold">{selected}</span> and every document
				in it - the collection's whole Durable Object is erased. Type the collection name to confirm.
			</Dialog.Description>
		</Dialog.Header>
		<Input
			class="font-mono"
			placeholder={selected}
			data-testid="db-delete-confirm"
			bind:value={deleteConfirmInput}
		/>
		{#if deleteError}
			<p class="text-sm text-destructive">{deleteError}</p>
		{/if}
		<Dialog.Footer>
			<Button
				variant="ghost"
				onclick={() => {
					deletePanelOpen = false;
					deleteConfirmInput = '';
					deleteError = null;
				}}
			>
				Cancel
			</Button>
			<Button
				variant="destructive"
				disabled={busy || !selected || deleteConfirmInput.trim() !== selected}
				onclick={deleteCollection}
			>
				Delete forever
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Rules-lite validator editor: the JSON shape the agent enforces on public writes. -->
<Dialog.Root open={rulesFor !== null} onOpenChange={(open) => !open && (rulesFor = null)}>
	<Dialog.Content class="sm:max-w-xl" data-testid="db-rules-panel">
		<Dialog.Header>
			<Dialog.Title>Document rules for {rulesFor}</Dialog.Title>
			<Dialog.Description>
				What documents written through the public API must look like - seeded from the shape of the
				documents already in this collection, so edit from there. Per top-level field: type,
				required, maxLength (strings/arrays), min/max (numbers), enum (allowed values); set
				additionalFields to "reject" to refuse undeclared keys. The dashboard editor and imports
				bypass these rules.
			</Dialog.Description>
		</Dialog.Header>
		<Textarea
			class="min-h-56 font-mono text-xs"
			data-testid="db-rules-json"
			bind:value={rulesJson}
		/>
		{#if rulesError}
			<p class="text-sm text-destructive" data-testid="db-rules-error">{rulesError}</p>
		{/if}
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (rulesFor = null)}>Cancel</Button>
			<Button variant="outline" disabled={busy} onclick={() => saveRules(true)}>Clear rules</Button>
			<Button disabled={busy} data-testid="db-rules-save" onclick={() => saveRules(false)}>
				Save rules
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#if selected}
	<RollbackDialog
		bind:open={rollbackOpen}
		base={`${adminBase}/${encodeURIComponent(selected)}`}
		shardName={selected}
		noun="collection"
		onRestored={() => refreshData(data.projectId)}
	/>
{/if}
