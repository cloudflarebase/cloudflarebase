import { expect, test } from '@playwright/test';

/**
 * What a stranger's chat client renders when someone pastes a Frostbase
 * URL.
 *
 * `/dashboard` on a demo deployment hands an anonymous visitor a throwaway
 * project - and a link-preview fetcher is an anonymous visitor. With no
 * `og:title` on the console, every unfurler fell back to the document title, so
 * sharing `frostbase.dev/dashboard` previewed as
 * "demo-19a63aad9478 · Project Overview · Frostbase": a card naming a
 * stranger's throwaway project, which the demo TTL erases days later.
 *
 * `noindex` does not help. It governs search engines, and an unfurler is not
 * one - WhatsApp, iMessage, Slack and the rest ignore robots directives
 * entirely. So the assertion here is on the MARKUP, not on the header.
 *
 * The WhatsApp case is deliberately the one exercised: it is a real fetcher
 * whose user-agent carries none of the crawler words, which is exactly how the
 * bug survived the crawler guard that was supposed to have fixed this.
 */

const UNFURLERS = {
	// Recognised as automated: redirected away before any project is minted.
	whatsapp: 'WhatsApp/2.23.20.0',
	facebook: 'facebookexternalhit/1.1',
	// NOT recognisable - iMessage sends an ordinary Safari user-agent. This is
	// the case that proves the fix cannot rest on sniffing.
	imessage:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
};

/** The demo id shape the console mints - what must never reach a share card. */
const DEMO_ID = /demo-[a-f0-9]{12,20}/;

test.describe('link previews', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	for (const [client, userAgent] of Object.entries(UNFURLERS)) {
		test(`a ${client} unfurl of /dashboard never names a demo project`, async ({ request }) => {
			const response = await request.get('/dashboard', {
				headers: { 'user-agent': userAgent },
				maxRedirects: 5
			});
			expect(response.ok(), await response.text()).toBeTruthy();
			const html = await response.text();

			// The card itself: whatever page the fetcher landed on, the Open Graph
			// it reads describes the product.
			const og = (property: string) =>
				html.match(
					new RegExp(`<meta[^>]+property="${property}"[^>]+content="([^"]*)"`, 'i')
				)?.[1] ??
				html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${property}"`, 'i'))?.[1];

			expect(og('og:title'), 'og:title must exist, or unfurlers fall back to <title>').toBeTruthy();
			expect(og('og:title')).not.toMatch(DEMO_ID);
			expect(og('og:url')).not.toMatch(DEMO_ID);
			expect(og('og:description') ?? '').not.toMatch(DEMO_ID);

			// And nothing else in the head leaks it either - `meta[name=description]`
			// and `link[rel=canonical]` are both fallbacks real clients reach for
			// when the Open Graph is thin.
			//
			// `<title>` is the ONE deliberate exception, so it is excised before the
			// sweep rather than excluded by a narrower assertion: the tab belongs to
			// the operator looking at it, and every unfurler in use prefers og:title
			// when it exists - which, since this fix, it always does.
			const head = html.slice(0, html.indexOf('</head>') + 1 || html.length);
			expect(
				head.replace(/<title>[\s\S]*?<\/title>/gi, ''),
				'no demo project id anywhere in the head but the browser tab title'
			).not.toMatch(DEMO_ID);
		});
	}

	test('a console page still titles itself for the browser tab', async ({ request }) => {
		// The fix suppresses page-specific OPEN GRAPH, not the document title:
		// the tab is for the operator looking at it, and naming the project there
		// is the useful thing to do.
		const response = await request.get('/dashboard/demo-a1b2c3d4e5f6a7b8c9d0');
		expect(response.ok()).toBeTruthy();
		const html = await response.text();
		expect(html).toMatch(/<title>demo-a1b2c3d4e5f6a7b8c9d0[^<]*<\/title>/);
	});

	test('the console is still noindex for search engines', async ({ request }) => {
		// Unchanged behaviour, asserted here so the two halves stay together:
		// the header covers search, the markup covers unfurlers.
		const response = await request.get('/dashboard/demo-a1b2c3d4e5f6a7b8c9d0');
		expect(response.headers()['x-robots-tag']).toContain('noindex');
	});

	test('the marketing page keeps its own product card', async ({ request }) => {
		// The suppression must not have leaked outside the console - and the
		// landing page must not end up with two og:title tags either.
		const response = await request.get('/');
		expect(response.ok()).toBeTruthy();
		const html = await response.text();
		const titles = html.match(/<meta[^>]+property="og:title"/gi) ?? [];
		expect(titles, 'exactly one og:title - duplicates are worse than none').toHaveLength(1);
		expect(html).toMatch(/<link rel="canonical" href="https:\/\/frostbase\.dev\/"/);
	});
});
