---
title: RBAC and scopes
---
# RBAC and scopes

<!-- docref: begin src=server:internal/store/migrations/008_seeds.sql:d0e93fa9,server:internal/auth/permissions.go#AllPermissions:46b6daca -->
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

<!-- docref: begin src=server:internal/dynamicquery/eval.go#UserContext:cdac5e61,server:internal/dynamicquery/eval.go#EvaluateUser:f50e3793 -->
A user group is a named collection of users that grants roles (and through them, permissions) additively. Membership is either static (operator picks users) or dynamic (a query over user-profile fields — email, display_name, preferred_username, locale, disabled, totp_enabled, has_password — using the same grammar as device groups).
<!-- docref: end -->

<!-- docref: begin src=server:internal/store/queries/user_groups.sql:e8021084 -->
Permissions are unioned across a user's direct roles and all groups they belong to. There is no "deny" semantic. To take a permission away, remove the user from the group that grants it.
<!-- docref: end -->

## Identity providers and SCIM

<!-- docref: begin src=sdk:proto/pm/v1/control.proto#CreateIdentityProviderRequest.auto_create_users:07cee631,server:internal/scim/users.go:4052bd61 -->
For SSO, OIDC identity providers create users on first sign-in when `auto_create_users` is on. SCIM v2 endpoints accept full user and group provisioning from upstream IdPs. Both paths map onto the same event types the web UI emits, so the audit trail looks the same no matter how the change came in.
<!-- docref: end -->
