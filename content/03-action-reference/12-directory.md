---
title: DIRECTORY
---
# DIRECTORY

Manages a directory: presence, ownership, and mode. The complement to [`FILE`](/action-reference/file) for when you need a directory but not specific contents inside it.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | yes | — | Absolute directory path. |
| `owner` | string | no | `root` | Username. Max 32 chars. |
| `group` | string | no | `root` | Group name. Max 32 chars. |
| `mode` | string | no | `0755` | Unix permissions in octal. |
| `recursive` | bool | no | `true` | Create missing parent directories (`mkdir -p`). |

## Idempotency

`stat` the directory. Match owner, group, mode? `changed=false`. Otherwise the agent applies the missing pieces (chown, chmod, mkdir) and re-stats to confirm.

For `desired_state: ABSENT` the agent removes the directory. A protected list refuses removal of `/`, `/etc`, `/usr`, `/var`, `/home`, and several others.

## Example

Create a service's data directory with restricted permissions:

```yaml
type: DIRECTORY
path: /var/lib/myapp
owner: myapp
group: myapp
mode: "0750"
desired_state: PRESENT
```

Remove a legacy directory tree:

```yaml
type: DIRECTORY
path: /opt/legacy-app
desired_state: ABSENT
```

## Gotchas

- `desired_state: ABSENT` is recursive. The whole subtree gets removed. There is no opt-in for the recursive flag because a half-removed tree isn't a useful state.
- The protected-path check applies to both `path` and the resolved symlink target. A symlink at `/srv/etc` pointing to `/etc` doesn't bypass the refusal.
- `recursive` controls `mkdir -p` behaviour for creation only. It doesn't affect removal.
- The agent doesn't manage contents recursively. Ownership and mode are set on the directory itself, not on existing files inside it. Use `FILE` for individual files.
