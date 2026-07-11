---
title: "Transactional multi-stream event append"
status: implemented
created: 2026-07-10
---

# Transactional multi-stream event append

## Overview

A store primitive, `AppendEvents(ctx, []Event)`, that commits a set of
events across one or more streams **atomically** — all of them land, or
none do — and fires listeners only after the whole batch commits.
Consumed by the multi-stream write paths (SCIM group/user provisioning
first) that today issue several independent `AppendEvent` calls and can
leave partial state when a later call fails. It is an internal
event-store mechanism, used by handlers; it is not an RPC.

## Motivation

The event store gives every stream two guarantees for free: per-entity
ordering and optimistic concurrency (`UNIQUE(stream_type, stream_id,
stream_version)` + read-increment-insert retry in `AppendEvent`). It
deliberately does **not** give cross-stream atomicity — and each
`AppendEvent` commits on its own, one transaction per call.

That is fine for the common case (one logical action → one stream), but
a handful of actions write several streams as one logical unit. SCIM
`createGroup` is the clearest: it appends `UserGroupCreated`
(`user_group/<id>`), then `SCIMGroupMapped` (`scim_group_mapping/<id>`),
then `UserGroupMemberAdded` per member (`user_group/<id>:<member>`). If
the second append fails after the first commits, the group exists with
no mapping. On the IdP's next sync the dedup lookup — keyed on the
mapping — misses, so a **second** group is created and the first is
orphaned permanently. It is a leak, not corruption, but it is
admin-visible and does not self-heal (server security audit
2026-07-10; the "sequential SCIM event appends can leave partial state"
finding).

Reordering the appends does not fix it (mapping-first leaves a mapping
pointing at a nonexistent group — worse). The correct fix is
all-or-nothing across the streams, which the store can provide with a
single Postgres transaction spanning the batch. Nothing about the
stream model prevents this; the store simply has no batch-append
primitive today. This spec adds one.

## Acceptance criteria

Each follows "Given [precondition], when [action], then [observable
outcome]."

1. Given a batch `[e1, e2, e3]` across different streams, when
   `AppendEvents` succeeds, then all three rows are present in `events`
   with ascending `sequence_num` in array order, and each stream's
   `stream_version` starts at 1 for a new stream.
2. Given a batch where the Kth append cannot be written (a version
   conflict that exhausts the retry budget, or a forced DB error), when
   `AppendEvents` returns an error, then **none** of the batch's events
   are in `events` and **no** projection reflects any of them —
   verified by loading each target stream and finding it empty/unchanged.
3. Given a batch containing two events targeting the **same** stream,
   when `AppendEvents` succeeds, then they receive consecutive
   `stream_version` values (N+1, N+2) — the in-transaction read of the
   stream version observes the batch's own earlier insert.
4. Given a successful batch, when `AppendEvents` returns, then every
   listener registered via `RegisterEventListener` has been invoked
   **once per event, in array (sequence) order, after the whole batch
   committed**, through the same post-commit `fireListeners` dispatch
   `AppendEvent` uses. Because projection is now built entirely by these
   post-commit Go listeners (the PL/pgSQL dispatcher was retired — see
   Design notes), a batched event is projected identically to an
   individually-appended one: the batch **must** notify per event or its
   projections would never build. A listener that reads the store during
   its callback observes every event in the batch (never a partial set),
   and a listener that panics does not fail `AppendEvents` — the batch is
   already durable (the `fireListeners` panic-recovery contract).
5. Given a concurrent writer to one of the batch's streams, when
   `AppendEvents` hits a version conflict, then it retries the **whole
   transaction** (re-reading versions) and still commits atomically; if
   it cannot converge within the retry budget it returns
   `ErrVersionConflict` and writes nothing.
6. Given an event in the batch whose PII sealing fails, when
   `AppendEvents` runs, then it returns the seal error and writes
   nothing — no partial commit, and no plaintext PII reaches the log
   (spec 19 fail-closed posture preserved, per event).
7. Given a single-element batch, when `AppendEvents([e])` runs, then the
   result is observably identical to `AppendEvent(e)` (same row, same
   version assignment, same single listener fire); given an empty batch,
   `AppendEvents(nil)` is a no-op returning nil.
8. Given SCIM `createGroup` migrated to `AppendEvents`, when the
   `SCIMGroupMapped` append is forced to fail, then **no** orphan
   `user_group` projection row exists for that group — the group and its
   mapping either both exist or neither does (the audit regression).

## Out of scope

- **Single-append call sites.** Handlers that emit one event per action
  are already atomic; they are not migrated and gain nothing.
- **A saga / unit-of-work / compensating-action framework.** This is a
  single-transaction batch append, not a distributed or long-running
  workflow engine.
