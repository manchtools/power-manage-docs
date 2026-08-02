---
title: FAQ
---
# FAQ

## Which database should I deploy?

None. Control embeds SQLite in WAL mode with `synchronous=FULL` and owns the
database file directly. There is no database service to run.

## Which search service should I run?

None. Control uses SQLite FTS5 with an application-owned matcher.

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

The SQLite database, artifacts, CA/key material, and deployment configuration.
Replicate database and artifacts off-host and monitor backup age and lag.
