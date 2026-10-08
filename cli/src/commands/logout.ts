import { deleteConfig, loadConfig } from '../lib/config.js';
import { success } from '../lib/log.js';

/** `frostbase logout` - revoke the stored session and forget it. */
export async function logoutCommand(): Promise<void> {
	let hadSession = false;
	try {
		const config = await loadConfig();
		hadSession = true;
		// Best effort: the local file is deleted regardless, and an
		// already-invalid session has nothing left to revoke.
		await fetch(`${config.origin}/api/projects/console/auth/sign-out`, {
			method: 'POST',
			headers: { authorization: `Bearer ${config.token}`, origin: config.origin }
		}).catch(() => null);
	} catch {
		/* not signed in - nothing to revoke */
	}
	await deleteConfig();
	success(hadSession ? 'Signed out.' : 'Already signed out.');
}
