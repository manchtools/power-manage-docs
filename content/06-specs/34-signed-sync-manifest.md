---
title: "Signed sync manifest (authenticated action orchestration)"
status: draft
created: 2026-07-12
---

# Signed sync manifest (authenticated action orchestration)

## Overview

Authenticate the complete device action-sync snapshot, not only each action's
execution payload. Control issues a deterministic per-device
`SignedSyncManifest` — signed with the **action-signing key** under the
`power-manage-sync-manifest` domain, never a TLS CA key — that binds
freshness, sync cadence, standalone occurrences,
group occurrence identity/order/cadence, and the maintenance window to the exact
signed action envelopes transported with the response. The agent verifies every
byte and applies the verified snapshot atomically before it changes any durable
scheduler state.

## Motivation

`SignedActionEnvelope` currently authenticates action-local execution data, but
`SyncActionsResponse` represents the same action again through an outer `Action`
and adds unsigned group and response metadata. Execution verifies the envelope,
while persistence, scheduling, grouping, maintenance, change detection, and
removal-by-omission still consume the outer representation. A compromised relay
can therefore retain a valid envelope while changing orchestration, or omit an
action and trigger policy cleanup.

The duplicated representation also loses occurrence identity. Group membership
is persisted through one global action row keyed by logical action ID, so the
same action appearing in multiple groups can become last-write-wins and execute
a different occurrence's envelope. Finally, the sync path has no persisted
freshness value, so an older valid snapshot can be replayed.

This specification makes the individually signed envelope the sole authority for
action-local semantics and makes the signed manifest the sole authority for
snapshot-level orchestration.

## Acceptance criteria

1. Given an agent does not send the exact signed-manifest protocol discriminator,
   when it calls public sync, then Gateway validates locally and returns
   `InvalidArgument` without proxying. Control independently applies the same
   validation to internal sync before binding or resolution. Given a new agent
   receives a legacy response with no valid manifest, then it rejects before any
   mutation.
2. Given Control creates a successful sync response, when it serializes the
   response, then it includes deterministic `SignedSyncManifest` bytes, a
   signature over those exact bytes under the dedicated
   `power-manage-sync-manifest` signature domain, and an indexed transport array
   of individually signed action envelopes.
3. Given the manifest signature is absent or invalid, the manifest cannot be
   decoded or validated, or any referenced action envelope is absent, extra,
   duplicated, mismatched, or invalid, when the agent processes the response,
   then it rejects the **entire sync before any persistent or in-memory
   scheduler mutation**.
4. Given a valid manifest for another device, an expired manifest, an issuance
   time beyond the allowed clock skew, an invalid 15-minute validity interval, or
   a signed `(epoch, generation)` not strictly greater than the transactionally
   persisted `(last_applied_epoch, last_applied_generation)` under lexicographic
   ordering (higher epoch always wins; equal epoch requires strictly greater
   generation), then the agent rejects the entire sync. Clock-skew rejections
   (issuance too far ahead) and tamper rejections (signature/digest failure)
   carry DISTINCT rejection categories in reports and logs — an operator must be
   able to tell a drifting clock from an attack without reading payloads.
5. Given an unchanged resolved action state, when Control successfully issues a
   later sync response, then it still allocates a fresh, strictly increasing
   per-device generation within the current epoch so reconnect/full-reconcile
   requests remain usable and delayed lower-generation responses are rejected.
6. Given Control constructs a response, then it enforces every per-item/count
   bound and the final 16 MiB encoded-response limit before transport. Given the
   agent receives a response, its 16 MiB Connect read limit applies before the
   outer `SyncActionsResponse` can decode; only after that decode does the agent
   validate manifest/signature/dispatch/reference bounds before unmarshalling any
   embedded manifest or envelope bytes. Each reference index is in range, its
   SHA-256 is exactly 32 bytes and matches the exact referenced envelope bytes,
   and every transport index is referenced exactly once. Equal envelope bytes are
   allowed only as distinct indexed occurrences.
7. Given a signature-valid envelope occurrence, then a mutation-free semantic
   validator also proves its action ID, supported nonzero type, desired-state
   rules, timeout bound, target ULID, exact type/params-oneof coherence, nested
   parameters, and schedule rules before it is accepted. Those action-local
   values derive only from the verified `SignedActionEnvelope`; unsigned outer
   `Action` copies are removed and cannot influence persistence or execution.
8. Given a standalone occurrence, then its cadence is the verified envelope's
   schedule. Given a grouped occurrence, then the envelope schedule is absent
   and the occurrence's group cadence, ordered position, and membership come
   only from the signed manifest. An effective server interval of zero is
   normalized to the exact signed value `30` minutes before manifest creation.
9. Given manifest groups, then every `group_key` is exactly the canonical current
   resolver identity `definition:<ULID>` or `action_set:<ULID>` and is unique
   within the snapshot. `position` means the zero-based index in the signed
   `members` list, encoded as canonical base-10 without leading zeros; it is
   execution order, not database `sort_order` or occurrence identity. Grouped
   occurrence identity additionally uses logical action ID, effect fingerprint,
   and a zero-based duplicate ordinal among equal `(action ID, effect)` members so
   cadence-only and order-only changes retain the same occurrence keys. The
   resolver's existing collapsed reach semantics remain unchanged; this spec does
   not invent assignment-path IDs.
10. Given two persisted occurrences contain the same logical action ID, then each
    retains and executes its own verified envelope bytes and schedule context.
    Existing action-result reporting remains keyed by logical action ID and may
    produce multiple results; per-occurrence result identity is not claimed.
11. Given a verified fresh manifest, when the agent applies it, then it acquires
    the shared apply/dispatch mutex before the store write lock and SQLite
    transaction, commits standalone/grouped occurrences, ordered membership,
    maintenance, signed interval, durable work, and generation together, refreshes
    scheduler memory, and only then releases the mutex. A rollback leaves the
    complete previous snapshot and generation active; no dispatch observes a
    committed snapshot with stale in-memory policy.
12. Occurrence removal and cleanup authority — each sub-criterion maps to its
    own test:
    a. Given generation N+1 removes one occurrence but another occurrence with
       the same logical action ID survives, then only the removed scheduler
       occurrence is deleted and no machine-state cleanup is recorded.
    b. Given the logical action disappears completely from the snapshot, then
       signed whole-snapshot omission is the sole authority for exactly one
       cleanup work item keyed by logical action ID.
    c. Cleanup may derive `ABSENT` only for the self-discovered
       cleanup-eligible partition and only from a verified prior envelope whose
       cleanup-relevant fields agree across all prior duplicate occurrences.
    d. Given cleanup ambiguity (conflicting or invalid prior envelopes) for a
       NON-security action type, cleanup is blocked and reported; the snapshot
       still commits.
    e. Given cleanup ambiguity for a security cleanup type (`USER`, `GROUP`,
       `SSH`, `SSHD`, `ADMIN_POLICY`, `LPS`), cleanup is blocked AND the agent
       raises a loud operator/compliance alert through the existing
       security-alert reporting path — a durable, re-reported alert naming the
       logical action and the un-reverted privileged state, never only a log
       line: a deprovisioned admin, sudoer, or SSH key silently persisting on
       the device is the insecure direction of "fail closed". The snapshot
       still commits — blocking acceptance would let one ambiguous stale row
       deny every future policy change, including an emergency revocation —
       and the alert persists until the operator resolves the machine state.
