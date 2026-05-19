# Installation

Power Manage deploys as a Compose stack. Six containers: Traefik, Postgres, Valkey (with RediSearch), the control server, the gateway, and the indexer. A `setup.sh` helper generates the cert chain, secrets, and `valkey.conf` so you don't have to assemble them by hand.

{% callout type="warn" title="No web UI is bundled" %}
The server stack does not include a web UI. It exposes a Connect-RPC API only. The web UI is a managed service at **{{WEB_UI_URL}}**. Point it at your control-server domain and sign in. It's not open-source; anyone needing a custom on-premise client builds their own against the Connect-RPC API. See [The web UI](/get-started/web-ui).
{% /callout %}

## Prerequisites

- A Linux host with Docker 24+ or Podman 4.5+ and the Compose plugin
- Two DNS names pointing at the host: one for the web UI (`control.example.com`), one for the agent gateway (`gateway.example.com`). If you plan to use the remote terminal, a third name (`tty.example.com`) too.
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

`setup.sh` prompts you through the required configuration and writes everything to `.env`. Re-running it is safe; existing values stay put unless you opt to regenerate them.

## What goes in `.env`

If you'd rather edit by hand, here's the shape of the file. The minimum to bring the stack up is:

```bash
# Domains
CONTROL_DOMAIN=control.example.com
GATEWAY_DOMAIN=gateway.example.com
GATEWAY_TTY_DOMAIN=tty.example.com   # only if you'll use the remote terminal
ACME_EMAIL=ops@example.com

# Database
POSTGRES_PASSWORD=<64 hex chars>
INDEXER_POSTGRES_PASSWORD=<64 hex chars>

# Valkey + Asynq HMAC
VALKEY_PASSWORD=<64 hex chars>
PM_TASK_SIGNING_KEY=<64 hex chars>

# Auth
JWT_SECRET=<at least 32 chars; longer is better>
CONTROL_ENCRYPTION_KEY=<64 hex chars>   # AES-256 for secrets-at-rest

# First admin (created on first boot only)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<strong password>
```

Optional toggles you may want to know about:

| Variable | Default | What it does |
|---|---|---|
| `CONTROL_ENCRYPTION_KEY_REQUIRED` | `true` | Fail-closed if `CONTROL_ENCRYPTION_KEY` is missing. Set to `false` to allow plaintext secrets in dev. |
| `CONTROL_PASSWORD_AUTH_ENABLED` | `true` | When `false`, password sign-in is disabled fleet-wide and only SSO works. |
| `CONTROL_SSH_ACCESS_FOR_ALL` | `false` | Auto-create `SSH` actions so every user can SSH to every device they have access to. |
| `DYNAMIC_GROUP_EVAL_INTERVAL` | `5m` | How often dynamic device groups recompute their membership. |

{% callout type="info" title="Passwords vs SSO" %}
For SSO-only deployments, set `CONTROL_PASSWORD_AUTH_ENABLED=false` *after* you've added at least one OIDC identity provider. Otherwise you'll lock yourself out: the bootstrap admin can't sign in if password auth is off and no SSO is configured.
{% /callout %}

## First boot

```bash
docker compose up -d
```

Traefik usually has certificates in under a minute. Once they're issued, sign in: open the web UI at **{{WEB_UI_URL}}**, point it at your control-server domain (`control.example.com`), and use the admin credentials from setup. The first sign-in is the only time the bootstrap admin uses its password; afterwards you should add a real SSO provider and treat the bootstrap account as break-glass.

For details on how the hosted UI talks to your server (and what it does *not* see), read [The web UI](/get-started/web-ui).

The stack runs six containers:

- **Traefik** terminates TLS and routes traffic. SNI-based TCP passthrough sends agent mTLS straight to the gateway.
- **Postgres** holds the event store and projections.
- **Valkey** runs the Asynq task queue, the search indexes (RediSearch), and short-lived auth state.
- **Control** serves the Connect-RPC API on `:8081` and the internal mTLS-protected `InternalService` on `:8082`.
- **Gateway** terminates agent mTLS, runs the bidirectional Connect-RPC stream on `:8080`, and exposes the terminal WebSocket on `:8443`.
- **Indexer** consumes events off Valkey and writes RediSearch indexes. Stateless. Run more than one if you want.

## Enrolling your first agent

On any Linux endpoint:

{% tabs labels="curl, manual" initial="curl" %}
{% tab label="curl" %}
```bash
curl -sSL https://control.example.com/install-agent.sh | sudo bash -s -- \
  --gateway https://gateway.example.com \
  --token <enrolment-token-from-web-UI>
```
{% /tab %}
{% tab label="manual" %}
```bash
sudo dpkg -i power-manage-agent_2026.06.0_amd64.deb
sudo pm-enroll \
  --gateway https://gateway.example.com \
  --token <enrolment-token-from-web-UI>
sudo systemctl enable --now power-manage-agent
```
{% /tab %}
{% /tabs %}

The agent registers through its local enrolment socket at `/run/pm-agent/enroll.sock`, gets a CA-signed client certificate (1-year validity, auto-renews at 80% lifetime), and starts heartbeating to the gateway. It shows up in the web UI within a few seconds.

## Health checks

- `https://control.example.com/health` returns `ok` (public; safe to point a load balancer at)
- The indexer's `:8082/health` is internal to the Docker network
- `docker compose ps` reports container health

If something looks wrong, `docker compose logs control gateway indexer --tail=200` is the first place to look.

## Next steps

- [Quick start](/get-started/quick-start) walks through the first end-to-end action
- [Architecture](/concepts/architecture) explains how the pieces fit together
- [Security model](/security/threat-model) lists the trust boundaries
