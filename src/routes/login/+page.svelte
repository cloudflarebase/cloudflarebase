<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import ConsoleShell from '$lib/components/console-shell.svelte';
	import { CONSOLE_AUTH_BASE } from '$lib/console';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let { data } = $props();

	// First run: no owner yet, so the page claims the console instead of
	// signing in. The agent permits exactly one sign-up on this instance.
	const claiming = $derived(!data.ownerExists);

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let error = $state<string | null>(null);
	let submitting = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		submitting = true;
		error = null;

		try {
			const response = await fetch(
				`${CONSOLE_AUTH_BASE}/${claiming ? 'sign-up' : 'sign-in'}/email`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(claiming ? { name, email, password } : { email, password })
				}
			);

			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { message?: string } | null;
				error =
					body?.message ??
					(claiming ? 'Could not create the owner account.' : 'Incorrect email or password.');
				return;
			}

			await invalidateAll();
			await goto(data.next);
		} catch {
			error = 'Could not reach the auth agent.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{claiming ? 'Set up your console' : 'Sign in'} · Cloudflarebase</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<ConsoleShell>
	<div data-testid="console-login" class="space-y-6">
		<div class="space-y-1.5">
			<h1 class="text-2xl font-semibold tracking-tight">
				{claiming ? 'Set up your console' : 'Sign in'}
			</h1>
			<p class="text-sm text-muted-foreground">
				{#if claiming}
					No owner yet. Create the first account — sign-up closes as soon as it exists.
				{:else}
					Sign in to manage your projects.
				{/if}
			</p>
		</div>

		<form class="space-y-4" onsubmit={submit}>
			{#if claiming}
				<div class="space-y-1.5">
					<Label for="name">Name</Label>
					<Input id="name" bind:value={name} required autocomplete="name" />
				</div>
			{/if}

			<div class="space-y-1.5">
				<Label for="email">Email</Label>
				<Input id="email" type="email" bind:value={email} required autocomplete="email" />
			</div>

			<div class="space-y-1.5">
				<Label for="password">Password</Label>
				<Input
					id="password"
					type="password"
					bind:value={password}
					required
					minlength={claiming ? 8 : undefined}
					autocomplete={claiming ? 'new-password' : 'current-password'}
				/>
			</div>

			{#if error}
				<p class="text-sm text-destructive" data-testid="console-login-error">{error}</p>
			{/if}

			<Button type="submit" class="w-full" disabled={submitting}>
				{submitting ? 'Working…' : claiming ? 'Create owner account' : 'Sign in'}
			</Button>
		</form>
	</div>
</ConsoleShell>
