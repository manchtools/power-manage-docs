---
title: Audit log
---
# Audit log

The audit log is append-only evidence. Application state is ordinary CRUD and
is never rebuilt from audit rows.

## Operation model

Each logical request or background operation receives one `operation_id`.
The database stores:

- one operation row with actor, origin, request class, authorization result,
  and overall outcome; and
- zero or more effect rows with resource, action, safe before/after fields,
  and effect outcome.

For a mutation, the initial audit rows and state change commit in one database
transaction. If audit persistence fails, the state change fails too. Delivery
and later result rows retain the same operation ID.

## Coverage

Shared mutation primitives enforce coverage. Exact-set tests enumerate
state-changing RPCs, sensitive reads, rejected authentication, SCIM routes,
scheduled jobs, enrollment, retention, and other background writers.

## Integrity and retention

Normal application credentials cannot update or delete audit rows. Each stream
is hash-chained and its head is anchored off-host. Retention archives and
verifies a chain prefix before deleting it, then commits a checkpoint for the
deleted boundary.

## Secrets and erasure

Secret values never enter audit payloads. Fields are limited to durable
references, non-reversible fingerprints, or explicitly required detail
encrypted under a per-subject key. Erasure removes ordinary personal state and
destroys that subject key while preserving non-personal attribution.
