import type { Handle } from '@sveltejs/kit';

// Same defensive headers as web/src/hooks.server.ts. CSP is wired
// via svelte.config.js kit.csp so SvelteKit can emit a nonce in
// production; these are the headers SvelteKit's csp config doesn't
// cover.
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

	return response;
};
