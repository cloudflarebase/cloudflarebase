import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { ensureProject, storageAdminObjectPath, storageBucketPath } from './helpers';

/**
 * The storage console pages ("Console pages").
 *
 * Files is the table-editor shape: a permanent bucket rail beside a full-bleed
 * browser whose breadcrumb walks the DELIMITED listing - folders being virtual,
 * derived at read time from flat keys, so descending one is a prefix change and
 * nothing is ever created.
 */

const UI_PROJECT = 'e2e-storage-ui';
const BUCKET = 'spec-ui';

test.describe('storage console', () => {
	// The chromium project sets no default Origin (only the api one does), and
	// SvelteKit's CSRF check forbids form content types - `text/plain` included
	// - on an origin-less request. Seeding here therefore sends one explicitly;
	// a real browser always would.
	const seedHeaders = (baseURL: string | undefined) => ({
		origin: baseURL ?? process.env.BASE_URL ?? 'http://localhost:8797',
		'content-type': 'text/plain'
	});

	test.beforeAll(async ({ request, baseURL }) => {
		await ensureProject(request, UI_PROJECT);
		const bucket = await request.put(storageBucketPath(UI_PROJECT, BUCKET), {
			data: {},
			headers: { origin: baseURL ?? 'http://localhost:8797' }
		});
		expect([200, 201], await bucket.text()).toContain(bucket.status());
		for (const key of ['readme.txt', 'photos/one.txt', 'photos/two.txt', 'photos/raw/three.txt']) {
			const put = await request.put(storageAdminObjectPath(UI_PROJECT, BUCKET, key), {
				data: `bytes for ${key}`,
				headers: seedHeaders(baseURL)
			});
			expect(put.ok(), await put.text()).toBeTruthy();
		}
	});

	test('the sidebar shows Storage now that it ships console pages', async ({ page }) => {
		await page.goto(`/dashboard/${UI_PROJECT}/storage`);
		// The registry emits the section from the manifest, so this is also the
		// check that `console.pages` is wired.
		await expect(page.getByTestId('nav-storage')).toBeVisible();
		// And it must no longer be advertised as unbuilt.
		await expect(page.getByTestId('nav-section-coming-soon')).toHaveCount(0);
	});

	test('the browser lists folders and files, and descends', async ({ page }) => {
		await page.goto(`/dashboard/${UI_PROJECT}/storage`);
		await expect(page.getByTestId('bucket-rail')).toBeVisible();
		await expect(page.getByTestId(`bucket-${BUCKET}`)).toBeVisible();

		// Root: one file, one folder - never the whole flat subtree.
		const rows = page.getByTestId('file-rows');
		await expect(rows.getByTestId('folder-row')).toHaveCount(1);
		await expect(rows.getByTestId('object-row')).toHaveCount(1);
		await expect(rows).toContainText('readme.txt');
		await expect(rows).toContainText('photos/');

		// Descend: the breadcrumb grows and the listing re-collapses a level in.
		await rows.getByTestId('folder-row').first().click();
		await expect(page.getByTestId('breadcrumb')).toContainText('photos');
		await expect(rows.getByTestId('object-row')).toHaveCount(2);
		await expect(rows.getByTestId('folder-row')).toHaveCount(1);

		// And back up via the breadcrumb.
		await page.getByTestId('breadcrumb').getByText(BUCKET).click();
		await expect(rows).toContainText('readme.txt');
	});

	test('an object opens a preview sheet that can mint a signed URL', async ({ page }) => {
		await page.goto(`/dashboard/${UI_PROJECT}/storage`);
		await page.getByTestId('file-rows').getByTestId('object-row').first().click();

		const sheet = page.getByTestId('object-sheet');
		await expect(sheet).toBeVisible();
		await expect(sheet).toContainText('readme.txt');

		await sheet.getByTestId('sign-url').click();
		const signed = sheet.getByTestId('signed-url');
		await expect(signed).toBeVisible();
		await expect(signed).toContainText('sig=');
	});

	test('deleting an object is confirmed, never a bare click', async ({
		page,
		request,
		baseURL
	}) => {
		const key = 'disposable.txt';
		await request.put(storageAdminObjectPath(UI_PROJECT, BUCKET, key), {
			data: 'delete me',
			headers: seedHeaders(baseURL)
		});
		await page.goto(`/dashboard/${UI_PROJECT}/storage`);

		await page.getByTestId('file-rows').getByText(key).click();
		await page.getByTestId('object-sheet').getByTestId('delete-object').click();
		// An AlertDialog stands between the click and the deletion.
		await expect(page.getByTestId('confirm-delete')).toBeVisible();
		await page.getByTestId('confirm-delete').click();

		await expect(page.getByTestId('file-rows')).not.toContainText(key);
	});

	test('uploading through the browser puts the file in the bucket', async ({ page, request }) => {
		const key = 'uploaded-by-ui.txt';
		await page.goto(`/dashboard/${UI_PROJECT}/storage`);

		// The primary action of the page, driven the way an operator drives it -
		// the console rides the same admin mirror customers' SDKs ride, so this
		// is also the check that no console-only upload path has grown.
		await page.getByTestId('upload-input').setInputFiles({
			name: key,
			mimeType: 'text/plain',
			buffer: Buffer.from('uploaded from the console')
		});
		await expect(page.getByTestId('file-rows')).toContainText(key);

		// And it is really in R2, not just in the table.
		const stored = await request.get(storageAdminObjectPath(UI_PROJECT, BUCKET, key));
		expect(stored.ok(), await stored.text()).toBeTruthy();
		expect(await stored.text()).toBe('uploaded from the console');

		await request.delete(storageAdminObjectPath(UI_PROJECT, BUCKET, key));
	});

	test('the Access page states each bucket config in plain words', async ({ page }) => {
		await page.goto(`/dashboard/${UI_PROJECT}/storage/access`);
		// One editor at a time behind a bucket rail: select before asserting.
		await page.getByTestId(`access-bucket-${BUCKET}`).click();
		const card = page.getByTestId(`access-card-${BUCKET}`);
		await expect(card).toBeVisible();
		// The default is auth/auth, and the sentence has to say so - the whole
		// point of the plain-English rendering.
		await expect(card).toContainText('signed-in');
		await expect(card).toContainText('not public');
	});

	test('the Access page EDITS access, and the change reaches the agent', async ({
		page,
		request,
		baseURL
	}) => {
		// A bucket of its own: the shared one is read by the listing tests, and a
		// mode flip mid-suite is exactly the kind of cross-test coupling that
		// makes a failure unreadable.
		const bucket = 'spec-access';
		const created = await request.put(storageBucketPath(UI_PROJECT, bucket), {
			data: {},
			headers: { origin: baseURL ?? 'http://localhost:8797' }
		});
		expect([200, 201], await created.text()).toContain(created.status());

		await page.goto(`/dashboard/${UI_PROJECT}/storage/access`);
		// The rail lists every bucket; the editor renders the SELECTED one.
		await page.getByTestId(`access-bucket-${bucket}`).click();
		const card = page.getByTestId(`access-card-${bucket}`);
		await expect(card).toBeVisible();

		// Nothing to save until something changes.
		await expect(card.getByTestId(`access-save-${bucket}`)).toBeDisabled();

		// Read: auth -> public. The sentence is rendered from the PENDING value,
		// so it answers "what will this become" before the save lands.
		await card.getByTestId(`access-read-${bucket}`).click();
		await page.getByRole('option', { name: 'public', exact: true }).click();
		await expect(card.getByTestId(`access-sentence-${bucket}`)).toContainText('Anyone can read');

		await card.getByTestId(`access-listing-${bucket}`).click();
		await card.getByTestId(`access-save-${bucket}`).click();
		await expect(card.getByTestId(`access-feedback-${bucket}`)).toContainText('Saved');

		// The agent is the authority on whether it saved, not the page.
		const config = await request.get(storageBucketPath(UI_PROJECT, bucket));
		const body = (await config.json()) as { bucket: { read: string; publicListing: boolean } };
		expect(body.bucket.read).toBe('public');
		expect(body.bucket.publicListing).toBe(true);

		// And it survives a reload rather than living in component state. The
		// selection resets to the first bucket, so re-select before reading.
		await page.reload();
		await page.getByTestId(`access-bucket-${bucket}`).click();
		await expect(page.getByTestId(`access-sentence-${bucket}`)).toContainText('Anyone can read');

		await request.delete(storageBucketPath(UI_PROJECT, bucket));
	});

	test('a bucket can be deleted, behind a typed-name confirm', async ({
		page,
		request,
		baseURL
	}) => {
		const bucket = 'spec-drop';
		await request.put(storageBucketPath(UI_PROJECT, bucket), {
			data: {},
			headers: { origin: baseURL ?? 'http://localhost:8797' }
		});
		const put = await request.put(storageAdminObjectPath(UI_PROJECT, bucket, 'doomed.txt'), {
			data: 'bytes that go with it',
			headers: seedHeaders(baseURL)
		});
		expect(put.ok(), await put.text()).toBeTruthy();

		await page.goto(`/dashboard/${UI_PROJECT}/storage`);
		await expect(page.getByTestId(`bucket-${bucket}`)).toBeVisible();

		await page.getByTestId(`bucket-menu-${bucket}`).click();
		await page.getByTestId(`delete-bucket-${bucket}`).click();

		// The dialog says what goes with it, and the button stays dead until the
		// name is typed - a bucket delete takes every object in it.
		const dialog = page.getByTestId('delete-bucket-dialog');
		await expect(dialog).toContainText('1 object');
		await expect(page.getByTestId('confirm-delete-bucket')).toBeDisabled();
		await page.getByTestId('delete-bucket-input').fill('wrong-name');
		await expect(page.getByTestId('confirm-delete-bucket')).toBeDisabled();
		await page.getByTestId('delete-bucket-input').fill(bucket);
		await page.getByTestId('confirm-delete-bucket').click();

		await expect(page.getByTestId(`bucket-${bucket}`)).toHaveCount(0);

		// Gone in the agent too, objects and all.
		const after = await request.get(storageBucketPath(UI_PROJECT, bucket));
		expect(after.status()).toBe(404);
		const object = await request.get(storageAdminObjectPath(UI_PROJECT, bucket, 'doomed.txt'));
		expect(object.ok()).toBeFalsy();
	});

	test('the Integration page shows the client snippet', async ({ page }) => {
		await page.goto(`/dashboard/${UI_PROJECT}/storage/integration`);
		const panel = page.getByTestId('storage-integration');
		await expect(panel).toContainText('@frostbase/storage/client');
		await expect(panel).toContainText('createSignedUrl');
		// The shared code-sample component, so the snippets get the same tabs,
		// copy button, and syntax highlighting every other Integration tab has.
		await expect(panel.getByTestId('copy-integration')).toBeVisible();
		// One name for the server credential across all three agents' Integration
		// tabs - it was 'Server' here and 'Service key' on auth and db.
		await panel.getByRole('tab', { name: 'Admin service key' }).click();
		await expect(panel).toContainText('@frostbase/storage/admin');
		// And the page shape matches auth and db: base URL, samples, caveat.
		await expect(panel).toContainText('Storage base URL');
	});

	test('an unknown tool page is a 404, never an empty workspace', async ({ page }) => {
		const response = await page.goto(`/dashboard/${UI_PROJECT}/storage/nonsense`);
		expect(response?.status()).toBe(404);
	});
});
