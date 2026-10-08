<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Play, TerminalSquare } from '@lucide/svelte';

	/**
	 * The SQL Editor page: the operator surface over
	 * POST /admin/tables/:name/sql - the same gate as the public T2 endpoint
	 * (single table, no DDL), operator-authenticated so no project JWT is
	 * needed. Statements run against ONE declared table by construction; the
	 * table select is part of the query, not a filter.
	 */

	let { projectId, tables }: { projectId: string; tables: string[] } = $props();

	type SqlStatementResult = {
		results: Record<string, unknown>[];
		columns: string[];
		raw: unknown[][];
		meta: { changes: number; rows_read: number; rows_written: number };
	};

	let table = $state<string | null>(null);
	let sqlText = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let results = $state<SqlStatementResult[] | null>(null);

	// Keep the selection valid as tables appear/disappear via state sync, and
	// seed the editor with a starter query the first time a table is picked.
	$effect(() => {
		if (table && !tables.includes(table)) table = null;
		if (!table && tables.length > 0) selectTable(tables[0]);
	});

	function selectTable(name: string) {
		table = name;
		if (!sqlText.trim() || /^SELECT \* FROM \S+ ORDER BY created_at/.test(sqlText.trim())) {
			sqlText = `SELECT * FROM ${name} ORDER BY created_at DESC LIMIT 50;`;
		}
	}

	async function run() {
		const target = table;
		const sql = sqlText.trim().replace(/;$/, '');
		if (!target || !sql || busy) return;
		busy = true;
		error = null;
		try {
			const response = await fetch(
				`/api/projects/${projectId}/db/admin/tables/${encodeURIComponent(target)}/sql`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ sql })
				}
			);
			const body = (await response.json().catch(() => null)) as
				{ success: true; batch: SqlStatementResult[] } | { success: false; error?: string } | null;
			if (!response.ok || !body || body.success !== true) {
				throw new Error(
					(body && 'error' in body && body.error) || `request failed (HTTP ${response.status})`
				);
			}
			results = body.batch;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			results = null;
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root data-testid="db-sql-editor">
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<TerminalSquare class="h-4 w-4 text-primary" /> SQL console
		</Card.Title>
		<Card.Description>
			SELECT, INSERT, UPDATE, and DELETE against one declared table. DDL never runs here - declare
			and evolve schemas on the Tables page or with <span class="font-mono"
				>frostbase schema apply</span
			>.
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		{#if tables.length === 0}
			<p
				class="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground"
				data-testid="db-sql-empty"
			>
				No tables declared yet - declare one on the Tables page first.
			</p>
		{:else}
			<div class="flex flex-wrap items-end gap-3">
				<div class="space-y-2">
					<Label>Table</Label>
					<Select.Root
						type="single"
						value={table ?? undefined}
						onValueChange={(value) => value && selectTable(value)}
					>
						<Select.Trigger
							class="min-w-40 font-mono"
							size="sm"
							aria-label="Table to query"
							data-testid="db-sql-table"
						>
							{table ?? 'pick a table'}
						</Select.Trigger>
						<Select.Content>
							{#each tables as name (name)}
								<Select.Item value={name} label={name} class="font-mono" />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<Button
					size="sm"
					class="ml-auto"
					disabled={busy || !table || !sqlText.trim()}
					onclick={run}
					data-testid="db-sql-run"
				>
					<Play class="h-3.5 w-3.5" />
					{busy ? 'Running…' : 'Run'}
				</Button>
			</div>
			<Textarea
				class="min-h-36 font-mono text-xs"
				spellcheck="false"
				bind:value={sqlText}
				data-testid="db-sql-text"
			/>
			{#if error}
				<p class="text-sm text-destructive" data-testid="db-sql-error">{error}</p>
			{/if}
			{#if results}
				{#each results as result, statementIndex (statementIndex)}
					<div class="space-y-2" data-testid="db-sql-result">
						<p class="font-mono text-xs text-muted-foreground">
							{result.results.length}
							{result.results.length === 1 ? 'row' : 'rows'} · {result.meta.rows_read} read · {result
								.meta.rows_written} written
						</p>
						{#if result.columns.length > 0 && result.raw.length > 0}
							<!-- Bounded like the tables grid: a bare SELECT returns whatever
							     the operator asked for, and an uncapped result pushed the
							     editor and Run button off the top of the shell's scrollport
							     (300 rows was a 10,000px page). Header stays put while the
							     rows scroll. -->
							<div class="max-h-[60vh] overflow-auto rounded-lg border">
								<Table.Root>
									<Table.Header class="sticky top-0 z-10 bg-card">
										<Table.Row>
											{#each result.columns as column (column)}
												<Table.Head class="font-mono text-xs">{column}</Table.Head>
											{/each}
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{#each result.raw as row, rowIndex (rowIndex)}
											<Table.Row>
												{#each row as cell, cellIndex (cellIndex)}
													<Table.Cell class="max-w-64 truncate font-mono text-xs">
														{cell === null ? 'NULL' : String(cell)}
													</Table.Cell>
												{/each}
											</Table.Row>
										{/each}
									</Table.Body>
								</Table.Root>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		{/if}
	</Card.Content>
</Card.Root>
