---
title: "Audit-log retention, archival & PII erasure"
status: draft
created: 2026-07-04
---

# Audit-log retention, archival & PII erasure

## Overview

The event store is append-only and unbounded: it grows forever and has no
retention, no archival, and no way to erase a person's data. This spec adds
three linked capabilities on top of the event-sourcing core: (1) **retention**
— a rolling snapshot + prune worker that caps the live event log at a
configured window and moves older history to integrity-sealed cold archives
through a pluggable storage backend; (2) **PII erasure** — per-user envelope
encryption of personal data anywhere in the event log so deleting a user
(which always erases them) is satisfied by destroying one key ("crypto-shred"),
without ever mutating the append-only log; and (3) **observability** —
`control doctor` reports retention posture and the key-material invariants.
Together these make the audit log compliant (GDPR Art 5(1)(e) storage
limitation + Art 17 erasure, SOC 2, NIS2) and operable at scale without
discarding the tamper-evidence and 1:1-replay guarantees established in
server#498 (ADR 0029).

## Motivation

server#498 made the event log the tamper-evident, replay-authoritative source
of truth — and in doing so made two gaps sharper:

- **It grows forever.** No retention violates storage-limitation expectations
  and eventually makes replay/backup impractical.
- **It can't forget anyone.** The append-only trigger
  (`events_block_mutation`, `009_v2026_07.sql`) that makes the log
  tamper-evident also makes `DELETE`/`UPDATE` impossible — so a person's PII,
  once appended, is permanent, and archived copies would make it more permanent
  still. That is irreconcilable with GDPR erasure unless erasure is achieved
  cryptographically.

Both are prerequisites for a hosted (SaaS) offering. Tracked as
server#502 / #503 (2026.08).

## Design summary

- **PII envelope encryption.** On user creation (any path — local, SCIM, OIDC)
  the server mints a random per-user data-encryption key (DEK), stores it
  wrapped under the **KEK — the existing at-rest `CONTROL_ENCRYPTION_KEY`**, the
  same key that already encrypts LPS/LUKS/IdP/TOTP secrets (ADR 0001/0009); every
  DEK in the system wraps under this one KEK — in a new mutable
  `user_encryption_keys` table, and encrypts every PII field of any event
  payload — on any stream — under the subject user's DEK before append. The projector decrypts at projection-build time, so
  projection rows hold plaintext (queryable; encrypted at rest at the
  **deployment layer** — see Rollout).
- **Fail-closed at append.** The log is immutable — plaintext PII written once
  is unerasable forever. If a live user's DEK is missing or fails to unwrap at
  append time, the append **fails**; plaintext PII is never written as a
  fallback.
- **PII fields are code-declared, self-discovered, stream-agnostic.** A PII
  field carries `pii:"true"` on its typed payload; the crypto layer walks
  payloads by reflection and encrypts exactly the tagged fields under the DEK of
  the **subject user the payload resolves**. For user-stream events the subject
  is `stream_id`; off-stream PII (identity links, terminal-admin membership)
  must carry the owning `user_id` — `IdentityLinkLoginUpdated` currently omits it
  and gains it here. A guard test fails any tagged field that does not (a)
  round-trip through a DEK or (b) resolve an owner.
- **Delete erases, on every path.** There is no separate erase operation:
  deletion always crypto-shreds. Both `DeleteUser` (API) and the SCIM delete
  path emit `UserDeleted` from different packages, so the shred lives in a
  **shared deletion flow** — one transaction appends `UserDeleted` and deletes
  the DEK — that both call. The `UserDeleted` projector then soft-deletes the row
  and overwrites its PII columns with a fixed **redaction sentinel**
  (`"[redacted]"` — never ciphertext, never null), so live delete and rebuild
  share one path.
- **Unwrap-failure is not erasure.** A **missing** DEK row is the graceful
  erased state (project the redaction sentinel). A DEK row that is **present but
  cannot be unwrapped** (wrong KEK, corruption) is a fault: the projector /
  `RebuildAll` **aborts** rather than projecting a sentinel, so a KEK
  misconfiguration cannot masquerade as mass erasure.
- **Erased users never re-provision.** A redacted user must never be provisioned
  onto devices (no `redacted@example.com` Linux account), and this holds without
  any projector change, via three existing invariants the spec pins (Section E):
  (1) `RebuildAll` runs only rebuild appliers — `SystemActionListener` is a
  live-only `RegisterEventListener`, so a restore dispatches nothing; (2) the
  live path can't fire for a deleted user — `AffectedFromEvent` ignores
  `UserDeleted`, and `SyncUserSystemActions` gets an explicit fail-closed
  delete-state check at the generation choke point; (3) teardown
  (`CleanupDeletedUserActions`) already runs from the pre-delete snapshot before
  the shred, so the steady state is "actions ABSENT." Projectors stay pure;
  doctor is the safety net.
