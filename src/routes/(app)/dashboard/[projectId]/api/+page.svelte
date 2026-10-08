<script lang="ts">
	import { resolve } from '$app/paths';
	import { page, updated } from '$app/state';
	import { mode } from 'mode-watcher';
	import { onMount } from 'svelte';
	import { isStaleModuleError } from '$lib/stale-build';

	/**
	 * Live API reference for this project, rendered by Scalar from the OpenAPI
	 * document at /api/projects/<id>/openapi.json - which is generated from the
	 * same zod schemas the routes validate with, so it cannot drift.
	 *
	 * Because the document carries this project's real base URL, every example
	 * and every "try it" request is already addressed at the right endpoint
	 * rather than at a placeholder host.
	 *
	 * Scalar is imported dynamically: it is a large bundle and nothing else in
	 * the dashboard needs it.
	 */
	const projectId = $derived(page.params.projectId ?? '');
	const specUrl = $derived(resolve('/api/projects/[projectId]/openapi.json', { projectId }));

	/** Sidebar operations grouped by verb - all GETs, then POSTs, and so on -
	 * with path order breaking ties inside a verb. */
	const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'];
	function methodRank(method: string): number {
		const rank = METHOD_ORDER.indexOf(method.toLowerCase());
		return rank === -1 ? METHOD_ORDER.length : rank;
	}
	function operationsSorter(
		a: { method: string; path: string },
		b: { method: string; path: string }
	): number {
		return methodRank(a.method) - methodRank(b.method) || a.path.localeCompare(b.path);
	}

	let container = $state<HTMLDivElement | null>(null);
	let reference: { destroy?: () => void } | null = null;

	onMount(() => {
		let cancelled = false;

		(async () => {
			const { createApiReference } = await import('@scalar/api-reference');
			await import('@scalar/api-reference/style.css');
			if (cancelled || !container) return;

			reference = createApiReference(container, {
				url: specUrl,
				// The console owns the page chrome and the theme toggle.
				darkMode: mode.current === 'dark',
				hideDarkModeToggle: true,
				hideClientButton: true,
				showSidebar: true,
				// Authentication and Database both open on load (tag order comes
				// from the OpenAPI document) instead of only the first section.
				defaultOpenAllTags: true,
				operationsSorter,
				mcp: undefined,
				agent: {
					disabled: true
				}
			});
		})().catch(async (error: unknown) => {
			// This page IS a dynamic import, so a tab that outlived a deploy renders
			// nothing here at all (why: $lib/stale-build). A reference page holds no
			// unsaved state, which makes reloading a free recovery - gated, like
			// everywhere else, on a newer version actually being live, so a bundle
			// that is genuinely broken reports instead of reloading forever.
			if (!cancelled && isStaleModuleError(error) && (updated.current || (await updated.check()))) {
				location.reload();
				return;
			}
			throw error;
		});

		return () => {
			cancelled = true;
			reference?.destroy?.();
			reference = null;
		};
	});

	// Follow the console's theme rather than keeping a second one.
	$effect(() => {
		const dark = mode.current === 'dark';
		container?.classList.toggle('dark-mode', dark);
		container?.classList.toggle('light-mode', !dark);
	});
</script>

<svelte:head>
	<title>API reference · {projectId} · Frostbase</title>
</svelte:head>

<div class="h-full overflow-auto" data-testid="api-reference">
	<div bind:this={container}></div>

	<noscript>
		<p class="p-6 text-sm">
			The interactive reference needs JavaScript. The raw OpenAPI document is at
			<a href={specUrl} class="underline">{specUrl}</a>.
		</p>
	</noscript>
</div>
