---
title: REBOOT
---
# REBOOT

<!-- docref: begin src=agent:internal/executor/action_reboot.go#Executor.executeReboot:caf2c789 -->
Reboots the device. Scheduled 5 minutes out (`shutdown -r +5`), with a best-effort desktop/wall notification to logged-in users: *"System Reboot: This system will reboot in 5 minutes. Please save your work."*
<!-- docref: end -->

<!-- docref: begin src=agent:internal/scheduler/scheduler.go#Scheduler.RecordDelivery:921ce6b3,agent:internal/scheduler/scheduler.go#Scheduler.runDue:3c5302a2,agent:internal/scheduler/scheduler.go#Scheduler.dispatchAllowed:fcb93355 -->
`REBOOT` is an **instant action**: control offers it on the agent's direct stream right away, and recording the delivery wakes the agent's scheduler instead of leaving it for the next [reconciliation tick](/concepts/reconciliation). It is *not* exempt from maintenance windows — the scheduler gates every delivery on the device's resolved window before it runs anything, so a reboot dispatched during a freeze waits for the window to open. With no window configured, nothing is gated and it runs at once.
<!-- docref: end -->

## Parameters

<!-- docref: begin src=server:internal/dispatch/handlers.go#Handlers.DispatchInstantAction:df9720ed -->
None. `DispatchInstantAction` takes only the target device, the instant-action type, and an optional future `run_at`; it mints the action itself with a fresh ULID, `PRESENT` desired state, and a fixed timeout (600 seconds for `REBOOT`, 60 for `SYNC`), then compiles it into a one-shot manifest. There is no parameter field to set.
<!-- docref: end -->

## Idempotency

None. The agent always schedules the reboot when the action arrives. Scheduling on top of an already-pending reboot is harmless — the device reboots once.

## Example

Reboot a device from the web UI: there's a "Reboot" button on the device-detail page that dispatches this action with no payload. From an action set:

```yaml
type: REBOOT
```

## Gotchas

<!-- docref: begin src=agent:internal/executor/action_reboot.go#Executor.executeReboot:caf2c789,sdk:sys/reboot/reboot.go#rebooter.Schedule:2028bda5 -->
- The 5-minute delay is fixed, and the reboot machinery refuses anything under a 1-minute grace window by design. Use `SHELL` with `shutdown -r +<n>` if you need a different timing.
- The notification text is hard-coded today; there's no per-action message field.
<!-- docref: end -->
<!-- docref: begin src=server:internal/agentsync/service.go#Service.Sync:bdb44301,agent:internal/scheduler/scheduler.go#Scheduler.RecordDelivery:921ce6b3 -->
- A reboot dispatched while the agent is offline stays a pending delivery on control and is handed over on the agent's next sync, which records it durably and wakes the scheduler. There's no TTL on the queued dispatch, so cancel a stale reboot by acting before the device reconnects.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/handler/handler.go#Handler.OnManifestDelivery:11a78405,agent:internal/scheduler/scheduler.go#Scheduler.executeManifest:c462e71c,agent:internal/scheduler/scheduler.go#Scheduler.recoverInterruptedOccurrences:27fae712 -->
- The reboot arrives on the authenticated direct mTLS stream — there is no
  application-frame signature to verify; mTLS is the transport's authenticity.
  The agent durably records the delivery before the receipt is emitted, marks
  the reboot occurrence STARTED against the current kernel boot ID, and only
  reports success once a later run observes a *new* boot ID. A crash in between
  is recovered as an explicit outcome rather than a silent repeat.
<!-- docref: end -->
