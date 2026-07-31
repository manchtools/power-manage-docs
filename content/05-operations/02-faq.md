---
title: FAQ
---
# FAQ

## Which database should I deploy?

PostgreSQL during consolidation. SQLite is the final target, but the port
happens only after CRUD, audit, dispatch, and search semantics are stable.

## Which search service should I run?

None. Control uses PostgreSQL full-text search during consolidation and FTS5
after the final SQLite port.

## Do I need Valkey or Asynq?

No. Durable work lives in database tables. An in-process signal improves
latency and a database sweep guarantees recovery.

## Do I need a Gateway?

No. Agents make one outbound mTLS connection directly to control through
Traefik TCP passthrough.

## Are agent messages signed?

Ordinary application frames are not separately signed. Direct mTLS protects
the stream. Classified secret fields are additionally X25519-sealed to prevent
generic protobuf/debug logging from seeing plaintext.

## How do administrators sign in?

OIDC only, with SCIM for provisioning. Configure MFA at the identity provider.
The bootstrap-admin URL is a one-time setup path, not a local account.

## What must I back up?

During consolidation: PostgreSQL, artifacts, CA/key material, and deployment
configuration. After the final port: the SQLite database, artifacts, keys, and
configuration. Replicate database and artifacts off-host and monitor backup
age and lag.
