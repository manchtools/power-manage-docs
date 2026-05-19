# UPDATE

Runs the device's package manager in upgrade mode. Equivalent to `apt-get update && apt-get upgrade`, `dnf upgrade`, `pacman -Syu`, or `zypper update` depending on the distro.

`UPDATE` is the maintenance-window action: it can be slow, can pull large downloads, and may require a reboot. Run it on a schedule with a maintenance window rather than every reconciliation tick.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `security_only` | bool | no | `false` | Install only security updates if the backend supports it. Falls back to full upgrade where unsupported. |
| `autoremove` | bool | no | `false` | Remove orphaned dependencies after the upgrade. |
| `reboot_if_required` | bool | no | `false` | Schedule a reboot if the upgrade flagged one as needed (kernel, systemd, glibc). |

## Idempotency

Before upgrading, the agent asks the package manager whether anything is pending. `dnf check-update`, `pacman -Qu`, and a simulated `apt-get -s upgrade` are all checked by exit code or parsed line count. If nothing's pending, `changed=false` and the action exits without invoking the manager.

The agent counts `Inst ` lines from `apt-get -s` rather than parsing localised text, so non-English locales work.

## Example

Nightly security upgrades plus autoremove, reboot if the kernel changed:

```yaml
type: UPDATE
security_only: true
autoremove: true
reboot_if_required: true
```

## Gotchas

- `security_only` is only meaningful on Debian / Ubuntu (via `unattended-upgrades` channels) and RHEL family (via `dnf --security`). Arch and openSUSE silently treat it as a full upgrade.
- `reboot_if_required` schedules the reboot 5 minutes out, not immediate. See `REBOOT`.
- A failing upgrade does not roll back. The package manager's transaction semantics apply; on Fedora that's atomic per transaction, on Debian it's not.
- Run inside a maintenance window. A daily upgrade dispatched outside one will queue until the window opens.
