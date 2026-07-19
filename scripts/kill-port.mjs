// Kills any process still listening on the given ports. Used before starting
// the e2e test servers: on Windows, killing a wrangler wrapper can leave a
// detached workerd serving stale code and holding file locks on the persist
// dir — this clears such zombies so the fresh server can start.
import { execSync } from 'node:child_process';

const ports = process.argv.slice(2).filter((p) => /^\d+$/.test(p));

for (const port of ports) {
	try {
		if (process.platform === 'win32') {
			const pids = new Set();
			try {
				const out = execSync(`netstat -ano -p tcp | findstr :${port}`, {
					stdio: 'pipe'
				}).toString();
				for (const line of out.split('\n')) {
					if (line.includes('LISTENING') && line.includes(`:${port} `)) {
						pids.add(line.trim().split(/\s+/).at(-1));
					}
				}
			} catch {
				// No listener may remain even though its Wrangler parent is alive.
			}
			// Killing only workerd's listening PID can leave its Wrangler parent
			// alive; that parent retains ephemeral workerd children and state locks.
			// Include command processes explicitly configured for this port so
			// taskkill /T removes the complete server tree from the top down.
			try {
				const configured = execSync(
					`powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'wrangler' -and $_.CommandLine -match '(?:--port(?:=|\\s+)${port})(?:\\s|$)' } | Select-Object -ExpandProperty ProcessId"`,
					{ stdio: 'pipe' }
				).toString();
				for (const pid of configured.split(/\s+/).filter(Boolean)) pids.add(pid);
			} catch {
				// Process enumeration is best-effort; listener cleanup still applies.
			}
			for (const pid of pids) {
				if (pid && pid !== '0') {
					try {
						execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
						console.log(`kill-port: killed pid ${pid} on :${port}`);
					} catch {
						// already gone
					}
				}
			}
		} else {
			execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: 'pipe' });
		}
	} catch {
		// nothing listening — fine
	}
}
