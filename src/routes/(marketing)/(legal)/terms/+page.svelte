<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Terms of Service · Frostbase</title>
	<meta
		name="description"
		content="The terms that govern the hosted demo and console at frostbase.dev."
	/>
</svelte:head>

<h1>Terms of Service</h1>
<p class="lead">Effective July 29, 2026</p>

<h2>1. Agreement</h2>

<p>
	By using frostbase.dev (the "Service") you agree to these terms. If you don't agree, don't use the
	Service.
</p>

<h2>2. Who we are</h2>

<p>
	Frostbase is an independent open-source project.
	<strong>We are not affiliated with, endorsed by, or sponsored by Cloudflare, Inc.</strong>
	"Cloudflare" is a trademark of Cloudflare, Inc.; we use the name only to describe the platform the software
	runs on.
</p>

<h2>3. The Service and the software</h2>

<p>
	The Service is the hosted demo and console at frostbase.dev. The Frostbase software itself is
	separately licensed under the
	<a
		href="https://github.com/frostbase-dev/frostbase/blob/main/LICENSE"
		target="_blank"
		rel="noreferrer">Apache License 2.0</a
	>; these terms govern only your use of the hosted Service, not your use of the code.
</p>

<h2>4. Demo projects</h2>

<p>
	Demo projects exist for evaluation. They are ephemeral: they delete themselves 30 days after
	creation, cap the number of users, enforce a daily AI inference ceiling, and send no outbound
	email. We may reset or wipe demo projects at any time without notice. Do not store real personal
	data or production data in a demo project.
</p>

<h2>5. Anonymous use</h2>

<p>
	The Service offers no sign-up: demo projects are anonymous and tied to your browser. We may still
	suspend or block access — for example by IP address — to enforce these terms.
</p>

<h2>6. Acceptable use</h2>

<p>
	Don't use the Service to store or distribute unlawful, infringing, or harmful content. Don't probe
	or attempt to break the isolation between projects, evade rate limits or resource caps, or use the
	Service for spam, malware, or mining. Security research is welcome only under our
	<a
		href="https://github.com/frostbase-dev/frostbase/blob/main/SECURITY.md"
		target="_blank"
		rel="noreferrer">security policy</a
	>.
</p>

<h2>7. Your content</h2>

<p>
	Data you put into the Service remains yours. You grant us the rights needed to host, process, and
	display it solely to operate the Service.
</p>

<h2>8. Availability</h2>

<p>
	The Service is preview software provided free of charge. We make no uptime commitment, and
	features may change or be discontinued at any time.
</p>

<h2>9. Disclaimers</h2>

<p>
	The Service is provided "as is" and "as available", without warranties of any kind, to the maximum
	extent permitted by law.
</p>

<h2>10. Limitation of liability</h2>

<p>
	To the maximum extent permitted by law, we are not liable for indirect, incidental, or
	consequential damages, and our total liability for any claim will not exceed USD 50.
</p>

<h2>11. Termination</h2>

<p>
	You may stop using the Service at any time. We may suspend or terminate access for violations of
	these terms or to protect the Service. Demo projects end automatically.
</p>

<h2>12. Changes</h2>

<p>
	We may update these terms. Changes are versioned in our public repository and take effect when
	posted here with a new effective date.
</p>

<h2>13. Contact</h2>

<p>
	Questions about these terms: open a
	<a href="https://github.com/frostbase-dev/frostbase/issues" target="_blank" rel="noreferrer"
		>GitHub issue</a
	>. See also our <a href={resolve('/privacy')}>Privacy Policy</a>.
</p>
