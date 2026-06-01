---
title: FILE
---
# FILE

Manages a single file: content, ownership, and mode. Two operating modes are supported. Default replaces the whole file. `managed_block` mode maintains a marked block inside a larger file. Parent directories get created automatically when missing.

For directories, use `DIRECTORY`. For multi-file fragments under `/etc/sshd_config.d/`, `/etc/sudoers.d/`, or similar, use the action type that owns that file: `SSHD`, `ADMIN_POLICY`.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | yes | — | Absolute path on the device. |
| `content` | string | no | — | The file body. Max 10 MB. |
| `owner` | string | no | `root` | Username. Max 32 chars. |
| `group` | string | no | `root` | Group name. Max 32 chars. |
| `mode` | string | no | `0644` | Unix permissions in octal (e.g. `0640`, `4755`). |
| `managed_block` | bool | no | `false` | If true, append or update a delimited block inside `path` rather than replacing the whole file. |

## Idempotency

`FILE` compares the device's current state against the params and skips the write if everything matches. Content via SHA-256, owner and group via `stat`, mode the same. Symlinks resolve before the check, so a symlink pointing at the desired content counts as converged.

A short list of paths is refused outright (`/etc/passwd`, `/etc/shadow`, `/etc/sudoers`, and a few others). Use the specialised action types for those.

In `managed_block` mode the agent looks for a `# BEGIN power-manage:<action-id>` / `# END power-manage:<action-id>` block in the file. If found, only the body between markers is rewritten. If absent, the markers and body get appended.

## Examples

Drop a config file:

```yaml
type: FILE
path: /etc/myapp/config.yaml
content: |
  log_level: info
  listen: 0.0.0.0:8080
owner: myapp
group: myapp
mode: "0640"
desired_state: PRESENT
```

Manage a block inside an existing file:

```yaml
type: FILE
path: /etc/hosts
content: |
  10.0.0.5 internal-api
  10.0.0.6 internal-db
managed_block: true
desired_state: PRESENT
```

Remove a file:

```yaml
type: FILE
path: /etc/myapp/legacy.conf
desired_state: ABSENT
```

## Gotchas

- The critical-paths refusal check runs against both the original `path` and the resolved symlink target. Pointing a symlink at `/etc/passwd` doesn't get around it.
- Managed-block mode only works for line-oriented files. Binary content with `managed_block: true` is rejected at validation time.
- `mode` is octal but accepts both `0640` and `640`. Stick with the leading zero for readability.
- Removing a file with `desired_state: ABSENT` doesn't remove parent directories. Use `DIRECTORY` for that.
