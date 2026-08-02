---
title: Installation
---
# Installation

{% callout type="warn" title="Consolidation in progress" %}
This page describes the approved deployment target. Until the consolidation
work lands, a development branch may still contain legacy services. Do not
deploy Gateway, Valkey, Asynq, or a separate indexer as part of the target
stack.
{% /callout %}

## Target stack

The deployment contains:

- Traefik as the only internet-facing component;
- one control process with an embedded SQLite database; and
- an artifact directory plus an off-host backup destination.

There is no separate database service. Control owns a SQLite file in WAL mode
with `synchronous=FULL`, and search runs on SQLite FTS5.

The web UI remains a separate client. Agents initiate one outbound mTLS
connection that Traefik TCP-passes directly to control's dedicated agent
listener. Control never dials a managed device.

## Prerequisites

- A Linux host with Docker and Compose
- One HTTPS/API DNS name and one SNI name for the agent listener
- TCP 443 reachable by administrators and enrolled agents
- Durable storage for the database file, artifacts, certificates, and backups
- An OIDC provider and, when provisioning is required, SCIM

## Initial setup

Use the deployment tooling shipped with the server. It:

1. creates or accepts the control CA;
2. generates secure deployment secrets without printing them;
3. validates file ownership and permissions;
4. configures Traefik's HTTPS route and SNI TCP passthrough route;
5. creates the SQLite database and its baseline schema on first start; and
6. creates a short-lived, single-use bootstrap-admin URL.

There are no local user passwords or local TOTP accounts. Use the bootstrap
URL once to configure OIDC/SCIM and establish the real administrator identity.

## Enrolling an agent

Create an enrolment token in the web UI, then install and enrol the agent on
the Linux endpoint using the release's installer. The device generates its own
Ed25519 identity key and CSR; its private key never leaves the device.

After enrolment, the agent connects directly to control with mTLS. Re-enrolment
is a clean operation: remove the agent state directory and enrol again with a
fresh token. Pre-alpha agents are reinstalled, not migrated through
compatibility shims.

## Readiness

Control is ready only when the database schema is current, CA and key material
are usable, artifact paths are writable, and the agent listener can enforce
certificate revocation. Backup lag is reported separately.

## Next steps

- [Quick start](/get-started/quick-start)
- [The web UI](/get-started/web-ui)
- [mTLS and device identity](/security/mtls)
- [Deployment hardening](/security/deployment-hardening)
