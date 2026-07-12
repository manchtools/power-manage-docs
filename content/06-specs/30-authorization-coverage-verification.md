---
title: "Complete authorization-coverage verification"
status: draft
created: 2026-07-11
---

# Complete authorization-coverage verification

## Overview

A self-discovering, **AST-driven** guard suite that proves **every** RPC handler
applies complete authorization — authentication, permission, and scope/ownership —
for **every read, write, and delete it performs on a protected resource**, and
**fails the build** the moment any path is uncovered, now or in the future. It
generalizes the spec 29 S1 remediation (object-scope on `List*`/`Dispatch*`) into
a system-wide invariant: no handler can ever silently leak or mutate a resource
past the caller's authority, and no future handler can regress that.

The suite is the single load-bearing answer to "how do we know nothing leaks?" —
it derives the answer from the code itself, not from a hand-maintained checklist.

**AST is the discovery engine, not the assertion.** Its primary job is to
*enumerate the system* — every handler, every read/write/delete path, every
protected resource — so that **behavioral** tests can be generated/driven over
the complete surface with nothing missed. The verification of correctness is the
behavioral test (drive the real handler against a real backend and observe
confinement), never "an enforcement call textually appears" — presence-not-
behavior is exactly the gap that let spec 29 S1 through a green suite. AST is used
where it is a *good fit* for discovery (Go handler bodies, call graphs, proto
descriptors); where a surface is not usefully AST-discoverable, discovery falls
back to descriptor reflection or an explicit registry, each with a matches-zero
guard so discovery can never silently cover nothing. Read every AST-discovered
path as "a behavioral test must exercise this," the same way an untested code
path is treated as a latent bug.

## Motivation

S1 existed despite strong, self-discovering scope tests, because those tests had a
structural blind spot the object read handlers fell through:

- `TestScopablePermissions_AllEnforced` guards the permission-`TargetKind` axis;
  its recognized mechanisms do not include the object-scope enforcers.
- `TestObjectScope_EnforcementMatchesIndexFiltering` guards the object axis but
  only at the **type** level — it asserts `enforceObjectReadScope("action")`
  appears *somewhere* (satisfied by `GetAction`) and that Search's index carries
  the scope tag. It models exactly two read surfaces (Get, Search). `ListActions`
  is a third read surface that returns full `ShellParams`/`FileParams` and was
  never in the model, so a **presence** check passed while a whole handler was
  unguarded.

Two lessons drive this spec:

1. **Coverage must be per-path, not per-type.** "The `action` type is enforced
   somewhere" is not "every handler that reads an action enforces it." The unit of
   verification is the **(handler, resource, operation)** triple, discovered from
   each handler's own body.
2. **Presence is not behavior.** A test that asserts a scope call *exists* can be
   satisfied by a call that does not actually confine (wrong filter, wrong
   argument, dead branch). The suite must also **drive the real handler** with a
   restricted caller and an out-of-scope resource and observe confinement.

The existing guards are good and are kept — this spec subsumes them into one
completeness model so no third, fourth, or Nth surface can hide in a seam.

## Acceptance criteria

Each follows "Given [precondition], when [action], then [observable outcome]."

1. Given the ControlService descriptor, when the permission-coverage guard runs,
   then every RPC is either in the reviewed `PublicProcedures` allow-list or bound
   to a valid, interceptor-enforced permission key; an RPC that is neither fails
   the guard, naming the RPC.
2. Given a handler whose body performs a **read or list** on a scopable resource
   (an AST-recognized read/list sink on `action`/`action_set`/`definition`/
   `compliance_policy`/`device`/`user`/`device_group`/`user_group`/`execution`),
   when the coverage guard runs, then the handler must also invoke a recognized
   **read-scope** mechanism for that resource; a handler that does not fails,
   naming the handler and the file:line of the unguarded sink.
3. Given a handler whose body performs a **write or delete** on a scopable
   resource, when the coverage guard runs, then it must invoke a recognized
   **write-scope** mechanism; a handler that does not fails, naming it.
4. Given a handler operating on a **self-owned** resource (a `:self`/`:assigned`
   permission variant), when the coverage guard runs, then it must invoke
   `auth.EnforceSelfScope`/the `:self` gate; a handler that does not fails.
5. Given the behavioral sweep, when it drives every scopable-resource read / list /
   dispatch / write RPC through the **real handler** with a scope-restricted caller
   and a seeded **out-of-scope** resource, then the resource is confined (list omits
   it / read → NotFound / dispatch → NotFound / write → PermissionDenied); a handler
   that returns or mutates it fails.
6. Given a **new** authorization mechanism (a new `Enforce*`/scope function), when it
   is used without being registered in the recognized-mechanism set, then the guard
   fails closed — the permissions it "enforces" surface as unenforced — never
   silently accepted.
