import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import * as Sentry from '@sentry/sveltekit';

/**
 * Error reporting is opt-in and off by default.
 *
 * The DSN used to be hardcoded here, which meant any fork deployed anywhere
 * other than localhost reported its errors into this project's Sentry account.
 * It now comes from PUBLIC_SENTRY_DSN, so a self-hosted install reports
 * nowhere until its operator points it at their own project.
 */
const dsn = env.PUBLIC_SENTRY_DSN ?? '';

const local =
	typeof window !== 'undefined' &&
	(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

Sentry.init({
	dsn,
	enabled: !!dsn && !dev && !local,
	environment: env.PUBLIC_SENTRY_ENV ?? 'production',
	tracesSampleRate: 0.1
});

export const handleError = Sentry.handleErrorWithSentry();
