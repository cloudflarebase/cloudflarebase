// Optional secrets set via `wrangler secret put` — not present in wrangler.jsonc
// vars, so they are augmented here instead of hand-editing the generated
// worker-configuration.d.ts.
interface Env {
	AUTH_EMAIL_WEBHOOK_URL?: string;
	AUTH_EMAIL_WEBHOOK_SECRET?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	DISABLE_RATE_LIMIT?: 'true';
	/** Enable Analytics Engine SQL API querying (writes need no credentials). */
	CF_ACCOUNT_ID?: string;
	CF_ANALYTICS_API_TOKEN?: string;
}
