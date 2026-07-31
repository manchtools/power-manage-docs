---
title: Troubleshooting
---
# Troubleshooting

Start with control readiness, the database, and the device's direct connection.
The target stack has no Gateway, Valkey, queue worker, projector, or separate
indexer to inspect.

## Control is not ready

Check that:

- the PostgreSQL schema is current;
- CA, JWT, sealing, and at-rest encryption keys are readable with safe
  permissions;
- artifact and backup paths are writable;
- the agent listener can query revocation state; and
- Traefik routes the API and SNI passthrough listeners correctly.

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

During consolidation, inspect the owning CRUD row and its PostgreSQL FTS
document in the same transaction domain. There is no asynchronous external
search index to rebuild. After the final datastore port, inspect the
corresponding FTS5 row.

## Suspected secret leak

Stop collecting broad debug output. Preserve metadata, identify the classified
field and sink, rotate the exposed value, and verify the field-sealing and
logging guards before restoring diagnostics.
