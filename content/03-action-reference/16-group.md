---
title: GROUP
---
# GROUP

Creates or removes a system group and manages its membership exactly. Use it when you want a specific list of users assembled into a named group, separate from any `USER` action.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | yes | — | Group name. 1–32 chars. |
| `members` | string[] | no | — | Usernames belonging to the group. Each 1–32 chars. |
| `gid` | int32 | no | auto | Group ID. 0–65534. |
| `system_group` | bool | no | `false` | Create as system group (GID < 1000). |

## Idempotency

The agent checks `getent group <name>` for existence and exact member set. If the group is missing it gets created. If members don't match the list exactly, the agent adds missing and removes extras. Matching means `changed=false`.

`desired_state: ABSENT` removes the group. The `power-manage` group is protected; the agent refuses to delete it.

## Example

A `developers` group for SSH access policy:

```yaml
type: GROUP
name: developers
members:
  - alice
  - bob
  - carol
desired_state: PRESENT
```

A system group for a service:

```yaml
type: GROUP
name: myapp
system_group: true
desired_state: PRESENT
```

## Gotchas

- Membership is exact, not additive. If a user has been manually added to the group on the device and isn't in the action's `members` list, they get removed on the next [reconciliation tick](/concepts/reconciliation). To allow ad-hoc additions, use `USER` to bake users' group memberships into their account record instead.
- A user listed in `members` who doesn't exist on the device is silently skipped with a warning in the audit log. The action doesn't fail.
- `gid` is honoured on creation only. Changing it later requires removing the group and recreating, which loses members.
