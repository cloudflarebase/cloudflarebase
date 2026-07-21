<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { scrollY } from 'svelte/reactivity/window';
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { Button } from '$lib/components/ui/button';
	import CodeExamples from '$lib/components/code-examples.svelte';
	import ModeToggle from '$lib/components/mode-toggle.svelte';
	import { buildIntegrationExamples } from '$lib/integration-examples';
	import { cn } from '$lib/utils';
	import {
		Menu,
		X,
		ArrowRight,
		Check,
		ChevronDown,
		Database,
		KeyRound,
		Cookie,
		Globe,
		Radio,
		Activity,
		ChartColumn,
		Bot,
		UserRound,
		UserX,
		Fingerprint,
		Boxes,
		Zap,
		HardDrive,
		Clock
	} from '@lucide/svelte';

	const github = 'https://github.com/cloudflarebase/cloudflarebase.com';

	type MenuItem = { name: string; href: string };
	let menuItems: MenuItem[] = [
		{ name: 'Live today', href: '#live' },
		{ name: 'Architecture', href: '#architecture' },
		{ name: 'API', href: '#api' },
		{ name: 'Roadmap', href: '#roadmap' },
		{ name: 'FAQ', href: '#faq' }
	];

	let menuState = $state(false);
	let isScrolled = $derived.by(() => (scrollY.current ?? 0) > 50);

	const runtime = [
		'Workers',
		'Durable Objects',
		'Agents SDK',
		'Better Auth',
		'Drizzle ORM',
		'Workers AI',
		'Analytics Engine'
	];

	// Everything in this grid ships in the Auth Agent MVP today.
	const liveFeatures = [
		{
			icon: KeyRound,
			title: 'Email & password',
			desc: 'Signup, signin, signout, and session lookup through Better Auth routes.'
		},
		{
			icon: UserRound,
			title: 'Guest sessions',
			desc: 'Anonymous sessions so people can try your app before handing over an email.'
		},
		{
			icon: Fingerprint,
			title: 'Google OAuth',
			desc: 'Optional social sign-in, configured per project.'
		},
		{
			icon: Cookie,
			title: 'Cookies & bearer tokens',
			desc: 'Project-scoped cookies for browsers; a set-auth-token bearer token for everything else.'
		},
		{
			icon: Globe,
			title: 'Trusted origins & CORS',
			desc: 'Per-project allowed origins. The agent echoes the exact trusted origin — no wildcards.'
		},
		{
			icon: UserX,
			title: 'Admin controls',
			desc: 'Delete users and revoke individual sessions straight from the dashboard.'
		},
		{
			icon: Activity,
			title: 'Realtime counters',
			desc: 'Live user and session counts pushed to the dashboard over WebSockets via Agents SDK state sync.'
		},
		{
			icon: ChartColumn,
			title: 'Behavioral analytics',
			desc: 'Near-real-time signup and activity charts in your local timezone, backed by Workers Analytics Engine.'
		},
		{
			icon: Bot,
			title: 'AI copilot',
			desc: "Workers AI chat grounded in your project's operational and aggregate auth data."
		}
	];

	// How a request actually flows through the system.
	const steps = [
		{
			icon: Globe,
			title: 'Enter at the edge',
			desc: "Requests hit Cloudflare's network and the same-origin gateway, which preserves your cookies, origin, and the edge-resolved country before routing over a service binding."
		},
		{
			icon: Boxes,
			title: 'One agent per project',
			desc: 'Your project maps to a single AuthAgent Durable Object — Better Auth and Drizzle on embedded SQLite. Strongly consistent, no connection pool, no separate database to run.'
		},
		{
			icon: Radio,
			title: 'Fan out in realtime',
			desc: 'State changes sync to connected dashboards over WebSockets, and auth events stream to Workers Analytics Engine for the charts.'
		}
	];

	const roadmap = [
		{ icon: KeyRound, name: 'Auth', live: true },
		{ icon: Database, name: 'Database', live: false },
		{ icon: HardDrive, name: 'Storage', live: false },
		{ icon: Zap, name: 'Functions', live: false },
		{ icon: Radio, name: 'Realtime', live: false },
		{ icon: Clock, name: 'Cron & Queues', live: false }
	];

	const faqs = [
		{
			q: 'How is the Auth primitive actually built?',
			a: 'It runs as a Cloudflare Agent on top of Better Auth. Each project maps to one Durable Object with embedded SQLite, giving identities and sessions a strongly consistent home while Workers provide global ingress. Drizzle handles the schema and migrations.'
		},
		{
			q: 'Can I run it on my own Cloudflare account?',
			a: 'Yes. The whole thing is on GitHub — two Workers, deployed with Wrangler. The README walks through the secrets, bindings, and deploy order for your own account.'
		},
		{
			q: 'Is this production-ready?',
			a: "It's an MVP under active development. Durable Object SQLite is the source of truth for users and sessions; Analytics Engine is sampled with a limited retention window, so it only powers charts. Treat it as a working preview, not a place for production identities yet."
		},
		{
			q: 'What does the AI copilot see?',
			a: "Chat is grounded in the project's operational and aggregate auth data. Conversations are stored under a project-scoped hash of the connecting IP — raw IPs and user IDs are never written to chat rows. If inference fails you get a 502 on chat, and auth keeps working."
		}
	];

	let openFaq = $state<number | null>(0);

	const apiExamples = buildIntegrationExamples('/api/projects/PROJECT_ID/auth');

	// Agent-topology visual: simulated traffic converging on one project agent.
	const mapW = 480;
	const mapH = 220;
	const dots: { x: number; y: number }[] = [];
	for (let x = 8; x < mapW; x += 16) {
		for (let y = 8; y < mapH; y += 16) {
			if (Math.sin(x * 0.045) * Math.cos(y * 0.07) > -0.15) dots.push({ x, y });
		}
	}
	const agent = { x: 250, y: 106 };
	const dashboard = { x: 74, y: 178 };
	const clients = [
		{ x: 62, y: 56, dur: 2.8, begin: 0 },
		{ x: 198, y: 36, dur: 2.4, begin: 1.5 },
		{ x: 388, y: 64, dur: 3.1, begin: 0.6 },
		{ x: 428, y: 152, dur: 3.5, begin: 2.2 },
		{ x: 318, y: 186, dur: 2.6, begin: 1.1 }
	];

	type FeedEvent = { id: number; time: string; label: string; detail: string; sync: boolean };
	const eventPool: Omit<FeedEvent, 'id' | 'time'>[] = [
		{ label: 'POST /auth/sign-up/email', detail: 'user created', sync: false },
		{ label: 'state sync', detail: '→ dashboard', sync: true },
		{ label: 'GET /auth/get-session', detail: 'bearer token', sync: false },
		{ label: 'event', detail: '→ analytics engine', sync: true },
		{ label: 'POST /auth/sign-in/anonymous', detail: 'guest session', sync: false },
		{ label: 'POST /auth/sign-in/social', detail: 'google', sync: false },
		{ label: 'state sync', detail: '→ 2 dashboards', sync: true },
		{ label: 'DELETE /admin/sessions/:id', detail: 'revoked', sync: false }
	];
	let feed = $state<FeedEvent[]>([]);
	let reduceMotion = $state(false);

	function stamp() {
		return new Date().toTimeString().slice(0, 8);
	}

	onMount(() => {
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const sections = Array.from(document.querySelectorAll<HTMLElement>('main > section'));
		sections.forEach((section, index) => {
			section.classList.add('landing-reveal');
			section.style.setProperty('--reveal-delay', `${Math.min(index * 35, 140)}ms`);
		});

		const observer = reduceMotion
			? null
			: new IntersectionObserver(
					(entries) => {
						for (const entry of entries) {
							if (!entry.isIntersecting) continue;
							(entry.target as HTMLElement).classList.add('is-visible');
							observer?.unobserve(entry.target);
						}
					},
					{ threshold: 0.12, rootMargin: '0px 0px -7% 0px' }
				);

		if (observer) sections.forEach((section) => observer.observe(section));
		else sections.forEach((section) => section.classList.add('is-visible'));

		let cursor = 0;
		feed = eventPool.slice(0, 5).map((e, i) => ({ ...e, id: i, time: stamp() }));
		cursor = 5;
		const interval = reduceMotion
			? null
			: setInterval(() => {
					feed = [
						{ ...eventPool[cursor % eventPool.length], id: cursor, time: stamp() },
						...feed
					].slice(0, 6);
					cursor += 1;
				}, 1700);

		return () => {
			observer?.disconnect();
			if (interval) clearInterval(interval);
		};
	});
