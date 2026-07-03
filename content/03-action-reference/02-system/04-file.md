---
title: FILE
---
# FILE

Manages a single file: content, ownership, and mode. Two operating modes are supported. Default replaces the whole file. `managed_block` mode maintains your content as a block inside a larger file. Parent directories get created automatically when missing.

For directories, use `DIRECTORY`. For multi-file fragments under `/etc/sshd_config.d/`, `/etc/sudoers.d/`, or similar, use the action type that owns that file: `SSHD`, `ADMIN_POLICY`.

## Parameters

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#FileParams:2db44133,sdk:sys/fs/fs.go#WriteOptions.Mode:d9fda01b -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | yes | — | Absolute path on the device. |
| `content` | string | no | — | The file body. Max 10 MB. |
| `owner` | string | no | unchanged | Username. Max 32 chars. Unset means ownership isn't enforced; files the agent creates are root-owned (it writes through the privilege backend). |
| `group` | string | no | unchanged | Group name. Max 32 chars. Same unset semantics as `owner`. |
| `mode` | string | no | `0644` | Unix permissions in octal (e.g. `0640`, `4755`). New writes default to `0644` when unset; an existing file's mode is only checked when `mode` is set. |
| `managed_block` | bool | no | `false` | If true, append or remove `content` as a block inside `path` rather than replacing the whole file. |
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/action_file.go#Executor.fileMatchesDesired:e3103785 -->
`FILE` compares the device's current state against the params and skips the write if everything matches: content via SHA-256, then mode, owner, and group — each only when set. A symlink at the target never counts as converged: the idempotency check refuses to follow it, and the atomic write replaces the link with a real file.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/action_file.go#Executor.executeFile:99d89632,agent:internal/executor/action_file.go#criticalFiles:47ef31b3 -->
A short list of critical files is refused outright — `/etc/passwd`, `/etc/shadow`, `/etc/sudoers`, `/etc/fstab`, `/etc/ssh/sshd_config`, and a few others — for both overwrite and removal. Use the specialised action types (`USER`, `SSHD`, `ADMIN_POLICY`) for those.

In `managed_block` mode the agent checks whether `content` already appears verbatim in the file. `PRESENT` appends it (with a separating newline) when it's missing; `ABSENT` removes the first occurrence and tidies up blank lines, leaving the rest of the file untouched. Ownership and mode are still enforced.
<!-- docref: end -->

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

<!-- docref: begin src=agent:internal/executor/action_file.go#Executor.executeFile:99d89632,agent:internal/executor/action_file.go#isProtectedPath:a21e4c09 -->
- The critical-paths refusal check runs against both the original `path` and the resolved symlink target. Pointing a symlink at `/etc/passwd` doesn't get around it. `ABSENT` additionally refuses whole protected directories and anything directly under `/`.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/action_file.go#Executor.executeFile:99d89632 -->
- Managed-block matching is exact-substring. If you *edit* the block's content, the old block stays in the file and the new one is appended — remove the old block first (`ABSENT` with the old content), or key the block's first line so stale copies are visible. Markers aren't inserted; the content itself is the block.
<!-- docref: end -->
- `mode` is octal but accepts both `0640` and `640`. Stick with the leading zero for readability.
- Removing a file with `desired_state: ABSENT` doesn't remove parent directories. Use `DIRECTORY` for that.