7. Given every discovery step (handlers, sinks, mechanisms, exemptions), when the
   guards run, then each carries a **matches-zero** assertion (≥1 discovered) so a
   broken scanner cannot vacuously pass, and a **no-orphan** assertion (every
   exemption / registry entry names a live handler / resource) so a rename cannot
   leave a stale hole.
8. Given the InternalService (gateway↔control) descriptor, when the cross-service
   guard runs, then every credential-bearing method invokes the device-origin
   binding check; a method that does not fails.
9. Given a **new ControlService RPC** added in any future change, when CI runs, then
   it is automatically classified by the AST scan and MUST resolve to full coverage
   (public-justified, or permission+scope enforced, or an explicitly justified
   exemption) — it cannot merge unclassified.
10. Given the full suite, when the verification gate runs, then vet, static
    analysis, the complete test suite, and docref all pass.

## Out of scope

- Changing the runtime authorization mechanism itself (interceptor, RBAC, scope
  model). This spec **verifies** enforcement; it does not redesign it. Any real gap
  the suite discovers is fixed under its own finding (e.g. spec 29 S1).
- Business-rule / field-level validation beyond authorization (covered by the
  `@gotags validate` boundary and `TestEveryControlRPCRunsValidateBeforeWork`).
- Non-RPC internal helpers with no externally reachable entry point.
- Proving the *absence* of logic bugs inside a correctly-guarded handler (that is
  the per-handler test's job); this suite proves the guard is *present and
  behaviorally confining* on every path.

## Technical design

### Affected packages

- `server/internal/archtest` (or `internal/api` test files) — the AST-driven
  coverage guards and the runtime behavioral sweep. No production code changes are
  required by this spec itself; production fixes it uncovers are separate findings.
- `server/internal/auth` — the recognized-mechanism registry and the permission
  metadata (`AllPermissions`, `TargetKind`, `PublicProcedures`) are the sources of
  truth the guards read; no behavior change.

### Discovery model — the (handler, resource, operation) triple

The suite reuses the AST helpers already in the codebase (`calleeName`,
`stringLit`, `exprMentions` in `scope_enforcement_parity_test.go`) and the
descriptor-reflection sweep in `control_boundary_sweep_test.go`.

**1. Handler enumeration.** Every RPC is discovered two ways and reconciled:
- the service descriptor (runtime reflection over the connect client interface) —
  the authoritative RPC set; and
- the AST of the handler method declarations in `internal/api` — the bodies to
  scan. A reconcile step asserts the two sets agree (a descriptor RPC with no
  discoverable handler, or vice-versa, fails).

**2. Data-operation classification (AST sink registry).** For each handler body,
the scan collects calls to a **recognized data-sink registry** that maps a
store/repo/query method to `(resource, operation ∈ {read, write, delete})`:
- reads: `Repos().<R>.Get/List/…`, `Queries().List<R>…`, `Load*`;
- writes/deletes: `AppendEvent`/`AppendEvents`/`AppendEventWithVersion` (classified
  by the event-type literal → resource + create/update/delete), `Create*/Update*/
  Delete*` repo methods.
The registry is explicit and **self-guarding**: a store/repo method not in the
registry that is nonetheless called from a handler surfaces as "unclassified sink"
and fails, forcing a human to classify each new data path (read/write/delete on
what resource) — this is the AST enumeration of "each read/write/delete path" the
suite is built around.

**3. Authorization classification (AST mechanism registry).** For each handler
body, the scan collects the authorization mechanisms it invokes:
- permission gate — implicit per procedure via the interceptor's default
  `Authorize` unless the procedure is in `PublicProcedures`;
- scope/ownership — recognized `Enforce*` / list-filter / object-scope functions
  (`EnforceDeviceScope*`, `EnforceUserScope*`, `EnforceUserScopeOrSelf`,
  `EnforceDeviceGroupScope`, `EnforceUserGroupScope`, `DeviceScopeListFilter`,
  `UserScopeListFilter`, `enforceObjectReadScope`, `enforceObjectWriteScope`,
  `enforceDeviceScopeAll`, `EnforceSelfScope`), each tagged read / write / list /
  self. An unrecognized `Enforce*`-shaped call fails closed (AC 6).

### Coverage matrix — the completeness assertion

For every discovered `(handler, resource, operation)` the required mechanism is:

| Operation on a scopable resource | Required mechanism |
|---|---|
| read / list | a read-scope mechanism for that resource (read gate / list filter / object-read-scope) |
| write / delete | a write-scope mechanism (write gate / object-write-scope) |
| any, on a self-owned resource | `EnforceSelfScope` / the `:self` gate |
| any, on a non-public RPC | the permission gate (verify not accidentally public) |

The guard asserts each triple's required mechanism is present **in that handler**.
A miss fails with the handler name, the resource, the operation, and the file:line
of the unguarded sink. Exemptions live in a single reviewed allow-list; each entry
records a reason and is checked against the live handler/descriptor set (no-orphan,
AC 7) — e.g. `GetCurrentUser` (self by construction), `ListPermissions` (static
catalog), org-tier create RPCs (no id/members to scope at create time).

### Behavioral backstop (presence ≠ behavior)

AST presence is necessary but not sufficient. A companion **runtime sweep** — same
shape as `TestEveryControlRPCRunsValidateBeforeWork` — drives every
scopable-resource read / list / dispatch / write RPC through the real handler with:
- a scope-restricted caller (a group-scoped grant), and
- a seeded **out-of-scope** resource (assigned to a group the caller is not in),

and asserts confinement (invisible in a list / `NotFound` on a read or dispatch /
`PermissionDenied` on a write). A per-resource driver table declares how to seed and
invoke each RPC; a completeness self-check asserts every scopable-resource RPC in
the descriptor is present in the table (matches-zero + no-orphan), so a new object
RPC fails until it is both enforced and behaviorally covered. This is the check that
would have caught S1.

### Cross-service coverage

The same discovery model applies to the other trust boundaries, each with its own
required mechanism:
- **InternalService** (gateway→control) — every credential-bearing method must
  invoke the device-origin binding check (`registry.CheckDeviceGatewayBinding`);
  the guard enumerates the descriptor and asserts it (AC 8).
- **DeviceAuthService** (enrollment) — the registration-token consume path.
- **AgentService** (mTLS) — the peer-class gate.
Each is a small descriptor sweep + recognized-guard registry; out of the initial
batch if effort-bounded, but the design is uniform.

### Proto / database changes

None. This is verification infrastructure.

### New dependencies

None — Go's `go/ast`/`go/parser` (already used by the existing parity guards) and
`reflect` over the connect descriptors (already used by the boundary sweep).

## Security considerations

- **Fail-closed discovery.** Every unknown — an unclassified data sink, an
  unrecognized enforcement mechanism, a descriptor RPC with no handler — fails the
  build, never passes silently. The suite cannot be satisfied by ignorance.
- **No hand-maintained allow-of-everything.** Exemptions are per-RPC, justified,
  and guarded against rot. The default for any new path is "must be covered."
- **Behavioral truth over code presence.** The runtime sweep observes real
  confinement, closing the exact `presence ≠ behavior` gap that produced S1.
- **The suite is itself guarded.** Matches-zero assertions on every discovery step
  prevent a broken scanner from vacuously green-lighting the codebase.

## Test requirements

- **Permission-coverage guard** — descriptor sweep: every RPC public-justified or
  permission-enforced; `PublicProcedures` entries are live RPCs. Red-checked by
  temporarily adding an unguarded RPC / an unjustified public entry.
- **AST coverage guard** — the (handler, resource, operation) → mechanism matrix,
  with a matches-zero guard and an "unclassified sink fails" guard. Red-checked by
  removing a known enforcement call (e.g. `GetAction`'s `enforceObjectReadScope`)
  and asserting the guard names it; and by adding an unclassified repo call.
- **Behavioral sweep** — drives every scopable-resource read/list/dispatch/write
  RPC with a restricted caller + out-of-scope resource; asserts confinement;
  completeness self-check over the descriptor. Red-checked against the pre-spec-29
  `ListActions` (must fail) and green after the fix.
- **Cross-service guard** — InternalService device-origin-binding completeness.
- Every guard names offenders with file:line and a remediation hint, matching the
  existing parity guards' failure ergonomics.

## References

- Spec 29 S1 — object-scope on `List*`/`Dispatch*`; the concrete leak this suite
  generalizes.
- `internal/api/scope_enforcement_parity_test.go` — `TestScopablePermissions_AllEnforced`
  (AST mechanism discovery; the `recognizedScopeFns` pattern reused here).
- `internal/api/object_scope_parity_test.go` — `TestObjectScope_EnforcementMatchesIndexFiltering`
  (type-level object guard this spec makes per-handler and behavioral).
- `internal/api/control_boundary_sweep_test.go` — `TestEveryControlRPCRunsValidateBeforeWork`
  (descriptor reflection sweep reused for the behavioral + permission guards).
- `internal/auth/permissions.go` — `AllPermissions`/`TargetKind`; `internal/auth/interceptor.go`
  — default `Authorize` + `PublicProcedures`.
- ADR 0024 — scoped object visibility; ADR 0006 — device/user scope.
