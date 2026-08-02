---
title: Action reference
icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M11 10.27 7 3.34'/><path d='m11 13.73-4 6.93'/><path d='M12 22v-2'/><path d='M12 2v2'/><path d='M14 12h8'/><path d='m17 20.66-1-1.73'/><path d='m17 3.34-1 1.73'/><path d='M2 12h2'/><path d='m20.66 17-1.73-1'/><path d='m20.66 7-1.73 1'/><path d='m3.34 17 1.73-1'/><path d='m3.34 7 1.73 1'/><circle cx='12' cy='12' r='2'/><circle cx='12' cy='12' r='8'/></svg>"
---
# Action reference

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#ActionType:21da45c8,sdk:proto/powermanage/v1/common.proto#AssignmentMode.ASSIGNMENT_MODE_UNINSTALL:7a58be77 -->
The agent supports 23 action types grouped by what they manage. Where it makes sense, an action carries a desired state (`PRESENT` or `ABSENT`) so re-dispatching it against an already-converged device is a no-op. An assignment can also use `UNINSTALL` mode to force `ABSENT` on the action without rewriting the action itself.
<!-- docref: end -->

## Packages and updates

| Action | Backends | Purpose |
|---|---|---|
| `PACKAGE` | apt, dnf, pacman, zypper | Install or remove a named package |
| `UPDATE` | apt, dnf, pacman, zypper | Run `update && upgrade` (or the distro equivalent) |
| `REPOSITORY` | apt, dnf, pacman, zypper | Add or remove a package repository with GPG key validation |
| `DEB` | dpkg | Install a `.deb` from a URL with SHA-256 verification |
| `RPM` | rpm | Install an `.rpm` from a URL with SHA-256 verification |
| `APP_IMAGE` | AppImage | Install a portable AppImage with system integration |
| `FLATPAK` | flatpak | Install a Flatpak from the configured remote |

<!-- docref: begin src=agent:internal/executor/action_update.go#Executor.repairPackageManager:44159c9e -->
Before any package operation the agent self-heals the package manager: clears apt / pacman / zypper locks, recovers an interrupted `dpkg --configure -a`, remounts read-only filesystems, and repairs DNF history. You don't need to clean up after a failed install before retrying.
<!-- docref: end -->

## System configuration

| Action | Purpose |
|---|---|
| `SHELL` | Run a shell script. An optional detection script gives you idempotency. |
| `SCRIPT_RUN` | Run a one-shot script with output capture (no idempotency expected) |
| `SERVICE` | Manage a systemd unit: write or refresh the unit file, enable/disable it, and start, stop, or restart it. There is no backend field; systemd is what the action means. |
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
| `ENCRYPTION` | LUKS passphrase rotation with optional TPM or user-passphrase enrolment. LUKS is the only backend. |
| `WIFI` | Manage NetworkManager wireless profiles |

## Lifecycle

| Action | Purpose |
|---|---|
| `AGENT_UPDATE` | Self-update the agent binary. SHA-256 verified, swap-and-restart. |

`REBOOT` and `SYNC` are the only **instant actions** today. Control first
commits their delivery, then offers it immediately on the device's direct mTLS
stream. The agent durably records the delivery ID before acknowledging
receipt. Ordinary application frames are not separately signed.

<!-- docref: begin src=sdk:proto/powermanage/v1/control.proto#ControlService.DispatchAssignedActions:031cd7e5 -->
There's also a separate "rerun a device's current policy now" operator action — `DispatchAssignedActions`. That one is *not* an instant action: it walks the device's assignments and re-dispatches each through the normal action path. Reach for it when you want a device to converge on its assigned state without rebooting or waiting for the next reconciliation tick.
<!-- docref: end -->

## Conventions

<!-- docref: begin src=agent:internal/executor/executor.go#IsInstantAction:401666e5,agent:internal/executor/action_service.go#Executor.executeService:c5c6fd44 -->
- Most actions are idempotent. `REBOOT`, `SYNC`, `SCRIPT_RUN`, and `SERVICE` with `desired_state: RESTARTED` are the explicit exceptions; each says so on its own page.
<!-- docref: end -->
<!-- docref: begin src=server:internal/execution/result.go#Service.ApplyActionResult:9d9ace81,server:internal/store/audit.go#AuditOperation:42ce04d3 -->
- An execution is an ordinary row, not an event stream. Dispatch creates it; the agent's first non-terminal result moves it to `running`; a terminal result writes `success`, `failed`, `skipped`, `timeout`, `not_applicable`, or `indeterminate` with its output, duration, and changed/compliant flags. Replaying the identical terminal result is a no-op; a *different* one is rejected as a conflicting replay rather than overwriting the recorded outcome. Each of those writes lands in the same transaction as an append-only audit operation attributed to the reporting device.
<!-- docref: end -->
<!-- docref: begin src=server:internal/store/audit.go#AuditEffect:4a8afbb5 -->
- `SHELL`, `SCRIPT_RUN`, `FILE`, `SERVICE`, `ADMIN_POLICY`, `REPOSITORY`, `ENCRYPTION`, and `WIFI` actions can carry secret content, and none of it can reach the audit trail — there is no redactor and no field denylist to keep current. An audit effect has **no free-form value field**: it records the *names* of changed fields (`params`), a reference to another row, a state flag, a count, a non-reversible digest, or per-subject sealed detail, and nothing else is representable. Parameter values live only in the action row, protected by RBAC.
<!-- docref: end -->
<!-- docref: begin src=sdk:sys/exec/runner.go#Command:f10920f4,agent:cmd/power-manage-agent/backend.go#setPrivilegeBackend:0de2458c -->
- Privileged operations dispatch through the SDK's injected `sys/exec` Runner with `Command.Escalate` set, never through `os/exec` directly. The privilege backend — direct root, sudo, or doas — is resolved once at agent startup.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/scheduler/scheduler.go#Scheduler.dispatchAllowed:fcb93355,agent:internal/scheduler/scheduler.go#Scheduler.runDue:b20ae0bb -->
- Maintenance windows apply per device group, and they gate *assigned* work. An action assigned to a group with a window only runs during that window in the device's local timezone. An explicit dispatch is exempt — it compiles a one-shot delivery and runs at once. See [Maintenance windows](/concepts/maintenance-windows).
<!-- docref: end -->
