# RBAC and scopes

Permissions are dynamic. Operators define roles by picking from a fixed permission list, and a user can hold several roles directly or pick them up from user groups. The seeded `Admin` and `User` roles are defaults you can replace, not the only options.

## Per-permission scopes

Most permissions come in two flavours: full and scoped.

- `ListDevices` returns every device.
- `ListDevices:assigned` returns only devices assigned to the calling user.

Scopes are enforced at the handler layer via [`auth.EnforceSelfScope`](/security/mtls) and `userFilterID()`. Handlers receive a `*string` filter (nil for unscoped admins, the user's ID for scoped users) and thread it into the underlying SQL through a sqlc `OwnerScope` parameter.

{% callout type="warn" title=":assigned and new RPCs" %}
A new RPC that operates on per-device data has to wire `userFilterID(ctx, "<RPCName>")` into the read query if the permission supports `:assigned`. The projector tests catch a missing wire-up: every `:assigned` permission must round-trip through a tagged query.
{% /callout %}

## User groups

A user group is a named collection of users with an additive permission set. Membership is either static (operator picks users) or dynamic (a query over user-profile fields like email, linux_username, disabled, using the same grammar as device groups).

Permissions are unioned across all groups a user belongs to. There is no "deny" semantic. To take a permission away, remove the user from the group that grants it.

## Identity providers and SCIM

For SSO, OIDC identity providers create users on first sign-in when `auto_create_users` is on. SCIM v2 endpoints accept full user and group provisioning from upstream IdPs. Both paths map onto the same event types the web UI emits, so the audit trail looks the same no matter how the change came in.
