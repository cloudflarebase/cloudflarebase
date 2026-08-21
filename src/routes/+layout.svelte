<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import { beforeNavigate, onNavigate } from '$app/navigation';
	import { page, updated } from '$app/state';
	import { isPrivateSurface } from '$lib/console';

	let { children } = $props();

	const SITE_URL = 'https://cloudflarebase.com';

	/**
	 * The console describes itself as the PRODUCT, never as the page you happen
	 * to be on.
	 *
	 * `noindex` covers search engines. It does nothing about link previews:
	 * WhatsApp, iMessage, Slack and every other unfurler ignore robots
	 * directives, and with no `og:title` here they fell back to the document
	 * title - so sharing `cloudflarebase.com/dashboard` previewed as
	 * "demo-19a63aad9478 · Project Overview", naming a throwaway project that
	 * the demo TTL erases days later. `<title>` stays project-specific, because
	 * that is the browser tab and it is genuinely useful; what a stranger's chat
	 * client renders is a different question with a different answer.
	 *
	 * Marketing pages set their own og:title/og:description, so these are only
	 * emitted where nothing else would - two of each would be worse than none.
	 */
	const isPrivate = $derived(isPrivateSurface(page.url.pathname));

	// A canonical URL on a noindex page is a contradiction, and pointing one at
	// the root would ask search engines to consolidate a page we just told them
	// to drop. Omit it entirely instead.
	const canonicalUrl = $derived(isPrivate ? null : `${SITE_URL}${page.url.pathname}`);

	// og:url is not canonical - it is what a share card links to - so the
	// console points at the product page rather than at a project id.
	const shareUrl = $derived(isPrivate ? `${SITE_URL}/` : `${SITE_URL}${page.url.pathname}`);

	// Inside the dashboard the shell (sidebar, header, agent pane) persists and
	// the content pane plays its own keyed entry transition - a ROOT view
	// transition there would translate/scale/blur the whole shell on every
	// tool-page hop, which reads as a layout shift. So the full-page cinematic
	// only plays when the navigation actually changes context (marketing,
	// login, entering or leaving the dashboard).
	const inDashboard = (routeId: string | null | undefined): boolean =>
		routeId?.startsWith('/(app)/dashboard') ?? false;

	// A deploy replaces this Worker's whole asset manifest, so the hashed chunks
	// an open tab still points at stop existing (docs in $lib/stale-build). Once
	// the version poll notices a newer build, hand the next navigation to the
	// browser instead of routing it client-side: a full page load fetches the
	// new module graph, where a client navigation would import a 404.
	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) {
			location.href = to.url.href;
		}
	});

	onNavigate((navigation) => {
		if (
			!document.startViewTransition ||
			document.visibilityState === 'hidden' ||
			window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
			(inDashboard(navigation.from?.route.id) && inDashboard(navigation.to?.route.id))
		) {
			return;
		}

		return new Promise<void>((resolve) => {
			const transition = document.startViewTransition(async () => {
				resolve();
				// An aborted navigation rejects `complete`; the DOM has already
				// been handed over either way, so losing the animation is fine.
				await navigation.complete.catch(() => {});
			});
			// The browser skips the transition if the tab goes hidden mid-flight
			// (or another transition starts) and rejects `ready` - that skip is
			// expected, not an error worth an unhandled-rejection report.
			transition.ready.catch(() => {});
		});
	});
</script>

<svelte:head>
	{#if canonicalUrl}
		<link rel="canonical" href={canonicalUrl} />
	{/if}
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
	<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/site.webmanifest" />
	<meta name="theme-color" media="(prefers-color-scheme: light)" content="#faf7f1" />
	<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0705" />
	<meta property="og:site_name" content="Cloudflarebase" />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={shareUrl} />
	{#if isPrivate}
		<meta property="og:title" content="Cloudflarebase - The open-source Firebase for Cloudflare" />
		<meta
			property="og:description"
			content="Auth, database, storage, and hosting on your own Cloudflare account. Every project gets its own Durable Objects."
		/>
		<meta
			name="twitter:description"
			content="Auth, database, storage, and hosting on your own Cloudflare account. Every project gets its own Durable Objects."
		/>
	{/if}
	<meta property="og:image" content="https://cloudflarebase.com/brand/github-header.png" />
	<meta
		property="og:image:alt"
		content="Cloudflarebase - the open-source backend built for Cloudflare"
	/>
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:image" content="https://cloudflarebase.com/brand/github-header.png" />
</svelte:head>
<ModeWatcher />
<div class="app-viewport">{@render children()}</div>
