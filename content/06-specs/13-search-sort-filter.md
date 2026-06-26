---
title: "List-page sort & filter via valkey-search"
status: draft
created: 2026-06-23
---

# List-page sort & filter via valkey-search

## Overview

Wire up the web UI's ~43 disabled list-page sort buttons and empty-relation /
status filter chips (all tooltipped `Coming in 2026.06`) by extending the scoped
`Search` RPC — which every UI list page already calls since #84 Phase 0.5 — with
a sort field + direction, adding the missing sortable/filterable fields to the
per-scope valkey-search index schemas, and replacing the handler's hardcoded
default `SORTBY` with a validated, request-driven sort. Implements
[server#325](https://github.com/manchtools/power-manage-server/issues/325).

## Motivation

The data and search backbone now exist: #319 cut over to valkey + valkey-search,
#84 Phase 0.5 routed every UI list page through `Search`. valkey-search is a hard
dependency for list pages by design — heavy search lives in valkey, not the DB
layer. The only thing missing is additive params on `SearchRequest` plus a few
index-schema fields.

## Acceptance criteria

1. Given a `Search` with `sort_field`+`sort_direction` valid for the scope, when
   it runs, then results are ordered by that field/direction (deterministic for a
   known seed).
2. Given a `Search` that omits sort params, when it runs, then it uses the
   existing per-scope default sort (no regression).
3. Given a `sort_field` not sortable on the requested scope, when it runs, then it
   returns `InvalidArgument`.
4. Given the Devices scope with a status filter, when it runs, then online/offline
   is computed at query time as a `last_seen_at` range against a 5-minute window
   (`@last_seen_at:[(now-300) +inf]` online / `[-inf (now-300)]` offline) — the
   same window Postgres `ListOffline` uses. No stored `status` field.
5. Given an action with ≥1 live assignment, when `idx:actions` is read, then its
   `assigned` TAG is `true`; `AssignmentDeleted` of the last one flips it `false`.
6. Given a compliance policy, when `idx:compliance_policies` is read, then
   `rule_count` (NUMERIC, SORTABLE) equals its rule count; `@rule_count:[0 0]`
   returns empty-rule policies.
7. Given action-sets/definitions, when filtered `@member_count:[0 0]`, then only
   empty ones return (existing `member_count`, no new field).
8. Given the added fields, then: Devices filter by `os_name` (TAG); Users filter
   by `role` (TAG); Users sort by `last_login_at` (NUMERIC SORTABLE).
9. Given the schema-version constant is bumped, when the indexer boots, then
   `Index.Rebuild` drop+rebuilds so new TAG/NUMERIC fields populate over existing
   data.
10. Given each wired web list page, when a sort button or filter chip is clicked,
    then the request carries the params and the visible row set changes
    (Playwright per page). No `title="Coming in 2026.06"` marker remains unless it
    names a real later milestone.

## Out of scope

- Multi-column sort (one field at a time).
- Saved views / sticky filter beyond existing URL serialisation.
- Full-text search folded into the widget (search box unchanged).
- New RPCs or changes to `List*` (stay direct-to-Postgres, default order).
- **Postgres fallback for list pages.** valkey-search is a hard dependency; if
  it's down, `Search` fails as it does today. Removing the DB-layer search path
  is the point.
- Cross-entity joins (empty-relation is a denormalised count, not a join).

## Technical design

Three PRs.

### Affected packages

- `sdk/proto/pm/v1/control.proto` — `SearchRequest` gains `sort_field` +
  `sort_direction`; enums `SortField`, `SortDirection`.
- `server/internal/search/index.go` — see field deltas below; bump schema version.
- `server/internal/search/worker.go` — index-doc builders write the new fields.
- `server/internal/api/search_handler.go` — `scopeSortableFields` + `resolveSort`;
  extend `scopeFilterFields`; the Devices `status` filter chip translates to a
  `last_seen_at` range (special-case, not a TAG).
- `web/src/routes/(app)/*/+page.svelte` (10 pages) — wire buttons/chips.

### Proto changes

After `tag_filters = 6`:

```proto
// @gotags: validate:"omitempty,gte=0,lte=<max>"
SortField sort_field = 7;
// @gotags: validate:"omitempty,gte=0,lte=2"
SortDirection sort_direction = 8;
```

`SortField`: shared enum, union of sortable columns (`NAME`, `TYPE`, `HOSTNAME`,
`COMPLIANCE_STATUS`, `EMAIL`, `DISPLAY_NAME`, `DISABLED`, `MEMBER_COUNT`,
`STATUS`, `ACTION_TYPE`, `DEVICE_HOSTNAME`, `ACTOR_TYPE`, `STREAM_TYPE`,
`EVENT_TYPE`, `RULE_COUNT`, `LAST_LOGIN_AT`, `CREATED_AT`, `UPDATED_AT`,
`LAST_SEEN_AT`, `REGISTERED_AT`, `OCCURRED_AT`), `UNSPECIFIED = 0` = scope
default. `SortDirection`: `UNSPECIFIED=0` / `ASC=1` / `DESC=2`. Proto does not
type-check per-scope validity — `resolveSort` does (same shape as
`validateFiltersForScopes`).

### Index schema deltas (`index.go`)

- **Promote to SORTABLE** (data already indexed): `name` (actions, action_sets,
  definitions, device_groups, user_groups, compliance_policies), `member_count`
  (action_sets, definitions, device_groups, user_groups), `hostname` (devices),
  `compliance_status` (devices), `email`+`display_name` (users), `status`+
  `action_type`+`device_hostname` (executions), `actor_type`+`stream_type`+
  `event_type` (audit), `created_at` (compliance_policies).
- **New event-derived** (indexer computes from events it already sees):
  `idx:actions.assigned` TAG; `idx:compliance_policies.rule_count` NUMERIC
  SORTABLE (count rules at index time — the doc builder already reads them for
  `action_names`).
- **New, data already in projections** (just write the existing value): Devices
  `os_name` TAG (already written as TEXT — add TAG); Users `role` TAG; Users
  `last_login_at` NUMERIC SORTABLE.
- No new field for Devices status (query-time `last_seen_at` range, AC4).

### Database changes

None. All changes in the valkey-search layer. Schema-version bump triggers the
existing `Index.Rebuild` drop+rebuild.

### New dependencies

None.

## Security considerations

- **Authorization**: unchanged. `Search` already enforces scope + owner/group
  scoping; sort/filter never widen the result set. Validation is server-side.
- **Input validation**: `sort_field`/`sort_direction` validated at the proto
  boundary AND in `resolveSort`; an invalid field → `InvalidArgument`, never
  concatenated into the query string. The `status`→`last_seen_at`-range
  translation uses a server-computed bound, not client input.
- **Secrets**: none.
- **Audit**: `Search` is a read; no new state change, no new audit events.

## Test requirements

### Handler tests (`search_handler_test.go`)

- Per scope: seed, request each sortable field × {ASC,DESC}, assert order (AC1).
- Omitted sort → scope default, unchanged (AC2).
- Non-sortable field on scope → `InvalidArgument` (AC3).
- Devices status filter → correct `last_seen_at` range bound (AC4).
- Self-discovering parity test: `scopeSortableFields` / `scopeFilterFields` ↔
  index schema, matches-zero guard (mirrors the existing filter parity test) so a
  new field can't be added to one without the other.

### Integration tests (`internal/search`, valkey-search testcontainer)

- `assigned` flips on assign / last-unassign (AC5).
- `rule_count` + `@rule_count:[0 0]` (AC6); `@member_count:[0 0]` (AC7).
- `os_name`/`role` filters, `last_login_at` sort (AC8).
- Schema-version bump → rebuild repopulates new fields (AC9).

### Web (Playwright, per page)

- Click sort → assert payload + order; click filter chip → assert `tag_filters`
  (or status range) + visible set (AC10).

## Rejection paths

| Scenario | Error code | Logged context |
|----------|-----------|----------------|
| `sort_field` not sortable on scope | `InvalidArgument` | scope, field |
| `sort_direction` out of enum range | `InvalidArgument` | field, value |
| `tag_filters` field not filterable on scope | `InvalidArgument` | scope, field |

## Rollout and migration

- **PR 1** — proto enums + `SearchRequest` fields; `index.go` schema deltas;
  indexer doc-builder writes new fields; `scopeFilterFields`/`scopeSortableFields`
  + `resolveSort`; schema-version bump; regen Go+TS; new SDK release the server
  pins.
- **PR 2** — handler routes `SORTBY` through `resolveSort` + status-range
  translation; tests; one-line doc note that results lag the index by one
  reconcile cycle.
- **PR 3** — web wires buttons/chips per page; Playwright.
- Backward-compatible: new proto fields optional; old clients get today's
  behaviour. Schema-version bump rebuild is the only migration. Ships in 2026.07.

## References

- [server#325](https://github.com/manchtools/power-manage-server/issues/325) — tracker
- #319 valkey-search cutover; #84 Phase 0.5 (UI → scoped `Search`)
