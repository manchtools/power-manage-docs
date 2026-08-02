---
title: Troubleshooting
---
# Troubleshooting

Start with control readiness, the database, and the device's direct connection.
The target stack has no Gateway, Valkey, queue worker, projector, or separate
indexer to inspect.

## Control is not ready

Control serves `/health` and `/ready` on both the public and the agent
listener. `/health` is liveness only and always answers while the process is
up. `/ready` re-checks the dependencies that can change after startup:

- the database answers;
- the revocation lookup the agent listener needs works; and
- the artifact path is writable.

Configuration, file permissions, the SQLite schema version, and the CA, JWT,
sealing, and at-rest encryption key material are validated while control
starts. Control refuses to start rather than serving with unusable material, so
these never appear as a readiness failure.

Backup age is deliberately not part of readiness: a backup-destination outage
must not take the control plane offline. Inspect it with `docker compose exec
control control backup-status`, which exits non-zero when the last success is
older than `backup_max_lag`.

If readiness passes but clients cannot reach control, check that Traefik routes
the API and the SNI passthrough listener correctly.

## Agent is offline

Check DNS, TCP 443, the agent systemd journal, certificate validity, and
revocation state. Control never dials the device. Reinstall and re-enrol a
pre-alpha agent when its local identity or durable state is intentionally
discarded.

## Work is pending

Pending work is a delivery row in the database. Confirm the device is
connected, the connection epoch is current, and the dispatcher sweep is
running. Do not create a parallel queue or manually mint a second delivery ID.

## Search is wrong

Inspect the owning CRUD row and its FTS5 search document, which are written in
the same transaction. There is no asynchronous external search index to
rebuild.

## Suspected secret leak

Stop collecting broad debug output. Preserve metadata, identify the classified
field and sink, rotate the exposed value, and verify the field-sealing and
logging guards before restoring diagnostics.
