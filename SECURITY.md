# Security policy

Cloudflarebase stores credentials and issues sessions, so security reports get
priority over everything else in the queue.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting instead:

- Go to the [Security tab](../../security/advisories/new) and open a draft advisory.

Please include what you can:

- what an attacker gains, and what access they need to start
- steps to reproduce, ideally against a local `npm run dev` stack
- affected version or commit

You will get an acknowledgement within 3 working days and an assessment within 10. We will tell you when a fix ships and credit you in the advisory unless you
would rather stay anonymous.

## Scope

In scope:

- the console guard and anything that reaches project data without an operator
  session
- authentication, session handling, JWT issuance, and the JWKS endpoint
- cross-project isolation — one project reading or mutating another
- CORS and trusted-origin handling
- privilege escalation through the role registry or the admin routes

Out of scope:

- anything requiring a compromised Cloudflare account or `wrangler` credentials
- rate limits on a deployment you control — tune them yourself
- self-hosted installs that set `DEMO_MODE=true`, which is intended to be
  publicly reachable and is documented as such
- missing hardening headers with no demonstrated impact

## Deploying safely

Two settings decide whether your install is exposed, so they are worth checking
directly rather than assuming:

- **`DEMO_MODE` must be unset** on any deployment holding real users. Setting it
  opens ephemeral `demo-<hex>` projects to anonymous visitors. It is unset by
  default; a self-hosted install is private unless you turn it on.
- **`BETTER_AUTH_SECRET` must be a real secret**, set with
  `wrangler secret put`, and different in every environment. The value committed
  in `env.test.vars` exists so the e2e suite is deterministic and is worthless
  anywhere else — never reuse it.

`ADMIN_SECRET` gates the fleet page at `/admin`; rotating it signs every admin
out, because the cookie stores a digest of the secret rather than a session.

## Supported versions

Cloudflarebase is pre-1.0. Fixes land on `main`, and self-hosted installs should
track it.
