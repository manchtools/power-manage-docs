---
title: REBOOT
---
# REBOOT

<!-- docref: begin src=agent:internal/executor/action_reboot.go#Executor.executeReboot:13cb60a5 -->
Reboots the device. Scheduled 5 minutes out (`shutdown -r +5`), with a best-effort desktop/wall notification to logged-in users: *"System Reboot: This system will reboot in 5 minutes. Please save your work."*
<!-- docref: end -->

`REBOOT` is an **instant action**. It dispatches over the agent's stream immediately rather than waiting for the next [reconciliation tick](/concepts/reconciliation). It also doesn't respect maintenance windows when dispatched as an instant action; if you want a windowed reboot, put it inside an action set.

## Parameters

<!-- docref: begin src=server:internal/api/action_dispatch.go#ActionHandler.DispatchInstantAction:0c9f64b1 -->
None. Instant actions are parameterless — the signed envelope carries no params, and the execution event records the canonical empty object `{}`.
<!-- docref: end -->

## Idempotency

None. The agent always schedules the reboot when the action arrives. Scheduling on top of an already-pending reboot is harmless — the device reboots once.

## Example

Reboot a device from the web UI: there's a "Reboot" button on the device-detail page that dispatches this action with no payload. From an action set:

```yaml
type: REBOOT
```

## Gotchas

<!-- docref: begin src=agent:internal/executor/action_reboot.go#Executor.executeReboot:13cb60a5,sdk:sys/reboot/reboot.go#rebooter.Schedule:2028bda5 -->
- The 5-minute delay is fixed, and the reboot machinery refuses anything under a 1-minute grace window by design. Use `SHELL` with `shutdown -r +<n>` if you need a different timing.
- The notification text is hard-coded today; there's no per-action message field.
<!-- docref: end -->
- A reboot dispatched while the agent is offline waits in the device's queue and is delivered as soon as the agent reconnects — instant actions aren't stored in the agent's offline scheduler. There's no TTL on the queued dispatch, so cancel a stale reboot by acting before the device reconnects.
<!-- docref: begin src=agent:internal/executor/executor.go#Executor.VerifyEnvelope:ea44180f,agent:internal/handler/handler.go#Handler.OnActionWithStreaming:06e9eebb -->
- The action's CA signature is verified over the exact envelope bytes — which bind the action type and target device — before the agent acts, so a compromised gateway or Valkey can't trigger a fleet-wide reboot or replay a captured envelope onto another device.
<!-- docref: end -->
