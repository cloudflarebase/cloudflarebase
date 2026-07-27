<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { AgentChatMessage, AgentChatReply } from '$lib/agents';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Resizable from '$lib/components/ui/resizable';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import { projectIdSchema } from '$lib/schemas/auth';
	import ModeToggle from '$lib/components/mode-toggle.svelte';
	import { tick } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import {
		ArrowRight,
		BookOpen,
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

	let { children, data } = $props();

	const projectId = $derived(page.params.projectId ?? 'demo');
	// Writable derived: resets to the current project on navigation, while the
	// input binding can still overwrite it locally.
	let projectInput = $derived(page.params.projectId ?? 'demo');
	let projectSwitchError = $state('');
	const isMobile = new IsMobile();
	// Open state and pane sizes come from the cfbase-copilot cookie via the
	// layout server load, so SSR already renders the saved layout - reopening
	// the dashboard never flashes the default widths. Mobile uses the tab bar.
	// Initial-value captures are deliberate: this component is the only writer.
	// svelte-ignore state_referenced_locally
	let copilotOpen = $state(data.copilot.open);
	let mobileAgentOpen = $state(false);
	// svelte-ignore state_referenced_locally
	const initialPaneLayout = data.copilot.layout ?? [70, 30];
	let paneSizes = initialPaneLayout;
	let copilotInput = $state('');
	let copilotBusy = $state(false);
	type CopilotMessage = AgentChatMessage & { mode?: string };
	let copilotMessages = $state<CopilotMessage[]>([]);
	let copilotMessagesEl = $state<HTMLElement | null>(null);
	let pendingHistoryScroll = $state(false);
	// Starts true so the first paint shows the skeleton, not a flash of the
	// empty state, while the initial history request is in flight.
	let copilotHistoryLoading = $state(true);

	const overviewHref = $derived(resolve('/(app)/dashboard/[projectId]', { projectId }));
	const authHref = $derived(resolve('/(app)/dashboard/[projectId]/auth', { projectId }));
	const apiHref = $derived(resolve('/(app)/dashboard/[projectId]/api', { projectId }));
	const isApi = $derived(page.url.pathname.startsWith(apiHref));

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

	const copilotVisible = $derived(isMobile.current ? mobileAgentOpen : copilotOpen);

	$effect(() => {
		if (copilotVisible && pendingHistoryScroll && copilotMessagesEl) {
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
			void goto(resolve('/(app)/dashboard/[projectId]', { projectId: parsed.data }));
		}
	}

	function persistCopilotCookie() {
		if (!browser) return;
		const value = `${copilotOpen ? 'open' : 'closed'}:${paneSizes
			.map((size) => Math.round(size))
			.join(':')}`;
		document.cookie = `cfbase-copilot=${value}; path=/; max-age=31536000; samesite=lax`;
	}

	function setCopilotOpen(open: boolean) {
		copilotOpen = open;
		if (open) pendingHistoryScroll = copilotMessages.length > 0;
		persistCopilotCookie();
	}

	function onPaneLayoutChange(layout: number[]) {
		// Only record real two-pane layouts: a collapsed agent pane reports
		// [100, 0], and overwriting the saved sizes with it would lose the
		// width the user should get back on reopen.
		if (layout.length === 2 && layout[1] >= 15) {
			paneSizes = layout;
			persistCopilotCookie();
		}
	}

	let agentPane = $state<ReturnType<typeof Resizable.Pane>>();
	let agentPaneRef = $state<HTMLElement | null>(null);
	// Disable the flex-grow transition while dragging so resizing tracks the
	// cursor 1:1; the transition only plays for collapse/expand.
	let paneDragging = $state(false);
	// While collapsing/expanding, the panel content is pinned to its expanded
	// pixel width so the shrinking pane clips it (a clean slide, like VS Code)
	// instead of continuously reflowing the chat.
	let panelPinnedWidth = $state(0);
	let panelPinTimer: ReturnType<typeof setTimeout> | undefined;

	function closeCopilot() {
		clearTimeout(panelPinTimer);
		panelPinnedWidth = agentPaneRef?.getBoundingClientRect().width ?? 0;
		setCopilotOpen(false);
		agentPane?.collapse();
	}

	function openCopilot() {
		setCopilotOpen(true);
		agentPane?.resize(Math.min(55, Math.max(20, paneSizes[1] ?? 30)));
		panelPinTimer = setTimeout(() => (panelPinnedWidth = 0), 350);
	}

	function showMobileAgent(show: boolean) {
		mobileAgentOpen = show;
		if (show) pendingHistoryScroll = copilotMessages.length > 0;
	}

	function scrollCopilotToLatest() {
		const el = copilotMessagesEl;
		if (!el) return;
		void tick().then(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
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
		scrollCopilotToLatest();
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
			scrollCopilotToLatest();
		}
	}
</script>

<svelte:head>
	<meta name="robots" content="noindex, nofollow, noarchive" />
</svelte:head>

{#snippet copilotPanel(desktop: boolean)}
	<section
		class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
		style={desktop && panelPinnedWidth
			? `width: ${panelPinnedWidth}px; min-width: ${panelPinnedWidth}px;`
			: undefined}
		data-testid="project-copilot"
	>
		<header class="flex shrink-0 items-center gap-3 border-b px-4 py-3 md:h-14 md:py-0">
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
			{#if desktop}
				<Button
					size="icon"
					variant="ghost"
					class="h-8 w-8"
					onclick={closeCopilot}
					aria-label="Close project agent"
				>
					<X class="h-4 w-4" />
				</Button>
			{/if}
		</header>

		<ScrollArea
			type="always"
			class="min-h-0 flex-1"
			scrollbarYClasses="data-vertical:w-1.5 data-vertical:border-l-0"
			bind:viewportRef={copilotMessagesEl}
		>
			<div class="space-y-3 p-4" data-testid="copilot-messages">
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
		</ScrollArea>

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
	</section>
{/snippet}

<div class="flex h-dvh overflow-hidden bg-background text-foreground">
	<!-- Sidebar -->
	<aside class="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
		<a
			href={resolve('/')}
			class="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5 font-bold"
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

			<div>
				<p
					class="px-3 pb-2 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase"
				>
					Reference
				</p>
				<a
					href={apiHref}
					data-testid="nav-api"
					class={[
						'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
						isApi
							? 'bg-primary/10 text-primary'
							: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
					]}
				>
					<BookOpen class="h-4 w-4" />
					API Reference
				</a>
			</div>
		</nav>

		<div class="border-t border-border px-5 py-3 text-[11px] text-muted-foreground/60">
			Running on Cloudflare's network
		</div>
	</aside>

	<!-- Main content and agent pane, VS Code style: backend left, agent right -->
	<Resizable.PaneGroup
		direction="horizontal"
		onLayoutChange={onPaneLayoutChange}
		class="min-w-0 flex-1"
	>
		<Resizable.Pane
			defaultSize={initialPaneLayout[0]}
			minSize={45}
			order={1}
			class={[
				'flex min-w-0 flex-col',
				!paneDragging && 'transition-[flex-grow] duration-300 ease-out'
			]}
		>
			<header
				class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-3 py-3 sm:px-6 md:h-14 md:flex-nowrap md:py-0"
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
						<Button
							type="submit"
							size="sm"
							variant="outline"
							class="h-8"
							aria-label="Switch project"
						>
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
			{#if !mobileAgentOpen}
				<nav
					class="flex gap-1 overflow-x-auto border-b px-3 py-2 md:hidden"
					aria-label="Project tools"
				>
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
			{/if}

			{#if isMobile.current && mobileAgentOpen}
				{@render copilotPanel(false)}
			{:else if isApi}
				<!--
					The API reference owns its scrolling. Scalar pins its sidebar with
					position: sticky against its nearest scroll container, so it needs
					the pane's fixed height and a scrollport of its own - inside the
					shared ScrollArea the page wrapper is content-sized, nothing
					scrolls within it, and the sidebar rides away with the content.
					This mirrors Scalar's official embedded layout: a height-
					constrained container with overflow on the page, not the shell.
				-->
				<main class="min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/20">
					{#key page.url.pathname}
						<div class="h-full" in:fly={{ y: 6, duration: 220, easing: cubicOut, opacity: 0 }}>
							{@render children()}
						</div>
					{/key}
				</main>
			{:else}
				<ScrollArea
					type="always"
					class="min-h-0 min-w-0 flex-1 bg-muted/20"
					scrollbarYClasses="data-vertical:w-1.5 data-vertical:border-l-0"
				>
					<main class="min-w-0">
						{#key page.url.pathname}
							<div
								class="min-h-full"
								in:fly={{ y: 6, duration: 220, easing: cubicOut, opacity: 0 }}
							>
								{@render children()}
							</div>
						{/key}
					</main>
				</ScrollArea>
			{/if}

			<nav class="flex border-t border-border bg-card md:hidden" aria-label="Project view">
				<button
					type="button"
					class={[
						'flex flex-1 items-center justify-center gap-2 border-t-2 py-2.5 text-sm font-medium transition-colors',
						!mobileAgentOpen
							? 'border-primary text-primary'
							: 'border-transparent text-muted-foreground'
					]}
					aria-pressed={!mobileAgentOpen}
					onclick={() => showMobileAgent(false)}
				>
					<House class="h-4 w-4" /> Backend
				</button>
				<button
					type="button"
					class={[
						'flex flex-1 items-center justify-center gap-2 border-t-2 py-2.5 text-sm font-medium transition-colors',
						mobileAgentOpen
							? 'border-primary text-primary'
							: 'border-transparent text-muted-foreground'
					]}
					aria-pressed={mobileAgentOpen}
					data-testid="mobile-agent-tab"
					onclick={() => showMobileAgent(true)}
				>
					<Sparkles class="h-4 w-4" /> Agent
				</button>
			</nav>
		</Resizable.Pane>

		{#if !isMobile.current}
			<!-- hidden md:flex kills the SSR flash on phones: the server always
			     renders this desktop pane (it cannot know the viewport), and CSS
			     hides it at first paint until hydration removes it. The pane stays
			     mounted while closed (collapsed to 0) so collapse/expand can
			     animate via the flex-grow transition. -->
			<Resizable.Handle
				withHandle
				onDraggingChange={(dragging) => (paneDragging = dragging)}
				class={[
					'hidden after:w-2 hover:bg-primary/50 md:flex [&>div]:h-10 [&>div]:w-1.5',
					!copilotOpen && 'md:hidden'
				]}
			/>
			<Resizable.Pane
				bind:this={agentPane}
				bind:ref={agentPaneRef}
				defaultSize={copilotOpen ? initialPaneLayout[1] : 0}
				minSize={20}
				maxSize={55}
				collapsible
				collapsedSize={0}
				order={2}
				onCollapse={() => setCopilotOpen(false)}
				onExpand={() => setCopilotOpen(true)}
				class={[
					'hidden min-w-0 flex-col md:flex',
					!paneDragging && 'transition-[flex-grow] duration-300 ease-out'
				]}
			>
				{@render copilotPanel(true)}
			</Resizable.Pane>
		{/if}
	</Resizable.PaneGroup>

	{#if !isMobile.current && !copilotOpen}
		<div
			class="hidden w-10 shrink-0 flex-col items-center gap-3 border-l border-border bg-background py-3 md:flex"
			in:fly={{ x: 12, duration: 180, delay: 200, easing: cubicOut }}
			out:fly={{ x: 12, duration: 120, easing: cubicOut }}
		>
			<Button
				size="icon"
				variant="ghost"
				class="h-8 w-8 text-primary"
				onclick={openCopilot}
				data-testid="open-project-copilot"
				aria-label="Open project agent"
			>
				<Sparkles class="h-4 w-4" />
			</Button>
			<span
				class="text-[10px] font-medium tracking-wider text-muted-foreground uppercase [writing-mode:vertical-rl]"
			>
				Agent
			</span>
		</div>
	{/if}
</div>
