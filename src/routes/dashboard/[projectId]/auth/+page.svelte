<script lang="ts">
	import { dev } from '$app/environment';
	import type {
		AgentChatMessage,
		AgentChatReply,
		AuthAgentState,
		AuthAnalytics,
		AuthOverview
	} from '$lib/agents';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';
	import {
		Activity,
		Bot,
		Code2,
		Globe,
		KeyRound,
		LogIn,
		LogOut,
		Radio,
		Rocket,
		SendHorizontal,
		Settings,
		Trash2,
		UserPlus,
		UserRound,
		Users
	} from '@lucide/svelte';
	import { AgentClient } from 'agents/client';
	import { AreaChart } from 'layerchart';
	import { onMount } from 'svelte';

	let { data } = $props();
	let hydrated = $state(false);

	onMount(() => {
		hydrated = true;
	});

	// Initial values from the server load; kept in sync on navigation by the
	// $effect below and updated live via WebSocket state sync.
	// svelte-ignore state_referenced_locally
	let overview = $state<AuthOverview>(data.overview);
	// svelte-ignore state_referenced_locally
	let agentState = $state<AuthAgentState>(data.overview.state);
	// svelte-ignore state_referenced_locally
	let analytics = $state<AuthAnalytics>(data.analytics);
	let live = $state(false);
	let activeTab = $state('users');
	let playgroundTab = $state('sign-up');

	type SessionInfo = {
		user: { name: string; email: string };
		session: { expiresAt: string };
	} | null;
	let session = $state<SessionInfo>(null);

	// Playground form state
	let email = $state('ada@example.com');
	let password = $state('correct-horse-battery');
	let name = $state('Ada Lovelace');
	let busy = $state(false);
	let authError = $state<string | null>(null);

	// Agent chat state
	let chatMessages = $state<AgentChatMessage[]>([]);
	let chatInput = $state('');
	let chatBusy = $state(false);
	// svelte-ignore state_referenced_locally
	let allowedOriginsInput = $state((data.overview.state.allowedOrigins ?? []).join('\n'));
	let settingsSaved = $state(false);
	// svelte-ignore state_referenced_locally
	let googleEnabled = $state((data.overview.state.enabledSocialProviders ?? []).includes('google'));
	// svelte-ignore state_referenced_locally
	let githubEnabled = $state((data.overview.state.enabledSocialProviders ?? []).includes('github'));
	let googleClientId = $state('');
	let googleClientSecret = $state('');
	let githubClientId = $state('');
	let githubClientSecret = $state('');

	const suggestedQuestions = [
		"What's our DAU/MAU?",
		'How many anonymous users do we have?',
		'Which providers do users sign in with?',
		'What countries are users from?'
	];

	const authBase = $derived(`/api/projects/${data.projectId}/auth`);

	// Reset local state when navigating between projects.
	$effect(() => {
		overview = data.overview;
		agentState = data.overview.state;
		analytics = data.analytics;
		chatMessages = [];
		void loadChatHistory(data.projectId);
		allowedOriginsInput = (data.overview.state.allowedOrigins ?? []).join('\n');
		googleEnabled = (data.overview.state.enabledSocialProviders ?? []).includes('google');
		githubEnabled = (data.overview.state.enabledSocialProviders ?? []).includes('github');
	});

	// Realtime: connect to this project's AuthAgent. In dev the agent worker
	// runs on :8788; in production /agents/* is proxied by hooks.server.ts.
	$effect(() => {
		const projectId = data.projectId;
		const client = new AgentClient<AuthAgentState>({
			agent: 'auth-agent',
			name: projectId,
			host: dev ? 'localhost:8788' : window.location.host,
			onStateUpdate: (state) => {
				agentState = state;
				void refreshData(projectId);
			}
		});
		client.addEventListener('open', () => (live = true));
		client.addEventListener('close', () => (live = false));

		void refreshSession(projectId);
		// Polling safety net for when the WebSocket can't connect.
		const poll = setInterval(() => void refreshData(projectId), 5_000);

		return () => {
			clearInterval(poll);
			client.close();
		};
	});

	async function refreshData(projectId: string) {
		try {
			const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
			const [overviewRes, analyticsRes] = await Promise.all([
				fetch(`/api/projects/${projectId}/overview`),
				fetch(`/api/projects/${projectId}/analytics?timeZone=${encodeURIComponent(timeZone)}`)
			]);
			if (projectId !== data.projectId) return;
			if (overviewRes.ok) {
				overview = await overviewRes.json();
				agentState = overview.state;
			}
			if (analyticsRes.ok) {
				analytics = await analyticsRes.json();
			}
		} catch {
			// agent unreachable — keep last snapshot
		}
	}

	async function refreshSession(projectId: string) {
		try {
			const res = await fetch(`/api/projects/${projectId}/auth/get-session`);
			session = res.ok ? await res.json() : null;
		} catch {
			session = null;
		}
	}

	async function loadChatHistory(projectId: string) {
		try {
			const response = await fetch(`/api/projects/${projectId}/chat`);
			if (projectId !== data.projectId) return;
			if (!response.ok) {
				chatMessages = [];
				return;
			}
			const history = (await response.json()) as { messages: AgentChatMessage[] };
			chatMessages = history.messages;
		} catch {
			// Keep the panel usable if history is temporarily unavailable.
		}
	}

	async function authPost(path: string, body: Record<string, unknown> = {}) {
		busy = true;
		authError = null;
		try {
			const res = await fetch(`${authBase}/${path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const text = await res.text();
			const json = text ? JSON.parse(text) : null;
			if (!res.ok) {
				throw new Error(json?.message ?? `request failed (HTTP ${res.status})`);
			}
			await Promise.all([
				refreshSession(data.projectId),
				refreshData(data.projectId),
				loadChatHistory(data.projectId)
			]);
		} catch (err) {
			authError = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function socialSignIn(provider: 'google' | 'github') {
		busy = true;
		authError = null;
		try {
			const response = await fetch(`${authBase}/sign-in/social`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					provider,
					callbackURL: window.location.href,
					disableRedirect: true
				})
			});
			const result = (await response.json()) as { url?: string; message?: string };
			if (!response.ok || !result.url) {
				throw new Error(result.message ?? `Could not start ${provider} sign-in`);
			}
			window.location.assign(result.url);
		} catch (error) {
			authError = error instanceof Error ? error.message : String(error);
			busy = false;
		}
	}

	async function askAgent(question: string) {
		const trimmed = question.trim();
		if (!trimmed || chatBusy) return;
		chatBusy = true;
		chatInput = '';
		const pendingId = crypto.randomUUID();
		chatMessages = [
			...chatMessages,
			{ id: pendingId, role: 'user', content: trimmed, createdAt: new Date().toISOString() }
		];
		try {
			const res = await fetch(`/api/projects/${data.projectId}/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ question: trimmed })
			});
			const reply = (await res.json()) as AgentChatReply & { error?: string };
			if (res.ok) {
				chatMessages = [
					...chatMessages.filter((message) => message.id !== pendingId),
					reply.userMessage,
					reply.agentMessage
				];
			} else {
				chatMessages = [
					...chatMessages,
					{
						id: crypto.randomUUID(),
						role: 'agent',
						content: reply.error ?? 'The agent could not answer that.',
						createdAt: new Date().toISOString()
					}
				];
			}
		} catch {
			chatMessages = [
				...chatMessages,
				{
					id: crypto.randomUUID(),
					role: 'agent',
					content: 'The agent is unreachable right now.',
					createdAt: new Date().toISOString()
				}
			];
		} finally {
			chatBusy = false;
		}
	}

	async function adminDelete(kind: 'users' | 'sessions', id: string) {
		const label = kind === 'users' ? 'user and all of their sessions' : 'session';
		if (!confirm(`Delete this ${label}? This cannot be undone.`)) return;
		busy = true;
		authError = null;
		try {
			const response = await fetch(
				`/api/projects/${data.projectId}/admin/${kind}/${encodeURIComponent(id)}`,
				{
					method: 'DELETE'
				}
			);
			if (!response.ok) {
				const result = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(result?.error ?? `request failed (HTTP ${response.status})`);
			}
			await refreshData(data.projectId);
		} catch (error) {
			authError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	async function saveSettings() {
		busy = true;
		authError = null;
		settingsSaved = false;
		try {
			const allowedOrigins = allowedOriginsInput
				.split(/\r?\n|,/)
				.map((value) => value.trim())
				.filter(Boolean);
			const response = await fetch(`/api/projects/${data.projectId}/admin/settings`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					allowedOrigins,
					socialProviders: {
						...(googleEnabled
							? {
									google:
										googleClientId || googleClientSecret
											? { clientId: googleClientId, clientSecret: googleClientSecret }
											: { preserve: true }
								}
							: {}),
						...(githubEnabled
							? {
									github:
										githubClientId || githubClientSecret
											? { clientId: githubClientId, clientSecret: githubClientSecret }
											: { preserve: true }
								}
							: {})
					}
				})
			});
			const result = (await response.json()) as {
				allowedOrigins?: string[];
				enabledSocialProviders?: string[];
				error?: string;
			};
			if (!response.ok) throw new Error(result.error ?? `request failed (HTTP ${response.status})`);
			allowedOriginsInput = (result.allowedOrigins ?? []).join('\n');
			googleEnabled = (result.enabledSocialProviders ?? []).includes('google');
			githubEnabled = (result.enabledSocialProviders ?? []).includes('github');
			googleClientSecret = '';
			githubClientSecret = '';
			settingsSaved = true;
			await refreshData(data.projectId);
		} catch (error) {
			authError = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
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

	const eventIcons = {
		'project.provisioned': Rocket,
		'user.created': UserPlus,
		'user.deleted': Trash2,
		'session.created': LogIn,
		'session.revoked': LogOut
	} as const;

	const stats = $derived([
		{ id: 'users', label: 'Users', value: agentState.users, icon: Users },
		{ id: 'sessions', label: 'Active sessions', value: agentState.activeSessions, icon: KeyRound },
		{
			id: 'dau',
			label: 'DAU',
			value: ['connected', 'local'].includes(analytics.engine.status) ? analytics.dau : '—',
			icon: Activity
		},
		{
			id: 'mau',
			label: 'MAU',
			value: ['connected', 'local'].includes(analytics.engine.status) ? analytics.mau : '—',
			icon: Globe
		}
	]);

	const activityChart = $derived.by(() => {
		const counts = new Map(analytics.signupsLast7Days.map((point) => [point.day, point.count]));
		return Array.from({ length: 7 }, (_, index) => {
			const date = new Date();
			date.setDate(date.getDate() - (6 - index));
			const key = [
				date.getFullYear(),
				String(date.getMonth() + 1).padStart(2, '0'),
				String(date.getDate()).padStart(2, '0')
			].join('-');
			return {
				day: date.toLocaleDateString(undefined, { weekday: 'short' }),
				dateLabel: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
				fullDate: date.toLocaleDateString(undefined, {
					weekday: 'long',
					month: 'long',
					day: 'numeric'
				}),
				count: counts.get(key) ?? 0
			};
		});
	});
	const activityTotal = $derived(activityChart.reduce((sum, point) => sum + point.count, 0));
	const activityDateRange = $derived(
		activityChart.length
			? `${activityChart[0].dateLabel} – ${activityChart.at(-1)?.dateLabel}`
			: 'Last 7 days'
	);
	const activityChartConfig = { count: { label: 'Sign-ups', color: 'var(--color-primary)' } };
</script>

<svelte:head>
	<title>{data.projectId} · Authentication · Cloudflarebase</title>
</svelte:head>

<div class="mx-auto max-w-7xl space-y-6 px-6 py-8" data-testid="auth-page" data-hydrated={hydrated}>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold">Authentication</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				Served by this project's AuthAgent — a Durable Object running Better Auth on its own SQLite
				database.
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

	<div class="grid items-stretch gap-6 lg:grid-cols-3">
		<Card.Root class="lg:col-span-2">
			<Card.Header class="pb-2">
				<div>
					<Card.Title>Authentication activity</Card.Title>
					<Card.Description
						>New users over the last seven days from Analytics Engine.</Card.Description
					>
					<div class="mt-4 flex items-end gap-3">
						<p class="flex items-baseline gap-1.5">
							<span class="text-2xl leading-none font-semibold tabular-nums">{activityTotal}</span
							><span class="text-xs font-medium text-muted-foreground">sign-ups</span>
						</p>
						<p class="border-l pl-3 text-xs text-muted-foreground">{activityDateRange}</p>
					</div>
				</div>
			</Card.Header>
			<Card.Content>
				{#if ['connected', 'local'].includes(analytics.engine.status)}
					<Chart.Container config={activityChartConfig} class="aspect-auto h-52 w-full">
						<AreaChart
							data={activityChart}
							x="day"
							y="count"
							series={[{ key: 'count', label: 'Sign-ups', color: 'var(--color-count)' }]}
							props={{
								area: { fillOpacity: 0.18 },
								line: { strokeWidth: 2.5 },
								axis: { y: { tickCount: 4 } }
							}}
						>
							{#snippet tooltip()}
								<Chart.Tooltip indicator="line" />
							{/snippet}
						</AreaChart>
					</Chart.Container>
				{:else}
					<div
						class="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
					>
						{analytics.engine.status === 'write-only'
							? 'Events are flowing. Add Analytics Engine read credentials to visualize activity.'
							: analytics.engine.status === 'error'
								? 'Analytics Engine reads are temporarily unavailable.'
								: 'No sign-ups recorded in the last seven days.'}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root data-testid="activity-card">
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<Radio class="h-4 w-4 text-primary" /> Live activity
				</Card.Title>
				<Card.Description>Streamed from the agent via WebSocket state sync.</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if agentState.events.length === 0}
					<p class="py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
				{:else}
					<ScrollArea class="h-72 pr-3" type="always">
						<ol class="space-y-4">
							{#each agentState.events as event (event.id)}
								{@const Icon = eventIcons[event.type] ?? Activity}
								<li class="flex gap-3">
									<div
										class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
									>
										<Icon class="h-3.5 w-3.5" />
									</div>
									<div class="min-w-0">
										<p class="text-sm leading-snug">{event.message}</p>
										<p class="mt-0.5 font-mono text-[11px] text-muted-foreground">
											{event.type} · {timeAgo(event.at)}
										</p>
									</div>
								</li>
							{/each}
						</ol>
					</ScrollArea>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Stats -->
	<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
		{#each stats as stat (stat.id)}
			<Card.Root class="py-4" data-testid={`stat-${stat.id}`}>
				<Card.Content class="flex items-center justify-between px-5">
					<div>
						<p class="text-xs tracking-wide text-muted-foreground uppercase">{stat.label}</p>
						<p class="mt-1 text-2xl font-semibold tabular-nums" data-testid="stat-value">
							{stat.value}
						</p>
					</div>
					<div
						class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
					>
						<stat.icon class="h-4.5 w-4.5" strokeWidth={1.8} />
					</div>
				</Card.Content>
			</Card.Root>
		{/each}
	</div>

	<div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
		<div class="min-w-0 lg:col-span-2">
			<div>
				<div class="flex h-10 max-w-full gap-1 overflow-x-auto border-b px-1" role="tablist">
					{#each [['users', 'Users'], ['sessions', 'Sessions'], ['settings', 'Sign-in methods'], ['playground', 'Try auth'], ['setup', 'Integration']] as tab (tab[0])}
						<button
							type="button"
							role="tab"
							aria-selected={activeTab === tab[0]}
							class={[
								'relative flex-none px-3.5 text-sm font-medium transition-colors',
								activeTab === tab[0]
									? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary'
									: 'text-muted-foreground hover:text-foreground'
							]}
							onclick={() => (activeTab = tab[0])}>{tab[1]}</button
						>
					{/each}
				</div>

				<!-- USERS -->
				{#if activeTab === 'users'}<div class="mt-4">
						<Card.Root data-testid="users-card">
							<Card.Header>
								<Card.Title>Users</Card.Title>
								<Card.Description>
									{analytics.registeredUsers} registered · {analytics.anonymousUsers} anonymous
								</Card.Description>
								<Card.Action class="self-center"
									><Button
										size="sm"
										class="gap-1.5"
										data-testid="add-user-button"
										onclick={() => (activeTab = 'playground')}
									>
										<UserPlus class="h-4 w-4" /> Add user
									</Button>
								</Card.Action>
							</Card.Header>
							<Card.Content>
								{#if overview.users.length === 0}
									<p class="py-6 text-center text-sm text-muted-foreground">
										No users yet — create the first one in the playground.
									</p>
								{:else}
									<Table.Root>
										<Table.Header>
											<Table.Row>
												<Table.Head>Identifier</Table.Head>
												<Table.Head>Providers</Table.Head>
												<Table.Head>Status</Table.Head>
												<Table.Head class="text-right">Created</Table.Head>
												<Table.Head class="w-12"><span class="sr-only">Actions</span></Table.Head>
											</Table.Row>
										</Table.Header>
										<Table.Body>
											{#each overview.users as user (user.id)}
												<Table.Row>
													<Table.Cell>
														<div class="flex items-center gap-2">
															<div
																class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
															>
																<UserRound class="h-3.5 w-3.5" />
															</div>
															<div class="min-w-0">
																<p class="truncate text-sm font-medium">{user.name}</p>
																<p class="truncate font-mono text-xs text-muted-foreground">
																	{user.email}
																</p>
															</div>
														</div>
													</Table.Cell>
													<Table.Cell>
														<div class="flex flex-wrap gap-1">
															{#each user.providers as provider (provider)}
																<Badge variant="outline" class="font-mono text-[11px]">
																	{provider}
																</Badge>
															{/each}
														</div>
													</Table.Cell>
													<Table.Cell>
														{#if user.isAnonymous}
															<Badge variant="secondary">anonymous</Badge>
														{:else}
															<Badge variant={user.emailVerified ? 'default' : 'secondary'}>
																{user.emailVerified ? 'verified' : 'unverified'}
															</Badge>
														{/if}
													</Table.Cell>
													<Table.Cell class="text-right text-xs text-muted-foreground">
														{timeAgo(user.createdAt)}
													</Table.Cell>
													<Table.Cell>
														<Button
															variant="ghost"
															size="icon"
															class="h-8 w-8 text-muted-foreground hover:text-destructive"
															disabled={busy}
															aria-label={`Delete ${user.email}`}
															onclick={() => adminDelete('users', user.id)}
														>
															<Trash2 class="h-4 w-4" />
														</Button>
													</Table.Cell>
												</Table.Row>
											{/each}
										</Table.Body>
									</Table.Root>
								{/if}
							</Card.Content>
						</Card.Root>
					</div>{/if}

				<!-- SESSIONS -->
				{#if activeTab === 'sessions'}<div class="mt-4">
						<Card.Root data-testid="sessions-card">
							<Card.Header>
								<Card.Title>Active sessions</Card.Title>
								<Card.Description>{overview.sessions.length} currently active</Card.Description>
							</Card.Header>
							<Card.Content>
								{#if overview.sessions.length === 0}
									<p
										class="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground"
									>
										No active sessions.
									</p>
								{:else}
									<Table.Root>
										<Table.Header>
											<Table.Row>
												<Table.Head>User</Table.Head>
												<Table.Head>Country</Table.Head>
												<Table.Head>Client</Table.Head>
												<Table.Head>Started</Table.Head>
												<Table.Head class="text-right">Expires</Table.Head>
												<Table.Head class="w-12"><span class="sr-only">Actions</span></Table.Head>
											</Table.Row>
										</Table.Header>
										<Table.Body>
											{#each overview.sessions as s (s.id)}
												<Table.Row>
													<Table.Cell class="font-mono text-xs">{s.email ?? s.userId}</Table.Cell>
													<Table.Cell>
														<Badge variant="outline" class="font-mono text-[11px]">
															{s.country ?? '—'}
														</Badge>
													</Table.Cell>
													<Table.Cell
														class="max-w-50 truncate text-xs text-muted-foreground"
														title={s.userAgent ?? ''}
													>
														{s.userAgent ?? 'unknown'}
													</Table.Cell>
													<Table.Cell class="text-xs text-muted-foreground">
														{timeAgo(s.createdAt)}
													</Table.Cell>
													<Table.Cell class="text-right text-xs text-muted-foreground">
														{new Date(s.expiresAt).toLocaleDateString()}
													</Table.Cell>
													<Table.Cell>
														<Button
															variant="ghost"
															size="icon"
															class="h-8 w-8 text-muted-foreground hover:text-destructive"
															disabled={busy}
															aria-label={`Revoke session for ${s.email ?? s.userId}`}
															onclick={() => adminDelete('sessions', s.id)}
														>
															<Trash2 class="h-4 w-4" />
														</Button>
													</Table.Cell>
												</Table.Row>
											{/each}
										</Table.Body>
									</Table.Root>
								{/if}
							</Card.Content>
						</Card.Root>
					</div>{/if}

				<!-- PLAYGROUND -->
				{#if activeTab === 'playground'}<div class="mt-4">
						<Card.Root>
							<Card.Header>
								<Card.Title>Auth playground</Card.Title>
								<Card.Description>
									Exercise this project's Better Auth endpoints from the browser.
								</Card.Description>
							</Card.Header>
							<Card.Content class="grid gap-6 md:grid-cols-2">
								<div class="space-y-4">
									<div>
										<div class="grid grid-cols-2 rounded-lg bg-muted p-1" role="tablist">
											<button
												type="button"
												role="tab"
												aria-selected={playgroundTab === 'sign-up'}
												class={[
													'rounded-md px-3 py-1.5 text-sm',
													playgroundTab === 'sign-up' && 'bg-background shadow-sm'
												]}
												onclick={() => (playgroundTab = 'sign-up')}>Sign up</button
											>
											<button
												type="button"
												role="tab"
												aria-selected={playgroundTab === 'sign-in'}
												class={[
													'rounded-md px-3 py-1.5 text-sm',
													playgroundTab === 'sign-in' && 'bg-background shadow-sm'
												]}
												onclick={() => (playgroundTab = 'sign-in')}>Sign in</button
											>
										</div>
										{#if playgroundTab === 'sign-up'}<div class="mt-4 space-y-3">
												<div class="space-y-1.5">
													<Label for="su-name">Name</Label>
													<Input id="su-name" bind:value={name} placeholder="Ada Lovelace" />
												</div>
												<div class="space-y-1.5">
													<Label for="su-email">Email</Label>
													<Input id="su-email" type="email" bind:value={email} />
												</div>
												<div class="space-y-1.5">
													<Label for="su-password">Password</Label>
													<Input id="su-password" type="password" bind:value={password} />
												</div>
												<Button
													class="w-full"
													disabled={busy}
													onclick={() => authPost('sign-up/email', { email, password, name })}
												>
													<UserPlus class="mr-1 h-4 w-4" /> Create account
												</Button>
												<Button
													variant="outline"
													class="w-full"
													disabled={busy}
													data-testid="guest-button"
													onclick={() => authPost('sign-in/anonymous')}
												>
													Continue as guest
												</Button>
											</div>{:else}<div class="mt-4 space-y-3">
												<div class="space-y-1.5">
													<Label for="si-email">Email</Label>
													<Input id="si-email" type="email" bind:value={email} />
												</div>
												<div class="space-y-1.5">
													<Label for="si-password">Password</Label>
													<Input id="si-password" type="password" bind:value={password} />
												</div>
												<Button
													class="w-full"
													disabled={busy}
													onclick={() => authPost('sign-in/email', { email, password })}
												>
													<LogIn class="mr-1 h-4 w-4" /> Sign in
												</Button>
											</div>{/if}
									</div>
									{#if agentState.enabledSocialProviders?.length}
										<div class="space-y-2 border-t pt-4">
											<p class="text-center text-xs text-muted-foreground">Or continue with</p>
											<div class="grid grid-cols-2 gap-2">
												{#if agentState.enabledSocialProviders.includes('google')}
													<Button
														variant="outline"
														onclick={() => socialSignIn('google')}
														disabled={busy}
													>
														<svg viewBox="0 0 24 24" class="mr-2 h-4 w-4" aria-hidden="true"
															><path
																fill="#4285F4"
																d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.3Z"
															/><path
																fill="#34A853"
																d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.4-4H3.3v2.6A10 10 0 0 0 12 22Z"
															/><path
																fill="#FBBC05"
																d="M6.6 14a6 6 0 0 1 0-4V7.4H3.3a10 10 0 0 0 0 9.2L6.6 14Z"
															/><path
																fill="#EA4335"
																d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.3 7.4L6.6 10A5.8 5.8 0 0 1 12 6Z"
															/></svg
														> Google
													</Button>
												{/if}
												{#if agentState.enabledSocialProviders.includes('github')}
													<Button
														variant="outline"
														onclick={() => socialSignIn('github')}
														disabled={busy}
													>
														<svg
															viewBox="0 0 24 24"
															class="mr-2 h-4 w-4 fill-current"
															aria-hidden="true"
															><path
																d="M12 .7a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.2.8-.5v-2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C15.2 5 16.2 5.3 16.2 5.3c.6 1.5.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.5 5.7.4.4.8 1.1.8 2.3v3.1c0 .3.2.7.8.5A11.5 11.5 0 0 0 12 .7Z"
															/></svg
														> GitHub
													</Button>
												{/if}
											</div>
										</div>
									{/if}
								</div>

								<div
									class="flex flex-col rounded-lg border border-border bg-card/50 p-4"
									data-testid="session-panel"
								>
									<p class="text-xs tracking-wide text-muted-foreground uppercase">
										Current session
									</p>
									{#if session?.user}
										<div class="mt-3 space-y-1.5 text-sm">
											<p class="font-medium">{session.user.name}</p>
											<p class="font-mono text-xs text-muted-foreground">{session.user.email}</p>
											<p class="text-xs text-muted-foreground">
												expires {new Date(session.session.expiresAt).toLocaleString()}
											</p>
										</div>
										<Button
											variant="outline"
											size="sm"
											class="mt-auto w-full"
											disabled={busy}
											onclick={() => authPost('sign-out')}
										>
											<LogOut class="mr-1 h-4 w-4" /> Sign out
										</Button>
									{:else}
										<p class="mt-3 text-sm text-muted-foreground">
											No active session on this browser. Sign up or sign in to create one.
										</p>
									{/if}
									{#if authError}
										<p class="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
											{authError}
										</p>
									{/if}
								</div>
							</Card.Content>
						</Card.Root>
					</div>{/if}

				<!-- CONNECT -->
				{#if activeTab === 'setup'}<div class="mt-4">
						<Card.Root data-testid="connect-card">
							<Card.Header>
								<Card.Title>Connect your application</Card.Title>
								<Card.Description
									>Use cookies on the same origin or bearer tokens from external apps and APIs.</Card.Description
								>
							</Card.Header>
							<Card.Content class="space-y-5">
								<div>
									<Label>Auth base URL</Label><code
										class="mt-2 block overflow-x-auto rounded-lg border bg-muted/50 p-3 text-xs"
										>{typeof window === 'undefined'
											? ''
											: window.location.origin}/api/projects/{data.projectId}/auth</code
									>
								</div>
								<div>
									<Label>Sign up and capture a bearer token</Label>
									<pre
										class="mt-2 overflow-x-auto rounded-lg border bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-100"><code
											>{`const response = await fetch('${`/api/projects/${data.projectId}/auth/sign-up/email`}', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, name })
});
const token = response.headers.get('set-auth-token');

await fetch('${`/api/projects/${data.projectId}/auth/get-session`}', {
  headers: { authorization: \`Bearer \${token}\` }
});`}</code
										></pre>
								</div>
								<p class="text-xs text-muted-foreground">
									External browser applications must be added under Settings → Allowed origins. Keep
									bearer tokens out of logs and URLs.
								</p>
							</Card.Content>
						</Card.Root>
					</div>{/if}

				{#if activeTab === 'settings'}<div class="mt-4">
						<Card.Root data-testid="settings-card" class="overflow-hidden">
							<Card.Header class="border-b bg-muted/20">
								<Card.Title>Sign-in methods</Card.Title>
								<Card.Description
									>Choose how users authenticate and configure OAuth credentials.</Card.Description
								>
							</Card.Header>
							<Card.Content class="space-y-6 pt-6">
								<div class="space-y-3">
									<div>
										<Label>Social sign-in providers</Label>
										<p class="mt-1 text-xs text-muted-foreground">
											Credentials stay in private project storage and are never returned to the
											browser.
										</p>
									</div>
									<div class="divide-y rounded-xl border bg-card">
										<div class="p-4 sm:p-5" data-testid="provider-google">
											<label class="flex items-center justify-between gap-3 font-medium">
												<span class="flex items-center gap-2"
													><span
														class="flex h-8 w-8 items-center justify-center rounded-lg border bg-background"
														><svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true"
															><path
																fill="#4285F4"
																d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.3Z"
															/><path
																fill="#34A853"
																d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.4-4H3.3v2.6A10 10 0 0 0 12 22Z"
															/><path
																fill="#FBBC05"
																d="M6.6 14a6 6 0 0 1 0-4V7.4H3.3a10 10 0 0 0 0 9.2L6.6 14Z"
															/><path
																fill="#EA4335"
																d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.3 7.4L6.6 10A5.8 5.8 0 0 1 12 6Z"
															/></svg
														></span
													>Google</span
												>
												<input
													type="checkbox"
													bind:checked={googleEnabled}
													class="rounded border-input"
												/>
											</label>
											{#if googleEnabled}
												<div class="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
													<Input
														bind:value={googleClientId}
														placeholder="Google client ID"
														aria-label="Google client ID"
													/>
													<Input
														bind:value={googleClientSecret}
														type="password"
														placeholder={agentState.enabledSocialProviders?.includes('google')
															? 'Leave blank to keep current secret'
															: 'Google client secret'}
														aria-label="Google client secret"
													/>
												</div>
											{/if}
										</div>
										<div class="p-4 sm:p-5" data-testid="provider-github">
											<label class="flex items-center justify-between gap-3 font-medium">
												<span class="flex items-center gap-2"
													><span
														class="flex h-8 w-8 items-center justify-center rounded-lg border bg-background"
														><svg
															viewBox="0 0 24 24"
															class="h-4 w-4 fill-current"
															aria-hidden="true"
															><path
																d="M12 .7a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.2.8-.5v-2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C15.2 5 16.2 5.3 16.2 5.3c.6 1.5.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.5 5.7.4.4.8 1.1.8 2.3v3.1c0 .3.2.7.8.5A11.5 11.5 0 0 0 12 .7Z"
															/></svg
														></span
													>GitHub</span
												>
												<input
													type="checkbox"
													bind:checked={githubEnabled}
													class="rounded border-input"
												/>
											</label>
											{#if githubEnabled}
												<div class="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
													<Input
														bind:value={githubClientId}
														placeholder="GitHub client ID"
														aria-label="GitHub client ID"
													/>
													<Input
														bind:value={githubClientSecret}
														type="password"
														placeholder={agentState.enabledSocialProviders?.includes('github')
															? 'Leave blank to keep current secret'
															: 'GitHub client secret'}
														aria-label="GitHub client secret"
													/>
												</div>
											{/if}
										</div>
									</div>
									<div
										class="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 font-mono text-xs text-muted-foreground"
									>
										<Code2 class="mt-0.5 h-3.5 w-3.5 shrink-0" />
										OAuth callback: {typeof window === 'undefined'
											? ''
											: window.location
													.origin}/api/projects/{data.projectId}/auth/callback/[provider]
									</div>
								</div>
								<div class="space-y-3 border-t pt-6">
									<div>
										<Label for="allowed-origins">Authorized domains</Label>
										<p class="mt-1 text-xs text-muted-foreground">
											Apps permitted to make authenticated browser requests.
										</p>
									</div>
									<textarea
										id="allowed-origins"
										bind:value={allowedOriginsInput}
										rows="4"
										class="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
										placeholder={'https://app.example.com\nhttp://localhost:3000'}
									></textarea>
									<p class="text-xs text-muted-foreground">
										One exact origin per line. HTTPS is required except for localhost.
									</p>
								</div>
								{#if authError}<p class="text-sm text-destructive">{authError}</p>{/if}
								{#if settingsSaved}<p class="text-sm text-emerald-600">
										Settings saved. New auth requests use these origins immediately.
									</p>{/if}
								<div class="flex justify-end border-t pt-5">
									<Button disabled={busy} onclick={saveSettings}
										>{busy ? 'Saving…' : 'Save changes'}</Button
									>
								</div>
							</Card.Content>
						</Card.Root>
					</div>{/if}

				{#if false}<div class="mt-4">
						<Card.Root data-testid="chat-panel">
							<Card.Header>
								<Card.Title class="flex items-center gap-2">
									<Bot class="h-4 w-4 text-primary" /> Ask the Auth Agent
								</Card.Title>
								<Card.Description>
									Workers AI reasons over authoritative auth totals and aggregated Analytics Engine
									metrics.
								</Card.Description>
							</Card.Header>
							<Card.Content class="space-y-4">
								<div
									class="flex h-80 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card/50 p-4"
									data-testid="chat-messages"
								>
									{#if chatMessages.length === 0}
										<p class="m-auto max-w-sm text-center text-sm text-muted-foreground">
											Ask something about this project's users — try one of the suggestions below.
										</p>
									{:else}
										{#each chatMessages as message (message.id)}
											<div
												class={[
													'max-w-[85%] rounded-lg px-3 py-2 text-sm',
													message.role === 'user'
														? 'self-end bg-primary text-primary-foreground'
														: 'self-start border border-border bg-background'
												]}
											>
												{message.content}
											</div>
										{/each}
										{#if chatBusy}
											<div
												class="self-start rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
											>
												thinking…
											</div>
										{/if}
									{/if}
								</div>

								<div class="flex flex-wrap gap-2">
									{#each suggestedQuestions as question (question)}
										<button
											class="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
											onclick={() => askAgent(question)}
										>
											{question}
										</button>
									{/each}
								</div>

								<form
									class="flex gap-2"
									onsubmit={(event) => {
										event.preventDefault();
										void askAgent(chatInput);
									}}
								>
									<Input
										bind:value={chatInput}
										placeholder="e.g. how many users signed in with Google?"
										data-testid="chat-input"
									/>
									<Button type="submit" size="icon" disabled={chatBusy} data-testid="chat-send">
										<SendHorizontal class="h-4 w-4" />
									</Button>
								</form>
							</Card.Content>
						</Card.Root>
					</div>{/if}
			</div>
		</div>

		<!-- Right column -->
		<div class="space-y-6">
			<Card.Root data-testid="wae-card">
				<Card.Header>
					<Card.Title>Events pipeline</Card.Title>
					<Card.Description>Workers Analytics Engine</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-3">
					<div class="flex items-center justify-between gap-2">
						<span class="truncate font-mono text-xs">{analytics.engine.dataset}</span>
						<Badge variant="outline">{analytics.engine.status}</Badge>
					</div>
					{#if analytics.engine.error}
						<p class="mt-2 text-xs text-destructive">{analytics.engine.error}</p>
					{/if}
					{#if analytics.eventsLast24h?.length}
						<ul class="space-y-2">
							{#each analytics.eventsLast24h as e (e.eventType)}
								<li class="flex items-center justify-between text-sm">
									<span class="font-mono text-xs">{e.eventType}</span>
									<span class="tabular-nums">{e.count}</span>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-xs text-muted-foreground">
							Every auth event streams a data point (event, country, provider) indexed by project.
							Set CF_ACCOUNT_ID + CF_ANALYTICS_API_TOKEN on the agent to query it from here.
						</p>
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root data-testid="countries-card">
				<Card.Header>
					<Card.Title>Top countries</Card.Title>
					<Card.Description>By session count, resolved at the edge.</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if analytics.countries.length === 0}
						{#if analytics.engine.status === 'write-only'}
							<p class="text-sm text-muted-foreground">
								Country events are being collected. Configure Analytics Engine read credentials to
								show rankings.
							</p>
						{:else if analytics.engine.status === 'error'}
							<p class="text-sm text-destructive">Country analytics are temporarily unavailable.</p>
						{:else}
							<p class="text-sm text-muted-foreground">No sessions recorded in the last 30 days.</p>
						{/if}
					{:else}
						<ul class="space-y-2">
							{#each analytics.countries as c (c.country)}
								<li class="flex items-center justify-between text-sm">
									<span class="font-mono text-xs">{c.country}</span>
									<span class="tabular-nums">{c.sessions}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root data-testid="providers-card">
				<Card.Header>
					<Card.Title>Sign-in methods</Card.Title>
					<Card.Description>Configuration and linked-user activity.</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="grid grid-cols-2 gap-2 text-sm">
						<div class="flex items-center gap-2 rounded-lg border p-2.5">
							<KeyRound class="h-4 w-4 text-primary" /> Email/password
							<span class="ml-auto h-2 w-2 rounded-full bg-emerald-500"></span>
						</div>
						<div class="flex items-center gap-2 rounded-lg border p-2.5">
							<UserRound class="h-4 w-4 text-primary" /> Guest
							<span class="ml-auto h-2 w-2 rounded-full bg-emerald-500"></span>
						</div>
						<div class="flex items-center gap-2 rounded-lg border p-2.5">
							<svg viewBox="0 0 24 24" class="h-4 w-4" aria-label="Google"
								><path
									fill="#4285F4"
									d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.3Z"
								/><path
									fill="#34A853"
									d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.4-4H3.3v2.6A10 10 0 0 0 12 22Z"
								/><path
									fill="#FBBC05"
									d="M6.6 14a6 6 0 0 1 0-4V7.4H3.3a10 10 0 0 0 0 9.2L6.6 14Z"
								/><path
									fill="#EA4335"
									d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.3 7.4L6.6 10A5.8 5.8 0 0 1 12 6Z"
								/></svg
							>
							Google
							<Badge variant="outline" class="ml-auto text-[10px]"
								>{agentState.enabledSocialProviders?.includes('google') ? 'enabled' : 'off'}</Badge
							>
						</div>
						<div class="flex items-center gap-2 rounded-lg border p-2.5">
							<svg viewBox="0 0 24 24" class="h-4 w-4 fill-current" aria-label="GitHub"
								><path
									d="M12 .7a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.2.8-.5v-2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.6.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C15.2 5 16.2 5.3 16.2 5.3c.6 1.5.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.1 0 4.4-2.7 5.4-5.5 5.7.4.4.8 1.1.8 2.3v3.1c0 .3.2.7.8.5A11.5 11.5 0 0 0 12 .7Z"
								/></svg
							>
							GitHub
							<Badge variant="outline" class="ml-auto text-[10px]"
								>{agentState.enabledSocialProviders?.includes('github') ? 'enabled' : 'off'}</Badge
							>
						</div>
					</div>
					<div class="border-t pt-3">
						<p class="mb-2 text-xs font-medium text-muted-foreground">Linked users (30 days)</p>
						{#if analytics.providers.length === 0}
							<p class="text-sm text-muted-foreground">
								No users have completed a provider sign-in yet.
							</p>
						{:else}
							<ul class="space-y-2">
								{#each analytics.providers as p (p.provider)}
									<li class="flex items-center justify-between text-sm">
										<span class="font-mono text-xs">{p.provider}</span>
										<span class="tabular-nums">{p.users}</span>
									</li>
								{/each}
								<li class="flex items-center justify-between border-t border-border pt-2 text-sm">
									<span class="font-mono text-xs">@gmail.com emails</span>
									<span class="tabular-nums">{analytics.gmailUsers}</span>
								</li>
							</ul>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>
		</div>
	</div>
</div>
