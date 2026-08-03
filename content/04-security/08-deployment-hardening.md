---
title: Deployment hardening
---
# Deployment hardening

## Network boundary

- Expose only Traefik.
- Route browser/API HTTPS to control's web listener.
- TCP-pass agent SNI traffic to control's dedicated mTLS listener.
- Isolate the optional PROXY-protocol listener so only Traefik can reach it.
- Do not mount the Docker socket into Traefik.
- Do not deploy Gateway, Valkey, Asynq, or a separate indexer.

## Data

Control embeds SQLite in WAL mode with `synchronous=FULL`. Restrict the database
file and the backup path to control with strict filesystem permissions; there is
no database port to expose or authenticate.

Mount artifacts and backups explicitly. Run `backup.sh` from a host timer and
check the last verified backup with `docker compose exec control control
backup-status`, which reports stale once that backup is older than
`POWER_MANAGE_BACKUP_MAX_LAG` (26 hours by default). Copying backups off-host
is your own transport; monitor it with your own tooling. A temporary
backup-destination outage never takes the control plane offline: backup age is
not part of readiness, and the optional `POWER_MANAGE_WEBHOOK_URL` carries the
backup-lag notification when you set it.

## Keys and secrets

Keep CA keys, JWT signing keys, sealing keys, and at-rest encryption keys in
restricted files or deployment-secret mechanisms. There are no database
credentials. Setup must never print generated credentials.

Classified agent/control fields use X25519 sealing in transit. At-rest secrets
use AES-256-GCM with resource-context AAD. Diagnostic export is allowlist-based
and redacted.

## Identity

Configure OIDC and SCIM, then retire the bootstrap URL. Enforce MFA and account
recovery policy at the IdP.
