---
title: "Device-group-scoped LUKS/LPS credential access"
status: draft
created: 2026-07-12
---

# Device-group-scoped LUKS/LPS credential access

## Overview

The four user-facing LUKS/LPS RPCs on `ControlService` are currently org-tier
(`TargetUnspecified` in `auth.AllPermissions`): a holder of the permission can
read or manage recovery credentials for **any** device, with no device-group
confinement. This spec makes them **device-group-scopable** (`TargetDevice`), so
a scope-restricted admin can only access LUKS keys / LPS passwords for devices in
their scope, exactly like `GetDevice` / `DeleteDevice`. It is a server-only
change: the RPCs already exist in proto, so only the permission classification
and the handler enforcement change.

The four RPCs:

- `GetDeviceLpsPasswords` (read)
- `GetDeviceLuksKeys` (read)
- `CreateLuksToken` (write)
- `RevokeLuksDeviceKey` (write)

## Motivation

The spec 30 sink audit surfaced these handlers reading `Device` with no device
scope. They were confirmed org-tier by design (the maintainer chose to defer
scoping), but LUKS recovery keys and LPS passwords are among the most sensitive
data in the system: a device-group-scoped admin who is granted one of these
permissions can today retrieve the recovery key for a device in a group they do
not manage. Scoping them closes that, and brings LUKS/LPS in line with every
other device-targeted RPC, which is already `TargetDevice`. "Making it scopeable
is easy" (maintainer) because the device-scope machinery
(`EnforceDeviceScopeOnBaseTier`) already exists and every device handler uses it.

Related: spec 30 (audit that surfaced this), spec 24 (secret-read audit events,
unchanged here), spec 25 (LUKS sealed transport).

## Acceptance criteria

Numbered, testable.

1. Given `auth.AllPermissions`, then `GetDeviceLpsPasswords`, `GetDeviceLuksKeys`,
   `CreateLuksToken`, and `RevokeLuksDeviceKey` are classified `TargetDevice`
   (was `TargetUnspecified`).
2. Given a device-group-scoped caller holding one of these permissions and a
   device identifier outside the caller's scope groups, when the caller invokes
   the RPC, then it is rejected `PermissionDenied` before device or credential
   access. The result is identical for an existing out-of-scope device and a
   well-formed unknown ULID.
3. Given either secret-read RPC is denied by device scope, then exactly one
   existing `*ViewDenied` audit event is attempted with the caller-supplied
   device ULID and a generic `device outside authorized scope` reason; audit
   append failure remains best-effort and must not alter the denial.
4. Given a device-group-scoped caller and an in-scope device, when the caller
   invokes a read or `RevokeLuksDeviceKey`, then the existing downstream behavior
   is unchanged. `CreateLuksToken` succeeds only when the caller also passes its
   existing assigned-owner check; an in-scope unassigned admin remains denied.
5. Given an unscoped (global) caller holding the permission, when it invokes any
   of the four RPCs, then scope enforcement does not narrow access. All existing
   handler gates still apply, including the assigned-owner requirement for
   `CreateLuksToken`.
6. Given device-group membership resolution fails, when a scoped caller invokes
   any of the four RPCs, then it returns opaque `Internal` / `scope resolution
   failed`, performs no credential read or mutation, and does not fall back to
   global access.
7. Given any request field, then every handler calls `Validate` before actor
   extraction/authentication and before scope or domain access. Correct, absent,
   and malformed coverage proves each generated constraint: `device_id` for all
   four RPCs and `action_id` for `CreateLuksToken` / `RevokeLuksDeviceKey` must be
   valid ULIDs. A malformed direct-handler request is `InvalidArgument` even with
   no actor context; a separate schema-valid anonymous request is `Unauthenticated`.
8. Given the scope-enforcement architecture guards, when the four permissions
   become `TargetDevice`, then the package-wide parity guard still requires each
   permission to reach a recognized device-scope mechanism and a targeted
   handler-aware guard additionally requires the exact permission literal inside
   its same-named `DeviceHandler` method. A call in another method, dead helper,
   or user-scope enforcer does not count.
9. Given the device behavioral confinement sweep
   (`TestDeviceScopeHandlers_ConfineOutOfScope`), then it gains a load-bearing
   driver for each of the four RPCs, asserting out-of-scope `PermissionDenied`,
   the read-denial audit events, and, for the two writes, that no token was
   created and no revocation event or queue task was emitted. Every fixture also
   has an in-scope positive control that reaches the protected side effect: the
   token caller is assigned to the target device and uses a valid encryption
   action, while revocation has a valid signer/action and recording enqueuer.

## Out of scope

