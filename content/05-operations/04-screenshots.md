---
title: Adding screenshots
---
# Adding screenshots

Walkthroughs read better with screenshots of the web UI alongside the prose. Here's the workflow.

## Where they live

All screenshots go under `docs/static/screenshots/`. Vite serves `static/` at the root path, so a file at `docs/static/screenshots/dashboard.png` is reachable at `/screenshots/dashboard.png` when the docs are running, and the `{% screenshot %}` tag knows to prefix that path automatically.

```
docs/static/screenshots/
├── dashboard.png
├── dashboard-dark.png         # optional dark-mode variant
├── devices-list.png
├── devices-list-dark.png
└── ...
```

The `.gitkeep` in there is so the directory exists in fresh clones; once you've committed real screenshots you can remove it.

## How to capture

Use the same browser DPR (device pixel ratio) for all screenshots so the set looks consistent. The recommendation is **DPR 2** captured at logical **1440 × 900**. The resulting 2880 × 1800 PNG scales down cleanly on retina displays and stays sharp at half-size on standard ones.

For Chrome / Edge: DevTools → device toolbar → "Responsive" → set the DPR to 2 manually. For Firefox: `about:config` → `layout.css.devPixelsPerPx` = 2.

Crop to the relevant chrome. If you're showing the **Devices** list, you don't need the global navigation in the shot. The `{% screenshot %}` tag wraps the image in a faux-browser frame already, so you don't need to capture browser chrome.

## Light and dark variants

Take both. The docs respect the operator's theme; a single light-mode screenshot looks broken at night.

Convention: append `-dark.png` to the dark version.

```
dashboard.png       # light
dashboard-dark.png  # dark
```

The tag does the rest:

```markdoc
{% screenshot
   src="dashboard.png"
   dark="dashboard-dark.png"
   alt="The control-server dashboard showing 14 connected agents"
   caption="The dashboard after enrolling the first agent" /%}
```

If you only ship a light version, omit `dark=`. The single image renders in both modes (with the obvious tradeoff in dark mode).

## Compression

PNG is fine for UI screenshots. Run them through `oxipng` once to drop ~30% of the bytes without quality loss:

```bash
oxipng -o 4 --strip safe docs/static/screenshots/*.png
```

If you have very-image-heavy pages, convert to WebP:

```bash
cwebp -q 90 dashboard.png -o dashboard.webp
```

The tag's `src=` accepts any extension the browser supports.

## Examples

A frame-wrapped screenshot with caption:

```markdoc
{% screenshot
   src="actions-new.png"
   dark="actions-new-dark.png"
   alt="The 'New action' modal with PACKAGE type selected and curl filled in"
   caption="Creating the 'Install curl' action" /%}
```

A flat (un-framed) shot, useful for partial-UI close-ups:

```markdoc
{% screenshot
   src="execution-detail.png"
   alt="An execution-result row showing the apt-get install output"
   variant="flat"
   width="640px" /%}
```

Both variants support an optional `width=` override (default is the prose column width).

## What to avoid

- **Personal data.** Use seeded demo data. The hosted UI has a `?demo=1` query param that swaps in deterministic fake fleets; point your demo control server at the same data set so every shot is reproducible.
- **API tokens or JWTs.** Even the URL bar of a fresh screenshot can leak. The faux-browser frame the tag draws has no URL bar deliberately.
- **Logos or names from real customers.** Same reason.
- **Drift.** A docs screenshot from six versions ago is misleading. When the UI changes, the screenshot referenced in the prose needs to too. A `grep -r "{% screenshot" src/content` after a UI release shows you what to re-shoot.