13. Convergence work — each sub-criterion maps to its own test:
    a. Given a new, effect-changed, or first-reconcile occurrence requires
       convergence work, when its snapshot commits, then one generation-owned
       work row is recorded durably in the same transaction.
    b. Pending work for a surviving occurrence with the same effect is
       atomically re-owned by generation N+1, including when N+1 is otherwise
       unchanged; cadence/order changes update its due policy but never
       discard or duplicate it.
    c. Work becomes durably `canceled` only when its occurrence is removed or
       its effect is superseded.
    d. A self-discovering exact classifier assigns every supported
       action/parameter case as idempotent or non-idempotent, with a
       matches-zero guard.
    e. Idempotent `started` work is retryable after restart.
    f. Non-idempotent work must durably transition `pending` → `started`
       before the executor runs, and becomes operator-visible `uncertain`
       rather than auto-repeating if restart occurs before `completed`.
    g. A failed transition never calls the executor. Exactly-once machine-side
       effects are not claimed.
14. Given a manifest is valid when accepted, when its `expires_at` later passes
    while the device is offline, then already committed scheduler state continues
    to operate; expiry limits acceptance of delayed snapshots, not offline action
    execution. There is deliberately NO in-agent max-staleness kill-switch in
    v1: offline autonomy is the product's core guarantee, and staleness of
    applied policy is bounded operationally (sync cadence, gateway-liveness
    alerting), not cryptographically. Revisit only with a dedicated spec.
15. Given Control cannot prove the device still exists and is not deleted inside
    the coherent transaction, cannot hydrate/sign any action, or encounters
    malformed persisted standalone/group schedule or maintenance JSON, then it
    fails the entire sync and signs neither a degraded omission nor fail-open
    cadence/maintenance state.
16. Given the public agent certificate does not authenticate the requested device,
    or the authenticated internal gateway is not the live gateway for that
    device, then the request is rejected before resolution or signing. Signed
    sync has no nil-registry/single-gateway allow bypass: Control startup fails if
    the live-device registry is not configured, while a transient runtime registry
    lookup/access failure returns retryable `Unavailable` before snapshot reads.
17. Given the public proxy receives a caller cancellation/deadline, then it
    preserves that context result. Given a Gateway→Control TLS, network, or plain
    HTTP peer-middleware failure, identified as a non-wire Connect error, then it
    maps to generic public `Unavailable`. Only `connect.IsWireError(err)` responses
    from a completed Control call enter the code allow-list: `InvalidArgument`,
    `PermissionDenied`, `NotFound`, `FailedPrecondition`, `ResourceExhausted`,
    `Unavailable`, `DeadlineExceeded`, and `Canceled` preserve the exact code with
    Gateway-owned safe text; every other wire code maps to generic `Internal`.
    Agent→Gateway TLS failure remains a transport failure with no fabricated
    HTTP/Connect response. After TLS, Gateway mTLS peer-class/revocation middleware
    returns its existing plain HTTP 401/403, while an admitted AgentService request
    whose identity context is absent or mismatches `device_id` returns Connect
    `Unauthenticated`/`PermissionDenied`. Raw messages, metadata, and details are
    never forwarded. Exhausted same-device serialization retries remain
    `Unavailable` end to end.
18. Given the separately action-key-signed LPS public key is present, then its
    existing independent verification and persistence path remains unchanged and
    is not treated as unsigned manifest state.
19. Given identical resolved state and injected time, when Control builds a
    manifest, then canonical sorting produces identical manifest bytes: standalone
    occurrences sort by verified action ID, groups by `group_key`, members retain
    their resolver-declared order and receive zero-based signed positions,
    maintenance days use `mon`…`sun`, maintenance entries sort by `(day-bitset,
    allow)`, and transport indices are assigned standalone-first then group/member
    order. ECDSA signature randomness does not affect this ordering.
20. Occurrence identity — each sub-criterion maps to its own test:
    a. Given an accepted occurrence, its stable local key is
       `standalone:<action ULID>` or
       `group:<group_key>:<action ULID>:<effect-sha256-hex>:<duplicate-ordinal>`,
       with the duplicate ordinal zero-based among members with the same action
       ID and effect fingerprint in signed order.
    b. Transport index, signed position, generation, issuance time, expiry,
       cadence, and signature bytes are never identity.
    c. Duplicate standalone logical IDs or duplicate stable keys reject the
       snapshot.
    d. An `effect_fingerprint` hashes canonical verified executor semantics
       (type, target, desired state, and action parameters) while excluding
       cadence, group position, timeout/policy metadata, and
       signature/issuance metadata.
    e. A separate `orchestration_fingerprint` covers the verified envelope plus
       signed schedule/order context.
    f. Cadence-only and order-only changes persist new orchestration without
       creating convergence work.
    g. `run_on_assign` affects the due time only while an occurrence has no
       completed execution: false→true may make existing pending work
       immediately due subject to maintenance; it does not create a second
       work item or re-run an already-completed effect.
21. Given an upgrade from legacy scheduler tables, when the new agent starts
    before its first valid manifest, then legacy standalone/grouped rows are
    structurally quarantined and cannot dispatch. The first valid manifest either
    adopts current occurrences or uses verified prior envelopes plus signed
    omission for unambiguous cleanup; invalid legacy envelopes remain inert and
    are reported, never executed or guessed.
22. Given two occurrences share one logical action ID, when each produces a
    result and either occurrence is later removed, then both result rows retain
    their stable result IDs, logical action ID, and occurrence key until normal
    result synchronization; occurrence deletion cannot cascade unsynchronized
    results.
23. Given the SDK sync call succeeds, then it returns the generated
    `SyncActionsResponse` directly rather than copying fields through a handwritten
    facade. A descriptor-backed contract test covers the exact manifest,
    signature, dispatch, and LPS fields and spec 37 registers the
    `signed-manifest-v1` payload contract for the existing unary procedure.
24. Given convergence work exists while the signed maintenance window is closed,
    then work remains durable but is not dispatched. `run_on_assign` may change
    the due time of the one pending item only while the occurrence has no completed
    execution; it neither creates a duplicate nor bypasses signed maintenance.
    Only separately authenticated instant-push paths retain their existing explicit
    bypass.
25. Given spec 38 replaces the credential device ULID, then before any pending
    result send, dispatch, or action sync, the agent store is bound to the same
    device ULID as the canonical credentials. The old identity's occurrences,
    work, generation, signed interval/maintenance, LPS public key, and unsent
    results are retired without executing cleanup; the new identity starts with
    generation zero and cannot observe or transmit the old namespace.
26. Given the persisted `(last_applied_epoch, last_applied_generation)` is
    `(E, G)`, when a verified manifest arrives bound to epoch `E' > E`, then
    the agent accepts it regardless of its generation relative to `G`,
    transactionally persists the new `(E', G')` baseline, and thereafter
    rejects anything at or below it. The epoch lives INSIDE the signed
    manifest bytes, so a relay cannot mint or replay an epoch bump; only a
    documented operator/DR action on Control (backup restore, lagging-replica
    promotion — see Rollout) increments the server-side epoch. Without this,
    a restored Postgres backup would set the issuance counter below fleet
    `last_applied_generation` and permanently wedge every device fail-closed,
    with no path to deliver even an emergency revocation.
27. Given the signed manifest's bound `protocol_version` differs from the
    discriminator the agent sent, or is not a version the agent supports, then
    the agent rejects the entire sync before any mutation. The bound version is
    inside the signed bytes, so cross-version confusion is prevented
    cryptographically, not only by rollout policy; on Control, response
    construction is unreachable without a validated request discriminator, and
    the constructed manifest always binds that validated value.
28. Given the manifest signature, then it verifies under the action-signing
    key (`power-manage-sync-manifest` domain) and MUST FAIL verification under
    either TLS CA key (agent-plane CA and server-plane CA) — a test proves
    both directions, so an implementation that reaches for a TLS CA key
    cannot pass the suite.

## Out of scope

- Changing the authority or format of action parameters inside
  `SignedActionEnvelope`; the envelope remains the action-local authority.
- Encrypting the manifest. It authenticates orchestration but contains no new
  credential material.
