/**
 * Records-ready product demo. Two modes over the same preparation:
 *
 *   --live   (`npm run demo:live`)  seed the project, keep real auth traffic
 *            flowing, open a clean browser - and then get out of the way. YOU
 *            drive: click, narrate, go wherever you want. Nothing is
 *            choreographed, but the dashboard is never static, because the
 *            generator keeps signing users in behind you.
 *
 *   default  the fully choreographed tour with an on-screen cursor. You only
 *            record the screen.
 *
 * Both modes seed demo users, backfill 90 days of local analytics, and run the
 * background traffic generator. The tour then takes the mouse; --live hands it
 * to you.
 *
 * The tour beats, in order - the whole product, told as one story:
 *   1. Landing -> one click -> a real backend, no signup.
 *   2. AUTH: the copilot is asked up front (Workers AI reasons while the rest
 *      plays), live counters, the 90-day chart.
 *   3. A real account created on camera in the playground - zero code, real
 *      session and token. Answer 1 lands; its suggestion fires question 2.
 *   4. Roles: create `editor`, grant a permission, assign it to THAT user, so
 *      the permission rides into their JWT. Answer 2 lands.
 *   5. DATABASE: create a collection, then set who may read and write it -
 *      per-collection security that reads as a plain-English sentence.
 *   6. Documents: type one, watch two more land out of band and an upvote
 *      re-rank the open table with no refresh (live queries), then the SDK
 *      snippet that does the same in five lines.
 *   7. Point-in-time recovery: 30 days, per collection.
 *   8. A second collection, then the finale: ask the copilot about the
 *      database just built - ONE assistant orchestrating BOTH agents - with
 *      the generated API reference playing while it reads.
 *
 * Every tour take starts from the same state (`resetDemoData`): the role
 * registry returns to its baseline, both demo collections are dropped, and the
 * demo chat cap is cleared, so the create flows - which refuse existing names
 * and ids - always take the clean path on camera. --live does the opposite for
 * the database: it SEEDS posts and comments, because a page you might walk onto
 * unannounced should already have something in it.
 *
 *   node scripts/demo-video.mjs            # full recording run (fullscreen)
 *   node scripts/demo-video.mjs --live     # seeded + live, you drive
 *   node scripts/demo-video.mjs --check    # fast headless validation run
 *
 * Flags:
 *   --live             seed and generate traffic, then hand over the browser
 *   --start <path>     where --live opens (default `/`, the landing page, so
 *                      the one-click CTA is available on camera)
 *   --no-browser       --live only: prepare and generate traffic, but launch
 *                      nothing - use your own browser (see the printed URL)
 *   --fresh-db         --live only: drop the demo collections instead of
 *                      seeding them, for creating them yourself on camera
 *   --base <url>       target stack (default http://localhost:5173)
 *   --project <id>     project id (default demo-a3f8c2d4e5b6a7f80912)
 *   --speed <x>        pacing multiplier, lower = faster (default 1)
 *   --windowed         lock the page LAYOUT to 1920x1080 in a window. The
 *                      window itself can be smaller (Windows scaling/taskbar
 *                      clamp it) - set the OBS canvas to 1920x1080 and
 *                      stretch the window capture. On a 1080p display,
 *                      default fullscreen is a pixel-perfect 1920x1080.
 *   --dark             record in dark mode (default is light)
 *   --no-chat          skip the Workers AI copilot scenes
 *   --chat             include the AI scenes during --check (full rehearsal)
 *   --skip-backfill / --force-backfill   control the D1 analytics backfill
 *   --shots <dir>      save a screenshot after each scene
 *
 * Requires the dev stack (`npm run dev`); the script starts it if it is not
 * already listening. Rate limits in env local are 10 sign-ups + 10 sign-ins
 * + 20 guest sessions per minute - seeding and traffic stay inside that.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = opt('--base', 'http://localhost:5173').replace(/\/$/, '');
const PROJECT = opt('--project', 'demo-a3f8c2d4e5b6a7f80912');
const CHECK = flag('--check');
/** Seed + live traffic, no choreography - the operator drives the browser. */
const LIVE = flag('--live');
const SPEED = Number(opt('--speed', CHECK ? '0.12' : '1'));
const SHOTS = opt('--shots', '');
/** Recorded theme; light by default, `--dark` for the old look. */
const THEME = flag('--dark') ? 'dark' : 'light';
// --check skips the AI scenes unless --chat is added for a full rehearsal.
const NO_CHAT = flag('--no-chat') || (CHECK && !flag('--chat'));
const IS_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(BASE);
/** Only ids matching the /dashboard cookie pattern survive the CTA redirect. */
const DEMO_PATTERN = /^demo-[a-f0-9]{20}$/;

const log = (msg) => console.log(`[demo] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Choreography pause, scaled so --check runs fast. */
const pace = (ms) => sleep(Math.max(30, ms * SPEED));

/** Deterministic PRNG so the backfill is stable across runs. */
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick(rand, weighted) {
	const total = weighted.reduce((sum, [, w]) => sum + w, 0);
	let roll = rand() * total;
	for (const [value, weight] of weighted) {
		roll -= weight;
		if (roll <= 0) return value;
	}
	return weighted[0][0];
}

const COUNTRIES = [
	['US', 30],
	['DE', 12],
	['GB', 10],
	['IN', 10],
	['JP', 8],
	['BR', 7],
	['FR', 6],
	['CA', 5],
	['AU', 4],
	['NL', 3],
	['SE', 3],
	['SG', 2]
];
const PROVIDERS = [
	['credential', 7],
	['google', 2],
	['github', 1]
];
const DOMAINS = [
	['gmail.com', 4],
	['example.com', 3],
	['outlook.com', 2],
	['proton.me', 1]
];

const ROSTER = [
	'Ava Martinez',
	'Liam Oconnor',
	'Sofia Rossi',
	'Noah Kim',
	'Maya Patel',
	'Lucas Weber',
	'Emma Johansson',
	'Kenji Tanaka',
	'Zoe Laurent',
	'Diego Fernandez',
	'Amara Okafor',
	'Felix Novak',
	'Ines Almeida',
	'Omar Haddad',
	'Freya Nielsen',
	'Marco Ricci',
	'Priya Sharma',
	'Jonas Berg'
].map((name) => ({
	name,
	email: `${name
		.toLowerCase()
		.replace(/[^a-z ]/g, '')
		.replace(/ /g, '.')}@example.com`,
	password: 'Cloudbase-demo-2026'
}));

const FRESH_NAMES = [
	'Nina Alvarez',
	'Theo Lindqvist',
	'Lea Fontaine',
	'Ravi Menon',
	'Hana Suzuki',
	'Carlos Duarte',
	'Greta Keller',
	'Sam Whitfield',
	'Aisha Bello',
	'Mateo Silva'
];

// ---------------------------------------------------------------------------
// Stack management
// ---------------------------------------------------------------------------

async function isUp(url) {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
		return res.status < 500;
	} catch {
		return false;
	}
}

let devProcess = null;

async function ensureStack() {
	if (await isUp(`${BASE}/`)) {
		log(`stack already running at ${BASE}`);
		return;
	}
	if (!IS_LOCAL) throw new Error(`${BASE} is not reachable`);
	const root = path.resolve(import.meta.dirname, '..');
	// Capture the stack's output instead of discarding it: worker-side
	// failures (a copilot 502, an agent error) print there, and a stack we
	// started with stdio 'ignore' makes them unrecoverable - the logs exist
	// nowhere else, since local dev has no Sentry DSN by design.
	const logPath = path.join(root, '.wrangler', 'demo-dev.log');
	fs.mkdirSync(path.dirname(logPath), { recursive: true });
	const devLog = fs.openSync(logPath, 'a');
	log(`dev stack not running - starting \`npm run dev\` (output: ${logPath})`);
	devProcess = spawn('npm', ['run', 'dev'], {
		cwd: root,
		shell: true,
		stdio: ['ignore', devLog, devLog],
		detached: false
	});
	for (let i = 0; i < 120; i++) {
		await sleep(2000);
		if (await isUp(`${BASE}/`)) {
			log('dev stack is up');
			await sleep(2000);
			return;
		}
	}
	throw new Error('dev stack did not come up on time');
}

