import { CONSOLE_PROJECT_ID } from '$lib/console';
import { consoleOwnerState } from '$lib/server/console';
import { redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Proof of deployment control for the first-run console claim.
 *
 * The claim used to be gated on a fact about the WORLD - `count(user) === 0` -
 * rather than a fact about the CLAIMER. Arriving first was the whole
 * credential, so any stranger who guessed a self-hosted URL (workers.dev names
 * are enumerable, and this repo's default Worker name is `frostbase`)
 * could take ownership of someone else's install, and `ensureConsoleAdmin`
 * then promoted them to admin over every operator surface on it.
 *
 * The person who deployed the Worker is the owner, so the claim asks for
 * something only they can produce: CONSOLE_SETUP_TOKEN, set with
 * `wrangler secret put` - which needs Cloudflare account credentials, applies
 * without a redeploy, and is a value nothing on the network ever sees.
 *
 * A single proof on purpose. A time-boxed "claimable for N minutes after a
 * deploy" window was considered and dropped: it is still a race, just a
 * shorter one, and it makes the security of an install depend on how quickly
 * its operator got to the browser. A token has no window and no race - an
 * unclaimed console is inert until someone proves they hold it.
 *
 * The console is claimed only when BOTH halves are done: the token unlocks
 * setup, and registration finishes the claim. An unlock alone grants nothing,
 * which is why the guard keeps refusing until an owner actually exists.
 *
 * The cost is one deliberate step on a fresh install (deploying still needs no
 * configuration at all - it is claiming the console that asks for the token),
 * and the same token is the recovery path for a console someone else already
 * owns: see the reset in routes/api/console/setup.
 */

/**
 * Carries a token-proved unlock across requests - including the OAuth round
 * trip, where the browser comes back from google.com with no way to resubmit
 * the token. SameSite=Lax so it survives that top-level navigation.
 */
export const CONSOLE_SETUP_COOKIE = 'cfbase-console-setup';

/**
 * How long one unlock stays good - long enough to fill in a registration form
 * (and to come back from an OAuth provider), short enough that a shared or
 * forgotten browser is not a standing key to the deployment.
 */
export const CONSOLE_SETUP_GRANT_TTL_MS = 30 * 60 * 1000;

/**
 * Below this a setup token is a guess, not a credential. Refusing short ones
 * outright beats accepting `hunter2` and calling the install protected - the
 * unlock route is reachable by anyone who can reach the login page.
 */
export const CONSOLE_SETUP_TOKEN_MIN_LENGTH = 24;

export type ConsoleSetupState = {
	/** Whether a claim may proceed right now. */
	unlocked: boolean;
	/** What unlocked it - or why nothing did. Drives the login page's copy. */
	reason: 'token' | 'dev' | 'locked';
	/** Whether CONSOLE_SETUP_TOKEN is set AND long enough to count. */
	tokenConfigured: boolean;
	/** Set but too short: the operator needs telling, not silently ignoring. */
	tokenTooShort: boolean;
};

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sign(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/**
 * Compares digests rather than the strings themselves, so the loop always runs
 * over 32 bytes and neither length nor first-difference position is timeable.
 */
async function equals(a: string, b: string): Promise<boolean> {
	const [left, right] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(a)),
		crypto.subtle.digest('SHA-256', encoder.encode(b))
	]);
	const x = new Uint8Array(left);
	const y = new Uint8Array(right);
	let diff = 0;
	for (let i = 0; i < x.length; i += 1) diff |= x[i]! ^ y[i]!;
	return diff === 0;
}

/** Only a machine-local address can be the dev loop. */
function isLoopback(hostname: string | undefined): boolean {
	if (!hostname) return false;
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	return (
		host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
	);
}

/** The configured token, or null when it is absent or too short to count. */
function setupToken(platform: App.Platform | undefined): string | null {
	const token = platform?.env?.CONSOLE_SETUP_TOKEN;
	if (!token || token.length < CONSOLE_SETUP_TOKEN_MIN_LENGTH) return null;
	return token;
}

