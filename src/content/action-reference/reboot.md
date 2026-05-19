# REBOOT

Reboots the device. Scheduled 5 minutes out, with a wall message broadcast to any logged-in users: *"System Reboot: This system will reboot in 5 minutes."*

`REBOOT` is an **instant action**. It dispatches over the agent's stream immediately rather than waiting for the next [reconciliation tick](/concepts/reconciliation). It also doesn't respect maintenance windows when dispatched as an instant action; if you want a windowed reboot, put it inside an action set.

## Parameters

None. The payload is canonical `{}`.

## Idempotency

None. The agent always schedules the reboot. If two `REBOOT` actions arrive in the same reconciliation cycle, the OS coalesces them (a second `shutdown +5` against an already-scheduled reboot is a no-op).

## Example

Reboot a device from the web UI: there's a "Reboot" button on the device-detail page that dispatches this action with no payload. From an action set:

```yaml
type: REBOOT
```

## Gotchas

- The 5-minute delay is fixed. Use `SHELL` with `shutdown -r +<n>` if you need a different timing.
- The wall message is hard-coded. Customisation lands with the upcoming notification subsystem.
- A reboot dispatched while the agent is offline runs as soon as the agent's offline scheduler ticks after reconnect. Set `expires_at` on the assignment if you don't want a stale reboot landing days later.
- The action's signature is verified before the agent acts, so a compromised gateway or Valkey can't trigger a fleet-wide reboot.
