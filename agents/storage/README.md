# @frostbase-dev/storage

Object storage on Cloudflare R2 - buckets of files with per-bucket access
modes, served through your worker with a sorted, pageable index. The storage
primitive behind
[Frostbase](https://github.com/frostbase-dev/frostbase).

One `StorageAgent` Durable Object per project holds the bucket registry and
access config; one `StorageBucket` per bucket holds the object index (keyset
paging, counts, owner scoping - everything R2's `list()` cannot do). Bytes
never enter a Durable Object: the worker streams uploads straight to R2 and
serves downloads with `Range`, conditional requests, and edge caching.

## Install

```sh
npx @frostbase-dev/cli add storage
```

The CLI installs this package, merges `template/wrangler-fragment.jsonc` into
your `wrangler.jsonc`, prepends the entrypoint re-export, and reruns
`wrangler types`. R2 is an account-level opt-in on Cloudflare; the fragment's
header documents the one manual step (enable R2, add the `BUCKET` binding) -
until then the agent deploys fine and object requests answer 503 with the
setup steps.

## What it serves

- Buckets with `public` / `auth` / `owner` read and write modes, verified
  against your project's JWTs; new buckets default to `auth` on both - never
  anonymous by accident. `owner` mode scopes every object to the user that
  wrote it.
- Listing is a separate grant (`publicListing`): serving a known key to
  anyone is not the same as letting anyone enumerate every key.
- Single-shot uploads to 100 MB, per-bucket size and content-type rules, and
  a serve-time inline allowlist - HTML and SVG always download as
  attachments, so user uploads can never become stored XSS on your origin.
- One shared R2 bucket, key-prefixed per project. Never enable r2.dev or
  attach a custom domain to that bucket - the worker path is what enforces
  the prefix. To serve objects on a dedicated hostname, route the domain at
  THIS worker and set `STORAGE_SERVE_DOMAIN`.

## What your Worker serves

The `/buckets/*` object paths - they are the product API and carry their own
per-bucket gate. The operator plane (`/overview`, `/admin/*`, the state-sync
socket) authenticates nobody and answers 404 on your public Worker; drive it
from your own code through the Durable Object namespace bindings, or put your
own authentication in front and set `"EXPOSE_OPERATOR_API": "true"` - only on
a Worker with no public hostname of its own.

## License

Apache-2.0. See NOTICE.