- Freshness for the instant-push `OnActionWithStreaming` path. This specification
  covers authoritative sync snapshots only.
- Exactly-once external machine effects. SQLite can atomically persist work
  intent, but package managers, scripts, filesystems, and account changes do not
  participate in that transaction.
- Folding the separately signed LPS public key into the manifest.
- Adding a per-occurrence identifier to `ActionResult`; result transport remains
  keyed by logical action ID even though local storage/execution is occurrence-based.
- A compatibility fallback to the old unsigned `SyncActionsResponse` shape.

## Technical design

### Affected repositories and implementation order

Prerequisites are narrowly scoped but complete. Spec 37's core registry/fixture
harness, reviewed three-key SHA manifest, and stable lane/readiness registry must
exist first, together with its already-activated `agent-socket` baseline. Current
source already contains the narrow spec-31 prerequisites: gateway boot enrollment
issues a unique per-gateway CN/DNS-SAN certificate used as both Gateway server and
Control client identity, and synchronous `InternalService` binding derives the
instance ID from the authenticated peer-certificate CN. The compatible candidate
must preserve and test those properties; spec 31's remaining Control-HA and agent-
side Gateway-CRL parts are not prerequisites. The superseding trust-model ADR
prerequisite is **satisfied**: ADR 0032 (ratified 2026-07-18) reconciles the
shared CA/action-signing-key model and the distinction among SPIFFE peer class,
CN instance identity, and DNS server name. Spec 38's dormant
management-device binding/classifier foundation must be present in the compatible
agent candidate before the persistence work here registers identity-bound state;
it need not be separately released and must not yet register
`offline-reenrollment-v1`.

Implementation order:

1. **sdk** — create the protobuf/generated-code candidate commit, deterministic
   manifest marshalling, and signature domain; do not publish a compatibility
   release yet.
2. **server** — build coherent snapshot assembly, per-device issuance generation,
   and manifest signing against that exact `sdk_sha`.
3. **agent** — include spec 38's dormant identity binding/classifier foundation in
   the compatible candidate, then build verification, occurrence-based
   persistence, atomic application, and durable convergence against the same
   `sdk_sha`. Do not register `offline-reenrollment-v1` in this phase.
4. **coordinated gate/release** — register `signed-manifest-v1` only with the
   complete green `agent-signed-sync` lane; record exactly `sdk_sha`, `server_sha`,
   and `agent_sha` in spec 37's reviewed change-set manifest, run the complete
   compatible set, and release no member before it is green. Deploy/E2E source is
   part of `server_sha`; generated clients are part of `sdk_sha`.

Concrete touchpoints are `sdk/proto/pm/v1/{agent,internal}.proto`, `sdk/verify`,
`sdk/client.go`; `server/internal/{api,actionparams,resolution,store}` plus Gateway
sync proxying and Control startup wiring; and
`agent/internal/{store,scheduler,executor}` plus agent runtime/migrations. The SDK
`SyncActionsResult` copy facade is removed: `Client.SyncActions` returns the
generated `*pm.SyncActionsResponse` directly.

The change is a coordinated V1 clean break. Generated Go and TypeScript code is
regenerated from the proto source; generated files are never hand-edited.

### Proto changes

Reuse the existing `ActionDispatch` transport (`envelope` + `signature`) rather
than introducing a duplicate wrapper, tightening its existing validation tags to
the bounds below. Delete the obsolete `ActionGroup` message; no compatibility
alias remains. `agent.proto` also imports `google/protobuf/timestamp.proto`. The
complete intended schema delta is:

```proto
enum SyncProtocolVersion {
  SYNC_PROTOCOL_VERSION_UNSPECIFIED = 0;
  SYNC_PROTOCOL_VERSION_SIGNED_MANIFEST_V1 = 1;
}

message SyncActionsRequest {
  // @gotags: validate:"required"
  DeviceId device_id = 1;
  // @gotags: validate:"required,oneof=1"
  SyncProtocolVersion protocol_version = 2;
}

message ManifestEnvelopeRef {
  // Zero is a valid first transport index; the snapshot-wide validator also
  // checks this against the actual transport length.
  // @gotags: validate:"lte=4095"
  uint32 envelope_index = 1;
  // @gotags: validate:"required,len=32"
  bytes envelope_sha256 = 2;
}

message ManifestGroup {
  // Exactly "definition:<ULID>" or "action_set:<ULID>"; generated length
  // validation is followed by canonical prefix + ULID validation.
  // @gotags: validate:"required,len=37"
  string group_key = 1;
  // @gotags: validate:"required"
  ActionSchedule schedule = 2;
  // @gotags: validate:"min=1,max=4096,dive"
  repeated ManifestEnvelopeRef members = 3;
}

message SignedSyncManifest {
  // @gotags: validate:"required,ulid"
  string device_id = 1;
  // @gotags: validate:"required"
  uint64 generation = 2;
  // @gotags: validate:"required"
  google.protobuf.Timestamp issued_at = 3;
  // @gotags: validate:"required"
  google.protobuf.Timestamp expires_at = 4;
  // Effective interval; a resolved zero is normalized to 30 before signing.
  // @gotags: validate:"gte=1,lte=1440"
  int32 sync_interval_minutes = 5;
  // @gotags: validate:"max=4096,dive"
  repeated ManifestEnvelopeRef standalone = 6;
  // @gotags: validate:"max=1024,dive"
  repeated ManifestGroup groups = 7;
  // @gotags: validate:"omitempty"
  MaintenanceWindow maintenance_window = 8;
  // Bound protocol version (AC 27): signed, so a relay cannot rewrite it. Must
  // equal the validated request discriminator.
  // @gotags: validate:"required,oneof=1"
  SyncProtocolVersion protocol_version = 9;
  // Epoch for DR-recovery ordering (AC 26): ordering key is (epoch, generation),
  // lexicographic. Starts at 1; bumped only by a documented operator action.
  // @gotags: validate:"required,gte=1"
  uint64 epoch = 10;
}

message ActionDispatch {
  // Deterministic SignedActionEnvelope wire bytes.
  // @gotags: validate:"required,min=1,max=12582912"
  bytes envelope = 1;
  // @gotags: validate:"required,min=1,max=1024"
  bytes signature = 2;
}

message SyncActionsResponse {
  // Deterministic SignedSyncManifest wire bytes. Field 1 is deliberately reused
  // under the project's V1 clean-break/no-reserved-marker policy.
  // @gotags: validate:"required,min=1,max=1048576"
  bytes manifest = 1;
  // Action-signing-key signature over manifest under the dedicated
  // power-manage-sync-manifest domain. NOT a TLS CA key (ADR 0025/0032).
  // @gotags: validate:"required,min=1,max=1024"
  bytes manifest_signature = 2;
  // Indexed by ManifestEnvelopeRef.envelope_index.
  // @gotags: validate:"max=4096,dive"
  repeated ActionDispatch action_dispatches = 3;
  // Independently action-key-signed; not manifest authority.
  // @gotags: validate:"omitempty"
  LpsPublicKey lps_public_key = 6;
}
```

`InternalSyncActionsRequest` retypes self-asserted `gateway_id` field 2 in place.
Current source already satisfies the two narrow spec-31 prerequisites: gateway boot
enrollment supplies a unique per-gateway certificate with the required DNS SAN plus
ServerAuth and ClientAuth usages, and synchronous `InternalService` binding derives
gateway identity from that authenticated peer-certificate CN. The request field is
therefore a stale duplicate rather than a required transition aid and must not
remain as a second authority. Asynchronous `control:inbox` provenance is a separate
queue-authentication contract and is not a prerequisite or source for this RPC:

