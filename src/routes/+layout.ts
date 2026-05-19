// Force pre-rendering of every page in the site. The docs are
// static — there's no per-request server state — and pre-rendering
// gives us:
//   - sub-50ms first-byte from a CDN
//   - Pagefind can crawl the built site to produce the search index
//   - no Node runtime needed in prod; the bun adapter still produces
//     a tiny server but Cloudflare/Pages-style hosting works without it
export const prerender = true;

// Single-page-app-style transitions are nice for docs (you keep the
// sidebar mounted, only the main content area swaps). SvelteKit
// handles this automatically when both prerender + ssr are true.
export const ssr = true;

// Disable trailing slashes — matches the [...slug] route shape and
// avoids /concepts/architecture/ and /concepts/architecture being
// treated as two pages in the Pagefind index.
export const trailingSlash = 'never';
