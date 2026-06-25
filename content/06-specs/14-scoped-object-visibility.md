---
title: "Scoped object visibility (assignment-keyed RBAC scope for actions, sets, definitions, policies)"
status: draft
created: 2026-06-25
---

# Scoped object visibility

## Overview

Extend the existing device-group / user-group RBAC scope (issue #7, V1) to the
four shared object types — **actions, action-sets, definitions, and compliance
policies** — which today are visible org-wide to every operator regardless of
scope. After this change a scope-restricted admin sees and manages only the
objects **assigned within their scope**, on the same principle already enforced
for devices and users: *a scoped admin only has access to their own devices,
their own users, and the objects that run on them.*

## Motivation

Scope enforcement (#7 / ADR 0006) already confines a scoped admin to their
device/user groups for ~61 permissions — devices, users, groups, dispatch,
terminal, lists. But every action/set/definition/compliance-policy permission is
`TargetUnspecified` (not scopable), so a device-group-scoped operator can `List`
and `Get` the **entire org catalog**: every action's `ShellParams` script and
`FileParams` contents, every LUKS operation, every definition, and every
compliance policy (the org's complete security posture). That is information
disclosure past the operator's scope — a V1 security gap, not a V2 nicety. This
spec closes it. Promotes the "group-keyed first-class scope match" item from #7's
V2 list to V1.

## Definitions

- **Caller scope** — the set of device-groups + user-groups the caller's grants
  are scoped to for the permission in question. A caller holding an *unscoped*
  base grant is **unrestricted** (sees/does everything, as today).
- **Direct scope groups of object O** — the groups derived from O's **own**
  assignments (`Assignment.source_id == O`): `DEVICE_GROUP` / `USER_GROUP`
  targets directly, plus the groups of any `DEVICE` / `USER` target resolved
  through membership.
- **Effective scope groups of object O** — `direct(O)` **plus**, for read only,
  the direct scope groups of any *container* that includes O and is itself
  assigned: for an action, every set and definition that contains it; for a set,
  every definition that contains it. (An action that runs on group X's devices
  because a definition assigned to X contains it is *visible* to X.)

Read uses **effective** scope groups; write uses **direct** scope groups.

## Acceptance criteria

1. Given a scope-restricted caller and a `Search` on the `ACTIONS`,
   `ACTION_SETS`, `DEFINITIONS`, or `COMPLIANCE_POLICIES` scope, when it runs,
   then only objects whose **effective** scope groups intersect the caller's
   scope groups are returned — and the total count reflects the same filter (no
   out-of-scope count leak).
2. Given an **unrestricted** caller, when they `Search`/`List` any of the four
   scopes, then they see every object (no regression).
3. Given a scope-restricted caller and an object with **no** effective scope
   groups (unassigned), when they `Search`/`Get` it, then it is **not** returned
   / returns `NotFound` (fail-closed — unassigned objects are managed only by
   unrestricted admins).
4. Given a definition assigned to group X and a caller scoped to X, when they
   `Search`/`Get` the definition's member sets and those sets' actions, then they
   are **visible** even though only the definition is directly assigned
   (transitive read).
5. Given a scope-restricted caller and `GetAction` / `GetActionSet` /
   `GetDefinition` / `GetCompliancePolicy` for an object outside their effective
   scope, when it runs, then it returns `NotFound` (never `PermissionDenied` — no
   existence leak), consistent with the device handlers.
6. Given a scope-restricted caller and a **mutating** RPC (`Rename*`, `Update*`,
   `Delete*`, `Add*ToSet`/`Remove*`, `AddActionSetToDefinition`/`Remove*`,
   `Add/Remove/UpdateCompliancePolicyRule`, `Reorder*`) on an object whose
   **direct** scope groups do not intersect their scope, when it runs, then it
   returns `PermissionDenied` — including the case where the object is only
   *transitively* in scope (e.g. an action visible because its set is assigned to
   the caller is **not** editable by the caller).
7. Given a scope-restricted caller and a mutating RPC on an object **directly**
   in their scope, when it runs, then it succeeds.
8. Given an object assigned to a `DEVICE` (or `USER`) that is a member of the
   caller's scope group, when the caller `Search`/`Get`s it, then it is in scope
   (device/user → group membership is resolved).
9. Given the four scope indexes, when read, then each carries
   `assigned_group_ids` (multi-value TAG) equal to the object's **effective**
   scope group ids; assigning/unassigning the object (or any container), and
   adding/removing the target device/user from a group, updates the TAG.
10. Given a scope-restricted caller, when the `Search` handler builds the query
    for the four scopes, then it appends `@assigned_group_ids:{<caller scope group
    ids>}`; an unrestricted caller adds no such clause.
11. Given the index schema-version constant is bumped, when the indexer boots,
    then `Index.Rebuild` repopulates `assigned_group_ids` over existing data.
12. Given the four object Search scopes, a self-discovering parity test fails the
    build if any of them lacks the scope filter wiring (matches-zero guard),
    mirroring `scope_enforcement_parity_test.go`.

## Out of scope

- **`:assigned`-tier composition** with a device-group-scoped base grant (#7's
  remaining V2 item — an edge combination, narrowing-only, not a leak).
- New `:assigned` tiers for object types (objects are scoped by group assignment,
  not per-user ownership).
- Changing the device/user scope enforcement, which already ships (#7 V1).
- A "shared object is read-only / exclusive-ownership" write model — rejected in
  design: because an admin can only assign to groups they administer, the
  visible/manageable set is self-bounded and peer-group sharing is acceptable.
- Web UI changes beyond what already renders filtered `Search` results (the list
  pages already consume `Search`; they need no change).

## Technical design

### Affected packages

- `server/internal/search/index.go` — add `assigned_group_ids` TAG to
  `idx:actions`, `idx:action_sets`, `idx:definitions`, `idx:compliance_policies`;
  bump the schema-version constant.
- `server/internal/search` (indexer/projection) — populate `assigned_group_ids`
  (effective scope groups) per object; recompute on `Assignment*`, device/user
  group-membership, and set/definition-membership events.
- `server/internal/api/search_handler.go` — for the four scopes, when the caller
  is scope-restricted, append `@assigned_group_ids:{…}`.
- `server/internal/auth` — an `ObjectScopeListFilter(ctx, permission)` helper
  returning `(scopeGroupIDs, restricted)` (the union of the caller's device- and
  user-group scope ids), analogous to `DeviceScopeListFilter`.
- `server/internal/api/{action,action_set,definition,compliance_policy}_handler.go`
  — `Get*` enforces effective-scope membership → `NotFound`; mutating handlers
  enforce **direct**-scope membership → `PermissionDenied`.
- `server/internal/store` — query exposing an object's **direct** and
  **effective** scope groups (for the write check and the projection).

### Proto changes

None. Scope is derived server-side from the caller's grants; `SearchRequest`
already carries the scope. No request field is added (a client cannot widen its
own scope).

### Database changes

- An object→scope-groups projection (or extension of the assignment projection)
  maintaining **direct** and **effective** scope group sets per object id,
  rebuilt from `Assignment*` + group-membership + set/definition-membership
  events. The indexer reads it to populate `assigned_group_ids`; the mutation
  handlers read the **direct** set.
- No new event types — derived entirely from existing assignment/membership
  events. Migration adds the projection table + its trigger/backfill.

### New dependencies

None.

## Security considerations

- **Authorization.** Extends fail-closed scope confinement to the four object
  types. Default (unassigned / no effective groups) → invisible to scoped
  callers. Read uses effective groups; **write uses direct groups** so transitive
  visibility never grants mutation (editing a set never implies editing its
  actions).
- **No existence leak.** Out-of-scope `Get*` returns `NotFound`, not
  `PermissionDenied` — same contract as the device/user handlers.
- **No self-widening.** Scope comes from the caller's grants, never from the
  request; a client cannot request a wider `assigned_group_ids`.
- **Count honesty.** The scoped filter drives the search total so pagination
  never reveals the out-of-scope object count.
- **Secrets.** None handled. (The point of the feature is to stop scoped admins
  reading object payloads — scripts, file contents — that are outside their
  scope.)
- **Audit.** Read paths are not audited (unchanged); the mutating RPCs are
  already audit-logged.

## Test requirements

### Handler tests (real Postgres + real handler)

- `Get{Action,ActionSet,Definition,CompliancePolicy}`: in-scope → returned;
  out-of-scope → `NotFound`; unassigned → `NotFound` for scoped, returned for
  unrestricted.
- `Search` (each of the four scopes): scoped caller → only effective-in-scope
  objects + honest total; unrestricted → all.
- Transitive read: definition assigned to X; scoped-X caller sees its member sets
  and their actions via `Search`/`Get`.
- Mutating RPCs (the full set in criterion 6): directly-in-scope → success;
  out-of-scope → `PermissionDenied`; **transitive-only** (action visible via an
  assigned set, not directly assigned) → `PermissionDenied`.
- Device/user membership: object assigned to a device in X → in scope of scoped-X
  caller.

### Integration tests (testcontainer Postgres + valkey-search)

- End-to-end: assign objects across two device groups with two scoped admins;
  assert each admin's `Search` returns only their set and neither sees the
  other's; assert `assigned_group_ids` is populated and updates when an
  assignment or a group membership changes.
- Rebuild: bump schema version, boot indexer, assert `assigned_group_ids`
  backfills.

### Self-discovering / parity

- A test that enumerates the four object Search scopes and fails if any lacks the
  scope-filter wiring (matches-zero guard).

## Rejection paths

| Scenario | Error code | Client-visible message | Logged context |
|----------|-----------|------------------------|----------------|
| Scoped caller `Get*` an object outside effective scope | `NotFound` | "<object> not found" | caller id, object id, scope group ids |
| Scoped caller `Get*` an unassigned object | `NotFound` | "<object> not found" | caller id, object id |
| Scoped caller `Search` (out-of-scope objects) | — (no error) | absent from results; total excludes them | scope group ids applied |
| Scoped caller mutates an out-of-scope object | `PermissionDenied` | "permission denied" | caller id, object id, direct scope ids |
| Scoped caller mutates a transitive-only object (visible, not directly assigned) | `PermissionDenied` | "permission denied" | caller id, object id |
| Caller with only wrong-kind scope (e.g. user-group scope, device-only object) | `NotFound` (read) / `PermissionDenied` (write) | as above | caller id, object id |

## Rollout and migration

- Migration adds the object→scope-groups projection + backfill; the search
  schema-version bump triggers an index rebuild on indexer boot (criterion 11).
- Backward-compatible: unrestricted admins are unaffected; only callers that
  already hold *scoped* grants gain the additional confinement. No feature flag —
  it's a security fix and should apply on upgrade.
- No web change required; the list pages already render whatever `Search`
  returns.

## References

- [server#7 — Scoped Access (device-group RBAC)](https://github.com/manchtools/power-manage-server/issues/7) — V1 device/user scope; this promotes its object-visibility item to V1.
- ADR 0006 — scope enforcement, handler-level, uniform (`server/docs/adr/0006-scope-enforcement-handler-level-uniform.md`).
- [Spec 13 — List-page sort & filter via valkey-search](./13-search-sort-filter.md) — the `Search` index/handler this builds on.
