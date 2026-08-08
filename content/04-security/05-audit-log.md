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

The archive path (`POWER_MANAGE_BACKUP_PATH`) must be a filesystem distinct
from the one holding the database. Control checks this at startup and
**refuses to start** when the two share a mount, naming both paths. Evidence
that shares a disk with the records it attests to is not evidence: one root
account, one disk failure, or one ransomware pass takes the audit rows and
their proof together. A second local mount satisfies the check; remote storage
under separate credentials is what the property is for.

Verification compares an archived object against the digest recorded in the
append-only checkpoint inside the database, never against the digest stored
beside the object. The sidecar file in the archive directory describes what an
object claims to be and is not evidence — anyone able to rewrite the artifact
can rewrite that file in the same operation.

Verification fails closed. Once an anchor has been published, the archive must
still hold the object it names and every checkpoint's archived prefix must
still be present; a missing or contradicting object is reported as a failure,
not passed over. A deployment that has never anchored anything is the one case
that verifies successfully without an anchor.

## Secrets and erasure

Secret values never enter audit payloads. Fields are limited to durable
references, non-reversible fingerprints, or explicitly required detail
encrypted under a per-subject key. Erasure removes ordinary personal state and
destroys that subject key while preserving non-personal attribution.
