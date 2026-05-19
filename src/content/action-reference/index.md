# Action reference

The agent supports seventeen action types. Each action carries a desired state (`PRESENT` or `ABSENT` where it makes sense) so re-dispatching the same action against a converged device is a no-op.

## Package managers

| Action | Backends | Purpose |
|---|---|---|
| `PACKAGE` | apt / dnf / pacman / zypper | Install or remove a named package via the system package manager |
| `UPDATE` | apt / dnf / pacman / zypper | Run `update && upgrade` (or distro equivalent) |
| `DEB` | dpkg | Install a `.deb` from a URL with SHA-256 verification |
| `RPM` | rpm | Install a `.rpm` from a URL with SHA-256 verification |
| `APP_IMAGE` | AppImage | Install a portable AppImage binary with system integration |
| `FLATPAK` | flatpak | Install a Flatpak from the configured remote |
| `REPOSITORY` | apt / dnf / pacman | Add or remove a package repository with GPG key validation |

## System state

| Action | Purpose |
|---|---|
| `SHELL` | Run a shell script. Supports an optional detection script for idempotency. |
| `FILE` | Manage file content + ownership + mode. Supports managed-block diffing inside larger files. |
| `SERVICE` (`SYSTEMD`) | Install + enable + start (or stop + disable + remove) a systemd unit |
| `USER` | Create / modify / delete a system user with linux_uid, home, shell, groups |
| `GROUP` | Create / delete a system group |
| `SSH` | Manage a user's `authorized_keys` |
| `SSHD` | Manage `sshd_config` with priority-ordered Override fragments |
| `ADMIN_POLICY` | Sudoers / doas.conf fragments with an `access_level` template |

## Secrets + cryptography

| Action | Purpose |
|---|---|
| `LPS` | Local Password Solution — rotate local-account passwords on a schedule, store ciphertext at rest |
| `ENCRYPTION` | LUKS passphrase rotation with optional TPM enrolment |

## Instant actions

| Action | Purpose |
|---|---|
| `REBOOT` | Reboot the device |
| `SYNC` | Trigger an out-of-band reconciliation tick |

Both instant actions carry a CA-signature over `(actionID, type, "{}")` — the agent verifies before executing, so a compromised Valkey can't forge a "reboot all devices" task.

## Conventions

- Every action has an `idempotent` contract — re-dispatch produces the same end state.
- Every action emits an `ExecutionCreated` event on dispatch and an `ExecutionCompleted` (or `ExecutionFailed`) event on completion.
- `SHELL` and `FILE` actions can carry secret content. The audit log redactor scrubs `script`, `detectionScript`, `content`, `customConfig`, `gpgKey`, and `presharedKey` from the visible audit trail.
- Every action that touches privileged operations goes through `sdk/go/sys/exec.Privileged()` rather than calling `os/exec` directly — that's how sudo/doas selection happens transparently.
