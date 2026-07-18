---
title: "OTLP audit & security event export"
status: draft
created: 2026-07-14
---

# OTLP audit & security event export

## Overview

Power Manage exports its audit and security-relevant events to an external
observability/SIEM pipeline using a single open standard — **OTLP logs**. A
dedicated exporter service streams events from the immutable event store,
redacts secret material, maps each to an OTLP `LogRecord`, and ships them to a
configurable OTLP endpoint (gRPC or HTTP) without entering the control server's
request or boot path. Power Manage is only ever the **producer**: it never
stores, queries, or serves exported events, and it speaks no legacy SIEM
dialect. Translation to a specific SIEM's ingest format (syslog/CEF, Splunk
HEC, etc.) is the operator's concern, performed by an OTel Collector they run —
the canonical `OTLP → syslog` bridge is stock Collector configuration, not code
Power Manage carries.

## Motivation

Regulated operators (NIS2 and similar) must feed a fleet manager's
security-relevant events — who did what, when; auth events; secret reads;
security alerts — into their central SIEM/MDR (Splunk, Sentinel, QRadar,
CrowdStrike, Arctic Wolf, …). Today Power Manage has the authoritative record
(the event-sourced `events` table, audit-only event types from specs 24/#496,
`SecurityAlert`), and an on-demand UI export (spec 26), but **no continuous,
machine-format push to an external system**. Operators cannot wire Power Manage
into their monitoring without scraping the UI export by hand.

We choose OTLP rather than implementing syslog/CEF/LEEF/vendor-APIs directly: it
is a single, stable, vendor-neutral open standard, and the per-vendor format
matrix already lives — mature and maintained — in the OTel Collector's
exporters. Power Manage emitting one protocol keeps its codebase free of legacy
framing; an operator whose SIEM cannot ingest OTLP directly runs a Collector
(`otlp` receiver → `syslog`/`splunk_hec`/… exporter) as the bridge. This spec
covers the emit side only.

Related: spec 24 (secret-read audit events), spec 26 (audit-log UX + export),
spec 19 (audit retention — the export cursor and the prune cursor share the
`sequence_num` commit-visibility contract), spec 31 Part E (multi-replica
single-flight via advisory lock).

## Acceptance criteria

1. Given the exporter enabled and a reachable OTLP endpoint, when a
   security-relevant event is appended, then within the configured flush
   interval it is delivered as one OTLP `LogRecord` carrying the event's id,
   `stream_type`/`event_type`, actor (type+id), target, outcome, and
   `occurred_at` as attributes — drawn EXCLUSIVELY from the fixed allow-listed
   attribute set (plus deployment identity). The raw or redacted `data`
   payload blob is never shipped as an attribute or body: a novel payload
   field can never leak by default, because only allow-listed attributes are
   emitted at all.
2. Given the export filter, every known event type is exported EXCEPT an
   explicit, small exclusion set (heartbeats/liveness and high-churn non-audit
   noise). The exported set is derived as *all known types minus exclusions*, so
   a newly-added event type is exported by DEFAULT — a new security-relevant
   event is never silently dropped (fail-toward-export for a compliance feed). A
   guard asserts the exported set is non-empty and that every excluded type is
   deliberately enumerated. Excluded events are locally acknowledged, so a
   checkpoint containing only exclusions still advances instead of looping.
3. Given a secret-bearing event (secret-read, IdP secret, LUKS/LPS), when it is
   exported, then the `LogRecord` carries identifiers and metadata only, never
   secret material — the export reuses the `redactEventData` audit redactor, and
   an unknown or malformed payload is emitted as a minimal metadata-only record
   with a mapping-error marker rather than skipped or copied through. Every
   payload-derived value — the `Body` summary and every `target.*` attribute —
   is built from the POST-redaction payload, never the raw one; a test asserts
   a secret planted in a payload field that feeds `Body`/`target.*` does not
   appear in the delivered record.
4. Given at-least-once delivery, when the exporter ships a batch, then the
   persisted cursor advances only after the endpoint acknowledges every
   exportable record through the checkpoint and locally acknowledges exclusions;
   on restart export resumes from the cursor with no gap, and resetting the
   cursor replays history from that point. A crash after remote acknowledgement
   but before cursor persistence may duplicate records, so consumers deduplicate
   on `event.id`.
