<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AccountMenu from '$lib/components/account-menu.svelte';
	import ModeToggle from '$lib/components/mode-toggle.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { CONSOLE_AUTH_BASE } from '$lib/console';
	import { Building2, Check, ChevronsUpDown, LayoutGrid, Menu, Plus } from '@lucide/svelte';

	let { data, children } = $props();

	// --- Organization switcher. Lives in the
	// sidebar so every account page re-scopes together; switching keys on the
	// session's activeOrganizationId, so one invalidateAll refreshes it all. ---
	const activeOrgEntry = $derived(
		data.organizations.find((org) => org.id === data.activeOrgId) ?? data.organizations[0] ?? null
	);
	let orgBusy = $state(false);

	async function setActiveOrg(organizationId: string) {
		if (orgBusy || organizationId === activeOrgEntry?.id) return;
		orgBusy = true;
		try {
			await fetch(`${CONSOLE_AUTH_BASE}/organization/set-active`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ organizationId })
			});
			await invalidateAll();
		} finally {
			orgBusy = false;
		}
	}

	// --- New organization: Better Auth's organization/create over the console
	// auth proxy. Slug auto-derives from the name until touched (the project
	// create form's convention); the new org becomes active immediately.
	let newOrgOpen = $state(false);
	let newOrgName = $state('');
	let newOrgSlug = $state('');
	let newOrgSlugTouched = $state(false);
	let newOrgBusy = $state(false);
	let newOrgError = $state<string | null>(null);

	const suggestedSlug = $derived(
		newOrgName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 32)
	);
	const effectiveSlug = $derived(newOrgSlugTouched ? newOrgSlug : suggestedSlug);

	async function createOrganization(event: SubmitEvent) {
		event.preventDefault();
		if (newOrgBusy) return;
		newOrgBusy = true;
		newOrgError = null;
		try {
			const response = await fetch(`${CONSOLE_AUTH_BASE}/organization/create`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: newOrgName.trim(), slug: effectiveSlug })
			});
			const body = (await response.json().catch(() => null)) as {
				id?: string;
				message?: string;
			} | null;
			if (!response.ok || !body?.id) {
				newOrgError = body?.message ?? 'Could not create the organization.';
				return;
			}
			await fetch(`${CONSOLE_AUTH_BASE}/organization/set-active`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ organizationId: body.id })
			});
			newOrgOpen = false;
			newOrgName = '';
			newOrgSlug = '';
			newOrgSlugTouched = false;
			await invalidateAll();
		} catch {
			newOrgError = 'Could not reach the auth agent.';
		} finally {
			newOrgBusy = false;
		}
	}

	const nav = $derived([
		{
			title: 'Projects',
			href: resolve('/(app)/dashboard/(account)'),
			icon: LayoutGrid,
			testId: 'nav-projects',
			active: page.url.pathname === '/dashboard'
		},
		{
			title: 'Organization',
			href: resolve('/(app)/dashboard/(account)/organization'),
			icon: Building2,
			testId: 'nav-organization',
			active: page.url.pathname.startsWith('/dashboard/organization')
		}
	]);

	// Below lg the same aside slides in behind a hamburger, mirroring the
	// project shell so the two consoles cannot drift apart in feel.
	let mobileNavOpen = $state(false);
	$effect(() => {
		void page.url.pathname;
		mobileNavOpen = false;
	});
</script>

