---
title: "OTLP audit & security event export"
status: draft
created: 2026-07-14
---

# OTLP audit & security event export

## Overview

Power Manage exports its audit and security-relevant events to an external
observability/SIEM pipeline using a single open standard — **OTLP logs**. A
control-server background worker streams events from the immutable event store,
redacts secret material, maps each to an OTLP `LogRecord`, and ships them to a
configurable OTLP endpoint (gRPC or HTTP). Power Manage is only ever the
**producer**: it never stores, queries, or serves exported events, and it
speaks no legacy SIEM dialect. Translation to a specific SIEM's ingest format
(syslog/CEF, Splunk HEC, etc.) is the operator's concern, performed by an OTel
Collector they run — the canonical `OTLP → syslog` bridge is stock Collector
configuration, not code Power Manage carries.

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
   interval it is delivered as one OTLP `LogRecord` carrying at least the
   event's id, `stream_type`/`event_type`, actor (type+id), target, outcome,
   and `occurred_at` as attributes.
2. Given the export filter, every known event type is exported EXCEPT an
   explicit, small exclusion set (heartbeats/liveness and high-churn non-audit
   noise). The exported set is derived as *all known types minus exclusions*, so
   a newly-added event type is exported by DEFAULT — a new security-relevant
   event is never silently dropped (fail-toward-export for a compliance feed). A
   guard asserts the exported set is non-empty and that every excluded type is
   deliberately enumerated.
3. Given a secret-bearing event (secret-read, IdP secret, LUKS/LPS), when it is
   exported, then the `LogRecord` carries identifiers and metadata only, never
   secret material — the export reuses the `redactEventData` audit redactor, and
   an unknown-schema secret-bearing payload is redacted fail-closed.
4. Given at-least-once delivery, when the worker exports a batch, then the
   persisted cursor advances only after the endpoint acknowledges; on restart
   export resumes from the cursor with no gap, and resetting the cursor replays
   history from that point.
5. Given the OTLP endpoint is unreachable, when events are appended, then no
   event is lost (the cursor holds, the event store is the durable buffer), the
   RPC/append path is entirely unaffected (export is asynchronous and decoupled),
   and export catches up automatically when the endpoint returns.
6. Given the exporter runs as a single dedicated service instance (the default
   deployment), then no cross-replica coordination is required and each event is
   exported once. If an operator runs more than one exporter instance, they
   coordinate via a single-flight advisory lock (or leader election) so fan-out
   does not multiply deliveries; the SIEM's dedupe on `event.id` is the backstop
   either way.
7. Given concurrent in-flight appends, when the worker chooses how far to
   advance, then it never advances past a `sequence_num` that a
   not-yet-committed lower append could still occupy — no event is skipped under
   concurrency (the prune.go commit-visibility contract).
8. Given no OTLP endpoint configured, when the control server boots, then the
   exporter is inert (disabled) and nothing is shipped. Given an endpoint is
   configured but the URL/TLS/auth config is invalid, then the control server
   **fails to boot loudly** rather than starting with silently-broken export (a
   silently-disabled compliance feed is a finding, not a convenience).
9. Given the export connection, when the worker ships a batch, then it connects
   over TLS, presents any configured auth header sourced from encrypted-at-rest
   config, and no secret (auth header, event secret material) appears in server
   logs.

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
- `server/internal/crypto` — decrypt the endpoint auth-header config (the
  exporter holds `CONTROL_ENCRYPTION_KEY`, as control/indexer already do).

### Proto changes

None required for v1 — the exporter is config-driven, not request/response. (A
future read-only `GetExportStatus` RPC surfacing cursor lag is deferred.)

### Database changes

- The exporter's cursor (last-exported `sequence_num`) persists in **Valkey**
  (the exporter already connects to it, matching the indexer), keeping its
  Postgres access strictly READ-ONLY on `events` — no migration, no write role
  on the event store. (Alternative: a singleton `otlp_export_cursor` table if
  durability beyond Valkey is wanted; decide at implementation. Any identifier
  stays text/bigint — no uuid, F-15.)
