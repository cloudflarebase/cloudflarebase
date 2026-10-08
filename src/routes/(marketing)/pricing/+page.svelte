<script lang="ts">
	import { resolve } from '$app/paths';
	import ModeToggle from '$lib/components/mode-toggle.svelte';
	import PricingCalculator from '$lib/components/pricing-calculator.svelte';
</script>

<svelte:head>
	<title>Pricing · Frostbase</title>
	<meta
		name="description"
		content="Frostbase is free and open source. Estimate what your workload costs on your own Cloudflare account - next to the same app on Firebase and Supabase."
	/>
</svelte:head>

<div class="flex min-h-screen flex-col" data-testid="pricing-page">
	<header class="border-b border-border px-4 sm:px-8">
		<div class="mx-auto flex max-w-6xl items-center justify-between py-4">
			<a href={resolve('/')} aria-label="home" class="flex items-center gap-2 text-lg font-bold">
				<img src="/brand/mark.svg" alt="" class="h-5 w-5" />
				Frostbase
			</a>
			<div class="flex items-center gap-3">
				<a href={resolve('/')} class="text-sm text-muted-foreground hover:text-foreground">
					&larr; Home
				</a>
				<ModeToggle variant="ghost" class="h-9 w-9" />
			</div>
		</div>
	</header>

	<main class="flex-1 px-4 py-12 sm:px-8 sm:py-16">
		<div class="mx-auto max-w-6xl space-y-8">
			<div class="max-w-3xl">
				<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">
					Our price: <span class="text-primary">$0</span>
				</h1>
				<p class="mt-3 text-muted-foreground">
					Frostbase is open source and runs on your own Cloudflare account - there is no middleman
					bill, and Durable Objects sit on the
					<a
						class="underline underline-offset-2 hover:text-foreground"
						href="https://developers.cloudflare.com/durable-objects/platform/pricing/"
						>Workers free tier</a
					>, so small projects run at $0. This estimates what a workload costs on your account, next
					to the same app on Firebase and Supabase.
				</p>
			</div>

			<PricingCalculator />
		</div>
	</main>

	<footer class="border-t border-border px-4 py-6 sm:px-8">
		<div
			class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground/70"
		>
			<span>&copy; 2026 Frostbase</span>
			<nav class="flex gap-4">
				<a href={resolve('/privacy')} class="hover:text-foreground">Privacy</a>
				<a href={resolve('/terms')} class="hover:text-foreground">Terms</a>
			</nav>
		</div>
	</footer>
</div>
