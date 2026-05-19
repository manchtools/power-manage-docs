import adapter from 'svelte-adapter-bun';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { markdoc } from 'svelte-markdoc-preprocess';

// Configurable hosted web-UI URL, baked into content at build time.
// Override via PUBLIC_WEB_UI_URL=https://app.example.com bun run build.
// Default is the production hosted instance.
const WEB_UI_URL = process.env.PUBLIC_WEB_UI_URL || 'https://app.power-manage.manchtools.com';

// Token-replacing preprocessor that runs before markdoc. Substitutes
// {{WEB_UI_URL}} (and any future {{TOKEN}} we register) in .md /
// .markdoc files so authors don't hard-code the hosted URL. Pure
// string replace — no AST work, so it can't break Markdoc syntax
// downstream as long as the value being injected doesn't contain
// Markdoc-significant chars (which a URL won't).
const tokens = {
	'{{WEB_UI_URL}}': WEB_UI_URL
};
const tokenReplacer = {
	name: 'pm-docs-token-replacer',
	markup({ content, filename }) {
		if (!filename || !/\.(md|markdoc)$/.test(filename)) return;
		let out = content;
		for (const [token, value] of Object.entries(tokens)) {
			if (out.includes(token)) {
				out = out.split(token).join(value);
			}
		}
		return out === content ? undefined : { code: out };
	}
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Three preprocessors, in order: token replacer rewrites
	// {{WEB_UI_URL}} etc. in .md/.markdoc sources; vitePreprocess
	// handles <style lang="postcss"> etc. in .svelte files; markdoc
	// turns the (now-substituted) .md/.markdoc content into a Svelte
	// component.
	//
	// `tags` and `nodes` for markdoc are paths to .svelte files that
	// re-export the components by name — svelte-markdoc-preprocess
	// parses the Svelte AST to find `export { default as Foo } from
	// '...'` declarations and auto-generates the Markdoc schema from
	// those. See src/lib/markdoc/tags.svelte + nodes.svelte.
	preprocess: [
		tokenReplacer,
		vitePreprocess(),
		markdoc({
			tags: './src/lib/markdoc/tags.svelte',
			nodes: './src/lib/markdoc/nodes.svelte',
			extensions: ['.md', '.markdoc']
		})
	],

	// Tell SvelteKit that .md and .markdoc files ARE Svelte
	// components (after the markdoc preprocessor runs over them). This
	// lets `import.meta.glob('/src/content/**/*.md')` resolve as if
	// each file were a `.svelte` source — Vite no longer tries to
	// parse them as JavaScript.
	extensions: ['.svelte', '.markdoc', '.md'],

	kit: {
		adapter: adapter(),
		csp: {
			directives: {
				'default-src': ['self'],
				// 'unsafe-inline' is a CSP Level 1 fallback: when SvelteKit
				// emits a nonce (prod, CSP Level 2+ browsers) the browser
				// ignores 'unsafe-inline' automatically and only trusts
				// nonced scripts. It matters during dev where Vite and
				// SvelteKit inject un-nonced inline scripts.
				'script-src': ['self', 'unsafe-inline'],
				'style-src': ['self', 'unsafe-inline'],
				'connect-src': ['self'],
				'img-src': ['self', 'data:'],
				'font-src': ['self'],
				'frame-ancestors': ['none']
			}
		},
		paths: {
			base: process.env.BASE_PATH || ''
		}
	}
};

export default config;