```proto
message InternalSyncActionsRequest {
  // @gotags: validate:"required,ulid"
  string device_id = 1;
  // @gotags: validate:"required,oneof=1"
  SyncProtocolVersion protocol_version = 2;
}
```

Gateway validates the public discriminator locally before proxying, copies it
unchanged, and Control validates the internal value again before peer/device
binding or resolution. Both surfaces return `InvalidArgument` for an unsupported
value.

The public proxy has an explicit error-layer contract. Agent→Gateway TLS failures
remain transport failures and produce no invented HTTP/Connect result. After a TLS
connection exists, Gateway's outer mTLS middleware returns its existing plain HTTP
401/403 for missing certificate identity, wrong peer class, unavailable revocation
state, or a revoked certificate; it does not construct a Connect envelope. Only
after that middleware admits the request can AgentService's identity-context or
certificate/request-device checks return Connect `Unauthenticated` or
`PermissionDenied`. On the internal hop, preserve caller-context cancellation and
deadline first. Gateway→Control TLS/network failures and plain HTTP peer-middleware
rejections are non-wire Connect errors and map to generic public `Unavailable`.
Only `connect.IsWireError(err)` errors from a completed internal call enter the
allow-list: `InvalidArgument`, `PermissionDenied`, `NotFound`,
`FailedPrecondition`, `ResourceExhausted`, `Unavailable`, `DeadlineExceeded`, and
`Canceled` preserve their code with Gateway-owned text. Any other wire code maps
to generic `Internal`; raw messages, metadata, and details are never relayed.

Snapshot validation additionally requires at most
4096 references in total across standalone and all group members,
canonical/unique group keys, valid protobuf timestamps, `expires_at = issued_at
+ 15 minutes`, and `issued_at` no more than five minutes ahead of the agent's
injected clock.

The response deliberately reuses the old field-1 slot for the manifest, retypes
fields 2–3 for the remaining replacement transport, keeps the independently
signed LPS key at field 6, deletes old orchestration fields 4–5, and removes the
historical field-1/name reservations under the project's V1
no-reserved-marker/re-tag-in-place policy. The old standalone/grouped outer
`Action` transport and unsigned response-level sync/maintenance fields are
absent. A response with no assigned actions still contains a signed non-empty
manifest and an empty `action_dispatches` array.

The exact temporary candidate above was validated with the SDK's npm-pinned Buf
1.65.0 against the released `v2026.08` descriptor under `FILE` policy: `buf lint`
exited 0 and `buf breaking` exited 100 with exactly the 14 diagnostics below.
Approval permits only these diagnostics:

| Schema location | Exact permitted Buf rule(s) |
|---|---|
| Delete `pm.v1.ActionGroup` | `MESSAGE_NO_DELETE` |
| Remove the historical `SyncActionsResponse` reserved name `actions` and reserved range `[1]` while reusing field 1 | two `RESERVED_MESSAGE_NO_DELETE` diagnostics |
| `SyncActionsResponse` field 2: `sync_interval_minutes` → `manifest_signature` (`int32` → `bytes`) | `FIELD_SAME_NAME`, `FIELD_SAME_JSON_NAME`, `FIELD_SAME_TYPE` |
| Field 3: repeated `standalone_actions` → repeated `action_dispatches` (`Action` → `ActionDispatch`) | `FIELD_SAME_NAME`, `FIELD_SAME_JSON_NAME`, `FIELD_SAME_TYPE` |
| Delete field 4 `grouped_actions` | `FIELD_NO_DELETE` |
| Delete field 5 `maintenance_window` | `FIELD_NO_DELETE` |
| `InternalSyncActionsRequest` field 2: `gateway_id` → `protocol_version` (`string` → enum) | `FIELD_SAME_NAME`, `FIELD_SAME_JSON_NAME`, `FIELD_SAME_TYPE` |

The added enum/messages, public-request field, and replacement field 1 are
otherwise additive and must produce no breaking diagnostic. Any diagnostic
outside this exact set is a blocker.

`group_key` reuses the resolver's current canonical `SourceLabel` identity:
`definition:<definition ULID>` or `action_set:<action-set ULID>`. Current
resolution already collapses assignment paths into one reached definition or
standalone set, so inventing a second path identity would misrepresent the
existing policy model. Within a group, the signed member index is the zero-based execution position; it
is not database `sort_order` and does not by itself identify an occurrence.
Occurrence identity combines `group_key`, verified logical action ID,
`effect_fingerprint`, and the zero-based ordinal among equal `(action ID, effect)`
members. The ordinal is canonical base-10 without leading zeros.

Canonical collection order is part of the signed contract. Hydrate and
semantically validate deterministic envelope bytes first; then sort standalone
occurrences by verified action ULID, groups by `group_key`, and retain each group's
resolver-declared member order while assigning zero-based positions. Canonicalize
each maintenance entry's days into `mon,tue,wed,thu,fri,sat,sun` order and sort
entries by `(day-bitset, allow)`. Assign transport indices to standalone
occurrences first, then groups and members in those orders. Equal bytes at distinct
group positions remain distinct indices; randomized ECDSA signature bytes never
participate in sorting or either fingerprint.

The existing 16 MiB Connect read ceiling remains the aggregate response limit.
Control validates all per-item/count bounds, checks the final encoded response
size before returning, and maps an over-limit snapshot to `ResourceExhausted`.
The agent's Connect limit rejects an oversized wire body before the outer response
is decoded. After outer decode, the agent validates the 12 MiB envelope, 1 KiB
signature, 1 MiB manifest, 4096-dispatch, and total-reference bounds before
unmarshalling embedded manifest/envelope bytes or mutating state. The 12 MiB
envelope bound accommodates the existing 10 MiB file-content field plus protobuf
overhead.

### Signature and byte rules

- Add `SyncManifestSignatureDomain = "power-manage-sync-manifest"` beside the
  existing verification domains.
- Reuse `ActionSigner.SignDomain` and `ActionVerifier.VerifyDomain`; do not add a
  second signer abstraction.
- Deterministically marshal `SignedSyncManifest` once and sign those exact bytes.
- Compute every reference digest over the exact transported envelope bytes.
- Verify the manifest before decoding any orchestration as trusted state, then
  verify all reference invariants and every action envelope before mutation.

The manifest reference set is a strict bijection with the transport array:
indices must be in range and unique, every index must be referenced once, no
unreferenced transport item is accepted, and no reference may match by digest
alone without its signed index.

### Server snapshot and generation

`ProxySyncActions` first validates the internal protocol discriminator and the
authenticated gateway→live-device binding. The signed-manifest path requires the
registry; the current nil-resolver allow exception is removed and Control refuses
to start this service when the registry is not configured. Missing peer identity,
not-live, and mismatch remain the explicit permanent binding classifications; an
ordinary runtime registry lookup/access failure is retryable `Unavailable`. Only
after binding succeeds does Control build the complete manifest input from one
transactionally coherent PostgreSQL snapshot. Use `SERIALIZABLE` with bounded
retry. The device existence/non-deleted check runs inside that transaction before
generation allocation, and every tree, flat/user/permission-layer, group, action,
sync-interval, and maintenance-window read uses transaction-bound queries.

Add operational Postgres state equivalent to:

```text
device_sync_state(device_id PRIMARY KEY, epoch BIGINT NOT NULL DEFAULT 1,
                  generation BIGINT NOT NULL)
```

After the in-transaction device check, the transaction atomically increments and
returns the device's issuance counter before resolving the snapshot. This shared
database counter is HA-safe across Control replicas and advances for every
successful issuance, including an unchanged snapshot. The `epoch` column backs
AC 26: a documented operator/DR command (see Rollout) increments every device's
epoch (and may reset generations) after a backup restore or lagging-replica
promotion, so a counter that went backwards relative to the fleet cannot wedge
devices — the next manifest carries the higher signed epoch and re-baselines
each agent. Routine issuance never touches the epoch. It is operational
coordination state under ADR 0029, not a domain event or projection version. A
resolved sync interval of zero is normalized to the signed value `30`; no zero
sentinel crosses the manifest boundary.

