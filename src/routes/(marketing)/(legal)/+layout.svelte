<script lang="ts">
	import { resolve } from '$app/paths';
	import ModeToggle from '$lib/components/mode-toggle.svelte';

	let { children } = $props();
</script>

<div class="flex min-h-screen flex-col">
	<header class="border-b border-border px-4 sm:px-8">
		<div class="mx-auto flex max-w-3xl items-center justify-between py-4">
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
		<article class="mx-auto prose max-w-3xl prose-headings:tracking-tight">
			{@render children()}
		</article>
	</main>

	<footer class="border-t border-border px-4 py-6 sm:px-8">
		<div
			class="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground/70"
		>
			<span>&copy; 2026 Frostbase</span>
			<nav class="flex gap-4">
				<a href={resolve('/privacy')} class="hover:text-foreground">Privacy</a>
				<a href={resolve('/terms')} class="hover:text-foreground">Terms</a>
			</nav>
		</div>
	</footer>
</div>

<style>
	/* Map the typography plugin onto the site's shadcn tokens so prose follows
	   the warm palette and flips with dark mode instead of prose-invert grays. */
	article {
		--tw-prose-body: var(--muted-foreground);
		--tw-prose-headings: var(--foreground);
		--tw-prose-lead: var(--muted-foreground);
		--tw-prose-links: var(--foreground);
		--tw-prose-bold: var(--foreground);
		--tw-prose-counters: var(--muted-foreground);
		--tw-prose-bullets: var(--border);
		--tw-prose-hr: var(--border);
		--tw-prose-quotes: var(--foreground);
		--tw-prose-quote-borders: var(--border);
		--tw-prose-code: var(--foreground);
	}
</style>
