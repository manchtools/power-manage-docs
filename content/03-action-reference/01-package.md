---
title: PACKAGE
---
# PACKAGE

Installs or removes a named package via the system package manager. The agent picks the right backend (`apt`, `dnf`, `pacman`, `zypper`) based on the device's distro and supports per-manager name overrides for cases where the same software ships under different names across packagers.

Before any operation, the agent self-heals the package manager: clears `apt` / `pacman` / `zypper` locks, recovers an interrupted `dpkg --configure -a`, remounts the filesystem if it's read-only, and repairs DNF history. You don't need to clean up after a failed install before retrying.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | no\* | — | Generic package name; used when no manager-specific override is set. Max 255 chars. |
| `version` | string | no | latest | Specific version to install (e.g. `1.2.3-1`). Max 128 chars. |
| `allow_downgrade` | bool | no | `false` | Allow downgrading if the installed version is higher than `version`. |
| `pin` | bool | no | `false` | Pin the package to prevent upgrades. Uses `apt-mark hold`, `dnf versionlock`, `pacman -Sy --noupgrade`, or zypper's lock list. |
| `apt_name` | string | no | — | Override for Debian/Ubuntu. |
| `dnf_name` | string | no | — | Override for Fedora/RHEL. |
| `pacman_name` | string | no | — | Override for Arch. |
| `zypper_name` | string | no | — | Override for openSUSE. |

\* At least one of `name`, `apt_name`, `dnf_name`, `pacman_name`, or `zypper_name` must be set.

The agent runs the matching manager on the device. Unspecified managers are not touched.

## Idempotency

The agent checks whether the package is already installed before doing anything. If `version` is set, the installed version is compared exactly. If `pin` is set, the pin state is checked separately. A converged device reports `changed=false` and the action becomes a no-op.

## Examples

Install `curl` (latest) on production:

```yaml
type: PACKAGE
name: curl
desired_state: PRESENT
```

Pin nginx to a specific version on Ubuntu and Fedora with different package names:

```yaml
type: PACKAGE
apt_name: nginx-full
dnf_name: nginx
version: "1.24.0-1"
pin: true
desired_state: PRESENT
```

Remove `telnet`:

```yaml
type: PACKAGE
name: telnet
desired_state: ABSENT
```

## Gotchas

- The agent never falls back from a manager-specific name to the generic `name`. If you set `apt_name`, the apt path uses that and only that. The generic `name` is only consulted when no override matches.
- `version` is exact-match. The agent doesn't try to interpret version constraints (`>=`, `~`). If you need a range, use the package manager's native syntax via `SHELL` instead.
- Pinning is best-effort. The package manager controls whether dependencies get pulled in regardless. Verify with the device's pin list (`apt-mark showhold`, `dnf versionlock list`) if it matters.
