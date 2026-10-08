<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import {
		ArrowRight,
		Bot,
		CodeXml,
		Database,
		HardDrive,
		KeyRound,
		ShieldCheck
	} from '@lucide/svelte';

	let { data } = $props();

	// The synthesized branch context is the demo signal (layout data merges
	// into page data); registered projects get the grown-up copy.
	const isDemo = $derived(!!data.branches?.demo);

	const authHref = $derived(
		resolve('/(app)/dashboard/[projectId]/auth', { projectId: data.projectId })
	);
	const dbHref = $derived(
		resolve('/(app)/dashboard/[projectId]/db', { projectId: data.projectId })
	);

	// Empty: everything this roadmap advertised has shipped. Functions and
	// Storage are live primitives now, and Realtime shipped with the db
	// gateway - a card promising a shipped feature is worse than no card. The
	// section renders only when there is something to promise.
	const comingSoon: { label: string; icon: typeof HardDrive; desc: string }[] = [];
</script>

<svelte:head>
	<title>{data.projectId} · Project Overview · Cloudflarebase</title>
	<!-- The TITLE names the project, because that is the browser tab and an
	     operator with six of them open needs it. The description deliberately
	     does not: the console is noindex, so its only real consumer is a chat
	     client unfurling a pasted link, and that card must never name somebody's
	     project. See src/routes/+layout.svelte. -->
	<meta name="description" content="Manage your Cloudflarebase backend." />
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-3 py-5 sm:space-y-8 sm:px-6 sm:py-8">
	<div>
		<h1 class="text-2xl font-semibold">Project Overview</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			{isDemo
				? "Your browser's isolated Auth Agent sandbox. Build against it immediately - no account or credit card."
				: 'Everything this project runs, in one place.'}
		</p>
	</div>

	<div class="grid gap-4 lg:grid-cols-3">
		<Card.Root class="border-primary/25 bg-primary/[0.04] lg:col-span-2">
			<Card.Header
				><Card.Title class="flex items-center gap-2"
					><ShieldCheck class="h-5 w-5 text-primary" />
					{isDemo ? 'Your private demo backend is ready' : 'Your backend is ready'}</Card.Title
				><Card.Description
					>{isDemo
						? 'This unguessable project ID is saved in this browser for 30 days. Identity data is isolated in its own Durable Object.'
						: 'Auth, database, and storage run as agents owned by this project - each keeps its data in its own Durable Object.'}</Card.Description
				></Card.Header
			>
			<Card.Content class="flex flex-wrap gap-2"
				><Button href={authHref}><KeyRound class="mr-1.5 h-4 w-4" /> Open Auth Agent</Button><Button
					href={dbHref}
					variant="outline"><Database class="mr-1.5 h-4 w-4" /> Open Database</Button
				></Card.Content
			>
		</Card.Root>
		<Card.Root>
			<Card.Header
				><Card.Title class="flex items-center gap-2"
					><Bot class="h-5 w-5 text-primary" /> Project agent</Card.Title
				><Card.Description
					>Ask the Workers AI copilot about users, activity, providers, auth health, and the data in
					your collections from any page.</Card.Description
				></Card.Header
			>
			<Card.Content
				><p class="text-xs text-muted-foreground">
					Open the agent panel in the lower-right corner to start.
				</p></Card.Content
			>
		</Card.Root>
	</div>

	<div>
		<h2 class="text-sm font-semibold">Available now</h2>
		<p class="text-xs text-muted-foreground">
			Complete Cloudflarebase primitives - each an isolated agent for this project.
		</p>
	</div>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
		<!-- Authentication - live -->
		<Card.Root class="flex flex-col border-primary/30" data-testid="product-auth">
			<Card.Header>
				<div class="flex items-center justify-between">
					<div
						class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
					>
						<KeyRound class="h-4.5 w-4.5" strokeWidth={1.8} />
					</div>
					<Badge class="gap-1.5" variant="outline">
						<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
						live
					</Badge>
				</div>
				<Card.Title class="pt-2">Authentication</Card.Title>
				<Card.Description>
					Better Auth running inside this project's own agent - email/password, guests, and social
					sign-in.
				</Card.Description>
			</Card.Header>
			<Card.Content class="@container mt-auto flex flex-wrap items-end justify-between gap-4">
				<div class="flex gap-6">
					<div>
						<p class="text-2xl font-semibold tabular-nums" data-testid="overview-users-count">
							{data.overview.state.users}
						</p>
						<p class="text-xs text-muted-foreground">users</p>
					</div>
					<div>
						<p class="text-2xl font-semibold tabular-nums" data-testid="overview-sessions-count">
							{data.overview.state.activeSessions}
						</p>
						<p class="text-xs text-muted-foreground">sessions</p>
					</div>
				</div>
				<div class="ml-auto flex shrink-0 gap-2">
					<Button href={`${authHref}/integration`} size="sm" variant="outline">
						<CodeXml class="mr-1 h-3.5 w-3.5 @max-[26rem]:mr-0" /><span class="@max-[26rem]:sr-only"
							>Integration</span
						>
					</Button>
					<Button href={authHref} size="sm" variant="outline">
						Open <ArrowRight class="ml-1 h-3.5 w-3.5" />
					</Button>
				</div>
			</Card.Content>
		</Card.Root>

		<!-- Database - live -->
		<Card.Root class="flex flex-col border-primary/30" data-testid="product-db">
			<Card.Header>
				<div class="flex items-center justify-between">
					<div
						class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
					>
						<Database class="h-4.5 w-4.5" strokeWidth={1.8} />
					</div>
					<Badge class="gap-1.5" variant="outline">
						<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
						live
					</Badge>
				</div>
				<Card.Title class="pt-2">Database</Card.Title>
				<Card.Description>
					JSON documents and typed SQL tables, both with live queries - one isolated Durable Object
					per collection or table, pushed to subscribers as writes happen.
				</Card.Description>
			</Card.Header>
			<Card.Content class="@container mt-auto flex flex-wrap items-end justify-between gap-4">
				<div class="flex gap-6">
					<div>
						<p class="text-2xl font-semibold tabular-nums" data-testid="overview-collections-count">
							{data.dbOverview?.collections.length ?? 0}
						</p>
						<p class="text-xs text-muted-foreground">collections</p>
					</div>
					<div>
						<p class="text-2xl font-semibold tabular-nums" data-testid="overview-documents-count">
							{data.dbOverview?.state.totalDocs ?? 0}
						</p>
						<p class="text-xs text-muted-foreground">documents</p>
					</div>
				</div>
				<div class="ml-auto flex shrink-0 gap-2">
					<Button href={`${dbHref}/integration`} size="sm" variant="outline">
						<CodeXml class="mr-1 h-3.5 w-3.5 @max-[26rem]:mr-0" /><span class="@max-[26rem]:sr-only"
							>Integration</span
						>
					</Button>
					<Button href={dbHref} size="sm" variant="outline">
						Open <ArrowRight class="ml-1 h-3.5 w-3.5" />
					</Button>
				</div>
			</Card.Content>
		</Card.Root>
	</div>

	{#if comingSoon.length}
		<div>
			<h2 class="text-sm font-semibold">Roadmap</h2>
			<p class="text-xs text-muted-foreground">
				Next primitives will follow the same one-agent-per-project architecture.
			</p>
		</div>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each comingSoon as product (product.label)}
				<Card.Root class="opacity-70">
					<Card.Header>
						<div class="flex items-center justify-between">
							<div
								class="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"
							>
								<product.icon class="h-4.5 w-4.5" strokeWidth={1.8} />
							</div>
							<Badge variant="outline" class="text-muted-foreground/60">soon</Badge>
						</div>
						<Card.Title class="pt-2">{product.label}</Card.Title>
						<Card.Description>{product.desc}</Card.Description>
					</Card.Header>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>
