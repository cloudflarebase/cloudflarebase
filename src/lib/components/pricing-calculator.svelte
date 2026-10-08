<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Slider } from '$lib/components/ui/slider';
	import {
		estimateCloudflare,
		estimateFirebase,
		estimateSupabase,
		formatCount,
		formatUsd,
		scaleIndex,
		MODEL,
		PRESETS,
		PRICING_AS_OF,
		PRICING_SOURCES,
		SCALES
	} from '$lib/pricing';

	/**
	 * The versus split, shared by /pricing and the landing page: workload
	 * controls on top, then the same app priced three times - your Cloudflare
	 * bill beside Firebase's and Supabase's. The breakdown bar follows the
	 * dataviz method: 4 fixed-order brand hues (validated for CVD and contrast
	 * on both surfaces), 2px surface gaps between segments, values in text
	 * tokens on the itemized legend, never on the marks.
	 */

	// Defaults to the 1M-user preset: realtime fan-out at scale is where the
	// pricing models diverge hardest, and that difference IS the page.
	const DEFAULT_PRESET = PRESETS.find((preset) => preset.id === 'scale') ?? PRESETS[0];

	let readsIdx = $state(scaleIndex(SCALES.reads, DEFAULT_PRESET.inputs.reads));
	let writesIdx = $state(scaleIndex(SCALES.writes, DEFAULT_PRESET.inputs.writes));
	let storageIdx = $state(scaleIndex(SCALES.storageGb, DEFAULT_PRESET.inputs.storageGb));
	let connectionsIdx = $state(scaleIndex(SCALES.connections, DEFAULT_PRESET.inputs.connections));
	let mauIdx = $state(scaleIndex(SCALES.mau, DEFAULT_PRESET.inputs.mau));

	const inputs = $derived({
		reads: SCALES.reads[readsIdx],
		writes: SCALES.writes[writesIdx],
		storageGb: SCALES.storageGb[storageIdx],
		connections: SCALES.connections[connectionsIdx],
		mau: SCALES.mau[mauIdx]
	});

	const cf = $derived(estimateCloudflare(inputs));
	const fb = $derived(estimateFirebase(inputs));
	const sb = $derived(estimateSupabase(inputs));
	const multiplier = $derived(cf.totalUsd > 0 ? fb.totalUsd / cf.totalUsd : 0);

	const activePreset = $derived(
		PRESETS.find(
			(preset) =>
				scaleIndex(SCALES.reads, preset.inputs.reads) === readsIdx &&
				scaleIndex(SCALES.writes, preset.inputs.writes) === writesIdx &&
				scaleIndex(SCALES.storageGb, preset.inputs.storageGb) === storageIdx &&
				scaleIndex(SCALES.connections, preset.inputs.connections) === connectionsIdx &&
				scaleIndex(SCALES.mau, preset.inputs.mau) === mauIdx
		)?.id ?? null
	);

	function applyPreset(id: string) {
		const preset = PRESETS.find((entry) => entry.id === id);
		if (!preset) return;
		readsIdx = scaleIndex(SCALES.reads, preset.inputs.reads);
		writesIdx = scaleIndex(SCALES.writes, preset.inputs.writes);
		storageIdx = scaleIndex(SCALES.storageGb, preset.inputs.storageGb);
		connectionsIdx = scaleIndex(SCALES.connections, preset.inputs.connections);
		mauIdx = scaleIndex(SCALES.mau, preset.inputs.mau);
	}

	/** Segments worth drawing; sub-cent lines stay in the legend only. */
	const segments = $derived(cf.items.filter((item) => item.usd >= 0.01));

	const sliders = $derived([
		{
			id: 'reads',
			label: 'Reads / month',
			value: formatCount(inputs.reads),
			max: SCALES.reads.length - 1,
			get: () => readsIdx,
			set: (index: number) => (readsIdx = index)
		},
		{
			id: 'writes',
			label: 'Writes / month',
			value: formatCount(inputs.writes),
			max: SCALES.writes.length - 1,
			get: () => writesIdx,
			set: (index: number) => (writesIdx = index)
		},
		{
			id: 'storage',
			label: 'Stored data',
			value: `${inputs.storageGb} GB`,
			max: SCALES.storageGb.length - 1,
			get: () => storageIdx,
			set: (index: number) => (storageIdx = index)
		},
		{
			id: 'connections',
			label: 'Concurrent realtime',
			value: formatCount(inputs.connections),
			max: SCALES.connections.length - 1,
			get: () => connectionsIdx,
			set: (index: number) => (connectionsIdx = index)
		},
		{
			id: 'mau',
			label: 'Monthly active users',
			value: formatCount(inputs.mau),
			max: SCALES.mau.length - 1,
			get: () => mauIdx,
			set: (index: number) => (mauIdx = index)
		}
	]);
