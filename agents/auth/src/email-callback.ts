/**
 * Emailed auth links land on the auth API's own origin, which on a managed
 * deployment is the dashboard - not the app that asked for the mail. Better
 * Auth redirects to the link's `callbackURL` verbatim after verifying, so a
 * hosted app signing up with `callbackURL: '/'` (the default) bounced its
 * freshly verified user to the dashboard instead of back to itself. The same
 * shape carries password-reset and email-change links.
 *
 * This resolves a relative callbackURL against the requesting app's Origin
 * header at mail-generation time, so the link redirects to the app that
 * initiated the flow. Trust holds twice: the Origin only counts when it is
 * already on the project's allowlist - the same exact-match rule CORS applies
 * - and Better Auth re-validates the now-absolute callbackURL against that
 * same list before redirecting, so an origin removed in the meantime fails
 * closed instead of remaining a destination. Only a path that cannot
 * re-anchor the URL is rewritten: `//host` and `/\host` are how a "relative"
 * string escapes its origin.
 */
export function resolveEmailCallback(
	url: string,
	request: Request | undefined,
	trustedOrigins: string[],
): string {
	const origin = request?.headers.get('origin');
	if (!origin || !trustedOrigins.includes(origin)) return url;
	try {
		const link = new URL(url);
		const callback = link.searchParams.get('callbackURL');
		if (link.origin === origin || !callback || !/^\/(?![/\\])/.test(callback)) return url;
		link.searchParams.set('callbackURL', new URL(callback, origin).href);
		return link.toString();
	} catch {
		return url;
	}
}
