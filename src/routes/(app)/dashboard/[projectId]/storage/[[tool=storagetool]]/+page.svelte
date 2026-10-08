<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type {
		StorageAccessMode,
		StorageBucketInfo,
		StorageBucketSummary,
		StorageObjectInfo,
		StorageObjectPage,
		StorageOverview
	} from '$lib/agents';
	import CodeExamples from '$lib/components/code-examples.svelte';
	import ToolTabs from '$lib/components/tool-tabs.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Progress } from '$lib/components/ui/progress';
	import * as Select from '$lib/components/ui/select';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Switch } from '$lib/components/ui/switch';
	import { buildConsoleNav } from '$lib/agent-registry';
	import { buildStorageIntegrationExamples } from '$lib/integration-examples';
	import {
		Check,
		ChevronRight,
		Copy,
		Download,
		EllipsisVertical,
		FileArchive,
		FileCode,
		FileText,
		Film,
		Folder,
		FolderOpen,
		Globe,
		HardDrive,
		Image as ImageIcon,
		Link2,
		LoaderCircle,
		Lock,
		Music2,
		Plus,
		ShieldBan,
		Trash2,
		TriangleAlert,
		Upload,
		Users
	} from '@lucide/svelte';

	let { data } = $props();

	const tool = $derived(page.params.tool ?? 'files');
	const projectId = $derived(data.projectId);

	// The agent's own overview drives every degraded state, so the page is
	// honest about an install that cannot store bytes rather than failing at
	// the first upload.
	const overview = $derived<StorageOverview>(data.overview);

	// A demo project is the synthetic sample bucket: every mutating surface
	// answers 403, so the console renders no affordance that would - a button
	// whose only outcome is an upsell is worse than no button.
	const readOnly = $derived(overview.demo === true);

	const buckets = $derived(overview.buckets);
	let selected = $state<string | null>(null);
	const activeBucket = $derived<StorageBucketSummary | null>(
		buckets.find((bucket) => bucket.name === selected) ?? buckets[0] ?? null
	);

	// Folder navigation is a prefix, nothing more: folders are virtual, derived
	// at read time from the flat keys, so "entering" one is a string change.
	let prefix = $state('');
	const segments = $derived(prefix.split('/').filter(Boolean));

	type Folder = { prefix: string; objectCount: number };
	type UploadSession = { uploadId: string; partSize: number; parts: number };
	let objects = $state<StorageObjectInfo[]>([]);
	let folders = $state<Folder[]>([]);
	let total = $state(0);
	let cursor = $state<string | null>(null);
	let pageCursor = $state<string | null>(null);
	let cursorStack = $state<string[]>([]);
	let loading = $state(false);
	let listError = $state('');

	/** `Response.json()` is `unknown`; every read of one is typed at the
	 * boundary rather than cast at each use. */
	async function errorOf(response: Response, fallback: string): Promise<string> {
		const body = (await response.json().catch(() => null)) as { error?: string } | null;
		return body?.error ?? fallback;
	}

	const agentBase = $derived(`/agents/storage-agent/${projectId}/admin/buckets`);

	async function loadObjects(nextCursor: string | null = null, quiet = false) {
		if (!activeBucket) return;
		if (!quiet) loading = true;
		listError = '';
		try {
			// Built in one shot rather than mutated: this is a throwaway local,
			// not reactive state, and never calling a setter keeps it out of the
			// SvelteURLSearchParams rule that exists for the reactive case.
			const query = new URLSearchParams({
				delimiter: '/',
				limit: '50',
				...(prefix ? { prefix } : {}),
				...(nextCursor ? { cursor: nextCursor } : {})
			});
			const response = await fetch(
				`${agentBase}/${encodeURIComponent(activeBucket.name)}/objects?${query}`
			);
			if (!response.ok) {
				listError = await errorOf(response, 'could not list this bucket');
				return;
			}
			const body = (await response.json()) as StorageObjectPage;
			objects = body.objects ?? [];
			folders = body.folders ?? [];
			total = body.total ?? 0;
			cursor = body.cursor ?? null;
			pageCursor = nextCursor;
		} catch {
			listError = 'could not reach the storage agent';
		} finally {
			loading = false;
		}
	}

	// Re-read whenever the bucket or the folder changes - but only while the
	// Files tab is the one rendering the listing. Access and Integration never
	// display it, and each read is a worker hop plus a bucket-DO page scan.
	$effect(() => {
		if (tool !== 'files') return;
		void activeBucket?.name;
		void prefix;
		cursorStack = [];
		void loadObjects(null);
	});

	// The operator-list convention: a 5s poll re-reads the CURRENT page, so a
	// live refresh never yanks the operator back to the top. Paused during an
	// upload, whose own reload lands the moment it finishes.
	$effect(() => {
		if (tool !== 'files') return;
		const timer = setInterval(() => {
			if (!uploading && !loading) void loadObjects(pageCursor, true);
		}, 5000);
		return () => clearInterval(timer);
	});

	function enterFolder(next: string) {
		prefix = next;
	}
	function goToSegment(index: number) {
		prefix = index < 0 ? '' : `${segments.slice(0, index + 1).join('/')}/`;
	}

	function displayName(key: string): string {
		return key.slice(prefix.length);
	}
	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
		return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
	}
	function plural(count: number, word: string): string {
		return `${count} ${count === 1 ? word : `${word}s`}`;
	}
	function formatWhen(iso: string): string {
		const at = new Date(iso);
		const minutes = Math.round((Date.now() - at.getTime()) / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
		if (minutes < 60 * 24 * 7) return `${Math.round(minutes / (60 * 24))}d ago`;
		return at.toLocaleDateString();
	}

	// The console must not render inline what the byte path will not serve
	// inline - the serve-time allowlist, mirrored so the two cannot disagree.
	const INLINE = /^(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon)|text\/plain|application\/pdf)$/i;
	function isImage(contentType: string): boolean {
		return /^image\//i.test(contentType) && INLINE.test(contentType);
	}
	function isText(contentType: string): boolean {
		return /^text\/plain/i.test(contentType);
	}
	function iconFor(contentType: string) {
		if (isImage(contentType)) return ImageIcon;
		if (/^video\//i.test(contentType)) return Film;
		if (/^audio\//i.test(contentType)) return Music2;
		if (/(zip|tar|gzip|compressed|7z|rar)/i.test(contentType)) return FileArchive;
		if (/(json|javascript|typescript|xml|html|css|yaml)/i.test(contentType)) return FileCode;
		return FileText;
	}

	let previewOf = $state<StorageObjectInfo | null>(null);
	let signedUrl = $state('');
	let signing = $state(false);
	let textPreview = $state<string | null>(null);

	function objectUrl(key: string): string {
		if (!activeBucket) return '';
		const encoded = key.split('/').map(encodeURIComponent).join('/');
		return `${agentBase}/${encodeURIComponent(activeBucket.name)}/objects/${encoded}`;
	}

	function openObject(object: StorageObjectInfo) {
		previewOf = object;
		signedUrl = '';
		textPreview = null;
	}

	// A text file is worth reading in place rather than downloading to find out
	// what it holds - bounded, because the sheet is a preview and not an editor.
	const TEXT_PREVIEW_MAX = 8 * 1024;
	$effect(() => {
		const object = previewOf;
		if (!object || !isText(object.contentType) || object.size > TEXT_PREVIEW_MAX) return;
		let cancelled = false;
		void fetch(objectUrl(object.key))
			.then((response) => (response.ok ? response.text() : null))
			.then((body) => {
				if (!cancelled) textPreview = body;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	let copied = $state('');
	let copyTimer: ReturnType<typeof setTimeout> | undefined;
	async function copy(value: string, id: string) {
		try {
			await navigator.clipboard.writeText(value);
			copied = id;
			clearTimeout(copyTimer);
			copyTimer = setTimeout(() => (copied = ''), 1500);
		} catch {
			// clipboard unavailable - the value stays selectable
		}
	}

	async function mintSignedUrl() {
		if (!activeBucket || !previewOf) return;
		signing = true;
		try {
			const response = await fetch(
				`/api/projects/${projectId}/storage/admin/buckets/${encodeURIComponent(activeBucket.name)}/signed-urls`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ key: previewOf.key, expiresIn: 3600 })
				}
			);
			if (response.ok) signedUrl = ((await response.json()) as { signedUrl: string }).signedUrl;
		} finally {
			signing = false;
		}
	}

	/**
	 * The plain, unsigned URL for the open object - only on a bucket that
	 * actually reads `public`, and only on a serving domain this deployment has
	 * ROUTED. Both halves matter: a private bucket's plain URL answers 401, and
	 * an unrouted domain resolves nowhere, so either one would have the console
	 * hand an operator a link that does not work.
	 */
	const publicUrl = $derived.by(() => {
		const object = previewOf;
		const serveOrigin = overview.serveOrigin;
		if (!object || !serveOrigin || activeBucket?.read !== 'public') return '';
		const encoded = object.key.split('/').map(encodeURIComponent).join('/');
		return `${serveOrigin}/${encodeURIComponent(projectId)}/${encodeURIComponent(activeBucket.name)}/${encoded}`;
	});

	let deleteTarget = $state<StorageObjectInfo | null>(null);
	async function confirmDelete() {
		if (!deleteTarget) return;
		await fetch(objectUrl(deleteTarget.key), { method: 'DELETE' });
		deleteTarget = null;
		previewOf = null;
		await loadObjects(pageCursor);
		await invalidateAll();
	}

	// --- Upload. Rides the ADMIN mirror through the /agents/* passthrough:
	// streaming, guard-gated, modes bypassed - and escalates to the same
	// multipart protocol end-user SDKs get, so the console has no special path
	// that could diverge from what customers run. ---
	let uploading = $state(false);
	let uploadName = $state('');
	let uploadProgress = $state(0);
	let uploadDone = $state(0);
	let uploadTotal = $state(0);
	let uploadError = $state('');
	let dragging = $state(false);
	const SINGLE_PUT_MAX = 100 * 1024 * 1024;

	async function uploadFiles(files: FileList | null) {
		if (!files?.length || !activeBucket || readOnly) return;
		uploading = true;
		uploadError = '';
		uploadDone = 0;
		uploadTotal = files.length;
		try {
			for (const file of Array.from(files)) {
				const key = `${prefix}${file.name}`;
				uploadName = file.name;
				uploadProgress = 0;
				if (file.size > SINGLE_PUT_MAX) {
					await uploadMultipart(key, file);
					if (uploadError) return;
				} else {
					const response = await fetch(objectUrl(key), {
						method: 'PUT',
						headers: { 'content-type': file.type || 'application/octet-stream' },
						body: file
					});
					if (!response.ok) {
						uploadError = await errorOf(response, 'upload failed');
						return;
					}
					uploadProgress = 100;
				}
				uploadDone += 1;
			}
			await loadObjects(null);
			await invalidateAll();
		} catch {
			// A thrown fetch (network drop) must not vanish silently: without
			// this the progress bar just disappears and nothing says why.
			if (!uploadError) uploadError = 'upload failed - could not reach the storage agent';
		} finally {
			uploading = false;
			uploadProgress = 0;
			uploadName = '';
		}
	}

	async function uploadMultipart(key: string, file: File) {
		if (!activeBucket) return;
		const base = `/agents/storage-agent/${projectId}/admin/buckets/${encodeURIComponent(activeBucket.name)}/uploads`;
		const created = await fetch(base, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				key,
				size: file.size,
				contentType: file.type || 'application/octet-stream'
			})
		});
		if (!created.ok) {
			uploadError = await errorOf(created, 'upload could not start');
			return;
		}
		const session = (await created.json()) as UploadSession;
		const parts: { partNumber: number; etag: string }[] = [];
		try {
			for (let index = 0; index < session.parts; index += 1) {
				const start = index * session.partSize;
				const chunk = file.slice(start, Math.min(start + session.partSize, file.size));
				const response = await fetch(`${base}/${session.uploadId}/parts/${index + 1}`, {
					method: 'PUT',
					body: chunk
				});
				if (!response.ok) {
					uploadError = `part ${index + 1} failed`;
					await fetch(`${base}/${session.uploadId}`, { method: 'DELETE' });
					return;
				}
				parts.push((await response.json()) as { partNumber: number; etag: string });
				uploadProgress = Math.round(((index + 1) / session.parts) * 100);
			}
			const done = await fetch(`${base}/${session.uploadId}/complete`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ parts })
			});
			if (!done.ok) uploadError = 'upload could not complete';
		} catch (error) {
			// A thrown fetch mid-part would otherwise leave the R2 upload and its
			// quota reservation parked until the 24h sweep. Abort best-effort -
			// the sweep stays the backstop, not the plan.
			await fetch(`${base}/${session.uploadId}`, { method: 'DELETE' }).catch(() => undefined);
			throw error;
		}
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		void uploadFiles(event.dataTransfer?.files ?? null);
	}

	// --- Buckets ---
	let newBucketOpen = $state(false);
	let newBucketName = $state('');
	let newBucketRead = $state<StorageAccessMode>('auth');
	let newBucketWrite = $state<StorageAccessMode>('auth');
	let bucketError = $state('');
	let bucketBusy = $state(false);
	const accessModes: StorageAccessMode[] = ['public', 'auth', 'owner', 'none'];
	function toAccessMode(value: string): StorageAccessMode {
		return value === 'public' || value === 'owner' || value === 'none' ? value : 'auth';
	}

	const bucketPath = (name: string) =>
		`/api/projects/${projectId}/storage/admin/buckets/${encodeURIComponent(name)}`;

	async function createBucket(event: SubmitEvent) {
		event.preventDefault();
		bucketError = '';
		bucketBusy = true;
		try {
			const response = await fetch(bucketPath(newBucketName), {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ read: newBucketRead, write: newBucketWrite })
			});
			if (!response.ok) {
				bucketError = await errorOf(response, 'could not create that bucket');
				return;
			}
			const created = newBucketName;
			newBucketOpen = false;
			newBucketName = '';
			newBucketRead = 'auth';
			newBucketWrite = 'auth';
			await invalidateAll();
			selected = created;
			prefix = '';
		} finally {
			bucketBusy = false;
		}
	}

	// Dropping a bucket destroys every object in it, so it takes the typed-name
	// confirm the rest of the console uses for an irreversible erase - and the
	// dialog states the count, because "3 objects" is what makes the sentence
	// mean something.
	let dropTarget = $state<StorageBucketSummary | null>(null);
	let dropConfirmName = $state('');
	let dropError = $state('');
	let dropping = $state(false);
	async function confirmDropBucket() {
		if (!dropTarget || dropConfirmName !== dropTarget.name) return;
		dropping = true;
		dropError = '';
		try {
			const response = await fetch(bucketPath(dropTarget.name), { method: 'DELETE' });
			if (!response.ok) {
				dropError = await errorOf(response, 'could not delete that bucket');
				return;
			}
			const dropped = dropTarget.name;
			dropTarget = null;
			dropConfirmName = '';
			if (selected === dropped) selected = null;
			prefix = '';
			previewOf = null;
			await invalidateAll();
		} finally {
			dropping = false;
		}
	}

	// --- Access. The full config is server-loaded so the controls render with
	// their real values; edits are local until Save, which PUTs the whole set
	// (the agent merges, and an explicit null clears). ---
	type Pending = {
		read: StorageAccessMode;
		write: StorageAccessMode;
		readPermission: string;
		writePermission: string;
		publicListing: boolean;
		maxObjectMb: string;
		allowedContentTypes: string;
		cacheControl: string;
	};
	function toPending(config: StorageBucketInfo): Pending {
		return {
			read: config.read,
			write: config.write,
			readPermission: config.readPermission ?? '',
			writePermission: config.writePermission ?? '',
			publicListing: config.publicListing,
			maxObjectMb: config.maxObjectBytes ? String(Math.round(config.maxObjectBytes / 1048576)) : '',
			allowedContentTypes: (config.allowedContentTypes ?? []).join(', '),
			cacheControl: config.cacheControl ?? ''
		};
	}

	let edits = $state<Record<string, Pending>>({});
	let accessBusy = $state('');
	let accessFeedback = $state<Record<string, { ok: boolean; message: string }>>({});

	// The Access rail: every bucket's posture in one list, ONE editor at a
	// time beside it - the Files page's idiom, instead of a stacked full form
	// per bucket. Derived with a first-bucket fallback so the selection heals
	// itself when a bucket is deleted or the page lands fresh.
	let accessSelected = $state<string | null>(null);
	const accessConfig = $derived(
		(data.configs ?? []).find((config) => config.name === accessSelected) ??
			data.configs?.[0] ??
			null
	);

	// Reset from the server payload: reading `data.configs` only, so a save's
	// invalidateAll re-seeds the controls and nothing here re-triggers itself.
	$effect(() => {
		const next: Record<string, Pending> = {};
		for (const config of data.configs ?? []) next[config.name] = toPending(config);
		edits = next;
	});

	function setField<K extends keyof Pending>(name: string, field: K, value: Pending[K]) {
		const current = edits[name];
		if (!current) return;
		edits = { ...edits, [name]: { ...current, [field]: value } };
	}

	function isDirty(config: StorageBucketInfo): boolean {
		const pending = edits[config.name];
		if (!pending) return false;
		const stored = toPending(config);
		return (Object.keys(stored) as (keyof Pending)[]).some(
			(field) => stored[field] !== pending[field]
		);
	}

	async function saveAccess(config: StorageBucketInfo) {
		const pending = edits[config.name];
		if (!pending) return;
		accessBusy = config.name;
		accessFeedback = { ...accessFeedback, [config.name]: { ok: true, message: '' } };
		try {
			const megabytes = Number(pending.maxObjectMb);
			const types = pending.allowedContentTypes
				.split(',')
				.map((entry) => entry.trim())
				.filter(Boolean);
			const response = await fetch(bucketPath(config.name), {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					read: pending.read,
					write: pending.write,
					readPermission: pending.readPermission.trim() || null,
					writePermission: pending.writePermission.trim() || null,
					publicListing: pending.publicListing,
					maxObjectBytes:
						pending.maxObjectMb.trim() && Number.isFinite(megabytes) && megabytes > 0
							? Math.round(megabytes * 1048576)
							: null,
					allowedContentTypes: types.length ? types : null,
					cacheControl: pending.cacheControl.trim() || null
				})
			});
			if (!response.ok) {
				accessFeedback = {
					...accessFeedback,
					[config.name]: { ok: false, message: await errorOf(response, 'could not save') }
				};
				return;
			}
			accessFeedback = { ...accessFeedback, [config.name]: { ok: true, message: 'Saved' } };
			await invalidateAll();
		} finally {
			accessBusy = '';
		}
	}

	/** The config as a sentence, rendered from the PENDING values so it answers
	 * the question the operator is actually asking: what will this become. */
	function accessSentence(pending: Pending): string {
		const read =
			pending.read === 'public'
				? 'Anyone can read objects in this bucket, no sign-in needed'
				: pending.read === 'auth'
					? 'Any signed-in user of this project can read objects'
					: 'A signed-in user can read only the objects they wrote';
		const write =
			pending.write === 'public'
				? 'anyone can write'
				: pending.write === 'auth'
					? 'any signed-in user can write'
					: 'each user can write only their own keys';
		const listing = pending.publicListing
			? 'Listing every key is public.'
			: 'Listing every key is not public.';
		const permissions = [
			pending.readPermission.trim() &&
				`reading also requires the "${pending.readPermission.trim()}" permission`,
			pending.writePermission.trim() &&
				`writing also requires the "${pending.writePermission.trim()}" permission`
		].filter(Boolean);
		return `${read}, and ${write}. ${listing}${
			permissions.length ? ` On top of the mode, ${permissions.join(' and ')}.` : ''
		}`;
	}

	/** Desktop quick-switcher over this agent's tool pages (sidebar stays canonical). */
	const toolTabs = $derived(
		buildConsoleNav(projectId)
			.flatMap((section) => section.items)
			.filter((item) => item.href.startsWith(`/dashboard/${projectId}/storage`))
	);
	const toolMeta: Record<string, { title: string; blurb: string }> = {
		files: {
			title: 'Files',
			blurb:
				'Objects on R2, keyed per project - buckets are namespaces, and folders are derived from the keys you write rather than created.'
		},
		access: {
			title: 'Access',
			blurb:
				'Per-bucket read and write modes, permission keys, public listing, and the write-time limits.'
		},
		integration: {
			title: 'Integration',
			blurb:
				'Upload at any size from the client SDK, hand a private object to a browser with a signed URL, or reach it server-side with an admin service key.'
		}
	};

	const settingsHref = $derived(resolve('/(app)/dashboard/[projectId]/settings', { projectId }));

	const snippets = $derived(
		buildStorageIntegrationExamples(
			`${page.url.origin}/agents/storage-agent/${projectId}`,
			activeBucket?.name ?? 'my-bucket',
			{ origin: page.url.origin, projectId, serveOrigin: overview.serveOrigin ?? null }
		)
	);