After the coherent snapshot transaction commits, Control signs the captured
manifest bytes and returns them. A signing or response failure may consume a
generation number; gaps are valid, while reuse or regression is not. The
manifest uses a fixed 15-minute acceptance TTL from the injected clock. A later
request receives a fresh generation and expiry.

Any resolution inconsistency, concurrent deletion, missing action,
parameter-conversion failure, envelope-signing failure, canonical group-key
collision, malformed persisted standalone/group schedule JSON, malformed
maintenance JSON, or query failure aborts the response. Authoritative decode
helpers return errors; existing log-and-skip, malformed→nil, or no-maintenance
fallback behavior must not survive on this path. Exhausted serialization retries
return `Unavailable`; Gateway applies the exact allow-list and layer-specific
mapping above instead of rewriting every proxy failure to `Internal` or relaying
raw internal messages.

### Agent validation and atomic application

The agent sends the exact protocol discriminator on every sync. It performs a
mutation-free response-validation phase:

1. require bounded manifest bytes/signature (a legacy response fails here);
2. verify the signature over the exact manifest bytes before trusting orchestration;
3. decode and validate fields, device binding, fixed validity window, clock skew,
   and transport bounds;
4. validate canonical/unique group keys, the strict reference/transport bijection,
   per-item/aggregate bounds, and every digest;
5. verify every action envelope signature and run the mutation-free semantic
   validator: required ULID, supported nonzero type, desired-state and timeout
   rules, exact target ULID, type/params-oneof coherence, nested validation, and
   standalone-versus-grouped schedule rules;
6. construct stable occurrence keys and sanitized state only from verified
   envelope and manifest authority;
7. reject the complete response on any error.

The apply path always acquires locks in this order: shared apply/dispatch mutex,
store write lock, SQLite transaction. Before exposing any row, the store requires
its management-device binding to equal the canonical credential device ULID. It
then re-reads and validates `last_applied_generation`, applies the complete
occurrence snapshot, persists maintenance and interval, inserts work, stores the
new generation, commits, refreshes scheduler memory from committed rows, and
releases locks in reverse order. Missing generation means zero; corrupt or
overflowing state fails closed.

Spec 38 owns the credential-change transition and the self-discovering registry
of identity-bound tables/settings. This spec registers occurrence rows,
`sync_work`, `last_applied_generation`, signed interval/maintenance, persisted LPS
public key, and unsynchronized results in that registry. Reenrollment retires
those rows/keys transactionally and updates the binding before the new identity
can start; it does not reinterpret their deletion as signed omission or execute
cleanup work. Machine-local LUKS/LPS history and explicit local-admin settings
remain under spec 38's separately classified retained partition.

Occurrence rows use exact stable keys: `standalone:<action ULID>` and
`group:<group_key>:<action ULID>:<effect-sha256-hex>:<duplicate-ordinal>`.
`position` is a separate zero-based signed execution-order column. Each row stores
the logical action ID, deterministic verified envelope bytes, signature,
manifest-owned schedule context, generation, an `effect_fingerprint` over
canonical verified executor semantics, and an `orchestration_fingerprint` over
the envelope plus signed cadence/order policy. The effect hash includes type,
target, desired state, and action parameters but excludes schedule, position,
timeout/policy metadata, signatures, transport index, generation, issuance time,
and expiry. The duplicate ordinal is zero-based among equal `(action ID, effect)`
members in signed order. Duplicate standalone IDs/stable keys reject the
snapshot. Cadence/order updates persist atomically and retain the same occurrence
and work identity without claiming the external effect changed.

Results are independent history, not children of an occurrence row. Migrate the
current `results.action_id` relationship to store `logical_action_id` plus the
stable `occurrence_key` with no occurrence-delete cascade; unsynchronized results
survive occurrence removal. Existing result transport continues to report the
logical action ID, while local diagnostics can distinguish occurrences.

`sync_work` has one row per `(generation, kind, stable work key)` with kinds
`converge` and `cleanup`, the verified payload needed for execution, and states
`pending`, `started`, `uncertain`, `completed`, and `canceled`. Claiming and
cursor update occur in one transaction. When N+1 commits, pending work for a
surviving same-effect occurrence is atomically moved/re-owned to N+1 with its due
policy recalculated; it is never dropped merely because the generation changed.
Removal or effect supersession transitions unstarted work to `canceled`. A
self-discovering exact classifier covers every supported action/parameter case,
including service restart, as idempotent or non-idempotent. After restart,
idempotent `started` work returns to `pending`; non-idempotent `started` work
becomes `uncertain`, is reported, and is never automatically repeated.
Unsynchronized results remain.

Pending work drains after commit and on startup, but signed maintenance remains
a dispatch gate. `run_on_assign` is due policy, not effect identity: while no
completed execution exists, false→true may move the one existing pending item to
immediate eligibility and true→false may move it back to the signed cadence;
neither transition creates a duplicate work row or repeats an already-completed
effect. Only separately authenticated instant-push paths retain their existing
explicit maintenance bypass. A failed start/due transition returns without
calling the executor; warn-and-proceed is forbidden.

Whole-snapshot signed omission is the only exception to envelope-authored desired
state. When the last occurrence of a logical action disappears, one cleanup work
item may clone a verified prior envelope and derive `ABSENT` only if the action is
in the existing self-discovered cleanup-eligible partition and every prior
duplicate agrees on type, target, and cleanup parameters. Otherwise cleanup is
blocked and reported; the agent never guesses which occurrence's parameters to
use.

Pin SQLite's per-connection synchronous mode to `FULL` and test it alongside WAL,
foreign keys, and busy timeout so a successful anti-rollback generation commit
has explicit power-loss durability semantics.

### Database changes

- **Server:** one migration and generated query set for the operational
  per-device manifest issuance counter. Add `device_sync_state` to the
  self-discovering schema-classification registry as operational HA/security
  coordination state, with the rationale above. No user-facing domain event is
  added.
- **Agent:** replace logical-ID-keyed scheduler rows with occurrence rows keyed as
  above and a separate zero-based signed position; store effect and orchestration
  fingerprints; migrate results to independent `logical_action_id` +
  `occurrence_key` history; add the exact generation-owned `sync_work` state
  machine including carry-forward and durable cancellation; and retain validated
  decimal generation/sync settings through transaction-local helpers.
  Register every server-authored table and setting in spec 38's exact
  management-identity classification so a credential device-ID change retires the
  old namespace before runtime use. Legacy standalone/group rows move to a
  non-dispatchable quarantine before the scheduler starts. They may supply cleanup
  parameters only after their envelope verifies and a first signed manifest
  authorizes omission; invalid/ambiguous rows remain inert and operator-visible.

### New dependencies

None. Reuse protobuf deterministic marshalling, SHA-256, existing signature
primitives, PostgreSQL/SQLite, and the existing scheduler store.

## Security considerations

- **Authenticated authority split:** envelopes own action-local semantics;
  manifests own complete snapshot orchestration. The sole explicit exception is
  whole-snapshot signed omission authorizing the narrowly classified local
  `ABSENT` cleanup derivation from a verified prior envelope; ambiguity blocks
  cleanup. No transported field has two accepted authorities.
- **Anti-replay and downgrade resistance:** the device-bound `(epoch,
  generation)` pair is strictly monotonic under lexicographic ordering and
  persisted with the snapshot; both components live inside the signed bytes, so
  a relay can neither replay an old generation nor mint an epoch bump. Expiry
  limits delayed acceptance. The required protocol discriminator — also bound
  inside the signed manifest (AC 27) — prevents a new server from sending an
  apparently empty authoritative response to an old agent and prevents
  cross-version confusion cryptographically; the new agent independently
  requires a valid manifest from any server.
