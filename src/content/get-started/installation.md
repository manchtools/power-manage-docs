# Installation

Power Manage runs as a Compose stack: Postgres, Valkey, Traefik, the control server, the gateway, and an indexer. A helper script generates the cert chain, secrets, and `valkey.conf` so you don't have to.

## Prerequisites

- A Linux host with Docker 24+ or Podman 4.5+ and the Compose plugin
- Two DNS names pointing at the host: one for the web UI (`control.example.com`), one for the agent gateway (`gateway.example.com`)
- TCP port 443 reachable from the internet (Traefik handles Let's Encrypt)
- `openssl` and `bash` on the host

{% callout type="warn" title="Linux only" %}
The agent runs on Linux. There is no Windows or macOS build planned. If you need cross-platform endpoint management, look elsewhere.
{% /callout %}

## Setup

Clone the deploy repo and run the interactive setup:

```bash
git clone https://github.com/manchtools/power-manage-server.git
cd power-manage-server/deploy
./setup.sh
```

`setup.sh` asks for:

- Control and gateway domain names
- Let's Encrypt email
- Postgres and Valkey passwords
- `CONTROL_ENCRYPTION_KEY` (AES-GCM, 64 hex chars)
- `PM_TASK_SIGNING_KEY` (HMAC, 64 hex chars; shared between control, gateway, indexer)
- Initial admin email and password

Values get written to `.env`. Re-running the script is safe; existing values stay put unless you choose to regenerate them.

## First boot

```bash
docker compose up -d
```

Traefik usually has certificates in under a minute. After that, open `https://control.example.com` and sign in with the admin credentials from setup.

{% callout type="info" title="Health checks" %}
The control server exposes `/health` publicly (returns `ok`). Version info sits behind the gateway-side mTLS listener for monitoring you control.
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

The agent registers through its local enrolment socket, gets a CA-signed client certificate, and starts heartbeating to the gateway. It shows up in the web UI within a few seconds.