/** A `<expiry>.<hmac>` cookie value, unforgeable without the setup token. */
async function grantValid(token: string, value: string | undefined): Promise<boolean> {
	const [expiry, signature] = (value ?? '').split('.');
	const expiresAt = Number(expiry);
	if (!signature || !Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
	return equals(signature, await sign(token, `console-setup.${expiry}`));
}

/** Mints the cookie value a successful token unlock carries. */
export async function mintSetupGrant(token: string): Promise<{ value: string; maxAge: number }> {
	const expiresAt = Date.now() + CONSOLE_SETUP_GRANT_TTL_MS;
	return {
		value: `${expiresAt}.${await sign(token, `console-setup.${expiresAt}`)}`,
		maxAge: Math.floor(CONSOLE_SETUP_GRANT_TTL_MS / 1000)
	};
}

/**
 * Whether the caller holds a TOKEN-proved unlock specifically - never the dev
 * escape hatch. The reset (erasing every operator account to reclaim a console
 * someone else owns) asks for this rather than for `unlocked`, so that running
 * locally can claim an unowned console but never wipe an owned one.
 */
export async function hasSetupGrant(
	platform: App.Platform | undefined,
	grantCookie: string | undefined
): Promise<boolean> {
	const token = setupToken(platform);
	if (!token) return false;
	return grantValid(token, grantCookie);
}

/** Whether a submitted token matches the configured one. */
export async function verifySetupToken(
	platform: App.Platform | undefined,
	candidate: string
): Promise<boolean> {
	const token = setupToken(platform);
	if (!token || !candidate) return false;
	return equals(token, candidate);
}

/**
 * Whether the first-run claim may proceed, and why. Cheap by design: the token
 * reads env and the grant costs one HMAC, so the steady state - a claimed
 * console with nothing to unlock - pays nothing.
 */
export async function consoleSetupState(
	platform: App.Platform | undefined,
	grantCookie?: string,
	hostname?: string
): Promise<ConsoleSetupState> {
	const rawToken = platform?.env?.CONSOLE_SETUP_TOKEN;
	const token = setupToken(platform);
	const base = {
		tokenConfigured: !!token,
		tokenTooShort: !!rawToken && !token
	};

	// The dev-loop escape hatch, and deliberately inert anywhere it could do
	// harm: it is honoured ONLY for a loopback hostname, so copying env.local's
	// vars into a real config cannot switch the gate off on a deployment that
	// strangers can reach. `npm run dev` serves localhost; nothing else does.
	if (platform?.env?.CONSOLE_SETUP_UNLOCKED === 'true' && isLoopback(hostname)) {
		return { ...base, unlocked: true, reason: 'dev' };
	}

	if (token && (await grantValid(token, grantCookie))) {
		return { ...base, unlocked: true, reason: 'token' };
	}

	return { ...base, unlocked: false, reason: 'locked' };
}

/**
 * Whether a path is one of the routes that can CREATE the console's first
 * account. Both doors are covered: the REST proxy the browser uses, and the
 * `/agents/*` passthrough, which reaches the same agent without one. Both
 * classify as public (the auth manifest publishes `/api/auth/*`), so the guard
 * is the only place that sees them.
 *
 * Password sign-in is deliberately absent - with no accounts there is nothing
 * to sign into - and so is every other Better Auth route: the callback is here
 * because social sign-in creates the user implicitly on the way back.
 */
export function isConsoleClaimSurface(pathname: string): boolean {
	const segments = normalizeSegments(pathname);

	let rest: string[] | null = null;
	// /api/projects/console/auth/<...>
	if (
		segments[0] === 'api' &&
		segments[1] === 'projects' &&
		segments[2] === CONSOLE_PROJECT_ID &&
		segments[3] === 'auth'
	) {
		rest = segments.slice(4);
	}
	// /agents/<worker>/console/api/auth/<...>
	else if (
		segments[0] === 'agents' &&
		segments[2] === CONSOLE_PROJECT_ID &&
		segments[3] === 'api' &&
		segments[4] === 'auth'
	) {
		rest = segments.slice(5);
	}
	if (!rest) return false;

	const subPath = rest.join('/');
	return subPath === 'sign-up/email' || subPath === 'sign-in/social' || rest[0] === 'callback';
}

/**
 * The path segments the AGENT will see, not the ones the URL bar shows.
 *
 * The guard reads a raw pathname; the REST proxy rebuilds its target from a
 * route parameter SvelteKit has already decoded, then lets `new URL` normalise
 * it (agentProxyUrl). Those two disagree exactly where it matters:
 * `/auth/sign-up%2Femail` is ONE segment here and two by the time the agent
 * answers, and `/auth/./sign-up/email` loses its dot segment on the way. A
 * matcher that reads the raw path is therefore trivially side-stepped - the
 * same guard-versus-proxy gap that made an encoded traversal reach the
 * operator user list.
 *
 * Decoding repeatedly is safe here: over-decoding can only make this MATCH
 * more paths, and matching more claim-shaped paths is the safe direction.
 */
function normalizeSegments(pathname: string): string[] {
	let decoded = pathname;
	for (let pass = 0; pass < 3; pass += 1) {
		let next: string;
		try {
			next = decodeURIComponent(decoded);
		} catch {
			break; // Malformed escapes: keep what we have rather than throwing.
		}
		if (next === decoded) break;
		decoded = next;
	}

	// Resolves `.`, `..` and doubled slashes the way the proxy's URL parse will.
	const normalized = new URL(decoded, 'https://console.invalid').pathname;
	return normalized.split('/').filter(Boolean);
}

/**
 * Refuses an unproven first-run claim, or null to let the request through.
 *
 * Only ever refuses while the console has NO owner: once it is claimed these
 * same routes are ordinary sign-in and invited-teammate sign-up, and the
 * agent's own rules apply. That ordering is also what keeps the cost off the
 * hot path - a locked, claimed console pays one `/overview` read on the two or
 * three auth routes that reach here, and nothing anywhere else.
 */
export async function guardConsoleClaim(event: RequestEvent): Promise<Response | null> {
	if (!isConsoleClaimSurface(event.url.pathname)) return null;

	const state = await consoleSetupState(
		event.platform,
		event.cookies.get(CONSOLE_SETUP_COOKIE) ?? undefined,
		event.url.hostname
	);
	if (state.unlocked) return null;

	const owner = await consoleOwnerState(event.platform, event.url.origin);

	// Claimed already: nothing here is a claim, so nothing to gate.
	if (owner === 'claimed') return null;

	// Could not ASK is not "nobody owns this". Answering 403 would blame the
	// caller for an outage, and treating it as unclaimed would open an
	// ownership window every time the agent hiccups - so say so and let the
	// request be retried, exactly as the session guard does.
	if (owner === 'unavailable') {
		return Response.json(
			{ error: 'cannot verify console setup right now' },
			{ status: 503, headers: { 'Retry-After': '5' } }
		);
	}

	// An OAuth callback is a browser navigation; JSON would strand it on a
	// blank page. Bounce to the login page, which explains the lock.
	if (event.url.pathname.includes('/callback/')) {
		redirect(303, '/login?error=setup_locked');
	}

	return Response.json(
		{
			error:
				'console setup is locked - set CONSOLE_SETUP_TOKEN on this Worker, then unlock setup with it',
			code: 'setupLocked'
		},
		{ status: 403 }
	);
}
