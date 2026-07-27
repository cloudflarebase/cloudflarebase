<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ConsoleShell from '$lib/components/console-shell.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { projectIdSchema } from '$lib/schemas/auth';
	import { ChevronRight, Database } from '@lucide/svelte';

	let { data } = $props();

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

<ConsoleShell wide>
	<div class="space-y-8">
		<div class="space-y-1.5">
			<h1 class="text-2xl font-semibold tracking-tight">Projects</h1>
			<p class="text-sm text-muted-foreground">
				Each project runs its own agent, backed by its own database.
			</p>
		</div>

		{#if data.projects.length}
			<div class="grid gap-2" data-testid="project-list">
				{#each data.projects as project (project.id)}
					<a
						href={resolve('/(app)/dashboard/[projectId]', { projectId: project.id })}
						class="group flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary hover:bg-accent/40"
					>
						<Database class="h-5 w-5 shrink-0 text-muted-foreground" />
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium">{project.name}</p>
							<p class="truncate font-mono text-xs text-muted-foreground">{project.id}</p>
						</div>
						<ChevronRight
							class="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
						/>
					</a>
				{/each}
			</div>
		{/if}

		<Card.Root data-testid="create-project">
			<Card.Header>
				<Card.Title class="text-base">
					{data.projects.length ? 'New project' : 'Create your first project'}
				</Card.Title>
				<Card.Description>
					The id becomes the project's Durable Object name and its API base path - it cannot be
					changed later.
				</Card.Description>
			</Card.Header>
			<Card.Content>
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

					<Button type="submit" disabled={creating}>
						{creating ? 'Creating…' : 'Create project'}
					</Button>
				</form>
			</Card.Content>
		</Card.Root>
	</div>
</ConsoleShell>
