.PHONY: dev build preview check check-watch install clean

# Dev-mode preset for the hosted web-UI URL. `make dev` bakes this
# value into the rendered docs so {{WEB_UI_URL}} resolves to your
# local web app instance without any extra env setup. Override on the
# command line if you want a one-off different value:
#
#   make dev DEV_WEB_UI_URL=http://localhost:3000
#
DEV_WEB_UI_URL ?= http://localhost:5174

# Build-time tokens that pass through to the bun subprocess. `export`
# covers all the ways an operator might set them: shell env, make
# argument, or a .env file Bun auto-loads. Add new build-time tokens
# here so they propagate the same way.
export PUBLIC_WEB_UI_URL
export BASE_PATH

# Install dependencies. Bun is the package manager; npm + package-lock
# work too but slower.
install:
	bun install

# Development server with hot-reload on .md / .markdoc changes. Token
# substitution ({{WEB_UI_URL}}, see svelte.config.js) runs through the
# same preprocessor as prod, so PUBLIC_WEB_UI_URL controls the
# rendered value in dev too. The shell `${VAR:-default}` form means:
# if the operator already set PUBLIC_WEB_UI_URL in env / .env / make
# arg, that wins; otherwise fall back to the DEV_WEB_UI_URL preset
# defined at the top of this Makefile.
#
# Changing the env mid-session needs a `make dev` restart — the
# preprocessor caches per source file.
dev:
	PUBLIC_WEB_UI_URL=$${PUBLIC_WEB_UI_URL:-$(DEV_WEB_UI_URL)} bun run dev

# Production build. Pipeline:
#   1. vite build — emits prerendered HTML to build/prerendered/
#   2. pagefind --site build/prerendered --output-path build/client/pagefind
#   3. scripts/strip-pagefind-html.ts — rewrites .pf_fragment URLs to
#      match SvelteKit's clean routes (drops .html, /index → /).
#
# No DEV_WEB_UI_URL fallback here — production picks up either the
# operator's PUBLIC_WEB_UI_URL or the prod default baked into
# svelte.config.js.
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
