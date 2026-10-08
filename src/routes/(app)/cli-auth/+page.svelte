<script lang="ts">
	import { page } from '$app/state';
	import ConsoleShell from '$lib/components/console-shell.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { TerminalSquare } from '@lucide/svelte';

	// The CLI's localhost listener and its one-time code, from
	// `frostbase login`. The guard already
	// required an operator session to render this page.
	const port = $derived.by(() => {
		const raw = Number(page.url.searchParams.get('port'));
		return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : null;
	});
	const code = $derived(page.url.searchParams.get('code'));

	let error = $state<string | null>(null);
	let busy = $state(false);

	async function approve() {
		if (!port || !code) return;
		busy = true;
		error = null;
		try {
			const response = await fetch('/api/cli/token', { method: 'POST' });
			const body = (await response.json().catch(() => null)) as { token?: string } | null;
			if (!response.ok || !body?.token) {
				error = 'Could not read the session token - sign in again and retry.';
				return;
			}
			// A plain form POST: top-level navigations are exempt from CORS, so
			// the token reaches the CLI's localhost listener without the listener
			// speaking CORS, and it never appears in a URL or browser history.
			const form = document.createElement('form');
			form.method = 'POST';
			form.action = `http://127.0.0.1:${port}/`;
			for (const [name, value] of [
				['token', body.token],
				['code', code]
			]) {
				const input = document.createElement('input');
				input.type = 'hidden';
				input.name = name;
				input.value = value;
				form.appendChild(input);
			}
			document.body.appendChild(form);
			form.submit();
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>CLI access · Frostbase</title>
</svelte:head>

<ConsoleShell signedIn>
	<Card.Root class="mx-auto max-w-md" data-testid="cli-auth-card">
		<Card.Header>
			<div
				class="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"
			>
				<TerminalSquare class="h-5 w-5" />
			</div>
			<Card.Title>Approve CLI access</Card.Title>
			<Card.Description>
				The <span class="font-mono">frostbase</span> CLI on this machine is asking to act as you. Approving
				hands it your operator session - it shows up in the console's sessions list and can be revoked
				there at any time.
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if port && code}
				<p class="text-sm text-muted-foreground">
					The token is delivered only to
					<span class="font-mono text-foreground">127.0.0.1:{port}</span> on this machine.
				</p>
				{#if error}
					<p class="text-sm text-destructive" data-testid="cli-auth-error">{error}</p>
				{/if}
				<Button onclick={approve} disabled={busy} data-testid="cli-auth-approve">
					{busy ? 'Approving…' : 'Approve'}
				</Button>
			{:else}
				<p class="text-sm text-muted-foreground" data-testid="cli-auth-invalid">
					This page is opened by <span class="font-mono">frostbase login</span> and needs the port and
					code it provides. Run the command again and use the link it prints.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>
</ConsoleShell>