- **Crypto-shred mechanics.** Destroying the one `user_encryption_keys` row
  makes every copy of that person's PII — live log, cold archives, future
  rebuilds — permanently unreadable at once. The append-only log is never
  touched.
- **The non-recoverable exception.** `user_encryption_keys` is the sole piece of
  **durable, non-recoverable, non-event-sourced** Postgres state (amends ADR
  0029): it cannot be event-sourced (that would make it un-destroyable) and
  cannot be regenerated (random key material). It is jointly authoritative with
  the event log and the single most backup-critical table in the system.
- **Rolling snapshot + prune.** A scheduled, advisory-lock-single-flighted
  worker chooses a global checkpoint `sequence_num` N, captures a **projection
  snapshot equal to the deterministic replay of events ≤ N** atomically with the
  choice of N, writes `{snapshot, events ≤ N}` as one integrity-sealed archive
  artifact, then deletes events ≤ N via a privileged path that appends a
  tamper-evident `EventLogPruned` event in the same transaction.
  `RebuildAll` = restore latest snapshot + replay events `> N`.
- **Pluggable archive storage.** Cold archives are written through a streaming
  `ArchiveStore` interface, mirroring the SDK backend pattern: a **filesystem**
  backend (v1) with room for **S3-compatible** and others, no prune-worker
  change.
- **Doctor observability.** `control doctor` reports retention posture and both
  key invariants (no live user missing a DEK; no `UserDeleted` user still holding
  one). It observes; the worker enforces.

## Dependencies & prerequisites

This spec builds on foundations the 2026-07-04 tech-debt audit
(`server/TECH_DEBT_AUDIT.md`) found missing or unsafe. Each must land **before**
this spec's implementation, because the retention/erasure design assumes them:

- **Single-format at-rest encryption** (enc:v2→single `enc:v1` AAD, beta
  cleanup, Path A / reprovision). All wrapping uses one AAD-bound primitive. This
  also finishes the WS10 deferral / **audit F-06** (IdP/TOTP secrets currently
  encrypted without AAD) — collapsing to one AAD format requires migrating them.
- **F-01 — `RebuildAll` needs a production entry point.** The snapshot-restore +
  replay-`>N` contract is unreachable today: `RebuildAll` is test-only. A
  `control rebuild-projections [target…]` subcommand (doctor pattern) must exist
  so an operator — and the prune/restore path — can actually invoke replay.