5. Given the OTLP endpoint is unreachable or slow, when events are appended,
   then no event is lost (the cursor holds, the event store is the durable
   buffer), every export attempt has a bounded deadline, the RPC/append path is
   entirely unaffected, and export catches up automatically with bounded
   exponential backoff and jitter when the endpoint returns.
6. Given one or more exporter replicas, when a replica starts its export loop,
   then it must acquire the shared single-flight advisory lock before reading or
   sending; a standby replica does not export while another owns the lock. The
   lock prevents intentional fan-out but does not change the at-least-once
   duplicate window from AC 4.
7. Given concurrent in-flight appends, when the exporter chooses how far to
   advance, then it never advances past a `sequence_num` that a
   not-yet-committed lower append could still occupy — no event is skipped under
   concurrency (the prune.go commit-visibility contract).
8. Given no OTLP endpoint configured, when the dedicated exporter service boots,
   then it remains inert and healthy and nothing is shipped. Given an endpoint
   is configured but the URL/TLS/auth config is invalid, then the exporter
   service **fails to boot loudly** while control remains unaffected.
9. Given the export connection, when the exporter ships a batch, then it connects
   over TLS, presents any configured auth header sourced from encrypted-at-rest
   config, and no secret (auth header, event secret material) appears in exporter
   or control logs.
10. Given the endpoint returns an authentication rejection (HTTP `401`/`403` or gRPC `Unauthenticated`/`PermissionDenied`), when
    the attempt completes, then the cursor holds, the exporter enters an
    operator-visible unhealthy `auth-blocked` state, logs one redacted error per
    state transition, and probes again only at the maximum backoff until
    authentication recovers or the service is restarted with corrected config.
11. Given any event whose payload carries sealed PII (`pii:v1:` values), when it
    is exported, then the ciphertext ships OPAQUE: the export path performs no
    PII unseal — it MUST NOT call `OpenPayloadPII`, wire a `PIIOpener`, or
    unwrap any DEK, and the exporter binary does not link the PII-opening
    machinery at all. A mandated test proves a PII-bearing event reaches a mock
    collector with the `pii:v1:` ciphertext intact and no DEK unwrapped.
    (Sealing — not redaction — is what protects PII; `redactEventData` scrubs
    secrets and must not be mistaken for PII protection.)
12. Given the exporter's credentials, its Postgres role (`pm_otlp_export`) can
    `SELECT` on `events` and NOTHING else — a test asserts `SELECT` on
    `user_encryption_keys` is denied for the role — and the exporter process
    never receives `CONTROL_ENCRYPTION_KEY`: the OTLP auth header is supplied
    via a mode-0600 secret file, not KEK-decrypted config. This structurally
    guarantees AC 11 even against an exporter code bug: without KEK and without
    the DEK table there is nothing to unseal with.
13. Given the plaintext (insecure) endpoint toggle, when the exporter boots,
    then it accepts the toggle only for a loopback or unix-socket endpoint; an
    insecure endpoint with any non-loopback host fails boot loudly. The whole
    audit record must never cross a network segment in plaintext.
14. Given GDPR erasure, the export model is: exported records carry sealed
    `pii:v1:` ciphertext, so the spec-19 DEK shred also erases the meaning of
    every previously exported copy. Legacy pre-spec-19 events that carry
    plaintext PII are exported AS-IS (operator decision, 2026-07-18): the
    residual exposure is accepted and documented — see Security
    considerations for the flagged NIS2↔GDPR tension.

## Out of scope

- **Observability traces/metrics (APM).** This spec is event/SIEM export only.
  OTLP traces of the action-dispatch pipeline and RED/queue metrics are a
  separate future spec; they share the OTLP protocol choice but not the
  completeness/immutability contract.
- **The `OTLP → syslog`/CEF/HEC bridge.** Power Manage emits OTLP; the operator
  runs an OTel Collector to translate to their SIEM's format. A *reference*
  Collector config may be shipped as documentation, but Power Manage carries no
  syslog/CEF/LEEF/vendor-API encoder.
