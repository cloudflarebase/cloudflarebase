// Deletes a wrangler test-state directory so every e2e run starts with a
// fresh database. Guarded so it can only ever remove test-state paths.
import { rmSync } from 'node:fs';
import path from 'node:path';

const target = process.argv[2];

if (!target || !target.replaceAll('\\', '/').includes('.wrangler/test-state')) {
	console.error(
		`clean-dir: refusing to delete "${target}" - only .wrangler/test-state paths are allowed`
	);
	process.exit(1);
}

// Windows can hold file locks briefly after a previous workerd exits -
// maxRetries/retryDelay make rmSync wait out EBUSY/EPERM instead of failing.
rmSync(path.resolve(target), { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
console.log(`clean-dir: removed ${target}`);
