# Installation

Power Manage ships as a Compose stack with five containers: Postgres, Valkey, Traefik, the control server, the gateway, and an indexer. The `setup.sh` helper renders the cert chain, secrets, and `valkey.conf` for you.

## Prerequisites

- Linux host with **Docker 24+** or **Podman 4.5+** and the Compose plugin.
- Two DNS names that resolve to the host: one for the web UI (e.g. `control.example.com`), one for the agent gateway (`gateway.example.com`).
- TCP port 443 reachable from the public internet (Traefik handles Let's Encrypt).
- `openssl` and `bash` on the host.

{% callout type="warn" title="Linux only" %}
The control + gateway servers are designed for Linux endpoints. Agents do not run on Windows or macOS. If you need cross-platform management, this isn't the tool.
{% /callout %}

## Setup

Clone the deploy repo and run the interactive setup:

```bash
git clone https://github.com/manchtools/power-manage-server.git
cd power-manage-server/deploy
./setup.sh
```

`setup.sh` will prompt for:

- Control + gateway domain names
- Let's Encrypt email
- Postgres + Valkey passwords
- `CONTROL_ENCRYPTION_KEY` (AES-GCM, 64 hex chars)
- `PM_TASK_SIGNING_KEY` (HMAC, 64 hex chars — shared between control, gateway, indexer)
- Initial admin email + password

All generated values are written to `.env`. Re-running `setup.sh` is idempotent — existing values are kept unless you explicitly opt to regenerate.

## First boot

```bash
docker compose up -d
```

Once Traefik has acquired certificates (usually under a minute), visit `https://control.example.com` and sign in with the admin credentials you set during setup.

{% callout type="info" title="Health checks" %}
The control server reports readiness at `/health` (public, returns `ok`). The internal mTLS-protected endpoint at the gateway-side listener carries version info for operator-controlled monitoring.
{% /callout %}

## Enrolling your first agent

On any Linux endpoint:

{% tabs initial="curl" %}
{% tab label="curl" %}
```bash
curl -sSL https://control.example.com/install-agent.sh | sudo bash -s -- \
  --gateway https://gateway.example.com \
  --token <enrolment-token-from-web-UI>
```
{% /tab %}
{% tab label="manual" %}
```bash
sudo dpkg -i power-manage-agent_2026.05.0_amd64.deb
sudo pm-enroll \
  --gateway https://gateway.example.com \
  --token <enrolment-token-from-web-UI>
sudo systemctl enable --now power-manage-agent
```
{% /tab %}
{% /tabs %}

The agent registers via the local enrolment socket, receives a CA-signed client certificate, and immediately starts streaming heartbeats to the gateway. You'll see it appear in the web UI within seconds.
