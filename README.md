# Power Manage Documentation

The public docs site for [Power Manage](https://github.com/manchtools/power-manage-server) — a SvelteKit 2 / Svelte 5 + Markdoc app, modelled on the same stack as `web/`.

## Stack

- **SvelteKit 2** (Svelte 5, runes)
- **Markdoc** for content (via `svelte-markdoc-preprocess`)
- **Tailwind CSS 4** (`@tailwindcss/vite`)
- **shadcn-svelte** components (`bits-ui` as the headless primitive layer)
- **Shiki** for syntax highlighting (lazy-loaded on the client)
- **Pagefind** for full-text search (built into the static output at `build/pagefind/`)
- **`svelte-adapter-bun`** for the runtime
- **`mode-watcher`** for dark mode
- **Lucide** icons

## Development

```bash
bun install
bun run dev
```

The dev server runs at `http://localhost:5173`. Authoring is hot-reload: save any `.md` under `src/content/` and the page rebuilds.

## Authoring content

Drop a Markdown file under `src/content/<group>/<slug>.md`, then add an entry to the matching group in `src/lib/nav.ts`. The file system → URL mapping is automatic:

| File path | URL |
|---|---|
| `src/content/get-started/installation.md` | `/get-started/installation` |
| `src/content/foo/index.md` | `/foo` |
| `src/content/concepts/architecture.md` | `/concepts/architecture` |

Markdoc custom tags available:

- `{% callout type="info\|warn\|danger\|success" title="..." %}` — highlighted block
- `{% tabs %} {% tab label="apt" %} ... {% /tab %} {% /tabs %}` — tabbed content
- Code fences (```` ```ts ````) get Shiki highlighting + copy button automatically

Headings get auto-generated anchors. The right-side TOC is built from the DOM after render, so no separate index needs maintaining.

## Build

```bash
bun run build
```

Produces `build/` (static + SvelteKit prerendered HTML) and `build/pagefind/` (the search index).

## Project layout

```
src/
├── app.css                          shadcn theme tokens + .prose styles
├── content/                         the .md files
│   ├── get-started/
│   ├── concepts/
│   ├── action-reference/
│   └── security/
├── lib/
│   ├── content.ts                   slug → loader map (via import.meta.glob)
│   ├── nav.ts                       editorial sidebar order
│   ├── utils.ts                     cn() + WithElementRef
│   ├── components/
│   │   ├── sidebar.svelte
│   │   ├── top-nav.svelte
│   │   ├── theme-toggle.svelte
│   │   ├── toc.svelte
│   │   ├── prev-next.svelte
│   │   └── ui/                      shadcn-svelte components
│   └── markdoc/
│       ├── config.ts                tags + node overrides
│       └── components/              Callout, CodeBlock, Tabs, Tab, …
└── routes/
    ├── +layout.svelte               top-nav + sidebar shell
    ├── +layout.ts                   prerender = true
    ├── +page.svelte                 landing hero
    └── [...slug]/+page.{ts,svelte}  dynamic content route
```

## Conventions

Mirrors `web/` wherever it makes sense:

- `cn()` helper for class merging (`clsx` + `tailwind-merge`)
- `WithElementRef<T>` type for shadcn-style `bind:ref` props
- `mode-watcher` for the dark-mode toggle
- Same Tailwind theme tokens — copy any visual change between `web/src/app.css` and `docs/src/app.css` in lock-step
- `@lucide/svelte/icons/*` for icons
- CSP wired in `svelte.config.js` via `kit.csp.directives`
- Defensive headers in `src/hooks.server.ts`

## License

MIT. The docs content itself (everything under `src/content/`) is Power Manage project documentation — same license as the project.