- **F-03 — partial rebuild must be CASCADE-safe.** `RebuildAll("users")` today
  TRUNCATE-CASCADEs `totp_projection` + `identity_links_projection` and never
  replays them (the #497 data-loss class via the partial path). Snapshot-restore
  replays a subset by definition, so the FK-cascade-closure auto-include (or
  refusal) must be in place first, or a restore silently drops 2FA/SSO.
- **F-05 (PII subset) — typed payloads for PII-bearing emit sites.** The
  `pii:"true"` mechanism is reflection over **typed** payload structs. SCIM
  (36 sites), idp, totp, and the identity-link events still emit
  `map[string]any` — so the identity-link PII (`external_email`/`external_name`)
  this spec encrypts **cannot be tagged until those sites are converted**.
  Convert at least the PII-bearing emit sites (SCIM, idp, totp, identity-link)
  to `eventtypes/payloads` structs first.

Related audit findings this spec **absorbs** (below as ACs, not prerequisites):
F-04 (full-fidelity round-trip = AC 17), F-02 (drift detection in doctor), F-07
(append-completeness guard extended to the SCIM surface this spec touches).

## Acceptance criteria

### A. PII envelope encryption

1. Given a new user created through any provisioning path (local, SCIM, OIDC),
   when the user is materialised, then exactly one `user_encryption_keys` row
   exists for that user ULID, holding a DEK wrapped under the KEK in the single
   AAD-bound at-rest format, and no plaintext DEK is ever persisted.
2. Given any typed event payload with `pii:"true"` fields — on any stream — when
   it is appended, then each tagged field is stored ciphertext under the subject
   user's DEK and no plaintext PII appears in the `events` row; untagged fields
   are unchanged.
3. Given the payload registry, when the guard test runs, then every `pii:"true"`
   field (a) round-trips through a DEK encrypt/decrypt and (b) resolves a subject
   `user_id`; a tagged field failing either fails the test. The PII set is
   self-discovered from the tags, never hardcoded.
4. Given PII-bearing events for a user with an intact DEK, when the projector
   builds the projection, then rows hold the correct **plaintext** PII
   (decrypt-on-insert), and a `RebuildAll` reproduces them 1:1.
5. Given the `user_encryption_keys` table, when the schema-classification guard
   (server#498) runs, then the table is classified `operational` with the
   "durable non-recoverable crypto-shred key material" justification.
6. **Fail-closed append.** Given a live user whose DEK row is missing or fails to
   unwrap, when a PII-bearing event for that user is appended, then the append
   fails with an error — plaintext PII is never written to the event log.

### B. Erasure via delete (crypto-shred)

7. Given an authorised deletion, when it executes, then the user's
   `user_encryption_keys` row is deleted and a `UserDeleted` event is appended in
   one transaction; the `UserDeleted` projector soft-deletes the row and
   overwrites its PII columns with the redaction sentinel `"[redacted]"`.
8. **Shred on every delete path.** Given a user deleted via the SCIM DELETE path,
   when the deletion completes, then the DEK is destroyed and PII redacted
   identically to an API `DeleteUser` (both route through the shared flow).
9. Given a deleted user (missing DEK), when any PII-bearing event is replayed,
   then the projector treats the missing DEK as the graceful erased state,
   projects the redaction sentinel, and completes — it does not abort (parity
   with `ErrSkipEvent`, #498).
10. **Unwrap-failure is a fault, not erasure.** Given a user whose DEK row exists
    but cannot be unwrapped, when the projector or `RebuildAll` processes a
    PII-bearing event, then it aborts with an error — it does not project the
    sentinel. Only a missing DEK row is the graceful erased state.
11. Given a deleted user, when `RebuildAll` runs, then their projection PII
    reproduces as the redaction sentinel while all live users reproduce 1:1.
12. Given a deleted user, when their `actor_id` (a plaintext ULID pseudonym, not
    encrypted) appears on unrelated events, then those events remain valid and
    replayable, and the mapping `actor_id → person` — which lived only in the
    user's now-unreadable PII and the redacted projection — is severed: an
    auditor sees `actor_id = "01J…"` with no way to recover that it was
    `alice@example.com`. This is **pseudonymization, not anonymization** (a
    meaningful GDPR distinction; sufficiency depends on the legal basis) — the
    accepted residual-risk posture, see Security.
13. **No existence oracle.** Given a caller whose scope does not unconditionally
    cover the target, when deletion targets a non-existent ULID, then the
    response is `NotFound` — indistinguishable from an out-of-scope existing
    target. Given a target the caller can see that is already deleted, the call
    is idempotent (OK, no orphaned writes, DEK stays absent).
14. Given deletion where the DEK delete fails (DB error), when it runs, then the
    transaction rolls back — no `UserDeleted` event, no projection change
    (all-or-nothing; no half-erased state).
15. **Re-add mints a fresh DEK.** Given a deleted (erased) user, when a new user
    is created with the same email, then creation succeeds (the erased row is
    `is_deleted = true`, excluded from the active-email unique index), a new DEK
    is minted, and the old user's event ciphertext remains permanently
    unreadable.

### C. Retention: snapshot, prune, archive

16. Given a configured retention window and a live log older than it, when the
    prune worker runs under its advisory lock, then it chooses a global
    checkpoint `sequence_num` N and captures a projection snapshot equal to the
    deterministic replay of events ≤ N, atomically with the choice of N.
17. **Snapshot equivalence (catches double-apply), proven full-fidelity.** Given a
    prune at checkpoint N, when a subsequent `RebuildAll` (restore snapshot +
    replay `> N`) runs, then it reproduces projection state **byte-identical to a
    rebuild performed before the prune** — compared as a **full-row dump of every
    `AllRebuildTargets` table** (ordered `SELECT *`), not a sampled subset of
    columns (absorbs F-04: proves "replay reproduces 1:1" per-column, not
    spot-checked; self-discovering so new targets are covered).
17a. **Projector determinism — enforced statically, not just tested.** The
    integration tests (AC 16–17) catch non-determinism only if the offending
    input happens to differ between the two runs; a `time.Now()` added to a
    projector can pass CI by coincidence. The **enforcement** is the gap: given
    the projector set, a **static guard** fails the build if any `Apply*` reads a
    non-deterministic source — the WS0 module-wide clock seam already bans
    `time.Now()`, extended here to forbid unseeded `math/rand` and
    order-dependent map iteration. The guard, not the test, is what keeps
    snapshot equivalence (AC 17) true as the code evolves.
18. Given a checkpoint N and its snapshot, when prune proceeds, then
    `{snapshot, events ≤ N}` is written through the configured `ArchiveStore`
    backend as one integrity-sealed artifact **before** any deletion.
19. Given a durably-written archive at N, when prune deletes events ≤ N, then the
    deletion occurs only through the privileged prune path, and a single
    `EventLogPruned{up_to_seq: N, archive_ref, archive_sha256}` event is appended
    **within the same transaction**.
20. Given the append-only trigger (`009_v2026_07.sql`), when any actor other than
    the sanctioned prune path attempts `DELETE`/`UPDATE`/`TRUNCATE` on `events`,
    then it is still rejected (regression pin of #498).
21. Given pruned history and a later `RebuildAll`, when it runs, then it restores
    the latest snapshot and replays events `> N`; rebuild-from-empty is documented
    not to reach pruned history, and a projector-bug fix re-derives only events
    `> N` (corruption captured into a snapshot is permanent — an inherent cost).
21a. **The event log alone is no longer sufficient for recovery.** Given a
    `RebuildAll` with `user_encryption_keys` intact, when it runs, then PII
    reproduces 1:1 (decrypted via the DEKs). Given a rebuild with the key table
    **absent or empty** (e.g. restoring only the event log), when it runs, then it
    completes but **all** users' PII reproduces as the redaction sentinel —
    permanently unreadable, indistinguishable from mass erasure. The recovery
    contract is therefore explicit: **`events` and `user_encryption_keys` are
    jointly authoritative**; both must be restored together, and the doc/ADR 0030
    states the event log is no longer a self-sufficient source of truth for PII.
22. Given an archive produced by a prune, when its integrity seal is verified,
    then tampering with any archived byte is detected, and the archive can be
    independently replayed for out-of-band audit without the live system.
23. Given the `ArchiveStore` interface, when constructed with the filesystem
    backend, then it streams artifacts to/from the operator-configured path via
    `io.Reader`/`io.Writer`; the zero/unknown backend is rejected
    (`ErrUnknownBackend`), and a second backend adds without prune-worker change.
24. **Prune events are exempt from pruning.** Given `EventLogPruned` events, when
    a later prune runs, then prune events are retained in the live log so the full
    prune chain stays visible without opening an archive.
25. **No-op run.** Given no events older than the retention window, when the
    worker runs, then it makes no deletion, writes no archive, and appends no
    `EventLogPruned` event.
26. **Crash-resume idempotency.** Given a worker that crashed after the archive
    durably landed but before the delete transaction, when the next run executes
    at the same checkpoint N, then it completes exactly one prune — no duplicate
    archive, no corruption, `EventLogPruned` appended once.
27. **Single-flight across replicas.** Given two control instances with the worker
    enabled, when a prune is due, then exactly one instance executes it (advisory
    lock) and the other skips without error.

### D. Observability & enforcement

28. Given the prune worker, when enabled, then it holds a cross-replica advisory
    lock (single-flight; mind pool exhaustion — WS3), is non-re-entrant, and a
    failure aborts that run without partial deletion (archive-then-delete ordering
    guarantees no event is deleted whose archive did not durably land).
29. Given `control doctor`, when it runs, then it reports retention posture
    (oldest live event age, event row count, configured window, last successful
    prune checkpoint + time) and does not mutate or prune anything.
30. Given `control doctor`, when it runs, then a **live** user whose DEK is
    unusable is reported **critical** (accidental key loss) — covering both a
    **missing** row and a **present-but-unwrappable** one (KEK changed, bit rot):
    both leave a non-deleted user effectively erased, and the corrupt case would
    otherwise pass silently until it aborts a projection (AC 10). Doctor
    proactively probes an unwrap of each live user's DEK rather than only checking
    row presence.
31. **Inverse invariant (enforces "shredded DEKs are never resurrected").** Given
    a user with a `UserDeleted` event in the log, when doctor runs, then a present
    `user_encryption_keys` row for that user is reported **critical** (e.g. a
    backup restore resurrected a shredded DEK) and offered a re-shred reconcile.
31a. **Projection drift detection (absorbs F-02).** Given each rebuild target,
    when doctor runs, then it compares `max(events.sequence_num)` for the target's
    streams against the projection's `projection_version` high-water mark and
    reports a **critical** finding on divergence — the currently-missing detection
    for a silently-dropped projection write. This matters more once pruning is
    live: drift must be caught **before** a prune removes the events that would
    re-derive it (there is no post-prune reconstruction of pruned history).

### E. Provisioning isolation

System actions are generated by a **live-only** side-effect listener
(`SystemActionListener`) from user state; the erasure model must guarantee an
erased user can never (re)acquire one. Three existing invariants make this hold;
this spec pins them so a future refactor can't silently break them.

32. **Generation is fail-closed on delete state (explicit, not incidental).**
    Given `SyncUserSystemActions` for a deleted/erased user, when it runs, then it
    refuses to generate or distribute any system action — via an **explicit**
    delete-state check at the generation choke point, not merely the incidental
    `User.Get` `is_deleted = FALSE` filter. A test pins the refusal.
33. **`UserDeleted` triggers no sync.** Given a `UserDeleted` event, when
    `AffectedFromEvent` classifies it, then it maps to `SyncOpNone` — no sync is
    scheduled. A guard pins that `UserDeleted` never maps to a sync op.
34. **Restore dispatches nothing.** Given a `RebuildAll`, when it runs, then it
    dispatches **no** system actions for any user — provisioning is a live-only
    listener, not a rebuild applier. An erased user materialises as
    `(is_deleted, redaction sentinel)` with no account created. A guard pins that
    the system-action listener is never registered as a rebuild applier.
35. **Teardown precedes erasure.** Given the shared delete-with-shred flow, when a
    user is deleted, then their system actions are torn down (set ABSENT, accounts
    removed from devices) using the **pre-delete** user snapshot *before* the DEK
    is shredded — the erasure rides on the existing `CleanupDeletedUserActions`
    ordering and must not move the shred ahead of it.
36. **Doctor safety net.** Given an erased/`is_deleted` user that still has
    provisioning enabled or a lingering **live** (PRESENT) system USER action
    targeting them (an incomplete teardown), when doctor runs, then it is reported
    as a finding to reconcile.

## Out of scope

- **Device secrets (LPS/LUKS/IdP client secret/TOTP) erasure.** Not personal
  data; existing at-rest encryption unchanged, not per-user-DEK'd.
- **`TerminalAdminMembershipRevoked.linux_username`** is treated as PII and
  tagged (encrypted under the affected user's DEK) — a decision, not an omission.
- **Hard KEK rotation across all secrets / ADR 0001.** Separate follow-on.
- **Audit-log export (DSAR).** Promised by the SaaS motivation but delivered
  separately (pairs with server#501); not in this spec.
- **Archive lifecycle / deletion.** Archives hold only ciphertext PII (erasure is
  the shred), so their retention is operator-managed out-of-band; this spec does
  not delete archives.
- **SIEM egress.** Separate.
- **Automated detection of host-volume encryption.** Documented requirement +
  doctor checklist item, not a reliable automated check.
- **The `enc:v2`→`enc:v1` rename.** Prerequisite task, specified separately.
- **A UI for choosing PII fields.** Code-declared via struct tags only.
- **`ArchiveStore` backends beyond filesystem.** Enabled by the interface; later.

## Technical design

### Affected packages

- `server/internal/crypto` — DEK generation, KEK-wrap/unwrap; reflection-based
  PII encrypt/decrypt driven by the `pii` tag + subject-user resolution;
  distinguishes missing-DEK (erased) from unwrap-failure (fault).
- `server/internal/store` — `user_encryption_keys` repo; the shared
  delete-with-shred flow (append `UserDeleted` + delete DEK in one tx); the
  streaming `ArchiveStore` + fs backend; snapshot capture (replay ≤ N) + restore;
  the privileged prune path + append-only trigger exemption; `RebuildAll`
  snapshot-aware; `EventLogPruned` handling + its pruning exemption.
- `server/internal/eventtypes` (+ `payloads`) — `EventLogPruned` payload;
  `pii:"true"` tags + owner `user_id` (adds `user_id` to
  `IdentityLinkLoginUpdated`).
- `server/internal/projectors` — PII decrypt-on-insert; missing-DEK → sentinel,
  unwrap-fail → abort; the `UserDeleted` projector redacts PII (one path for live
  + rebuild).
- `server/internal/api` — `DeleteUser` calls the shared flow; user-creation mints
  the DEK; retention settings RPCs.
- `server/internal/scim` — the SCIM delete path calls the same shared flow.
- `server/internal/worker` — the advisory-locked, crash-idempotent prune worker.
- `server/cmd/control` (doctor) — retention + dual key-invariant checks.
- `sdk/proto/pm/v1/control.proto` — retention settings, doctor surfacing;
  `IdentityLinkLoginUpdated` gains `user_id`.

### Proto changes

- No `EraseUser` RPC — deletion carries the shred.
- Retention config surface (window + archive backend + backend config + worker
  enabled), `@gotags`-validated (fs path absolute/writable when fs selected;
  window bounds; unknown backend rejected).
- Doctor response gains retention + dual key-invariant fields.
- `IdentityLinkLoginUpdated` gains `user_id` (`@gotags validate:"required,ulid"`).

### Database changes

- New `user_encryption_keys(user_id ULID PRIMARY KEY, wrapped_dek bytea NOT NULL,
  created_at timestamptz NOT NULL)` — mutable, NOT event-sourced, classified
  `operational` with the durable-non-recoverable justification.
- New event type `EventLogPruned` (no PII / no key material), exempt from prune.
- PII projection columns keep `NOT NULL` and take the `"[redacted]"` sentinel on
  erasure — the active-email unique index is `WHERE is_deleted = false`, so
  soft-deleted erased rows never collide and email is reusable (AC 15).
- Snapshot capture: replay events ≤ N into fresh tables within the prune
  transaction (deterministic == state@N, independent of live-projection drift);
  serialize into the archive artifact.
- Append-only trigger (`009_v2026_07.sql`) amended — no exemption exists today,
  so this is a real migration: `DELETE` permitted only when a transaction-scoped
  `SET LOCAL` guard is set by the prune path **and** an `EventLogPruned` event is
  appended in the same transaction; all other `DELETE`/`UPDATE`/`TRUNCATE` still
  rejected. `SET LOCAL` is tx-scoped (auto-cleared at COMMIT/ROLLBACK, so it never
  reaches the next pooled checkout), and the double condition (guard **and** the
  paired in-tx `EventLogPruned` append) is defense in depth.

### `ArchiveStore` interface (streaming, SDK-backend-pattern)

```
type ArchiveStore interface {
    Put(ctx context.Context, ref string, r io.Reader) (ArchiveInfo, error)
    Get(ctx context.Context, ref string) (io.ReadCloser, error)
    List(ctx context.Context) ([]ArchiveInfo, error)
}
```

Streaming (`io.Reader`/`io.Writer`), not `[]byte` — a prune of months of events
can be large; freezing the slice shape would force an interface break later. v1:
filesystem backend (operator path, atomic write + seal). Later: S3-compatible and
others — same driver shape as the future artifact-storage feature (server#493), a
candidate for a shared abstraction, not coupled here. Zero/unknown →
`ErrUnknownBackend`.

### New dependencies

None.

## Security considerations

- **Authorization.** Deletion (which now erases) keeps its existing permission +
  scope; irreversible, so the web UI keeps/gains step-up confirmation and every
  delete is audit-evented. Absent **and** out-of-scope targets return `NotFound`
  uniformly (no existence oracle, AC 13). Retention config changes are
  permission-gated and audit-evented.
- **Fail-closed everywhere.** Append fails rather than write plaintext PII (AC 6);
  unwrap-failure aborts rather than mask as erasure (AC 10); archive-then-delete
  means no event is deleted whose sealed archive did not land (AC 28); a delete
  that cannot destroy the DEK rolls back entirely (AC 14).
- **Secrets.** DEKs KEK-wrapped, never logged; `wrapped_dek` redacted everywhere.
  `EventLogPruned` carries no PII/key material. Cold archives hold only ciphertext
  PII but must still be access-controlled (documented).
- **KEK custody (the most critical secret — one paragraph even though rotation is
  out of scope).** The KEK is today the single `CONTROL_ENCRYPTION_KEY` hex env
  var, shared by control + gateway ([ADR 0001]). It wraps every per-user DEK, so
  its compromise exposes all DEK-encrypted PII and its loss makes all PII
  permanently unreadable (a mass accidental erasure). It must live at the
  **deployment/secret-management layer** — an injected secret (KMS / secret
  manager for SaaS; a protected env/secret for self-host), **never** in the
  database, the event log, a cold archive, or a backup that also contains
  `user_encryption_keys` (co-locating KEK + wrapped DEKs in one backup defeats
  envelope separation). Rotation mechanics are ADR 0001 / the separate follow-on;
  the envelope makes hard rotation cheap (re-wrap DEKs, log untouched).
- **`actor_id` re-identification — residual risk, acknowledged (decision).** The
  shred severs the *direct* identity link (name/email become unreadable), which
  is the standard GDPR mitigation for pseudonymous references. But `actor_id` is a
  **plaintext, consistent** ULID across timestamps/action-types/targets — a
  behavioral fingerprint that correlation could, in principle, re-identify; GDPR
  treats this as **pseudonymized, not anonymized**. v1 **accepts this residual
  risk** rather than DEK-encrypting `actor_id`, because `actor_id` is on every
  event, indexed, and drives audit-by-actor queries — encrypting it would break
  that hot path and lose all actor attribution post-shred. The heavier option
  (DEK-encrypt `actor_id`, decrypt-on-read for live audit) is documented as a
  future upgrade if a DPO requires true anonymization. **Maintainer decision
  point** — see below.
- **Tamper-evidence.** The prune exemption is the only sanctioned `events`
  mutation, is recorded via `EventLogPruned` (itself exempt from pruning), and is
  scoped so no other path can delete. The #498 append-only guard test is extended.
- **Crypto-shred completeness & non-resurrection.** Destroying the DEK reaches
  live log + all archives + future rebuilds at once. Backups of
  `user_encryption_keys` retain the DEK until they age out — documented
  bounded-retention, and **enforced** by doctor's inverse invariant (AC 31): a
  `UserDeleted` user holding a DEK is a critical resurrection to reconcile.
- **SCIM interactions (pinned so they aren't "fixed" later).** SCIM `PATCH
  active=false` emits `UserDisabled` and must **not** shred (disable ≠ delete).
  SCIM `DELETE` emits `UserDeleted` only when no identity links remain
  (`internal/scim/users.go`); "delete always erases" is scoped to the actual
  `UserDeleted` emission, which routes through the shared shred flow (AC 8).

## Test requirements

### Handler tests

- Deletion (API + SCIM): correct / absent / malformed ULID; unauthenticated;
  wrong role; out-of-scope → NotFound; absent → NotFound (no oracle);
  visible-already-deleted → idempotent OK; DEK destroyed + PII redacted on
  success (both paths, AC 8); DB-fail rolls back (AC 14); audit event on success,
  none on rejection.
- SCIM: `active=false` → `UserDisabled`, DEK **retained**; `DELETE` with links
  remaining → no shred; `DELETE` last link → shred.
- Retention config: missing/invalid fs path rejected; unknown backend rejected;
  window bounds.

### Integration tests (real Postgres, testcontainers)

- Envelope round-trip incl. off-stream PII (identity links): tagged PII ciphertext
  in events, plaintext in projections, rebuild 1:1 (A/2, A/4).
- Fail-closed append: missing/unwrappable DEK at append → error, nothing written
  (A/6).
- Tag guard: every tagged field round-trips + resolves an owner (A/3).
- Delete-erases end-to-end via BOTH paths: DEK gone, PII → sentinel via projector,
  `UserDeleted` appended; rebuild reproduces sentinel for deleted, 1:1 for others
  (B/7–11); deleted actor's other events still replay (B/12); half-erase
  impossible (B/14); email reuse + fresh DEK after erase (B/15).
- Unwrap-failure abort: present-but-corrupt DEK → projector/rebuild aborts, does
  not sentinel (B/10).
- Prune round-trip: checkpoint N → snapshot(replay ≤ N) + events ≤ N sealed → ≤ N
  deleted with `EventLogPruned` in-tx → rebuild identical to pre-prune rebuild
  (C/16–22); prune events survive a later prune (C/24); no-op run (C/25);
  crash-resume completes exactly one prune (C/26); two instances → one executes
  (C/27).
- Tamper-evidence: non-prune DELETE/UPDATE on `events` still rejected (C/20);
  archive seal detects a flipped byte (C/22).
- `ArchiveStore` fs backend streaming Put/Get/List; unknown backend rejected
  (C/23).
- Doctor: unusable-DEK critical for a live user — both missing and
  present-but-unwrappable (D/30); lingering-DEK-after-`UserDeleted` critical +
  reconcile (D/31); projection-drift detection (D/31a); retention posture
  populated (D/29).
- Recovery: rebuild with `user_encryption_keys` intact → PII 1:1; rebuild with the
  key table absent → all PII → sentinel, completes (A/21a — proves the two-table
  joint authority).
- Provisioning isolation: `SyncUserSystemActions` explicitly refuses a deleted
  user (E/32); `AffectedFromEvent(UserDeleted)` → `SyncOpNone`, pinned (E/33); a
  `RebuildAll` dispatches no system actions + guard that the listener is not a
  rebuild applier (E/34); teardown precedes shred in the shared flow (E/35);
  doctor flags an erased user with a lingering live system USER action (E/36).

### Property / guard tests

- Schema-classification guard passes with `user_encryption_keys` classified
  (A/5); #498 append-only guard extended for the scoped prune exemption; PII-tag
  round-trip + owner-resolution guard (A/3).
- **Projector determinism guard** (A/17a): no unseeded `math/rand` / order-
  dependent map iteration in any `Apply*` (extends the WS0 clock seam).
- **Append-completeness guard extended to `internal/scim`** (absorbs F-07): since
  this spec routes SCIM delete through the shared shred flow, the SCIM surface
  joins the guarded set so a future SCIM mutation that skips `AppendEvent` fails
  the build.
- **Full-fidelity round-trip** (A/17): full-row dump diff over `AllRebuildTargets`
  before/after prune, self-discovering.

## Rejection paths

| Scenario | Error code | Client-visible message | Logged context |
|---|---|---|---|
| Delete unauthenticated | Unauthenticated | (interceptor) | method, remote |
| Delete wrong role / out of scope | NotFound | "user not found" | actor, target, denied perm |
| Delete absent target (scope not universal) | NotFound | "user not found" | actor, target |
| Delete malformed ULID | InvalidArgument | "invalid user id" | actor, raw value |
| Delete visible + already deleted | OK (idempotent) | success, no-op | actor, target, "already deleted" |
| Delete: DEK delete fails (DB) | Internal | "failed to delete user" | actor, target, error; **tx rolled back** |
| Append: live user DEK missing/unwrappable | Internal | "cannot encrypt PII — key unavailable" | user ULID; **no plaintext written** |
| Projector: DEK present but unwrap fails | (abort, surfaced) | — | user ULID, "DEK unwrap failed — not projecting" |
| Projector: DEK missing (erased) | (graceful) | — | user ULID, "erased — projecting redaction sentinel" |
| Retention enable, fs path unwritable | FailedPrecondition | "archive path not writable" | path (not contents) |
| Retention enable, unknown backend | InvalidArgument | "unknown archive backend" | requested backend |
| Prune: archive write fails | (worker log) | — | checkpoint N, backend, error; **no deletion** |
| Prune: `EventLogPruned` append fails | (worker log, rollback) | — | checkpoint N; **no deletion** |
| Prune: advisory lock held elsewhere | (worker log, skip) | — | "prune already running" |
| Non-prune DELETE/UPDATE on `events` | (DB trigger error) | — | trigger raises; op rejected |
| Doctor: live user DEK missing or unwrappable | exit 100 (critical) | "N users have unusable encryption keys — possible key loss" | user ULIDs (count), missing vs unwrappable |
| Doctor: deleted user holding DEK | exit 100 (critical) | "N shredded users have resurrected keys — reconcile" | user ULIDs (count) |
| Doctor: projection drift (seq vs projection_version) | exit 100 (critical) | "projection drift on <target> — rebuild before pruning" | target, event high-water, projection high-water |
| Rebuild with `user_encryption_keys` absent | (completes, all PII → sentinel) | — | "key table empty — PII unrecoverable; restore it with the event log" |

## Rollout and migration

- **Prerequisite:** the single-format at-rest encryption rename lands first.
- **Beta stance:** only a test deployment exists; existing encrypted data is
  reprovisioned (Path A). No historical PII backfill for the test env; a future
  non-beta deployment would specify a one-time backfill.
- **Deployment requirement (documented, compliance):** run the Postgres/valkey
  data volume on encrypted storage (LUKS self-hosted / KMS-encrypted disk or
  managed Postgres for SaaS). Satisfies "PII encrypted at rest" for the queryable
  projection; the app-level DEK handles erasure of immutable copies.
- Migrations: `user_encryption_keys`; `EventLogPruned`; amended append-only
  trigger (real change — no exemption today); PII-column redaction-sentinel
  handling; snapshot-checkpoint bookkeeping.
- **Backup criticality:** `user_encryption_keys` joins the event log as
  jointly-authoritative and must be in every backup/restore set — losing it is
  unintended mass erasure. Doctor's dual key-invariant check is the runtime alarm.

## References

- ADR 0030 (new) — audit-log retention + crypto-shred erasure contract; the sole
  durable-non-recoverable Postgres exception (amends ADR 0029).
- ADR 0029 — Postgres state is event-sourced or derived.
- ADR 0009 — at-rest AAD binding (superseded by the single-format rename).
- ADR 0001 — AES key rotation (the envelope enables cheap hard KEK rotation for
  DEK'd data; full migration is the separate follow-on).
- ADR 0026 — event-sourcing audit model (its "periodic reconcile is the safety
  net" claim is corrected by AC 31a / audit F-02).
- server#498 (event-sourcing integrity), server#502 / #503 (2026.08),
  server#501 (audit-log UX / export).
- `server/TECH_DEBT_AUDIT.md` (2026-07-04) — prerequisites F-01 (rebuild entry
  point), F-03 (cascade-safe partial rebuild), F-05 (typed PII payloads), F-06
  (IdP/TOTP AAD, via the enc rename); absorbed F-02 (drift doctor), F-04
  (full-fidelity round-trip), F-07 (guard→SCIM).
- spec 18 (LPS sealed transport — sibling crypto pattern).
