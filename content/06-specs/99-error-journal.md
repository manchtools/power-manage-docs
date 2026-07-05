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
