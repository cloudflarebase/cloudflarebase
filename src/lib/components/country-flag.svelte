<script lang="ts">
	let { code, class: className }: { code?: string | null; class?: string } = $props();

	// SVGs are vendored from the flag-icons package into static/flags/4x3.
	const normalized = $derived(
		code && /^[A-Za-z]{2}$/.test(code) && code.toUpperCase() !== 'XX' ? code.toLowerCase() : null
	);
	let failed = $state(false);
	$effect(() => {
		void normalized;
		failed = false;
	});
</script>

{#if normalized && !failed}
	<img
		src={`/flags/4x3/${normalized}.svg`}
		alt=""
		aria-hidden="true"
		loading="lazy"
		class={['inline-block h-3 w-4 rounded-[2px] object-cover', className]}
		onerror={() => (failed = true)}
	/>
{:else}
	<span class={['leading-none', className]} aria-hidden="true">🌐</span>
{/if}