- **OCSF normalisation.** Emitting events as first-class OCSF class objects
  (per-event `class_uid`/`activity_id` modelling) is a downstream normalisation
  step — the same category as format translation — and belongs in the Collector
  or SIEM, not the exporter. v1 emits clean, granular, OCSF-*mappable*
  attributes; a first-class OCSF mode can be a later spec if demand appears.
  Half-done OCSF (mislabelled classes) would be worse than none.
- **Being a SIEM backend.** No storage, query, correlation, alerting, retention,
  or dashboards over exported events — the customer's SIEM owns all of that.
- **Agent-side telemetry export.** Agents run on customer networks; the control
  server is the single export point. Agent events already flow to control
  (control:inbox) and are exported from there.
- **A user-facing export-configuration RPC/UI.** Configuration is operator-level
  (env/config), matching other deployment secrets. A read-only status surface
  (cursor lag) may be added later.

## Technical design

The exporter is a **separate service** in the same repo/Go module as control,
the same shape as `cmd/indexer` — control's request path is UNCHANGED. Because
it shares the module it imports the real redaction and event-type logic directly
(no reimplementation, no drift), which is precisely what makes running it
out-of-process safe.

- `server/cmd/otlp-export` (new binary) — the standalone service: a ticker loop
  that tails the event store and ships OTLP. Its own deploy container.
- `server/internal/otlpexport` (new) — the exporter engine (used by the binary
  and by tests): read-after-cursor → exclusion filter → redact → map to OTLP
  `LogRecord` → batch → export → advance cursor on ack.
- `server/internal/store` — a "load committed events after sequence N up to the
  visibility checkpoint" reader (reusing the `PruneCheckpointBefore`
  commit-visibility bound). Strictly READ-ONLY against `events`.
- `server/internal/api/audit_handler.go` — export `redactEventData` (or a thin
  exported wrapper) so the exporter applies the EXACT redaction the audit UI
  does. This shared reuse is the whole reason a separate service stays safe.
- `server/internal/eventtypes` — an explicit `exportExclusions` set +
  `ExportedTypes()` = all-known-minus-exclusions, with the AC-2 guard.
- **Deliberately absent**: `server/internal/crypto` and the PII opener. The
  exporter never holds `CONTROL_ENCRYPTION_KEY` and never links the
  `OpenPayloadPII`/`PIIOpener` machinery (AC 11/12) — sealed `pii:v1:` values
  pass through as opaque ciphertext, and the auth header comes from a secret
  file, not KEK-decrypted config.

### Proto changes

None required for v1 — the exporter is config-driven, not request/response. (A
future read-only `GetExportStatus` RPC surfacing cursor lag is deferred.)

### Database changes

- The exporter's cursor (last-acknowledged `sequence_num`) persists in **Valkey**
  under one fixed service key. Losing the cursor may replay acknowledged events
  but cannot create a gap; OTLP remains at-least-once. Postgres access stays
  strictly read-only on `events`, so no migration or event-store write role is
  added.
- **Dedicated Postgres role** (AC 12): a new initdb script creates
  `pm_otlp_export` with `SELECT` on `events` ONLY — explicitly NOT the blanket
  `pm_readonly` `SELECT ON ALL TABLES` grant, which includes
  `user_encryption_keys` and would hand a KEK-holding process mass PII
  decryption. A guard test connects as the role and asserts `SELECT` on
  `user_encryption_keys` is denied.
- Every export cycle uses the existing PostgreSQL advisory-lock mechanism under
  a dedicated key before reading, sending, or advancing the cursor. The lock is
  mandatory for one replica and many replicas alike.
- No new event types. The exporter is a read-only consumer of existing streams.

### New dependencies

- OTel logs SDK + OTLP exporter: `go.opentelemetry.io/otel/log`, `.../sdk/log`,
  `.../exporters/otlp/otlplog/otlploghttp`, and `otlploggrpc`. Justification:
  OTLP is the chosen wire standard and there is no standard-library OTLP logs
  encoder; hand-rolling protobuf, transport, and batching would duplicate a
  maintained implementation. The dependency is confined to
  `cmd/otlp-export` and `internal/otlpexport`; it never enters the control or
  gateway binaries.

### Configuration (exporter service)

The service reads an events-only Postgres DSN (the `pm_otlp_export` role,
AC 12), Valkey (for the cursor), and `OTLP_EXPORT_*`. It never receives
`CONTROL_ENCRYPTION_KEY`. Absent endpoint ⇒ the service is inert (or simply
not deployed):

