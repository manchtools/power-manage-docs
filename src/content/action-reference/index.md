# Action reference

The agent supports 24 action types grouped by what they manage. Where it makes sense, an action carries a desired state (`PRESENT` or `ABSENT`) so re-dispatching it against an already-converged device is a no-op.

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
| `SERVICE` | Manage a service unit. Supports systemd, OpenRC, runit, and s6. |
| `FILE` | Manage file content, ownership, and mode. Managed-block diffing for fragments inside a larger file. |
| `DIRECTORY` | Manage directory presence, ownership, and mode |
| `REBOOT` | Reboot the device |
| `SYNC` | Trigger an out-of-band reconciliation tick |

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
| `ENCRYPTION` | LUKS or GELI passphrase rotation with optional TPM enrolment |
| `WIFI` | Manage NetworkManager wireless profiles |

## Lifecycle

| Action | Purpose |
|---|---|
| `AGENT_UPDATE` | Self-update the agent binary. SHA-256 verified, swap-and-restart. |

Both `REBOOT` and `SYNC` ship as instant actions, signed over `(actionID, type, "{}")`. The agent verifies the signature before doing anything, so a compromised Valkey can't forge a fleet-wide reboot.

## Conventions

- Every action is idempotent unless the table above says otherwise. Re-dispatch produces the same end state.
- Every action emits an `ExecutionCreated` event on dispatch and either an `ExecutionCompleted` or `ExecutionFailed` event when it finishes. The events table is the audit log.
- `SHELL`, `SCRIPT_RUN`, and `FILE` actions can carry secret content. The audit redactor strips `script`, `detectionScript`, `content`, `customConfig`, `gpgKey`, and `presharedKey` from the visible trail.
- Privileged operations go through `sdk/go/sys/exec.Privileged()` rather than `os/exec` directly. That's where the sudo / doas decision happens.
- Maintenance windows apply per device group. An action assigned to a group with a window only runs during that window in the device's local timezone. See [Maintenance windows](/concepts/maintenance-windows).