- No new event types. The exporter is a read-only consumer of existing streams.

### New dependencies

- OTel logs SDK + OTLP exporter: `go.opentelemetry.io/otel/log`, `.../sdk/log`,
  and `.../exporters/otlp/otlplog/otlploghttp` (OTLP/HTTP is the default
  transport; `otlploggrpc` is an optional toggle). Justification: OTLP is the
  chosen wire standard and there is no stdlib OTLP logs encoder; hand-rolling
  protobuf/transport/batching/retry reimplements a maintained library. **The
  dependency is confined to `cmd/otlp-export` + `internal/otlpexport`** — it
  never enters the control or gateway binaries.
- Minimal-dependency alternative (decide at implementation): emit OTLP/HTTP with
  a JSON body via stdlib `net/http`, avoiding the OTel SDK at the cost of
  hand-building batching/retry. A Connect client to OTLP/gRPC is possible but
  offers no advantage over the SDK for an external sink.

### Configuration (exporter service)

The service reads a read-only Postgres DSN, Valkey (for the cursor), and
`CONTROL_ENCRYPTION_KEY` (to decrypt the auth header), plus `OTLP_EXPORT_*`.
Absent endpoint ⇒ the service is inert (or simply not deployed):

- `OTLP_EXPORT_ENDPOINT` — OTLP endpoint URL (e.g. `https://collector:4318/v1/logs`).
  Presence enables it.
- `OTLP_EXPORT_PROTOCOL` — `http` (default — OTLP/HTTP, the most broadly
  supported and proxy/firewall-friendly transport) or `grpc`.
- `OTLP_EXPORT_TLS_CA` / insecure toggle — endpoint trust.
- `OTLP_EXPORT_HEADERS` — auth header(s) (bearer/API key), encrypted at rest via
  `internal/crypto` like other config secrets.
- `OTLP_EXPORT_INTERVAL` (default e.g. 5s) and batch size.

### Service shape

A ticker loop in the `cmd/otlp-export` binary — one instance by default. Each
tick: load committed events with `sequence_num >` cursor and `<=` the visibility
checkpoint (AC 7); apply the exclusion filter; redact via `redactEventData`; map
to OTLP `LogRecord`s; export the batch; on endpoint ack, advance + persist the
cursor. Endpoint failure ⇒ no cursor advance, retry next tick with backoff.
Being a separate process, it is inherently decoupled from control's
request/append path — a slow or hostile endpoint only makes the cursor lag,
never stalls control (AC 5). A single instance needs no advisory lock (AC 6);
running more than one opts into the lock.

### OTLP mapping

