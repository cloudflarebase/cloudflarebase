<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { ArrowLeft, House, RefreshCw, Sparkles } from '@lucide/svelte';

	const status = $derived(page.status);
	const is404 = $derived(status === 404);
	const heading = $derived(is404 ? "This page doesn't exist" : 'Something went wrong');
	const detail = $derived(
		is404
			? 'The route may have moved, or the project id might be misspelled. Your backend is fine — this page just isn’t part of it.'
			: (page.error?.message ?? 'An unexpected error occurred while rendering this page.')
	);
</script>

<svelte:head>
	<title>{status} · Cloudflarebase</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div
	class="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-6 text-center text-foreground"
>
	<div
		class="pointer-events-none absolute top-1/2 left-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
		aria-hidden="true"
	></div>

	<a href={resolve('/')} class="mb-10 flex items-center gap-2 font-bold">
		<img src="/brand/mark.svg" alt="" class="h-6 w-6" />
		Cloudflarebase
	</a>

	<p
		class="font-mono text-[clamp(5rem,18vw,9rem)] leading-none font-semibold tracking-tight text-primary tabular-nums"
	>
		{status}
	</p>

	<h1 class="mt-4 text-2xl font-bold tracking-tight text-balance sm:text-3xl">{heading}</h1>
	<p class="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{detail}</p>

	<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
		{#if is404}
			<Button href={resolve('/')} class="gap-2"><House class="h-4 w-4" /> Back to home</Button>
			<Button href={resolve('/dashboard')} variant="outline" class="gap-2">
				<Sparkles class="h-4 w-4" /> Open the dashboard
			</Button>
		{:else}
			<Button onclick={() => location.reload()} class="gap-2">
				<RefreshCw class="h-4 w-4" /> Try again
			</Button>
			<Button href={resolve('/')} variant="outline" class="gap-2">
				<ArrowLeft class="h-4 w-4" /> Back to home
			</Button>
		{/if}
	</div>

	<p class="mt-12 font-mono text-[11px] tracking-wider text-muted-foreground/60 uppercase">
		Running on Cloudflare's network
	</p>
</div>