<div class="flex min-h-svh bg-background text-foreground">
	{#if mobileNavOpen}
		<button
			type="button"
			class="fixed inset-0 z-40 bg-black/40 lg:hidden"
			aria-label="Close menu"
			onclick={() => (mobileNavOpen = false)}
		></button>
	{/if}

	<aside
		class={[
			'w-60 shrink-0 flex-col border-r border-border bg-card',
			mobileNavOpen ? 'fixed inset-y-0 left-0 z-50 flex shadow-xl' : 'hidden',
			'lg:sticky lg:top-0 lg:z-auto lg:flex lg:h-svh lg:shadow-none'
		]}
	>
		<a
			href={resolve('/')}
			class="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5 font-bold"
		>
			<img src="/brand/mark.svg" alt="" class="h-5 w-5" />
			Frostbase
		</a>

		{#if activeOrgEntry}
			<div class="border-b border-border px-3 py-3">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								type="button"
								class="flex w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-accent"
								disabled={orgBusy}
								aria-label="Switch organization"
								data-testid="org-switcher"
							>
								<Building2 class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								<span class="truncate">{activeOrgEntry.name}</span>
								<ChevronsUpDown class="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
							</button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="w-56">
						{#each data.organizations as org (org.id)}
							<DropdownMenu.Item
								data-testid={`org-item-${org.slug}`}
								onclick={() => setActiveOrg(org.id)}
							>
								<span class="truncate">{org.name}</span>
								{#if org.id === activeOrgEntry.id}<Check class="ml-auto h-4 w-4" />{/if}
							</DropdownMenu.Item>
						{/each}
						<DropdownMenu.Separator />
						<DropdownMenu.Item data-testid="new-org" onclick={() => (newOrgOpen = true)}>
							<Plus class="h-4 w-4" />
							New organization
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		{/if}

		<nav class="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
			{#each nav as item (item.testId)}
				{@const NavIcon = item.icon}
				<a
					href={item.href}
					data-testid={item.testId}
					class={[
						'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
						item.active
							? 'bg-primary/10 text-primary'
							: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
					]}
				>
					<NavIcon class="h-4 w-4" />
					{item.title}
				</a>
			{/each}
		</nav>
	</aside>

	<div class="flex min-w-0 flex-1 flex-col">
		<!-- Header mirrors the project shell: hamburger + brand below lg on the
		     left, account controls (email, sign out, theme) top right always. -->
		<header class="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-6">
			<Button
				size="icon"
				variant="ghost"
				class="h-8 w-8 lg:hidden"
				aria-label="Open menu"
				data-testid="mobile-nav-toggle"
				onclick={() => (mobileNavOpen = true)}
			>
				<Menu class="h-4 w-4" />
			</Button>
			<a href={resolve('/')} class="flex items-center gap-2 font-bold lg:hidden">
				<img src="/brand/mark.svg" alt="" class="h-5 w-5" />
				Frostbase
			</a>

			<!-- Two controls, not four: the avatar menu owns account settings and
			     sign-out, so the bar carries only theme and identity. Ghost, not
			     the default outline - a bordered box around a bare icon was the
			     heaviest thing in the header. -->
			<div class="ml-auto flex items-center gap-2">
				<ModeToggle variant="ghost" class="h-8 w-8" testId="theme-toggle" />
				{#if data.accountUser}
					<!-- The rule separates an appearance control from an identity one -
					     it renders with the avatar, never on its own. -->
					<span class="h-5 w-px bg-border" aria-hidden="true"></span>
					<AccountMenu user={data.accountUser} />
				{/if}
			</div>
		</header>

		<main class="min-w-0 flex-1 px-4 py-8 sm:px-8">
			<div class="mx-auto w-full max-w-4xl">
				{@render children()}
			</div>
		</main>
	</div>
</div>

<Dialog.Root bind:open={newOrgOpen}>
	<Dialog.Content data-testid="new-org-panel">
		<Dialog.Header>
			<Dialog.Title>New organization</Dialog.Title>
			<Dialog.Description>
				Organizations own projects and share them with members. You can switch between yours any
				time.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={createOrganization}>
			<div class="space-y-1.5">
				<Label for="new-org-name">Name</Label>
				<Input id="new-org-name" bind:value={newOrgName} placeholder="Acme Inc" required />
			</div>
			<div class="space-y-1.5">
				<Label for="new-org-slug">Slug</Label>
				<Input
					id="new-org-slug"
					class="font-mono"
					value={effectiveSlug}
					oninput={(event) => {
						newOrgSlugTouched = true;
						newOrgSlug = event.currentTarget.value;
					}}
					placeholder="acme-inc"
					required
				/>
			</div>
			{#if newOrgError}
				<p class="text-sm text-destructive" data-testid="new-org-error">{newOrgError}</p>
			{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (newOrgOpen = false)}>Cancel</Button>
				<Button type="submit" disabled={newOrgBusy} data-testid="new-org-create">
					{newOrgBusy ? 'Creating…' : 'Create organization'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