- `OTLP_EXPORT_ENDPOINT` — OTLP endpoint URL (e.g. `https://collector:4318/v1/logs`).
  Presence enables it.
- `OTLP_EXPORT_PROTOCOL` — `http` (default — OTLP/HTTP, the most broadly
  supported and proxy/firewall-friendly transport) or `grpc`.
- `OTLP_EXPORT_TLS_CA` / insecure toggle — endpoint trust. The insecure toggle
  is valid ONLY for a loopback or unix-socket endpoint; insecure + non-loopback
  fails boot (AC 13).
- `OTLP_EXPORT_HEADERS_FILE` — path to a mode-0600 secret file holding the auth
  header(s) (bearer/API key), mounted like the deploy stack's TLS keys. The
  boot check rejects a world- or group-readable file. No KEK-decrypted env
  variant exists (AC 12).
- `OTLP_EXPORT_INTERVAL` (default 5s) and batch size.
- `OTLP_EXPORT_TIMEOUT` (default 10s) — hard deadline for one endpoint attempt.
- `OTLP_EXPORT_MAX_BACKOFF` (default 5m) — retry ceiling; jitter is always on.
- `OTLP_EXPORT_HEALTH_LISTEN_ADDR` — liveness/readiness endpoint; readiness is
  false while `auth-blocked` or while configuration is invalid.

### Service shape

A ticker loop in the `cmd/otlp-export` binary. Every cycle first acquires the
shared PostgreSQL advisory lock; a replica that does not acquire it remains
standby for that cycle. The lock holder loads committed events with
`sequence_num >` cursor and `<=` the visibility checkpoint (AC 7), locally
acknowledges exclusions, redacts and maps exportable records, and sends them
under the configured deadline. A malformed or unknown payload maps to a minimal
metadata-only record, so it cannot leak secret data or wedge or skip the stream.
The cursor advances to the checkpoint only when every exportable record through
it is acknowledged, or immediately when that checkpoint contains exclusions
only.

Transient endpoint failure leaves the cursor unchanged and retries with bounded
exponential backoff plus jitter. HTTP `401`/`403` or gRPC `Unauthenticated`/`PermissionDenied` enters `auth-blocked`, makes
readiness fail, logs the transition once without header data, and probes only at
the maximum backoff until recovery. Being a separate process, the exporter is
inherently decoupled from control's request and boot paths; a slow or hostile
endpoint only makes the cursor lag, never stalls control (AC 5).

### OTLP mapping

Each event → one `LogRecord`: `Timestamp = occurred_at`, `SeverityNumber` by
event class (alerts > audit-info), `Body` a short human summary built from the
post-redaction payload (AC 3), and the **fixed allow-listed attribute set** —
`event.id`, `event.stream_type`, `event.type`, `actor.type`, `actor.id`,
`target.*` (post-redaction), `outcome`, plus the deployment identity. Nothing
outside the allow-list is emitted; the `data` blob never ships (AC 1). A
sealed `pii:v1:` value that reaches an allow-listed field ships as the opaque
ciphertext string (AC 11). The attributes are deliberately structured (never a
collapsed blob) so a downstream consumer can normalise them to OCSF or any other
schema without Power Manage re-instrumenting.

Transport is **OTLP/HTTP** (protobuf body to `/v1/logs`) by default — the most
broadly supported, proxy-friendly option; gRPC is a config toggle.

**OCSF is out of v1** (see Out of scope): by the same principle that keeps
syslog/CEF out of the product, OCSF *normalisation* is a downstream mapping
concern — a Collector processor or the SIEM's own OCSF pipeline, fed by these
clean attributes.

## Security considerations

- **Authorization**: export is an operator/deployment capability, not a
  per-user RPC — there is no user-facing authz surface and no per-owner scoping;
  the SIEM legitimately receives the whole security record. The safety boundary
  is redaction, not scoping.
- **Input validation**: endpoint URL, protocol enum, and TLS material are
  validated at boot; invalid config fails closed (AC 8). Nothing untrusted is
  ingested — the exporter only reads the local event store.