- **A `:self` / `:assigned` self-service tier.** This spec does NOT let an
  end user retrieve their own device's LUKS recovery key. LUKS/LPS stays an
  admin capability, now device-group-scoped; self-service key recovery is a
  separate feature with its own threat model (a compromised user account must
  not be able to exfiltrate its device's recovery key). Deliberately excluded;
  revisit as its own spec if wanted.
- **The `InternalService.Proxy*` credential path** (`ProxyGetLuksKey`,
  `ProxyStoreLuksKey`, `ProxyValidateLuksToken`, `ProxyStoreLpsPasswords`). Those
  are the gateway-to-control credential proxy, authorized by the device-origin
  mTLS binding (WS2), not by user RBAC. Unchanged.
- **Any proto change.** The RPCs and request/response messages already exist;
  this only changes the Go-side permission classification and handler gating.
- **New event types or payloads.** Scope-denied reads reuse the existing spec 24
  `LpsPasswordsViewDenied` / `LuksKeysViewDenied` events and payloads.

## Technical design

### Affected packages

- `server/internal/auth/permissions.go` — flip the four rows in `AllPermissions`
  from `TargetUnspecified` to `TargetDevice`.
- `server/internal/auth/permissions_test.go` — move the four permissions from
  `v1NonScopableDangerous` to `v1ScopableDeviceTargeted`; the existing curated
  exact-classification tests then pin each one as `TargetDevice`.
- `server/internal/api/device_handler.go` — call `Validate` as the first
  request-dependent operation in every affected handler. In particular,
  `RevokeLuksDeviceKey` moves validation before `UserFromContext`; its anonymous
  test uses schema-valid ULIDs and separate malformed/absent tests pin
  `InvalidArgument` precedence. After actor extraction, call
  `auth.EnforceDeviceScopeOnBaseTier(ctx, newScopeResolver(h.store),
  "<Permission>", req.Msg.DeviceId)` before the existing `Device.Get`. Return
  scope-resolution `Internal` errors unchanged. For the two read RPCs, a
  `PermissionDenied` result first attempts the existing matching denied-read
  audit event with a generic scope reason, then returns the original scope
  error. The write RPCs return the scope error without appending mutation/audit
  events or enqueueing work.
- `server/internal/api/scope_resolver.go` — expose the resolver constructor as a
  save/restore package-variable seam whose production default is the current
  projection-backed resolver. Non-parallel handler tests inject deterministic
  membership lookup failure and restore the seam with cleanup.
- `server/internal/api/scope_enforcement_parity_test.go` — retain the package-wide
  scopable/enforced equality guard and add a targeted enclosing-handler check for
  these four permissions, including the recognized device-enforcer family.
- `server/internal/api/device_scope_behavioral_test.go` — add load-bearing drivers
  with per-RPC setup, handler dependencies, and side-effect assertions rather
  than relying on downstream denials or a nil queue.

No proto, migration, new event type, or RBAC-default change is required (see
rollout).

### Enforcement placement

Each handler already loads the device with `Repos().Device.Get(ID: DeviceId)`
for an existence check. The new `EnforceDeviceScopeOnBaseTier` call goes before
it, so an out-of-scope identifier is denied before any credential path runs. A
global caller still reaches the existing lookup, where a missing device maps to
`NotFound`. A scoped caller's well-formed unknown ULID does not reach that lookup
and therefore returns the same `PermissionDenied` as an existing out-of-scope
device.

Because `EnforceDeviceScopeOnBaseTier` returns `nil` for a caller lacking the
base permission (the `:assigned`-tier passthrough), and this spec adds no
`:assigned` tier for LUKS/LPS, a caller must hold the base permission to reach
these handlers at all (the interceptor already gates that). Its effective
behavior here is: a global grant allows scope passage; a device-group grant
confines to the group; a wrong-kind or non-intersecting grant denies; resolver
failure returns `Internal`. Passing this gate does not replace downstream domain
authorization. In particular, `CreateLuksToken` keeps its assigned-owner check.

For `GetDeviceLpsPasswords` and `GetDeviceLuksKeys`, only a scope result whose
Connect code is `PermissionDenied` emits the existing denied-read audit event.
`Internal` resolution failures remain opaque to the client and are logged by the
existing RPC error path as `scope resolution failed`; the resolver's underlying
cause is not retained by the current enforcer and is therefore not claimed as
logged. They are not mislabeled as authorization denials.

## Security considerations

- **Authorization.** This is a tightening. Reads and writes of LUKS/LPS become
  confined to the caller's device-group scope. Global (unscoped) admins are
  unaffected.
- **Existence oracle.** Scope enforcement runs before the device lookup and
  returns the same `PermissionDenied` for an existing out-of-scope device and a
  well-formed unknown identifier. A global caller retains the existing
  `NotFound` result for an unknown device.
- **Credential handling.** The credential read/create/revoke logic is untouched;
  only the gate in front of it changes. The `InternalService` proxy path (gateway
  origin-bound) is untouched. The assigned-owner gate on `CreateLuksToken`
  remains mandatory after scope passage.
- **Audit.** Permitted reads retain their existing view events. Scope-denied
  secret reads reuse the existing denied events so moving the authorization gate
  earlier does not create an audit blind spot. No mutation event is emitted for
  a scope-denied write.
- **No `context.Background()`** in these paths; the enforcer uses the request
  context.

## Test requirements

### Handler tests (real Postgres, real handlers)

For each of the four RPCs:

- Correct, absent, and malformed `device_id`; and correct, absent, and malformed
  `action_id` for the two write RPCs. A direct-handler malformed request with no
  actor context returns `InvalidArgument`, proving validation precedes actor
  extraction as well as scope, repository, queue, and audit-event effects. A
  separate schema-valid request with no actor context returns `Unauthenticated`.
- Existing out-of-scope device and well-formed unknown ULID under a
  device-group-scoped grant both return `PermissionDenied`.
- In-scope device passes the scope gate. The read RPCs and revocation continue
  through their existing success paths. `CreateLuksToken` has separate in-scope
  assigned-owner success and in-scope unassigned-admin `PermissionDenied` cases.
- Global caller reaches the existing behavior, including global unknown-device
  `NotFound` and the assigned-owner gate on token creation.
- Injected scope-resolver failure returns opaque `Internal` and proves no
  credential read, token creation, revocation event, or queue task occurred. The
  test replaces the resolver-constructor package variable with a sentinel
  `auth.ScopeResolver`, restores it in cleanup, and does not run in parallel.
- Scope-denied read attempts exactly one matching `*ViewDenied` event with the
  generic scope reason. Audit append failure is logged but the returned
  `PermissionDenied` is unchanged.
- For scope-denied writes, assert via repository/event/queue state that no token
  was created and no revocation request was recorded or dispatched.
- `CreateLuksToken` sweep setup assigns the scoped caller to the device and creates
  a valid encryption action, so removing the scope gate would create a token.
  `RevokeLuksDeviceKey` injects a recording enqueuer, valid signer, and action ID;
  its allowed control completes and its denied case proves zero queue calls.
- Unauthenticated and absent-permission rejection remain covered through the real
  handler/interceptor path. `TestRevokeLuksDeviceKey_NotAuthenticated` changes to
  schema-valid ULIDs so it continues to pin authentication after validation.

### Architecture guards

- `TestV1NonScopableDangerous_CuratedSet_AllStayUnspecified` no longer contains
  these four permissions; `TestV1ScopableDeviceTargeted_CuratedSet_AllPresentAndClassified`
  contains them and pins the exact `TargetDevice` classification.
- `TestScopablePermissions_AllEnforced` retains package-wide equality. A targeted
  enclosing-handler guard requires each changed permission to be passed by its
  same-named `DeviceHandler` method to a recognized device-scope enforcer.
  Red-check by moving one call to an unrelated method and confirming the original
  handler is still reported missing.
- `TestDeviceScopeHandlers_ConfineOutOfScope` gains the four load-bearing drivers.

## Rejection paths

| Scenario | Error code | Client message | Logged context |
|---|---|---|---|
| Existing out-of-scope device or scoped unknown ULID | PermissionDenied | "permission denied" | RPC log contains procedure/request ID/code/message; reads additionally attempt exactly one generic denied-read audit with actor and caller-supplied device_id; writes append no domain event |
| Device-scope membership lookup fails | Internal | "scope resolution failed" | method/status plus opaque failure; the underlying resolver error is not retained; no credential data |
| Global caller uses an unknown device ULID | NotFound | "device not found" | RPC log contains procedure/request ID/code/message; reads additionally attempt the existing denied-read audit; writes append no domain event |
| In-scope/global but unassigned `CreateLuksToken` caller | PermissionDenied | Existing assigned-owner message | actor, device_id; no token |
| Absent or malformed device/action ULID | InvalidArgument | Existing validation message | validation field/category; no scope or domain access |
| Unauthenticated | Unauthenticated | (interceptor/handler) | method, remote |
| Missing base permission | PermissionDenied | (interceptor) | actor, method |

## Rollout and migration

- **Server-only, no migration.** Update the permission registry and its inverse
  curated classification sets, move `RevokeLuksDeviceKey` validation before auth,
  add four enforcement calls, the resolver-constructor test seam, handler-aware
  guard coverage, and load-bearing sweep drivers.
- **Backward compatibility / behavior change (intended):** existing unscoped
  grants stay global, so full admins are unchanged. Current role-assignment
  validation does not permit a device-group-scoped role containing a
  `TargetUnspecified` permission, so there is no supported scoped grant whose
  meaning changes in place. After the classification change, operators may grant
  these permissions in device-group-scoped roles and receive real confinement.
- **No default-role change.** The bootstrap admin role holds these unscoped, so
  it stays global.

## References

- spec 30 (authorization-coverage audit that surfaced this).
- `GetDevice` / `DeleteDevice` in `server/internal/api/device_handler.go` — the
  `EnforceDeviceScopeOnBaseTier` pattern this reuses.
- `auth.EnforceDeviceScopeOnBaseTier` (`server/internal/auth/scope.go`).
- spec 24 (secret-read audit events, unchanged), spec 25 (LUKS sealed transport).
