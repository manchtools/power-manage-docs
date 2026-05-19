import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(process.env.APP_VERSION || 'dev'),
		__BASE_PATH__: JSON.stringify(process.env.BASE_PATH || '/')
	},
	plugins: [tailwindcss(), sveltekit()],
	server: {
		// Match web/ — allow *.localhost so the docs preview can
		// share the cookie scope with the main app when an operator
		// is running everything locally.
		allowedHosts: ['.localhost']
	}
});
