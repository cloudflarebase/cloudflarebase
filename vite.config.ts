import tailwindcss from '@tailwindcss/vite';
import { sentrySvelteKit } from '@sentry/sveltekit';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [...(await sentrySvelteKit({ autoUploadSourceMaps: false })), tailwindcss(), sveltekit()]
});