</script>

<svelte:head>
	<title>{projectId} · Storage · Frostbase</title>
</svelte:head>

{#snippet modeIcon(mode: StorageAccessMode)}
	{#if mode === 'public'}
		<Globe class="h-3.5 w-3.5" />
	{:else if mode === 'owner'}
		<Users class="h-3.5 w-3.5" />
	{:else if mode === 'none'}
		<!-- Distinct from `auth`'s padlock on purpose: `auth` means "bring a
		     token", `none` means no token opens this at all. -->
		<ShieldBan class="h-3.5 w-3.5" />
	{:else}
		<Lock class="h-3.5 w-3.5" />
	{/if}
{/snippet}

{#if !overview.configured}
	<div class="mx-auto max-w-3xl px-4 py-10">
		<Card.Root data-testid="storage-unconfigured">
			<Card.Header>
				<Card.Title class="flex items-center gap-2"
					><HardDrive class="h-5 w-5 text-primary" /> Storage needs an R2 bucket</Card.Title
				>
				<Card.Description>
					R2 is an account-level opt-in, so this install ships without the binding rather than
					failing every deploy for accounts that have not enabled it.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2 text-sm text-muted-foreground">
				<p>1. Enable R2 in the Cloudflare dashboard (there is a free tier).</p>
				<p>
					2. Add the <code class="font-mono text-xs">BUCKET</code> binding to
					<code class="font-mono text-xs">agents/storage/wrangler.jsonc</code>.
				</p>
				<p>3. Redeploy the storage agent.</p>
			</Card.Content>
		</Card.Root>
	</div>
{:else if overview.erasing}
	<div class="mx-auto max-w-3xl px-4 py-10">
		<Card.Root data-testid="storage-erasing">
			<Card.Header>
				<Card.Title>This project's storage is being erased</Card.Title>
				<Card.Description>
					Object paths answer 503 until the drain finishes, so the next tenant of this id can never
					read what was here.
				</Card.Description>
			</Card.Header>
		</Card.Root>
	</div>
{:else}
	<!-- One page shell for every storage tool, the auth and db shape: the tool
	     quick-switcher, then a title and blurb, then the tool. Three agents
	     whose pages are laid out three different ways is how a console stops
	     reading as one product. -->
	<div class="mx-auto max-w-7xl space-y-5 px-3 py-5 sm:space-y-6 sm:px-6 sm:py-8">
		<ToolTabs items={toolTabs} />

		<!-- The text SHRINKS rather than wrapping the action below it: with the
		     copilot pane open the column is ~800px, where flex-wrap put the
		     button on its own line under a full-width blurb. -->
		<div class="flex items-center justify-between gap-4">
			<div class="min-w-0">
				<h1 class="text-2xl font-semibold">{toolMeta[tool]?.title ?? 'Files'}</h1>
				<p class="mt-1 text-sm text-muted-foreground">{toolMeta[tool]?.blurb}</p>
			</div>
			{#if tool === 'files' && buckets.length && !readOnly}
				<Button
					variant="outline"
					size="sm"
					class="shrink-0"
					onclick={() => (newBucketOpen = true)}
					data-testid="new-bucket"
				>
					<Plus class="mr-1.5 h-4 w-4" /> New bucket
				</Button>
			{/if}
		</div>

		{#if tool === 'access'}
			<div class="space-y-4" data-testid="storage-access">
				{#if readOnly}
					<Card.Root data-testid="storage-access-demo">
						<Card.Header>
							<Card.Title class="text-base">The sample bucket is read-only</Card.Title>
							<Card.Description>
								Demo projects get a public sample bucket to browse. Create a real project to
								configure access on buckets of your own.
							</Card.Description>
						</Card.Header>
					</Card.Root>
				{:else if !buckets.length}
					<p
						class="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground"
					>
						No buckets yet - create one on the Files page.
					</p>
				{/if}

				{#if data.configs?.length}
					<div class="grid items-start gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
						<!-- Every bucket's posture at a glance; ONE editor at a time on
						     the right. Badges render from the PENDING values, like the
						     sentence: they answer what this will become. -->
						<nav
							class="flex flex-col gap-1 self-start rounded-lg border p-2 lg:sticky lg:top-4"
							aria-label="Buckets"
							data-testid="access-bucket-rail"
						>
							{#each data.configs ?? [] as config (config.name)}
								{@const pending = edits[config.name]}
								{@const selected = config.name === accessConfig?.name}
								<button
									type="button"
									class={[
										'rounded-md px-2.5 py-2 text-left transition-colors',
										selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
									]}
									onclick={() => (accessSelected = config.name)}
									data-testid="access-bucket-{config.name}"
								>
									<span class="flex items-center gap-2 font-mono text-sm">
										<Folder class="h-3.5 w-3.5 shrink-0 text-primary" />
										<span class="truncate">{config.name}</span>
									</span>
									<span class="mt-0.5 block pl-5.5 text-xs text-muted-foreground">
										{pending?.read ?? config.read} · {pending?.write ??
											config.write}{(pending?.publicListing ?? config.publicListing)
											? ' · listed'
											: ''}
									</span>
								</button>
							{/each}
						</nav>

						{#if accessConfig}
							{@const config = accessConfig}
							{@const pending = edits[config.name]}
							{#if pending}
								{@const feedback = accessFeedback[config.name]}
								{@const busy = accessBusy === config.name}
								<Card.Root data-testid="access-card-{config.name}">
									<Card.Header>
										<Card.Title class="flex items-center gap-2 font-mono text-base">
											<Folder class="h-4 w-4 text-primary" />
											{config.name}
											<span class="ml-auto text-xs font-normal text-muted-foreground">
												{plural(config.objectCount, 'object')} · {formatBytes(config.totalBytes)}
											</span>
										</Card.Title>
										<Card.Description data-testid="access-sentence-{config.name}">
											{accessSentence(pending)}
										</Card.Description>
									</Card.Header>
									<Card.Content class="space-y-4">
										{#if pending.read === 'public' || pending.write === 'public'}
											<p
												class="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-amber-700 dark:text-amber-400"
											>
												<TriangleAlert class="mt-px h-3.5 w-3.5 shrink-0" />
												<span>
													{pending.write === 'public'
														? 'Public write means anyone on the internet can upload to this bucket. Use it only for buckets you can afford to have filled by strangers.'
														: 'Public read means anyone with the key can fetch the object without signing in. Private objects want a signed URL instead.'}
												</span>
											</p>
										{/if}

										<div class="grid gap-4 sm:grid-cols-2">
											<div class="space-y-1.5">
												<Label>Read</Label>
												<Select.Root
													type="single"
													value={pending.read}
													onValueChange={(value) =>
														setField(config.name, 'read', toAccessMode(value))}
												>
													<Select.Trigger
														class="w-full font-mono"
														disabled={busy}
														aria-label={`Read access for ${config.name}`}
														data-testid="access-read-{config.name}"
													>
														{pending.read}
													</Select.Trigger>
													<Select.Content>
														{#each accessModes as mode (mode)}
															<Select.Item value={mode} label={mode} class="font-mono" />
														{/each}
													</Select.Content>
												</Select.Root>
											</div>
											<div class="space-y-1.5">
												<Label>Write</Label>
												<Select.Root
													type="single"
													value={pending.write}
													onValueChange={(value) =>
														setField(config.name, 'write', toAccessMode(value))}
												>
													<Select.Trigger
														class="w-full font-mono"
														disabled={busy}
														aria-label={`Write access for ${config.name}`}
														data-testid="access-write-{config.name}"
													>
														{pending.write}
													</Select.Trigger>
													<Select.Content>
														{#each accessModes as mode (mode)}
															<Select.Item value={mode} label={mode} class="font-mono" />
														{/each}
													</Select.Content>
												</Select.Root>
											</div>

											<div class="space-y-1.5">
												<Label for="read-perm-{config.name}">Read permission</Label>
												<Input
													id="read-perm-{config.name}"
													class="font-mono"
													placeholder="none"
													value={pending.readPermission}
													disabled={busy || pending.read === 'public'}
													oninput={(event) =>
														setField(config.name, 'readPermission', event.currentTarget.value)}
												/>
											</div>
											<div class="space-y-1.5">
												<Label for="write-perm-{config.name}">Write permission</Label>
												<Input
													id="write-perm-{config.name}"
													class="font-mono"
													placeholder="none"
													value={pending.writePermission}
													disabled={busy || pending.write === 'public'}
													oninput={(event) =>
														setField(config.name, 'writePermission', event.currentTarget.value)}
												/>
											</div>
										</div>
										<p class="text-xs text-muted-foreground">
											A permission key tightens auth/owner further: the user's role must grant that
											key. Roles live under Auth &gt; Roles, and the built-in admin role grants
											everything.
										</p>

										<div class="flex items-start justify-between gap-4 rounded-md border p-3">
											<div>
												<p class="text-sm font-medium">Public listing</p>
												<p class="text-xs text-muted-foreground">
													Whether anonymous callers may list every key. Separate from reading a key
													they already know.
												</p>
											</div>
											<Switch
												checked={pending.publicListing}
												disabled={busy}
												aria-label={`Public listing for ${config.name}`}
												data-testid="access-listing-{config.name}"
												onCheckedChange={(value) => setField(config.name, 'publicListing', value)}
											/>
										</div>

										<div class="grid gap-4 sm:grid-cols-3">
											<div class="space-y-1.5">
												<Label for="max-size-{config.name}">Max object size (MB)</Label>
												<Input
													id="max-size-{config.name}"
													inputmode="numeric"
													placeholder="no limit"
													value={pending.maxObjectMb}
													disabled={busy}
													oninput={(event) =>
														setField(config.name, 'maxObjectMb', event.currentTarget.value)}
												/>
											</div>
											<div class="space-y-1.5">
												<Label for="types-{config.name}">Allowed content types</Label>
												<Input
													id="types-{config.name}"
													class="font-mono"
													placeholder="any"
													value={pending.allowedContentTypes}
													disabled={busy}
													oninput={(event) =>
														setField(config.name, 'allowedContentTypes', event.currentTarget.value)}
												/>
											</div>
											<div class="space-y-1.5">
												<Label for="cache-{config.name}">Cache-Control</Label>
												<Input
													id="cache-{config.name}"
													class="font-mono"
													placeholder="default"
													value={pending.cacheControl}
													disabled={busy}
													oninput={(event) =>
														setField(config.name, 'cacheControl', event.currentTarget.value)}
												/>
											</div>
										</div>
										<p class="text-xs text-muted-foreground">
											Content types are a comma-separated allowlist checked at write time (<code
												class="font-mono">image/png, image/jpeg</code
											>); empty allows any. HTML and SVG always download rather than render,
											whatever you allow here - the byte path shares this origin.
										</p>
									</Card.Content>
									<Card.Footer class="justify-end gap-3">
										{#if feedback?.message}
											<span
												class={[
													'text-xs',
													feedback.ok
														? 'text-emerald-600 dark:text-emerald-400'
														: 'text-destructive'
												]}
												data-testid="access-feedback-{config.name}"
											>
												{feedback.message}
											</span>
										{/if}
										<Button
											size="sm"
											disabled={busy || !isDirty(config)}
											onclick={() => void saveAccess(config)}
											data-testid="access-save-{config.name}"
										>
											{busy ? 'Saving…' : 'Save'}
										</Button>
									</Card.Footer>
								</Card.Root>
							{/if}
						{/if}
					</div>
				{/if}
			</div>
		{:else if tool === 'integration'}
			<div data-testid="storage-integration">
				<Card.Root>
					<Card.Header>
						<Card.Title>Connect your application</Card.Title>
						<Card.Description>
							One call at every size - the client escalates to multipart above 100 MB by itself.
							Snippets target <span class="font-mono text-foreground"
								>{activeBucket?.name ?? 'my-bucket'}</span
							>.
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-5">
						<div>
							<Label>Storage base URL</Label>
							<code class="mt-2 block overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs">
								{page.url.origin}/agents/storage-agent/{projectId}
							</code>
						</div>
						<CodeExamples examples={snippets} />
						<p class="text-xs text-muted-foreground">
							<code class="font-mono">auth</code> and <code class="font-mono">owner</code> buckets
							need a project JWT from the auth agent; external browser applications must be listed
							under the project's allowed origins. An
							<a href={settingsHref} class="underline underline-offset-2 hover:text-foreground"
								>admin service key</a
							> is the server-side credential, minted under Settings - never shipped to a browser.
						</p>
					</Card.Content>
				</Card.Root>
			</div>
		{:else if !buckets.length}
			<div class="py-12 text-center" data-testid="storage-empty">
				<FolderOpen class="mx-auto h-10 w-10 text-muted-foreground" />
				<h1 class="mt-4 text-lg font-semibold">No buckets yet</h1>
				<p class="mt-1 text-sm text-muted-foreground">
					A bucket is a namespace for files. New buckets are private by default - read and write
					both require a signed-in project user.
				</p>
				<Button class="mt-4" onclick={() => (newBucketOpen = true)} data-testid="new-bucket">
					<Plus class="mr-1.5 h-4 w-4" /> New bucket
				</Button>
			</div>
		{:else}
			<!-- The console's browser idiom: a bounded card whose panes scroll
				     INSIDE it, never a pane that grows the page. `lg:grid-rows-1` is
				     what makes the height bite - the implicit row track is auto, so a
				     fixed-height grid alone lets its items stretch straight past it. -->
			<Card.Root class="overflow-hidden py-0">
				<div
					class="grid grid-cols-1 max-lg:divide-y lg:h-[36rem] lg:grid-cols-[15rem_minmax(0,1fr)] lg:grid-rows-1 lg:divide-x"
				>
					<!-- Bucket rail -->
					<aside class="flex min-h-0 flex-col" data-testid="bucket-rail">
						<div class="flex items-center justify-between border-b px-3 py-2">
							<span class="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
								Buckets
							</span>
							{#if !readOnly}
								<Button
									size="icon"
									variant="ghost"
									class="-mr-1 h-6 w-6"
									title="New bucket"
									onclick={() => (newBucketOpen = true)}><Plus class="h-3.5 w-3.5" /></Button
								>
							{/if}
						</div>
						<div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
							{#each buckets as bucket (bucket.name)}
								{@const active = activeBucket?.name === bucket.name}
								<!-- The row and its menu are siblings, not nested: a <button>
							     cannot contain the menu trigger, which is itself a button. -->
								<div
									class={[
										'group flex items-center rounded-md transition-colors',
										active ? 'bg-muted' : 'hover:bg-muted/60'
									]}
								>
									<button
										type="button"
										class="min-w-0 flex-1 px-2 py-1.5 text-left text-sm"
										data-testid="bucket-{bucket.name}"
										onclick={() => {
											selected = bucket.name;
											prefix = '';
										}}
									>
										<span class="flex items-center gap-1.5">
											<span class={['truncate', active && 'font-medium']}>{bucket.name}</span>
											{#if bucket.read === 'public'}
												<Globe class="h-3 w-3 shrink-0 text-muted-foreground" />
											{/if}
										</span>
										<span class="block text-xs text-muted-foreground">
											{plural(bucket.objectCount, 'object')} · {formatBytes(bucket.totalBytes)}
										</span>
									</button>
									{#if !readOnly}
										<DropdownMenu.Root>
											<DropdownMenu.Trigger
												class={[
													buttonVariants({ variant: 'ghost', size: 'icon' }),
													'mr-1 h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100'
												]}
												aria-label={`Actions for ${bucket.name}`}
												data-testid="bucket-menu-{bucket.name}"
											>
												<EllipsisVertical class="h-3.5 w-3.5" />
											</DropdownMenu.Trigger>
											<DropdownMenu.Content align="end">
												<DropdownMenu.Item
													onclick={() => {
														selected = bucket.name;
														prefix = '';
													}}
												>
													<FolderOpen class="mr-2 h-3.5 w-3.5" /> Browse
												</DropdownMenu.Item>
												<DropdownMenu.Item
													onclick={() => {
														dropTarget = bucket;
														dropConfirmName = '';
														dropError = '';
													}}
													data-testid="delete-bucket-{bucket.name}"
													class="text-destructive data-highlighted:text-destructive"
												>
													<Trash2 class="mr-2 h-3.5 w-3.5" /> Delete bucket
												</DropdownMenu.Item>
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									{/if}
								</div>
							{/each}
						</div>
					</aside>

					<!-- Browser -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<section
						class="relative flex min-w-0 flex-col"
						data-testid="file-browser"
						ondragover={(event) => {
							if (readOnly) return;
							event.preventDefault();
							dragging = true;
						}}
						ondragleave={() => (dragging = false)}
						ondrop={onDrop}
					>
						<div class="flex flex-wrap items-center gap-2 border-b px-4 py-2">
							<nav class="flex min-w-0 flex-1 items-center gap-1 text-sm" data-testid="breadcrumb">
								<button
									type="button"
									class="flex items-center gap-1.5 font-medium hover:underline"
									onclick={() => goToSegment(-1)}
								>
									<Folder class="h-3.5 w-3.5 text-muted-foreground" />
									{activeBucket?.name}
								</button>
								{#each segments as segment, index (index)}
									<ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									<button
										type="button"
										class="truncate hover:underline"
										onclick={() => goToSegment(index)}
									>
										{segment}
									</button>
								{/each}
							</nav>

							{#if activeBucket}
								<Badge variant="outline" class="gap-1 font-mono text-[11px]">
									{@render modeIcon(activeBucket.read)}
									{activeBucket.read}
								</Badge>
							{/if}

							{#if !readOnly}
								<!-- The primary action of the page, styled as one. -->
								<label
									class={[
										buttonVariants({ size: 'sm' }),
										'cursor-pointer',
										uploading && 'pointer-events-none opacity-70'
									]}
								>
									<input
										type="file"
										multiple
										class="hidden"
										disabled={uploading}
										data-testid="upload-input"
										onchange={(event) => uploadFiles(event.currentTarget.files)}
									/>
									{#if uploading}
										<LoaderCircle class="mr-1.5 h-3.5 w-3.5 animate-spin" /> Uploading…
									{:else}
										<Upload class="mr-1.5 h-3.5 w-3.5" /> Upload
									{/if}
								</label>
							{/if}
						</div>

						{#if uploading}
							<div class="space-y-1.5 border-b px-4 py-2" data-testid="upload-progress">
								<div class="flex items-center justify-between text-xs text-muted-foreground">
									<span class="truncate font-mono">{uploadName}</span>
									<span class="tabular-nums">
										{uploadTotal > 1
											? `${uploadDone + 1} of ${uploadTotal} · `
											: ''}{uploadProgress}%
									</span>
								</div>
								<Progress value={uploadProgress} class="h-1" />
							</div>
						{/if}

						{#if uploadError}
							<p class="px-4 py-2 text-sm text-destructive" data-testid="upload-error">
								{uploadError}
							</p>
						{/if}
						{#if listError}
							<p class="px-4 py-2 text-sm text-destructive" data-testid="list-error">{listError}</p>
						{/if}

						<div class="min-h-0 flex-1 overflow-auto">
							<table class="w-full text-sm">
								<thead class="sticky top-0 z-10 bg-background">
									<tr class="border-b text-left text-xs text-muted-foreground">
										<th class="px-4 py-2 font-medium">Name</th>
										<th class="px-4 py-2 text-right font-medium">Size</th>
										<th class="hidden px-4 py-2 font-medium sm:table-cell">Type</th>
										<th class="px-4 py-2 font-medium">Updated</th>
										<th class="w-20 px-4 py-2"><span class="sr-only">Actions</span></th>
									</tr>
								</thead>
								<tbody data-testid="file-rows">
									<!-- The whole ROW is the target, not just the name: the row is
								     what looks clickable, so it has to be what responds. Rows
								     carry the keyboard affordance themselves rather than
								     wrapping a button, which a <td> cannot contain without
								     breaking the row into two tab stops. -->
									{#each folders as folder (folder.prefix)}
										<tr
											class="group cursor-pointer border-b hover:bg-muted/50 focus-visible:bg-muted"
											data-testid="folder-row"
											role="button"
											tabindex="0"
											onclick={() => enterFolder(folder.prefix)}
											onkeydown={(event) => {
												if (event.key === 'Enter' || event.key === ' ') {
													event.preventDefault();
													enterFolder(folder.prefix);
												}
											}}
										>
											<td class="px-4 py-2">
												<span class="flex items-center gap-2 font-medium">
													<Folder class="h-4 w-4 shrink-0 text-primary/70" />
													<span class="truncate">{displayName(folder.prefix)}</span>
												</span>
											</td>
											<td class="px-4 py-2 text-right text-muted-foreground">—</td>
											<td class="hidden px-4 py-2 text-muted-foreground sm:table-cell">
												{folder.objectCount}
												{folder.objectCount === 1 ? 'object' : 'objects'}
											</td>
											<td class="px-4 py-2 text-muted-foreground">—</td>
											<td class="px-4 py-2 text-right">
												<ChevronRight class="ml-auto h-4 w-4 text-muted-foreground" />
											</td>
										</tr>
									{/each}
									{#each objects as object (object.key)}
										{@const Icon = iconFor(object.contentType)}
										<tr
											class="group cursor-pointer border-b hover:bg-muted/50 focus-visible:bg-muted"
											data-testid="object-row"
											role="button"
											tabindex="0"
											onclick={() => openObject(object)}
											onkeydown={(event) => {
												if (event.key === 'Enter' || event.key === ' ') {
													event.preventDefault();
													openObject(object);
												}
											}}
										>
											<td class="px-4 py-2">
												<span class="flex items-center gap-2">
													<Icon class="h-4 w-4 shrink-0 text-muted-foreground" />
													<span class="truncate">{displayName(object.key)}</span>
												</span>
											</td>
											<td class="px-4 py-2 text-right text-muted-foreground tabular-nums">
												{formatBytes(object.size)}
											</td>
											<td
												class="hidden max-w-48 truncate px-4 py-2 font-mono text-xs text-muted-foreground sm:table-cell"
											>
												{object.contentType}
											</td>
											<td
												class="px-4 py-2 text-muted-foreground"
												title={new Date(object.updatedAt).toLocaleString()}
											>
												{formatWhen(object.updatedAt)}
											</td>
											<td class="px-4 py-2">
												<!-- Row actions appear on hover but stay reachable by
											     keyboard; the stopPropagation keeps them from
											     opening the sheet behind them. -->
												<div
													class="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
												>
													<Button
														href={objectUrl(object.key)}
														download={displayName(object.key)}
														variant="ghost"
														size="icon"
														class="h-7 w-7"
														title="Download"
														onclick={(event) => event.stopPropagation()}
													>
														<Download class="h-3.5 w-3.5" />
													</Button>
													{#if !readOnly}
														<Button
															variant="ghost"
															size="icon"
															class="h-7 w-7 text-muted-foreground hover:text-destructive"
															title="Delete"
															data-testid="row-delete"
															onclick={(event) => {
																event.stopPropagation();
																deleteTarget = object;
															}}
														>
															<Trash2 class="h-3.5 w-3.5" />
														</Button>
													{/if}
												</div>
											</td>
										</tr>
									{/each}
									{#if loading && !folders.length && !objects.length}
										<tr>
											<td colspan="5" class="px-4 py-10 text-center text-muted-foreground">
												<LoaderCircle class="mx-auto h-4 w-4 animate-spin" />
											</td>
										</tr>
									{:else if !loading && !folders.length && !objects.length}
										<tr>
											<td colspan="5" class="px-4 py-14 text-center">
												<FolderOpen class="mx-auto h-8 w-8 text-muted-foreground/60" />
												<p class="mt-3 text-sm font-medium">
													{prefix ? 'This folder is empty.' : 'This bucket is empty.'}
												</p>
												{#if !readOnly}
													<p class="mt-1 text-xs text-muted-foreground">
														Drop files here, or use Upload. Folders are made by the keys you write -
														<span class="font-mono">photos/cat.png</span> creates
														<span class="font-mono">photos/</span>.
													</p>
												{/if}
											</td>
										</tr>
									{/if}
								</tbody>
							</table>
						</div>

						<div
							class="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground"
						>
							<span data-testid="object-range">
								{objects.length ? `1–${objects.length} of ${total}` : `0 of ${total}`}
								{folders.length
									? ` · ${folders.length} ${folders.length === 1 ? 'folder' : 'folders'}`
									: ''}
							</span>
							<div class="flex gap-2">
								<Button
									size="sm"
									variant="outline"
									disabled={!cursorStack.length}
									onclick={() => {
										const stack = [...cursorStack];
										stack.pop();
										cursorStack = stack;
										void loadObjects(stack[stack.length - 1] ?? null);
									}}>Prev</Button
								>
								<Button
									size="sm"
									variant="outline"
									disabled={!cursor}
									onclick={() => {
										if (!cursor) return;
										cursorStack = [...cursorStack, cursor];
										void loadObjects(cursor);
									}}>Next</Button
								>
							</div>
						</div>

						{#if dragging && !readOnly}
							<div
								class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-primary bg-primary/5"
								data-testid="drop-overlay"
							>
								<p class="flex items-center gap-2 text-sm font-medium text-primary">
									<Upload class="h-4 w-4" /> Drop to upload to
									<span class="font-mono">{prefix || '/'}</span>
								</p>
							</div>
						{/if}
					</section>
				</div>
			</Card.Root>
		{/if}
	</div>
{/if}

<Sheet.Root open={!!previewOf} onOpenChange={(open) => !open && (previewOf = null)}>
	<Sheet.Content side="right" class="w-full gap-0 sm:max-w-lg" data-testid="object-sheet">
		{#if previewOf}
			{@const Icon = iconFor(previewOf.contentType)}
			<Sheet.Header class="border-b">
				<Sheet.Title class="flex items-center gap-2 text-base break-all">
					<Icon class="h-4 w-4 shrink-0 text-muted-foreground" />
					{displayName(previewOf.key)}
				</Sheet.Title>
				<Sheet.Description class="flex items-center gap-1.5 font-mono text-xs break-all">
					<span class="min-w-0 flex-1">{previewOf.key}</span>
					<Button
						variant="ghost"
						size="icon"
						class="h-6 w-6 shrink-0"
						title="Copy key"
						data-testid="copy-key"
						onclick={() => copy(previewOf!.key, 'key')}
					>
						{#if copied === 'key'}<Check class="h-3 w-3" />{:else}<Copy class="h-3 w-3" />{/if}
					</Button>
				</Sheet.Description>
			</Sheet.Header>

			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
				{#if isImage(previewOf.contentType)}
					<!-- Checkerboard behind the image: a transparent PNG on a flat
					     panel is indistinguishable from a white one. -->
					<div
						class="flex items-center justify-center rounded-lg border bg-[repeating-conic-gradient(var(--color-muted)_0%_25%,transparent_0%_50%)] bg-size-[16px_16px] p-2"
					>
						<img
							src={objectUrl(previewOf.key)}
							alt={previewOf.key}
							class="max-h-72 w-auto max-w-full rounded object-contain"
						/>
					</div>
				{:else if isText(previewOf.contentType) && textPreview !== null}
					<pre
						class="max-h-72 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap"
						data-testid="text-preview">{textPreview}</pre>
				{:else}
					<!-- The console does not render inline what the byte path serves
					     as an attachment - HTML and SVG above all. -->
					<div
						class="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center"
					>
						<Icon class="h-8 w-8 text-muted-foreground/60" />
						<p class="text-xs text-muted-foreground">
							No preview for <span class="font-mono">{previewOf.contentType}</span>
						</p>
					</div>
				{/if}

				<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
					<dt class="text-muted-foreground">Size</dt>
					<dd class="text-right tabular-nums">{formatBytes(previewOf.size)}</dd>
					<dt class="text-muted-foreground">Type</dt>
					<dd class="truncate text-right font-mono text-xs">{previewOf.contentType}</dd>
					<dt class="text-muted-foreground">Owner</dt>
					<dd class="truncate text-right font-mono text-xs">{previewOf.owner || '—'}</dd>
					<dt class="text-muted-foreground">Updated</dt>
					<dd class="text-right">{new Date(previewOf.updatedAt).toLocaleString()}</dd>
					<dt class="text-muted-foreground">ETag</dt>
					<dd class="truncate text-right font-mono text-xs">{previewOf.etag}</dd>
				</dl>

				<div class="space-y-2">
					<Button
						href={objectUrl(previewOf.key)}
						download={displayName(previewOf.key)}
						class="w-full"
					>
						<Download class="mr-1.5 h-4 w-4" /> Download
					</Button>
					{#if publicUrl}
						<div class="space-y-1.5" data-testid="public-url-block">
							<p class="text-xs font-medium">Public URL</p>
							<div class="flex items-start gap-1.5 rounded-md border bg-muted p-2">
								<code
									class="min-w-0 flex-1 font-mono text-[11px] break-all select-all"
									data-testid="public-url">{publicUrl}</code
								>
								<Button
									variant="ghost"
									size="icon"
									class="h-6 w-6 shrink-0"
									title="Copy public URL"
									data-testid="copy-public-url"
									onclick={() => copy(publicUrl, 'public')}
								>
									{#if copied === 'public'}<Check class="h-3 w-3" />{:else}<Copy
											class="h-3 w-3"
										/>{/if}
								</Button>
							</div>
							<p class="text-[11px] text-muted-foreground">
								This bucket reads <span class="font-mono">public</span>, so no signature is needed
								and this link does not expire.
							</p>
						</div>
					{/if}
					<Button
						variant="outline"
						class="w-full"
						disabled={signing}
						onclick={mintSignedUrl}
						data-testid="sign-url"
					>
						<Link2 class="mr-1.5 h-4 w-4" />
						{signing ? 'Signing…' : 'Create signed URL (1 hour)'}
					</Button>
					{#if signedUrl}
						<div class="flex items-start gap-1.5 rounded-md border bg-muted p-2">
							<code
								class="min-w-0 flex-1 font-mono text-[11px] break-all select-all"
								data-testid="signed-url">{signedUrl}</code
							>
							<Button
								variant="ghost"
								size="icon"
								class="h-6 w-6 shrink-0"
								title="Copy signed URL"
								data-testid="copy-signed-url"
								onclick={() => copy(signedUrl, 'signed')}
							>
								{#if copied === 'signed'}<Check class="h-3 w-3" />{:else}<Copy
										class="h-3 w-3"
									/>{/if}
							</Button>
						</div>
						<p class="text-[11px] text-muted-foreground">
							Anyone holding this URL can read the object until it expires. Deleting the object is
							what revokes it immediately.
						</p>
					{/if}
					{#if !readOnly}
						<Button
							variant="ghost"
							class="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
							onclick={() => (deleteTarget = previewOf)}
							data-testid="delete-object"
						>
							<Trash2 class="mr-1.5 h-4 w-4" /> Delete
						</Button>
					{/if}
				</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<AlertDialog.Root open={!!deleteTarget} onOpenChange={(open) => !open && (deleteTarget = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this object?</AlertDialog.Title>
			<AlertDialog.Description class="break-all">
				{deleteTarget?.key} is removed from R2 and from the index. This cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmDelete} data-testid="confirm-delete">
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<!-- Dropping a bucket is irreversible and takes its objects with it, so it is
     the typed-name confirm the rest of the console uses, never a bare click. -->
<Dialog.Root
	open={!!dropTarget}
	onOpenChange={(open) => {
		if (!open) {
			dropTarget = null;
			dropConfirmName = '';
		}
	}}
>
	<Dialog.Content data-testid="delete-bucket-dialog">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-destructive">
				<TriangleAlert class="h-4 w-4" /> Delete this bucket?
			</Dialog.Title>
			<Dialog.Description>
				<span class="font-mono">{dropTarget?.name}</span> and its
				<strong
					>{dropTarget?.objectCount} {dropTarget?.objectCount === 1 ? 'object' : 'objects'}</strong
				>
				({formatBytes(dropTarget?.totalBytes ?? 0)}) are deleted from R2 and from the index. Signed
				URLs pointing into it stop working. This cannot be undone.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-2 py-2">
			<Label for="drop-confirm">
				Type <span class="font-mono font-medium">{dropTarget?.name}</span> to confirm
			</Label>
			<Input
				id="drop-confirm"
				bind:value={dropConfirmName}
				autocomplete="off"
				class="font-mono"
				data-testid="delete-bucket-input"
			/>
			{#if dropError}
				<p class="text-sm text-destructive" data-testid="delete-bucket-error">{dropError}</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (dropTarget = null)}>Cancel</Button>
			<Button
				variant="destructive"
				disabled={dropping || dropConfirmName !== dropTarget?.name}
				onclick={confirmDropBucket}
				data-testid="confirm-delete-bucket"
			>
				{dropping ? 'Deleting…' : 'Delete bucket'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={newBucketOpen}>
	<Dialog.Content>
		<form onsubmit={createBucket}>
			<Dialog.Header>
				<Dialog.Title>New bucket</Dialog.Title>
				<Dialog.Description>
					Both read and write default to a signed-in project user - a new bucket is never anonymous.
					Everything here is editable later on the Access page.
				</Dialog.Description>
			</Dialog.Header>
			<div class="space-y-4 py-4">
				<div class="space-y-2">
					<Label for="bucket-name">Name</Label>
					<Input
						id="bucket-name"
						bind:value={newBucketName}
						class="font-mono"
						placeholder="avatars"
						required
						data-testid="bucket-name-input"
					/>
					<p class="text-xs text-muted-foreground">2–63 lowercase letters, numbers, and dashes.</p>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<Label>Read</Label>
						<Select.Root
							type="single"
							value={newBucketRead}
							onValueChange={(value) => (newBucketRead = toAccessMode(value))}
						>
							<Select.Trigger class="font-mono" size="sm" aria-label="Read access">
								{newBucketRead}
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
							value={newBucketWrite}
							onValueChange={(value) => (newBucketWrite = toAccessMode(value))}
						>
							<Select.Trigger class="font-mono" size="sm" aria-label="Write access">
								{newBucketWrite}
							</Select.Trigger>
							<Select.Content>
								{#each accessModes as mode (mode)}
									<Select.Item value={mode} label={mode} class="font-mono" />
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>
				{#if bucketError}
					<p class="text-sm text-destructive" data-testid="bucket-error">{bucketError}</p>
				{/if}
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={bucketBusy} data-testid="create-bucket">
					{bucketBusy ? 'Creating…' : 'Create'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
