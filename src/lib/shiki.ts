import type { HighlighterCore } from 'shiki/core';

// Fine-grained shiki instead of the full bundle: the full `shiki` entry pulls
// every grammar plus the Oniguruma WASM engine onto the main thread. Here only
// the grammars used by `buildIntegrationExamples` are loaded (keep this list in
// sync - dynamic import specifiers must stay static for the bundler), and the
// pure-JS regex engine avoids the WASM fetch/compile entirely.
let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
	highlighterPromise ??= Promise.all([
		import('shiki/core'),
		import('shiki/engine/javascript')
	]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
		createHighlighterCore({
			themes: [import('@shikijs/themes/github-dark-default')],
			langs: [
				import('@shikijs/langs/javascript'),
				import('@shikijs/langs/typescript'),
				import('@shikijs/langs/tsx'),
				import('@shikijs/langs/svelte'),
				import('@shikijs/langs/python'),
				import('@shikijs/langs/bash')
			],
			// forgiving: a grammar pattern the runtime's RegExp can't express is
			// skipped instead of failing the whole highlight.
			engine: createJavaScriptRegexEngine({ forgiving: true })
		})
	);
	return highlighterPromise;
}

export async function highlightCode(code: string, lang: string): Promise<string> {
	const highlighter = await getHighlighter();
	return highlighter.codeToHtml(code, { lang, theme: 'github-dark-default' });
}