- **Secrets**: export reuses `redactEventData` so no secret material leaves in a
  `LogRecord` (AC 3); the endpoint auth header is a mode-0600 secret file,
  never logged (AC 9/12); TLS to the endpoint is required unless the explicit
  insecure toggle is set — and that toggle only accepts a loopback/unix-socket
  endpoint (AC 13).
- **PII and crypto-shred (AC 11/12/14)**: PII is protected by SEALING, not
  redaction — `redactEventData` scrubs secrets and must never be treated as
  the PII barrier. The exporter therefore ships `pii:v1:` values as opaque
  ciphertext and is structurally unable to do otherwise: no KEK, no PII
  opener linked, and a Postgres role that cannot read `user_encryption_keys`.
  Under this model the spec-19 DEK shred also erases the meaning of every
  exported copy sitting in the operator's SIEM.
- **Flagged NIS2↔GDPR tension (decision 2026-07-18)**: legacy pre-spec-19
  events carry PLAINTEXT PII that DEK destruction cannot reach. The operator
  decision is to export them AS-IS (completeness of the compliance feed wins);
  the residual exposure — plaintext PII of since-erased users living on in the
  external SIEM beyond Power Manage's erasure reach — is accepted and must be
  covered by the operator's own SIEM retention/erasure process. This cuts
  against the spec-19 crypto-shred posture and is recorded here deliberately
  rather than hidden.
- **Audit**: enabling/disabling export is a config change (deployment-level), not
  a runtime state-changing RPC, so it is captured by deployment change control
  rather than an in-app audit event. Delivery is at-least-once; the SIEM dedupes
  on `event.id` for the crash-after-ack replay window.
- **Availability**: export MUST NOT be able to stall the append path or the
  request plane (AC 5) — the separate process, attempt deadline, and bounded
  backoff ensure a hostile or slow endpoint only makes the cursor lag.

## Test requirements

### Integration tests

Real Postgres + an in-process mock OTLP logs collector (gRPC and/or HTTP server
implementing the OTLP logs service):

- happy path (AC 1): append a security event → assert the `LogRecord` arrives
  with the expected attributes within the interval.
- exclusion filter (AC 2): an excluded type (e.g. a heartbeat) is not delivered
  while a normal domain event is; an exclusions-only checkpoint advances; the
  exported set (all-minus-exclusions) is non-empty and a brand-new type defaults
  to exported.
- redaction and mapping fallback (AC 3): a secret-bearing event is delivered with
  secrets stripped; malformed/unknown payload data produces one minimal
  metadata-only record with no secret substring and is not skipped.
- at-least-once + replay (AC 4): kill/restart mid-stream → no gap; simulate a
  crash after collector acknowledgement but before cursor persistence → duplicate
  is allowed; reset cursor → replay.
- endpoint down/slow (AC 5): collector offline or hanging → attempt deadline
  fires, cursor holds, appends still succeed, retries stay within the backoff
  bounds, and the backlog drains with no loss after recovery.
- single-flight (AC 6): one worker still acquires the advisory lock; with two
  workers sharing Postgres/Valkey, only the lock holder reads/sends in each
  cycle and there is no intentional fan-out.
- visibility (AC 7): concurrent appends around the checkpoint → no skipped event.
- config fail-closed (AC 8): invalid endpoint/TLS → exporter boot fails while
  control stays available; absent endpoint → exporter inert and healthy.
- auth-blocked (AC 10): HTTP `401`/`403` or gRPC `Unauthenticated`/`PermissionDenied` holds the cursor, flips readiness unhealthy,
  logs one redacted state transition, probes only at maximum backoff, and
  recovers after endpoint authorization is restored.
- sealed PII opaque (AC 11): a user event with a sealed `pii:v1:` given_name
  reaches the mock collector with the ciphertext byte-identical to the at-rest
  value; the test environment carries no KEK and asserts no DEK row was read.
- least privilege (AC 12): connecting as `pm_otlp_export`, `SELECT` on
  `events` succeeds and `SELECT` on `user_encryption_keys` fails with a
  permission error; the exporter boots and exports without
  `CONTROL_ENCRYPTION_KEY` in its environment.
- insecure-loopback (AC 13): insecure toggle + `127.0.0.1`/unix-socket
  endpoint boots; insecure + any non-loopback host fails boot with a named
  error while control is unaffected.