- **DR recovery without fail-open:** the epoch mechanism (AC 26) is the sole
  recovery authority for a rolled-back issuance counter. It is an operator
  action on Control that produces *signed* manifests with a higher epoch — no
  agent-side override, no acceptance of unsigned resets, no weakening of the
  monotonicity check itself.
- **Caller binding:** Gateway authenticates the agent certificate and exact
  requested device before proxying. Control authenticates the gateway peer
  certificate and requires that device to be live on the calling gateway before
  resolution or signing. Registry absence is fail-closed; the previous
  single-gateway nil-resolver bypass is not valid for signed sync.
- **Relay capability:** a compromised relay can withhold or delay a valid
  response within its signed acceptance window, causing denial of service or
  bounded staleness, but cannot alter authenticated timing, reorder or duplicate
  occurrences, inject state, or make a modified omission pass verification.
- **Fail-closed omission:** Control never signs partial resolution, and the agent
  never applies a partial response. This is required because signed omission can
  trigger destructive policy cleanup.
- **Secrets:** manifest logs may include generation, device ID, group key, and
  safe counts, but never envelope bytes, parameters, signatures, or LPS material.
- **Audit:** issuance is operational read-side state and does not create one
  audit event per routine sync. Existing action execution/result audit behavior
  remains unchanged.

## Test requirements

### SDK tests

- Deterministic manifest bytes, canonical collection ordering, and cross-domain
  signature isolation.
- Correct/absent/wrong and boundary coverage for every new field and cross-field
  invariant, including zero/4095/4096 indices, 32-byte digests, group-key format,
  per-list/total occurrence limits, timestamps, interval, protocol enum, 12 MiB
  envelope, 1 KiB signatures, 1 MiB manifest, and 16 MiB encoded response.
- `ValidateSignedActionEnvelope` correct/absent/wrong coverage for ID, supported
  type, desired state, timeout, target, params-oneof coherence, nested parameters,
  and standalone/group schedule rules.
- Descriptor guard proving both sync requests carry the exact protocol field,
  response fields match the clean-break schema, all trust-boundary fields carry
  validation tags, and old unsigned orchestration is absent.
- `Client.SyncActions` returns the generated response directly; a loopback test
  asserts manifest bytes, manifest signature, dispatches, and LPS key without a
  handwritten field-copy layer.

### Server tests

- Real Postgres integration test: concurrent Control replicas issue strictly
  increasing per-device generations, including unchanged snapshots; a concurrent
  device deletion inside the transaction yields no signed manifest.
- Serialization retry and coherent-snapshot tests across action, group,
  assignment, sync-interval, maintenance, and deletion changes; exhausted retries
  map through Gateway as `Unavailable`.
- Real public-proxy rejection coverage uses one `TestSyncActions_<Scenario>`
  function per transport/middleware/handler scenario: Gateway→Control TLS failure,
  Gateway→Control peer-middleware rejection, Agent→Gateway TLS failure, post-TLS
  outer-middleware HTTP 401/403 (missing identity, wrong class, CRL unavailable,
  revoked), and admitted-handler identity-context/device mismatch. Each asserts
  the exact rejection layer and proves no HTTP/Connect response is fabricated for
  a TLS handshake failure. A table is permitted only for a pure code-classifier
  helper covering every allow-listed Control wire code, one unlisted code, and
  raw-message/metadata/detail redaction; it does not replace real-handler tests.
- Separate real-handler tests prove public agent-certificate/device mismatch,
  absent authenticated gateway identity, missing-live-binding, gateway mismatch,
  and runtime registry lookup/access failure reject before snapshot reads/signing
  with `Unauthenticated`/`PermissionDenied`, `InvalidArgument`,
  `FailedPrecondition`, `PermissionDenied`, and `Unavailable` respectively.
  Resolver/query/decode failures occur only after successful binding and fail the
  complete response as safe `Internal`; Control startup fails when the mandatory
  registry is not configured.
- Legacy/unspecified public protocol values reject locally without proxying;
  internal values reject again at Control. Both return `InvalidArgument`, and no
  empty authoritative snapshot is returned.
- Every shipped envelope digest/index matches the exact manifest occurrence.
- Any action hydration/signing failure, missing member, group-key collision,
  malformed persisted standalone/group schedule JSON, malformed maintenance JSON,
  or read error fails the complete response. Existing malformed→nil tests are
  replaced on this path with fail-closed expectations.
- Fixed injected-clock server test proves exact `issued_at`, `expires_at =
  issued_at + 15m`, and zero interval normalization to signed `30`.
- Canonical-order fixtures randomize database row order and still produce the same
  manifest bytes; a response one byte above 16 MiB returns `ResourceExhausted`.
- Schema-classification guard discovers `device_sync_state` and accepts it only
  through the explicit operational-state registry entry.

### Agent tests

- Correct manifest applies; legacy response, absent/bad signature, malformed
  bytes, wrong device, expired/invalid window, issuance exactly five minutes ahead
  versus one nanosecond beyond, stale/equal generation, corrupt generation,
  size/digest/index/bijection violation, bad envelope signature, semantic envelope
  violation, wrong target, invalid/duplicate group key, or grouped envelope
  schedule rejects the entire response without mutation.
- Equal envelope bytes at two distinct indices remain two distinct occurrences.
- Standalone cadence comes from the envelope; grouped cadence/order come from the
  manifest; unsigned outer fields no longer exist or influence behavior.
- Stable standalone/group keys survive transport reordering and generation/time/
  signature changes. Group fixtures prove zero-based signed positions and
  duplicate ordinals among equal `(action ID, effect)` members. Effect fingerprints
  ignore ECDSA randomness, cadence, and order; orchestration fingerprints change
  for cadence/order changes. Cadence-only and order-only updates persist the new
  orchestration without invoking the executor or creating convergence work.
- Two occurrences with one logical action ID retain distinct envelopes and local
  result occurrence keys. Both unsynchronized results survive deletion and still
  synchronize under the existing logical action ID wire contract.
- Snapshot, maintenance, interval, generation, results, and work journal are
  atomic across injected failures. A scheduler tick blocked on apply cannot
  observe committed rows until memory is refreshed; lock-order tests detect
  inversion.
- Removing the last occurrence creates one restart-durable cleanup only when
  prior verified cleanup fields agree and the type is in the self-discovered
  eligible partition. Removing one duplicate does not clean up; conflicting prior
  envelopes block cleanup.
- The idempotency classifier exact-set guard covers every supported action/
  parameter case with a matches-zero guard. Idempotent work retries after crash;
  non-idempotent `started` work becomes `uncertain`; failed start writes never
  call the executor. Pending work created by generation N, still blocked by
  maintenance, is re-owned by an unchanged N+1 and executes exactly once after the
  window opens. Removal/effect supersession persists `canceled`, and canceled work
  remains non-runnable across restart.
- Closed-window tests prove both `run_on_assign` and restart-recovered convergence
  remain pending until the signed window opens. Before any completed execution,
  `run_on_assign` false→true makes the existing pending item immediately due when
  maintenance permits, without creating a second row; after completion it does not
  rerun the effect.
- Upgrade tests boot with due legacy standalone/group rows: quarantine prevents
  dispatch before the first valid manifest; valid prior envelopes can support
  signed-omission cleanup, while invalid rows remain inert and visible.
- Cross-spec reenrollment tests bind a populated store to old device A, switch
  canonical credentials to new device B, and prove no A result is sent, no A
  occurrence/work dispatches, no A cleanup is derived, B accepts generation 1,
  and the exact identity-bound registry includes every table/setting introduced
  here with a matches-zero guard.
