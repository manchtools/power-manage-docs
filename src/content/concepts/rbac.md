# RBAC + scopes

Permissions in Power Manage are dynamic — operators define roles by selecting from a fixed permission list, and users may belong to multiple roles directly or via user groups. The seeded `Admin` and `User` roles are starting points, not the only options.

## Per-permission scopes

Many permissions have `:self` and `:assigned` scoped variants:

- `ListDevices` → see every device
- `ListDevices:assigned` → see only devices assigned to the calling user

Scopes are enforced at the handler layer via [`auth.EnforceSelfScope`](/security/mtls) and `userFilterID()` — handlers receive a `*string` filter (nil for unscoped admins, the user's ID for scoped users) and thread it into the underlying SQL via a sqlc `OwnerScope` parameter.

{% callout type="warn" title=":assigned + new RPCs" %}
Adding a new RPC that operates on per-device data requires wiring `userFilterID(ctx, "<RPCName>")` into the read query if the permission supports `:assigned`. The Go projector tests catch the missing wire-up — every `:assigned` permission must round-trip through a tagged query.
{% /callout %}

## User groups

A user group is a named, optionally-dynamic collection of users with an additive permission set. Membership can be:

- **Static** — operator picks individual users
- **Dynamic** — defined by a query against the user-profile fields (email, linux_username, disabled, …) using the same query language as device groups

When the same permission appears in multiple groups for a user, the permissions are unioned (additive). There's no "deny" semantic; if you need to revoke a permission, remove the user from the group that grants it.

## Identity providers + SCIM

For SSO deployments, OIDC identity providers create users on first sign-in (with `auto_create_users`). SCIM v2 endpoints accept full user + group provisioning from upstream IdPs — operations are mapped to the same event types the web UI emits, so the audit trail is uniform regardless of how the change came in.
