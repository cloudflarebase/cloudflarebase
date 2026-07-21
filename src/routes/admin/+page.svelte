<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import CountryFlag from '$lib/components/country-flag.svelte';
	import ModeToggle from '$lib/components/mode-toggle.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import {
		Activity,
		FlaskConical,
		KeyRound,
		LogOut,
		RefreshCw,
		ShieldCheck,
		Users
	} from '@lucide/svelte';

	let { data, form } = $props();

	const fleet = $derived(data.fleet);

	const stats = $derived(
		fleet
			? [
					{
						id: 'demos',
						label: 'Demos created',
						value: `${fleet.totals.demoProjects}`,
						icon: FlaskConical
					},
					{
						id: 'users',
						label: 'Users across projects',
						value: `${fleet.totals.users}`,
						icon: Users
					},
					{
						id: 'registered',
						label: 'Registered / guests',
						value: `${fleet.totals.registeredUsers} / ${fleet.totals.anonymousUsers}`,
						icon: KeyRound
					},
					{
						id: 'sessions',
						label: 'Active sessions',
						value: `${fleet.totals.activeSessions}`,
						icon: Activity
					}
				]
			: []
	);

	const sourceLabel = $derived(
		fleet?.source === 'analytics-engine'
			? 'Analytics Engine'
			: fleet?.source === 'local-d1'
				? 'local D1 mirror'
				: 'no data source'
	);

	/** Distinct DO colo countries with how many projects run there. */
	const locations = $derived(
		fleet
			? [
					...fleet.projects.reduce((map, project) => {
						const country = project.counts?.coloCountry;
						if (country) map.set(country, (map.get(country) ?? 0) + 1);
						return map;
					}, new Map<string, number>())
				].sort((a, b) => b[1] - a[1])
			: []
	);

	let refreshing = $state(false);

	async function refresh() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	// Keep the launch-day view fresh without hammering the fleet endpoint.
	$effect(() => {
		if (!data.authed) return;
		const interval = setInterval(() => invalidateAll(), 30_000);
		return () => clearInterval(interval);
	});

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

	function formatDay(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>Fleet admin · Cloudflarebase</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if !data.configured}
	<div class="flex min-h-svh items-center justify-center px-4">
		<Card.Root class="max-w-md">
			<Card.Header>
				<Card.Title>Admin dashboard is not configured</Card.Title>
				<Card.Description>
					Set an <code>ADMIN_SECRET</code> for this environment — a var in
					<code>wrangler.jsonc</code> for local/test, or
					<code>wrangler secret put ADMIN_SECRET</code> for deployed workers.
				</Card.Description>
			</Card.Header>
		</Card.Root>
	</div>
{:else if !data.authed}
	<div class="relative flex min-h-svh items-center justify-center px-4">
		<ModeToggle class="absolute top-4 right-4" variant="ghost" />
		<Card.Root class="w-full max-w-sm" data-testid="admin-login">
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<ShieldCheck class="h-5 w-5 text-primary" /> Fleet admin
				</Card.Title>
				<Card.Description>Enter the admin password to see all demo projects.</Card.Description>
			</Card.Header>
			<Card.Content>
				<form method="POST" action="?/login" class="space-y-3" use:enhance>
					<Input
						type="password"
						name="password"
						placeholder="Admin password"
						autocomplete="current-password"
						data-testid="admin-password"
					/>
					<Button type="submit" class="w-full" data-testid="admin-login-submit">Unlock</Button>
					{#if form?.incorrect}
						<p class="text-sm text-destructive" data-testid="admin-login-error">
							That password is not correct.
						</p>
					{/if}
				</form>
			</Card.Content>
		</Card.Root>
	</div>
{:else if fleet}
	<div class="mx-auto max-w-6xl space-y-6 px-3 py-5 sm:px-6 sm:py-8" data-testid="admin-page">
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<h1 class="text-2xl font-semibold">Fleet admin</h1>
				<p class="mt-1 text-sm text-muted-foreground">
					Every project seen in auth events, with live counts from each project's agent.
				</p>
			</div>
			<div class="flex items-center gap-2">
				<Badge variant="outline" class="gap-1.5" data-testid="admin-source">
					<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
					{sourceLabel}
				</Badge>
				<Button size="sm" variant="outline" onclick={refresh} disabled={refreshing}>
					<RefreshCw class={['mr-1.5 h-3.5 w-3.5', refreshing && 'animate-spin']} /> Refresh
				</Button>
				<form method="POST" action="?/logout" use:enhance>
					<Button size="sm" variant="ghost" type="submit">
						<LogOut class="mr-1.5 h-3.5 w-3.5" /> Sign out
					</Button>
				</form>
				<ModeToggle class="size-8" testId="admin-mode-toggle" />
			</div>
		</div>

		{#if fleet.error}
			<p class="text-sm text-destructive">Fleet listing degraded: {fleet.error}</p>
		{/if}

		<div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
			{#each stats as stat (stat.id)}
				<Card.Root class="py-4" data-testid={`admin-stat-${stat.id}`}>
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

		<Card.Root data-testid="admin-projects-card">
			<Card.Header>
				<Card.Title>Projects</Card.Title>
				<Card.Description>
					{fleet.totals.projects} project{fleet.totals.projects === 1 ? '' : 's'} with auth activity in
					the last 90 days ({fleet.totals.demoProjects} browser demos) · updated {timeAgo(
						fleet.generatedAt
					)}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if locations.length > 0}
					<div class="mb-4 flex flex-wrap items-center gap-2" data-testid="admin-locations">
						<span class="text-xs text-muted-foreground">Agent locations</span>
						{#each locations as [country, projectCount] (country)}
							<Badge variant="outline" class="gap-1.5">
								<CountryFlag code={country} />
								{country} · {projectCount}
							</Badge>
						{/each}
					</div>
				{/if}
				{#if fleet.projects.length === 0}
					<p class="py-8 text-center text-sm text-muted-foreground" data-testid="admin-empty">
						No projects yet — they appear here as soon as a visitor's demo emits its first auth
						event.
					</p>
				{:else}
					<div class="overflow-x-auto">
						<Table.Root class="min-w-[52rem]">
							<Table.Header>
								<Table.Row>
									<Table.Head>Project</Table.Head>
									<Table.Head>Location</Table.Head>
									<Table.Head class="text-right">Users</Table.Head>
									<Table.Head class="text-right">Registered</Table.Head>
									<Table.Head class="text-right">Guests</Table.Head>
									<Table.Head class="text-right">Sessions</Table.Head>
									<Table.Head class="text-right">Events (90d)</Table.Head>
									<Table.Head class="text-right">First seen</Table.Head>
									<Table.Head class="text-right">Last activity</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each fleet.projects as project (project.projectId)}
									<Table.Row data-testid="admin-project-row">
										<Table.Cell>
											<a
												class="font-mono text-xs underline-offset-4 hover:underline"
												href={resolve('/dashboard/[projectId]', { projectId: project.projectId })}
											>
												{project.projectId}
											</a>
											{#if project.demo}
												<Badge variant="outline" class="ml-1.5 text-muted-foreground">demo</Badge>
											{/if}
										</Table.Cell>
										<Table.Cell class="text-xs text-muted-foreground">
											{#if project.counts?.colo}
												<span class="inline-flex items-center gap-1.5">
													<CountryFlag code={project.counts.coloCountry} />
													{project.counts.colo}
												</span>
											{:else}
												—
											{/if}
										</Table.Cell>
										<Table.Cell class="text-right tabular-nums" data-testid="admin-project-users">
											{project.counts ? project.counts.users : '—'}
										</Table.Cell>
										<Table.Cell class="text-right tabular-nums">
											{project.counts ? project.counts.registeredUsers : '—'}
										</Table.Cell>
										<Table.Cell class="text-right tabular-nums">
											{project.counts ? project.counts.anonymousUsers : '—'}
										</Table.Cell>
										<Table.Cell class="text-right tabular-nums">
											{project.counts ? project.counts.activeSessions : '—'}
										</Table.Cell>
										<Table.Cell class="text-right tabular-nums">{project.events}</Table.Cell>
										<Table.Cell class="text-right text-xs text-muted-foreground">
											{formatDay(project.firstSeenAt)}
										</Table.Cell>
										<Table.Cell class="text-right text-xs text-muted-foreground">
											{project.lastSeenAt ? timeAgo(project.lastSeenAt) : '—'}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
					{#if fleet.totals.uncountedProjects > 0}
						<p class="mt-3 text-xs text-muted-foreground">
							{fleet.totals.uncountedProjects} project{fleet.totals.uncountedProjects === 1
								? ''
								: 's'} listed without live counts (beyond the per-request fan-out limit or unreachable).
						</p>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
{/if}
