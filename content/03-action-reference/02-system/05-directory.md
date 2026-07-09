---
title: DIRECTORY
---
# DIRECTORY

Manages a directory: presence, ownership, and mode. The complement to [`FILE`](/action-reference/system/file) for when you need a directory but not specific contents inside it.

## Parameters

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#DirectoryParams:d1d2593e,agent:internal/executor/fs.go#createDirectoryWithPermissions:369e2021 -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `path` | string | yes | — | Absolute directory path. |
| `owner` | string | no | unchanged | Username. Max 32 chars. Unset means ownership isn't enforced (new directories end up root-owned — the agent creates them through the privilege backend). |
| `group` | string | no | unchanged | Group name. Max 32 chars. Same unset semantics as `owner`. |
| `mode` | string | no | `0755` | Unix permissions in octal. `0755` is applied when `owner`/`group` are set without a mode; with all three unset, `mkdir`'s default (umask) applies. |
| `recursive` | bool | no | `false` | Create missing parent directories (`mkdir -p`). **Unset means `false`** — the web form pre-selects it, but an API client that omits the field gets a non-recursive `mkdir`. |
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/action_directory.go#Executor.directoryMatchesDesired:fed8a844,agent:internal/executor/action_directory.go#Executor.executeDirectory:f63af3d7 -->
`stat` the directory. Owner, group, and mode each match (checked only when set)? `changed=false`. Otherwise the agent creates the directory and applies mode and ownership through a symlink-safe, fd-anchored path.

For `desired_state: ABSENT` the agent removes the directory. Protected system paths are refused — for **both** PRESENT and ABSENT, so the action can neither `chmod`/`chown` nor delete them.
<!-- docref: end -->

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

<!-- docref: begin src=sdk:sys/fs/dir.go#manager.RemoveDir:cc6942ae -->
- `desired_state: ABSENT` is recursive. The whole subtree gets removed. There is no opt-in for the recursive flag because a half-removed tree isn't a useful state.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/action_directory.go#Executor.executeDirectory:f63af3d7,sdk:sys/fs/protected.go#IsProtectedPath:3887b7ed,sdk:sys/fs/protected.go#IsUnderProtectedPrefix:4231d9a0 -->
- The protected-path refusal is deny-by-default across whole subtrees, not just a top-level list: `/`, `/etc`, `/usr`, `/var`, `/home`, anything *under* security-relevant prefixes (`/etc/sudoers.d`, `/home/<user>`, `/boot/efi`, …), any immediate child of `/`, and the resolved symlink target as well as the literal path. A symlink at `/srv/etc` pointing to `/etc` doesn't bypass it.
<!-- docref: end -->
- `recursive` controls `mkdir -p` behaviour for creation only. It doesn't affect removal.
<!-- docref: begin src=agent:internal/executor/fs.go#createDirectoryWithPermissions:369e2021 -->
- The agent doesn't manage contents recursively. Ownership and mode are set on the directory itself, not on existing files inside it. Use `FILE` for individual files.
<!-- docref: end -->
