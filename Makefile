.PHONY: dev build preview check check-watch install clean

# Install dependencies. Bun is the package manager; npm + package-lock
# work too but slower.
install:
	bun install

# Development server. Hot-reloads on .md / .markdoc changes via the
# svelte-markdoc-preprocess preprocessor.
dev:
	bun run dev

# Production build. Runs `vite build` then `pagefind --site build`
# to produce the search index alongside the static assets.
build:
	bun run build

# Preview the production build locally.
preview:
	bun run preview

# Type check via svelte-check.
check:
	bun run check

check-watch:
	bun run check:watch

clean:
	rm -rf node_modules build .svelte-kit
