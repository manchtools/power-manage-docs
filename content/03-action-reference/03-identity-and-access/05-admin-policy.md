---
title: ADMIN_POLICY
---
# ADMIN_POLICY

Manages sudo policy for a group of users. Three operator-facing templates: `FULL` (all sudo), `LIMITED` (curated allowlist), or `CUSTOM` (raw sudoers syntax with a `{group}` placeholder). Two further access levels (`TERMINAL_ADMIN_LIMITED`, `TERMINAL_ADMIN_FULL`) exist in the proto but are reserved for the server's TerminalAdmin reconciler — passwordless variants for system-managed `pm-tty-*` accounts. Don't use them in operator-authored actions.

The agent creates a dedicated Linux group per action (`pm-sudo-<actionId>`), writes a policy file in `/etc/sudoers.d/`, and validates with `visudo -c` before committing.

<!-- docref: begin src=agent:internal/executor/sudo.go#Executor.executeSudo:e99b301e,agent:internal/executor/sudo.go#sudoersFilePath:e20bebd5 -->
> **`backend: DOAS` is reserved but not yet implemented.** The proto carries the enum so the action can grow doas support without a rename, but the executor ignores the field and always writes to `/etc/sudoers.d/`. Selecting `DOAS` today gets you a sudoers policy under a doas-named action — almost certainly not what you want. Until the doas backend lands, treat the `backend` field as `SUDO`-only.
<!-- docref: end -->

## Parameters

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#AdminPolicyParams:7d689d80,sdk:proto/pm/v1/actions.proto#AdminAccessLevel:628b1d01 -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `access_level` | enum | yes | — | `FULL`, `LIMITED`, or `CUSTOM` (plus the reserved `TERMINAL_ADMIN_*` levels used by the server). |
| `users` | string[] | yes | — | Usernames to grant access. At least one; each 1–32 chars. |
| `custom_config` | string | yes if `CUSTOM` | — | Raw sudoers syntax. Supports `{group}` placeholder. Max 64 KB. |
| `backend` | enum | no | `SUDO` | `SUDO` is the only working value. `DOAS` is reserved in the proto but not yet wired up. |
<!-- docref: end -->

## What each template means

<!-- docref: begin src=agent:internal/executor/sudo.go#generateFullSudoConfig:102c0407 -->
`FULL` grants unrestricted sudo (`%group ALL=(ALL:ALL) ALL`) with password required.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/sudo.go#generateLimitedSudoConfig:fee5c6ff -->
`LIMITED` allows the package managers (apt, dnf/yum/rpm, pacman, zypper, flatpak/snap, nix, apk), systemctl and journalctl, reboot/shutdown, timedatectl/hostnamectl, network tools (ip, nmcli, networkctl, ufw, firewall-cmd), mount/umount/blkid, the container runtimes docker and podman, and dmesg — password required. It denies `systemctl` invocations that touch `power-manage-agent*` and the `visudo` binaries. The intended audience is ops engineers who shouldn't be able to disable the agent.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/sudo.go#generateCustomSudoConfig:9ee15184,agent:internal/executor/sudo.go#Executor.setupSudoPolicy:02626db4 -->
`CUSTOM` is raw policy. The `{group}` placeholder substitutes the action's managed group name. The agent runs `visudo -c` against the rendered file before it takes effect; a syntax error removes the file and fails the action.
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/sudo.go#Executor.setupSudoPolicy:02626db4 -->
The agent compares the rendered policy content against the file on disk and the group membership against `users` exactly. Match on both means `changed=false`.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/sudo.go#Executor.removeSudoPolicy:1ae9a7e0 -->
`desired_state: ABSENT` removes the policy file, the group members, and the group.
<!-- docref: end -->

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

<!-- docref: begin src=agent:internal/executor/helpers.go#Executor.writeAndValidateConfig:207cd164 -->
- `visudo -c` runs on the rendered file before it counts as installed. If it fails, the file is removed and the action errors. Useful guard against syntactically-bad CUSTOM configs.
<!-- docref: end -->
- The `LIMITED` template's deny list is the safety net. Don't rely on it as a security boundary; an interactive shell inside any allowed command can still escalate via tricks like `vi :!sh`. For genuine restricted shell access, pair this with a custom role that scopes `StartTerminal` to a small target set (see [Terminal access](/security/terminal-access)).
<!-- docref: begin src=agent:internal/executor/sudo.go#sanitizeSudoGroupName:80275300,agent:internal/executor/action_ssh.go#shortGroupName:acd6b1fe -->
- Group names are derived from the action ID (`pm-sudo-<actionId>`) and capped at 32 chars. Long action IDs get a stable hash-based truncation, so collisions don't happen even with very similar action names.
<!-- docref: end -->
