<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import {
		ArrowRight,
		Bot,
		Clock,
		Database,
		HardDrive,
		House,
		KeyRound,
		Moon,
		Radio,
		SendHorizontal,
		Sparkles,
		Sun,
		X,
		Zap
	} from '@lucide/svelte';

	let { children } = $props();

	const projectId = $derived(page.params.projectId ?? 'demo');
	// Writable derived: resets to the current project on navigation, while the
	// input binding can still overwrite it locally.
	let projectInput = $derived(page.params.projectId ?? 'demo');
	const isMobile = new IsMobile();
	let copilotOpen = $derived(!isMobile.current);
	let copilotInput = $state('');
	let copilotBusy = $state(false);
	let darkMode = $state(false);
	type CopilotMessage = { id: string; role: 'user' | 'agent'; content: string; mode?: string };
	let copilotMessages = $state<CopilotMessage[]>([]);

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

	onMount(() => {
		darkMode = document.documentElement.classList.contains('dark');
	});

	function toggleTheme() {
		darkMode = !darkMode;
		document.documentElement.classList.toggle('dark', darkMode);
		localStorage.setItem('cfb-theme', darkMode ? 'dark' : 'light');
	}

	function switchProject(event: SubmitEvent) {
		event.preventDefault();
		const slug = projectInput.trim().toLowerCase();
		if (/^[a-z0-9][a-z0-9-]{0,31}$/.test(slug) && slug !== projectId) {
			void goto(resolve('/dashboard/[projectId]', { projectId: slug }));
		}
	}

	async function askCopilot(question: string) {
		const trimmed = question.trim();
		if (!trimmed || copilotBusy) return;
		copilotBusy = true;
		copilotInput = '';
		copilotMessages = [
			...copilotMessages,
			{ id: crypto.randomUUID(), role: 'user', content: trimmed }
		];
		try {
			const response = await fetch(`/api/projects/${projectId}/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ question: trimmed })
			});
			const reply = (await response.json()) as { answer?: string; error?: string; mode?: string };
			copilotMessages = [
				...copilotMessages,
				{
					id: crypto.randomUUID(),
					role: 'agent',
					content: response.ok
						? (reply.answer ?? 'No answer returned.')
						: (reply.error ?? 'I could not answer that.'),
					mode: reply.mode
				}
			];
		} catch {
			copilotMessages = [
				...copilotMessages,
				{ id: crypto.randomUUID(), role: 'agent', content: 'The project agent is unavailable.' }
			];
		} finally {
			copilotBusy = false;
		}
	}
</script>

<div class="flex min-h-screen bg-background text-foreground">
	<!-- Sidebar -->
	<aside class="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
		<a
			href={resolve('/')}
			class="flex items-center gap-2 border-b border-border px-5 py-4 font-bold"
		>
			<svg viewBox="0 0 24 24" fill="none" class="h-5 w-5 text-primary">
				<path
					d="M12 2L3 7V17L12 22L21 17V7L12 2Z"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linejoin="round"
				/>
			</svg>
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
		<header class="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
			<div class="flex items-center gap-2 text-sm">
				<a href={resolve('/')} class="font-bold md:hidden">Cloudflarebase</a>
				<span class="hidden text-muted-foreground md:inline">Project</span>
				<Badge variant="secondary" class="font-mono" data-testid="project-badge">{projectId}</Badge>
			</div>

			<div class="flex items-center gap-2">
				<Button
					type="button"
					size="icon"
					variant="outline"
					class="h-8 w-8"
					onclick={toggleTheme}
					aria-label={darkMode ? 'Use light mode' : 'Use dark mode'}
					data-testid="theme-toggle"
				>
					{#if darkMode}<Sun class="h-4 w-4" />{:else}<Moon class="h-4 w-4" />{/if}
				</Button>
				<form onsubmit={switchProject} class="flex items-center gap-2">
					<Input
						bind:value={projectInput}
						class="h-8 w-40 font-mono text-xs"
						placeholder="switch project…"
						aria-label="Project id"
					/>
					<Button type="submit" size="sm" variant="outline" class="h-8" aria-label="Switch project">
						<ArrowRight class="h-3.5 w-3.5" />
					</Button>
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
			{@render children()}
		</main>
	</div>

	{#if copilotOpen}
		<aside
			class="fixed right-4 bottom-4 z-40 flex h-[min(680px,calc(100vh-2rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
			data-testid="project-copilot"
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

			<div class="flex-1 space-y-3 overflow-y-auto p-4" data-testid="copilot-messages">
				{#if copilotMessages.length === 0}
					<div class="rounded-xl border bg-muted/40 p-4">
						<div class="mb-2 flex items-center gap-2 text-sm font-medium">
							<Bot class="h-4 w-4 text-primary" /> What can I help with?
						</div>
						<p class="text-xs leading-relaxed text-muted-foreground">
							I can explain usage, compare activity, and surface authentication issues from this
							project's aggregated data.
						</p>
					</div>
					<div class="grid gap-2">
						{#each ['Summarize this project', 'What should I investigate?', 'How is user activity?'] as suggestion}
							<button
								class="rounded-lg border px-3 py-2 text-left text-xs hover:border-primary/40 hover:bg-primary/5"
								onclick={() => askCopilot(suggestion)}
							>
								{suggestion}
							</button>
						{/each}
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
			class="fixed right-5 bottom-5 z-40 gap-2 rounded-full shadow-lg"
			onclick={() => (copilotOpen = true)}
			data-testid="open-project-copilot"
		>
			<Sparkles class="h-4 w-4" /> Ask agent
		</Button>
	{/if}
</div>
