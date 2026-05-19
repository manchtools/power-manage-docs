import adapter from 'svelte-adapter-bun';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { markdoc } from 'svelte-markdoc-preprocess';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Two preprocessors: vitePreprocess for <style lang="postcss"> etc.
	// in regular .svelte files, and markdoc() so any *.md or
	// *.markdoc file is preprocessed into a Svelte component at
	// build time.
	//
	// `tags` and `nodes` are paths to .svelte files that re-export
	// the components by name — svelte-markdoc-preprocess parses
	// the Svelte AST to find `export { default as Foo } from '...'`
	// declarations and auto-generates the Markdoc schema from those.
	// See src/lib/markdoc/tags.svelte + nodes.svelte.
	preprocess: [
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
