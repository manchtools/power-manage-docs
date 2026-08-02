---
title: SYNC
---
# SYNC

<!-- docref: begin src=agent:internal/scheduler/scheduler.go#Scheduler.executeManifest:c462e71c,agent:cmd/power-manage-agent/runtime.go#periodicSync:3db80acb,agent:cmd/power-manage-agent/runtime.go#syncStateFromControl:d8a54242 -->
Triggers an out-of-band [reconciliation tick](/concepts/reconciliation).
Control commits the delivery and offers it on the direct agent stream. When the
agent reaches the SYNC occurrence it pokes its own sync loop, which immediately
pulls state from control instead of waiting for the next tick: any deliveries
the device has not yet recorded are stored and acknowledged, and the resolved
maintenance window and sync interval are re-applied.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/scheduler/scheduler.go#Scheduler.RecordDelivery:921ce6b3,agent:internal/scheduler/scheduler.go#Scheduler.runDue:b20ae0bb,agent:internal/scheduler/scheduler.go#Scheduler.dispatchAllowed:fcb93355,server:internal/manifest/compiler.go#OneShotAction:84372c04 -->
`SYNC` is an **instant action**: recording the delivery wakes the agent's scheduler rather than leaving it for the next tick. It compiles to a one-shot manifest, so it is **exempt from the maintenance window** and runs even during a freeze, and it runs exactly once rather than being rescheduled. That exemption covers the `SYNC` occurrence itself, not what it pulls in: the assigned actions it fetches still respect their own schedules *and* the window.
<!-- docref: end -->

## Parameters

<!-- docref: begin src=server:internal/dispatch/handlers.go#Handlers.DispatchInstantAction:df9720ed -->
None. `DispatchInstantAction` takes only the target device, the instant-action type, and an optional future `run_at`; it mints the action itself with a fresh ULID, `PRESENT` desired state, and a fixed timeout (60 seconds for `SYNC`, 600 for `REBOOT`), then compiles it into a one-shot manifest. There is no parameter field to set.
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/scheduler/scheduler.go#Scheduler.executeManifest:c462e71c -->
None in the traditional sense. Triggering `SYNC` is itself the operation, and the actual work performed depends on the device's assignments at that moment. The scheduler handles the SYNC occurrence itself rather than dispatching it to an executor: it reports success with `changed=false` and `Sync triggered` as its output; the actions it pulls in report their own outcomes.
<!-- docref: end -->

## Example

From an operator's perspective, "Sync now" on the device-detail page in the web UI. From an assignment:

```yaml
type: SYNC
```

## Gotchas

<!-- docref: begin src=agent:internal/scheduler/scheduler.go#Scheduler.executeManifest:c462e71c -->
- A flood of `SYNC` to the same device coalesces. The trigger is a single-slot channel and the send is non-blocking: while a tick is already pending, further SYNC occurrences drop their signal silently — they still report success, and they fold into that one tick.
<!-- docref: end -->
<!-- docref: begin src=agent:cmd/power-manage-agent/main.go#defaultSyncInterval:2d5b57db,agent:cmd/power-manage-agent/runtime.go#syncStateFromControl:d8a54242 -->
- This is the action you reach for when an operator wants to see their change land *now* rather than within the next sync interval (default 30 minutes, overridable per device by control). It fetches state, it does not force a re-apply: a delivery the agent already holds is re-recorded as a no-op, so what actually runs is whatever was newly delivered plus whatever its own schedule has made due.
<!-- docref: end -->