- Expired-after-acceptance committed actions continue offline.
- SQLite pragma guard proves `synchronous=FULL` on every pooled connection.

### Cross-repository and deployment tests

- Server-produced exact bytes verify and apply in the agent.
- Old agent → new Gateway is rejected by the protocol discriminator; new agent →
  old Gateway/Control rejects the manifest-less response without mutation.
- Tampering with any manifest byte, reference, group, interval, maintenance
  value, or transported envelope rejects the whole response.
- A delayed generation N response arriving after N+1 is rejected.
- Spec 37 registers a `signed-manifest-v1` payload-contract key for both public and
  internal sync, so this field-only unary schema change cannot pass through an
  unchanged procedure registry.
- The stable spec-37 lane key `agent-signed-sync` boots production Control,
  Gateway, and agent binaries, performs network sync, and uses spec 37's explicit
  read-only agent-SQLite diagnostic exception to inspect generation/occurrence
  state. It proves one real scheduled effect uses the authenticated snapshot. The
  generated-client protocol actor remains necessary but does not substitute for
  this store/scheduler lane.

## Rejection paths

| Scenario | Error/result code | Client/operator-visible behavior | Logged context |
|----------|-------------------|----------------------------------|----------------|
| Public/internal protocol absent or not signed-manifest V1 | `InvalidArgument` before response | Sync call fails; no response or scheduler change | Caller surface and protocol value |
| New agent receives legacy response / manifest absent | Local manifest-validation failure | Agent retains the complete prior snapshot and reports that authenticated sync data is missing | Device ID and `manifest missing`; no legacy payload |
| Manifest malformed, oversized, or signature invalid | Local manifest-validation failure | Agent rejects the whole response and retains prior state | Device ID and safe reason category |
| Wrong device, expired manifest, or non-increasing `(epoch, generation)` | Local freshness/binding failure | Agent rejects the whole response and retains prior state | Expected device, epochs, generations; no payload |
| Issuance time beyond the allowed clock skew | Local clock-skew failure — category distinct from tampering | Agent rejects the whole response; operator can distinguish clock drift from attack | Issued-at delta and skew bound; no payload |
| Manifest epoch below the persisted epoch | Local freshness failure | Agent rejects the whole response and retains prior state | Signed and persisted epochs; no payload |
| Bound `protocol_version` mismatches the sent discriminator or is unsupported | Local manifest-validation failure | Agent rejects the whole response and retains prior state | Bound and expected version values |
| Signed-omission cleanup ambiguous for a security type (`USER`/`GROUP`/`SSH`/`SSHD`/`ADMIN_POLICY`/`LPS`) | Cleanup blocked + durable compliance alert (AC 12e) | Operator sees a persistent security alert naming the un-reverted state; snapshot still commits | Logical action ID, type, conflicting occurrence keys; no secret params |
| Reference index/digest/bijection or total-bound violation | Local manifest-validation failure | Agent rejects the whole response and retains prior state | Generation, index/category, safe counts |
| Action envelope signature or target invalid | Local envelope-validation failure | Agent rejects the whole response and retains prior state | Generation, occurrence index, action ID only after verified decode |
| Duplicate/invalid group key or grouped envelope has a schedule | Local manifest-validation failure | Agent rejects the whole response and retains prior state | Generation, group key/category |
| Agent→Gateway certificate absent, untrusted, expired, or otherwise TLS-invalid | TLS handshake failure; no HTTP/Connect code | No application response is fabricated and no proxy call occurs | TLS category only; no certificate material |
| TLS connection reaches Gateway mTLS middleware but identity/class/CRL/revocation gate rejects | Existing plain HTTP 401/403; no Connect envelope | Request does not reach AgentService or Control proxy | HTTP middleware rejection category; no certificate material |
| Outer middleware admits the request but agent identity context is absent or cert device mismatches request | Existing safe Connect `Unauthenticated` / `PermissionDenied` before proxy | Public sync fails without snapshot resolution | Authenticated certificate device and requested device |
| Gateway→Control TLS or peer-middleware authentication fails | Public `Unavailable` with Gateway-owned generic message | Agent retries; no manifest is signed | Internal listener and rejection layer; no peer material |
| Control returns an allow-listed Connect code | Same exact code with Gateway-owned safe message | Public caller receives the classified retry/rejection result | Procedure, code, safe stage; no raw Control message |
| Control returns any non-allow-listed Connect code | Public generic `Internal` | Sync fails without leaking an internal error contract | Procedure, original code, safe stage; raw message remains internal |
| Authenticated gateway identity absent, device not live, or binding mismatches | `InvalidArgument` / `FailedPrecondition` / `PermissionDenied` before resolution, then mapped by the proxy contract | Internal/public sync fails permanently; no manifest is signed | Authenticated gateway ID, device ID, safe category |
| Runtime registry lookup/access fails | `Unavailable` before snapshot reads, preserved through Gateway | Agent retries; no manifest is signed | Registry component, device ID, and opaque lookup category |
| Persisted generation corrupt/overflowing | Local state-validation failure | Agent refuses the snapshot and retains prior state | Setting name and parse category |
| SQLite snapshot/work-journal write fails | Local apply failure with transaction rollback | Agent reports sync-apply failure; the complete prior snapshot remains active | Generation/occurrence and database error category |
| Non-idempotent start-marker write fails | Local dispatch failure; executor is not called | Action remains pending without machine-side effect | Generation/occurrence and database error category |
| Restart finds non-idempotent work `started` | Local `uncertain` work state | Action is not auto-repeated; operator sees outcome-unknown failure | Logical action ID, occurrence key, generation; no parameters |
| Signed omission cleanup has conflicting prior envelopes | Local cleanup blocked | Machine state is retained and operator sees cleanup ambiguity | Logical action ID and conflicting occurrence keys; no secret params |
| Legacy scheduler row is due before first valid manifest | Quarantined / non-dispatchable | Agent waits for authenticated sync; legacy action does not run | Safe row/action identifier and quarantine reason |
| Registry required for signed sync is unavailable | Control startup failure / `Unavailable` during loss | No manifest service starts or signs without live binding | Registry component and health state |
| Persisted schedule/maintenance JSON is malformed | `Internal`; no manifest | Caller retries after operator repairs corrupted state | Device ID, row/type, decode category; no raw payload |
| Encoded response exceeds 16 MiB | `ResourceExhausted`; no response body | Snapshot is not applied; operator must reduce assigned payload | Device ID and safe size/count totals |
| Post-binding resolver/query/decode/hydration/signing fails | Safe `Internal`; no manifest | Sync call fails and carries no partial or degraded snapshot | Device ID and safe failing stage; no raw payload |
| Serialization retries exhausted | `Unavailable`, preserved through Gateway | Caller retries later; no manifest is returned | Device ID and retry count |

## Rollout and migration

This is a coordinated clean break across SDK, server, and agent:

1. Create and push the SDK candidate commit containing the schema, generated code,
   discriminator, semantic validator, direct generated-response client surface,
   and verification primitives, but do not tag or publish it as a compatible
   release.
2. Implement Control/Gateway and the agent's occurrence/result/work schema against
   that exact SDK commit. The agent migration quarantines legacy scheduler rows
   before scheduler startup; no compatibility dispatch path remains.
3. Record exactly `sdk_sha`, `server_sha`, and `agent_sha` in spec 37's
   coordinated change-set manifest. Deploy/E2E changes are included in
   `server_sha`; generated-client changes are included in `sdk_sha`. The SDK PR
   gate uses those compatible candidates rather than old default heads.
4. Land the compatible commits and record the exact resulting commit object for
   each reviewed change; never re-resolve a branch head or matching tag. Verify
   each commit is reachable from its configured release branch and both downstream
   dependency graphs resolve the recorded `sdk_sha`, then rerun the complete gate.
   A green mutable PR-head set does not authorize release.
