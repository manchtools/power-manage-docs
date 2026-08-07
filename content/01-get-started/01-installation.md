---
title: Installation
---
# Installation

## Target stack

The deployment contains:

- Traefik as the only internet-facing component;
- one control process with an embedded SQLite database; and
- an artifact directory plus an audit archive and backup destination on a
  filesystem of its own.

There is no separate database service. Control owns a SQLite file in WAL mode
with `synchronous=FULL`, and search runs on SQLite FTS5.

The web UI remains a separate client. Agents initiate one outbound mTLS
connection that Traefik TCP-passes directly to control's dedicated agent
listener. Control never dials a managed device.

## Prerequisites

- A Linux host with Docker and Compose
- One HTTPS/API DNS name and one SNI name for the agent listener
- TCP 443 reachable by administrators and enrolled agents
- Durable storage for the database file, artifacts, and certificates
- A **second filesystem** for the audit archive and backups. The archive path
  (`POWER_MANAGE_BACKUP_PATH`) must be a filesystem distinct from the one
  holding the database. Control checks this at startup and **refuses to start**
  when the two share a mount, naming both paths. Evidence that shares a disk
  with the records it attests to is not evidence: one root account, one disk
  failure, or one ransomware pass takes the audit rows and their proof
  together. A second local mount satisfies the check; remote storage under
  separate credentials is what the property is for. Mount that storage at the
  archive path or point a symlink at it — either arrangement works, because the
  check follows symlinks.
- An OIDC provider and, when provisioning is required, SCIM

## Initial setup

Use the deployment tooling shipped with the server. It:

1. creates the state, artifact and archive directories, then refuses — before
   generating anything else — when the archive would share a filesystem with
   the database, naming both paths;
2. creates or accepts the control CA;
3. generates secure deployment secrets without printing them;
4. validates file ownership and permissions;
5. configures Traefik's HTTPS route and SNI TCP passthrough route; and
6. writes control's configuration.

Because the archive check runs before any key material is generated, an install
that stops there leaves an empty directory tree. Provide the storage and run the
setup step again.

Control itself creates the SQLite database and its baseline schema the first
time it starts.

Once the stack is up, issue the administrator setup URL yourself with
`docker compose exec control control bootstrap-admin`. There are no local user
passwords or local TOTP accounts. Use that short-lived, single-use URL once to
configure OIDC/SCIM and establish the real administrator identity.

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
