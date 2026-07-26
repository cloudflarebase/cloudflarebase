<script lang="ts">
	import { resolve } from '$app/paths';
	import GithubLogo from '$lib/components/github-logo.svelte';
	import ModeToggle from '$lib/components/mode-toggle.svelte';
	import { ShieldCheck } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	/**
	 * Shell for the pre-project console surfaces — sign-in, first-run claim, and
	 * the project list. The brand panel is the only place a self-hosted install
	 * says what it is, so it carries the positioning rather than decoration.
	 *
	 * It collapses below `lg`, where the content column takes the full width.
	 */
	let {
		children,
		wide = false
	}: {
		children: Snippet;
		/** Widen the content column for lists; forms stay narrow. */
		wide?: boolean;
	} = $props();
</script>

<div class="grid min-h-svh lg:grid-cols-2">
	<aside
		class="relative hidden flex-col justify-between overflow-hidden border-r bg-muted/40 p-10 lg:flex"
	>
		<!-- Warm wash behind the panel, keyed off the mark's orange. -->
		<div
			aria-hidden="true"
			class="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-primary/10 blur-3xl"
		></div>

		<div class="relative flex items-center gap-2.5">
			<img src="/brand/mark.svg" alt="" class="h-7 w-7" />
			<span class="text-lg font-semibold tracking-tight">Cloudflarebase</span>
		</div>

		<div class="relative max-w-md space-y-6">
			<h2 class="text-3xl leading-tight font-semibold tracking-tight text-balance">
				The open-source backend built on Cloudflare.
			</h2>
			<p class="text-sm leading-relaxed text-muted-foreground">
				Every project gets its own agent — a Durable Object running Better Auth over its own SQLite
				database, at the edge, in your account.
			</p>

			<div class="flex items-start gap-3 rounded-lg border bg-background/60 p-4">
				<ShieldCheck class="mt-0.5 h-5 w-5 shrink-0 text-primary" />
				<p class="text-sm text-muted-foreground">
					This console runs on its own auth agent — the same stack your projects use.
				</p>
			</div>
		</div>

		<div class="relative flex items-center gap-4 text-sm text-muted-foreground">
			<a
				href="https://github.com/cloudflarebase/cloudflarebase"
				class="flex items-center gap-1.5 transition-colors hover:text-foreground"
				rel="noreferrer noopener"
				target="_blank"
			>
				<GithubLogo class="h-4 w-4" /> GitHub
			</a>
			<span aria-hidden="true">·</span>
			<a href={resolve('/')} class="transition-colors hover:text-foreground">Docs</a>
		</div>
	</aside>

	<main class="relative flex flex-col items-center justify-center px-4 py-10">
		<ModeToggle class="absolute top-4 right-4" variant="ghost" />

		<!-- The mark repeats here only where the brand panel is hidden. -->
		<div class="mb-8 flex items-center gap-2.5 lg:hidden">
			<img src="/brand/mark.svg" alt="" class="h-6 w-6" />
			<span class="font-semibold tracking-tight">Cloudflarebase</span>
		</div>

		<div class="w-full {wide ? 'max-w-xl' : 'max-w-sm'}">
			{@render children()}
		</div>
	</main>
</div>
