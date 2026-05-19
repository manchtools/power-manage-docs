# ADMIN_POLICY

Manages sudo or doas policy for a group of users. Three templates: `FULL` (all sudo), `LIMITED` (curated allowlist), or `CUSTOM` (raw sudoers / doas.conf syntax with a `{group}` placeholder).

The agent creates a dedicated Linux group per action, writes a policy file in `/etc/sudoers.d/` (or `/etc/doas.d/`) that references it, and validates with `visudo -c` before committing.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `access_level` | enum | yes | — | `FULL`, `LIMITED`, or `CUSTOM`. |
| `users` | string[] | yes | — | Usernames to grant access. Each 1–32 chars. |
| `custom_config` | string | yes if `CUSTOM` | — | Raw sudoers / doas syntax. Supports `{group}` placeholder. Max 64 KB. |
| `backend` | enum | no | `SUDO` | `SUDO` (default) or `DOAS`. |

## What each template means

`FULL` grants unrestricted sudo with password required.

`LIMITED` allows the package managers (apt, dnf, pacman, zypper), systemctl, reboot, mount, network tools, container runtimes (docker, podman, containerd), and standard diagnostic tools. It explicitly denies modifications to `/etc/sudoers`, `/etc/sudoers.d/*`, and `power-manage-agent.service`. Useful for ops engineers who shouldn't be able to break the agent.

`CUSTOM` is raw policy. The `{group}` placeholder substitutes the action's managed group name. The agent runs `visudo -c` against the rendered output before installing; a syntax error fails the action.

## Idempotency

The agent hashes the rendered policy file and compares against the file on disk. Group membership is compared exactly. Match on both means `changed=false`.

`desired_state: ABSENT` removes the group and the policy file.

## Example

Limited admin for the ops team:

```yaml
type: ADMIN_POLICY
access_level: LIMITED
users:
  - alice
  - bob
  - carol
desired_state: PRESENT
```

Custom policy for read-only diagnostic access:

```yaml
type: ADMIN_POLICY
access_level: CUSTOM
custom_config: |
  %{group} ALL=(ALL) NOPASSWD: /usr/bin/journalctl
  %{group} ALL=(ALL) NOPASSWD: /usr/bin/systemctl status *
users:
  - support1
  - support2
desired_state: PRESENT
```

## Gotchas

- `visudo -c` runs on the rendered file before install. If it fails, the policy doesn't land and the action errors. Useful guard against syntactically-bad CUSTOM configs.
- The `LIMITED` template's deny list is the safety net. Don't rely on it as a security boundary; an interactive shell inside any allowed command can still escalate via tricks like `vi :!sh`. Use the upcoming `TerminalAdminLimited` role for genuine restricted shell access.
- DOAS backend uses `/etc/doas.d/` (modern doas) or appends to `/etc/doas.conf` on older systems. The agent picks the right path based on the doas version it finds.
- Group names are derived from the action ID and capped at 32 chars. Long action IDs get a stable hash-based truncation, so collisions don't happen even with very similar action names.
