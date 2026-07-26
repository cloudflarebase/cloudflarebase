<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { mode } from 'mode-watcher';
	import { onMount } from 'svelte';

	/**
	 * Live API reference for this project, rendered by Scalar from the OpenAPI
	 * document at /api/projects/<id>/openapi.json — which is generated from the
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
				mcp: undefined,
				agent: {
					disabled: true
				}
			});
		})();

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
	<title>API reference · {projectId} · Cloudflarebase</title>
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