// ---------------------------------------------------------------------------
// Analytics backfill (local D1 mirror only)
// ---------------------------------------------------------------------------

function buildBackfillSql() {
	const rand = mulberry32(20260721);
	const now = Date.now();
	const day = 86_400_000;
	const rows = [];
	const subjects = [];

	for (let i = 1; i <= 26; i++) {
		// Bias creation toward recent days so the 90-day chart shows growth.
		const createdDaysAgo = Math.min(88, Math.floor(88 * (1 - Math.sqrt(rand())) + rand() * 10));
		subjects.push({
			id: `demo-user-${String(i).padStart(2, '0')}`,
			provider: pick(rand, PROVIDERS),
			country: pick(rand, COUNTRIES),
			domain: pick(rand, DOMAINS),
			createdDaysAgo,
			activityRate: 0.15 + rand() * 0.45
		});
	}

	let session = 0;
	for (const s of subjects) {
		const createdAt = now - s.createdDaysAgo * day + Math.floor(rand() * day * 0.8);
		rows.push([PROJECT, createdAt, 'user.created', s.country, s.provider, s.id, 'none', s.domain]);
		rows.push([
			PROJECT,
			createdAt + 900,
			'session.created',
			s.country,
			s.provider,
			s.id,
			`demo-bf-${++session}`,
			s.domain
		]);
		rows.push([
			PROJECT,
			createdAt + 900,
			'user.active',
			s.country,
			s.provider,
			s.id,
			`demo-bf-${session}`,
			s.domain
		]);

		for (let d = s.createdDaysAgo - 1; d >= 1; d--) {
			const date = new Date(now - d * day);
			const weekend = date.getDay() === 0 || date.getDay() === 6;
			if (rand() > s.activityRate * (weekend ? 0.5 : 1)) continue;
			const visits = rand() < 0.25 ? 2 : 1;
			for (let k = 0; k < visits; k++) {
				const ts = now - d * day + Math.floor(rand() * day * 0.9);
				const country = rand() < 0.1 ? pick(rand, COUNTRIES) : s.country;
				rows.push([
					PROJECT,
					ts,
					'session.created',
					country,
					s.provider,
					s.id,
					`demo-bf-${++session}`,
					s.domain
				]);
				rows.push([
					PROJECT,
					ts,
					'user.active',
					country,
					s.provider,
					s.id,
					`demo-bf-${session}`,
					s.domain
				]);
			}
		}
	}

	// Guarantee a healthy DAU: ten subjects active in the last 20 hours.
	for (const s of subjects.slice(0, 10)) {
		const ts = now - Math.floor(rand() * 20 * 3_600_000);
		rows.push([
			PROJECT,
			ts,
			'session.created',
			s.country,
			s.provider,
			s.id,
			`demo-bf-${++session}`,
			s.domain
		]);
		rows.push([
			PROJECT,
			ts,
			'user.active',
			s.country,
			s.provider,
			s.id,
			`demo-bf-${session}`,
			s.domain
		]);
	}

	// A sprinkle of anonymous guests across the last month.
	for (let i = 0; i < 22; i++) {
		const ts = now - Math.floor(rand() * 30 * day);
		const id = `demo-user-anon-${i}`;
		rows.push([
			PROJECT,
			ts,
			'user.created',
			pick(rand, COUNTRIES),
			'anonymous',
			id,
			'none',
			'none'
		]);
		rows.push([
			PROJECT,
			ts + 500,
			'session.created',
			pick(rand, COUNTRIES),
			'anonymous',
			id,
			`demo-bf-${++session}`,
			'none'
		]);
	}

	const escape = (v) => (typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`);
	const statements = [
		`CREATE TABLE IF NOT EXISTS auth_events (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, timestamp INTEGER NOT NULL, event_type TEXT NOT NULL, country TEXT NOT NULL, provider TEXT NOT NULL, subject_id TEXT NOT NULL, session_id TEXT NOT NULL, email_domain TEXT NOT NULL);`,
		`CREATE INDEX IF NOT EXISTS auth_events_project_time ON auth_events(project_id, timestamp);`,
		`DELETE FROM auth_events WHERE project_id = '${PROJECT}' AND (session_id LIKE 'demo-bf-%' OR subject_id LIKE 'demo-user-%');`
	];
	for (let i = 0; i < rows.length; i += 40) {
		const values = rows
			.slice(i, i + 40)
			.map((r) => `(${r.map(escape).join(',')})`)
			.join(',');
		statements.push(
			`INSERT INTO auth_events (project_id, timestamp, event_type, country, provider, subject_id, session_id, email_domain) VALUES ${values};`
		);
	}
	return { sql: statements.join('\n'), rowCount: rows.length };
}

function runWrangler(argv, cwd) {
	return new Promise((resolve, reject) => {
		const child = spawn('npx', argv, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout.on('data', (d) => (output += d));
		child.stderr.on('data', (d) => (output += d));
		child.on('close', (code) =>
			code === 0 ? resolve(output) : reject(new Error(output.slice(-800)))
		);
	});
}

async function backfillAnalytics() {
	if (flag('--skip-backfill') || !IS_LOCAL) return;
	if (!flag('--force-backfill')) {
		try {
			const res = await fetch(`${BASE}/api/projects/${PROJECT}/analytics`, {
				headers: { origin: BASE },
				signal: AbortSignal.timeout(8000)
			});
			const analytics = await res.json();
			if ((analytics.mau ?? 0) >= 15) {
				log(
					`analytics already backfilled (MAU ${analytics.mau}) - skipping; use --force-backfill to redo`
				);
				return;
			}
		} catch {
			// Stack not up yet - proceed with the backfill before booting it.
		}
	}
	const { sql, rowCount } = buildBackfillSql();
	const file = path.join(os.tmpdir(), `cfb-demo-backfill-${process.pid}.sql`);
	fs.writeFileSync(file, sql);
	log(`backfilling ${rowCount} analytics events into local D1 (90-day history)...`);
	try {
		await runWrangler(
			[
				'wrangler',
				'd1',
				'execute',
				'cloudflarebase-auth-analytics-local',
				'--env',
				'local',
				'--local',
				'--persist-to=../../.wrangler/state/',
				`--file=${file}`
			],
			path.resolve(import.meta.dirname, '..', 'agents', 'auth')
		);
		log('backfill done - charts, DAU/MAU, countries and providers now have history');
	} catch (error) {
		log(
			`WARNING: backfill failed (often a lock while the dev stack runs). Charts will only show live data.`
		);
		log(`         Retry once with the stack stopped: node scripts/demo-video.mjs --force-backfill`);
		if (!CHECK) log(String(error.message).split('\n').slice(-3).join(' '));
	} finally {
		fs.rmSync(file, { force: true });
	}
}

// ---------------------------------------------------------------------------
// Seeding + live traffic (rate-limit aware)
// ---------------------------------------------------------------------------

const api = (endpoint) => `${BASE}/api/projects/${PROJECT}/${endpoint}`;

async function post(endpoint, body) {
	return fetch(api(endpoint), {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: BASE },
		body: JSON.stringify(body ?? {}),
		signal: AbortSignal.timeout(15_000)
	});
}

/**
 * Rolling 60s budgets under the Better Auth custom rules (10 sign-ups, 10
 * sign-ins, 20 guests per minute per IP). Sign-up headroom is generous because
 * the on-camera playground sign-up shares the same per-IP bucket. Seeding uses
 * these; --live drops them further once traffic starts, because there every
 * click you make on camera competes for the same buckets.
 */
let budgets = { 'sign-up/email': 4, 'sign-in/email': 9, 'sign-in/anonymous': 16 };
const recent = { 'sign-up/email': [], 'sign-in/email': [], 'sign-in/anonymous': [] };

function budgetLeft(pathName) {
	const now = Date.now();
	recent[pathName] = recent[pathName].filter((t) => now - t < 61_000);
	return budgets[pathName] - recent[pathName].length;
}

async function authRequest(pathName, body) {
	if (budgetLeft(pathName) <= 0) return null;
	recent[pathName].push(Date.now());
	try {
		return await post(`auth/${pathName}`, body);
	} catch {
		return null;
	}
}

async function seedRoster() {
	let existing = 0;
	try {
		const overview = await (await fetch(api('overview'), { headers: { origin: BASE } })).json();
		existing = overview.users?.length ?? 0;
	} catch {
		// treat as empty
	}
	if (existing >= ROSTER.length) {
		log(`project already seeded (${existing} users)`);
		return;
	}
	log(`seeding ${ROSTER.length} demo users (paced for rate limits - first run takes ~2 min)...`);
	for (const [i, user] of ROSTER.entries()) {
		while (budgetLeft('sign-up/email') <= 0) await sleep(4000);
		const res = await authRequest('sign-up/email', user);
		if (res?.status === 429) await sleep(15_000);
		if ((i + 1) % 6 === 0) log(`  ${i + 1}/${ROSTER.length} users seeded`);
		await sleep(CHECK ? 1500 : 4500);
	}
	await authRequest('sign-in/anonymous', {});
	log('seeding done');
}

/**
 * The role registry back to a curated baseline, so 'editor' is always free to
 * be created on camera and the Roles tab is never empty either way.
 */
async function resetRoleRegistry() {
	try {
		const res = await fetch(api('admin/roles'), {
			method: 'PUT',
			headers: { 'content-type': 'application/json', origin: BASE },
			body: JSON.stringify({
				roles: [{ name: 'support', permissions: ['tickets:read', 'users:read'] }]
			}),
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) log(`WARNING: role registry reset failed (${res.status})`);
	} catch {
		log('WARNING: role registry reset failed');
	}
}

/**
 * Drop the demo collections. The create form and the ADD flow both refuse
 * existing names/ids, so a reused stack would otherwise show an error mid-take
 * when the tour (or you, with --fresh-db) creates them on camera.
 */
async function dropDemoCollections() {
	for (const collection of ['posts', 'comments']) {
		try {
			await fetch(api(`db/admin/collections/${collection}`), {
				method: 'DELETE',
				headers: { origin: BASE },
				signal: AbortSignal.timeout(15_000)
			});
		} catch {
			// A 404 (never created) is the normal case on a fresh demo project.
		}
	}
}

/**
 * Demo projects cap chat at 50 questions/day, and rehearsals burn through that
 * fast - once capped, the preflight fails and every copilot scene is silently
 * skipped. Clearing this project's transcript locally resets the counter (it is
 * also a cleaner history to have on camera).
 */
async function clearChatHistory() {
	if (!IS_LOCAL) return;
	try {
		await runWrangler(
			[
				'wrangler',
				'd1',
				'execute',
				'cloudflarebase-control-plane',
				'--env',
				'local',
				'--local',
				'--persist-to=.wrangler/state/',
				'--command',
				`DELETE FROM chat_message WHERE project_id = '${PROJECT}'`
			],
			path.resolve(import.meta.dirname, '..')
		);
	} catch {
		// No table yet (nobody has chatted) - nothing to reset.
	}
}

/** Every tour take starts from the same state. */
async function resetDemoData() {
	await resetRoleRegistry();
	await dropDemoCollections();
	await clearChatHistory();
}

// ---------------------------------------------------------------------------
// Live mode: a project that is already worth walking onto
// ---------------------------------------------------------------------------

/** Seeded posts, kept in memory so the live ticker can re-rank them. */
const SEED_POSTS = [
	['post-1', 'Show HN: I built a Firebase on Cloudflare', 42],
	['post-2', 'Why we moved our backend to Durable Objects', 17],
	['post-3', 'Live queries are criminally underrated', 8],
	['post-4', 'One Worker, one database, zero cold starts', 23],
	['post-5', 'Auth that ships with the backend, not beside it', 11],
	['post-6', 'What Firestore got right, and what it cost', 31]
].map(([id, title, votes]) => ({ id, title, votes }));

const SEED_COMMENTS = [
	['comment-1', 'Durable Objects make this so much simpler.', 'post-1'],
	['comment-2', 'Wait, the dashboard updates itself?', 'post-1'],
	['comment-3', 'How does this handle multi-region reads?', 'post-2'],
	['comment-4', 'The per-collection access modes are the killer feature.', 'post-3'],
	['comment-5', 'Been waiting for something like this for years.', 'post-4'],
	['comment-6', 'Does the client SDK work outside Workers?', 'post-5']
];

async function putCollection(name, readAccess, writeAccess) {
	return fetch(api(`db/admin/collections/${name}`), {
		method: 'PUT',
		headers: { 'content-type': 'application/json', origin: BASE },
		body: JSON.stringify({ readAccess, writeAccess }),
		signal: AbortSignal.timeout(15_000)
	}).catch(() => null);
}

async function putDocument(collection, id, data) {
	return fetch(api(`db/admin/collections/${collection}/documents/${id}`), {
		method: 'PUT',
		headers: { 'content-type': 'application/json', origin: BASE },
		body: JSON.stringify({ data }),
		signal: AbortSignal.timeout(15_000)
	}).catch(() => null);
}

/**
 * The database half of "seeded": two collections with real documents, so
 * walking onto the DB tab unannounced shows a working database rather than an
 * empty state. Writes are upserts, so a rerun is a no-op that also repairs
 * anything a previous take mangled.
 */
async function seedDemoDatabase() {
	log('seeding the database (posts + comments)...');
	// Same modes the dashboard's create form defaults to: read public, write
	// owner - the access sentence on screen then reads the way it would for a
	// collection someone created by hand.
	await putCollection('posts', 'public', 'owner');
	await putCollection('comments', 'public', 'owner');
	for (const post of SEED_POSTS) {
		await putDocument('posts', post.id, { title: post.title, votes: post.votes });
	}
	for (const [id, body, post] of SEED_COMMENTS) {
		await putDocument('comments', id, { body, post });
	}
	log(`database seeded: ${SEED_POSTS.length} posts, ${SEED_COMMENTS.length} comments`);
}

/** A registered user to assign the new role to on camera. */
async function pickRoleTarget() {
	try {
		const res = await fetch(api('overview'), {
			headers: { origin: BASE },
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) return null;
		const overview = await res.json();
		const user = (overview.users ?? []).find(
			(entry) => typeof entry.email === 'string' && entry.email.includes('@')
		);
		return user?.email ?? null;
	} catch {
		return null;
	}
}

let chatWorks = false;

/**
 * Workers AI in dev is a remote binding (needs a logged-in wrangler). Probe it
 * before recording so the copilot scenes are skipped instead of stalling on
 * camera. The probe question reads naturally if it shows up in chat history.
 */
async function preflightChat() {
	if (NO_CHAT) return;
	const probes = [
		"How's my project doing today?",
		"What's our DAU right now?",
		'Any unusual auth activity this week?',
		'Which sign-in providers are most used?'
	];
	let detail = '';
	try {
		const res = await fetch(api('chat'), {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: BASE },
			body: JSON.stringify({ question: probes[Math.floor(Math.random() * probes.length)] }),
			signal: AbortSignal.timeout(60_000)
		});
		chatWorks = res.ok;
		if (!res.ok) {
			// WHY it failed decides what to do about it, so never swallow this:
			// 429 = the demo project hit its daily question cap (resetDemoData
			// clears it locally), 502 = Workers AI unreachable (`wrangler login`).
			const body = await res.text().catch(() => '');
			detail = ` (HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ''})`;
		}
	} catch (error) {
		chatWorks = false;
		detail = ` (${error instanceof Error ? error.message : String(error)})`;
	}
	if (chatWorks) {
		log('Workers AI reachable - copilot scenes enabled');
	} else {
		log(`WARNING: copilot scenes will be SKIPPED - the chat probe failed${detail}`);
		log('         429 = daily demo cap, 502 = Workers AI unreachable (run `npx wrangler login`)');
	}
}

let trafficTimer = null;
let dbTimer = null;
let freshCounter = 0;
/**
 * While true, the generator stops sign-ups (sign-ins and guests continue on
 * their own rate buckets) so the on-camera playground sign-up always has
 * budget left in the shared per-IP sign-up window.
 */
let quietSignups = false;

/** One line per generated event, so the terminal proves the stack is alive. */
function trafficLog(kind, subject, res) {
	if (!LIVE || CHECK) return;
	const time = new Date().toTimeString().slice(0, 8);
	const status = res === null ? 'skipped (rate budget)' : res.ok ? 'ok' : `HTTP ${res.status}`;
	console.log(`[demo] ${time}  ${kind.padEnd(9)} ${String(subject).padEnd(38)} ${status}`);
}

/** Background auth traffic so the live feed and stats move on camera. */
function startTraffic() {
	const rand = mulberry32(Date.now() % 2 ** 31);
	if (LIVE) {
		// In --live YOU are on the same per-IP buckets - a sign-up in the
		// playground, a sign-in you demo by hand. Seeding is done by now, so
		// give roughly half of every bucket back to the human at the keyboard.
		budgets = { 'sign-up/email': 3, 'sign-in/email': 5, 'sign-in/anonymous': 9 };
	}
	const tick = async () => {
		const roll = rand();
		if (roll < 0.55 || (quietSignups && roll < 0.8)) {
			const user = ROSTER[Math.floor(rand() * ROSTER.length)];
			const res = await authRequest('sign-in/email', {
				email: user.email,
				password: user.password
			});
			trafficLog('sign-in', user.email, res);
		} else if (roll < 0.8) {
			const name = FRESH_NAMES[freshCounter % FRESH_NAMES.length];
			freshCounter += 1;
			const email = `${name.toLowerCase().replace(/ /g, '.')}.${Date.now() % 100000}@example.com`;
			const res = await authRequest('sign-up/email', {
				name,
				email,
				password: 'Cloudbase-demo-2026'
			});
			trafficLog('sign-up', email, res);
		} else {
			const res = await authRequest('sign-in/anonymous', {});
			trafficLog('guest', 'anonymous session', res);
		}
	};
	trafficTimer = setInterval(() => void tick().catch(() => {}), CHECK ? 2500 : 4200);
	log('live traffic generator running (sign-ins, sign-ups, guests)');
}

/**
 * Database activity to match, for --live only. Mostly upvotes, because a vote
 * count changing in an open table is the live-query engine proving itself
 * without growing the demo project's 200-doc-per-collection ceiling. (The
 * dashboard browser reads in document-id order - re-ranking is what a SUBSCRIBED
 * client with `orderBy votes desc` sees, which is the Integration tab's snippet,
 * not this table.) New posts land occasionally, capped for the same reason.
 */
function startDbTraffic() {
	const rand = mulberry32((Date.now() >>> 3) % 2 ** 31);
	let added = 0;
	const tick = async () => {
		const post = SEED_POSTS[Math.floor(rand() * SEED_POSTS.length)];
		if (rand() < 0.2 && added < 8) {
			added += 1;
			const id = `post-live-${Date.now().toString(36)}`;
			const title = `${FRESH_NAMES[added % FRESH_NAMES.length]} shipped something on Frostbase`;
			const res = await putDocument('posts', id, { title, votes: 1 + Math.floor(rand() * 5) });
			trafficLog('new post', id, res);
			return;
		}
		post.votes += 1;
		const res = await putDocument('posts', post.id, { title: post.title, votes: post.votes });
		trafficLog('upvote', `${post.id} -> ${post.votes} votes`, res);
	};
	dbTimer = setInterval(() => void tick().catch(() => {}), 7300);
	log('database activity running (upvotes land in an open documents table, no refresh)');
}

// ---------------------------------------------------------------------------
// Browser choreography
// ---------------------------------------------------------------------------

/** Injected on every page: a visible cursor dot + click ripples. */
const CURSOR_SCRIPT = `(() => {
	if (window.__cfbDemoCursor) return;
	window.__cfbDemoCursor = true;
	const ensure = () => {
		let dot = document.getElementById('cfb-demo-cursor');
		if (!dot && document.documentElement) {
			dot = document.createElement('div');
			dot.id = 'cfb-demo-cursor';
			dot.style.cssText = 'position:fixed;left:-100px;top:-100px;width:22px;height:22px;' +
				'border-radius:50%;background:rgba(255,255,255,.9);border:1.5px solid rgba(0,0,0,.6);' +
				'box-shadow:0 1px 8px rgba(0,0,0,.45);z-index:2147483647;pointer-events:none;' +
				'transform:translate(-50%,-50%);transition:left .04s linear,top .04s linear,scale .12s ease;';
			document.documentElement.appendChild(dot);
		}
		return dot;
	};
	window.addEventListener('mousemove', (e) => {
		const dot = ensure();
		if (dot) { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }
	}, { capture: true, passive: true });
	window.addEventListener('mousedown', (e) => {
		const dot = ensure();
		if (dot) dot.style.scale = '0.72';
		if (!document.documentElement) return;
		const ring = document.createElement('div');
		ring.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;' +
			'width:14px;height:14px;border-radius:50%;border:2.5px solid #f6821f;z-index:2147483646;' +
			'pointer-events:none;transform:translate(-50%,-50%);opacity:.95;' +
			'transition:width .45s ease-out,height .45s ease-out,opacity .45s ease-out;';
		document.documentElement.appendChild(ring);
		requestAnimationFrame(() => {
			ring.style.width = '58px'; ring.style.height = '58px'; ring.style.opacity = '0';
		});
		setTimeout(() => ring.remove(), 600);
	}, { capture: true, passive: true });
	window.addEventListener('mouseup', () => {
		const dot = ensure();
		if (dot) dot.style.scale = '1';
	}, { capture: true, passive: true });
})();`;

let cursorAt = { x: 200, y: 200 };

async function glide(page, x, y) {
	const distance = Math.hypot(x - cursorAt.x, y - cursorAt.y);
	const steps = CHECK ? 4 : Math.max(10, Math.min(30, Math.round(distance / 24)));
	await page.mouse.move(x, y, { steps });
	cursorAt = { x, y };
	await pace(80);
}

async function glideTo(page, locator, { settle = 250 } = {}) {
	await locator.scrollIntoViewIfNeeded();
	await pace(settle);
	const box = await locator.boundingBox();
	if (!box) throw new Error('element has no bounding box');
	await glide(page, box.x + box.width / 2, box.y + Math.min(box.height / 2, 60));
	return box;
}

async function clickEl(page, locator) {
	await glideTo(page, locator);
	await pace(90);
	// Element-anchored click: Playwright re-resolves the position and waits
	// for animations/scrolling to settle, so the click never lands stale.
	await locator.click({ delay: 60 });
	const box = await locator.boundingBox().catch(() => null);
	if (box) cursorAt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function screenshot(page, name) {
	if (!SHOTS) return;
	fs.mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function countdown(page, seconds) {
	if (CHECK) return;
	log(`browser is up - START YOUR RECORDING. Tour begins in ${seconds}s...`);
	await page.evaluate((s) => {
		const pill = document.createElement('div');
		pill.id = 'cfb-demo-countdown';
		pill.style.cssText =
			'position:fixed;right:18px;bottom:18px;z-index:2147483647;' +
			'background:rgba(10,10,12,.82);color:#fff;font:600 13px/1 system-ui;' +
			'padding:10px 14px;border-radius:999px;pointer-events:none;letter-spacing:.02em;';
		pill.textContent = 'tour starts in ' + s + 's';
		document.documentElement.appendChild(pill);
	}, seconds);
	for (let s = seconds - 1; s >= 0; s--) {
		await sleep(1000);
		await page.evaluate((v) => {
			const pill = document.getElementById('cfb-demo-countdown');
			if (pill) pill.textContent = v > 0 ? 'tour starts in ' + v + 's' : '';
			if (pill && v === 0) pill.remove();
		}, s);
	}
	await sleep(400);
}

/**
 * Force the recorded theme. The context already seeds mode-watcher and the
 * OS preference, so this only catches a stale persisted choice - one click on
 * the page's own toggle, before the countdown, never on camera.
 */
async function ensureTheme(page, toggleTestId) {
	const wantsDark = THEME === 'dark';
	const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
	if (isDark === wantsDark) return;
	const toggle = page.getByTestId(toggleTestId);
	if (await toggle.count()) {
		await toggle.first().click();
		await pace(300);
	}
}

/**
 * Type a collection name and create it, on camera.
 *
 * Waits for the form to CLEAR, not just for the row to appear: the row lands
 * mid-save (the refetch inside it) while the input is cleared only once the
 * whole save settles, so typing the next name too early gets it wiped
 * halfway through - a mangled name is exactly the kind of thing a viewer
 * notices.
 */
async function createCollectionOnCamera(page, name) {
	const input = page.locator('#new-collection-name');
	await clickEl(page, input);
	await page.keyboard.type(name, { delay: 38 });
	await pace(200);
	await clickEl(page, page.getByRole('button', { name: 'Create', exact: true }));
	await page.getByTestId(`db-collection-${name}`).waitFor({ timeout: 15_000 });
	await page
		.waitForFunction(
			() => document.querySelector('#new-collection-name')?.value === '',
			undefined,
			{ timeout: 15_000 }
		)
		.catch(() => {});
}

/**
 * A recording-ready Chromium: the demo cookie set, the theme pinned, every
 * route pre-compiled, and the window sized for capture. The tour then takes the
 * mouse; --live hands the same browser to the operator.
 */
async function openDemoBrowser({ cursor }) {
	const { chromium } = await import('@playwright/test');
	const windowed = flag('--windowed');
	const browser = await chromium.launch({
		headless: CHECK,
		ignoreDefaultArgs: ['--enable-automation'],
		args: CHECK
			? []
			: windowed
				? ['--force-device-scale-factor=1', '--window-position=0,0']
				: ['--start-fullscreen']
	});
	// Windowed mode pins the page to an exact 1920x1080 frame via viewport
	// emulation, so OS display scaling and window-chrome clamping cannot
	// shrink the recorded layout. On a 1080p monitor, fullscreen (the
	// default) is still the sharpest capture.
	const context = await browser.newContext({
		viewport: CHECK || windowed ? { width: 1920, height: 1080 } : null,
		deviceScaleFactor: CHECK || windowed ? 1 : undefined,
		colorScheme: THEME
	});
	// Seed mode-watcher's own storage key too: the OS preference alone loses
	// to a persisted choice, and a theme flip mid-take looks like a bug.
	await context.addInitScript(`localStorage.setItem('mode-watcher-mode', '${THEME}');`);
	// The synthetic cursor is for the choreographed tour only - in --live the
	// operator has a real one, and two would be a bug on camera.
	if (cursor) await context.addInitScript(CURSOR_SCRIPT);
	if (DEMO_PATTERN.test(PROJECT)) {
		await context.addCookies([{ name: 'cfb-demo-project', value: PROJECT, url: BASE }]);
	}
	// Warm the dev server first: the first hit on each route triggers Vite
	// compilation and dependency optimization (with full-page reloads). Doing
	// it in a throwaway page keeps compile hitches off camera.
	log('warming routes so nothing compiles on camera...');
	const warm = await context.newPage();
	for (const route of [
		'/',
		`/dashboard/${PROJECT}`,
		`/dashboard/${PROJECT}/auth`,
		`/dashboard/${PROJECT}/db`,
		`/dashboard/${PROJECT}/api`
	]) {
		await warm.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 120_000 }).catch(() => {});
		await sleep(3000);
	}
	await warm
		.goto(`${BASE}/dashboard/${PROJECT}/auth`, { waitUntil: 'load', timeout: 60_000 })
		.catch(() => {});
	await warm.close();

	const page = await context.newPage();

	if (!CHECK) {
		// Launch flags like --start-fullscreen are unreliable under Playwright
		// (the window can open at Chromium's small default). Setting the window
		// state over CDP after the window exists always works.
		try {
			const cdp = await context.newCDPSession(page);
			const { windowId } = await cdp.send('Browser.getWindowForTarget');
			await cdp.send('Browser.setWindowBounds', {
				windowId,
				bounds: { windowState: windowed ? 'maximized' : 'fullscreen' }
			});
			await cdp.detach().catch(() => {});
			await sleep(800);
		} catch (error) {
			log(`could not resize the browser window: ${error.message}`);
		}
		const screen = await page.evaluate(() => ({
			w: window.screen.width,
			h: window.screen.height
		}));
		log(
			windowed
				? `display reports ${screen.w}x${screen.h}. Layout is locked to 1920x1080 inside the window - set the OBS canvas to 1920x1080 and stretch the window capture to fill it.`
				: screen.w === 1920 && screen.h === 1080
					? 'display is 1920x1080 - fullscreen capture is pixel-perfect 1:1.'
					: `display reports ${screen.w}x${screen.h} - fullscreen renders at that size; set the OBS output resolution to 1920x1080 to downscale.`
		);
	}

	return { browser, page };
}

async function runTour() {
	// Hold generator sign-ups from the very start so the rate window has
	// rolled by the time the playground scene signs up on camera.
	quietSignups = true;
	const { browser, page } = await openDemoBrowser({ cursor: true });

	// --- Scene 1: landing - one beat, then straight to the live demo ---------
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await pace(800);
	await ensureTheme(page, 'landing-theme-toggle');
	await glide(page, 960, 400);
	await countdown(page, 5);
	const tourStart = Date.now();

	await pace(1200);
	await screenshot(page, '01-landing');

	const cta = page.getByRole('link', { name: 'Open the live demo' }).first();
	await cta.scrollIntoViewIfNeeded();
	await pace(400);
	if (DEMO_PATTERN.test(PROJECT)) {
		await clickEl(page, cta);
		await page.waitForURL('**/dashboard/**', { timeout: 15_000 }).catch(() =>
			page.goto(`${BASE}/dashboard/${PROJECT}`, {
				waitUntil: 'domcontentloaded',
				timeout: 60_000
			})
		);
	} else {
		await page.goto(`${BASE}/dashboard/${PROJECT}`);
	}

	// --- Scene 2: a real backend exists, seconds after one click -------------
	await page.getByRole('heading', { name: 'Project Overview' }).waitFor({ timeout: 20_000 });
	await pace(1400);
	await screenshot(page, '02-overview');
	await glideTo(page, page.getByTestId('product-auth'), { settle: 200 });
	await pace(500);
	await glideTo(page, page.getByTestId('product-db'), { settle: 200 });
	await pace(500);
	await clickEl(page, page.getByTestId('nav-auth'));
	await page.waitForURL('**/auth', { timeout: 15_000 }).catch(() =>
		page.goto(`${BASE}/dashboard/${PROJECT}/auth`, {
			waitUntil: 'domcontentloaded',
			timeout: 60_000
		})
	);

	// --- Scene 3: auth - the copilot is asked first, stats play meanwhile ----
	const authPage = page.getByTestId('auth-page');
	await authPage.waitFor({ timeout: 20_000 });
	await page
		.waitForFunction(
			() => document.querySelector('[data-testid="auth-page"]')?.dataset.hydrated === 'true'
		)
		.catch(() => {});
	await pace(1000);
	await screenshot(page, '03-auth-dashboard');

	const copilotPanel = page.getByTestId('copilot-messages');
	const copilotReplies = copilotPanel.getByText('Generated by Workers AI');
	const askCopilot = async (question) => {
		const input = page.getByLabel('Ask project agent');
		if (!(await input.count())) return false;
		await glideTo(page, input.first());
		await input.first().click();
		await page.keyboard.type(question, { delay: 26 });
		await pace(250);
		await clickEl(page, page.getByRole('button', { name: 'Send to project agent' }));
		await pace(300);
		return true;
	};
	const waitForReply = async (repliesBefore, timeoutMs) => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline && (await copilotReplies.count()) <= repliesBefore) {
			await sleep(600);
		}
		return (await copilotReplies.count()) > repliesBefore;
	};
	const aiOn = !NO_CHAT && chatWorks;

	let repliesSoFar = await copilotReplies.count();
	let askedFirst = false;
	if (aiOn) {
		askedFirst = await askCopilot('How many users do I have, and where are they signing in from?');
		if (askedFirst) log('copilot question 1 sent - the answer lands during the stats');
	}

	for (const stat of ['users', 'sessions', 'dau', 'mau']) {
		const tile = page.getByTestId(`stat-${stat}`);
		if (await tile.count()) await glideTo(page, tile.first(), { settle: 80 });
		await pace(200);
	}

	const range = page.getByTestId('activity-range');
	if (await range.count()) {
		await clickEl(page, range.first());
		const option = page.getByRole('option', { name: 'Last 90 days' });
		await option.waitFor({ timeout: 5000 }).catch(() => {});
		if (await option.count()) await clickEl(page, option.first());
		await pace(1500);
		await screenshot(page, '04-activity-90d');
	}

	// --- Scene 4: a real account, created on camera with zero code -----------
	await clickEl(page, page.getByRole('tab', { name: 'Try auth' }));
	await pace(600);
	await clickEl(page, page.getByTestId('randomize-identity'));
	await pace(600);
	const sessionPanel = page.getByTestId('session-panel');
	const trySignUp = async () => {
		await clickEl(page, page.getByRole('button', { name: 'Create account' }));
		return sessionPanel
			.getByText('@', { exact: false })
			.first()
			.waitFor({ timeout: 12_000 })
			.then(() => true)
			.catch(() => false);
	};
	if (!(await trySignUp())) {
		log('playground sign-up throttled - retrying in 15s');
		await sleep(15_000);
		await trySignUp();
	}
	quietSignups = false;
	// The session panel now holds a real user and a real token.
	await glideTo(page, sessionPanel, { settle: 150 });
	await pace(1600);
	await screenshot(page, '05-playground-signup');
	const sessionText = await sessionPanel.innerText().catch(() => '');
	const demoEmail = sessionText.match(/[a-z0-9][a-z0-9.+_-]*@[a-z0-9.-]+/i)?.[0] ?? '';

	// The first answer landed while that happened.
	if (askedFirst && (await waitForReply(repliesSoFar, 30_000))) {
		await glideTo(page, copilotPanel, { settle: 150 });
		await pace(2800);
		await screenshot(page, '06-copilot-answer-1');
		repliesSoFar = await copilotReplies.count();
		const suggestion = page.getByTestId('copilot-suggestions').getByRole('button').first();
		if (await suggestion.count()) {
			await clickEl(page, suggestion);
			log('copilot question 2 sent - it answers during roles');
		}
	} else if (askedFirst) {
		log('AI reply did not arrive in time - continuing');
	}

	// --- Scene 5: roles and permissions, assigned to that very user ----------
	await clickEl(page, page.getByRole('tab', { name: 'Roles' }));
	await pace(900);
	await clickEl(page, page.getByLabel('New role name'));
	await page.keyboard.type('editor', { delay: 40 });
	await pace(200);
	await clickEl(page, page.getByRole('button', { name: 'Add role' }));
	const editorCard = page.getByTestId('role-editor');
	await editorCard.waitFor({ timeout: 10_000 }).catch(() => {});
	if (await editorCard.count()) {
		await pace(400);
		await clickEl(page, editorCard.getByLabel('New permission for editor'));
		await page.keyboard.type('posts:write', { delay: 36 });
		await pace(200);
		await clickEl(page, editorCard.getByRole('button', { name: 'Grant' }));
		await pace(1200);
		await screenshot(page, '07-roles');
	}

	// The permission is real the moment it rides into that user's JWT.
	await clickEl(page, page.getByRole('tab', { name: 'Users' }));
	await pace(900);
	const roleTarget = demoEmail || (await pickRoleTarget());
	if (roleTarget) {
		const roleSelect = page.getByLabel(`Role for ${roleTarget}`);
		if (await roleSelect.count()) {
			await clickEl(page, roleSelect.first());
			const editorOption = page.getByRole('option', { name: 'editor' });
			await editorOption.waitFor({ timeout: 5000 }).catch(() => {});
			if (await editorOption.count()) await clickEl(page, editorOption.first());
			await pace(1400);
			await screenshot(page, '08-role-assigned');
		}
	}

	// The second answer landed while roles happened.
	if (aiOn && (await copilotReplies.count()) > repliesSoFar) {
		await glideTo(page, copilotPanel, { settle: 150 });
		await pace(2600);
		await screenshot(page, '09-copilot-answer-2');
	}

	// --- Scene 6: the database - a collection, and who may touch it ----------
	await clickEl(page, page.getByTestId('nav-db'));
	await page.waitForURL('**/db', { timeout: 15_000 }).catch(() =>
		page.goto(`${BASE}/dashboard/${PROJECT}/db`, {
			waitUntil: 'domcontentloaded',
			timeout: 60_000
		})
	);
	await page.getByTestId('db-page').waitFor({ timeout: 20_000 });
	await page
		.waitForFunction(
			() => document.querySelector('[data-testid="db-page"]')?.dataset.hydrated === 'true'
		)
		.catch(() => {});
	await pace(800);

	// resetDemoData() dropped these before the tour, so create is always the
	// clean, guard-passing path on camera.
	await createCollectionOnCamera(page, 'posts');
	const postsRow = page.getByTestId('db-collection-posts');
	await pace(500);
	await screenshot(page, '10-db-collection');

	// Security is per collection and reads as a sentence - the Firestore-rules
	// story without the rules language.
	await clickEl(page, page.getByRole('tab', { name: 'Access' }));
	await pace(700);
	const accessRow = page.getByTestId('db-access-posts');
	if (await accessRow.count()) {
		// Require the permission the roles scene just created - the two
		// chapters click together: that role is what lets a user write here.
		// (Modes are left at the create form's defaults, read public / write
		// owner; re-picking a default arms no edit, so Apply would stay
		// disabled.)
		await clickEl(page, accessRow.getByTestId('db-perm-write-posts'));
		const permOption = page.getByRole('option', { name: 'posts:write' });
		await permOption.waitFor({ timeout: 5000 }).catch(() => {});
		if (await permOption.count()) {
			await clickEl(page, permOption.first());
			await pace(400);
			await clickEl(page, accessRow.getByRole('button', { name: 'Apply' }));
			await pace(600);
		} else {
			// No role registry (AI-less or reset run): close the menu and just
			// show the sentence, which is the point of the scene either way.
			await page.keyboard.press('Escape');
		}
		// The plain-English summary under the row is what makes per-collection
		// security legible at a glance.
		await glideTo(page, page.getByTestId('db-access-summary-posts'), { settle: 150 });
		await pace(2200);
		await screenshot(page, '11-db-access');
	}
	await clickEl(page, page.getByRole('tab', { name: 'Collections' }));
	await pace(600);

	// --- Scene 7: documents, and the live-query money shot -------------------
	await clickEl(page, postsRow);
	await page.getByTestId('db-add-document').waitFor({ timeout: 10_000 });
	await clickEl(page, page.getByTestId('db-add-document'));
	const editor = page.getByTestId('db-doc-editor');
	await editor.waitFor({ timeout: 5000 });
	await clickEl(page, editor.getByLabel('Document id (optional)'));
	await page.keyboard.type('post-1', { delay: 34 });
	const textarea = editor.getByLabel('Data (JSON object)');
	await clickEl(page, textarea);
	await textarea.fill('');
	await page.keyboard.type(
		'{ "title": "Show HN: I built a Firebase on Cloudflare", "votes": 42 }',
		{
			delay: 17
		}
	);
	await pace(250);
	await clickEl(page, editor.getByRole('button', { name: 'Save document' }));
	await editor.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

	// Two posts land OUT OF BAND - as another app's users would write them -
	// and appear in the open table with no click and no refresh.
	for (const [postId, title, votes] of [
		['post-2', 'Why we moved our backend to Durable Objects', 17],
		['post-3', 'Live queries are criminally underrated', 8]
	]) {
		await fetch(api(`db/admin/collections/posts/documents/${postId}`), {
			method: 'PUT',
			headers: { 'content-type': 'application/json', origin: BASE },
			body: JSON.stringify({ data: { title, votes } }),
			signal: AbortSignal.timeout(10_000)
		}).catch(() => null);
	}
	await glideTo(page, page.getByTestId('db-documents-table'), { settle: 150 });
	await page
		.getByTestId('db-documents-table')
		.getByText('Live queries are criminally underrated')
		.first()
		.waitFor({ timeout: 15_000 });
	await pace(1400);
	await screenshot(page, '12-db-documents');

	// An upvote from "somewhere else" moves the number in the open table.
	const upvote = await fetch(api('db/admin/collections/posts/documents/post-1'), {
		method: 'PUT',
		headers: { 'content-type': 'application/json', origin: BASE },
		body: JSON.stringify({
			data: { title: 'Show HN: I built a Firebase on Cloudflare', votes: 43 }
		}),
		signal: AbortSignal.timeout(10_000)
	}).catch(() => null);
	if (!upvote?.ok) {
		log(`WARNING: out-of-band upvote failed (${upvote?.status ?? 'network'})`);
	}
	await page
		.getByTestId('db-documents-table')
		.getByText('"votes":43')
		.first()
		.waitFor({ timeout: 15_000 });
	await pace(1900);
	await screenshot(page, '13-db-live-update');

	// --- Scene 8: the code behind that - subscribe once, get deltas forever --
	await clickEl(page, page.getByRole('tab', { name: 'Integration' }));
	await pace(700);
	const sdkPill = page.getByTestId('db-integration').getByRole('tab', { name: 'Client SDK' });
	if (await sdkPill.count()) await clickEl(page, sdkPill.first());
	await pace(400);
	await glideTo(page, page.getByTestId('db-integration').locator('pre').first(), { settle: 150 });
	await pace(2400);
	await screenshot(page, '14-db-sdk');

	// --- Scene 9: 30-day point-in-time recovery, per collection --------------
	await clickEl(page, page.getByRole('tab', { name: 'Collections' }));
	await pace(500);
	if (!(await page.getByTestId('db-documents-card').count())) {
		await clickEl(page, postsRow);
		await page.getByTestId('db-add-document').waitFor({ timeout: 10_000 });
	}
	await clickEl(page, page.getByTestId('db-rollback'));
	const rollbackPanel = page.getByTestId('db-rollback-panel');
	await rollbackPanel.waitFor({ timeout: 10_000 }).catch(() => {});
	if (await rollbackPanel.count()) {
		await pace(2200);
		await screenshot(page, '15-db-rollback');
		await clickEl(page, rollbackPanel.getByRole('button', { name: 'Cancel' }));
		await pace(400);
	}

	// --- Scene 10: a second collection, so the finale reads a real database --
	await createCollectionOnCamera(page, 'comments');
	for (const [id, body] of [
		['comment-1', 'Durable Objects make this so much simpler.'],
		['comment-2', 'Wait, the dashboard updates itself?']
	]) {
		await fetch(api(`db/admin/collections/comments/documents/${id}`), {
			method: 'PUT',
			headers: { 'content-type': 'application/json', origin: BASE },
			body: JSON.stringify({ data: { body, post: 'post-1' } }),
			signal: AbortSignal.timeout(10_000)
		}).catch(() => null);
	}
	await pace(1200);
	await screenshot(page, '16-db-second-collection');

	// --- Scene 11: the agentic finale ----------------------------------------
	// Asked LAST, once both collections and every document exist, and phrased
	// as one concrete request - small models answer a single clear question
	// far more reliably than a compound one.
	let askedDb = false;
	if (aiOn) {
		repliesSoFar = await copilotReplies.count();
		askedDb = await askCopilot('List my collections and the posts with their vote counts.');
		if (askedDb) log('copilot asked about the db - it queries the collections live');
	}

	// The generated API reference plays while the model reads the database:
	// every route, from the same schemas the agents validate with.
	await clickEl(page, page.getByTestId('nav-api'));
	await page.waitForURL('**/api', { timeout: 15_000 }).catch(() => {});
	await page
		.getByTestId('api-reference')
		.waitFor({ timeout: 20_000 })
		.catch(() => {});
	await pace(2600);
	await screenshot(page, '17-api-reference');

	if (askedDb) {
		if (await waitForReply(repliesSoFar, 45_000)) {
			await glideTo(page, copilotPanel, { settle: 150 });
			await pace(3400);
			await screenshot(page, '18-copilot-db');
		} else {
			log('WARNING: the db answer did not arrive - re-take, or check Workers AI');
		}
	}

	await glide(page, 760, 420);
	await pace(2000);
	await screenshot(page, '19-finale');

	log(`tour ran ${Math.round((Date.now() - tourStart) / 1000)}s (excluding the countdown)`);

	if (CHECK) {
		await browser.close();
		return null;
	}
	log(
		'tour complete - background auth traffic keeps flowing. Stop your recording, then Ctrl+C here.'
	);
	return browser;
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------

/** Read back what the operator is about to walk onto, so surprises land here. */
async function reportProjectState() {
	try {
		const [overview, analytics, db] = await Promise.all([
			fetch(api('overview'), { headers: { origin: BASE } }).then((r) => r.json()),
			fetch(api('analytics'), { headers: { origin: BASE } }).then((r) => r.json()),
			fetch(api('db/overview'), { headers: { origin: BASE } })
				.then((r) => r.json())
				.catch(() => null)
		]);
		const collections = (db?.collections ?? [])
			.map((c) => `${c.name} (${c.docs ?? '?'} docs)`)
			.join(', ');
		log(
			`project state: ${overview.state?.users ?? '?'} users · ` +
				`${overview.state?.activeSessions ?? '?'} active sessions · ` +
				`DAU ${analytics.dau ?? '?'} / MAU ${analytics.mau ?? '?'}`
		);
		log(`collections: ${collections || 'none'}`);
		return overview;
	} catch (error) {
		log(`WARNING: could not read the project back (${error.message})`);
		return null;
	}
}

/**
 * Seed, generate, hand over. The tour's choreography is replaced by a browser
 * the operator drives - everything else (seeded users, 90 days of analytics,
 * warmed routes, pinned theme, demo cookie) is identical, so whatever page they
 * walk onto is already the page the tour would have shown.
 */
async function runLive() {
	await seedRoster();
	await resetRoleRegistry();
	if (flag('--fresh-db')) {
		await dropDemoCollections();
		log('database dropped (--fresh-db) - create the collections yourself on camera');
	} else {
		await seedDemoDatabase();
	}
	// Probe first, THEN clear: the probe tells the operator whether the copilot
	// will answer on camera, and clearing after it leaves the pane empty.
	await preflightChat();
	await clearChatHistory();
	await reportProjectState();

	startTraffic();
	if (!flag('--fresh-db')) startDbTraffic();

	const dashboard = `${BASE}/dashboard/${PROJECT}`;
	let browser = null;
	if (flag('--no-browser')) {
		log('');
		log(`open ${dashboard} in your own browser (auth: ${dashboard}/auth)`);
		log(
			'note: clicking the landing CTA there mints a DIFFERENT, empty project - ' +
				'go to the URL above directly, or drop --no-browser and use the browser this script opens.'
		);
	} else {
		const start = opt('--start', '/');
		const opened = await openDemoBrowser({ cursor: false });
		browser = opened.browser;
		await opened.page.goto(`${BASE}${start.startsWith('/') ? start : `/${start}`}`, {
			waitUntil: 'load',
			timeout: 120_000
		});
		await ensureTheme(opened.page, 'landing-theme-toggle');
		log('');
		log('browser is yours - START YOUR RECORDING whenever you like.');
		log(
			`the landing CTA lands on the seeded project (the demo cookie is set), or go straight to ${dashboard}/auth`
		);
	}
	log('traffic keeps flowing while you drive. Ctrl+C here when you are done.');
	log('');
	return browser;
}

// ---------------------------------------------------------------------------

async function main() {
	log(
		`target ${BASE} · project ${PROJECT}` +
			`${LIVE ? ' · LIVE MODE (you drive)' : ''}${CHECK ? ' · CHECK MODE (headless, fast)' : ''}`
	);
	const stackWasUp = await isUp(`${BASE}/`);
	if (!stackWasUp) await backfillAnalytics();
	await ensureStack();
	if (stackWasUp) await backfillAnalytics();

	let browser;
	if (LIVE) {
		browser = await runLive();
	} else {
		await seedRoster();
		await resetDemoData();
		await preflightChat();
		startTraffic();
		browser = await runTour();
	}

	if (CHECK) {
		// Live mode has no choreography to validate, so prove the thing it
		// actually promises instead: that traffic is moving the counters.
		if (LIVE) {
			const before = await reportProjectState();
			await sleep(20_000);
			const after = await reportProjectState();
			const moved =
				(after?.state?.totalEvents ?? 0) > (before?.state?.totalEvents ?? 0) ||
				(after?.state?.activeSessions ?? 0) !== (before?.state?.activeSessions ?? 0);
			if (!moved) throw new Error('no live activity reached the agent in 20s');
			log('live activity confirmed - the agent state moved on its own');
		}
		clearInterval(trafficTimer);
		clearInterval(dbTimer);
		log(`check passed${SHOTS ? ` - screenshots in ${SHOTS}` : ''}`);
		process.exit(0);
	}

	const shutdown = async () => {
		clearInterval(trafficTimer);
		clearInterval(dbTimer);
		await browser?.close().catch(() => {});
		if (devProcess) log('note: the dev stack this script started is still running');
		process.exit(0);
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
	// Keep traffic + browser alive until the user stops recording.
	await new Promise(() => {});
}

main().catch((error) => {
	clearInterval(trafficTimer);
	clearInterval(dbTimer);
	console.error(`[demo] FAILED: ${error.message}`);
	process.exit(1);
});
