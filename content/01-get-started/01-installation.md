---
title: Installation
---
# Installation

<!-- docref: begin src=server:deploy/compose.yml:652fa868,server:deploy/setup.sh:f721854f -->
power-manage deploys as a Compose stack. Six containers: Traefik, Postgres, Valkey (Redis-compatible; runs the Asynq queue and the search indexes), the control server, the gateway, and the indexer. A `setup.sh` helper generates the cert chain, secrets, and `valkey.conf` so you don't have to assemble them by hand.
<!-- docref: end -->

{% callout type="warn" title="No web UI is bundled" %}
The server stack does not include a web UI. It exposes a Connect-RPC API only. The web UI is a managed service at [{{WEB_UI_URL}}]({{WEB_UI_URL}}). Point it at your control-server domain and sign in. It's not open-source; anyone needing a custom on-premise client builds their own against the Connect-RPC API. See [The web UI](/get-started/web-ui).
{% /callout %}

## Prerequisites

- Docker 24+ or Podman 4.5+ and the Compose plugin
- Two DNS names pointing at the host: one for the control server to point the web UI at (`control.example.com`), one for the agent gateway (`gateway.example.com`). If you plan to use the remote terminal, a third name (`tty.example.com`) too.
- TCP port 443 reachable from the public internet (Traefik handles Let's Encrypt; the gateway uses SNI-based TCP passthrough)
- `openssl` and `bash` on the host

{% callout type="warn" title="Linux endpoints only" %}
The agent runs on Linux. There is no Windows or macOS build planned. If you need cross-platform endpoint management, this isn't the tool.
{% /callout %}

## Setup

```bash
git clone https://github.com/manchtools/power-manage-server.git
cd power-manage-server/deploy
./setup.sh
```

<!-- docref: begin src=server:deploy/setup.sh:f721854f -->
`setup.sh` prompts you through the required configuration on a fresh install and writes everything to `.env`. Re-running it is safe. Any non-placeholder `.env` value is kept silently; to rotate a value, edit `.env` directly and re-run. You'll be asked before regenerating any certificate under `deploy/certs/`. The rendered `valkey.conf` is always rewritten from the current `.env`, so a password change there picks up on next run.
<!-- docref: end -->

## What goes in `.env`

<!-- docref: begin src=server:deploy/.env.example:2daedfcb,server:cmd/control/flags.go#validateJWTSecretStrength:455b6cee,server:cmd/control/admin_user.go#ensureAdminUser:f0dbf778 -->
If you'd rather edit by hand, here's the shape of the file (`deploy/.env.example` is the annotated reference). The minimum to bring the stack up is:

```bash
# Domains
CONTROL_DOMAIN=control.example.com
GATEWAY_DOMAIN=gateway.example.com
GATEWAY_TTY_DOMAIN=tty.example.com   # only if you'll use the remote terminal
ACME_EMAIL=ops@example.com

# Database
POSTGRES_PASSWORD=<64 hex chars>
INDEXER_POSTGRES_PASSWORD=<64 hex chars>

# Redis + Asynq HMAC
VALKEY_PASSWORD=<64 hex chars>
PM_TASK_SIGNING_KEY=<64 hex chars>

# Auth
JWT_SECRET=<at least 32 chars; longer is better>
CONTROL_ENCRYPTION_KEY=<64 hex chars>   # AES-256 for secrets-at-rest

# First admin (created on first boot only)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<strong password>
```
<!-- docref: end -->

Optional toggles you may want to know about:

<!-- docref: begin src=server:cmd/control/flags.go#applyEnvOverrides:41b51197,server:cmd/control/setup.go#seedSSHAccessForAll:dd6ef865,server:cmd/control/flags.go#clampDurations:6460bc95 -->
| Variable | Default | What it does |
|---|---|---|
| `CONTROL_PASSWORD_AUTH_ENABLED` | `true` | When `false`, password sign-in is disabled fleet-wide and only SSO works. |
| `CONTROL_SSH_ACCESS_FOR_ALL` | `false` | Auto-create `SSH` actions so every user can SSH to every device they have access to. |
| `DYNAMIC_GROUP_EVAL_INTERVAL` | `1h` | How often the server drains the dynamic-group re-evaluation queue. Clamped to a min of `30m` and a max of `8h` — values outside that range are rounded into the range at startup; `0` disables the worker. |
<!-- docref: end -->

{% callout type="info" title="Passwords vs SSO" %}
For SSO-only deployments, set `CONTROL_PASSWORD_AUTH_ENABLED=false` *after* you've added at least one OIDC identity provider. Otherwise you'll lock yourself out: the bootstrap admin can't sign in if password auth is off and no SSO is configured.
{% /callout %}

## First boot

```bash
docker compose up -d
```

<!-- docref: begin src=server:cmd/control/admin_user.go#ensureAdminUser:f0dbf778 -->
Traefik usually has certificates in under a minute. Once they're issued, sign in: open the web UI at **{{WEB_UI_URL}}**, point it at your control-server domain (`control.example.com`), and use the admin credentials from setup. The admin account is created on first boot only; afterwards you should add a real SSO provider and treat the bootstrap account as break-glass.
<!-- docref: end -->

For details on how the hosted UI talks to your server (and what it does *not* see), read [The web UI](/get-started/web-ui).

The stack runs six containers:

<!-- docref: begin src=server:deploy/compose.yml:652fa868,server:cmd/control/flags.go#parseFlags:d739daf2,server:internal/config/config.go#FromEnv:76de60f2,server:cmd/indexer/main.go:259813c9 -->
- **Traefik** terminates TLS and routes traffic. SNI-based TCP passthrough sends agent mTLS straight to the gateway.
- **Postgres** holds the event store and projections.
- **Valkey** runs the Asynq task queue, the search indexes (valkey-search), and short-lived auth state.
- **Control** serves the Connect-RPC API on `:8081` and the internal mTLS-protected `InternalService` on `:8082`.
- **Gateway** terminates agent mTLS and runs the bidirectional Connect-RPC stream on `:8080`. When the remote terminal is configured, a separate cleartext terminal-WebSocket listener (`GATEWAY_WEB_LISTEN_ADDR`, `:8443` in the reference stack) runs behind Traefik's TLS termination.
- **Indexer** consumes events off Valkey and writes the search indexes. Stateless. Run more than one if you want.
<!-- docref: end -->

## Enrolling your first agent

<!-- docref: begin src=agent:install.sh:a9f2b6bc -->
The agent ships as a single `install.sh` published with every release. It downloads the binary, sets up the `power-manage-agent` systemd unit, and enrols against the control server in one step. There's no `.deb` or `.rpm` package today; the curl pipe is the only supported install path.
<!-- docref: end -->

On any Linux endpoint, generate an enrolment token from the web UI (**Devices** → **Enrolment tokens** → **Create token**) and then:

```bash
curl -fsSL https://github.com/manchtools/power-manage-agent/releases/latest/download/install.sh \
  | sudo bash -s -- \
    -s https://control.example.com \
    -t <enrolment-token-from-web-UI>
```

Use `--pre` to install the latest release candidate instead of the stable release.

Useful flags (`--help` for the full list):

<!-- docref: begin src=agent:install.sh:a9f2b6bc -->
| Flag | Default | What it does |
|---|---|---|
| `-s, --server URL` | — | Control-server URL the agent enrols against |
| `-t, --token TOKEN` | — | Registration token from the web UI |
| `--pre` | off | Install the latest prerelease instead of stable |
| `-v, --version VERSION` | `latest` | Pin to a specific release tag (e.g. `v2026.06`) |
| `-d, --data-dir DIR` | `/var/lib/power-manage` | Override the agent's data directory |
| `-b, --binary PATH` | `/usr/local/bin/power-manage-agent` | Where the agent binary lives |
| `--skip-download` | off | Use the binary already on disk at `-b` instead of fetching |
| `--uninstall` | — | Remove the agent and its config |
<!-- docref: end -->

<!-- docref: begin src=agent:internal/deviceauth/enroll_server.go#EnrollSocketPath:9838543e,server:cmd/control/flags.go#parseFlags:d739daf2,agent:cmd/power-manage-agent/cert_rotation.go#renewAt:211ccaeb -->
The install script registers the agent through a local enrolment socket at `/run/pm-agent/enroll.sock`. The control server signs a client certificate (1-year validity, auto-renews at 80% lifetime), and the agent starts heartbeating to the gateway. It shows up in the web UI within a few seconds.
<!-- docref: end -->

### Enrolment tokens

<!-- docref: begin src=sdk:proto/pm/v1/control.proto#CreateTokenRequest:2554f6a6,server:internal/api/token_handler.go#TokenHandler.CreateToken:9e712a3f -->
A registration token is 256 bits of random material; the server stores only its SHA-256 hash and shows you the plaintext exactly once, at creation. Tokens come in two shapes: **one-time** (consumed by the first successful enrolment) and **reusable**, with an optional `max_uses` cap (`0` means unlimited) and an optional `expires_at` deadline.
<!-- docref: end -->

<!-- docref: begin src=server:internal/api/token_handler.go#TokenHandler.CreateToken:9e712a3f -->
Ownership decides what happens to the enrolled device. A token created with an `owner_id` auto-assigns every device it enrols to that user. Left empty, the token is *ownerless* — no auto-assignment, which is what you want for bulk or imaging enrolment. Users holding only the scoped `CreateToken:self` permission can't choose: the server forces a one-time token with a 7-day expiry, owned by the creator, and ignores any supplied `owner_id`.
<!-- docref: end -->

<!-- docref: begin src=server:internal/api/token_handler.go#TokenHandler.RenameToken:1287d030,server:internal/api/token_handler.go#TokenHandler.SetTokenDisabled:d6640374,server:internal/api/token_handler.go#TokenHandler.DeleteToken:c5f43c8a -->
Tokens can be renamed, disabled (and re-enabled), or deleted after creation; disabling is the kill switch for a leaked reusable token without losing its audit trail.
<!-- docref: end -->

### Re-enrolling an existing install

If you ever need to swap to a different control server or refresh credentials after a CA rotation, the binary itself accepts an `enroll` subcommand:

```bash
sudo power-manage-agent enroll \
  -server https://control.example.com \
  -token <fresh-token>
```

<!-- docref: begin src=agent:cmd/power-manage-agent/cmd_enroll.go#runEnroll:4f4de41c,agent:cmd/power-manage-agent/cmd_enroll.go#parseRegistrationURI:b09edc79 -->
Or the equivalent URI form: `power-manage-agent enroll 'power-manage://control.example.com?token=<token>'`. Both go through the same enrolment socket the install script uses, just without re-downloading the binary.
<!-- docref: end -->

## Health checks

<!-- docref: begin src=server:cmd/control/main.go#main:997b3c43,server:cmd/indexer/main.go#main:2b6178cf -->
- `https://control.example.com/health` returns `ok` (public; safe to point a load balancer at)
- The indexer's `:8090/health` is internal to the Docker network
- `docker compose ps` reports container health
<!-- docref: end -->

If something looks wrong, `docker compose logs control gateway indexer --tail=200` is the first place to look.

## Next steps

- [Quick start](/get-started/quick-start) walks through the first end-to-end action
- [Architecture](/concepts/architecture) explains how the pieces fit together
- [Security model](/security/threat-model) lists the trust boundaries