- redacted derivation (AC 3): a secret planted in the payload field that feeds
  `Body`/`target.*` does not appear anywhere in the delivered record.

### Property-based or generative tests

- Over random interleavings of appends, acknowledgements, cursor writes, crashes,
  and worker ticks, every appended exportable `event.id` appears at least once,
  every delivered ID belongs to the source set, duplicates are allowed, and the
  persisted cursor is monotonic.

### Archtest

- `ExportedTypes()` = all known event types minus an explicit `exportExclusions`
  set (not a hand-maintained allow-list), with a non-empty guard and a check that
  a newly-added event type is exported unless deliberately excluded.

## Rejection paths

| Scenario | Error/state | Operator-visible message | Logged context |
|----------|-------------|--------------------------|----------------|
| Endpoint configured, URL/TLS/auth config invalid | Exporter startup failure | boot error names the invalid knob; control remains available | config field, never the secret value |
| No endpoint configured | Healthy/inert | `OTLP export disabled` | disabled state only |
| Endpoint unreachable or attempt deadline exceeded | Transient degraded retry; cursor holds | export lag/backoff metric and warning | endpoint host, attempt, bounded backoff, lag |
| Collector returns HTTP `401`/`403` or gRPC `Unauthenticated`/`PermissionDenied` | Unhealthy `auth-blocked`; cursor holds | readiness failure and one state-transition error | endpoint host and status, never header value |
| Event payload is malformed or unknown | Minimal metadata-only record; no skip | mapping-error counter/attribute | event ID and type, no raw payload |
| Insecure toggle with a non-loopback endpoint | Exporter startup failure | boot error names the toggle and the host | endpoint host, no header material |
| Auth-header secret file absent, unreadable, or too permissive (not 0600) | Exporter startup failure | boot error names the path and required mode | path and file mode, never the contents |
| Advisory lock is held by another replica | Standby for this cycle | healthy standby state | lock key and standby transition at debug level |
| Collector acknowledges but cursor persistence fails | Retry from old cursor; duplicate allowed | cursor-write error and lag | checkpoint and event count, no payload |

## Rollout and migration

- **Off by default**: absent `OTLP_EXPORT_ENDPOINT` (or simply not deploying the
  `otlp-export` container) ⇒ nothing is exported. Fully additive and
  backward-compatible; control is unchanged.
- **New service + image**: one new binary/image (`otlp-export`) in the reference
  compose alongside indexer, plus its CI/release lane. Cursor lives in Valkey —
  no schema migration, but a new initdb script adds the events-only
  `pm_otlp_export` role (AC 12) and the compose service mounts the mode-0600
  auth-header secret file.
- **New dependency**: OTel logs SDK + OTLP exporters, confined to the exporter
  binary.
- **Reference bridge (docs, not code)**: ship an example OTel Collector config in
  the deploy docs (`otlp` receiver → `syslog`/`splunk_hec` exporter) so the
  `OTLP → syslog` path is documented and supported without Power Manage carrying
  format code. The operator owns and runs the Collector.
- **Sequencing**: independent of control rollout. Every replica uses the mandatory
  advisory lock from its first release, so scaling the exporter later cannot
  silently introduce intentional fan-out.

## References

- Spec 24 (secret-read audit events), spec 26 (audit-log UX and export),
  spec 19 (audit retention — shared `sequence_num` visibility contract),
  spec 31 Part E (multi-replica single-flight).
- OpenTelemetry OTLP logs specification; OCSF (Open Cybersecurity Schema
  Framework) for attribute alignment.
- ADR: (to be written) "Export over OTLP only; format translation is a Collector
  concern, not product code."

## Audit findings (2026-07-18)

Pre-implementation security review. The design is salvageable — exporting *sealed*
PII ciphertext keeps crypto-shred effective — but as written the spec leaves the
highest-consequence path unpinned. **Two HIGH holes must close before
implementation:**

