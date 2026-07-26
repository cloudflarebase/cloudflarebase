# The agent contract

> Design document. The manifest described here is not implemented yet — it is
> written down now, while exactly one agent exists, so the second one is built
> to a shape rather than copied from the first.

Cloudflarebase is agent-first: every backend capability is a Cloudflare Agent
with one Durable Object instance per project. `agents/auth` is the only one
today, and everything about how it plugs into the console is currently
hardcoded — its sidebar entry, its routes, its proxies, its permission keys.

That is fine for one. It stops being fine at two, because the second agent
either gets its own hardcoded copy of all of it, or the shape gets extracted
under deadline pressure while a feature is half-built. Writing the contract
first is much cheaper than extracting it later.

## Why a manifest at all

One file per agent, declaring what it is and what the platform must do to host
it. That single declaration then serves five jobs that are otherwise five
separate hardcoded edits:

| Job                | What reads the manifest                              |
| ------------------ | ---------------------------------------------------- |
| Install            | the CLI, to scaffold config and add bindings         |
| Wrangler config    | binding and migration fragments merged into a repo   |
| Console UI         | the sidebar and the routes an agent contributes      |
| RBAC               | permission keys the agent defines                    |
| Client integration | the snippets `add <agent>-client` copies into an app |

The manifest is also the registry entry. A third-party agent is just a package
that ships one.

## Shape

```jsonc
// agents/auth/cloudflarebase.agent.json
{
	"name": "auth",
	"title": "Authentication",
	"description": "Users, sessions, and RBAC on Durable Object SQLite.",

	// Durable Object classes this agent owns. `perProject` is the one addressed
	// as /agents/<worker>/<projectId>; `singleton` gets one instance per install.
	"durableObjects": [
		{ "class": "AuthAgent", "scope": "perProject" },
		{ "class": "ProjectRegistry", "scope": "singleton", "instance": "registry" }
	],

	// Merged into the host's wrangler.jsonc. Everything here must be
	// account-neutral: no ids, no domains, no dataset names tied to one account.
	"bindings": {
		"ai": true,
		"sendEmail": ["EMAIL"],
		"analyticsEngine": [{ "binding": "AUTH_EVENTS", "dataset": "${prefix}_auth_events" }]
	},

	"secrets": {
		"required": ["BETTER_AUTH_SECRET"],
		"optional": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CF_ANALYTICS_API_TOKEN"]
	},

	"vars": {
		"TRUSTED_ORIGINS": { "required": true, "hint": "Origin your console is served from." },
		"CHAT_MODEL": { "default": "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }
	},

	// Every route the agent serves, and who may call it. `public` means the
	// customer's application calls it; `operator` requires a console session.
	// The console guard is generated from this, so an undeclared route is
	// unreachable rather than accidentally open.
	"routes": [
		{ "path": "/api/auth/*", "access": "public" },
		{ "path": "/config", "access": "public" },
		{ "path": "/openapi.json", "access": "public" },
		{ "path": "/overview", "access": "operator" },
		{ "path": "/analytics", "access": "operator" },
		{ "path": "/chat", "access": "operator" },
		{ "path": "/admin/*", "access": "operator" }
	],

	// Permission keys this agent contributes to the RBAC registry.
	"permissions": ["users:read", "users:write", "sessions:revoke", "roles:write"],

	// Where the agent appears in the console, and which routes it mounts.
	"console": {
		"section": "Build",
		"icon": "key-round",
		"pages": [
			{ "path": "/auth", "title": "Authentication" },
			{ "path": "/api", "title": "API Reference" }
		]
	},

	// Registry entries for `cloudflarebase add auth-client --framework react`.
	"client": [
		{ "id": "auth-client.react", "target": "src/lib/auth.ts" },
		{ "id": "auth-client.svelte", "target": "src/lib/auth.ts" }
	]
}
```

## Rules an agent must follow

These are already true of `agents/auth` and are what the contract formalises.

1. **One Durable Object per project, named by project id.** Isolation is
   infrastructural, never a tenant column. Cross-project reads happen over RPC
   against a named instance, never by querying a shared table.
2. **`routeAgentRequest` without `cors: true`.** The agent owns its CORS policy
   because it is per project; the SDK's wildcard header would override it.
3. **The worker entrypoint exports only handlers and Durable Object classes.**
   A value export fails at boot.
4. **Migrations are generated, applied in `onStart`, and idempotent.** Drizzle
   tracks what it has applied; waking an agent must be safe.
5. **Analytics writes are best-effort and must never fail the operation.**
6. **`destroy()` erases the project.** The registry calls it, the demo reaper
   calls it, and anything that deletes a project must leave no orphaned
   Durable Object holding user records.
7. **Route access is declared, not implied.** The default is `operator`.

## What has to change to support this

Roughly in order, none of it blocking today:

- **Extract the console guard's route table** from `src/hooks.server.ts` so it
  is built from manifests rather than a hand-written `classifyAccess`. This is
  the highest-value piece: it turns "did someone remember to gate the new
  endpoint" into a property of the declaration.
- **Generalise the proxies.** `/api/projects/<id>/...` currently hardcodes the
  auth agent's routes; it should dispatch by agent name from the manifest.
- **Make the sidebar data-driven** from `console.pages` instead of the
  hardcoded entries in `dashboard/[projectId]/+layout.svelte`.
- **Generalise `RegistryProject`** so a project records which agents it has
  enabled, rather than assuming auth.
- **Move OpenAPI generation behind the manifest** so each agent contributes
  paths to one document per project instead of `src/lib/openapi.ts` knowing
  every route itself.

## What this is not

It is not a plugin runtime. Agents are deployed Workers, not code loaded at
runtime into a host — the manifest describes how to _install and mount_ one,
and installation still means deploying a Worker and adding a service binding.
That keeps the isolation guarantees that make per-project Durable Objects
worth having.

## Open questions

- **Versioning.** A manifest needs a schema version, and the console needs to
  refuse one it does not understand. Semver on the manifest, or on the package?
- **Multiple agents, one worker vs one worker each.** One worker each is
  cleaner for deployment and blast radius, but costs a service binding and a
  deploy step per agent. Auth and the registry already share a worker, which
  suggests grouping is acceptable when agents are closely related.
- **Migration ordering across agents.** Each agent owns its own Durable Object
  storage, so there is no shared schema to order — but a project-level "which
  agents are enabled" record does need migrating.
- **Third-party trust.** If `cloudflarebase add stripe-agent` fetches a
  manifest from a registry, what stops a manifest declaring `"access":
"public"` on something that should not be? Probably: the console shows what
  an agent declares before installing it, the way a mobile app shows
  permissions.
