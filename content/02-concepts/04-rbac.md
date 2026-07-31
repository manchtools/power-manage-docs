---
title: RBAC and scopes
---
# RBAC and scopes

<!-- docref: begin src=server:internal/store/migrations/008_seeds.sql:68a06c9b,server:internal/auth/permissions.go#AllPermissions:665a1b03 -->
Permissions are dynamic. Operators define roles by picking from a fixed permission list, and a user can hold several roles directly or pick them up from user groups. The seeded `Admin` and `User` roles are defaults you can replace, not the only options.
<!-- docref: end -->

## Per-permission scopes

Most permissions come in two flavours: full and scoped.

<!-- docref: begin src=server:internal/auth/context.go#EnforceSelfScope:58cd825b,server:internal/api/util.go#userFilterID:d57801b4,server:internal/auth/scope.go#EnforceUserScopeOrSelf:0c0b3020 -->
- `ListDevices` returns every device.
- `ListDevices:assigned` returns only devices assigned to the calling user.

Scopes are enforced at the handler layer via [`auth.EnforceSelfScope`](/security/mtls) and `userFilterID()`. Handlers receive a `*string` filter (nil for unscoped admins, the user's ID for scoped users) and thread it into the underlying SQL through a sqlc `OwnerScope` parameter.
<!-- docref: end -->

{% callout type="warn" title=":assigned and new RPCs" %}
<!-- docref: begin src=server:internal/api/object_scope_parity_test.go:97eb2f23 -->
A new RPC that operates on per-device data has to wire `userFilterID(ctx, "<RPCName>")` into the read query if the permission supports `:assigned`. A parity-test sweep in `internal/api` catches a missing wire-up: every scoped permission must round-trip through a tagged query.
<!-- docref: end -->
{% /callout %}

## User groups

A user group is a named collection of OIDC/SCIM-provisioned users that grants
roles additively. Membership may be static or derived from non-secret identity
profile fields supplied by the configured provider.

<!-- docref: begin src=server:internal/store/queries/user_groups.sql:e8021084 -->
Permissions are unioned across a user's direct roles and all groups they belong to. There is no "deny" semantic. To take a permission away, remove the user from the group that grants it.
<!-- docref: end -->

## Identity providers and SCIM

OIDC may create users on first sign-in when provider policy allows it. SCIM v2
handles upstream user and group provisioning. Both paths use ordinary
transactions and the same mandatory audit boundary as operator-initiated
changes.
