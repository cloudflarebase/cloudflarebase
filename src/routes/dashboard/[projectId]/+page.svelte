<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import {
		ArrowRight,
		Bot,
		Clock,
		Code2,
		Database,
		HardDrive,
		KeyRound,
		Radio,
		ShieldCheck,
		Zap
	} from '@lucide/svelte';

	let { data } = $props();

	const authHref = $derived(resolve('/dashboard/[projectId]/auth', { projectId: data.projectId }));

	const comingSoon = [
		{
			label: 'Database',
			icon: Database,
			desc: 'Document store on Durable Objects + D1, queried through Drizzle.'
		},
		{ label: 'Storage', icon: HardDrive, desc: 'R2 object storage with zero egress fees.' },
		{ label: 'Functions', icon: Zap, desc: 'Workers with microsecond cold starts.' },
		{ label: 'Realtime', icon: Radio, desc: 'WebSocket channels backed by Durable Objects.' },
		{ label: 'Cron & Queues', icon: Clock, desc: 'Scheduled jobs and background work.' }
	];
</script>

<svelte:head>
	<title>{data.projectId} · Project Overview · Cloudflarebase</title>
	<meta
		name="description"
		content="Manage the isolated Cloudflarebase demo backend for project {data.projectId}."
	/>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-3 py-5 sm:space-y-8 sm:px-6 sm:py-8">
	<div>
		<h1 class="text-2xl font-semibold">Project Overview</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Your browser's isolated Auth Agent sandbox. Build against it immediately—no account or credit
			card.
		</p>
	</div>

	<div class="grid gap-4 lg:grid-cols-3">
		<Card.Root class="border-primary/25 bg-primary/[0.04] lg:col-span-2">
			<Card.Header
				><Card.Title class="flex items-center gap-2"
					><ShieldCheck class="h-5 w-5 text-primary" /> Your private demo backend is ready</Card.Title
				><Card.Description
					>This unguessable project ID is saved in this browser for 30 days. Identity data is
					isolated in its own Durable Object.</Card.Description
				></Card.Header
			>
			<Card.Content class="flex flex-wrap gap-2"
				><Button href={authHref}><KeyRound class="mr-1.5 h-4 w-4" /> Open Auth Agent</Button><Button
					href={authHref}
					variant="outline"><Code2 class="mr-1.5 h-4 w-4" /> View integration guide</Button
				></Card.Content
			>
		</Card.Root>
		<Card.Root>
			<Card.Header
				><Card.Title class="flex items-center gap-2"
					><Bot class="h-5 w-5 text-primary" /> Project agent</Card.Title
				><Card.Description
					>Ask the Workers AI copilot about users, activity, providers, and auth health from any
					page.</Card.Description
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
		<p class="text-xs text-muted-foreground">The first complete Cloudflarebase primitive.</p>
	</div>

	<div class="grid grid-cols-1 gap-4">
		<!-- Authentication — live -->
		<Card.Root class="border-primary/30" data-testid="product-auth">
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
					Better Auth running inside this project's own agent — email/password, guests, and social
					sign-in.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-wrap items-end justify-between gap-4">
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
				<Button href={authHref} size="sm" variant="outline">
					Open <ArrowRight class="ml-1 h-3.5 w-3.5" />
				</Button>
			</Card.Content>
		</Card.Root>
	</div>

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
</div>
