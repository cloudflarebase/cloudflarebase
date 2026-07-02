<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Card from '$lib/components/ui/card/index.js';

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

<main class="min-h-screen bg-background text-foreground">
	<section class="relative overflow-hidden">
		<div
			class="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,theme(colors.primary/0.16),transparent_35%),linear-gradient(to_bottom,theme(colors.background),theme(colors.muted/0.35))]"
		/>

		<nav class="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
			<a href="/" class="flex items-center gap-2 font-semibold tracking-tight">
				<span
					class="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground"
				>
					C
				</span>
				Cloudflarebase
			</a>

			<div class="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
				<a href="#features" class="hover:text-foreground">Features</a>
				<a href="#pricing" class="hover:text-foreground">Pricing</a>
				<a href="#docs" class="hover:text-foreground">Docs</a>
			</div>

			<Button href="#waitlist" size="sm">Join waitlist</Button>
		</nav>

		<div
			class="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:grid-cols-[1.05fr_0.95fr] md:py-28"
		>
			<div>
				<Badge variant="outline" class="mb-5 rounded-full px-3 py-1">
					Firebase alternative built on Cloudflare
				</Badge>

				<h1 class="max-w-3xl text-5xl font-semibold tracking-tight sm:text-6xl md:text-7xl">
					Build full-stack apps on the edge.
				</h1>

				<p class="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
					Cloudflarebase gives you auth, data, storage, and serverless functions with the simplicity
					of Firebase and the speed of Cloudflare.
				</p>

				<div class="mt-8 flex flex-col gap-3 sm:flex-row">
					<Button href="#waitlist" size="lg" class="rounded-full">Start building</Button>
					<Button href="#features" variant="outline" size="lg" class="rounded-full">
						Explore features
					</Button>
				</div>

				<div class="mt-10 grid max-w-xl grid-cols-3 gap-4">
					{#each stats as stat}
						<div>
							<p class="text-2xl font-semibold">{stat[0]}</p>
							<p class="text-sm text-muted-foreground">{stat[1]}</p>
						</div>
					{/each}
				</div>
			</div>

			<Card.Root class="border-border/60 bg-card/80 shadow-2xl backdrop-blur">
				<Card.Header>
					<Card.Title>Deploy an app backend</Card.Title>
					<Card.Description>
						Auth, database, storage, and functions in one Cloudflare-native stack.
					</Card.Description>
				</Card.Header>

				<Card.Content>
					<div class="rounded-xl border bg-muted/40 p-4 font-mono text-sm">
						<div class="text-muted-foreground">$ npx cloudflarebase init</div>
						<div class="mt-3 text-primary">✓ Auth configured</div>
						<div class="text-primary">✓ D1 database created</div>
						<div class="text-primary">✓ R2 bucket connected</div>
						<div class="text-primary">✓ Worker deployed globally</div>
					</div>

					<div class="mt-5 grid gap-3 sm:grid-cols-2">
						<div class="rounded-xl border bg-background p-4">
							<p class="font-medium">Users</p>
							<p class="mt-1 text-sm text-muted-foreground">Email, OAuth, sessions, roles.</p>
						</div>

						<div class="rounded-xl border bg-background p-4">
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
			<Badge variant="secondary" class="mb-4">Everything you need</Badge>
			<h2 class="text-3xl font-semibold tracking-tight sm:text-4xl">
				Firebase simplicity. Cloudflare infrastructure.
			</h2>
			<p class="mt-4 text-muted-foreground">
				Stop wiring together ten services. Cloudflarebase gives your app a clean backend foundation
				that scales from prototype to production.
			</p>
		</div>

		<div class="mt-10 grid gap-5 md:grid-cols-3">
			{#each features as feature}
				<Card.Root class="bg-card/70">
					<Card.Header>
						<div
							class="mb-3 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"
						>
							✦
						</div>
						<Card.Title>{feature.title}</Card.Title>
						<Card.Description>{feature.description}</Card.Description>
					</Card.Header>
				</Card.Root>
			{/each}
		</div>
	</section>

	<section id="pricing" class="mx-auto max-w-6xl px-6 pb-20">
		<Card.Root class="overflow-hidden border-primary/20 bg-primary text-primary-foreground">
			<Card.Content class="grid gap-8 p-8 md:grid-cols-[1fr_auto] md:items-center">
				<div>
					<h2 class="text-3xl font-semibold tracking-tight">
						Launch your backend without leaving Cloudflare.
					</h2>
					<p class="mt-3 max-w-2xl text-primary-foreground/80">
						Join the early access list and help shape the Firebase alternative built for modern edge
						apps.
					</p>
				</div>

				<Button
					id="waitlist"
					href="mailto:hello@cloudflarebase.com"
					variant="secondary"
					size="lg"
					class="rounded-full"
				>
					Join early access
				</Button>
			</Card.Content>
		</Card.Root>
	</section>
</main>
