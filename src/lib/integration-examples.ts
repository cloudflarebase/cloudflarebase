export interface CodeExample {
	id: string;
	label: string;
	lang: string;
	code: string;
}

/**
 * Ready-to-paste auth snippets targeting `url` (a project's auth base, e.g.
 * `https://host/api/projects/<id>/auth`). Shared by the dashboard's
 * Integration tab and the landing page's API section.
 */
export function buildIntegrationExamples(url: string): CodeExample[] {
	return [
		{
			id: 'js',
			label: 'JavaScript',
			lang: 'javascript',
			code: `const res = await fetch('${url}/sign-up/email', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name, email, password })
});

// Same-origin apps get a cookie; external clients use the bearer token:
const token = res.headers.get('set-auth-token');

await fetch('${url}/get-session', {
  headers: { authorization: \`Bearer \${token}\` }
});`
		},
		{
			id: 'ts',
			label: 'Better Auth client',
			lang: 'typescript',
			code: `import { createAuthClient } from 'better-auth/client';

const authClient = createAuthClient({
  baseURL: '${url}'
});

await authClient.signUp.email({ name, email, password });
const { data: session } = await authClient.getSession();`
		},
		{
			id: 'react',
			label: 'React',
			lang: 'tsx',
			code: `import { createAuthClient } from 'better-auth/react';

const { useSession, signIn } = createAuthClient({
  baseURL: '${url}'
});

export function Profile() {
  const { data: session, isPending } = useSession();
  if (isPending) return <p>Loading…</p>;
  if (!session) {
    return <button onClick={() => signIn.email({ email, password })}>Sign in</button>;
  }
  return <p>Signed in as {session.user.name}</p>;
}`
		},
		{
			id: 'svelte',
			label: 'Svelte',
			lang: 'svelte',
			code: `<script>
  import { createAuthClient } from 'better-auth/svelte';

  const authClient = createAuthClient({
    baseURL: '${url}'
  });
  const session = authClient.useSession();
</script>

{#if $session.data}
  <p>Signed in as {$session.data.user.name}</p>
{:else}
  <button onclick={() => authClient.signIn.email({ email, password })}>
    Sign in
  </button>
{/if}`
		},
		{
			id: 'python',
			label: 'Python',
			lang: 'python',
			code: `import requests

BASE = "${url}"

res = requests.post(f"{BASE}/sign-up/email", json={
    "name": "Jane Doe",
    "email": "jane@example.com",
    "password": "correct-horse-battery",
})
token = res.headers["set-auth-token"]

session = requests.get(
    f"{BASE}/get-session",
    headers={"Authorization": f"Bearer {token}"},
).json()`
		},
		{
			id: 'curl',
			label: 'cURL',
			lang: 'bash',
			code: `# -i prints headers; set-auth-token carries the bearer token
curl -i -X POST ${url}/sign-up/email \\
  -H 'content-type: application/json' \\
  -d '{"name":"Jane","email":"jane@example.com","password":"correct-horse-battery"}'

curl ${url}/get-session \\
  -H 'authorization: Bearer <token>'`
		}
	];
}
