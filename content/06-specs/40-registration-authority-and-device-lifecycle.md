---
title: "Serialized registration authority and device lifecycle"
status: draft
created: 2026-07-18
---

# Serialized registration authority and device lifecycle

## Overview

Make Control's device registration, token admission, certificate history, and
device deletion an event-sourced authority model: per-token serialized
admission with one atomic `TokenConsumed` + `DeviceRegistered` batch, a shared
per-device lifecycle lock for every live-device mutation, DER-derived
certificate authority events, retention-safe stream heads, and
revoke-before-delete over every certificate a device was ever issued.
Activation is fenced mechanically at the database, not by an operational drain.

Split from spec 38 on 2026-07-18 (its former ACs 22, 27, and 32): this
server-side migration has fleet-wide blast radius and is reviewed, tested, and
released independently; it lands and activates **before** spec 38's agent
`reenroll` CLI ships. Spec 38 consumes these guarantees (its backup-cleanup
precondition and old-device deletion flow) but contains no server authority
logic of its own.

## Motivation

Three real current weaknesses, independent of reenrollment:

1. `DeleteDevice` emits `DeviceDeleted` first, then best-effort revokes only
   the latest projected fingerprint (`server/internal/api/device_handler.go`),
   so a CRL-write failure — or a superseded renewal certificate — stays live
   until its ~1-year expiry.
2. Token consumption and device registration are two non-atomic appends
   (`server/internal/api/registration_handler.go`), so an explicit server error
   can arrive after the token has been consumed, and the retrying append does
   not serialize concurrent one-time/max-use admission.
3. Admission and deletion decisions read fallible projections rather than
   immutable event authority, so projector failure or pruning can change
   security outcomes.

The original spec 38 rollout fenced activation with an operational drain of old
Control replicas. A leaked fence — one un-drained legacy replica — silently
re-exposes the legacy partial-commit path. The fence must be mechanical: a
legacy binary must be *unable* to commit a guarded write, not merely expected
not to.

## Acceptance criteria

### Device lifecycle authority

1. Given any device-targeted mutation whose eligibility depends on a live
   device, when it executes, then it acquires the shared per-device lifecycle
   advisory lock **before** any queue, token, secret, session, persistence, or
   event effect. Audit-only appenders are classified separately and explicitly.
2. Given the lock is held, then the mutation replays the immutable lifecycle
   subset (`DeviceRegistered`, `DeviceCertRenewed`, `DeviceDeletionRequested`,
   `DeviceDeleted`) in stream-version order and rejects after `DeviceDeleted`;
   a mutation already holding the lock finishes before deletion, and every
   later writer observes deletion, creates zero side effects, and cannot
   overtake it.
3. Given the codebase, then a self-discovering guard enumerates every
   live-device mutation entry point plus every direct/wrapped append API,
   requires the guarded callback before the first effect, fails on zero
   matches, and keeps creation/rebuild/audit-only exceptions explicit.
4. Given registration or renewal issues a certificate, then the emitted leaf
   DER is parsed before constructing events or responses; the exact fingerprint
   plus second-precision `NotBefore`/`NotAfter` are persisted in the immutable
   authority event; and no deletion or revocation decision ever trusts the
   fallible device projection.
5. Given retention pruning, then exactly `DeviceRegistered`,
   `DeviceCertRenewed`, `DeviceDeletionRequested`, and `DeviceDeleted` are
   exempt, and a transactional stream-head row is updated on every append, so
   pruning unrelated events can neither erase identity/certificate history nor
   reuse a stream version.

### Revoke-before-delete

6. Given `DeleteDevice` passes request validation/authz/scope, when it
   proceeds under the lifecycle lock, then it first appends a non-projecting
   `DeviceDeletionRequested` audit event with safe actor/target metadata, and
   authoritative replay must prove a registered, non-deleted device and
   enumerate every unique issued fingerprint plus encoded leaf validity before
   any CRL effect.
