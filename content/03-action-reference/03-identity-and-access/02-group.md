---
title: GROUP
---
# GROUP

Creates or removes a system group and manages its membership exactly. Use it when you want a specific list of users assembled into a named group, separate from any `USER` action.

## Parameters

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#GroupParams:3253df6b -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | yes | — | Group name. 1–32 chars. |
| `members` | string[] | no | — | Usernames belonging to the group. Each 1–32 chars. |
| `gid` | int32 | no | auto | Group ID. 0–65534. Only applied when > 0, and on creation only. |
| `system_group` | bool | no | `false` | Create as system group (GID < 1000). |
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/group.go#Executor.setupGroup:10c99208,sdk:sys/user/group.go#MembersMatch:92b70060 -->
The agent checks the group for existence and exact member set (order-insensitive). If the group is missing it gets created. If members don't match the list exactly, the agent adds missing and removes extras. Matching means `changed=false`.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/group.go#Executor.removeGroup:f8b1dd95 -->
`desired_state: ABSENT` removes all members from the group and deletes it. There is no protected group name — the agent deletes whatever group the action names, so an action pointed at `sudo`, `wheel`, or any other system group will strip its membership and remove it. The only name-level check is the format rule shared with `USER`.
<!-- docref: end -->

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

<!-- docref: begin src=agent:internal/executor/helpers.go#syncGroupMembers:7e131c82 -->
- Membership is exact, not additive. If a user has been manually added to the group on the device and isn't in the action's `members` list, they get removed on the next [reconciliation tick](/concepts/reconciliation). To allow ad-hoc additions, use `USER` to bake users' group memberships into their account record instead.
- A user listed in `members` who doesn't exist on the device is skipped with a warning in the execution output. The action doesn't fail on a missing user — only on an add/remove operation that errors.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/group.go#Executor.setupGroup:10c99208 -->
- `gid` is honoured on creation only. Changing it on an existing group requires removing the group (`desired_state: ABSENT`) and recreating it with the new `gid`; manual out-of-band members are lost, listed `members` are re-added on the next apply.
<!-- docref: end -->
