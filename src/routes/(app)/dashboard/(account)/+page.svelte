<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { CONSOLE_AUTH_BASE } from '$lib/console';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { projectIdSchema } from '$lib/schemas/auth';
	import { ChevronRight, Database, GitBranch, Mail, Plus, Trash2 } from '@lucide/svelte';
	import type { RegistryProject } from '$lib/agents';

	let { data } = $props();

	// The create form lives in a dialog behind the "+ New project" button
	// (Supabase-style); the empty state opens the same dialog.
	let createOpen = $state(false);

	// Client-side filter over the (org-scoped, <=100 rows) list - matches the
	// root's name/id or any branch id, so a branch search surfaces its root.
	let query = $state('');

	let inviteBusy = $state<string | null>(null);

	async function answerInvitation(invitationId: string, accept: boolean) {
		if (inviteBusy) return;
		inviteBusy = invitationId;
		try {
			await fetch(
				`${CONSOLE_AUTH_BASE}/organization/${accept ? 'accept-invitation' : 'reject-invitation'}`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ invitationId })
				}
			);
			await invalidateAll();
		} finally {
			inviteBusy = null;
		}
	}

	// Branches group under their root project instead of listing as siblings
	//. parentId decides - never the id's shape, so
	// grandfathered roots containing `--` stay top-level. A branch whose root
	// row is somehow missing degrades to a top-level row rather than vanishing.
	const rootIds = $derived(
		data.projects.filter((project) => !project.parentId).map((project) => project.id)
	);
	const groups = $derived(
		data.projects
			.filter((project) => !project.parentId || !rootIds.includes(project.parentId))
			.map((root) => ({
				root,
				branches: data.projects.filter((branch) => branch.parentId === root.id)
			}))
	);
	const filteredGroups = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return groups;
		return groups.filter(
			({ root, branches }) =>
				root.name.toLowerCase().includes(needle) ||
				root.id.toLowerCase().includes(needle) ||
				branches.some((branch) => branch.id.toLowerCase().includes(needle))
		);
	});

	// Deleting a branch from the row that lists it. The branch's own settings
	// page has carried this since branches shipped, but it is two navigations
	// away (switch into the branch, then open settings) - which reads as "you
	// cannot delete a branch". Same registry DELETE, same typed-id confirm as
	// every other destructive panel in the console.
	let deleteTarget = $state<RegistryProject | null>(null);
	let deleteConfirm = $state('');
	let deleteError = $state<string | null>(null);
	let deleteBusy = $state(false);

	async function deleteBranch() {
		if (!deleteTarget || deleteConfirm !== deleteTarget.id) return;
		deleteBusy = true;
		deleteError = null;
		try {
			const response = await fetch(`/api/registry/projects/${deleteTarget.id}`, {
				method: 'DELETE'
			});
			// 207: the registration is gone but an agent kept data - deleted from
			// the console's point of view either way.
			if (!response.ok && response.status !== 207) {
				const body = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(body?.error ?? `request failed (HTTP ${response.status})`);
			}
			deleteTarget = null;
			await invalidateAll();
		} catch (cause) {
			deleteError = cause instanceof Error ? cause.message : String(cause);
		} finally {
			deleteBusy = false;
		}
	}

	let name = $state('');
	let id = $state('');
	let error = $state<string | null>(null);
	let creating = $state(false);

	// Suggest an id from the name until the operator types their own.
	let idTouched = $state(false);
	const suggestedId = $derived(
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 32)
	);
	const effectiveId = $derived(idTouched ? id : suggestedId);

	async function create(event: SubmitEvent) {
		event.preventDefault();
		error = null;

		const parsed = projectIdSchema.safeParse(effectiveId);
		if (!parsed.success) {
			error = parsed.error.issues[0]?.message ?? 'Invalid project id.';
			return;
		}

		creating = true;
		try {
			const response = await fetch('/api/registry/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: parsed.data, name: name.trim() || parsed.data })
			});

			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { error?: string } | null;
				error = body?.error ?? 'Could not create the project.';
				return;
			}

			await invalidateAll();
			await goto(resolve('/(app)/dashboard/[projectId]', { projectId: parsed.data }));
		} finally {
			creating = false;
		}
	}