7. Given a certificate currently valid (`!now.Before(NotBefore) &&
   !now.After(NotAfter)`, matching Go X.509's inclusive boundaries), then the
   production CRL store and successful idempotent revocation are required
   before deletion.
8. Given a not-yet-valid certificate (`now.Before(NotBefore)`), then CRL-store
   membership is required plus attributable current TLS time rejection; no
   middleware claim is made before the validity window.
9. Given an expired certificate (`now.After(NotAfter)`), then deletion records
   the explicit expiry branch — ordinary TLS already rejects and the CRL store
   intentionally omits expired entries; no false CRL claim is recorded.
10. Given a legacy future-expiry event lacking `NotBefore`, then idempotent
    revocation and authoritative CRL membership are required, with no claim
    about whether current TLS should succeed.
11. Given replay proves no certificate was ever issued, then the device is
    deletable without CRL effects; partial or malformed certificate payloads
    instead return opaque `Internal` and no `DeviceDeleted`.
12. Given all mandatory certificate branches succeed, then and only then is
    `DeviceDeleted` appended. A partial CRL success or final append failure
    leaves the authoritative stream non-deleted with its immutable
    deletion-request event; retry replays and repeats idempotent revocation.
    Success means every certificate ever issued was handled, not merely the
    latest projected fingerprint.

### Serialized token admission

13. Given token-hash lookup identifies the token stream, when `Register`
    proceeds, then it enters a reference-counted local gate plus a dedicated
    PostgreSQL advisory lock derived from the token ULID — shared by **every**
    post-creation token writer — and replays the retention-preserved authority
    set under that lock. Schema/request/CSR checks may run before the lock;
    the authoritative decision, certificate issuance, and persistence run
    inside it.
14. Given admission state, then it is derived from events, never stale
    projection counters: `TokenConsumed` is irreversible; historical
    `TokenDisabled` with a valid non-empty `device_id` is consumed, with an
    empty payload it is administrative disable; `TokenEnabled` reverses only
    administrative disable; malformed or ambiguous history fails opaque
    `Internal`.
15. Given a successful admission, then one `AppendEvents` batch atomically
    writes `TokenConsumed` and `DeviceRegistered` bound to the same newly
    generated device ULID with the registration-derived
    fingerprint/`NotBefore`/`NotAfter`; batch insert, deadlock, or version
    failure commits neither stream, and post-commit projector failure cannot
    make the token reusable because the next admission replays authority.
16. Given concurrent schema-valid registrations against one one-time or
    max-use token, then exactly the allowed number succeeds — even when
    projections are stale or unrelated events were pruned — and different
    token/device keys progress concurrently.
17. Given retention, then exactly `TokenCreated`, historical `TokenUsed`,
    `TokenConsumed`, `TokenDisabled`, `TokenEnabled`, and `TokenDeleted` are
    exempt (`TokenRenamed` is not admission authority), and the transactional
    stream head survives pruning of unrelated events.

### Mechanical activation fence

18. Given the activation migration runs, then it installs a database-level
    append guard on the event store: appends to guarded token/device streams
    (the authority event types above) are rejected unless the appending
    connection has declared the new authority-model capability via a
    session-scoped setting that only fenced (this-spec) binaries set at pool
    initialization. An un-drained legacy Control replica therefore **fails
    closed with a storage error** on its next guarded write instead of
    committing a legacy partial-commit path. Draining old replicas remains
    operational hygiene, not the safety mechanism.
19. Given activation, then it preserves the existing renewal lock namespace,
    transactionally installs retention-safe stream heads, and scans existing
    histories for malformed token events or post-delete device events before
    traffic resumes; unreconciled history fails activation rather than being
    silently accepted.
20. Given the guard or its capability declaration is removed or bypassed in a
    red-check, then the fence tests fail: a connection without the declaration
    must be unable to append a guarded event type, and a declaring connection
    must succeed unchanged.

## Out of scope

- The agent `reenroll` CLI, credential store, installer, and local recovery —
  spec 38.
- Proto changes. None: the existing public `Register` RPC surface is unchanged.
- Changing token or device projection schemas beyond what replay/stream heads
  require; projections remain rebuildable read models, never authority.

## Technical design

### Authoritative device lifecycle and revoke-before-delete

Add one shared per-device PostgreSQL lifecycle-guard callback. Every device-
targeted mutation whose authority requires a live device acquires it before any
queue, pending-row, token, secret, terminal/session, other persistence, or event
effect; audit-only appenders are classified separately. Under the lock it replays
the immutable lifecycle subset (`DeviceRegistered`, `DeviceCertRenewed`, deletion-
requested, and `DeviceDeleted`) in stream-version order and rejects after deletion.
A self-discovering guard discovers mutation entry points plus every direct/wrapped
append API, requires the guarded callback before the first effect, fails on zero
matches, and keeps creation/rebuild/audit-only exceptions explicit. Thus a mutation
already holding the lock finishes before deletion, while a later heartbeat,
inventory, queue, token, terminal, or other writer observes deletion and cannot
create side effects or overtake it.

Registration and renewal parse the emitted leaf DER before constructing events or
responses and derive exact fingerprint plus second-precision `NotBefore` and
`NotAfter`; renewal validates the presented certificate against authoritative
history, appends `DeviceCertRenewed`, and returns only after the event is durable.
Projection listener failure, cancellation, or a higher-sequence projection update
cannot change which certificate was issued; projections remain rebuildable read
models, not revocation authority. The retention layer exempts exactly
`DeviceRegistered`, `DeviceCertRenewed`, `DeviceDeletionRequested`, and
`DeviceDeleted` and updates a transactional stream-head row on every append, so
pruning unrelated events cannot erase authority or reset the next version. This
security replay, retention, and lock discipline is recorded in a server ADR.

`DeleteDevice` performs normal request validation/authz/scope before acquiring the
lifecycle lock. Under it, authoritative replay must prove a registered,
non-deleted device and enumerate every unique issued fingerprint plus encoded leaf
expiry. The handler first appends the new non-projecting `DeviceDeletionRequested`
audit event, then applies the exact certificate-time branches of ACs 7–11. All
mandatory branches succeed before `DeviceDeleted` is appended (AC 12). This closes
both renewal/deletion races and prior best-effort superseded-certificate
revocation failures without depending on projection application order.

### Serialized registration admission

After token-hash lookup identifies the token stream, `Register` enters the
reference-counted local gate and dedicated PostgreSQL advisory lock derived from the
token ULID that every post-creation token writer shares, then replays the retention-
preserved authority set under the lock. A self-discovering mutation/append-site
guard enforces the callback with creation/rebuild-only exceptions. Admission state —
disabled, irreversible consumption, current uses, maximum uses, and expiry — is
derived from events, not stale projection counters. New success emits
`TokenConsumed{device_id}`. Historical `TokenDisabled` with a valid non-empty
`device_id` is interpreted as consumed; empty payload is administrative disable;
malformed/ambiguous payload is opaque `Internal`. `TokenEnabled` reverses only
administrative disable.

One `AppendEvents` batch atomically writes `TokenConsumed` and `DeviceRegistered`
bound to the same newly generated device ULID, with registration-derived
fingerprint/`NotBefore`/`NotAfter`. Batch insert, deadlock, or version failure
commits neither stream; post-commit projector failure cannot make the token
reusable because the next admission replays authority. The stale source comment
claiming ordinary retrying `AppendEvent` rejects concurrent consumption is
removed. This preserves spec 38's conservative remote-unknown treatment on the
agent side without preserving the current token-only partial-commit bug.

### Mechanical activation fence

The activation migration installs the transactional `event_stream_heads` table,
the retention exemptions, and a trigger-backed append guard on the event store:
inserting any guarded authority event type is rejected unless the inserting
session has declared the authority-model capability through a session-scoped
setting (for example `SET pm.authority_model = '2'`, issued at connection-pool
initialization by binaries that contain this spec). Legacy binaries never set
it, so an un-drained replica's next guarded append fails at the database with a
constraint error — fail-closed, attributable, and independent of operational
drain discipline. The history scan (malformed token authority, post-delete
device events) runs inside activation; unreconciled history aborts the
migration. The existing per-device renewal lock namespace is preserved.
Replace the process-global advisory-lock pre-gate with reference-counted
per-key local gates while retaining one dedicated PostgreSQL session lock; same
keys serialize and unrelated device/token keys run concurrently. Write a server
ADR for retention-safe security replay and the fenced activation.

### Database and dependencies

- Forward migration for `event_stream_heads`, retention exemptions, the
  `TokenConsumed` and non-projecting `DeviceDeletionRequested` event types,
  authoritative lifecycle/token replay helpers, and the append-guard trigger
  with its capability setting.
- No proto change. No new Go module.

## Security considerations

- **Fail-closed admission:** authority is derived from immutable events under a
  per-key lock; stale projections, projector failure, and pruning cannot admit
  an extra token use or resurrect a deleted device.
- **Revocation completeness:** successful deletion means every certificate ever
  issued was classified from retention-safe authority — future-expiry
  fingerprints durably revoked before deletion, expired ones recorded under the
  explicit TLS-expiry branch. No false CRL claim is ever recorded.
- **Mechanical fence:** the append guard makes the legacy partial-commit path
  physically uncommittable from an un-drained replica; the failure is a loud
  storage error, not silent legacy behavior.
- **Audit:** `DeviceDeletionRequested`/`DeviceDeleted` and the atomic
  registration batch provide immutable remote evidence, including
  revoke-success/delete-append-failure attempts. Opaque `Internal` responses
  never leak certificate material or token values.

## Test requirements

### Server registration regression tests

- Real `Register` handler plus real Postgres runs concurrent schema-valid calls for
  one-time tokens and max-use boundaries; exactly the allowed count succeeds and
  each success has one irreversible `TokenConsumed` atomically paired with one
  `DeviceRegistered` carrying the same device ULID and DER-derived certificate
  times.
- Concurrent token disable/enable/update and registration prove every post-creation
  token writer shares the same-key lock, different keys progress concurrently, and
  authoritative replay wins over stale projection `disabled/current_uses` values.
  `TokenEnabled` never reverses `TokenConsumed`; historical consumed/admin-disabled
  payloads and malformed ambiguity cover their exact branches. The self-discovering
  mutation/append-site guard has stale, missing, duplicate, and matches-zero red-
  checks.
- Deterministic insert hooks fail the token and device member of the atomic batch in
  turn; both streams remain unchanged and the RPC reports the mapped failure. A
  token-projector failure after a committed batch cannot admit another use.
- Retention tests prune unrelated old token/device events and run pruning
  concurrently with registration/deletion. Authority events and transactional
  stream heads survive, versions never rewind, and a pruned projection/history
  cannot admit another token use or lose a certificate.
- Registration/renewal CA tests parse the emitted DER and assert exact CN/subject
  serial, one agent URI SAN, empty DNS/IP/email SANs, exact ClientAuth-only EKU,
  exact key usage, `IsCA=false`, key match, and response/event fingerprint,
  `NotBefore`, and `NotAfter` equality using a clock with non-zero nanoseconds.

### Server deletion regression tests

- Real `DeleteDevice` handler plus real Postgres and CRL backend covers correct,
  absent, malformed, unauthenticated, wrong-permission, out-of-scope, and unknown
  device requests under existing auth conventions.
- Authoritative replay covers one/multiple renewals, duplicate fingerprints,
  certless registration, partial/malformed fingerprint/`NotBefore`/`NotAfter`
  payloads, current, expired, not-yet-valid, and legacy future-expiry events lacking
  `NotBefore`, both exact time equality boundaries, prior deletion request, and
  already-deleted state. These time classes use injected clocks and authoritative
  event fixtures rather than impossible public issuance. Certless proof deletes
  without CRL; malformed/partial authority returns opaque `Internal` and no
  `DeviceDeleted`.
- Missing CRL wiring or CRL write failure for any future-expiry certificate returns
  opaque `Internal`; `DeviceDeletionRequested` remains durable and retryable while
  `DeviceDeleted` and its projection transition are absent. Expired-only history
  follows the explicit no-CRL branch.
- A self-discovered race matrix pauses every live-device mutation at the lifecycle
  guard, including heartbeat/seen/inventory, renewal, queue/pending work, tokens/
  secrets, terminal/session setup, and deletion. A mutation already holding the
  lock completes before deletion; every later path replays `DeviceDeleted`, creates
  zero queue/token/secret/session/persistence effects, and returns its exact terminal
  rejection. Deletion revokes every issued future-expiry fingerprint, including a
  superseded certificate whose earlier best-effort revocation failed.
- Projector failure/cancellation and a higher-sequence heartbeat projected before
  an earlier renewal prove deletion still revokes the exact certificate returned
  by renewal. Zero affected projection rows cannot change authoritative behavior.
- Injected final deletion-append failure after one/all successful revocations leaves
  the device stream non-deleted with immutable request evidence; retry is safe and
  eventually appends deletion. Event ordering proves request → CRL effects → delete.
- The self-discovering device-mutation/append guard covers every live-device entry
  point and append wrapper with stale, missing, duplicate, audit/creation exception,
  and matches-zero red-checks.

### Activation and fence tests

- A connection that has not declared the authority-model capability cannot
  append any guarded event type (red-checked per type); a declaring connection
  succeeds unchanged; removing the trigger or the declaration makes the fence
  tests fail (AC 18, 20).
- Activation preserves the old renewal-lock namespace and refuses traffic when
  the history scan finds malformed token authority or renewal/mutation after
  `DeviceDeleted`; reconciled legacy histories prove required revocation and
  version continuity (AC 19).
- Gateway integration (shared with spec 38's lane): one fresh public
  Traefik-path probe plus a separate internal actor that discovers each Gateway
  replica and connects directly with production SNI; a newly issued TLS-valid
  old certificate completes TLS and receives the exact CRL HTTP 403/log on the
  public route and every replica. TLS failure or later entity lookup does not
  count as revocation proof.

## Rejection paths

| Scenario | Exit/result | Operator-visible message | Logged context |
|----------|-------------|--------------------------|----------------|
| Token allowance exhausted/consumed/admin-disabled | Connect `PermissionDenied`; no partial batch | Registration token unavailable | Token ID and admission category; no token value |
| Token lock/replay/decode/batch infrastructure fails | Connect opaque `Internal`; no partial batch | Registration failed safely | Token ID and safe stage/category |
| Post-deletion user mutation | Existing non-enumerating `NotFound`; zero side effects | Device not found | Actor, method, device ULID; no secret material |
| Post-deletion heartbeat/seen/inventory | Terminal acknowledged drop; zero side effects | Agent must stop/re-enroll as existing protocol defines | Device ULID, writer class, deleted state |
| Device lock/replay/decode infrastructure fails | Connect opaque `Internal`; no side effects | Device operation failed safely | Device ULID and safe stage/category |
| Certless authoritative history | Delete success without CRL | Device deleted; no certificate existed | Device ULID and certless branch |
| Future-expiry CRL store/revoke fails | Connect `Internal`; deletion request only | Old device remains; retry revocation | Device ULID and opaque certificate index/stage |
| Partial/malformed authoritative certificate history | Connect `Internal`; no `DeviceDeleted` | Reconcile event history before retry | Device ULID and payload category; no cert material |
| Revocation succeeds but final deletion append fails | Connect `Internal`; request event remains | Safe to retry deletion | Device ULID and append stage |
| Guarded append from a connection without the capability declaration | Storage-level rejection; nothing committed | Legacy replica must be upgraded; write refused | Event type, stream, missing-capability category |
| Activation history scan finds malformed/post-delete authority | Activation aborts; no traffic | Reconcile event history before activation | Stream ID and violation category |

## Rollout and migration

This spec lands and activates **before** spec 38's agent artifact releases. It
is reviewed and gated as its own change set through spec 37's harness (real
`Register`/`DeleteDevice` scenarios and the CRL revocation flow are existing
deployed-contract territory; no new lane is required). Activation order:

1. Land replay helpers, lifecycle/token locks, and the self-discovering guards
   dark (unreferenced by handlers) with their unit/regression suites green.
2. Run the activation migration: stream heads, retention exemptions, append
   guard, history scan. The migration aborts on unreconciled history.
3. Deploy fenced binaries (which declare the capability at pool init) — the
   handler paths switch to authoritative replay in the same release. Any
   lingering legacy replica now fails closed at the database on its first
   guarded write.
4. Only after this spec is active in production may spec 38's agent artifact
   (and its `offline-reenrollment-v1` registration) release.

The existing renewal lock namespace is preserved throughout; no event is
rewritten; projections are rebuilt normally after activation.

## References

- Spec 38 — agent offline reenrollment (consumer of these guarantees)
- Spec 37 — exhaustive deployment E2E gate
- `server/internal/api/registration_handler.go` — token-before-device event order
- `server/internal/api/device_handler.go` — current delete-before-best-effort-revoke ordering
- `server/internal/api/certificate_handler.go` — existing per-device renewal lock
- `server/internal/handler/agent.go` — Gateway CRL admission layer
- `server/internal/store/` — event store, retention, `AppendEvents` (spec 28)