- **[High] The spec never mandates "read sealed bytes, never unseal PII."** The
  safety story rests on `redactEventData`, which scrubs *secrets*, not PII (PII is
  protected by sealing, not redaction). An implementer tailing the event store like
  the indexer would naturally reuse the projector unseal path (`pii.Opener.OpenDecoded`)
  and ship **plaintext email / name / linux_username of every user** to an external
  SIEM — permanently defeating GDPR crypto-shred. Fix: add an AC forbidding any
  `OpenPayloadPII` / `PIIOpener` / `UnwrapDEK` call on the export path (`pii:v1:`
  values shipped as opaque ciphertext) and a mandated test proving a PII-bearing
  event reaches a mock collector as ciphertext, with no DEK ever unwrapped.
- **[High] The exporter is structurally over-privileged: KEK + SELECT on the DEK
  table.** Spec lines 149/181 give it `CONTROL_ENCRYPTION_KEY` plus a `pm_readonly`
  DSN, and `pm_readonly` gets `SELECT ON ALL TABLES` including `user_encryption_keys`
  ([initdb.d/01-indexer-user.sh:32](../../../server/deploy/initdb.d/01-indexer-user.sh)).
  KEK + SELECT on the wrapped DEKs = mass PII decryption **regardless of the
  exporter's own code**. Fix: scope the exporter's DB role to `events` only (this
  also structurally guarantees the fix above); better, supply the auth header via a
  file/secret so the exporter never holds the KEK.

Also fix before implementation:
- **[Medium] Export-by-default + name-pattern redaction is fail-open on novel
  fields.** A new event type with a secret/PII field whose key doesn't match
  `matchesSecretKey` is exported unredacted. Fix: emit an allow-listed attribute set
  and do not ship the raw/redacted `data` blob; or add a redaction-completeness CI
  guard.
- **[Medium] `Body` summary and `target.*` attributes may be built from the raw (not
  redacted) payload.** Add an AC + test that every payload-derived attribute comes
  from the post-redaction payload.
- **[Medium] The plaintext-OTLP "insecure toggle" is not loopback-constrained** (spec
  line 247) — nothing prevents shipping the whole audit record in plaintext to a
  remote host. Fix: permit insecure only for a loopback / unix-socket endpoint;
  reject `insecure + non-loopback` at boot.
- **[Medium] The GDPR-erasure ↔ external-export tension is never acknowledged.** State
  the model (export ships sealed ciphertext; DEK shred erases exported copies) and
  decide the legacy-plaintext-PII case (pre-spec-19 events carry plaintext PII that
  DEK destruction cannot reach).
- **[Low] Auth-header secret handling underspecified** (env var is plaintext at the
  deploy layer; pin the `enc:v1` ciphertext-in-env contract + a dedicated crypto
  purpose/AAD) and **add the missing PII-specific test**.

Strengths to keep: no-drop-on-failure (cursor holds), backpressure isolation,
at-least-once + `event.id` dedup, advisory-lock single-flight, fail-closed boot,
non-empty exported-set archtest. SSRF does not apply (endpoint is deploy-config, no
request-path input).

### Remediation (2026-07-18)

All findings above are folded into the spec body:

- **[High] no-unseal** → AC 11 (opaque `pii:v1:` ciphertext, no
  `OpenPayloadPII`/`PIIOpener`/DEK unwrap, mandated ciphertext-at-collector
  test; the exporter binary does not link the opener).
- **[High] over-privilege** → AC 12 (dedicated `pm_otlp_export` role with
  `SELECT` on `events` only + denied-DEK-table guard test; no
  `CONTROL_ENCRYPTION_KEY`; auth header via mode-0600 secret file). This
  structurally guarantees AC 11 against exporter code bugs.
- **[Medium] fail-open novel fields** → AC 1 amended: only the fixed
  allow-listed attribute set is emitted, the `data` blob never ships.
- **[Medium] raw-payload Body/target** → AC 3 amended: all payload-derived
  values come from the post-redaction payload, with a planted-secret test.
- **[Medium] insecure toggle** → AC 13: loopback/unix-socket only, boot
  rejection otherwise.
- **[Medium] erasure model** → AC 14 + Security considerations: sealed
  ciphertext export keeps crypto-shred effective for spec-19-era events;
  **legacy plaintext-PII events are exported AS-IS per operator decision
  (2026-07-18)** with the NIS2↔GDPR tension explicitly flagged.
- **[Low] auth-header contract** → file-based secret (mode checked at boot,
  rejection row added); the KEK-decrypted env contract was removed with the
  KEK itself.