</script>

<div class="space-y-8" data-testid="pricing-calculator">
	<div class="flex flex-wrap items-center gap-2">
		{#each PRESETS as preset (preset.id)}
			<Button
				variant={activePreset === preset.id ? 'default' : 'outline'}
				size="sm"
				data-testid={`pricing-preset-${preset.id}`}
				data-active={activePreset === preset.id}
				title={preset.description}
				onclick={() => applyPreset(preset.id)}
			>
				{preset.label}
			</Button>
		{/each}
	</div>

	<Card.Root>
		<Card.Content class="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
			{#each sliders as slider (slider.id)}
				<div class="space-y-2">
					<div class="flex items-baseline justify-between">
						<span class="text-sm text-muted-foreground">{slider.label}</span>
						<span
							class="font-mono text-sm font-medium tabular-nums"
							data-testid={`pricing-value-${slider.id}`}>{slider.value}</span
						>
					</div>
					<Slider
						type="single"
						min={0}
						max={slider.max}
						step={1}
						value={slider.get()}
						onValueChange={(index: number) => slider.set(index)}
						aria-label={slider.label}
					/>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>

	<div class="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
		<Card.Root class="border-primary/40" data-testid="pricing-cloudflare">
			<Card.Header>
				<Card.Description>Frostbase on your Cloudflare account</Card.Description>
				<Card.Title class="text-4xl tabular-nums" data-testid="pricing-total-cf">
					{formatUsd(cf.totalUsd)}<span class="text-base font-normal text-muted-foreground">
						/month</span
					>
				</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if cf.freeTier}
					<p class="text-sm font-medium text-primary" data-testid="pricing-free-tier">
						Fits the Workers free plan - Durable Objects included.
					</p>
				{/if}
				<!-- The breakdown bar: fixed-order segments, 2px surface gaps,
				     4px rounded data ends. Identity via the legend swatches;
				     values live in text tokens, never on the marks. -->
				<div
					class="flex h-4 w-full gap-0.5 overflow-hidden rounded-[4px]"
					role="img"
					aria-label={`Cost breakdown: ${cf.items
						.map((item) => `${item.label} ${formatUsd(item.usd)}`)
						.join(', ')}`}
					data-testid="pricing-breakdown"
				>
					{#each segments as item (item.id)}
						<div
							class="cost-segment h-full"
							style={`width:${Math.max(3, (item.usd / cf.totalUsd) * 100)}%;--segment:var(--cost-${item.id})`}
							title={`${item.label}: ${formatUsd(item.usd)} - ${item.detail}`}
						></div>
					{/each}
				</div>
				<ul class="space-y-1.5">
					{#each cf.items as item (item.id)}
						<li class="flex items-center justify-between gap-3 text-sm" title={item.detail}>
							<span class="flex min-w-0 items-center gap-2">
								<span
									class="cost-segment h-2.5 w-2.5 shrink-0 rounded-[3px]"
									style={`--segment:var(--cost-${item.id})`}
								></span>
								<span class="truncate text-muted-foreground">{item.label}</span>
							</span>
							<span class="font-mono tabular-nums">{formatUsd(item.usd)}</span>
						</li>
					{/each}
				</ul>
				<p class="text-xs text-muted-foreground">
					Rows read are effectively free: 25 <em>billion</em> are included before the first $0.001/M.
					Realtime pushes bill as Durable Object requests at $0.15/M.
				</p>
			</Card.Content>
		</Card.Root>

		<Card.Root data-testid="pricing-firebase">
			<Card.Header>
				<Card.Description>The same app on Firebase (Firestore, nam5)</Card.Description>
				<Card.Title class="text-4xl tabular-nums" data-testid="pricing-total-fb">
					{formatUsd(fb.totalUsd)}<span class="text-base font-normal text-muted-foreground">
						/month</span
					>
				</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if multiplier >= 1.05}
					<p class="text-sm font-medium" data-testid="pricing-multiplier">
						{multiplier >= 10 ? multiplier.toFixed(0) : multiplier.toFixed(1)}&times; the Cloudflare
						bill
					</p>
				{/if}
				<ul class="space-y-1.5 text-sm">
					<li class="flex items-center justify-between gap-3">
						<span class="text-muted-foreground">
							Document reads
							{#if fb.listenerReads > 0}
								<span class="text-xs">(incl. {formatCount(fb.listenerReads)} listener reads)</span>
							{/if}
						</span>
						<span class="font-mono tabular-nums">{formatUsd(fb.readsUsd)}</span>
					</li>
					<li class="flex items-center justify-between gap-3">
						<span class="text-muted-foreground">Document writes</span>
						<span class="font-mono tabular-nums">{formatUsd(fb.writesUsd)}</span>
					</li>
					<li class="flex items-center justify-between gap-3">
						<span class="text-muted-foreground">Storage</span>
						<span class="font-mono tabular-nums">{formatUsd(fb.storageUsd)}</span>
					</li>
					<li class="flex items-center justify-between gap-3">
						<span class="text-muted-foreground">
							Auth MAU <span class="text-xs">(free to 50k)</span>
						</span>
						<span class="font-mono tabular-nums">{formatUsd(fb.authUsd)}</span>
					</li>
				</ul>
				<p class="text-xs text-muted-foreground">
					The structural difference: Firestore bills <strong
						>every document a realtime listener receives as a read</strong
					> ($0.06 per 100k) - fan-out multiplies the bill by subscriber count. Free tier (50k reads /
					20k writes per day) is folded in; auth past 50k MAU uses Identity Platform's graduated rates.
				</p>
			</Card.Content>
		</Card.Root>

		<Card.Root data-testid="pricing-supabase">
			<Card.Header>
				<Card.Description
					>The same app on Supabase ({sb.freeTier ? 'Free' : 'Pro'})</Card.Description
				>
				<Card.Title class="text-4xl tabular-nums" data-testid="pricing-total-sb">
					{formatUsd(sb.totalUsd)}<span class="text-base font-normal text-muted-foreground">
						/month</span
					>
				</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if sb.freeTier}
					<p class="text-sm text-muted-foreground" data-testid="pricing-supabase-free">
						Fits the Free plan (500 MB database, 200 realtime connections; free projects pause after
						a week of inactivity).
					</p>
				{:else}
					<ul class="space-y-1.5 text-sm">
						<li class="flex items-center justify-between gap-3">
							<span class="text-muted-foreground">
								Pro base <span class="text-xs">(incl. one Micro instance)</span>
							</span>
							<span class="font-mono tabular-nums">{formatUsd(sb.baseUsd)}</span>
						</li>
						<li class="flex items-center justify-between gap-3">
							<span class="text-muted-foreground">
								Auth MAU <span class="text-xs">(free to 100k)</span>
							</span>
							<span class="font-mono tabular-nums">{formatUsd(sb.mauUsd)}</span>
						</li>
						<li class="flex items-center justify-between gap-3">
							<span class="text-muted-foreground">Database storage</span>
							<span class="font-mono tabular-nums">{formatUsd(sb.storageUsd)}</span>
						</li>
						<li class="flex items-center justify-between gap-3">
							<span class="text-muted-foreground">Realtime</span>
							<span class="font-mono tabular-nums">{formatUsd(sb.realtimeUsd)}</span>
						</li>
					</ul>
				{/if}
				<p class="text-xs text-muted-foreground">
					Reads and writes are not metered per operation on Supabase - sustained load is provisioned <strong
						>compute</strong
					> (bigger instances), which this estimate leaves out, in Supabase's favor. Realtime bills peak
					connections ($10 per 1000 past 500) and messages ($2.50/M past 5M).
				</p>
			</Card.Content>
		</Card.Root>
	</div>

	<details class="text-sm text-muted-foreground">
		<summary class="cursor-pointer font-medium text-foreground">
			Model assumptions and sources
		</summary>
		<div class="mt-3 space-y-2">
			<p>
				An estimate whose assumptions are hidden is an ad, not a tool. This one assumes: each API
				read or write is one Worker request plus one Durable Object request (~{MODEL.cpuMsPerOp}ms
				CPU, ~5ms DO time); a read touches ~{MODEL.rowsPerRead} SQLite rows and a write ~{MODEL.rowsPerWrite};
				each realtime connection receives ~{MODEL.messagesPerConnectionMonth / 30} pushed updates a day;
				daily free-tier allowances are folded to months assuming steady traffic. Idle WebSockets hibernate
				and cost nothing while quiet. MAU is an auth headcount only - Frostbase has no per-user charge
				(auth requests are ordinary requests), while Firebase and Supabase bill MAU directly past their
				free allowances. Supabase's compute sizing, egress, Workers AI (the copilot), and multi-region
				read replicas are not modeled.
			</p>
			<p>
				Rates as of {PRICING_AS_OF}, from
				{#each PRICING_SOURCES as source, index (source.url)}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- external pricing sources -->
					<a class="underline underline-offset-2 hover:text-foreground" href={source.url}
						>{source.label}</a
					>{index < PRICING_SOURCES.length - 1 ? ', ' : '.'}
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/each}
				All three bills are estimates - measure before you commit either way.
			</p>
		</div>
	</details>
</div>

<!-- The cost palette and .cost-segment live in src/routes/layout.css: a component
	 <style> block here becomes its own render-blocking stylesheet on the landing
	 page, which cost a round trip to save a kilobyte. -->
