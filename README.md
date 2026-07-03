# power-manage Documentation

Source for the public docs site at
[power-manage.docs.manchtools.com](https://power-manage.docs.manchtools.com).

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
  03-action-reference/           ← grouped by category, one page per action
    index.md                     ← "Overview"
    01-packages-and-updates/     PACKAGE, UPDATE, REPOSITORY, DEB, RPM, APP_IMAGE, FLATPAK
    02-system/                   SHELL, SCRIPT_RUN, SERVICE, FILE, DIRECTORY, REBOOT, SYNC
    03-identity-and-access/      USER, GROUP, SSH, SSHD, ADMIN_POLICY, LPS
    04-security-and-networking/  ENCRYPTION, WIFI
    05-lifecycle/                AGENT_UPDATE
  04-security/...
  05-operations/...
  06-specs/                      feature specs (point-in-time; not docref-scanned)
adr/                             decisions about the docs site itself
static/                          favicons, OG card, screenshots
compose.yml                      runtime composition (open-docs:latest)
docref.toml / docref.lock        docref config + pinned code-repo revisions
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

### docref — docs stay anchored to code

Content in `content/01-…05-` is anchored to the server/agent/sdk code
with [docref](https://github.com/manchtools/open-docref): behavioral
claims carry `<!-- docref: begin src=server:… -->` markers whose hashes
pin the exact code they describe. The sibling repos are declared as
aliases in `docref.toml` and pinned to origin/main revisions in
`docref.lock`.

- Run all docref commands **from this repo's root**.
- `docref check` must exit 0 before pushing content changes.
- New prose that asserts code behavior gets a claim
  (`docref claim server:path#Symbol` prints a paste-ready block —
  never hand-write hashes).
- After code lands in a sibling repo: `docref update`, re-read any
  claims that went stale, fix or `docref approve`, commit the lock.
- `content/06-specs/` and `adr/` are deliberately outside the scan
  (point-in-time artifacts).

## Deploying

`compose.prod.yml` reuses the power-manage Traefik that already runs
the server stack, but on its **own** network — docs and the server
workloads can't reach each other; only Traefik bridges them.

One-time setup on the deploy host:

```sh
# 1. Clone the docs repo
git clone https://github.com/manchtools/power-manage-docs.git
cd power-manage-docs

# 2. Bring up the docs container (creates the `power-manage-docs`
#    network as a side-effect of `docker compose up`).
docker compose -f compose.prod.yml up -d

# 3. Wire Traefik into the docs network so it can route to us.
#    Persists across docs restarts; only needs re-running if Traefik
#    itself is recreated.
docker network connect power-manage-docs pm-traefik
```

Traefik picks the container up by label and serves HTTPS at
`power-manage.docs.manchtools.com` via the existing `letsencrypt`
resolver. No host port is exposed; the only ingress is through
Traefik.

Updating content is a `git pull` plus
`docker compose -f compose.prod.yml up -d --force-recreate`. The
container is stateless — restart rebuilds.

If you recreate Traefik often, make the wiring durable by adding
`power-manage-docs` to the `traefik` service's `networks:` list in
`server/deploy/compose.yml` (and declaring it as `external: true`
there).

## License

This repository (docs content and assets) is [MIT](./LICENSE), the same
license as the [open-docs](https://github.com/manchtools/open-docs)
engine that renders it.

The power-manage components are licensed individually — check each
repo's LICENSE before reusing code:

| Repo | License |
|---|---|
| docs (this repo) | MIT |
| sdk | MIT |
| server | AGPL-3.0 |
| agent | GPL-3.0 |
| web | see repo |
