# Action reference

The agent supports seventeen action types. Most carry a desired state (`PRESENT` or `ABSENT`) so re-dispatching against a converged device is a no-op.

## Package managers

| Action | Backends | Purpose |
|---|---|---|
| `PACKAGE` | apt, dnf, pacman, zypper | Install or remove a named package |
| `UPDATE` | apt, dnf, pacman, zypper | Run `update && upgrade` (or the distro equivalent) |
| `DEB` | dpkg | Install a `.deb` from a URL with SHA-256 verification |
| `RPM` | rpm | Install an `.rpm` from a URL with SHA-256 verification |
| `APP_IMAGE` | AppImage | Install a portable AppImage with system integration |
| `FLATPAK` | flatpak | Install a Flatpak from the configured remote |
| `REPOSITORY` | apt, dnf, pacman | Add or remove a package repository with GPG key validation |

## System state

| Action | Purpose |
|---|---|
| `SHELL` | Run a shell script. An optional detection script gives you idempotency. |
| `FILE` | Manage file content, ownership, and mode. Supports managed-block diffing inside larger files. |
| `SERVICE` (`SYSTEMD`) | Install, enable, and start a systemd unit (or stop, disable, and remove it) |
| `USER` | Create, modify, or delete a system user with linux_uid, home, shell, and groups |
| `GROUP` | Create or delete a system group |
| `SSH` | Manage a user's `authorized_keys` |
| `SSHD` | Manage `sshd_config` through priority-ordered Override fragments |
| `ADMIN_POLICY` | Sudoers or doas.conf fragments built from an `access_level` template |

## Secrets and cryptography

| Action | Purpose |
|---|---|
| `LPS` | Local Password Solution. Rotates local-account passwords on a schedule, stores ciphertext at rest. |
| `ENCRYPTION` | LUKS passphrase rotation with optional TPM enrolment |

## Instant actions

| Action | Purpose |
|---|---|
| `REBOOT` | Reboot the device |
| `SYNC` | Trigger an out-of-band reconciliation tick |

Both instant actions are CA-signed over `(actionID, type, "{}")`. The agent verifies the signature before doing anything, so a compromised Valkey can't forge a "reboot all devices" task.

## Conventions

- Every action is idempotent: re-dispatch produces the same end state.
- Every action emits an `ExecutionCreated` event on dispatch and an `ExecutionCompleted` or `ExecutionFailed` event when it finishes.
- `SHELL` and `FILE` actions can carry secret content. The audit redactor strips `script`, `detectionScript`, `content`, `customConfig`, `gpgKey`, and `presharedKey` from the visible trail.
- Privileged operations go through `sdk/go/sys/exec.Privileged()` rather than `os/exec` directly. That's where the sudo / doas choice happens.
