---
title: "Error journal"
status: live
order: 99
description: Append-only record of systematic errors and the Harness fixes that prevent recurrence. Every entry must have a corresponding rule update in a CLAUDE.md or skill file.
---

# Error journal

This is an append-only record. Each entry captures a systematic error,
its root cause, and the Harness fix that prevents recurrence. The error
journal is part of Harness Correction Development — when the agent makes
a mistake, fix the rules, not just the output.

## Format

```markdown
## [YYYY-MM-DD] [Error class] Brief description

**What happened**: [One sentence]

**Root cause**: [Why the Harness didn't prevent this]

**Harness fix**: [What file was updated and how]

**Prevention**: [How the updated rule prevents recurrence]
```

## Entries

<!-- Entries are appended below this line. Never delete entries. -->

## [2026-07-05] [Drifted from spec] Snapshot target was a plaintext projection dump instead of the replayed ciphertext events

**What happened**: The spec-19 retention snapshot was implemented as a serialized dump of the (decrypted, plaintext) projection tables via a pg_temp shadow replay, and that dump was written into the cold archive. This put plaintext PII into archives and would have let a snapshot-based restore reproduce PII even with the DEK table empty — defeating crypto-shred and contradicting AC 21a and the spec's "cold archives hold only ciphertext PII."

**What the user said**: "You should have replayed the events until event n as the snapshot target and not use the projections as a snapshot target. This was explicitly stated."

**Root cause**: The snapshot's *purpose* (a restorable state@N) was conflated with its *storage form*. In an event-sourced system with crypto-shred, the archive must store the ciphertext EVENTS ≤ N (whose PII is DEK-sealed and therefore shreddable); the projection state is a derived, plaintext view that must never be the archived artifact. The spec stated "replay events ≤ N" — replay is the mechanism, the events are the artifact — but it was read as "materialize the projection and serialize it."

**Harness fix**: spec-driven-dev skill — added a rule: when a feature both (a) archives/exports event-sourced state and (b) has a cryptographic erasure ("crypto-shred") requirement, the archived artifact MUST be the ciphertext events, never a decrypted projection/materialized view; restore re-derives state by replaying those events (so a missing DEK yields the redaction sentinel, honoring erasure).

**Prevention**: Any future "snapshot / archive / export of derived state" design first asks: does an erasure guarantee apply to this data? If yes, archive the shreddable ciphertext source (events), not the plaintext derived view, and prove it with a "restore with the key material absent → sentinel" test (AC 21a class).

## [2026-07-16] [Silent failure] Synthetic datastore tests did not exercise the deploy stack

**What happened**: Spec-32 tests proved PostgreSQL/Valkey mTLS and basic ACLs with synthetic testcontainer configurations, but alpha3's real deployment still failed through the guided-setup path, Docker file-bind mounts, container UID key permissions, missing Pub/Sub channel ACLs, and repeated gateway TLS `bad certificate` signals whose source identity was not covered by the original smoke scope.

**What the user said**: "why dont any of the tests surface this? It should not be to hard having the inital stack startup and run in tandom" and "we really need a solid e2e test for deployment."

**Root cause**: The verification scope stopped at transport primitives and hand-written minimal container configs. It did not boot `setup.sh` + `compose.yml` + `valkey.conf.template` + `pg_hba.conf` together with the real images, reproduce root-owned `0600` key mounts and entrypoint UID drops, subscribe to production Pub/Sub channels, or scan service logs for TLS handshake failures. Green primitive tests were incorrectly treated as proof of deployability.

**Harness fix**: The project `CLAUDE.md` now requires `deploy/smoke-test.sh` for every deploy/TLS/auth/entrypoint/ACL change, requires it to gate releases, requires production ownership/mode reproduction, and expands failure signatures to include `TLS handshake error` and `bad certificate` as well as ACL/connection failures. The release workflow and deploy-smoke workflow run the real Compose-stack test on GitHub-hosted Docker.

**Prevention**: Deploy changes cannot ship based only on synthetic testcontainers, container health, passive log scans, or a growing list of hand-picked probes. The real artifacts must start as a group; a generated-client E2E matrix must invoke every externally reachable RPC and service trust path; a protobuf-descriptor exact-set guard must fail when any RPC lacks a deployed scenario; and the stack must remain free of ACL, permission, connection, and TLS-identity errors before release manifests are published.

## [2026-07-16] [Wrong scope] Hand-picked deploy probes still left unexecuted RPCs

**What happened**: After adding a real Compose health/log smoke gate, the Search RPC still returned 500 because no E2E request executed search as the deployed `pm-control` ACL user. The proposed response was to add one production-shaped `FT.SEARCH` probe, which would fix the observed gap but preserve the underlying whack-a-mole test strategy.

**What the user said**: "no the correct anwer is to spinup the stack and test every path and RPC"

**Root cause**: The harness strengthened infrastructure realism but still scoped verification around known failure signatures and selected paths. It lacked a completeness invariant connecting the protobuf RPC surface to deployed E2E scenarios.

**Harness fix**: Project `CLAUDE.md` now requires the real deployment gate to invoke every externally reachable RPC through generated clients, drive each service trust path, and enforce an exact-set registry keyed by procedure plus stream arm, credential or peer-trust class, and expected outcome, with duplicate, stale, missing, and matches-zero guards.

**Prevention**: A healthy stack with no passive log errors is no longer considered deploy-verified. Every required procedure/arm/trust-path/outcome combination must produce its expected real response or rejection through the running stack, and a new or changed surface makes CI red until the complete scenario matrix is registered.
