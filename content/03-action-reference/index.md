---
title: Action reference
icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M11 10.27 7 3.34'/><path d='m11 13.73-4 6.93'/><path d='M12 22v-2'/><path d='M12 2v2'/><path d='M14 12h8'/><path d='m17 20.66-1-1.73'/><path d='m17 3.34-1 1.73'/><path d='M2 12h2'/><path d='m20.66 17-1.73-1'/><path d='m20.66 7-1.73 1'/><path d='m3.34 17 1.73-1'/><path d='m3.34 7 1.73 1'/><circle cx='12' cy='12' r='2'/><circle cx='12' cy='12' r='8'/></svg>"
---
# Action reference

The agent supports 23 action types grouped by what they manage. Where it makes sense, an action carries a desired state (`PRESENT` or `ABSENT`) so re-dispatching it against an already-converged device is a no-op. An assignment can also use `UNINSTALL` mode to force `ABSENT` on the action without rewriting the action itself.

## Packages and updates

| Action | Backends | Purpose |
|---|---|---|
| `PACKAGE` | apt, dnf, pacman, zypper | Install or remove a named package |
| `UPDATE` | apt, dnf, pacman, zypper | Run `update && upgrade` (or the distro equivalent) |
| `REPOSITORY` | apt, dnf, pacman | Add or remove a package repository with GPG key validation |
| `DEB` | dpkg | Install a `.deb` from a URL with SHA-256 verification |
| `RPM` | rpm | Install an `.rpm` from a URL with SHA-256 verification |
| `APP_IMAGE` | AppImage | Install a portable AppImage with system integration |
| `FLATPAK` | flatpak | Install a Flatpak from the configured remote |

Before any package operation the agent self-heals the package manager: clears apt / pacman / zypper locks, recovers an interrupted `dpkg --configure -a`, remounts read-only filesystems, and repairs DNF history. You don't need to clean up after a failed install before retrying.

## System configuration

| Action | Purpose |
|---|---|
| `SHELL` | Run a shell script. An optional detection script gives you idempotency. |
| `SCRIPT_RUN` | Run a one-shot script with output capture (no idempotency expected) |
| `SERVICE` | Manage a service unit. systemd today; OpenRC, runit, and s6 slots are reserved in the proto but not yet implemented. |
| `FILE` | Manage file content, ownership, and mode. Managed-block diffing for fragments inside a larger file. |
| `DIRECTORY` | Manage directory presence, ownership, and mode |
| `REBOOT` | Reboot the device |
| `SYNC` | Trigger an out-of-band [reconciliation tick](/concepts/reconciliation) |

## Identity and access

| Action | Purpose |
|---|---|
| `USER` | Create, modify, or delete a system user with linux_uid, home, shell, and groups |
| `GROUP` | Create or delete a system group |
| `SSH` | Manage a user's `authorized_keys` |
| `SSHD` | Manage `sshd_config` through priority-ordered Override fragments |
| `ADMIN_POLICY` | Sudoers or doas.conf fragments built from an `access_level` template |
| `LPS` | Local Password Solution. Rotates local-account passwords on a schedule and stores ciphertext at rest. |

## Security and networking

| Action | Purpose |
|---|---|
| `ENCRYPTION` | LUKS passphrase rotation with optional TPM or user-passphrase enrolment. GELI and CGD are proto-enum placeholders only. |
| `WIFI` | Manage NetworkManager wireless profiles |

## Lifecycle

| Action | Purpose |
|---|---|
| `AGENT_UPDATE` | Self-update the agent binary. SHA-256 verified, swap-and-restart. |

`REBOOT` and `SYNC` are the only **instant actions** today. They dispatch over the agent's mTLS stream immediately rather than waiting for the next reconciliation tick, signed over `(actionID, type, "{}")`. The agent verifies the signature before acting, so a compromised gateway or Valkey can't forge a fleet-wide reboot.

There's also a separate "rerun a device's current policy now" operator action — `DispatchAssignedActions`. That one is *not* an instant action: it walks the device's assignments and re-dispatches each through the normal action path. Reach for it when you want a device to converge on its assigned state without rebooting or waiting for the next reconciliation tick.

## Conventions

- Most actions are idempotent. `REBOOT`, `SYNC`, `SCRIPT_RUN`, and `SERVICE` with `desired_state: RESTARTED` are the explicit exceptions; each says so on its own page.
- Every action emits an `ExecutionCreated` event on dispatch and either an `ExecutionCompleted` or `ExecutionFailed` event when it finishes. The events table is the audit log.
- `SHELL`, `SCRIPT_RUN`, and `FILE` actions can carry secret content. The audit redactor strips `script`, `detectionScript`, `content`, `customConfig`, `gpgKey`, and `presharedKey` from the visible trail.
- Privileged operations go through `sdk/go/sys/exec.Privileged()` rather than `os/exec` directly. That's where the sudo / doas decision happens.
- Maintenance windows apply per device group. An action assigned to a group with a window only runs during that window in the device's local timezone. See [Maintenance windows](/concepts/maintenance-windows).
