<script lang="ts">
	import { onMount } from 'svelte';
	import { scrollY } from 'svelte/reactivity/window';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import {
		Menu,
		X,
		ArrowRight,
		Database,
		KeyRound,
		HardDrive,
		Zap,
		Radio,
		Clock,
		Check,
		Globe,
		ShieldCheck,
		Gauge,
		Terminal,
		FileCode2,
		Rocket,
		ChevronDown
	} from '@lucide/svelte';

	type MenuItem = { name: string; href: string };
	let menuItems: MenuItem[] = [
		{ name: 'Primitives', href: '#primitives' },
		{ name: 'How it works', href: '#how-it-works' },
		{ name: 'Docs', href: '#code' },
		{ name: 'Pricing', href: '#pricing' },
		{ name: 'FAQ', href: '#faq' }
	];

	let menuState = $state(false);
	let isScrolled = $derived.by(() => (scrollY.current ?? 0) > 50);

	const runtime = ['Workers', 'Durable Objects', 'D1', 'R2', 'KV', 'Queues', 'Agents'];

	// Benefits — "why Cloudflarebase" numbered section
	const benefits = [
		{
			icon: Globe,
			title: 'No region to pick',
			desc: 'Every primitive deploys to 300+ Cloudflare locations at once. There is no us-east-1 to accidentally build your whole product around.'
		},
		{
			icon: ShieldCheck,
			title: 'Auth that syncs where the user is',
			desc: 'Auth runs as a Cloudflare Agent on top of Better Auth, with session and identity state synced in real time through Durable Objects — so a login in Tokyo and a check in São Paulo both resolve locally, not against one origin.'
		},
		{
			icon: Gauge,
			title: 'Cold starts you can round to zero',
			desc: 'Functions run as V8 isolates, not containers. No 300ms wake-up tax before your first response byte.'
		},
		{
			icon: HardDrive,
			title: 'Storage that stays cheap at scale',
			desc: 'R2 under the hood means zero egress fees — the bill that usually grows fastest is the one line item that stays flat.'
		}
	];

	const primitives = [
		{
			icon: Database,
			name: 'Database',
			tag: 'cloudflarebase.db',
			desc: 'A document store backed by Durable Objects — strongly consistent, colocated with the code that reads it.'
		},
		{
			icon: KeyRound,
			name: 'Auth',
			tag: 'cloudflarebase.auth',
			desc: 'A Cloudflare Agent built on Better Auth. Sessions, tokens, and identity state sync in real time across Durable Objects, so auth checks never leave the edge.'
		},
		{
			icon: HardDrive,
			name: 'Storage',
			tag: 'cloudflarebase.storage',
			desc: "Object storage on R2 — zero egress fees, so serving files to a global audience doesn't get more expensive as you grow."
		},
		{
			icon: Zap,
			name: 'Functions',
			tag: 'cloudflarebase.fn',
			desc: "Deploy server logic as Workers. Cold starts measured in microseconds, not seconds, because there's no server to start."
		},
		{
			icon: Radio,
			name: 'Realtime',
			tag: 'cloudflarebase.live',
			desc: 'WebSocket channels backed by Durable Objects, so live cursors and presence feel instant on any continent.'
		},
		{
			icon: Clock,
			name: 'Cron & Queues',
			tag: 'cloudflarebase.queue',
			desc: 'Schedule jobs and process background work without a job runner to babysit or scale.'
		}
	];

	// How it works — 3 step sequence
	const steps = [
		{
			icon: Terminal,
			title: 'Install the SDK',
			desc: 'npx create-cloudflarebase-app@latest scaffolds a project wired to your Cloudflare account — no dashboard clicking.'
		},
		{
			icon: FileCode2,
			title: 'Define your schema',
			desc: 'Describe collections, auth providers, and storage buckets in one config file. Cloudflarebase generates a type-safe client from it.'
		},
		{
			icon: Rocket,
			title: 'git push to deploy',
			desc: 'Every push ships to all 300+ locations at once. No region selector, no manual promotion step.'
		}
	];

	const migration = [
		{ cap: 'Data locality', firebase: 'Single region per project', cfbase: '300+ edge locations' },
		{ cap: 'Egress cost on storage', firebase: 'Billed per GB out', cfbase: '$0 — no egress fees' },
		{ cap: 'Cold start on functions', firebase: '~200–800ms', cfbase: '<5ms (V8 isolates)' },
		{
			cap: 'Realtime transport',
			firebase: 'Long-polling fallback',
			cfbase: 'Native WebSockets at the edge'
		},
		{
			cap: 'Auth session sync',
			firebase: 'Single-region session store',
			cfbase: 'Durable Objects, synced globally in real time'
		}
	];

	const plans = [
		{
			name: 'Hobby',
			desc: 'For side projects and prototypes.',
			price: '$0',
			features: [
				'100K database reads/mo',
				'1GB object storage',
				'100K function invocations',
				'Community support'
			],
			cta: 'Get started',
			featured: false
		},
		{
			name: 'Pro',
			desc: 'For apps in production.',
			price: '$25',
			features: [
				'10M database reads/mo',
				'100GB object storage',
				'10M function invocations',
				'Realtime channels included',
				'Priority support'
			],
			cta: 'Start free trial',
			featured: true
		},
		{
			name: 'Scale',
			desc: 'For high-traffic, multi-region products.',
			price: 'Custom',
			features: [
				'Usage-based, volume pricing',
				'Dedicated Durable Object limits',
				'99.99% uptime SLA',
				'SSO & audit logs'
			],
			cta: 'Talk to us',
			featured: false
		}
	];

	const faqs = [
		{
			q: 'How is the Auth primitive actually built?',
			a: 'cloudflarebase.auth runs as a Cloudflare Agent on top of Better Auth. Session and identity state is stored in Durable Objects and kept in sync in real time, so an auth check in one region reflects a login that just happened in another — without a round trip to a single origin.'
		},
		{
			q: 'Do I need to know Cloudflare Workers to use Cloudflarebase?',
			a: 'No. The SDK reads the same way as most document-database clients. Cloudflarebase handles the Workers/Durable Objects/R2 wiring underneath; you write application code.'
		},
		{
			q: "What's the actual migration path from Firebase?",
			a: 'We generate an export script for Firestore collections, Firebase Auth users, and Storage buckets, and map them onto Cloudflarebase equivalents. Most teams finish in an afternoon.'
		},
		{
			q: 'What happens if Cloudflare has a regional outage?',
			a: "Durable Objects and Workers already run across Cloudflare's network rather than a single data center, so a regional issue on Cloudflare's side affects a slice of edge locations, not the whole product."
		}
	];

	let openFaq = $state<number | null>(0);

	// Edge-race visual
	const mapW = 320;
	const mapH = 190;
	const dots: { x: number; y: number }[] = [];
	for (let x = 8; x < mapW; x += 16) {
		for (let y = 8; y < mapH; y += 16) {
			if (Math.sin(x * 0.045) * Math.cos(y * 0.07) > -0.15) dots.push({ x, y });
		}
	}
	const user = { x: 60, y: 70 };
	const originTarget = { x: 290, y: 40 };
	const edgeTarget = { x: 95, y: 88 };

	let originMs = $state(0);
	let edgeMs = $state(0);

	onMount(() => {
		const start = performance.now();
		const duration = 1400;
		function step(ts: number) {
			const p = Math.min((ts - start) / duration, 1);
			const eased = 1 - Math.pow(1 - p, 3);
			originMs = Math.round(340 * eased);
			edgeMs = Math.round(38 * eased);
			if (p < 1) requestAnimationFrame(step);
		}
		requestAnimationFrame(step);
	});
