<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import type { CodeExample } from '$lib/integration-examples';
	import { Check, Copy } from '@lucide/svelte';

	let { examples, class: className }: { examples: CodeExample[]; class?: string } = $props();

	// svelte-ignore state_referenced_locally
	let activeId = $state(examples[0]?.id ?? '');
	let copied = $state(false);
	let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
	const active = $derived(examples.find((example) => example.id === activeId) ?? examples[0]);

	// Highlighting is client-only and deferred: shiki stays out of the SSR pass
	// and the initial bundle, and nothing loads or runs until the block nears
	// the viewport and the main thread goes idle — the plain <pre> renders
	// until then, so hydration and first paint never wait on grammar work.
	let container = $state<HTMLElement | null>(null);
	let nearViewport = $state(false);
	let ready = $state(false);
	let highlighted = $state<string | null>(null);

	$effect(() => {
		if (!container || nearViewport) return;
		if (typeof IntersectionObserver === 'undefined') {
			nearViewport = true;
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) nearViewport = true;
			},
			{ rootMargin: '200px' }
		);
		observer.observe(container);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (!nearViewport || ready) return;
		if (typeof requestIdleCallback === 'function') {
			const id = requestIdleCallback(() => (ready = true), { timeout: 2000 });
			return () => cancelIdleCallback(id);
		}
		const id = setTimeout(() => (ready = true), 200);
		return () => clearTimeout(id);
	});

	// Deliberately a plain Map, not SvelteMap: this is a memo read inside the
	// effect below that also writes it. A reactive map would make each write
	// re-trigger that effect.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const highlightCache = new Map<string, string>();
	$effect(() => {
		if (!ready) return;
		const { id, code, lang } = active;
		highlighted = highlightCache.get(id) ?? null;
		if (highlighted) return;
		let cancelled = false;
		void import('$lib/shiki')
			.then(({ highlightCode }) => highlightCode(code, lang))
			.then((html) => {
				highlightCache.set(id, html);
				if (!cancelled) highlighted = html;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	async function copy() {
		try {
			await navigator.clipboard.writeText(active.code);
			copied = true;
			clearTimeout(copyResetTimer);
			copyResetTimer = setTimeout(() => (copied = false), 1500);
		} catch {
			// clipboard unavailable — the code stays selectable
		}
	}
</script>

<div class={className} bind:this={container}>
	<div class="flex flex-wrap gap-1.5" role="tablist" aria-label="Code examples">
		{#each examples as example (example.id)}
			<button
				type="button"
				role="tab"
				aria-selected={activeId === example.id}
				class={[
					'rounded-full border px-3 py-1 font-mono text-xs transition-colors',
					activeId === example.id
						? 'border-primary bg-primary/10 text-primary'
						: 'text-muted-foreground hover:border-primary/40 hover:text-foreground'
				]}
				onclick={() => (activeId = example.id)}>{example.label}</button
			>
		{/each}
	</div>
	<div class="relative mt-3">
		<Button
			variant="ghost"
			size="icon"
			class="absolute top-2 right-2 z-10 h-7 w-7 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
			aria-label="Copy example"
			data-testid="copy-integration"
			onclick={copy}
		>
			{#if copied}<Check class="h-3.5 w-3.5" />{:else}<Copy class="h-3.5 w-3.5" />{/if}
		</Button>
		{#if highlighted}
			<!-- bg-zinc-950! overrides the shiki theme's inline background so the
			     swap from the plain fallback doesn't flash a different color -->
			<div
				class="[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-zinc-950! [&_pre]:p-4 [&_pre]:text-xs [&_pre]:leading-relaxed"
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- shiki output over our own literals -->
				{@html highlighted}
			</div>
		{:else}
			<pre
				class="overflow-x-auto rounded-lg border bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-100"><code
					>{active.code}</code
				></pre>
		{/if}
	</div>
</div>
