<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	type NativeSelectProps = Omit<WithElementRef<HTMLSelectAttributes, HTMLSelectElement>, 'size'> & {
		size?: 'sm' | 'default';
	};

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		size = 'default',
		children,
		...restProps
	}: NativeSelectProps = $props();
</script>

<div
	class={cn(
		'cn-native-select-wrapper group/native-select relative w-fit has-[select:disabled]:opacity-50',
		className
	)}
	data-slot="native-select-wrapper"
	data-size={size}
>
	<select
		bind:value
		bind:this={ref}
		data-slot="native-select"
		data-size={size}
		class="h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-transparent py-1 pr-8 pl-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none select-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=sm]:h-8 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
		{...restProps}
	>
		{@render children?.()}
	</select>
	<ChevronDownIcon
		class="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground select-none"
		aria-hidden
		data-slot="native-select-icon"
	/>
</div>