- **Cross-aggregate invariant enforcement** beyond atomicity (e.g.
  "reject the batch if it would violate a business rule spanning
  aggregates"). Callers still validate before appending.
- **Changing the stream model, projections, event schema, or the
  `sequence_num` / `stream_version` columns.** The primitive uses the
  existing table and constraints unchanged.
- **Making `AppendEvent` (singular) transactional across separate
  calls.** Atomicity is opt-in via `AppendEvents`; existing single-call
  semantics are untouched.
- **Cross-process / multi-database transactions.** One Postgres, one tx.

## Technical design

### Affected packages

- `server/internal/store` — new `AppendEvents(ctx context.Context,
  events []Event) error`. The per-event work (actor validation, PII
  seal, marshal, read-version, single insert attempt returning a
  conflict error) is extracted into a tx-scoped helper shared with
  `AppendEvent`, so the two paths cannot drift (DRY). The retry unit
  differs and stays explicit: `AppendEvent` retries one insert;
  `AppendEvents` retries the whole transaction.
- `server/internal/scim` — `groups_create.go` (`createGroup`) and
  `users_mutate.go` (the multi-append update sequences) switch their
  multi-stream mutations to `AppendEvents`. Single-append SCIM paths are
  left as-is.

### Design notes

- **Ordering of the phases** — seal PII for **every** event first
  (before opening the transaction), so a seal failure aborts with zero
  DB work and zero partial state. Then open one transaction; for each
  event in order, read the stream version (read-your-writes sees earlier
  same-stream inserts in this tx), insert at version+1. Commit. **Only
  after commit**, fire listeners for every inserted row in order.
- **Why listeners fire post-commit, not mid-tx** — a listener that reads
  the DB mid-transaction would not see the uncommitted batch (wrong
  view), and a listener failure inside the tx would poison an otherwise
  durable write. Firing after commit preserves the existing "listeners
  are post-commit notifications, panics can't fail the append" contract
  (`fireListeners`).
- **Projection is 100% post-commit Go listeners.** As of trackers #107,
  #136, and #497 the PL/pgSQL projection dispatcher (`project_event()`)
  and its trigger are gone, and every stream is projected by a Go
  listener that fires from `fireListeners` (and rebuilt by a Go
  `RegisterRebuildApply`). So `fireListeners` is not an optional
  notification — it is the sole projection path. `AppendEvents` firing it
  per event, post-commit, is what makes a batched event project at all;
  AC 4 pins that.
- **Crash window** — a crash between commit and listener firing leaves
  the events durable but their in-process listeners un-fired, exactly
  as a crash between `AppendEvent`'s insert and its `fireListeners`
  does today (same window, no new risk). The durable source of truth is
  the **event log**, not the projection: a projection that missed its
  post-commit listener is re-derived by replaying the log through the Go
  rebuild appliers (`RebuildAll`), which is **operator-invoked** — there
  is no automatic periodic reconcile for Postgres projections (only the
  Valkey search index has one). Do not add machinery for this window; it
  is the accepted existing posture.
- **Retry semantics** — the whole batch is the retry unit. A version
  conflict on any event rolls back the transaction and re-runs it from
  the version reads, up to the same bounded budget `AppendEvent` uses.
  Convergence failure returns `ErrVersionConflict` having written
  nothing.

### Proto changes

None. This is an internal store primitive, not an RPC.

### Database changes

None. Uses the existing `events` table, the existing
`UNIQUE(stream_type, stream_id, stream_version)` constraint, and the
existing `WithTx` transaction helper.

### New dependencies

None (`pgx` transactions via the existing `Store.WithTx` / pool).

## Security considerations

- **Authorization** — unchanged. `AppendEvents` is an internal store
  call; callers keep their existing handler-level authz (the SCIM
  handler's provider authentication is untouched). The primitive adds
  no new externally reachable surface.
- **Input validation** — each event is validated (actor_type + actor_id
  required, per current `AppendEvent`) before any write; a batch with an
  invalid event writes nothing.
- **Secrets / PII** — PII sealing stays fail-closed and per event (spec
  19). Sealing happens before the transaction opens, so a seal failure
  can never produce a partial commit or leak plaintext.
- **Audit** — the events **are** the audit trail. Atomicity strengthens
  it: a multi-event action can no longer leave a half-written audit
  record. Partial state is precisely the threat this primitive removes;
  its contract is fail-closed (all-or-nothing).

## Test requirements

### Store tests (real Postgres via `testutil.SetupPostgres`)

- **Atomic commit** (AC 1) — batch across three streams; assert all
  present, `sequence_num` ascending in array order, fresh streams at
  version 1.
- **All-or-nothing on failure** (AC 2) — force the Nth append to fail
  and assert every target stream is empty/unchanged. The failure is
  injected without a production seam where possible: e.g. a batch whose
  Nth event deliberately collides on `(stream_type, stream_id,
  stream_version)` with a pre-seeded row, or a concurrent writer that
  wins the version race past the retry budget. If no in-band trigger is
  reachable, add a test-only hook (`export_test.go`) that fails the Nth
  insert — never a production flag.
- **Same-stream versioning** (AC 3) — two events, one stream;
  consecutive versions.
- **Listener ordering + panic safety** (AC 4) — a recording listener
  observes all batch events, in order, and only after commit; a
  panicking listener does not fail the batch.
- **Projector notification, end-to-end** (AC 4) — register a *real*
  projector (not just a recording fake), append a multi-event batch it
  projects across the streams it owns, and assert that after
  `AppendEvents` returns the projection reflects **every** event in the
  batch. This proves the batch drives the actual projection path
  (`fireListeners` → Go listener → projection write), not merely that a
  test double was called — the load-bearing guarantee now that PL/pgSQL
  projection is gone.
- **Optimistic concurrency** (AC 5) — a concurrent same-stream writer
  forces a retry; the batch still commits atomically, and an
  unresolvable conflict returns `ErrVersionConflict` with nothing
  written.
- **PII fail-closed** (AC 6) — an event whose user has no minted DEK
  makes sealing fail; assert the batch writes nothing.
- **Equivalence + empty** (AC 7) — `AppendEvents([]Event{e})` matches
  `AppendEvent(e)` row-for-row; `AppendEvents(nil)` is a no-op.

### Integration tests (real handler + real Postgres)

- **SCIM orphan regression** (AC 8) — drive the real SCIM `createGroup`
  with the `SCIMGroupMapped` append forced to fail; assert no
  `user_group` projection row exists for the group, and a subsequent
  clean sync creates exactly one group (no duplicate). This is the
  bug-fix regression test the audit finding requires — it must fail on
  the pre-migration handler and pass after.

### Property-based or generative tests

- Optional: random batches over random streams commit atomically and,
  after a projection rebuild, yield the same projection state as
  applying the same events individually — pinning that batching changes
  atomicity, not outcome.

## Rejection paths

| Scenario | Result | Logged context |
|----------|--------|----------------|
| An event in the batch is missing `actor_type` / `actor_id` | error, nothing written | offending event index, stream_type |
| PII seal fails on any event | seal error, nothing written | stream_type, event_type (no payload) |
| Version conflict unresolved after the retry budget | `ErrVersionConflict`, nothing written | stream_type, stream_id, retry count |
| Transaction / DB error mid-batch | wrapped error, nothing written (rollback) | tx error |
| Empty batch | no-op, `nil` | — |

There is no client-facing error-code row: `AppendEvents` is internal.
Callers map its failure through their own boundary (e.g. SCIM returns
HTTP 500, as the single-append paths already do).

## Rollout and migration

Additive and backward-compatible. New store method plus the SCIM
call-site migration; `AppendEvent` is unchanged, so every other caller
is unaffected. No database migration, no proto change, no config, no
feature flag. Ships in one server PR. The SCIM behavioral change is
strictly a bug fix (partial state → atomic), covered by the AC 8
regression test.

## References

- Server security audit 2026-07-10 — "Sequential SCIM event appends can
  leave partial state after a later failure" (`groups_create.go`);
  narrowed from the earlier "SCIM swallows event-store failures"
  (refuted — the single-append paths correctly return HTTP 500).
- `server/internal/store/store.go` — `AppendEvent` (read-increment-insert
  + conflict retry), `WithTx`, `fireListeners` (post-commit, panic-safe).
- `UNIQUE(stream_type, stream_id, stream_version)` — per-stream
  optimistic concurrency (migration 002; WS14).
- Spec 19 — per-event PII sealing (fail-closed), preserved here.
- `feedback_post_commit_listener_is_sync` — listeners are synchronous
  post-commit notifications.
- Projector migration **complete** (trackers #107 runtime ports, #136
  Phase 2, #497 rebuild appliers): the PL/pgSQL `project_event()`
  dispatcher and trigger are dropped; every stream projects via a Go
  `RegisterEventListener` and rebuilds via a Go `RegisterRebuildApply`
  in `projectors.WireAll`. `fireListeners` is therefore the sole
  projection path, which is why AC 4 (per-event post-commit
  notification) is load-bearing. NB: the "legacy PL/pgSQL fallback"
  comments still in `store.go`/`rebuild.go`/`wire.go` are stale
  (dead branch) — tracked for cleanup in the #510 doc-truth pass.
