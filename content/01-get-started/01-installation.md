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

The consolidation deployment contains:

- Traefik as the only internet-facing component;
- one control process;
- PostgreSQL; and
- an artifact directory plus an off-host backup destination.

PostgreSQL remains intentionally while the server is converted to CRUD,
database-backed jobs, a dedicated audit log, and PostgreSQL full-text search.
SQLite and FTS5 replace it only in the final datastore port.

The web UI remains a separate client. Agents initiate one outbound mTLS
connection that Traefik TCP-passes directly to control's dedicated agent
listener. Control never dials a managed device.

## Prerequisites

- A Linux host with Docker and Compose
- One HTTPS/API DNS name and one SNI name for the agent listener
- TCP 443 reachable by administrators and enrolled agents
- Durable storage for PostgreSQL, artifacts, certificates, and backups
- An OIDC provider and, when provisioning is required, SCIM

The final SQLite deployment removes the PostgreSQL service but keeps the same
public RPC and agent contract.

## Initial setup

Use the deployment tooling shipped with the consolidation branch. It must:

1. create or accept the control CA;
2. generate secure deployment secrets without printing them;
3. validate file ownership and permissions;
4. configure Traefik's HTTPS route and SNI TCP passthrough route;
5. initialize PostgreSQL and the control schema; and
6. create a short-lived, single-use bootstrap-admin URL.

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
