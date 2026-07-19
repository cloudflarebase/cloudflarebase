import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/environment';

const PROD_DSN =
	'https://50ed6e26b886124ac39e983efb72144d@o4510375271530496.ingest.de.sentry.io/4511764380778576';
const DEV_DSN =
	'https://093f7505d223a871223f9a15130ef116@o4510375271530496.ingest.de.sentry.io/4511764377043024';

const production = !dev && window.location.hostname === 'cloudflarebase.com';
const local = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

Sentry.init({
	dsn: production ? PROD_DSN : DEV_DSN,
	enabled: !local,
	environment: production ? 'production' : 'preview',
	tracesSampleRate: 0.1
});

export const handleError = Sentry.handleErrorWithSentry();
