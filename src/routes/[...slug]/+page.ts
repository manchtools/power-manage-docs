import type { PageLoad } from './$types';
import { listSlugs, loadContent } from '$lib/content';

// Pre-render every content slug we know about. `entries` returns the
// list of `params` SvelteKit should crawl during the build. Adding a
// new .md under src/content/ automatically extends this list — no
// manual registration step.
export const entries = () => {
	return listSlugs().map((slug) => ({ slug }));
};

export const load: PageLoad = async ({ params }) => {
	const slug = params.slug;
	const mod = await loadContent(slug);
	return {
		component: mod.default,
		currentHref: '/' + slug
	};
};
