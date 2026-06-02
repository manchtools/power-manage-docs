# power-manage Documentation

Source for the public docs site at
[docs.power-manage.manchtools.com](https://docs.power-manage.manchtools.com).

This repo holds only **content + assets**. The rendering engine is
[open-docs](https://github.com/manchtools/open-docs), shipped as a
container image — bring up `compose.yml` and you get a searchable,
themed docs site.

## Layout

```
content/                         markdown source
  theme.css                      power-manage fuchsia brand overrides
  01-get-started/                ← group order from NN- prefix
    01-installation.md           ← page order from NN- prefix
    02-web-ui.md
    03-quick-start.md
  02-concepts/...
  03-action-reference/
    index.md                     ← "Overview"
    01-package.md ... 23-agent-update.md
  04-security/...
  05-operations/...
static/                          favicons, OG card, screenshots
compose.yml                      runtime composition (open-docs:latest)
```

The sidebar is derived entirely from the folder tree (numeric
prefixes set order; frontmatter `title:` / `label:` set the displayed
text). There is no nav config file to maintain.

## Run locally

```sh
docker compose up
# → http://localhost:3000
```

The container builds the site at start (~30s) with the mounted
content baked in. Re-run `docker compose up -d --force-recreate`
after editing markdown.

## Authoring

### Frontmatter

```markdown
---
title: PACKAGE                   # full page heading override
label: LPS (password rotation)   # short sidebar label override (optional)
order: 2                         # within-group sort (optional; the NN- prefix sets it by default)
---
```

### Markdoc tags

Available out of the box from open-docs:

- `{% callout type="info|warn|danger" title="…" %} … {% /callout %}`
- `{% screenshot src="dashboard.png" alt="…" /%}`
- `{% tabs %} {% tab title="…" %} … {% /tab %} {% /tabs %}`
- `{% steps %} {% step %} … {% /step %} {% /steps %}`
- `{% cards %} {% card title="…" href="…" %} … {% /card %} {% /cards %}`
- `{% accordions %} {% accordion title="…" %} … {% /accordion %} {% /accordions %}`
- `{% filetree %}…{% /filetree %}`
- `{% badge variant="…" %}…{% /badge %}`
- `{% embed src="…" /%}`

### Tokens

`{{WEB_UI_URL}}` in markdown resolves to the value of
`PUBLIC_TOKEN_WEB_UI_URL` set in `compose.yml` (currently
`https://app.power-manage.manchtools.com`). Add new tokens by setting
more `PUBLIC_TOKEN_*` env vars in the compose service.

### Screenshots

Drop new shots into `static/screenshots/` and reference them with
`{% screenshot src="my-shot.png" alt="..." /%}`. The tag prefixes
`/screenshots/` automatically.

## Deploying

`compose.prod.yml` drops the docs onto the power-manage Traefik that
already runs the server stack. On the deploy host:

```sh
git clone https://github.com/manchtools/power-manage-docs.git
cd power-manage-docs
docker compose -f compose.prod.yml pull
docker compose -f compose.prod.yml up -d
```

The container joins the `pm-internal` network (created by
`server/deploy/compose.yml`) and Traefik picks it up by label —
HTTPS-only on `power-manage.docs.manchtools.com`, Let's Encrypt
certificate via the existing `letsencrypt` resolver. No host port is
exposed; the only ingress is through Traefik.

Updating content is a `git pull` plus
`docker compose -f compose.prod.yml up -d --force-recreate`. The
container is stateless — restart rebuilds.

## License

[MIT](./LICENSE) — same as open-docs and the rest of power-manage.
