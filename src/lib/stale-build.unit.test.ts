import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStaleModuleError } from './stale-build';

// The real wording each browser produced for the same missing chunk. The Chrome
// one is verbatim from the production Sentry event that prompted this
// (`_app/immutable/nodes/6.BqGzww-R.js`, 404 after a deploy).
const REAL_MESSAGES = [
	'Failed to fetch dynamically imported module: https://frostbase.dev/_app/immutable/nodes/6.BqGzww-R.js',
	'error loading dynamically imported module: https://frostbase.dev/_app/immutable/nodes/6.BqGzww-R.js',
	'Importing a module script failed.',
	'Unable to preload CSS for /_app/immutable/assets/0.D1VY6a1a.css',
	'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
	'Loading module from “https://frostbase.dev/_app/immutable/nodes/6.js” was blocked because of a disallowed MIME type (“text/html”).'
];

test('every browser wording for a missing chunk is recognised', () => {
	for (const message of REAL_MESSAGES) {
		assert.equal(isStaleModuleError(new TypeError(message)), true, message);
	}
});

test('the value does not have to be an Error', () => {
	assert.equal(isStaleModuleError(REAL_MESSAGES[0]), true);
	assert.equal(isStaleModuleError({ message: REAL_MESSAGES[0] }), true);
});

test('ordinary application errors are left alone', () => {
	// Anything matched here is silently dropped from Sentry once a deploy is in
	// flight, so the matcher must stay narrow.
	for (const error of [
		new Error('Failed to fetch'),
		new Error('NetworkError when attempting to fetch resource.'),
		new Error('load failed'),
		new Error('Cannot read properties of undefined (reading "id")'),
		new Error('Not found: /dashboard/nope'),
		new Error(''),
		null,
		undefined,
		{},
		42
	]) {
		assert.equal(isStaleModuleError(error), false, String(error));
	}
});
