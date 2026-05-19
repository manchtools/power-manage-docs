# Power Manage Documentation

The public docs site for [Power Manage](https://github.com/manchtools/power-manage-server). SvelteKit 2 and Svelte 5 with Markdoc for content. Stack mirrors `web/`.

## Stack

- **SvelteKit 2** (Svelte 5, runes)
- **Markdoc** for content (via `svelte-markdoc-preprocess`)
- **Tailwind CSS 4** (`@tailwindcss/vite`)
- **shadcn-svelte** components (`bits-ui` as the headless primitive layer)
- **Shiki** for syntax highlighting (lazy-loaded on the client)
- **mermaid** for diagrams in `mermaid` code fences, themed via shadcn tokens
- **Pagefind** for full-text search (built into the static output at `build/pagefind/`)
- **`svelte-adapter-bun`** for the runtime
- **`mode-watcher`** for dark mode
- **Lucide** icons

## Development

```bash
bun install
bun run dev
```

Dev server runs at `http://localhost:5173`. Hot reload covers content: save any `.md` under `src/content/` and the page rebuilds.

## Authoring content

Drop a Markdown file under `src/content/<group>/<slug>.md`, then add an entry to the matching group in `src/lib/nav.ts`. The file system → URL mapping is automatic:

| File path | URL |
|---|---|
| `src/content/get-started/installation.md` | `/get-started/installation` |
| `src/content/foo/index.md` | `/foo` |
| `src/content/concepts/architecture.md` | `/concepts/architecture` |

Markdoc tags:

- `{% callout type="info|warn|danger|success" title="..." %}` for highlighted blocks
- `{% tabs initial="apt" %} {% tab label="apt" %} ... {% /tab %} {% /tabs %}` for tabbed content
- `{% screenshot src="dashboard.png" dark="dashboard-dark.png" alt="..." caption="..." /%}` for screenshots. See [Adding screenshots](src/content/operations/screenshots.md) for the workflow.
- Code fences (```` ```ts ````) get Shiki highlighting and a copy button
- Code fences with `mermaid` render as a mermaid diagram themed via shadcn tokens

Headings auto-generate anchors. The right-side TOC is built from the DOM at render time, so there's no separate index to maintain.

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
│   ├── security/
│   └── operations/
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
│       ├── tags.svelte              tag registry (Callout, Tabs, Tab, Screenshot)
│       ├── nodes.svelte             node overrides (Heading, Link, Fence)
│       └── components/              Callout, CodeBlock, Tabs, Tab, Screenshot, …
└── routes/
    ├── +layout.svelte               top-nav + sidebar shell
    ├── +layout.ts                   prerender = true
    ├── +page.svelte                 landing hero
    └── [...slug]/+page.{ts,svelte}  dynamic content route

static/
└── screenshots/                     PNG / WebP for {% screenshot %} tag
```

## Conventions

Patterns mirror `web/` where it makes sense:

- `cn()` for class merging (`clsx` plus `tailwind-merge`)
- `WithElementRef<T>` for shadcn-style `bind:ref` props
- `mode-watcher` for the dark-mode toggle
- Same Tailwind tokens. Copy any visual change between `web/src/app.css` and `docs/src/app.css` in lock-step.
- `@lucide/svelte/icons/*` for icons
- CSP wired in `svelte.config.js` via `kit.csp.directives`
- Defensive headers in `src/hooks.server.ts`

## License

MIT. The docs content under `src/content/` is Power Manage project documentation under the same license as the project.
