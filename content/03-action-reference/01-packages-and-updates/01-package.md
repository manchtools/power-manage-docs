---
title: PACKAGE
---
# PACKAGE

Installs or removes a named package via the system package manager. The agent picks the right backend (`apt`, `dnf`, `pacman`, `zypper`) based on the device's distro and supports per-manager name overrides for cases where the same software ships under different names across packagers.

<!-- docref: begin src=agent:internal/executor/action_update.go#Executor.repairPackageManager:44159c9e -->
Before any operation, the agent self-heals the package manager: clears `apt` / `pacman` / `zypper` locks, recovers an interrupted `dpkg --configure -a`, remounts the filesystem if it's read-only, and repairs DNF history. You don't need to clean up after a failed install before retrying.
<!-- docref: end -->

## Parameters

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#PackageParams:b0220890 -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | no\* | — | Generic package name; used when no manager-specific override is set. Max 255 chars. |
| `version` | string | no | latest | Specific version to install (e.g. `1.2.3-1`). Max 128 chars. |
| `allow_downgrade` | bool | no | `false` | Allow downgrading if the installed version is higher than `version`. Setting `version` alone does **not** imply downgrade permission. |
| `pin` | bool | no | `false` | Pin the package to prevent upgrades. Uses `apt-mark hold`, `dnf versionlock`, an `IgnorePkg` entry in `/etc/pacman.conf`, or `zypper addlock`. |
| `apt_name` | string | no | — | Override for Debian/Ubuntu. |
| `dnf_name` | string | no | — | Override for Fedora/RHEL. |
| `pacman_name` | string | no | — | Override for Arch. |
| `zypper_name` | string | no | — | Override for openSUSE. |
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/action_package.go#Executor.executePackage:59345769,agent:internal/executor/action_package.go#Executor.getPackageNameForManager:56e215e3 -->
\* The web form requires at least one of `name`, `apt_name`, `dnf_name`, `pacman_name`, or `zypper_name`. The proto itself doesn't enforce it: an action that resolves to no name for the device's package manager is skipped as a success no-op (`skipped: no package name configured for this package manager`), not failed.

The agent runs the matching manager on the device. Unspecified managers are not touched.
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/action_package.go#Executor.ensurePackagePresent:aa5c223b,agent:internal/executor/action_package.go#Executor.checkPackageVersionAndPin:9585d74e -->
The agent checks whether the package is already installed before doing anything. If `version` is set, the installed version is compared exactly. If `pin` is set, the pin state is checked separately and converged even when the package is already installed. A converged device reports `changed=false` and the action becomes a no-op.
<!-- docref: end -->

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

<!-- docref: begin src=agent:internal/executor/action_package.go#Executor.getPackageNameForManager:56e215e3 -->
- The agent never falls back from a manager-specific name to the generic `name`. If you set `apt_name`, the apt path uses that and only that. The generic `name` is only consulted when no override exists for the device's own manager — so `apt_name: curl` alone still lets a dnf host fall back to `name` if you set it.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/action_package.go#Executor.checkPackageVersionAndPin:9585d74e -->
- `version` is exact-match. The agent doesn't try to interpret version constraints (`>=`, `~`). If you need a range, use the package manager's native syntax via `SHELL` instead.
<!-- docref: end -->
<!-- docref: begin src=sdk:pkg/apt.go#apt.Pin:0ea3323d,sdk:pkg/dnf.go#dnf.Pin:057e9e38,sdk:pkg/pacman.go#pacman.Pin:8c78a70f,sdk:pkg/zypper.go#zypper.Pin:34d9f3a2 -->
- Pinning holds the named package only. The package manager controls whether dependencies get pulled in regardless. Verify with the device's pin list (`apt-mark showhold`, `dnf versionlock list`) if it matters. A pin that fails to apply fails the action — you won't see "installed and pinned" when only the install happened.
<!-- docref: end -->
