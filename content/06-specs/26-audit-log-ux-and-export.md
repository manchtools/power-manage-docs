---
title: "Audit-log UX and export"
status: implemented
created: 2026-07-04
updated: 2026-07-10
---

# Audit-log UX and export

## Overview

The audit-log view is bare-bones and low-signal. This spec makes it useful:
richer columns (actor / target / action / outcome / time), the filters
`ListAuditEvents` already supports (actor, stream type, event type) surfaced in
the UI, meaningful rendering of the audit events added in #496 (osquery/log
reads, LUKS-token grants, session lifecycle) and #494 (secret views), and a
**server-side export** (CSV/JSON) for DSAR / external review that respects the
read-boundary redaction. Closes server#501.

## Motivation

An MDM/RMM audit log is a compliance deliverable (NIS2/SOC 2) and an incident
tool — but only if it is legible and exportable. The plumbing exists
(`ListAuditEvents` with actor/stream/event filters + read-side redaction); the
gap is presentation and a safe export path. This also gives the #496/#494 audit
events a place to be seen.

## Acceptance criteria

1. Given the audit-log view, when it renders an event, then it shows actor,
   target (device/user/object), action/event type, outcome, and timestamp in
   legible columns (not a raw JSON blob).
2. Given the existing `ListAuditEvents` filters, when the operator filters by
   actor, stream type, or event type, then the UI issues the corresponding
   filtered query (no client-side-only filtering that fetches everything).
3. Given the #496/#494 event types, when they appear, then each renders with a
   human-readable summary (who did/viewed what on which device), never leaking a
   redacted field.
4. Given an export request with the current filters, when it runs, then the
   server streams the matching events as CSV or JSON, applying the **same
   read-side redaction** as `ListAuditEvents` (no secret material in the export),
   and the export is permission-gated identically to the list.
5. Given a large result set, when exported, then the export streams (does not
   buffer the whole set in memory) and is bounded/paginated server-side.

## Out of scope

- New audit *event types* (those are #496/#494, separate specs).
- Retention/archival of audit events (spec 19).
- SIEM egress (separate).
- The web UI implementation detail (web ships direct-to-main; this spec pins the
  server export contract + the UX requirements, not the Svelte).

## Technical design

### Affected packages

- `sdk/proto/pm/v1/control.proto` — an export RPC (or a streaming variant of the
  list) taking the same filter message as `ListAuditEvents`, plus a format
  (CSV/JSON); `@gotags`-validated.
- `server/internal/api` — export handler: reuse the `ListAuditEvents` query +
  redaction, stream the formatted rows; same permission + scope gate.
- `web` — audit-log page: columns, filter controls bound to the proto filters,
  per-event-type renderers, an export button (direct-to-main).

### Database changes

None (reads the existing `events`/audit projection).

### New dependencies

None (CSV via stdlib `encoding/csv`, JSON via stdlib).

## Security considerations

- **Redaction reused, not reimplemented** — the export path calls the same
  read-side redaction as `ListAuditEvents`; a test asserts no redacted field
  appears in an export.
- **Same authz** as listing (permission + scope); the export cannot widen access.
- **No secret material** in any rendered column or exported row.

## Test requirements

- Handler: export respects filters; redaction applied (assert a known-redacted
  field is absent from the export); permission/scope enforced; streaming for large
  sets.
- Rendering (web, per web test conventions): each #496/#494 event type renders a
  summary; no redacted field shown.

## Rejection paths

| Scenario | Error code | Client message | Logged context |
|---|---|---|---|
| Export unauthenticated / wrong role | Unauthenticated / PermissionDenied→NotFound per scope | (as list) | actor, filter |
| Unsupported export format | InvalidArgument | "unsupported export format" | requested format |

## Rollout and migration

- Additive: export RPC + UI. No migration.

## Audit findings

- **F-08 / F-09 (coordinate, not owned here)** — README / spec 10 event-catalog
  drift. The audit UX benefits from an accurate, up-to-date event catalog (the
  documentation truth-pass), but does not depend on it. Named so the two aren't
  conflated; the doc pass is separate.

## References

- server#501; #496 (write-side audit events), #494 (secret-view events);
  the existing `ListAuditEvents` filters + read-side redaction.
