.PHONY: dev build preview check check-watch install clean

# Build-time / dev-time configurables. `export` forwards them to the
# `bun run …` subprocesses regardless of which form the operator uses:
#
#   make dev                                                # defaults
#   PUBLIC_WEB_UI_URL=https://app.example.com make dev      # shell var
#   make dev PUBLIC_WEB_UI_URL=https://app.example.com      # make arg
#   echo PUBLIC_WEB_UI_URL=… > .env && make dev             # Bun reads .env
#
# Add new build-time tokens here so they pass through the same way.
export PUBLIC_WEB_UI_URL
export BASE_PATH

# Install dependencies. Bun is the package manager; npm + package-lock
# work too but slower.
install:
	bun install

# Development server with hot-reload on .md / .markdoc changes. Token
# substitution ({{WEB_UI_URL}}, see svelte.config.js) runs through the
# same preprocessor as prod, so PUBLIC_WEB_UI_URL controls the rendered
# value in dev too. Changing the env var while dev is running needs a
# restart — the preprocessor caches per source file.
dev:
	bun run dev

# Production build. Pipeline:
#   1. vite build — emits prerendered HTML to build/prerendered/
#   2. pagefind --site build/prerendered --output-path build/client/pagefind
#   3. scripts/strip-pagefind-html.ts — rewrites .pf_fragment URLs to
#      match SvelteKit's clean routes (drops .html, /index → /).
build:
	bun run build

# Preview the production build via the bun adapter's server (not
# vite preview — that one doesn't serve build/client/pagefind).
preview:
	bun run preview

# Type check via svelte-check.
check:
	bun run check

check-watch:
	bun run check:watch

clean:
	rm -rf node_modules build .svelte-kit
