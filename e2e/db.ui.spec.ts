import { expect, test, type Page } from '@playwright/test';
import { ensureProject } from './helpers';

/**
 * Database tab (frontend). Uses its own project so collection churn never
 * touches the seed's exactly-asserted counts, and unique collection names so
 * reused local stacks stay idempotent.
 */
const DB_UI_PROJECT = 'e2e-db-ui';

function uniqueCollection(prefix: string): string {
	return `${prefix}${Date.now().toString(36)}`;
}

async function gotoDbPage(page: Page, projectId: string) {
	await page.goto(`/dashboard/${projectId}/db`);
	await expect(page.getByTestId('db-page')).toHaveAttribute('data-hydrated', 'true');
}

async function createCollection(page: Page, name: string) {
	const input = page.locator('#new-collection-name');
	await input.fill(name);
	await page.getByTestId('db-create-collection').getByRole('button', { name: 'Create' }).click();
	await expect(page.getByTestId(`db-collection-${name}`)).toBeVisible();
	// The row appears mid-flight (the refetch inside the save), but the form
	// clears itself only once the whole save settles. Without waiting for
	// that, the next thing typed here is wiped by the late clear.
	await expect(input).toHaveValue('');
}

test.describe('database page (frontend)', () => {
	// Operator surfaces answer only for registered ids.
	test.beforeAll(async ({ request }) => {
		await ensureProject(request, DB_UI_PROJECT);
	});

	test('sidebar and overview expose the database surfaces', async ({ page }) => {
		await page.goto(`/dashboard/${DB_UI_PROJECT}`);
		await expect(page.getByTestId('product-db')).toBeVisible();

		await page.getByTestId('nav-db').click();
		await expect(page.getByTestId('db-page')).toHaveAttribute('data-hydrated', 'true');
		// A virgin project renders the empty state, not the table - the create
		// form is the surface that is always there.
		await expect(page.getByTestId('db-create-collection')).toBeVisible();
	});

	test('connects to the db agent for live updates', async ({ page }) => {
		await gotoDbPage(page, DB_UI_PROJECT);

		// On the local prod-mirroring stack the WebSocket passthrough is verified
		// to work, so demand true realtime; remote stacks may fall back to polling.
		const expected = process.env.BASE_URL ? /realtime|polling/ : 'realtime';
		await expect(page.getByTestId('connection-status')).toHaveText(expected);
	});

	test('creating a collection and a document updates the browser without reload', async ({
		page
	}) => {
		const collection = uniqueCollection('c');
		await gotoDbPage(page, DB_UI_PROJECT);
		await createCollection(page, collection);

		await page.getByTestId(`db-collection-${collection}`).click();
		await page.getByTestId('db-add-document').click();

		const editor = page.getByTestId('db-doc-editor');
		await editor.getByPlaceholder('auto-generated').fill('ui-doc-1');
		await editor.locator('textarea').fill('{"text":"from the ui","done":false}');
		await editor.getByRole('button', { name: 'Save document' }).click();

		await expect(page.getByTestId('db-documents-table').getByText('ui-doc-1')).toBeVisible();

		// The child reports its count (debounced ~2s) and state sync moves the
		// stat without a reload.
		await expect(page.getByTestId('db-stat-documents').getByTestId('stat-value')).not.toHaveText(
			'0',
			{ timeout: 15_000 }
		);
	});

	test('creating over an existing collection or document is refused', async ({ page }) => {
		const collection = uniqueCollection('g');
		await gotoDbPage(page, DB_UI_PROJECT);
		await createCollection(page, collection);

		// The agent route is an upsert (the Access tab reuses it), so the CREATE
		// form guards locally - re-creating must not silently reconfigure.
		await page.locator('#new-collection-name').fill(collection);
		await page.getByTestId('db-create-collection').getByRole('button', { name: 'Create' }).click();
		await expect(page.getByTestId('db-create-error')).toContainText('already exists');

		// Same for documents: ADD refuses a taken id, EDIT still replaces.
		await page.getByTestId(`db-collection-${collection}`).click();
		await page.getByTestId('db-add-document').click();
		const editor = page.getByTestId('db-doc-editor');
		await editor.getByPlaceholder('auto-generated').fill('dup-doc');
		await editor.locator('textarea').fill('{"text":"first"}');
		await editor.getByRole('button', { name: 'Save document' }).click();
		await expect(page.getByTestId('db-documents-table').getByText('dup-doc')).toBeVisible();

		await page.getByTestId('db-add-document').click();
		await editor.getByPlaceholder('auto-generated').fill('dup-doc');
		await editor.locator('textarea').fill('{"text":"second"}');
		await editor.getByRole('button', { name: 'Save document' }).click();
		await expect(page.getByTestId('db-doc-error')).toContainText('already exists');

		// The original survived the refused overwrite.
		await expect(page.getByTestId('db-documents-table').getByText(/first/)).toBeVisible();
	});

	test('malformed JSON in the document editor surfaces inline, not as a crash', async ({
		page
	}) => {
		const collection = uniqueCollection('e');
		await gotoDbPage(page, DB_UI_PROJECT);
		await createCollection(page, collection);

		await page.getByTestId(`db-collection-${collection}`).click();
		await page.getByTestId('db-add-document').click();

		const editor = page.getByTestId('db-doc-editor');
		await editor.locator('textarea').fill('{not json');
		await editor.getByRole('button', { name: 'Save document' }).click();
		await expect(page.getByTestId('db-doc-error')).toBeVisible();
	});

	test('editing a document updates it in place with the id locked', async ({ page }) => {
		const collection = uniqueCollection('m');
		await gotoDbPage(page, DB_UI_PROJECT);
		await createCollection(page, collection);
		await page.getByTestId(`db-collection-${collection}`).click();

		await page.getByTestId('db-add-document').click();
		const editor = page.getByTestId('db-doc-editor');
		await editor.getByPlaceholder('auto-generated').fill('edit-me');
		await editor.locator('textarea').fill('{"text":"before"}');
		await editor.getByRole('button', { name: 'Save document' }).click();
		await expect(page.getByTestId('db-documents-table').getByText('edit-me')).toBeVisible();

		// PUT is an upsert, so the id is locked while editing - a changed id
		// would create a duplicate instead of renaming.
		await page.getByTestId('db-edit-edit-me').click();
		await expect(editor.getByPlaceholder('auto-generated')).toBeDisabled();
		await editor.locator('textarea').fill('{"text":"after"}');
		await editor.getByRole('button', { name: 'Save document' }).click();
		await expect(page.getByTestId('db-documents-table').getByText(/after/)).toBeVisible();
	});

	test('deleting a collection requires typing its name back', async ({ page }) => {
		const collection = uniqueCollection('d');
		await gotoDbPage(page, DB_UI_PROJECT);
		await createCollection(page, collection);
		await page.getByTestId(`db-collection-${collection}`).click();

		// Destructive/secondary actions live in the three-dots menu.
		await page.getByTestId('db-actions-menu').click();
		await page.getByTestId('db-delete-collection').click();
		const dialog = page.getByTestId('db-delete-panel');
		await expect(dialog.getByRole('button', { name: 'Delete forever' })).toBeDisabled();
		await dialog.getByTestId('db-delete-confirm').fill(collection);
		await dialog.getByRole('button', { name: 'Delete forever' }).click();
		await expect(page.getByTestId(`db-collection-${collection}`)).not.toBeVisible();
	});

	test('access mode changes apply and survive a reload', async ({ page }) => {
		const collection = uniqueCollection('a');
		await gotoDbPage(page, DB_UI_PROJECT);
		await createCollection(page, collection);

		await page.getByTestId('nav-db-access').click();
		const row = page.getByTestId(`db-access-${collection}`);
		// The create form defaults read access to `public`, so pick a DIFFERENT
		// mode - Apply only enables once an actual edit is pending.
		await row.getByLabel(`Read access for ${collection}`).click();
		await page.getByRole('option', { name: 'auth' }).click();
		await row.getByRole('button', { name: 'Apply' }).click();
		await expect(row.getByText('Saved')).toBeVisible();

		// Access is its own page now, so the reload lands straight back on it.
		await page.reload();
		await expect(page.getByTestId('db-page')).toHaveAttribute('data-hydrated', 'true');
		await expect(
			page.getByTestId(`db-access-${collection}`).getByLabel(`Read access for ${collection}`)
		).toHaveText('auth');
	});

	test('permission and rules editors round-trip through the access tab', async ({
		page,
		request
	}) => {
		// The permission dropdowns are fed from the auth roles registry, so a
		// key must be granted to a role before it can be required here.
		const defineRole = await request.put(`/api/projects/${DB_UI_PROJECT}/admin/roles`, {
			data: { roles: [{ name: 'writer', permissions: ['posts:write'] }] }
		});
		expect(defineRole.ok(), await defineRole.text()).toBeTruthy();

		const collection = uniqueCollection('r');
		await gotoDbPage(page, DB_UI_PROJECT);
		await createCollection(page, collection);

		await page.getByTestId('nav-db-access').click();
		const row = page.getByTestId(`db-access-${collection}`);

		// The create form defaults write access to owner, so the write
		// permission select is enabled; pick the granted key.
		await row.getByTestId(`db-perm-write-${collection}`).click();
		await page.getByRole('option', { name: 'posts:write' }).click();
		await row.getByRole('button', { name: 'Apply' }).click();
		await expect(row.getByText('Saved')).toBeVisible();

		// Rules dialog: the collection is empty, so the generic template seeds
		// the editor (collections with documents get their shape inferred);
		// save it and see the rule count badge.
		await row.getByTestId(`db-rules-${collection}`).click();
		const rules = page.getByTestId('db-rules-panel');
		await expect(rules.getByTestId('db-rules-json')).toBeVisible();
		await rules.getByTestId('db-rules-save').click();
		await expect(page.getByTestId(`db-rules-${collection}`)).toHaveText('1 rule');

		// Both survive a reload - they came back from the agent, not the UI.
		await page.reload();
		await expect(page.getByTestId('db-page')).toHaveAttribute('data-hydrated', 'true');
		await expect(page.getByTestId(`db-perm-write-${collection}`)).toHaveText('posts:write');
		await expect(page.getByTestId(`db-rules-${collection}`)).toHaveText('1 rule');
	});

	test('the rollback dialog explains unsupported environments up front', async ({ page }) => {
		const collection = uniqueCollection('t');
		await gotoDbPage(page, DB_UI_PROJECT);
		await createCollection(page, collection);
		await page.getByTestId(`db-collection-${collection}`).click();

		await page.getByTestId('db-rollback').click();
		const dialog = page.getByTestId('db-rollback-panel');
		// The submit never arms without a resolved target and the typed name.
		await expect(dialog.getByTestId('db-rollback-submit')).toBeDisabled();

		if (!process.env.BASE_URL) {
			// Local dev has no durable change log: the dialog says so instead of
			// offering a form that would 501 after the fact, and stays disarmed.
			await expect(dialog.getByTestId('db-rollback-unsupported')).toBeVisible();
			await expect(dialog.getByTestId('db-rollback-submit')).toBeDisabled();
		} else {
			// Deployed stacks get the D1-style flow: Date resolves the closest
			// available bookmark; Bookmark lists captured points.
			await expect(dialog.getByTestId('db-rollback-mode-date')).toBeVisible();
			await dialog.getByTestId('db-rollback-mode-bookmark').click();
			await expect(dialog.getByTestId('db-capture-point')).toBeVisible();
		}
	});

	test('declaring a table, inserting rows, and schema refusals work from the Tables tab', async ({
		page
	}) => {
		const table = uniqueCollection('tt');
		await gotoDbPage(page, DB_UI_PROJECT);
		await page.getByTestId('nav-db-tables').click();

		// Declare: one required text column through the schema designer sheet.
		await page.getByTestId('db-new-table').click();
		await page.getByTestId('db-new-table-name').fill(table);
		await page.getByTestId('db-column-name-0').fill('title');
		await page.getByTestId('db-declare-submit').click();
		await expect(page.getByTestId(`db-table-${table}`)).toBeVisible();

		// Browse and insert: the editor renders one typed field per column.
		await page.getByTestId(`db-table-${table}`).click();
		await page.getByTestId('db-add-row').click();
		const editor = page.getByTestId('db-row-editor');
		await editor.getByTestId('db-row-field-title').fill('from the ui');
		await editor.getByTestId('db-row-save').click();
		await expect(page.getByTestId('db-rows-table').getByText('from the ui')).toBeVisible();

		// The declared schema refuses a wrong-typed value with the agent's issue;
		// the JSON escape hatch is what can express one.
		await page.getByTestId('db-add-row').click();
		await editor.getByTestId('db-row-mode-json').click();
		await editor.getByTestId('db-row-json').fill('{"title":123}');
		await editor.getByTestId('db-row-save').click();
		await expect(page.getByTestId('db-row-error')).toContainText('must be a text');
	});

	test('deleting a row is confirmed before anything is erased', async ({ page }) => {
		const table = uniqueCollection('tx');
		await gotoDbPage(page, DB_UI_PROJECT);
		await page.getByTestId('nav-db-tables').click();

		await page.getByTestId('db-new-table').click();
		await page.getByTestId('db-new-table-name').fill(table);
		await page.getByTestId('db-column-name-0').fill('title');
		await page.getByTestId('db-declare-submit').click();
		await expect(page.getByTestId(`db-table-${table}`)).toBeVisible();

		await page.getByTestId(`db-table-${table}`).click();
		await page.getByTestId('db-add-row').click();
		const editor = page.getByTestId('db-row-editor');
		await editor.getByTestId('db-row-field-title').fill('doomed row');
		await editor.getByTestId('db-row-save').click();

		const grid = page.getByTestId('db-rows-table');
		await expect(grid.getByText('doomed row')).toBeVisible();
		const row = grid.locator('tr[data-testid^="db-row-"]').first();
		await row.getByLabel('Delete row').click();

		// Cancelling leaves the row alone - the click alone never deletes.
		const confirm = page.getByTestId('db-delete-rows-panel');
		await expect(confirm).toContainText('doomed row');
		await confirm.getByRole('button', { name: 'Cancel' }).click();
		await expect(grid.getByText('doomed row')).toBeVisible();

		await row.getByLabel('Delete row').click();
		await page.getByTestId('db-delete-rows-submit').click();
		await expect(page.getByTestId('db-rows-empty')).toBeVisible();
	});

	test('deleting a table requires typing its name back', async ({ page }) => {
		const table = uniqueCollection('td');
		await gotoDbPage(page, DB_UI_PROJECT);
		await page.getByTestId('nav-db-tables').click();

		await page.getByTestId('db-new-table').click();
		await page.getByTestId('db-new-table-name').fill(table);
		await page.getByTestId('db-column-name-0').fill('note');
		await page.getByTestId('db-declare-submit').click();
		await expect(page.getByTestId(`db-table-${table}`)).toBeVisible();

		await page.getByTestId(`db-table-${table}`).click();
		await page.getByTestId('db-table-actions').click();
		await page.getByTestId('db-delete-table').click();
		const dialog = page.getByTestId('db-delete-table-panel');
		await expect(dialog.getByTestId('db-delete-table-submit')).toBeDisabled();
		await dialog.getByTestId('db-delete-table-confirm').fill(table);
		await dialog.getByTestId('db-delete-table-submit').click();
		await expect(page.getByTestId(`db-table-${table}`)).not.toBeVisible();
	});

	test('the table rollback dialog explains unsupported environments up front', async ({ page }) => {
		const table = uniqueCollection('tr');
		await gotoDbPage(page, DB_UI_PROJECT);
		await page.getByTestId('nav-db-tables').click();

		await page.getByTestId('db-new-table').click();
		await page.getByTestId('db-new-table-name').fill(table);
		await page.getByTestId('db-column-name-0').fill('note');
		await page.getByTestId('db-declare-submit').click();
		await expect(page.getByTestId(`db-table-${table}`)).toBeVisible();

		// The workspace mounts the same shared dialog the collections browser
		// uses, pointed at the table's own admin base.
		await page.getByTestId(`db-table-${table}`).click();
		await page.getByTestId('db-table-actions').click();
		await page.getByTestId('db-table-rollback').click();
		const dialog = page.getByTestId('db-rollback-panel');
		await expect(dialog.getByTestId('db-rollback-submit')).toBeDisabled();
		if (!process.env.BASE_URL) {
			await expect(dialog.getByTestId('db-rollback-unsupported')).toBeVisible();
		} else {
			await expect(dialog.getByTestId('db-rollback-mode-date')).toBeVisible();
		}
	});

	test('the replication tab lights up a region after a routed read', async ({ page, request }) => {
		const collection = uniqueCollection('rp');
		await gotoDbPage(page, DB_UI_PROJECT);
		await createCollection(page, collection);

		// Replication defaults to auto, so a region-routed read is all it takes
		// to materialize a replica. Seed a document through the operator surface,
		// then read it through the hot path with the env.test region override.
		const seeded = await request.put(
			`/api/projects/${DB_UI_PROJECT}/db/admin/collections/${collection}/documents/rep-doc-1`,
			{ data: { data: { title: 'replicate me' } } }
		);
		expect(seeded.ok(), await seeded.text()).toBeTruthy();
		const routed = await request.get(
			`/api/projects/${DB_UI_PROJECT}/db/collections/${collection}/documents/rep-doc-1`,
			{ headers: { 'x-cfb-region': 'weur' } }
		);
		expect(routed.ok(), await routed.text()).toBeTruthy();

		await page.getByTestId('nav-db-replication').click();
		await expect(page.getByTestId('db-replication-map')).toBeVisible();
		if (!process.env.BASE_URL) {
			// The override header only exists on the env.test stack; deployed
			// targets route by real geography, so the region is theirs to pick.
			await expect(page.getByTestId('db-replication-region-weur')).toBeVisible({
				timeout: 15_000
			});
		}
		await expect(
			page.getByTestId('db-replication-stat-regions').getByTestId('stat-value')
		).not.toHaveText('0', { timeout: 15_000 });
	});

	test('integration snippets address this project', async ({ page }) => {
		await gotoDbPage(page, DB_UI_PROJECT);
		await page.getByTestId('nav-db-integration').click();

		// One snippet renders at a time (shared CodeExamples component), so
		// assert each behind its own pill.
		const integration = page.getByTestId('db-integration');
		await expect(integration).toContainText(`/api/projects/${DB_UI_PROJECT}/db`);
		await integration.getByRole('tab', { name: 'Client SDK' }).click();
		await expect(integration).toContainText('@frostbase/db/client');
		await integration.getByRole('tab', { name: 'Raw WebSocket' }).click();
		await expect(integration).toContainText(`/agents/db-agent/${DB_UI_PROJECT}/collections`);
	});
});