</script>

<svelte:head>
	<title>Cloudflarebase — Backend infrastructure on the edge</title>
	<meta
		name="description"
		content="Database, auth, storage, and functions deployed to Cloudflare's edge. The Firebase alternative built for global latency, not one region."
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
				<div class="mx-auto max-w-7xl px-6">
					<div class="text-center sm:mx-auto lg:mt-0 lg:mr-auto">
						<div>
							<a
								href="#code"
								class="group mx-auto flex w-fit items-center gap-4 rounded-full border bg-muted p-1 pl-4 shadow-md shadow-zinc-950/5 transition-colors duration-300 hover:bg-background dark:border-t-white/5 dark:shadow-zinc-950 dark:hover:border-t-border"
							>
								<span class="text-sm text-foreground">Running on Cloudflare's network</span>
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

						<h1 class="mt-8 text-6xl text-balance md:text-7xl lg:mt-16 xl:text-[5.25rem]">
							Ship a backend that lives everywhere your users already are.
						</h1>
						<p class="mx-auto mt-8 max-w-2xl text-lg text-balance text-muted-foreground">
							Database, auth, storage, and functions — deployed to 300+ Cloudflare locations instead
							of one AWS region. Same developer experience you're used to, none of the round trips.
						</p>

						<div class="mt-12 flex flex-col items-center justify-center gap-2 md:flex-row">
							<div
								class="border bg-foreground/10 p-0.5"
								style="border-radius: calc(0.5rem + 0.125rem + 4px);"
							>
								<Button size="lg" class="rounded-xl px-5 text-base">Start building free</Button>
							</div>
							<Button href="#code" size="lg" variant="ghost" class="rounded-xl px-5"
								>Read the docs</Button
							>
						</div>
						<p class="mt-4 font-mono text-xs text-muted-foreground/70">
							npx create-cloudflarebase-app@latest · no credit card required
						</p>
					</div>
				</div>

				<!-- Signature visual -->
				<div class="relative mt-8 -mr-56 overflow-hidden px-2 sm:mt-12 sm:mr-0 md:mt-20">
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
								<span class="flex items-center gap-2.5">
									<span class="flex gap-1.5">
										<span class="h-2 w-2 rounded-full bg-border"></span>
										<span class="h-2 w-2 rounded-full bg-border"></span>
										<span class="h-2 w-2 rounded-full bg-border"></span>
									</span>
									request-simulator.cloudflarebase.dev
								</span>
								<span>Toronto → nearest endpoint</span>
							</div>
							<div class="grid grid-cols-1 md:grid-cols-2">
								<div class="border-b border-border p-6 md:border-r md:border-b-0">
									<div
										class="font-mono text-[11px] tracking-wide text-muted-foreground/70 uppercase"
									>
										Traditional backend
									</div>
									<div class="mt-1 mb-4 text-sm font-semibold text-muted-foreground">
										Single region (us-east-1)
									</div>
									<svg viewBox="0 0 {mapW} {mapH}" class="h-[190px] w-full">
										{#each dots as d}
											<circle cx={d.x} cy={d.y} r="1.1" class="fill-muted-foreground/20" />
										{/each}
										<line
											x1={user.x}
											y1={user.y}
											x2={originTarget.x}
											y2={originTarget.y}
											class="stroke-muted-foreground"
											stroke-width="1.2"
											stroke-dasharray="3 3"
											opacity="0.5"
										/>
										<circle cx={user.x} cy={user.y} r="4" class="fill-foreground" />
										<circle
											cx={originTarget.x}
											cy={originTarget.y}
											r="5"
											class="fill-muted-foreground"
										/>
										<circle r="3" class="fill-muted-foreground">
											<animateMotion
												dur="2.6s"
												repeatCount="indefinite"
												path="M{user.x},{user.y} L{originTarget.x},{originTarget.y}"
											/>
										</circle>
									</svg>
									<div class="mt-3 flex items-baseline gap-2 font-mono">
										<span class="text-3xl font-semibold text-muted-foreground"
											>{originMs || '—'}</span
										>
										<span class="text-xs text-muted-foreground/70">ms round trip</span>
									</div>
								</div>
								<div class="p-6">
									<div
										class="font-mono text-[11px] tracking-wide text-muted-foreground/70 uppercase"
									>
										Cloudflarebase on Cloudflare
									</div>
									<div class="mt-1 mb-4 text-sm font-semibold text-accent-foreground">
										Nearest of 300+ edge nodes
									</div>
									<svg viewBox="0 0 {mapW} {mapH}" class="h-[190px] w-full">
										{#each dots as d}
											<circle cx={d.x} cy={d.y} r="1.1" class="fill-muted-foreground/20" />
										{/each}
										<line
											x1={user.x}
											y1={user.y}
											x2={edgeTarget.x}
											y2={edgeTarget.y}
											class="stroke-primary"
											stroke-width="1.2"
											stroke-dasharray="3 3"
											opacity="0.5"
										/>
										<circle cx={user.x} cy={user.y} r="4" class="fill-foreground" />
										<circle cx={edgeTarget.x} cy={edgeTarget.y} r="5" class="fill-primary" />
										<circle r="3" class="fill-primary">
											<animateMotion
												dur="0.5s"
												repeatCount="indefinite"
												path="M{user.x},{user.y} L{edgeTarget.x},{edgeTarget.y}"
											/>
										</circle>
									</svg>
									<div class="mt-3 flex items-baseline gap-2 font-mono">
										<span class="text-3xl font-semibold text-primary">{edgeMs || '—'}</span>
										<span class="text-xs text-muted-foreground/70">ms round trip</span>
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
			<div class="group relative m-auto max-w-5xl px-6">
				<p class="text-center text-sm text-muted-foreground">
					Built directly on Cloudflare's primitives
				</p>
				<div class="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-3">
					{#each runtime as name}
						<span
							class="rounded-full border border-border px-4 py-1.5 font-mono text-xs text-muted-foreground"
							>{name}</span
						>
					{/each}
				</div>
			</div>
		</section>
	</main>

	<!-- BENEFITS -->
	<section class="border-y border-border bg-card px-8 py-24">
		<div class="mx-auto max-w-6xl">
			<div class="mb-14 max-w-xl">
				<span
					class="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
					>Why Cloudflarebase</span
				>
				<h2 class="mt-4 text-3xl font-bold md:text-4xl">
					The parts of Firebase that scale badly, rebuilt on the edge.
				</h2>
			</div>
			<div class="grid grid-cols-1 gap-8 md:grid-cols-2">
				{#each benefits as b, i}
					<div class="flex gap-5">
						<div
							class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-background text-primary"
						>
							<b.icon class="h-5 w-5" strokeWidth={1.8} />
						</div>
						<div>
							<h3 class="font-semibold">{b.title}</h3>
							<p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">{b.desc}</p>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- PRIMITIVES -->
	<section id="primitives" class="px-8 py-24">
		<div class="mx-auto max-w-6xl">
			<div class="mb-14 max-w-xl">
				<span
					class="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
					>Primitives</span
				>
				<h2 class="mt-4 text-3xl font-bold md:text-4xl">Six building blocks. One network.</h2>
				<p class="mt-3 text-muted-foreground">
					Each primitive is a thin, familiar API in front of Cloudflare's own storage and compute
					layer — no infrastructure to provision, no region to pick.
				</p>
			</div>
			<div
				class="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3"
			>
				{#each primitives as p}
					<div class="bg-card p-7 transition-colors hover:bg-accent/40">
						<div
							class="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
						>
							<p.icon class="h-[18px] w-[18px]" strokeWidth={1.8} />
						</div>
						<h3 class="mb-1.5 font-semibold">{p.name}</h3>
						<p class="text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
						<span
							class="mt-3 inline-block rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground/70"
							>{p.tag}</span
						>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- HOW IT WORKS -->
	<section id="how-it-works" class="border-y border-border bg-card px-8 py-24">
		<div class="mx-auto max-w-6xl">
			<div class="mb-14 max-w-xl">
				<span
					class="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
					>How it works</span
				>
				<h2 class="mt-4 text-3xl font-bold md:text-4xl">From zero to deployed in three steps.</h2>
			</div>
			<div class="grid grid-cols-1 gap-8 md:grid-cols-3">
				{#each steps as s, i}
					<div class="relative rounded-2xl border border-border bg-background p-7">
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

	<!-- CODE SHOWCASE -->
	<section id="code" class="px-8 py-24">
		<div class="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 md:grid-cols-2">
			<div>
				<span
					class="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
					>Developer experience</span
				>
				<h2 class="mt-4 text-3xl leading-tight font-bold md:text-4xl">
					An API that feels like Firebase. Infrastructure that doesn't.
				</h2>
				<p class="mt-4 text-muted-foreground">
					If you've shipped with Firestore, you already know the shape of this SDK. Swap the import,
					keep the mental model, lose the single point of failure.
				</p>
				<ul class="mt-6 space-y-3 text-sm">
					<li class="flex gap-2.5">
						<Check class="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
						Type-safe client generated from your schema
					</li>
					<li class="flex gap-2.5">
						<Check class="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
						Realtime subscriptions with the same <code class="font-mono">.onSnapshot()</code> pattern
					</li>
					<li class="flex gap-2.5">
						<Check class="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
						Auth runs as a Cloudflare Agent on Better Auth, session state synced via Durable Objects
					</li>
					<li class="flex gap-2.5">
						<Check class="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
						Deploys with <code class="font-mono">git push</code> — no console clicking
					</li>
				</ul>
			</div>
			<div class="overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
				<div class="flex items-center gap-1.5 border-b border-border px-4 py-3">
					<span class="h-2.5 w-2.5 rounded-full bg-border"></span>
					<span class="h-2.5 w-2.5 rounded-full bg-border"></span>
					<span class="h-2.5 w-2.5 rounded-full bg-border"></span>
				</div>
				<pre class="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed"><code
						>import {'{'} cloudflarebase } from <span class="text-primary"
							>'@cloudflarebase/sdk'</span
						>

<span class="text-muted-foreground">// database — same shape you already know</span>
const db = cloudflarebase.db.collection(<span class="text-primary">'todos'</span>)
await db.insert({'{'} title: <span class="text-primary">'Migrate off Firebase'</span
						>, done: false })

<span class="text-muted-foreground"
							>// auth — Cloudflare Agent + Better Auth, synced via Durable Objects</span
						>
const session = await cloudflarebase.auth.getSession(request)

<span class="text-muted-foreground">// runs on the nearest edge node, not a single AWS region</span>
db.onSnapshot(todos =&gt; render(todos))</code
					></pre>
			</div>
		</div>
	</section>

	<!-- MIGRATION -->
	<section id="migrate" class="border-y border-border bg-card px-8 py-24">
		<div class="mx-auto max-w-6xl">
			<div class="mb-14 max-w-xl">
				<span
					class="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
					>Migration</span
				>
				<h2 class="mt-4 text-3xl font-bold md:text-4xl">
					Leaving Firebase takes an afternoon, not a rewrite.
				</h2>
				<p class="mt-3 text-muted-foreground">
					Cloudflarebase mirrors the primitives you already reach for. Most teams port their data
					model with a script we generate for you.
				</p>
			</div>
			<div class="overflow-hidden rounded-xl border border-border">
				<div
					class="grid grid-cols-3 border-b border-border bg-accent/40 font-mono text-[11px] tracking-wide text-muted-foreground uppercase"
				>
					<div class="px-6 py-4">Capability</div>
					<div class="px-6 py-4">Firebase</div>
					<div class="px-6 py-4">Cloudflarebase</div>
				</div>
				{#each migration as row}
					<div class="grid grid-cols-3 border-b border-border text-sm last:border-b-0">
						<div class="px-6 py-4 font-medium">{row.cap}</div>
						<div class="px-6 py-4 text-muted-foreground">{row.firebase}</div>
						<div class="px-6 py-4 text-primary">{row.cfbase}</div>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- PRICING -->
	<section id="pricing" class="px-8 py-24">
		<div class="mx-auto max-w-6xl">
			<div class="mx-auto mb-14 max-w-xl text-center">
				<span
					class="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
					>Pricing</span
				>
				<h2 class="mt-4 text-3xl font-bold md:text-4xl">Start free. Pay for what you outgrow.</h2>
				<p class="mt-3 text-muted-foreground">
					No surprise egress bills — that's the one line item that doesn't scale against you.
				</p>
			</div>
			<div class="grid grid-cols-1 gap-5 md:grid-cols-3">
				{#each plans as plan}
					<div
						class="relative rounded-2xl border p-7 {plan.featured
							? 'border-primary bg-gradient-to-b from-primary/[0.06] to-card'
							: 'border-border bg-card'}"
					>
						{#if plan.featured}
							<span
								class="absolute -top-3 right-6 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground"
								>Most teams</span
							>
						{/if}
						<h3 class="font-semibold">{plan.name}</h3>
						<p class="mt-1.5 min-h-[36px] text-sm text-muted-foreground">{plan.desc}</p>
						<div class="mt-3 text-4xl font-bold">
							{plan.price}{#if plan.price !== 'Custom'}<span
									class="ml-1 text-sm font-normal text-muted-foreground/70">/month</span
								>{/if}
						</div>
						<ul class="my-6 space-y-2.5">
							{#each plan.features as f}
								<li class="flex gap-2 text-sm text-muted-foreground">
									<Check class="mt-0.5 h-[15px] w-[15px] flex-shrink-0 text-primary" />
									{f}
								</li>
							{/each}
						</ul>
						<Button class="w-full" variant={plan.featured ? 'default' : 'outline'}>
							{plan.cta}
						</Button>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- FAQ -->
	<section id="faq" class="border-t border-border bg-card px-8 py-24">
		<div class="mx-auto max-w-3xl">
			<div class="mb-12 text-center">
				<span
					class="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
					>FAQ</span
				>
				<h2 class="mt-4 text-3xl font-bold md:text-4xl">Questions, answered plainly.</h2>
			</div>
			<div class="divide-y divide-border rounded-xl border border-border bg-background">
				{#each faqs as item, i}
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
	<section class="px-8 py-28 text-center">
		<span
			class="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium tracking-wide text-primary uppercase"
		>
			<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"></span>
			Deploys in minutes
		</span>
		<h2 class="mx-auto mt-5 max-w-2xl text-4xl font-bold md:text-5xl">
			Your next backend doesn't need a region.
		</h2>
		<p class="mt-4 text-muted-foreground">
			Free tier, no credit card. Bring your schema or start from a template.
		</p>
		<div class="mt-8 flex flex-wrap justify-center gap-3">
			<Button size="lg">Start building free</Button>
			<Button size="lg" variant="outline">Book a demo</Button>
		</div>
	</section>

	<!-- FOOTER -->
	<footer class="border-t border-border px-8 pt-12 pb-8">
		<div class="mx-auto max-w-6xl">
			<div class="mb-11 flex flex-wrap justify-between gap-10">
				<div>
					<div class="flex items-center gap-2 text-lg font-bold">
						<svg viewBox="0 0 24 24" fill="none" class="h-5 w-5 text-primary">
							<path
								d="M12 2L3 7V17L12 22L21 17V7L12 2Z"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linejoin="round"
							/>
						</svg>
						Cloudflarebase
					</div>
					<p class="mt-2.5 max-w-[240px] text-sm text-muted-foreground/70">
						Backend infrastructure for Cloudflare's edge. Built for teams who don't want to think
						about regions.
					</p>
				</div>
				<div class="flex flex-wrap gap-16">
					<div>
						<h4 class="mb-3.5 font-mono text-xs tracking-wide text-muted-foreground/70 uppercase">
							Product
						</h4>
						<a
							href="#primitives"
							class="mb-2.5 block text-sm text-muted-foreground hover:text-foreground">Primitives</a
						>
						<a
							href="#pricing"
							class="mb-2.5 block text-sm text-muted-foreground hover:text-foreground">Pricing</a
						>
						<a href="#code" class="mb-2.5 block text-sm text-muted-foreground hover:text-foreground"
							>Docs</a
						>
					</div>
					<div>
						<h4 class="mb-3.5 font-mono text-xs tracking-wide text-muted-foreground/70 uppercase">
							Resources
						</h4>
						<a
							href="#migrate"
							class="mb-2.5 block text-sm text-muted-foreground hover:text-foreground"
							>Migrate from Firebase</a
						>
						<a href="#faq" class="mb-2.5 block text-sm text-muted-foreground hover:text-foreground"
							>FAQ</a
						>
						<a
							href="#"
							class="mb-2.5 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
						>
							GitHub
						</a>
					</div>
				</div>
			</div>
			<div
				class="flex items-center justify-between border-t border-border pt-6 text-xs text-muted-foreground/70"
			>
				<span>© 2026 Cloudflarebase, Inc.</span>
				<span>Built on Cloudflare</span>
			</div>
		</div>
	</footer>
</div>

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
						<a href="/" aria-label="home" class="flex items-center gap-2 text-lg font-bold">
							<svg viewBox="0 0 24 24" fill="none" class="h-[22px] w-[22px] text-primary">
								<path
									d="M12 2L3 7V17L12 22L21 17V7L12 2Z"
									stroke="currentColor"
									stroke-width="1.6"
									stroke-linejoin="round"
								/>
							</svg>
							Cloudflarebase
						</a>

						<button
							onclick={() => (menuState = !menuState)}
							aria-label={menuState == true ? 'Close Menu' : 'Open Menu'}
							class="relative z-20 -m-2.5 -mr-4 block cursor-pointer p-2.5 lg:hidden"
						>
							<Menu
								class={['m-auto size-6 duration-200', menuState && 'scale-0 rotate-180 opacity-0']}
							/>
							<X
								class={[
									'absolute inset-0 m-auto size-6 scale-0 -rotate-180 opacity-0 duration-200',
									menuState && 'scale-100 rotate-0 opacity-100'
								]}
							/>
						</button>
					</div>

					<div class="absolute inset-0 m-auto hidden size-fit lg:block">
						<ul class="flex gap-8 text-sm">
							{#each menuItems as item}
								<li>
									<a
										href={item.href}
										class="block text-muted-foreground duration-150 hover:text-accent-foreground"
									>
										<span>{item.name}</span>
									</a>
								</li>
							{/each}
						</ul>
					</div>

					<div
						class={[
							'mb-6 w-full flex-wrap items-center justify-end space-y-8 rounded-3xl border bg-background p-6 shadow-2xl shadow-zinc-300/20 md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none dark:shadow-none dark:lg:bg-transparent',
							menuState ? 'block lg:flex' : 'hidden lg:flex'
						]}
					>
						<div class="lg:hidden">
							<ul class="space-y-6 text-base">
								{#each menuItems as item}
									<li>
										<a
											href={item.href}
											class="block text-muted-foreground duration-150 hover:text-accent-foreground"
										>
											<span>{item.name}</span>
										</a>
									</li>
								{/each}
							</ul>
						</div>
						<div class="flex w-full flex-col space-y-3 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit">
							<Button variant="outline" size="sm" class={cn(isScrolled && 'lg:hidden')}
								>Sign in</Button
							>
							<Button size="sm" class={cn(isScrolled && 'lg:hidden')}>Start building</Button>
							<Button size="sm" class={cn(isScrolled ? 'lg:inline-flex' : 'hidden')}
								>Start building</Button
							>
						</div>
					</div>
				</div>
			</div>
		</nav>
	</header>
{/snippet}
