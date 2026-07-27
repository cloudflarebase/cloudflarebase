<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ConsoleShell from '$lib/components/console-shell.svelte';
	import { CONSOLE_AUTH_BASE } from '$lib/console';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let { data } = $props();

	// First run: no owner yet, so the page claims the console instead of
	// signing in. The agent permits exactly one sign-up on this instance.
	const claiming = $derived(!data.ownerExists);

	// A demo deployment has no operators at all — the agent refuses the claim,
	// so offering the form would only collect a doomed submission. The web and
	// agent DEMO_MODE flags only diverge in the e2e harness, which never
	// renders this page.
	const demoWithoutConsole = $derived(claiming && data.demoMode);

	const socialLabels: Record<string, string> = {
		google: 'Google',
		github: 'GitHub'
	};

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

	/**
	 * Better Auth's social flow: the POST returns the provider's authorization
	 * URL and the browser navigates there; the OAuth callback lands the session
	 * cookie and redirects to callbackURL. Sign-in only — the console instance
	 * refuses to create users beyond the owner, so an unknown account bounces
	 * rather than registering.
	 */
	async function signInWithProvider(provider: string) {
		submitting = true;
		error = null;

		try {
			const response = await fetch(`${CONSOLE_AUTH_BASE}/sign-in/social`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ provider, callbackURL: data.next })
			});
			const body = (await response.json().catch(() => null)) as { url?: string } | null;

			if (!response.ok || !body?.url) {
				error = `Could not start ${socialLabels[provider] ?? provider} sign-in.`;
				return;
			}
			window.location.href = body.url;
		} catch {
			error = 'Could not reach the auth agent.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title
		>{demoWithoutConsole ? 'Demo deployment' : claiming ? 'Set up your console' : 'Sign in'} · Cloudflarebase</title
	>
	<meta name="robots" content="noindex" />
</svelte:head>

<ConsoleShell>
	{#if demoWithoutConsole}
		<div data-testid="console-demo-notice" class="space-y-6">
			<div class="space-y-1.5">
				<h1 class="text-2xl font-semibold tracking-tight">This is a demo deployment</h1>
				<p class="text-sm text-muted-foreground">
					There is no console to set up here. Demo deployments have no operators: every visitor gets
					an anonymous, self-erasing project instead of an account.
				</p>
			</div>

			<div class="space-y-3">
				<Button href={resolve('/dashboard')} class="w-full">Try the demo</Button>
				<p class="text-xs text-muted-foreground">
					Running this deployment yourself? Fleet monitoring lives at <a
						class="underline"
						href={resolve('/admin')}>/admin</a
					>, behind its own secret. To get a private console with real projects, deploy without
					<code class="font-mono">DEMO_MODE</code>.
				</p>
			</div>
		</div>
	{:else}
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

			{#if !claiming && data.socialProviders.length > 0}
				<div class="space-y-2" data-testid="console-social-providers">
					{#each data.socialProviders as provider (provider)}
						<Button
							type="button"
							variant="outline"
							class="w-full"
							disabled={submitting}
							onclick={() => signInWithProvider(provider)}
						>
							Continue with {socialLabels[provider] ?? provider}
						</Button>
					{/each}
				</div>

				<div class="flex items-center gap-3 text-xs text-muted-foreground">
					<span class="h-px flex-1 bg-border"></span>
					or with email
					<span class="h-px flex-1 bg-border"></span>
				</div>
			{/if}

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
	{/if}
</ConsoleShell>
