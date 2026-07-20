<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Moon, Sun } from '@lucide/svelte';
	import { toggleMode } from 'mode-watcher';

	let {
		class: className,
		variant = 'outline',
		testId
	}: {
		class?: string;
		variant?: 'default' | 'outline' | 'ghost';
		testId?: string;
	} = $props();
</script>

<Button
	type="button"
	{variant}
	size="icon"
	class={['relative', className]}
	onclick={toggleMode}
	data-testid={testId}
>
	<Sun class="size-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
	<Moon
		class="absolute size-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0"
	/>
	<span class="sr-only">Toggle theme</span>
</Button>
