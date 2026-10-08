<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Privacy Policy · Frostbase</title>
	<meta
		name="description"
		content="What the hosted service at frostbase.dev collects, why, and how long it keeps it."
	/>
</svelte:head>

<h1>Privacy Policy</h1>
<p class="lead">Effective July 29, 2026</p>

<p>
	This policy describes what the hosted service at frostbase.dev collects and why. Frostbase is an
	independent open-source project and is not affiliated with Cloudflare, Inc. If you run Frostbase
	yourself, your deployment is operated by you — this policy covers only frostbase.dev.
</p>

<h2>What we collect</h2>

<p>
	<strong>No accounts.</strong> frostbase.dev has no sign-up. The demo is anonymous, so we never collect
	your email address, your name, or a password.
</p>

<p>
	<strong>Demo projects.</strong> The live demo mints an anonymous, ephemeral project for your browser;
	no account is involved. We keep a log of each demo project's random identifier — nothing else. Any data
	you put into a demo project (test users, sessions, chat) lives in that project's isolated storage until
	the project erases itself, currently 30 days after it was created.
</p>

<p>
	<strong>Usage analytics.</strong> Authentication events (for example "user signed up") are recorded
	in Cloudflare Workers Analytics Engine with the project id, event type, country, sign-in provider, internal
	user and session identifiers, and the domain part of an email address — never the address itself. Events
	are retained for about 90 days. We use no third-party advertising or tracking scripts.
</p>

<p>
	<strong>Copilot chat.</strong> Messages you send to the project copilot are stored under a project-scoped,
	one-way hash of your IP address (signed-in operators: an internal account identifier); raw IP addresses
	are never stored with chat messages. Demo-project chat history is deleted after 30 days. Inference runs
	on Cloudflare Workers AI.
</p>

<p>
	<strong>Diagnostics.</strong> Our production deployment reports errors to Sentry: stack traces, browser
	and OS version, and the URL where the error occurred.
</p>

<p>
	<strong>Security processing.</strong> Request IP addresses are used for rate limiting, held only briefly
	in memory for the rate-limit window; they are never written to durable storage for that purpose.
</p>

<h2>Cookies</h2>

<p>
	We set functional cookies only: project-scoped authentication cookies when you test sign-in
	against a demo project, an operator-only admin cookie that stores a hashed digest (never the
	secret itself), and a small layout-preference cookie for the copilot pane. Your theme preference
	is kept in your browser's local storage. There are no advertising or cross-site tracking cookies.
</p>

<h2>Where your data lives</h2>

<p>
	Everything runs on Cloudflare's global network — Durable Objects, D1, Analytics Engine, and
	Workers AI. Our service providers are Cloudflare, Inc. (infrastructure and AI inference) and
	Functional Software, Inc. (Sentry, error diagnostics).
</p>

<h2>Retention</h2>

<ul>
	<li>Demo projects self-erase 30 days after creation; only the random project id is kept.</li>
	<li>Analytics events age out after about 90 days.</li>
	<li>Error reports follow Sentry's standard retention (about 90 days).</li>
</ul>

<h2>Your choices</h2>

<p>
	To request access to or deletion of your data, open a
	<a href="https://github.com/frostbase-dev/frostbase/issues" target="_blank" rel="noreferrer"
		>GitHub issue</a
	>
	and we will arrange a private channel — please don't post personal details in the public issue. For
	security vulnerabilities, follow our
	<a
		href="https://github.com/frostbase-dev/frostbase/blob/main/SECURITY.md"
		target="_blank"
		rel="noreferrer">security policy</a
	>.
</p>

<h2>Children</h2>

<p>The service is not directed at children under 16, and we do not knowingly collect their data.</p>

<h2>Changes</h2>

<p>
	This policy lives in our public repository, so every change is a commit you can diff. When it
	changes, we update the effective date above.
</p>

<h2>Contact</h2>

<p>
	Questions about this policy: open a
	<a href="https://github.com/frostbase-dev/frostbase/issues" target="_blank" rel="noreferrer"
		>GitHub issue</a
	>. See also our <a href={resolve('/terms')}>Terms of Service</a>.
</p>
