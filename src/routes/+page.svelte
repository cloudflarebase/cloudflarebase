<script lang="ts">
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';

	const features = [
		{
			title: 'Cloudflare-native backend',
			description: 'Build on Workers, D1, R2, Queues, and Durable Objects from day one.'
		},
		{
			title: 'Firebase-style DX',
			description: 'Auth, database, storage, and functions with a simple developer experience.'
		},
		{
			title: 'Fast at the edge',
			description: 'Ship globally distributed apps without managing servers or regions.'
		}
	];

	const stats = [
		['0ms', 'cold start goal'],
		['300+', 'edge cities'],
		['1 CLI', 'to deploy']
	];
</script>

<svelte:head>
	<title>Cloudflarebase — Firebase alternative on Cloudflare</title>
	<meta
		name="description"
		content="Cloudflarebase is a Firebase alternative built on Cloudflare."
	/>
</svelte:head>

<main class="relative min-h-screen overflow-hidden bg-background text-foreground">
	<div class="pointer-events-none absolute inset-0 -z-20 bg-background"></div>
	<div class="grid-bg pointer-events-none absolute inset-0 -z-10"></div>

	<div
		class="pointer-events-none absolute top-[-18rem] left-1/2 -z-10 size-[42rem] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl"
	></div>
	<div
		class="pointer-events-none absolute top-32 right-[-16rem] -z-10 size-[32rem] rounded-full bg-orange-500/15 blur-3xl"
	></div>
	<div
		class="pointer-events-none absolute bottom-[-18rem] left-[-12rem] -z-10 size-[34rem] rounded-full bg-sky-500/15 blur-3xl"
	></div>

	<nav class="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
		<a href="/" class="group flex items-center gap-3 font-semibold tracking-tight">
			<span
				class="relative flex size-9 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25"
			>
				C
				<span
					class="absolute inset-0 rounded-2xl bg-primary opacity-40 blur-md transition group-hover:opacity-70"
				></span>
			</span>
			Cloudflarebase
		</a>

		<div
			class="hidden items-center gap-6 rounded-full border bg-background/60 px-5 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur-xl md:flex"
		>
			<a href="#features" class="transition hover:text-foreground">Features</a>
			<a href="#pricing" class="transition hover:text-foreground">Pricing</a>
			<a href="#docs" class="transition hover:text-foreground">Docs</a>
		</div>

		<a
			href="#waitlist"
			class={cn(buttonVariants({ size: 'sm' }), 'rounded-full shadow-lg shadow-primary/20')}
		>
			Join waitlist
		</a>
	</nav>

	<section
		class="mx-auto grid max-w-6xl items-center gap-14 px-6 py-20 md:grid-cols-[1.05fr_0.95fr] md:py-28"
	>
		<div>
			<Badge
				variant="outline"
				class="mb-5 rounded-full border-primary/30 bg-background/70 px-4 py-1.5 backdrop-blur-xl"
			>
				<span
					class="mr-2 inline-flex size-2 rounded-full bg-primary shadow-[0_0_18px_hsl(var(--primary))]"
				></span>
				Firebase alternative built on Cloudflare
			</Badge>

			<h1
				class="max-w-3xl text-5xl font-semibold tracking-tight text-balance sm:text-6xl md:text-7xl"
			>
				Build full-stack apps on the
				<span class="gradient-text"> edge.</span>
			</h1>

			<p class="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
				Cloudflarebase gives you auth, data, storage, and serverless functions with the simplicity
				of Firebase and the speed of Cloudflare.
			</p>

			<div class="mt-8 flex flex-col gap-3 sm:flex-row">
				<a
					href="#waitlist"
					class={cn(
						buttonVariants({ size: 'lg' }),
						'rounded-full px-7 shadow-2xl shadow-primary/25 transition hover:scale-[1.02]'
					)}
				>
					Start building
				</a>

				<a
					href="#features"
					class={cn(
						buttonVariants({ variant: 'outline', size: 'lg' }),
						'rounded-full border-border/70 bg-background/60 px-7 backdrop-blur-xl transition hover:scale-[1.02]'
					)}
				>
					Explore features
				</a>
			</div>

			<div class="mt-10 grid max-w-xl grid-cols-3 gap-4">
				{#each stats as stat}
					<div class="rounded-2xl border bg-background/60 p-4 shadow-sm backdrop-blur-xl">
						<p class="text-2xl font-semibold">{stat[0]}</p>
						<p class="mt-1 text-sm text-muted-foreground">{stat[1]}</p>
					</div>
				{/each}
			</div>
		</div>

		<div class="relative mx-auto w-full max-w-xl">
			<div class="absolute -inset-6 animate-pulse rounded-[2rem] bg-primary/15 blur-3xl"></div>

			<Card.Root
				class="relative overflow-hidden border-border/60 bg-background/75 shadow-2xl backdrop-blur-2xl"
			>
				<div
					class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent"
				></div>

				<Card.Header class="border-b border-border/60">
					<div class="flex items-start justify-between gap-4">
						<div>
							<Card.Title>Deploy an app backend</Card.Title>
							<Card.Description>
								Auth, database, storage, and functions in one Cloudflare-native stack.
							</Card.Description>
						</div>

						<Badge class="rounded-full bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
							Live
						</Badge>
					</div>
				</Card.Header>

				<Card.Content class="space-y-5 p-5">
					<div class="rounded-2xl border bg-muted/40 p-4 font-mono text-sm shadow-inner">
						<div class="text-muted-foreground">$ npx cloudflarebase init</div>
						<div class="mt-4 space-y-2">
							<div class="flex items-center justify-between rounded-xl bg-background/70 px-3 py-2">
								<span>✓ Auth configured</span>
								<span class="text-primary">ready</span>
							</div>
							<div class="flex items-center justify-between rounded-xl bg-background/70 px-3 py-2">
								<span>✓ D1 database created</span>
								<span class="text-primary">ready</span>
							</div>
							<div class="flex items-center justify-between rounded-xl bg-background/70 px-3 py-2">
								<span>✓ R2 bucket connected</span>
								<span class="text-primary">ready</span>
							</div>
							<div class="flex items-center justify-between rounded-xl bg-background/70 px-3 py-2">
								<span>✓ Worker deployed globally</span>
								<span class="text-primary">ready</span>
							</div>
						</div>
					</div>

					<div class="grid gap-3 sm:grid-cols-2">
						<div class="rounded-2xl border bg-background/70 p-4 shadow-sm">
							<p class="font-medium">Users</p>
							<p class="mt-1 text-sm text-muted-foreground">Email, OAuth, sessions, roles.</p>
						</div>

						<div class="rounded-2xl border bg-background/70 p-4 shadow-sm">
							<p class="font-medium">Data</p>
							<p class="mt-1 text-sm text-muted-foreground">SQL, KV, files, queues.</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>
		</div>
	</section>

	<section id="features" class="mx-auto max-w-6xl px-6 py-20">
		<div class="max-w-2xl">
			<Badge variant="secondary" class="mb-4 rounded-full">Everything you need</Badge>
			<h2 class="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
				Firebase simplicity. Cloudflare infrastructure.
			</h2>
			<p class="mt-4 text-muted-foreground">
				Stop wiring together ten services. Cloudflarebase gives your app a clean backend foundation
				that scales from prototype to production.
			</p>
		</div>

		<div class="mt-10 grid gap-5 md:grid-cols-3">
			{#each features as feature}
				<Card.Root
					class="group relative overflow-hidden border-border/70 bg-background/60 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:shadow-2xl"
				>
					<div
						class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent opacity-0 transition group-hover:opacity-100"
					></div>
					<div
						class="absolute -top-20 -right-20 size-40 rounded-full bg-primary/10 blur-3xl transition group-hover:bg-primary/20"
					></div>

					<Card.Header>
						<div
							class="mb-3 flex size-10 items-center justify-center rounded-xl border bg-muted/50 text-primary shadow-sm"
						>
							✦
						</div>
						<Card.Title>{feature.title}</Card.Title>
						<Card.Description class="leading-7">
							{feature.description}
						</Card.Description>
					</Card.Header>
				</Card.Root>
			{/each}
		</div>
	</section>

	<section id="pricing" class="mx-auto max-w-6xl px-6 pb-20">
		<Card.Root
			class="relative overflow-hidden border-primary/20 bg-primary text-primary-foreground shadow-2xl shadow-primary/25"
		>
			<div
				class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.35),transparent_35%)]"
			></div>

			<Card.Content class="relative grid gap-8 p-8 md:grid-cols-[1fr_auto] md:items-center">
				<div>
					<h2 class="text-3xl font-semibold tracking-tight">
						Launch your backend without leaving Cloudflare.
					</h2>
					<p class="mt-3 max-w-2xl text-primary-foreground/80">
						Join the early access list and help shape the Firebase alternative built for modern edge
						apps.
					</p>
				</div>

				<a
					id="waitlist"
					href="mailto:hello@cloudflarebase.com"
					class={cn(
						buttonVariants({ variant: 'secondary', size: 'lg' }),
						'rounded-full px-7 shadow-xl transition hover:scale-[1.02]'
					)}
				>
					Join early access
				</a>
			</Card.Content>
		</Card.Root>
	</section>
</main>

<style>
	.grid-bg {
		background-image:
			linear-gradient(to right, hsl(var(--border) / 0.45) 1px, transparent 1px),
			linear-gradient(to bottom, hsl(var(--border) / 0.45) 1px, transparent 1px);
		background-size: 72px 72px;
		mask-image: radial-gradient(circle at top, black, transparent 72%);
	}

	.gradient-text {
		background: linear-gradient(90deg, hsl(var(--primary)), rgb(249 115 22), rgb(56 189 248));
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.floating {
		animation: float 5s ease-in-out infinite;
	}

	.floating-delayed {
		animation: float 5s ease-in-out infinite;
		animation-delay: 1.3s;
	}

	@keyframes float {
		0%,
		100% {
			transform: translateY(0);
		}

		50% {
			transform: translateY(-12px);
		}
	}
</style>
