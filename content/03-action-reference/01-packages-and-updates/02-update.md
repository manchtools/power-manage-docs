---
title: UPDATE
---
# UPDATE

<!-- docref: begin src=sdk:pkg/apt.go#apt.UpgradeAll:74794429,sdk:pkg/dnf.go#dnf.UpgradeAll:80acda9d,sdk:pkg/pacman.go#pacman.UpgradeAll:ac396816,sdk:pkg/zypper.go#zypper.UpgradeAll:8fd403c1 -->
Runs the device's package manager in upgrade mode. Equivalent to `apt dist-upgrade`, `dnf upgrade`, `pacman -Syu`, or `zypper dist-upgrade` depending on the distro (the index refresh runs first as a separate step).
<!-- docref: end -->

`UPDATE` is the maintenance-window action: it can be slow, can pull large downloads, and may require a reboot. Run it on a schedule with a maintenance window rather than every [reconciliation tick](/concepts/reconciliation).

## Parameters

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#UpdateParams:5efdd421 -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `security_only` | bool | no | `false` | Install only security updates. Supported on apt (`unattended-upgrade`), dnf (`--security`), and zypper (`patch --category security`). On pacman it stays **fail-closed** — nothing is upgraded and the action reports the **Not applicable** status rather than silently widening to a full upgrade. |
| `autoremove` | bool | no | `false` | Remove orphaned dependencies after the upgrade. |
| `reboot_if_required` | bool | no | `false` | Schedule a reboot if this run newly flagged one as needed. |
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/action_update.go#Executor.executeUpdate:6978695a,sdk:pkg/apt.go#apt.HasUpdates:a3c2627c,sdk:pkg/dnf.go#dnf.HasUpdates:8ebfaa5b,sdk:pkg/pacman.go#pacman.HasUpdates:c18e859c,sdk:pkg/zypper.go#zypper.HasUpdates:0cf38046 -->
Before upgrading, the agent asks the package manager whether anything is pending: `dnf check-update` (exit 100), `pacman -Qu`, `zypper list-updates`, and a simulated `apt-get -s upgrade` (counting `Inst ` lines rather than parsing localised text, so non-English locales work). The index refresh and upgrade still run either way — the probe drives the `changed` flag, so a device with nothing pending reports `changed=false` instead of a state change.
<!-- docref: end -->

## Example

Nightly security upgrades plus autoremove, reboot if the kernel changed:

```yaml
type: UPDATE
security_only: true
autoremove: true
reboot_if_required: true
```

## Gotchas

<!-- docref: begin src=sdk:pkg/pkg.go#ErrSecurityOnlyUnsupported:eb93571f,sdk:pkg/apt.go#apt.securityUpgrade:101052c8 -->
- `security_only` on Debian / Ubuntu runs `unattended-upgrade`, which must be installed — if it's absent the action stays fail-closed (no full upgrade) and reports the **Not applicable** status with the reason in the result. Arch (pacman) has no security/non-security distinction and reports the same way.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/action_update.go#Executor.scheduleRebootAfterUpdate:57122116 -->
- `reboot_if_required` schedules the reboot 1 minute out, not immediate, and notifies signed-in users ("A system update requires a reboot. This system will reboot in 1 minute."). It only fires when *this* run created the reboot requirement — a device that already needed a reboot before the upgrade won't be rebooted by it. A reboot that fails to schedule fails the action.
<!-- docref: end -->
- A failing upgrade does not roll back. The package manager's transaction semantics apply; on Fedora that's atomic per transaction, on Debian it's not.
<!-- docref: begin src=agent:internal/scheduler/scheduler.go#Scheduler.dispatchAllowed:fcb93355,agent:internal/scheduler/scheduler.go#Scheduler.runDue:b20ae0bb -->
- Run inside a maintenance window. A daily upgrade that comes due from an *assignment* outside the window queues until the window opens. Dispatching an `UPDATE` explicitly does not queue — a one-shot delivery is exempt from the window and starts right away, so use dispatch only when you actually mean "upgrade this box now".
<!-- docref: end -->
