/**
 * One-time Phase A backfill: stamp frostbase.dev's pre-organization
 * registry rows with the founder's personal org id, so flipping the console
 * to open sign-ups never exposes them (org_id NULL rows are visible to ANY
 * operator - correct for self-hosted installs, wrong for a public one).
 *
 * Getting the org id: deploy the Phase A agents + web worker, sign in at
 * frostbase.dev (the first identity lookup mints the personal org),
 * then read `organizations[0].id` from https://frostbase.dev/api/console/me.
 *
 * Usage, from the repository root:
 *   node scripts/backfill-org.mjs --org <orgId> [--env production] [--dry-run]
 *
 * Runs `wrangler d1 execute` against the REMOTE control-plane database of the
 * chosen environment. Self-hosted installs need none of this.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// Wrangler is invoked through its JS entrypoint, never `npx`: since Node 20.12
// execFileSync refuses to spawn a `.cmd` without a shell (EINVAL on Windows),
// and handing this SQL to a shell would need quoting we do not want to own.
// The bin is reached via the resolved main rather than a `wrangler/bin/...`
// subpath, which the package's `exports` map does not publish.
const wranglerBin = path.join(
	path
		.dirname(createRequire(import.meta.url).resolve('wrangler'))
		.replace(/([\\/]node_modules[\\/]wrangler)[\\/].*$/, '$1'),
	'bin',
	'wrangler.js'
);

const args = process.argv.slice(2);
const flag = (name) => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? null : (args[index + 1] ?? null);
};
const has = (name) => args.includes(`--${name}`);

const org = flag('org');
const env = flag('env') ?? 'production';
const dryRun = has('dry-run');

// The org id is interpolated into SQL (wrangler d1 execute has no bind
// params), so the charset gate is also the injection gate.
if (!org || !/^[A-Za-z0-9-]{8,64}$/.test(org)) {
	console.error('Pass --org <orgId> (8-64 chars of [A-Za-z0-9-]).');
	console.error('Find it at /api/console/me -> organizations[0].id after signing in.');
	process.exit(1);
}
if (!/^[a-z-]+$/.test(env)) {
	console.error(`Unexpected --env "${env}".`);
	process.exit(1);
}

const database =
	env === 'preview' ? 'cloudflarebase-control-plane-preview' : 'cloudflarebase-control-plane';

function d1(sql) {
	const output = execFileSync(
		process.execPath,
		[wranglerBin, 'd1', 'execute', database, '--env', env, '--remote', '--json', '--command', sql],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
	);
	return JSON.parse(output);
}

const pending = d1(`SELECT id FROM project WHERE org_id IS NULL`);
const rows = pending[0]?.results ?? [];
if (!rows.length) {
	console.log('Nothing to backfill - every registry row already has an owner.');
	process.exit(0);
}
console.log(`Unowned rows in ${database}:`);
for (const row of rows) console.log(`  ${row.id}`);

if (dryRun) {
	console.log(`\nDry run - would stamp ${rows.length} row(s) with org ${org}.`);
	process.exit(0);
}

d1(`UPDATE project SET org_id = '${org}' WHERE org_id IS NULL`);
const check = d1(`SELECT COUNT(*) AS remaining FROM project WHERE org_id IS NULL`);
console.log(
	`Stamped ${rows.length} row(s) with org ${org}; ${check[0]?.results?.[0]?.remaining ?? '?'} unowned remaining.`
);
