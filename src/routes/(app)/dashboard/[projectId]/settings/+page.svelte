<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Check, Copy, GitBranch, KeyRound, TriangleAlert } from '@lucide/svelte';

	let { data } = $props();

	const isBranch = $derived(!!data.project?.parentId);

	// Initial-value capture on purpose; renaming re-syncs via invalidateAll.
	// svelte-ignore state_referenced_locally
	let projectName = $state(data.project?.name ?? '');
	let renameBusy = $state(false);
	let renameError = $state<string | null>(null);
	let renameSaved = $state(false);

	async function rename(event: SubmitEvent) {
		event.preventDefault();
		renameBusy = true;
		renameError = null;
		renameSaved = false;
		try {
			const response = await fetch(`/api/registry/projects/${data.projectId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: projectName.trim() })
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { error?: string } | null;
				renameError = body?.error ?? 'Could not rename the project.';
				return;
			}
			renameSaved = true;
			await invalidateAll();
		} catch {
			renameError = 'Could not reach the control plane.';
		} finally {
			renameBusy = false;
		}
	}

	// Service keys. The minted secret lives in component state and nowhere
	// else - it is in the mint response and never retrievable again, so it is
	// deliberately NOT written back into `data` or re-fetched on invalidate.
	let keyName = $state('');
	let keyBusy = $state(false);
	let keyError = $state<string | null>(null);
	let mintedKey = $state<string | null>(null);
	let keyCopied = $state(false);
	let keyCopyTimer: ReturnType<typeof setTimeout> | undefined;

	// The one moment this value exists: copying it is the whole point of the
	// reveal, and a select-all code block still leaves the operator to get it
	// right by hand.
	async function copyMintedKey() {
		if (!mintedKey) return;
		try {
			await navigator.clipboard.writeText(mintedKey);
			keyCopied = true;
			clearTimeout(keyCopyTimer);
			keyCopyTimer = setTimeout(() => (keyCopied = false), 2000);
		} catch {
			// clipboard unavailable (an insecure origin, a denied permission) -
			// the key stays selectable, which is why it is not the only path.
			keyError = 'Could not copy - select the key and copy it by hand.';
		}
	}

	async function mintKey(event: SubmitEvent) {
		event.preventDefault();
		keyBusy = true;
		keyError = null;
		try {
			const response = await fetch(`/api/projects/${data.projectId}/keys`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: keyName.trim() })
			});
			const body = (await response.json().catch(() => null)) as {
				key?: string;
				error?: string;
			} | null;
			if (!response.ok || !body?.key) {
				keyError = body?.error ?? 'Could not create the key.';
				return;
			}
			mintedKey = body.key;
			keyName = '';
			await invalidateAll();
		} catch {
			keyError = 'Could not reach the control plane.';
		} finally {
			keyBusy = false;
		}
	}

	async function revokeKey(keyId: string) {
		keyBusy = true;
		keyError = null;
		try {
			const response = await fetch(`/api/projects/${data.projectId}/keys/${keyId}`, {
				method: 'DELETE'
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { error?: string } | null;
				keyError = body?.error ?? 'Could not revoke the key.';
				return;
			}
			mintedKey = null;
			await invalidateAll();
		} catch {
			keyError = 'Could not reach the control plane.';
		} finally {
			keyBusy = false;
		}
	}

	// Delete (typed-id confirmation, like the table and collection panels).
	let deleteOpen = $state(false);
	let deleteConfirm = $state('');
	let deleteError = $state<string | null>(null);
	let deleteBusy = $state(false);

	async function deleteProject() {
		if (deleteConfirm !== data.projectId) return;
		deleteBusy = true;
		deleteError = null;
		try {
			const response = await fetch(`/api/registry/projects/${data.projectId}`, {
				method: 'DELETE'
			});
			// 207: the registration is gone but an agent kept data - the project
			// is deleted from the console's point of view either way.
			if (!response.ok && response.status !== 207) {
				const body = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(body?.error ?? `request failed (HTTP ${response.status})`);
			}
			deleteOpen = false;
			await goto(resolve('/(app)/dashboard/(account)'), { invalidateAll: true });
		} catch (error) {
			deleteError = error instanceof Error ? error.message : String(error);
		} finally {
			deleteBusy = false;
		}
	}
</script>

<svelte:head>
	<title>Settings · {data.projectId} · Frostbase</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-8" data-testid="settings-page">
	<div class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
		<p class="font-mono text-xs break-all text-muted-foreground">{data.projectId}</p>
	</div>

	{#if !data.project}
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Not a registered project</Card.Title>
				<Card.Description>
					This id has no registry row to manage - demo projects are throwaway and expire on their
					own. Create a real project from the projects overview to get settings.
				</Card.Description>
			</Card.Header>
		</Card.Root>
	{:else}
		<Card.Root class="overflow-hidden py-0">
			<Card.Content class="divide-y p-0">
				<!-- SaaS settings rows: what-it-is on the left, the control on the
				     right, one bordered row per setting. -->
				<div class="grid gap-3 px-6 py-5 sm:grid-cols-[240px_minmax(0,1fr)] sm:gap-8">
					<div>
						<p class="text-sm font-medium">Project name</p>
						<p class="mt-1 text-xs text-muted-foreground">Display-only, and yours to change.</p>
					</div>
					<div>
						<form class="flex flex-wrap items-end gap-3" onsubmit={rename}>
							<div class="min-w-48 flex-1 space-y-1.5">
								<Label for="project-name" class="sr-only">Name</Label>
								<Input id="project-name" bind:value={projectName} required maxlength={64} />
							</div>
							<Button
								type="submit"
								variant="outline"
								disabled={renameBusy}
								data-testid="rename-project"
							>
								{renameBusy ? 'Saving…' : 'Save'}
							</Button>
						</form>
						{#if renameError}
							<p class="mt-2 text-sm text-destructive" data-testid="rename-project-error">
								{renameError}
							</p>
						{:else if renameSaved}
							<p class="mt-2 text-sm text-muted-foreground">Saved.</p>
						{/if}
					</div>
				</div>

				<div class="grid gap-3 px-6 py-5 sm:grid-cols-[240px_minmax(0,1fr)] sm:gap-8">
					<div>
						<p class="text-sm font-medium">Project id</p>
						<p class="mt-1 text-xs text-muted-foreground">
							The Durable Object name and API base path - it cannot be changed.
						</p>
					</div>
					<p class="self-center font-mono text-sm break-all">{data.project.id}</p>
				</div>

				{#if isBranch}
					<div class="grid gap-3 px-6 py-5 sm:grid-cols-[240px_minmax(0,1fr)] sm:gap-8">
						<div>
							<p class="text-sm font-medium">Branch</p>
							<p class="mt-1 text-xs text-muted-foreground">
								A fully isolated copy of the root's backend.
							</p>
						</div>
						<p class="flex items-center gap-1.5 self-center text-sm">
							<GitBranch class="h-3.5 w-3.5 text-muted-foreground" />
							<span class="font-mono">{data.project.branchName}</span>
							<span class="text-muted-foreground">of</span>
							<span class="font-mono">{data.project.parentId}</span>
						</p>
					</div>
				{/if}

				<div class="grid gap-3 px-6 py-5 sm:grid-cols-[240px_minmax(0,1fr)] sm:gap-8">
					<div>
						<p class="text-sm font-medium">Created</p>
					</div>
					<p class="self-center text-sm">{new Date(data.project.createdAt).toLocaleDateString()}</p>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root data-testid="service-keys-card">
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base">
					<KeyRound class="h-4 w-4 text-primary" /> Admin service keys
				</Card.Title>
				<Card.Description>
					Admin-grade over this project, for a server with no signed-in user: crons, queue
					consumers, webhook handlers, seed scripts. In a browser your users' own tokens are the
					credential and you need none of this — a key is <strong>refused outright</strong> from any
					request carrying an <code>Origin</code>, so it cannot work in frontend code.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<p class="text-xs text-muted-foreground">
					A key reads and writes <strong>this project's</strong> data with full access, ignoring
					collection access modes and validators — the Admin-SDK contract. It cannot create or
					delete projects, mint other keys, or touch operator accounts.
					{#if isBranch}
						This key covers <span class="font-mono">{data.projectId}</span> only; the root and its other
						branches each need their own.
					{/if}
				</p>

				{#if mintedKey}
					<div class="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
						<p class="text-sm font-medium">Copy it now — it is never shown again.</p>
						<div class="flex items-start gap-2">
							<code
								class="min-w-0 flex-1 font-mono text-xs break-all select-all"
								data-testid="service-key-secret">{mintedKey}</code
							>
							<Button
								variant="outline"
								size="sm"
								class="shrink-0 gap-1.5"
								onclick={copyMintedKey}
								data-testid="copy-service-key"
							>
								{#if keyCopied}
									<Check class="h-3.5 w-3.5" /> Copied
								{:else}
									<Copy class="h-3.5 w-3.5" /> Copy
								{/if}
							</Button>
						</div>
					</div>
				{/if}

				{#if data.serviceKeys.length}
					<ul class="divide-y rounded-md border" data-testid="service-key-list">
						{#each data.serviceKeys as entry (entry.id)}
							<li class="flex flex-wrap items-center gap-3 px-3 py-2.5">
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{entry.name}</p>
									<p class="text-xs text-muted-foreground">
										Created {new Date(entry.createdAt).toLocaleDateString()} ·
										{entry.lastUsedAt
											? `last used ${new Date(entry.lastUsedAt).toLocaleString()}`
											: 'never used'}
									</p>
								</div>
								<Button
									variant="ghost"
									size="sm"
									class="text-destructive"
									disabled={keyBusy}
									onclick={() => revokeKey(entry.id)}
									data-testid="revoke-service-key"
								>
									Revoke
								</Button>
							</li>
						{/each}
					</ul>
				{/if}

				<form class="flex flex-wrap items-end gap-3" onsubmit={mintKey}>
					<div class="min-w-48 flex-1 space-y-1.5">
						<!-- Deliberately not "…name": `getByLabel` matches by substring,
						     and project-settings.ui.spec.ts locates the rename field with
						     getByLabel('Name'). A second labelled input containing that
						     word on the same page makes their locator ambiguous. -->
						<Label for="service-key-name" class="sr-only">What this key is for</Label>
						<Input
							id="service-key-name"
							bind:value={keyName}
							placeholder="What will use this key? e.g. nightly-import"
							required
							maxlength={60}
							data-testid="service-key-name"
						/>
					</div>
					<Button
						type="submit"
						variant="outline"
						disabled={keyBusy}
						data-testid="create-service-key"
					>
						{keyBusy ? 'Working…' : 'Create key'}
					</Button>
				</form>
				{#if keyError}
					<p class="text-sm text-destructive" data-testid="service-key-error">{keyError}</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="overflow-hidden border-destructive/40 py-0">
			<Card.Content class="p-0">
				<div class="flex flex-wrap items-center gap-4 px-6 py-5">
					<div class="min-w-0 flex-1">
						<p class="flex items-center gap-2 text-sm font-medium text-destructive">
							<TriangleAlert class="h-4 w-4" /> Danger zone
						</p>
						<p class="mt-1 text-xs text-muted-foreground">
							{#if !data.canDelete}
								Only organization owners and admins can delete {isBranch
									? 'a branch'
									: 'a project'}.
							{:else if isBranch}
								Deleting this branch erases its users, data, and files. The root project is
								untouched.
							{:else}
								Deleting this project erases its users, data, and files in every agent - branches
								included.
							{/if}
						</p>
					</div>
					<Button
						variant="destructive"
						class="shrink-0"
						disabled={!data.canDelete}
						onclick={() => {
							deleteConfirm = '';
							deleteError = null;
							deleteOpen = true;
						}}
						data-testid="delete-project"
					>
						{isBranch ? 'Delete branch' : 'Delete project'}
					</Button>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<Dialog.Root bind:open={deleteOpen}>
	<Dialog.Content data-testid="delete-project-panel">
		<Dialog.Header>
			<Dialog.Title>Delete "{data.projectId}"?</Dialog.Title>
			<Dialog.Description>
				{isBranch
					? 'The branch and everything in it are erased. This cannot be undone.'
					: 'The project, its branches, and everything in them are erased. This cannot be undone.'}
				Type the project id to confirm.
			</Dialog.Description>
		</Dialog.Header>
		<Input
			bind:value={deleteConfirm}
			class="font-mono"
			placeholder={data.projectId}
			autocomplete="off"
			data-testid="delete-project-confirm"
		/>
		{#if deleteError}
			<p class="text-sm text-destructive">{deleteError}</p>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (deleteOpen = false)}>Cancel</Button>
			<Button
				variant="destructive"
				disabled={deleteBusy || deleteConfirm !== data.projectId}
				onclick={() => void deleteProject()}
				data-testid="delete-project-submit"
			>
				{deleteBusy ? 'Deleting…' : isBranch ? 'Delete branch' : 'Delete project'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
