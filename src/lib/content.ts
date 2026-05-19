import { error } from '@sveltejs/kit';

// Content loader. svelte-markdoc-preprocess turns every .md / .markdoc
// file under src/content/** into a Svelte component, but the file
// system mapping ("which slug → which import") has to live somewhere
// the [...slug] route can consult at request time.
//
// We use Vite's import.meta.glob with `eager: false + import: 'default'`
// to produce a slug → lazy-loader map at build time. The route awaits
// the loader and renders the resulting component.
//
// Indexing rules:
//   - src/content/introduction.md          →  ""           (landing)
//   - src/content/get-started/install.md   →  "get-started/install"
//   - src/content/foo/index.md             →  "foo"        (group index)
//
// Anything outside src/content/ is invisible to the docs site — keep
// drafts in a separate directory or behind a `.draft.md` extension.

type MdLoader = () => Promise<{ default: unknown }>;

const modules = import.meta.glob<{ default: unknown }>('/src/content/**/*.{md,markdoc}');

// Build the slug map once at module init.
const slugMap: Record<string, MdLoader> = {};
for (const [path, loader] of Object.entries(modules)) {
	// '/src/content/get-started/install.md' → 'get-started/install'
	const slug = path
		.replace(/^\/src\/content\//, '')
		.replace(/\.(md|markdoc)$/, '')
		.replace(/\/index$/, '');
	slugMap[slug] = loader;
}

export function listSlugs(): string[] {
	return Object.keys(slugMap);
}

export async function loadContent(slug: string): Promise<{ default: unknown }> {
	const loader = slugMap[slug] ?? slugMap[slug + '/index'];
	if (!loader) {
		throw error(404, `No content for ${slug || '/'}`);
	}
	return loader();
}
