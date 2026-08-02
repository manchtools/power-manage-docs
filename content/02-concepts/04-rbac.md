---
title: RBAC and scopes
---
# RBAC and scopes

<!-- docref: begin src=server:internal/store/sqliteschema/schema.sql:60b69f25,server:internal/auth/reconcile.go#ReconcileSystemRoles:d0e2cd53,server:internal/auth/permissions.go#AllPermissions:1976054b -->
Permissions are dynamic. Operators define roles by picking from a fixed permission list, and a user can hold several roles directly or pick them up from user groups. The SQLite baseline schema seeds two **system** roles, `Admin` and `User`; control refreshes their permission sets from the code registry on every boot, and neither can be edited or deleted through the RPC surface. Author your own roles alongside them — the seeds are a starting point, not the only options.
<!-- docref: end -->

## Per-permission scopes

Most permissions come in two flavours: full and scoped.

<!-- docref: begin src=server:internal/auth/context.go#EnforceSelfScope:218c5c37,server:internal/device/handlers.go#Handlers.ListDevices:026097d1,server:internal/device/handlers.go#Handlers.readDevice:9eca5df2,server:internal/store/reads.go#DeviceListFilter:04074d73 -->
- `ListDevices` returns every device.
- `ListDevices:assigned` returns only devices assigned to the calling user.

Scopes are enforced at the handler layer. [`auth.EnforceSelfScope`](/security/mtls) admits the unrestricted tier and the `:self` tier; the `:assigned` tier is decided by an ownership filter in the device handlers. A list handler that holds only the `:assigned` tier sets `DeviceListFilter.AssignedUserID` to the caller's own ID — a `*string` that is nil for unscoped admins — and the store threads it into the read query as the sqlc `assigned_user_id` parameter. A single-device read takes the same tier through an explicit assignment check and returns NotFound when the caller does not own the row.
<!-- docref: end -->

{% callout type="warn" title=":assigned and new RPCs" %}
<!-- docref: begin src=server:internal/auth/authorizer.go#Authorize:727c77ee,server:internal/auth/authorizer.go#AssignedPermissionBases:66475bf3,server:internal/auth/permissions_test.go:6acf2439 -->
The `:assigned` tier fails closed. `Authorize` admits it only for actions on an explicit allow-list in `internal/auth`, so registering a new `<RPCName>:assigned` permission without also classifying the action — and wiring its handler's ownership filter — denies the request instead of waving it through. A parity sweep over the generated control-service interface keeps the two in step: the allow-list, the registered `:assigned` permissions, and the real RPC names must be the same exact set.
<!-- docref: end -->
{% /callout %}

## User groups

A user group is a named collection of OIDC/SCIM-provisioned users that grants
roles additively. Membership may be static or derived from non-secret identity
profile fields supplied by the configured provider.

<!-- docref: begin src=server:internal/store/queries/role_grants.sql:9b05444e -->
Permissions are unioned across a user's direct roles and all groups they belong to. There is no "deny" semantic. To take a permission away, remove the user from the group that grants it.
<!-- docref: end -->

## Identity providers and SCIM

OIDC may create users on first sign-in when provider policy allows it. SCIM v2
handles upstream user and group provisioning. Both paths use ordinary
transactions and the same mandatory audit boundary as operator-initiated
changes.