</script>

<svelte:head>
	<title>Projects · Cloudflarebase</title>
</svelte:head>

<div class="space-y-8">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="space-y-1.5">
			<h1 class="text-2xl font-semibold tracking-tight">Projects</h1>
			<p class="text-sm text-muted-foreground">
				Each project runs its own agent, backed by its own database.
			</p>
		</div>
		<Button
			class="gap-1.5"
			data-testid="new-project"
			onclick={() => {
				error = null;
				createOpen = true;
			}}
		>
			<Plus class="h-4 w-4" /> New project
		</Button>
	</div>

	{#each data.pendingInvitations as invitation (invitation.id)}
		<div
			class="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4"
			data-testid="pending-invitation"
		>
			<Mail class="h-5 w-5 shrink-0 text-primary" />
			<div class="min-w-0 flex-1">
				<p class="text-sm font-medium">
					You have been invited to <span class="font-semibold">{invitation.organizationName}</span>
				</p>
				{#if invitation.inviterEmail}
					<p class="truncate text-xs text-muted-foreground">
						Invited by {invitation.inviterEmail}
					</p>
				{/if}
			</div>
			<div class="flex shrink-0 gap-2">
				<Button
					size="sm"
					disabled={inviteBusy === invitation.id}
					data-testid="accept-invitation"
					onclick={() => answerInvitation(invitation.id, true)}
				>
					Accept
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={inviteBusy === invitation.id}
					onclick={() => answerInvitation(invitation.id, false)}
				>
					Decline
				</Button>
			</div>
		</div>
	{/each}

	{#if data.projects.length}
		<div class="space-y-4">
			{#if groups.length > 5}
				<Input
					bind:value={query}
					placeholder="Search projects…"
					class="max-w-xs"
					data-testid="project-search"
				/>
			{/if}
			<div class="grid items-start gap-4 sm:grid-cols-2" data-testid="project-list">
				{#each filteredGroups as { root: project, branches } (project.id)}
					<div
						class="group flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/60"
					>
						<a
							href={resolve('/(app)/dashboard/[projectId]', { projectId: project.id })}
							class="flex min-h-36 flex-1 flex-col gap-4 p-6 transition-colors hover:bg-accent/40"
						>
							<div class="flex items-start gap-3">
								<div
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background"
								>
									<Database class="h-4 w-4 text-muted-foreground" />
								</div>
								<div class="min-w-0 flex-1">
									<p class="truncate font-medium">{project.name}</p>
									<p class="truncate font-mono text-xs text-muted-foreground">{project.id}</p>
								</div>
								<ChevronRight
									class="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
								/>
							</div>
							<!-- Two facts, labelled like instrument readings rather than
							     sold: the quiet flex is that a fresh project is already
							     served from Cloudflare's whole network, and it lands
							     harder stated once than explained in a second line. -->
							<div class="mt-auto grid grid-cols-2 gap-4">
								<div>
									<p class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
										Region
									</p>
									<p class="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium">
										<span
											class="h-1.5 w-1.5 shrink-0 rounded-full bg-[oklch(0.72_0.15_150)] shadow-[0_0_6px_oklch(0.72_0.15_150/80%)]"
											aria-hidden="true"
										></span>
										Earth
									</p>
								</div>
								<div>
									<p class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
										Branches
									</p>
									<!-- +1 for the root itself: `main` IS the bare project id,
									     which is why createBranch refuses that name and why the
									     switcher lists it. A project with no derived rows still
									     has one branch, so 0 would never be a true answer. -->
									<p class="mt-0.5 text-[13px] font-medium tabular-nums">
										{branches.length + 1}
									</p>
								</div>
							</div>
						</a>
						<!-- The strip lists every branch, `main` included: the root row
						     IS main (createBranch refuses the name because it would alias
						     the bare id), so omitting it described the project as having
						     no branches at all. It has no delete - deleting main means
						     deleting the project, which lives in the project's own
						     settings behind the same typed-id confirmation - and no id
						     beside it either, since main's id IS the bare project id
						     the card header shows two lines up. Branch rows do carry
						     theirs: `<root>--<branch>` is information nothing else on
						     the card states. -->
						<div class="space-y-0.5 border-t bg-muted/30 px-2 py-2">
							<a
								href={resolve('/(app)/dashboard/[projectId]', { projectId: project.id })}
								class="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent"
								data-testid="branch-row-main"
							>
								<GitBranch class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								<span class="shrink-0 font-mono font-medium">main</span>
							</a>
							{#each branches as branch (branch.id)}
								<div
									class="group/branch flex items-center rounded-md transition-colors hover:bg-accent"
								>
									<a
										href={resolve('/(app)/dashboard/[projectId]', { projectId: branch.id })}
										class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-xs"
										data-testid="branch-row"
									>
										<GitBranch class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
										<span class="shrink-0 font-mono font-medium">{branch.branchName}</span>
										<span class="truncate font-mono text-muted-foreground">{branch.id}</span>
									</a>
									<!-- Hover-revealed, but never hover-ONLY: focus-visible
									     brings it back for keyboard operators. -->
									<button
										type="button"
										class="mr-1 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover/branch:opacity-100 hover:text-destructive focus-visible:opacity-100"
										aria-label="Delete branch {branch.branchName}"
										data-testid="delete-branch"
										onclick={() => {
											deleteTarget = branch;
											deleteConfirm = '';
											deleteError = null;
										}}
									>
										<Trash2 class="h-3.5 w-3.5" />
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if !data.projects.length}
		<Card.Root class="border-dashed">
			<Card.Content class="flex flex-col items-center gap-3 py-12 text-center">
				<Database class="h-8 w-8 text-muted-foreground/60" />
				<div class="space-y-1">
					<p class="font-medium">No projects yet</p>
					<p class="text-sm text-muted-foreground">
						Each project runs its own agents with their own databases.
					</p>
				</div>
				<Button
					class="mt-2 gap-1.5"
					data-testid="create-first-project"
					onclick={() => {
						error = null;
						createOpen = true;
					}}
				>
					<Plus class="h-4 w-4" /> Create your first project
				</Button>
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<Dialog.Root
	open={!!deleteTarget}
	onOpenChange={(open) => {
		if (!open) deleteTarget = null;
	}}
>
	<Dialog.Content data-testid="delete-branch-panel">
		<Dialog.Header>
			<Dialog.Title>Delete "{deleteTarget?.id}"?</Dialog.Title>
			<Dialog.Description>
				Deleting this branch erases its users, data, and files. The root project is untouched.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-1.5">
			<Label for="delete-branch-confirm">
				Type <span class="font-mono font-medium">{deleteTarget?.id}</span> to confirm
			</Label>
			<Input id="delete-branch-confirm" bind:value={deleteConfirm} autocomplete="off" />
		</div>
		{#if deleteError}
			<p class="text-sm text-destructive" data-testid="delete-branch-error">{deleteError}</p>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (deleteTarget = null)}>Cancel</Button>
			<Button
				variant="destructive"
				disabled={deleteBusy || deleteConfirm !== deleteTarget?.id}
				onclick={deleteBranch}
				data-testid="confirm-delete-branch"
			>
				{deleteBusy ? 'Deleting…' : 'Delete branch'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content data-testid="create-project">
		<Dialog.Header>
			<Dialog.Title>New project</Dialog.Title>
			<Dialog.Description>
				The id becomes the project's Durable Object name and its API base path - it cannot be
				changed later.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={create}>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="space-y-1.5">
					<Label for="project-name">Name</Label>
					<Input id="project-name" bind:value={name} placeholder="My app" required />
				</div>

				<div class="space-y-1.5">
					<Label for="project-id">Project id</Label>
					<Input
						id="project-id"
						class="font-mono"
						value={effectiveId}
						oninput={(event) => {
							idTouched = true;
							id = event.currentTarget.value;
						}}
						placeholder="my-app"
						required
					/>
				</div>
			</div>

			{#if error}
				<p class="text-sm text-destructive" data-testid="create-project-error">{error}</p>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
				<Button type="submit" disabled={creating}>
					{creating ? 'Creating…' : 'Create project'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
