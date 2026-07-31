---
title: Control doctor
---
# Control doctor

`control doctor` reports deployment readiness and posture for the target
stack.

It should check:

- configuration parsing and file permissions;
- CA, leaf, JWT, sealing, and at-rest encryption key usability;
- PostgreSQL authentication, schema state, and transaction health during
  consolidation;
- artifact and backup paths;
- backup age and replication lag;
- agent listener mTLS and revocation lookup;
- Traefik route and PROXY-protocol trust assumptions; and
- bounded scheduler/dispatcher progress from database rows.

After the final datastore port, the database checks switch to SQLite WAL,
`synchronous=FULL`, integrity, and backup state. There are no Gateway,
Valkey, Asynq, projector, or external-index checks.

The command must not print plaintext credentials or secret-bearing protobuf
fields.
