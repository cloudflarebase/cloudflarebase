<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { AgentChatMessage, AgentChatReply } from '$lib/agents';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import { projectIdSchema } from '$lib/schemas/auth';
	import ModeToggle from '$lib/components/mode-toggle.svelte';
	import { tick } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { fade, fly } from 'svelte/transition';
	import {
		ArrowRight,
		Bot,
		Clock,
		Database,
		HardDrive,
		House,
		KeyRound,
		Radio,
		SendHorizontal,
		Sparkles,
		X,
		Zap
	} from '@lucide/svelte';

	let { children } = $props();

	const projectId = $derived(page.params.projectId ?? 'demo');
	// Writable derived: resets to the current project on navigation, while the
	// input binding can still overwrite it locally.
	let projectInput = $derived(page.params.projectId ?? 'demo');
	let projectSwitchError = $state('');
	const isMobile = new IsMobile();
	let copilotOpen = $derived(!isMobile.current);
	let copilotInput = $state('');
	let copilotBusy = $state(false);
	type CopilotMessage = AgentChatMessage & { mode?: string };
	let copilotMessages = $state<CopilotMessage[]>([]);
	let copilotMessagesEl = $state<HTMLDivElement>();
	let pendingHistoryScroll = $state(false);
	// Starts true so the first paint shows the skeleton, not a flash of the
	// empty state, while the initial history request is in flight.
	let copilotHistoryLoading = $state(true);

	const overviewHref = $derived(resolve('/dashboard/[projectId]', { projectId }));
	const authHref = $derived(resolve('/dashboard/[projectId]/auth', { projectId }));

	const isOverview = $derived(page.url.pathname === overviewHref);
	const isAuth = $derived(page.url.pathname.startsWith(authHref));

	const comingSoon = [
		{ label: 'Database', icon: Database },
		{ label: 'Storage', icon: HardDrive },
		{ label: 'Functions', icon: Zap },
		{ label: 'Realtime', icon: Radio },
		{ label: 'Cron & Queues', icon: Clock }
	];

	// Grounded in the aggregated auth data the agent can actually answer from.
	const copilotSuggestionPool = [
		'Summarize this project',
		'What should I investigate?',
		'How is user activity?',
		"What's our DAU/MAU ratio?",
		"What's our churn rate?",
		'How many anonymous users do we have?',
		'Which sign-in providers are most used?',
		'What countries are users from?',
		'How many sessions are active right now?',
		'Are sign-ups trending up this week?',
		'Compare guest and registered sign-ups',
		'Which auth events fired in the last day?',
		'Is anything unusual in the auth activity?'
	];

	function pickSuggestions(): string[] {
		const pool = [...copilotSuggestionPool];
		for (let i = pool.length - 1; i > 0; i -= 1) {
			const j = Math.floor(Math.random() * (i + 1));
			[pool[i], pool[j]] = [pool[j], pool[i]];
		}
		return pool.slice(0, 3);
	}

	let copilotSuggestions = $state(pickSuggestions());

	$effect(() => {
		const currentProject = projectId;
		copilotMessages = [];
		pendingHistoryScroll = false;
		copilotHistoryLoading = true;
		void loadCopilotHistory(currentProject);
	});

	$effect(() => {
		if (copilotOpen && pendingHistoryScroll && copilotMessagesEl) {
			const el = copilotMessagesEl;
			pendingHistoryScroll = false;
			tick().then(() => el.scrollTo({ top: el.scrollHeight }));
		}
	});

	async function loadCopilotHistory(currentProject: string) {
		copilotHistoryLoading = true;
		try {
			const response = await fetch(`/api/projects/${currentProject}/chat`);
			if (currentProject !== projectId) return;
			if (!response.ok) {
				copilotMessages = [];
				return;
			}
			const history = (await response.json()) as { messages: AgentChatMessage[] };
			copilotMessages = history.messages;
			pendingHistoryScroll = copilotMessages.length > 0;
		} catch {
			// Keep chat usable when history cannot be loaded.
		} finally {
			if (currentProject === projectId) copilotHistoryLoading = false;
		}
	}

	function switchProject(event: SubmitEvent) {
		event.preventDefault();
		const slug = projectInput.trim().toLowerCase();
		const parsed = projectIdSchema.safeParse(slug);
		if (!parsed.success) {
			projectSwitchError = parsed.error.issues[0]?.message ?? 'Invalid project ID.';
			return;
		}
		projectSwitchError = '';
		if (parsed.data !== projectId) {
			void goto(resolve('/dashboard/[projectId]', { projectId: parsed.data }));
		}
	}

	async function askCopilot(question: string) {
		const trimmed = question.trim();
		if (!trimmed || copilotBusy) return;
		copilotBusy = true;
		copilotInput = '';
		const currentProject = projectId;
		const pendingId = crypto.randomUUID();
		copilotMessages = [
			...copilotMessages,
			{ id: pendingId, role: 'user', content: trimmed, createdAt: new Date().toISOString() }
		];
		try {
			const response = await fetch(`/api/projects/${currentProject}/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ question: trimmed })
			});
			// The user may have switched projects while the request was in flight;
			// this reply belongs to the previous project's conversation.
			if (currentProject !== projectId) return;
			const reply = (await response.json()) as AgentChatReply & { error?: string };
			if (response.ok) {
				copilotMessages = [
					...copilotMessages.filter((message) => message.id !== pendingId),
					reply.userMessage,
					{ ...reply.agentMessage, mode: reply.mode }
				];
			} else {
				copilotMessages = [
					...copilotMessages,
					{
						id: crypto.randomUUID(),
						role: 'agent',
						content: reply.error ?? 'I could not answer that.',
						createdAt: new Date().toISOString()
					}
				];
			}
		} catch {
			if (currentProject !== projectId) return;
			copilotMessages = [
				...copilotMessages,
				{
					id: crypto.randomUUID(),
					role: 'agent',
					content: 'The project agent is unavailable.',
					createdAt: new Date().toISOString()
				}
			];
		} finally {
			copilotBusy = false;
			copilotSuggestions = pickSuggestions();
		}
	}
</script>

<svelte:head>
	<meta name="robots" content="noindex, nofollow, noarchive" />
</svelte:head>

<div class="flex min-h-screen bg-background text-foreground">
	<!-- Sidebar -->
	<aside class="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
		<a
			href={resolve('/')}
			class="flex items-center gap-2 border-b border-border px-5 py-4 font-bold"
		>
			<img src="/brand/mark.svg" alt="" class="h-5 w-5" />
			Cloudflarebase
		</a>

		<nav class="flex-1 space-y-6 px-3 py-4">
			<div>
				<a
					href={overviewHref}
					data-testid="nav-overview"
					class={[
						'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
						isOverview
							? 'bg-primary/10 text-primary'
							: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
					]}
				>
					<House class="h-4 w-4" />
					Project Overview
				</a>
			</div>

			<div>
				<p
					class="px-3 pb-2 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase"
				>
					Build
				</p>
				<a
					href={authHref}
					data-testid="nav-auth"
					class={[
						'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
						isAuth
							? 'bg-primary/10 text-primary'
							: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
					]}
				>
					<KeyRound class="h-4 w-4" />
					Authentication
				</a>
				{#each comingSoon as item (item.label)}
					<span
						class="flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/50"
					>
						<item.icon class="h-4 w-4" />
						{item.label}
						<Badge variant="outline" class="ml-auto text-[10px] text-muted-foreground/60"
							>soon</Badge
						>
					</span>
				{/each}
			</div>
		</nav>

		<div class="border-t border-border px-5 py-3 text-[11px] text-muted-foreground/60">
			Running on Cloudflare's network
		</div>
	</aside>

	<!-- Main -->
	<div class="flex min-w-0 flex-1 flex-col">
		<header
			class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-3 py-3 sm:px-6"
		>
			<div class="flex min-w-0 items-center gap-2 text-sm">
				<a href={resolve('/')} class="shrink-0 md:hidden" aria-label="Cloudflarebase home">
					<img src="/brand/mark.svg" alt="" class="h-5 w-5" />
				</a>
				<span class="hidden text-muted-foreground md:inline">Project</span>
				<Badge
					variant="secondary"
					class="max-w-28 truncate font-mono sm:max-w-none"
					data-testid="project-badge">{projectId}</Badge
				>
			</div>

			<div class="ml-auto flex items-center gap-1.5 sm:gap-2">
				<ModeToggle class="h-8 w-8" testId="theme-toggle" />
				<form onsubmit={switchProject} novalidate class="relative flex items-center gap-2">
					<Input
						bind:value={projectInput}
						oninput={() => (projectSwitchError = '')}
						class="h-8 w-24 font-mono text-xs min-[380px]:w-32 sm:w-40"
						placeholder="switch project…"
						aria-label="Project id"
						aria-invalid={projectSwitchError ? 'true' : undefined}
						aria-describedby={projectSwitchError ? 'project-switch-error' : undefined}
						maxlength={32}
						pattern={'[a-z0-9][a-z0-9-]{0,31}'}
						autocomplete="off"
						spellcheck="false"
					/>
					<Button type="submit" size="sm" variant="outline" class="h-8" aria-label="Switch project">
						<ArrowRight class="h-3.5 w-3.5" />
					</Button>
					{#if projectSwitchError}
						<p
							id="project-switch-error"
							role="alert"
							class="absolute top-full right-0 z-50 mt-1 w-64 rounded-md border border-destructive/30 bg-background px-2 py-1.5 text-xs text-destructive shadow-md"
						>
							{projectSwitchError}
						</p>
					{/if}
				</form>
			</div>
		</header>
		<nav class="flex gap-1 overflow-x-auto border-b px-3 py-2 md:hidden" aria-label="Project tools">
			<a
				href={overviewHref}
				class={[
					'rounded-md px-3 py-1.5 text-sm',
					isOverview ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
				]}>Overview</a
			>
			<a
				href={authHref}
				class={[
					'rounded-md px-3 py-1.5 text-sm',
					isAuth ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
				]}>Authentication</a
			>
		</nav>

		<main class="min-w-0 flex-1 bg-muted/20">
			{#key page.url.pathname}
				<div class="min-h-full" in:fly={{ y: 6, duration: 220, easing: cubicOut, opacity: 0 }}>
					{@render children()}
				</div>
			{/key}
		</main>
	</div>

	{#if copilotOpen}
		<aside
			class="fixed right-2 bottom-2 z-40 flex h-[min(680px,calc(100dvh-1rem))] w-[min(380px,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl sm:right-4 sm:bottom-4 sm:h-[min(680px,calc(100dvh-2rem))] sm:w-[min(380px,calc(100vw-2rem))]"
			data-testid="project-copilot"
			in:fly={{ y: 20, duration: 320, easing: cubicOut }}
			out:fade={{ duration: 120 }}
		>
			<header class="flex items-center gap-3 border-b px-4 py-3">
				<div
					class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"
				>
					<Sparkles class="h-4 w-4" />
				</div>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<h2 class="text-sm font-semibold">Project agent</h2>
						<Badge variant="secondary" class="text-[9px]">Workers AI</Badge>
					</div>
					<p class="truncate text-xs text-muted-foreground">Live context for {projectId}</p>
				</div>
				<Button
					size="icon"
					variant="ghost"
					class="h-8 w-8"
					onclick={() => (copilotOpen = false)}
					aria-label="Close project agent"
				>
					<X class="h-4 w-4" />
				</Button>
			</header>

			<div
				class="flex-1 space-y-3 overflow-y-auto p-4"
				data-testid="copilot-messages"
				bind:this={copilotMessagesEl}
			>
				{#if copilotHistoryLoading && copilotMessages.length === 0}
					<div class="space-y-3" data-testid="copilot-history-loading" aria-hidden="true">
						<div class="h-14 w-3/4 animate-pulse rounded-xl bg-muted/60"></div>
						<div class="ml-auto h-9 w-1/2 animate-pulse rounded-xl bg-muted/60"></div>
						<div class="h-14 w-2/3 animate-pulse rounded-xl bg-muted/60"></div>
					</div>
				{:else if copilotMessages.length === 0}
					<div class="rounded-xl border bg-muted/40 p-4">
						<div class="mb-2 flex items-center gap-2 text-sm font-medium">
							<Bot class="h-4 w-4 text-primary" /> What can I help with?
						</div>
						<p class="text-xs leading-relaxed text-muted-foreground">
							I can explain usage, compare activity, and surface authentication issues from this
							project's aggregated data.
						</p>
					</div>
				{/if}
				{#each copilotMessages as message (message.id)}
					<div
						class={[
							'max-w-[88%] rounded-xl px-3 py-2.5 text-sm leading-relaxed',
							message.role === 'user' ? 'ml-auto bg-foreground text-background' : 'border bg-card'
						]}
					>
						{message.content}
						{#if message.role === 'agent' && message.mode}
							<p class="mt-2 text-[9px] tracking-wider uppercase opacity-60">
								Generated by Workers AI
							</p>
						{/if}
					</div>
				{/each}
				{#if copilotBusy}
					<p class="flex items-center gap-2 text-xs text-muted-foreground">
						<span class="h-2 w-2 animate-pulse rounded-full bg-primary"></span>Analyzing live data…
					</p>
				{/if}
				{#if !copilotHistoryLoading && !copilotBusy}
					<div class="grid gap-2" data-testid="copilot-suggestions">
						{#each copilotSuggestions as suggestion (suggestion)}
							<button
								class="rounded-lg border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
								onclick={() => askCopilot(suggestion)}
							>
								{suggestion}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<form
				class="border-t p-3"
				onsubmit={(event) => {
					event.preventDefault();
					void askCopilot(copilotInput);
				}}
			>
				<div class="flex items-center gap-2 rounded-xl border bg-muted/30 p-2">
					<Input
						bind:value={copilotInput}
						class="border-0 bg-transparent shadow-none focus-visible:ring-0"
						placeholder="Ask about your project…"
						aria-label="Ask project agent"
					/>
					<Button
						type="submit"
						size="icon"
						class="h-8 w-8 shrink-0"
						disabled={copilotBusy || !copilotInput.trim()}
						aria-label="Send to project agent"><SendHorizontal class="h-3.5 w-3.5" /></Button
					>
				</div>
				<p class="mt-2 text-center text-[10px] text-muted-foreground">
					Uses aggregated metrics only. Verify important decisions.
				</p>
			</form>
		</aside>
	{:else}
		<Button
			class="fixed right-3 bottom-3 z-40 gap-2 rounded-full shadow-lg sm:right-5 sm:bottom-5"
			onclick={() => (copilotOpen = true)}
			data-testid="open-project-copilot"
		>
			<Sparkles class="h-4 w-4" /> Ask agent
		</Button>
	{/if}
</div>