Each event → one `LogRecord`: `Timestamp = occurred_at`, `SeverityNumber` by
event class (alerts > audit-info), `Body` a short human summary, and a set of
**stable, granular attributes** — `event.id`, `event.stream_type`,
`event.type`, `actor.type`, `actor.id`, `target.*`, `outcome`, plus the
deployment identity. The attributes are deliberately structured (never a
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
  `LogRecord` (AC 3); the endpoint auth header is a secret, encrypted at rest and
  never logged (AC 9); TLS to the endpoint is required unless an explicit
  insecure toggle is set for a trusted local Collector.
- **Audit**: enabling/disabling export is a config change (deployment-level), not
  a runtime state-changing RPC, so it is captured by deployment change control
  rather than an in-app audit event. Delivery is at-least-once; the SIEM dedupes
  on `event.id` as a backstop to AC 6.
- **Availability**: export MUST NOT be able to stall the append path or the
  request plane (AC 5) — the event store is the buffer, and a hostile/slow
  endpoint only makes the cursor lag.

## Test requirements

### Integration tests

Real Postgres + an in-process mock OTLP logs collector (gRPC and/or HTTP server
implementing the OTLP logs service):

- happy path (AC 1): append a security event → assert the `LogRecord` arrives
  with the expected attributes within the interval.
- exclusion filter (AC 2): an excluded type (e.g. a heartbeat) is not delivered
  while a normal domain event is; the exported set (all-minus-exclusions) is
  non-empty and a brand-new type defaults to exported.
- redaction (AC 3): a secret-bearing event is delivered with secrets stripped —
  reuse the audit-redactor fixtures; assert no secret substring in the payload.
- at-least-once + replay (AC 4): kill/restart mid-stream → no gap; reset cursor →
  replays.
- endpoint down (AC 5): collector offline → cursor holds, appends still succeed,
  bring collector up → backlog drains, no loss.
- single-flight (AC 6): two workers sharing one Postgres/Valkey → each event
  delivered once (advisory lock).
- visibility (AC 7): concurrent appends around the checkpoint → no skipped event.
- config fail-closed (AC 8): invalid endpoint/TLS → boot fails; absent endpoint →
  inert.

### Property-based or generative tests

- Over random interleavings of appends and worker ticks, the multiset of
  delivered `event.id`s equals the set of appended security-relevant ids (no
  loss, at-least-once), and the cursor is monotonic.

### Archtest

- `ExportedTypes()` = all known event types minus an explicit `exportExclusions`
  set (not a hand-maintained allow-list), with a non-empty guard and a check that
  a newly-added event type is exported unless deliberately excluded.

## Rejection paths

| Scenario | Outcome | Operator-visible signal | Logged context |
|----------|---------|------------------------|----------------|
| Endpoint configured, URL/TLS/auth invalid | Control **fails to boot** (fail closed) | boot error naming the invalid knob | config field (never the secret value) |
| No endpoint configured | Exporter inert (disabled) | info: "OTLP export disabled" | — |
| Endpoint unreachable at runtime | Retry w/ backoff; cursor holds; append path unaffected | warn: export lagging, cursor behind | endpoint host, attempt, backoff, lag |
| Auth rejected (401/403 from collector) | Retry; cursor holds | warn/error: export auth rejected | endpoint host, status (no header value) |
| Event payload un-mappable | Log at error + counter, advance past it (one bad event never wedges the stream) | error + `otlp_export_skipped` counter | event id, type (no secret material) |
| Two replicas race the tick | Advisory lock → one exports; other no-ops | — | — |

## Rollout and migration

- **Off by default**: absent `OTLP_EXPORT_ENDPOINT` (or simply not deploying the
  `otlp-export` container) ⇒ nothing is exported. Fully additive and
  backward-compatible; control is unchanged.
- **New service + image**: one new binary/image (`otlp-export`) in the reference
  compose alongside indexer, plus its CI/release lane. Cursor lives in Valkey —
  no schema migration.
- **New dependency**: OTel logs SDK + OTLP exporter, confined to the exporter
  binary (or the `net/http` OTLP-JSON alternative).
- **Reference bridge (docs, not code)**: ship an example OTel Collector config in
  the deploy docs (`otlp` receiver → `syslog`/`splunk_hec` exporter) so the
  `OTLP → syslog` path is documented and supported without Power Manage carrying
  format code. The operator owns and runs the Collector.
- **Sequencing**: independent of other in-flight work. Running as one dedicated
  instance, it needs no cross-replica coordination — simpler than an in-control
  advisory-lock worker.

## References

- Spec 24 (secret-read audit events), spec 26 (audit-log UX and export),
  spec 19 (audit retention — shared `sequence_num` visibility contract),
  spec 31 Part E (multi-replica single-flight).
- OpenTelemetry OTLP logs specification; OCSF (Open Cybersecurity Schema
  Framework) for attribute alignment.
- ADR: (to be written) "Export over OTLP only; format translation is a Collector
  concern, not product code."