5. Confirm the mandatory live-device registry, dormant spec-38 management binding
   and identity classifier, agent SQLite migration/quarantine, exhaustive protocol
   gate, registered `signed-manifest-v1` contract, and green `agent-signed-sync`
   lane against binaries/images built once from that final SHA set.
6. Only the green manifest-triggered gate may create repository tags/releases or
   promote tested OCI digests. Then release/deploy Control, Gateway, and agent
   together; no SDK version tag is published before consumers are proven.

**DR runbook (epoch bump, AC 26).** After any event that can move the issuance
counter backwards relative to the fleet — restoring a Postgres backup,
promoting a lagging replica — the operator runs the documented epoch-bump
command (a Control admin subcommand in the style of `control doctor`) BEFORE
returning Control to service. It increments `epoch` for every device row (and
may reset generations to zero). The next sync each device performs carries the
higher signed epoch and re-baselines the agent; no agent-side action is ever
required or possible. The runbook ships in the deployment-hardening docs
alongside the backup/restore procedure, and the restore procedure links to it.

The protocol discriminator is a rejection gate, not a compatibility mode. The
new agent always requires the manifest. The new server does not retain the old
unsigned orchestration fields, and there is no fallback, dual-read, or staged
alias. Release notes identify the minimum matching versions. The old scheduler
tables are migrated transactionally before the new agent starts dispatching.

The SDK currently declares Buf `FILE` breaking policy while project policy
permits explicit V1 clean breaks. With npm-pinned Buf 1.65.0, `buf lint` must pass.
Implementation runs `buf breaking` against the last released descriptor and must
receive exactly the `ActionGroup` deletion, two reservation-removal diagnostics,
response fields 2–3 retype/rename diagnostics, response fields 4–5 deletion
diagnostics, and internal-request field 2 retype/rename diagnostics enumerated
above (14 diagnostics total). Reusing response field 1 produces no additional
field diagnostic in the validated candidate. Any additional diagnostic is a blocker, and the policy must not be
weakened or compatibility aliases added to hide it. Advance the release baseline
after the coordinated SDK release so subsequent breaking checks are green against
the new schema.

Write an ADR on approval covering the authority split, issuance counter,
coherent snapshot requirement, occurrence-based persistence, protocol rejection
gate, and clean-break rollout.

## References

- WS1 action-signing envelope.
- WS17a replay/freshness gap.
- PMSEC-001 target binding and PMSEC-002 unsigned orchestration finding.
- ADR 0029: PostgreSQL operational state versus event-sourced domain state.
- Spec 31 Parts A and synchronous InternalService subset of Part C: unique
  per-gateway certificate and peer-CN binding prerequisite.
- Spec 37: exhaustive deployment E2E gate and `agent-signed-sync` lane.
- Spec 38: management-device binding and identity-bound store classifier.

## Audit findings (2026-07-18)

Pre-implementation security review. The cryptographic core is **sound** —
device-bound monotonic `generation` signed inside the manifest, 15-min TTL, double
device binding, a disjoint `power-manage-sync-manifest` signing domain, strict
manifest↔transport bijection (no selective envelope suppression), and no unsigned
fallback. No forgery, replay, rollback, or selective-suppression path survives the
described guards, even treating a compromised gateway as the attacker. But it is
**not implementable as written** until these are resolved:

- **[Medium] Unmet hard prerequisite: the superseding trust-model ADR does not
  exist, and current gateway identity contradicts ADR 0025.** The gateway→device
  binding reads the mTLS CommonName
  ([gateway_binding.go:31](../../../server/internal/api/gateway_binding.go)); ADR 0025
  rejects CN identity in favor of SPIFFE URI SANs, and no ADR (dir ends at 0031)
  reconciles them. Spec lines 240-242 name this reconciliation as a prerequisite.
  Fix: write that ADR first (shared with spec 31).
- **[Medium] Cleanup-on-omission is fail-open for security types.** "Ambiguity → skip
  cleanup" (AC 12) is the *insecure* direction for `USER` / `GROUP` / `SSH` / `SSHD` /
  `ADMIN_POLICY` / `LPS`: a deprovisioned admin/sudoer/SSH key persists on the device
  and is only "reported." Fix: for cleanup-eligible security types, ambiguity must
  raise a loud operator/compliance alert (not just log), and consider blocking
  acceptance of the whole snapshot rather than committing one that knowingly leaves
  an un-reverted privileged account. Add an AC + rejection row asserting the alert.
- **[Medium] Server `generation` rollback silently wedges the fleet with no
  recovery.** The anti-replay counter is server-authoritative in Postgres with no
  epoch/reset authority; a backup restore or lagging-replica promotion sets it below
  agents' `last_applied_generation`, and every subsequent manifest is rejected
  fail-closed — devices cannot receive any new policy (including an emergency revoke)
  until the counter organically climbs back. Fix: add an `epoch` bound inside the
  signed manifest (ordering key `(epoch, generation)`) that a documented operator/DR
  action bumps, plus an AC, rejection row, and DR runbook.
- **[Low-Medium] "CA-signed" terminology is wrong and dangerous.** The manifest is
  signed with the **action-signing key** (`ActionSigner.SignDomain`), a distinct
  authority from the two TLS CAs (ADR 0025). Calling it "Control-CA signature" (AC 2,
  proto comment line 349) could steer an implementer to sign with a TLS CA key. Fix:
  replace all "CA-signed" with "signed with the action-signing key under the
  `power-manage-sync-manifest` domain"; add a test asserting it verifies under the
  action-signing key and fails under either TLS CA key.
- **[Low] No protocol/schema version is bound inside the signed bytes.**
  `SignedSyncManifest` has no version field and the domain string is unversioned
  (contrast the LPS domain `…:v1`). Cross-version confusion is prevented only by
  rollout policy, not cryptographically. Fix: bind `protocol_version` inside the
  manifest; add an AC that the agent rejects a bound-version mismatch and that
  response construction is unreachable without a validated discriminator.
- **[Low] Compound ACs.** AC 12 / 13 / 20 bundle 5-8 assertions each — atomize
  before approval so each maps to one test. Also add a max-staleness decision for an
  already-applied manifest (AC 14) and a distinct rejection category for clock-skew
  vs tampering.

### Remediation (2026-07-18)

All findings above are folded into the spec body:

- **[Medium] missing trust-model ADR** → SATISFIED externally: ADR 0032
  (ratified 2026-07-18) reconciles CN instance identity with the SPIFFE class
  model; the prerequisite paragraph now cites it.
- **[Medium] security-type cleanup fail-open** → AC 12 atomized (12a-e); 12e
  mandates a durable, re-reported operator/compliance alert for ambiguous
  cleanup of `USER`/`GROUP`/`SSH`/`SSHD`/`ADMIN_POLICY`/`LPS`, with the
  snapshot still committing (blocking acceptance would deny emergency
  revocations); rejection row added.
- **[Medium] generation rollback wedge** → AC 26 + `epoch` field (10) inside
  the signed manifest; ordering key `(epoch, generation)`; `device_sync_state`
  gains the epoch column; DR runbook added to Rollout; rejection row added.
- **[Low-Medium] "CA-signed" terminology** → every occurrence replaced with
  action-signing-key wording; AC 28 mandates verify-under-action-key /
  fail-under-either-TLS-CA-key tests.
- **[Low] no version binding** → AC 27 + `protocol_version` field (9) inside
  the signed manifest, required to equal the validated request discriminator;
  rejection row added.
- **[Low] compound ACs** → AC 12/13/20 atomized into lettered sub-criteria;
  AC 14 records the deliberate no-max-staleness v1 decision; AC 4 and the
  rejection table now separate clock-skew from tamper categories.
