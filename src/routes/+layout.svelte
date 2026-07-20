<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { onNavigate } from '$app/navigation';

	let { children } = $props();

	onNavigate((navigation) => {
		if (
			!document.startViewTransition ||
			window.matchMedia('(prefers-reduced-motion: reduce)').matches
		) {
			return;
		}

		return new Promise<void>((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<ModeWatcher defaultMode="dark" />
<div class="app-viewport">{@render children()}</div>