</script>

<svelte:head>
	<title>Cloudflarebase — The open-source Firebase for Cloudflare</title>
	<meta
		name="description"
		content="The open-source Firebase for Cloudflare. Every backend primitive is a Cloudflare Agent — one Durable Object per project. Auth is live today with realtime sync, analytics, and an AI copilot."
	/>
	<meta property="og:title" content="Cloudflarebase — The open-source Firebase for Cloudflare" />
	<meta
		property="og:description"
		content="Ship authentication on Cloudflare with isolated Durable Objects, realtime analytics, and an AI copilot."
	/>
	<meta name="twitter:title" content="Cloudflarebase — The open-source Firebase for Cloudflare" />
	<meta
		name="twitter:description"
		content="Ship authentication on Cloudflare with isolated Durable Objects, realtime analytics, and an AI copilot."
	/>
</svelte:head>

<div class="bg-background text-foreground">
	{@render heroheader()}

	<main class="overflow-hidden">
		<div class="absolute inset-0 isolate hidden opacity-65 contain-strict lg:block">
			<div
				class="absolute top-0 left-0 h-320 w-140 -translate-y-87.5 -rotate-45 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,hsla(0,0%,85%,.08)_0,hsla(0,0%,55%,.02)_50%,hsla(0,0%,45%,0)_80%)]"
			></div>
			<div
				class="absolute top-0 left-0 h-320 w-60 [translate:5%_-50%] -rotate-45 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.06)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)]"
			></div>
			<div
				class="absolute top-0 left-0 h-320 w-60 -translate-y-87.5 -rotate-45 bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.04)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)]"
			></div>
		</div>

		<!-- HERO -->
		<section>
			<div class="relative pt-24 md:pt-36">
				<div
					class="absolute inset-0 -z-10 size-full [background:radial-gradient(125%_125%_at_50%_100%,transparent_0%,var(--color-background)_75%)]"
				></div>
				<div class="mx-auto max-w-7xl px-4 sm:px-6">
					<div class="hero-stagger text-center sm:mx-auto lg:mt-0 lg:mr-auto">
						<div>
							<a
								href={github}
								target="_blank"
								rel="noreferrer"
								class="group mx-auto flex w-fit items-center gap-4 rounded-full border bg-muted p-1 pl-4 shadow-md shadow-zinc-950/5 transition-colors duration-300 hover:bg-background dark:border-t-white/5 dark:shadow-zinc-950 dark:hover:border-t-border"
							>
								<span class="text-sm text-foreground">Open source · Auth Agent is live</span>
								<span
									class="block h-4 w-0.5 border-l bg-white dark:border-background dark:bg-zinc-700"
								></span>
								<div
									class="size-6 overflow-hidden rounded-full bg-background duration-500 group-hover:bg-muted"
								>
									<div
										class="flex w-12 -translate-x-1/2 duration-500 ease-in-out group-hover:translate-x-0"
									>
										<span class="flex size-6"><ArrowRight class="m-auto size-3" /></span>
										<span class="flex size-6"><ArrowRight class="m-auto size-3" /></span>
									</div>
								</div>
							</a>
						</div>

						<h1
							class="mt-8 text-4xl leading-[1.05] text-balance sm:text-6xl md:text-7xl lg:mt-16 xl:text-[5.25rem]"
						>
							The open-source Firebase for Cloudflare.
						</h1>
						<p
							class="mx-auto mt-6 max-w-2xl text-base text-balance text-muted-foreground sm:mt-8 sm:text-lg"
						>
							Every backend primitive is a Cloudflare Agent — one Durable Object per project, zero
							servers, no regions to pick. Auth is live today, with realtime sync, analytics, and an
							AI copilot built in.
						</p>

						<div class="mt-12 flex flex-col items-center justify-center gap-2 md:flex-row">
							<div
								class="border bg-foreground/10 p-0.5"
								style="border-radius: calc(0.5rem + 0.125rem + 4px);"
							>
								<Button href="/dashboard" size="lg" class="rounded-xl px-5 text-base"
									>Open the live demo</Button
								>
							</div>
							<Button
								href={github}
								target="_blank"
								rel="noreferrer"
								size="lg"
								variant="ghost"
								class="rounded-xl px-5"
							>
								{@render githubMark('h-4 w-4')}
								View on GitHub
							</Button>
						</div>
						<p class="mt-4 font-mono text-xs text-muted-foreground/70">
							POST /api/projects/:projectId/auth/sign-up/email · it's just HTTP
						</p>
					</div>
				</div>

				<!-- Signature visual: one agent per project -->
				<div class="hero-visual relative mt-8 overflow-hidden px-2 sm:mt-12 md:mt-20">
					<div
						class="absolute inset-0 z-10 bg-linear-to-b from-transparent from-35% to-background"
					></div>
					<div
						class="relative mx-auto max-w-6xl overflow-hidden rounded-2xl border bg-background p-4 shadow-lg inset-shadow-2xs shadow-zinc-950/15 ring-background dark:inset-shadow-white/20"
					>
						<div class="overflow-hidden rounded-xl border border-border bg-card">
							<div
								class="flex items-center justify-between border-b border-border px-5 py-3.5 font-mono text-xs text-muted-foreground"
							>
								<span class="flex min-w-0 items-center gap-2.5 truncate">
									<span class="flex gap-1.5">
										<span class="h-2 w-2 rounded-full bg-border"></span>
										<span class="h-2 w-2 rounded-full bg-border"></span>
										<span class="h-2 w-2 rounded-full bg-border"></span>
									</span>
									auth-agent · project: demo
								</span>
								<span class="hidden shrink-0 sm:inline">simulated traffic</span>
							</div>
							<div class="grid grid-cols-1 md:grid-cols-[1fr_280px]">
								<div class="border-b border-border p-6 md:border-r md:border-b-0">
									<svg viewBox="0 0 {mapW} {mapH}" class="w-full">
										{#each dots as d (`${d.x}-${d.y}`)}
											<circle cx={d.x} cy={d.y} r="1.1" class="fill-muted-foreground/20" />
										{/each}

										{#each clients as c (c.x)}
											<line
												x1={c.x}
												y1={c.y}
												x2={agent.x}
												y2={agent.y}
												class="stroke-muted-foreground"
												stroke-width="1"
												stroke-dasharray="3 3"
												opacity="0.3"
											/>
											<circle cx={c.x} cy={c.y} r="3" class="fill-foreground" />
											{#if !reduceMotion}
												<circle r="2.2" class="fill-primary">
													<animateMotion
														dur="{c.dur}s"
														begin="{c.begin}s"
														repeatCount="indefinite"
														calcMode="spline"
														keyPoints="0;1"
														keyTimes="0;1"
														keySplines="0.42 0 1 1"
														path="M{c.x},{c.y} L{agent.x},{agent.y}"
													/>
												</circle>
											{/if}
										{/each}

										<line
											x1={agent.x}
											y1={agent.y}
											x2={dashboard.x}
											y2={dashboard.y}
											class="stroke-chart-3"
											stroke-width="1"
											stroke-dasharray="3 3"
											opacity="0.45"
										/>
										<rect
											x={dashboard.x - 5}
											y={dashboard.y - 4}
											width="10"
											height="8"
											rx="1.5"
											class="fill-chart-3"
										/>
										{#if !reduceMotion}
											<circle r="2.2" class="fill-chart-3">
												<animateMotion
													dur="1.8s"
													begin="0.4s"
													repeatCount="indefinite"
													path="M{agent.x},{agent.y} L{dashboard.x},{dashboard.y}"
												/>
											</circle>
										{/if}

										<circle cx={agent.x} cy={agent.y} r="14" class="fill-primary/15" />
										<circle cx={agent.x} cy={agent.y} r="6" class="fill-primary" />
										{#if !reduceMotion}
											{#each [0, 1.2] as ringDelay (ringDelay)}
												<circle
													cx={agent.x}
													cy={agent.y}
													r="10"
													opacity="0"
													class="fill-none stroke-primary"
													stroke-width="1"
												>
													<animate
														attributeName="r"
														values="10;26"
														dur="2.4s"
														begin="{ringDelay}s"
														repeatCount="indefinite"
													/>
													<animate
														attributeName="opacity"
														values="0.5;0"
														dur="2.4s"
														begin="{ringDelay}s"
														repeatCount="indefinite"
													/>
												</circle>
											{/each}
										{/if}

										<text
											x={agent.x}
											y={agent.y + 32}
											text-anchor="middle"
											class="fill-muted-foreground font-mono text-[9px]">AuthAgent · DO SQLite</text
										>
										<text
											x={dashboard.x}
											y={dashboard.y + 18}
											text-anchor="middle"
											class="fill-muted-foreground font-mono text-[9px]">dashboard</text
										>
									</svg>
									<div
										class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[11px] text-muted-foreground/70"
									>
										<span class="flex items-center gap-1.5">
											<span class="h-1.5 w-1.5 rounded-full bg-primary"></span> auth requests
										</span>
										<span class="flex items-center gap-1.5">
											<span class="h-1.5 w-1.5 rounded-full bg-chart-3"></span> WebSocket state sync
										</span>
										<span>one Durable Object per project</span>
									</div>
								</div>
								<div class="min-h-[220px] p-5">
									<div
										class="mb-3 font-mono text-[11px] tracking-wide text-muted-foreground/70 uppercase"
									>
										Agent activity
									</div>
									<div class="space-y-2.5 font-mono text-[11px]">
										{#each feed as event (event.id)}
											<div
												class="flex items-baseline gap-2"
												in:fly={{ y: -8, duration: reduceMotion ? 0 : 300 }}
												animate:flip={{ duration: reduceMotion ? 0 : 300 }}
											>
												<span
													class={cn(
														'h-1.5 w-1.5 flex-shrink-0 translate-y-px rounded-full',
														event.sync ? 'bg-chart-3' : 'bg-primary'
													)}
												></span>
												<span class="text-muted-foreground/60">{event.time}</span>
												<span class="min-w-0 truncate text-foreground">{event.label}</span>
												<span class="ml-auto flex-shrink-0 text-muted-foreground/70"
													>{event.detail}</span
												>
											</div>
										{/each}
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- Runtime strip -->
		<section class="bg-background pt-16 pb-16 md:pb-28">
			<div class="relative m-auto max-w-5xl px-6">
				<p class="text-center text-sm text-muted-foreground">
					Built natively on the Cloudflare Developer Platform
				</p>
				<div
					class="relative mt-8 overflow-hidden mask-[linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]"
				>
					<div class="marquee-track flex">
						{#each [false, true] as duplicate (duplicate)}
							<div
								class="flex items-center gap-3 pr-3"
								aria-hidden={duplicate}
								data-duplicate={duplicate ? '' : undefined}
							>
								{#each runtime as name (name)}
									<span
										class="rounded-full border border-border px-4 py-1.5 font-mono text-xs whitespace-nowrap text-muted-foreground"
										>{name}</span
									>
								{/each}
							</div>
						{/each}
					</div>
				</div>
			</div>
		</section>

		<!-- LIVE TODAY -->
		<section id="live" class="border-y border-border bg-card px-4 py-16 sm:px-8 sm:py-24">
			<div class="mx-auto max-w-6xl">
				<div class="mb-14 max-w-xl">
					<span
						class="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
					>
						<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"></span>
						Live today
					</span>
					<h2 class="mt-4 text-3xl font-bold md:text-4xl">
						Auth shipped first. It's live right now.
					</h2>
					<p class="mt-3 text-muted-foreground">
						Not a waitlist, not a mockup. Open the demo and a real, isolated project — with its own
						Durable Object — spins up for your browser.
					</p>
				</div>
				<div
					class="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3"
				>
					{#each liveFeatures as f (f.title)}
						<div class="bg-card p-7 transition-colors hover:bg-accent/40">
							<div
								class="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
							>
								<f.icon class="h-[18px] w-[18px]" strokeWidth={1.8} />
							</div>
							<h3 class="mb-1.5 font-semibold">{f.title}</h3>
							<p class="text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<!-- ARCHITECTURE -->
		<section id="architecture" class="px-4 py-16 sm:px-8 sm:py-24">
			<div class="mx-auto max-w-6xl">
				<div class="mb-14 max-w-xl">
					<span
						class="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
						>Architecture</span
					>
					<h2 class="mt-4 text-3xl font-bold md:text-4xl">
						Two Workers. One Durable Object per project.
					</h2>
					<p class="mt-3 text-muted-foreground">
						That's the whole diagram. No origin fleet, no connection pools — your backend state
						lives with the compute that serves it.
					</p>
				</div>
				<div class="grid grid-cols-1 gap-8 md:grid-cols-3">
					{#each steps as s, i (s.title)}
						<div
							class="relative rounded-2xl border border-border bg-card p-7 transition-colors hover:border-primary/40"
						>
							<span class="font-mono text-xs text-muted-foreground/60">0{i + 1}</span>
							<div
								class="mt-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"
							>
								<s.icon class="h-5 w-5" strokeWidth={1.8} />
							</div>
							<h3 class="mt-4 font-semibold">{s.title}</h3>
							<p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<!-- API -->
		<section id="api" class="border-y border-border bg-card px-4 py-16 sm:px-8 sm:py-24">
			<div class="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 md:grid-cols-2">
				<div>
					<span
						class="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
						>API</span
					>
					<h2 class="mt-4 text-3xl leading-tight font-bold md:text-4xl">
						No SDK to install. It's just HTTP.
					</h2>
					<p class="mt-4 text-muted-foreground">
						Point <code class="font-mono">fetch</code> at your project's endpoint and you're integrated.
						The routes are Better Auth's, scoped to your project — this is the exact API the demo dashboard
						uses.
					</p>
					<ul class="mt-6 space-y-3 text-sm">
						<li class="flex gap-2.5">
							<Check class="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
							Cookie sessions for same-origin browser apps
						</li>
						<li class="flex gap-2.5">
							<Check class="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
							<span
								>Bearer tokens via the <code class="font-mono">set-auth-token</code> header for external
								and non-browser clients</span
							>
						</li>
						<li class="flex gap-2.5">
							<Check class="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
							Per-project trusted origins — add yours under Authentication → Settings
						</li>
						<li class="flex gap-2.5">
							<Check class="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
							<span
								>Public config endpoint: <code class="font-mono"
									>GET /api/projects/:projectId/config</code
								></span
							>
						</li>
					</ul>
				</div>
				<div class="overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
					<div class="flex items-center gap-1.5 border-b border-border px-4 py-3">
						<span class="h-2.5 w-2.5 rounded-full bg-border"></span>
						<span class="h-2.5 w-2.5 rounded-full bg-border"></span>
						<span class="h-2.5 w-2.5 rounded-full bg-border"></span>
					</div>
					<CodeExamples examples={apiExamples} class="p-4" />
				</div>
			</div>
		</section>

		<!-- ROADMAP -->
		<section id="roadmap" class="px-4 py-16 sm:px-8 sm:py-24">
			<div class="mx-auto max-w-6xl">
				<div class="mb-14 max-w-xl">
					<span
						class="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
						>Roadmap</span
					>
					<h2 class="mt-4 text-3xl font-bold md:text-4xl">
						Every Firebase primitive. One agent at a time.
					</h2>
					<p class="mt-3 text-muted-foreground">
						We ship primitives in order, and every one lands the same way: its own agent, one
						Durable Object per client project, and a same-origin dashboard proxy.
					</p>
				</div>
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
					{#each roadmap as item (item.name)}
						<div
							class={cn(
								'rounded-2xl border p-5',
								item.live
									? 'border-primary bg-gradient-to-b from-primary/[0.06] to-card'
									: 'border-dashed border-border bg-card/50'
							)}
						>
							<div
								class={cn(
									'flex h-9 w-9 items-center justify-center rounded-lg',
									item.live ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground/60'
								)}
							>
								<item.icon class="h-[18px] w-[18px]" strokeWidth={1.8} />
							</div>
							<h3 class={cn('mt-3 text-sm font-semibold', !item.live && 'text-muted-foreground')}>
								{item.name}
							</h3>
							<span
								class={cn(
									'mt-1.5 inline-block rounded-full px-2 py-0.5 font-mono text-[10px] uppercase',
									item.live ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground/60'
								)}>{item.live ? 'Live' : 'Planned'}</span
							>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<!-- FAQ -->
		<section id="faq" class="border-t border-border bg-card px-4 py-16 sm:px-8 sm:py-24">
			<div class="mx-auto max-w-3xl">
				<div class="mb-12 text-center">
					<span
						class="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
						>FAQ</span
					>
					<h2 class="mt-4 text-3xl font-bold md:text-4xl">Questions, answered plainly.</h2>
				</div>
				<div class="divide-y divide-border rounded-xl border border-border bg-background">
					{#each faqs as item, i (item.q)}
						<div>
							<button
								onclick={() => (openFaq = openFaq === i ? null : i)}
								class="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
							>
								<span class="font-medium">{item.q}</span>
								<ChevronDown
									class={cn(
										'h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform',
										openFaq === i && 'rotate-180'
									)}
								/>
							</button>
							{#if openFaq === i}
								<div class="px-6 pb-5 text-sm leading-relaxed text-muted-foreground">{item.a}</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		</section>

		<!-- CTA BAND -->
		<section class="px-4 py-20 text-center sm:px-8 sm:py-28">
			<span
				class="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
			>
				<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"></span>
				Nothing to sign up for
			</span>
			<h2 class="mx-auto mt-5 max-w-2xl text-3xl font-bold sm:text-4xl md:text-5xl">
				Spin up a real Durable Object in one click.
			</h2>
			<p class="mx-auto mt-4 max-w-xl text-muted-foreground">
				Opening the dashboard creates an isolated demo project for your browser. Poke the API, watch
				the state sync live, ask the copilot about it.
			</p>
			<div class="mt-8 flex flex-wrap justify-center gap-3">
				<Button href="/dashboard" size="lg">Open the live demo</Button>
				<Button href={github} target="_blank" rel="noreferrer" size="lg" variant="outline">
					{@render githubMark('h-4 w-4')}
					View on GitHub
				</Button>
			</div>
		</section>
	</main>

	<!-- FOOTER -->
	<footer class="border-t border-border px-4 pt-12 pb-8 sm:px-8">
		<div class="mx-auto max-w-6xl">
			<div class="mb-11 flex flex-wrap justify-between gap-10">
				<div>
					<div class="flex items-center gap-2 text-lg font-bold">
						<img src="/brand/mark.svg" alt="" class="h-5 w-5" />
						Cloudflarebase
					</div>
					<p class="mt-2.5 max-w-[240px] text-sm text-muted-foreground/70">
						The product layer for Cloudflare's developer platform. Open source, shipped one
						primitive at a time.
					</p>
				</div>
				<div class="flex w-full flex-wrap gap-10 sm:w-auto sm:gap-16">
					<div>
						<h4 class="mb-3.5 font-mono text-xs tracking-wide text-muted-foreground/70 uppercase">
							Product
						</h4>
						<a href="#live" class="mb-2.5 block text-sm text-muted-foreground hover:text-foreground"
							>Live today</a
						>
						<a href="#api" class="mb-2.5 block text-sm text-muted-foreground hover:text-foreground"
							>API</a
						>
						<a
							href="#roadmap"
							class="mb-2.5 block text-sm text-muted-foreground hover:text-foreground">Roadmap</a
						>
					</div>
					<div>
						<h4 class="mb-3.5 font-mono text-xs tracking-wide text-muted-foreground/70 uppercase">
							Resources
						</h4>
						<a
							href={github}
							target="_blank"
							rel="noreferrer"
							class="mb-2.5 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
						>
							{@render githubMark('h-3.5 w-3.5')}
							GitHub
						</a>
						<a
							href="{github}#readme"
							target="_blank"
							rel="noreferrer"
							class="mb-2.5 block text-sm text-muted-foreground hover:text-foreground">README</a
						>
						<a href="#faq" class="mb-2.5 block text-sm text-muted-foreground hover:text-foreground"
							>FAQ</a
						>
					</div>
				</div>
			</div>
			<div
				class="flex items-center justify-between border-t border-border pt-6 text-xs text-muted-foreground/70"
			>
				<span>© 2026 Cloudflarebase</span>
				<span>Built on Cloudflare</span>
			</div>
		</div>
	</footer>
</div>

{#snippet githubMark(classes: string)}
	<svg viewBox="0 0 24 24" fill="currentColor" class={classes} aria-hidden="true">
		<path
			d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.66.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"
		/>
	</svg>
{/snippet}

{#snippet heroheader()}
	<header>
		<nav class="fixed z-20 w-full px-2">
			<div
				class={[
					'mx-auto mt-2 max-w-6xl rounded-2xl px-6 transition-all duration-300 lg:px-12',
					isScrolled && 'max-w-4xl rounded-2xl border bg-background/50 backdrop-blur-lg lg:px-5'
				]}
			>
				<div
					class="relative flex flex-wrap items-center justify-between gap-6 py-3 lg:gap-0 lg:py-4"
				>
					<div class="flex w-full justify-between lg:w-auto">
						<a
							href={resolve('/')}
							aria-label="home"
							class="flex items-center gap-2 text-lg font-bold"
						>
							<img src="/brand/mark.svg" alt="" class="h-[22px] w-[22px]" />
							Cloudflarebase
						</a>

						<div class="flex items-center gap-1 lg:hidden">
							<ModeToggle variant="ghost" class="h-9 w-9" />
							<button
								onclick={() => (menuState = !menuState)}
								aria-label={menuState == true ? 'Close Menu' : 'Open Menu'}
								class="relative z-20 -m-2.5 -mr-4 block cursor-pointer p-2.5"
							>
								<Menu
									class={[
										'm-auto size-6 duration-200',
										menuState && 'scale-0 rotate-180 opacity-0'
									]}
								/>
								<X
									class={[
										'absolute inset-0 m-auto size-6 scale-0 -rotate-180 opacity-0 duration-200',
										menuState && 'scale-100 rotate-0 opacity-100'
									]}
								/>
							</button>
						</div>
					</div>

					<div class="absolute inset-0 m-auto hidden size-fit lg:block">
						<ul class="flex gap-8 text-sm">
							{#each menuItems as item (item.href)}
								<li>
									<!-- eslint-disable svelte/no-navigation-without-resolve -- same-page hash link -->
									<a
										href={item.href}
										class="block text-muted-foreground duration-150 hover:text-accent-foreground"
									>
										<span>{item.name}</span>
									</a>
									<!-- eslint-enable svelte/no-navigation-without-resolve -->
								</li>
							{/each}
						</ul>
					</div>

					<div
						class={[
							'mb-4 w-full flex-wrap items-center justify-end space-y-5 rounded-2xl border bg-background p-5 shadow-2xl shadow-zinc-300/20 md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:rounded-3xl lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none dark:shadow-none dark:lg:bg-transparent',
							menuState ? 'block lg:flex' : 'hidden lg:flex'
						]}
					>
						<ModeToggle
							variant="ghost"
							class="hidden h-9 w-9 lg:inline-flex"
							testId="landing-theme-toggle"
						/>
						<div class="lg:hidden">
							<ul class="space-y-4 text-base">
								{#each menuItems as item (item.href)}
									<li>
										<!-- eslint-disable svelte/no-navigation-without-resolve -- same-page hash link -->
										<a
											href={item.href}
											onclick={() => (menuState = false)}
											class="block text-muted-foreground duration-150 hover:text-accent-foreground"
										>
											<span>{item.name}</span>
										</a>
										<!-- eslint-enable svelte/no-navigation-without-resolve -->
									</li>
								{/each}
							</ul>
						</div>
						<div class="flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit">
							<Button href="/dashboard" size="sm" class={cn(isScrolled && 'lg:hidden')}
								>Open live demo</Button
							>
							<Button
								href="/dashboard"
								size="sm"
								class={cn('hidden', isScrolled && 'lg:inline-flex')}>Live demo</Button
							>
						</div>
					</div>
				</div>
			</div>
		</nav>
	</header>
{/snippet}

<style>
	@keyframes hero-rise {
		from {
			opacity: 0;
			transform: translateY(16px);
			filter: blur(6px);
		}
		to {
			opacity: 1;
			transform: none;
			filter: none;
		}
	}

	.hero-stagger > :global(*) {
		animation: hero-rise 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}
	.hero-stagger > :global(*:nth-child(1)) {
		animation-delay: 60ms;
	}
	.hero-stagger > :global(*:nth-child(2)) {
		animation-delay: 140ms;
	}
	.hero-stagger > :global(*:nth-child(3)) {
		animation-delay: 230ms;
	}
	.hero-stagger > :global(*:nth-child(4)) {
		animation-delay: 320ms;
	}
	.hero-stagger > :global(*:nth-child(5)) {
		animation-delay: 400ms;
	}

	.hero-visual {
		animation: hero-rise 900ms cubic-bezier(0.2, 0.8, 0.2, 1) 380ms both;
	}

	@keyframes marquee {
		to {
			transform: translateX(-50%);
		}
	}

	.marquee-track {
		width: max-content;
		animation: marquee 28s linear infinite;
	}
	.marquee-track:hover {
		animation-play-state: paused;
	}

	@media (prefers-reduced-motion: reduce) {
		.hero-stagger > :global(*),
		.hero-visual {
			animation: none;
		}
		.marquee-track {
			width: auto;
			animation: none;
			justify-content: center;
		}
		.marquee-track > :global([data-duplicate]) {
			display: none;
		}
		.marquee-track > :global(div) {
			flex-wrap: wrap;
			justify-content: center;
		}
	}
</style>
