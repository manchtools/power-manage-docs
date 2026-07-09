---
title: Reconciliation
---
# Reconciliation

<!-- docref: begin src=sdk:proto/pm/v1/agent.proto#AgentService.SyncActions:d16996a3,agent:internal/scheduler/scheduler.go#Scheduler.runDueActions:615f76e3 -->
The reconciliation tick is the agent's periodic loop. Every interval (default 30 minutes), the agent:

1. Asks the gateway for the current set of assignments that apply to it (the `SyncActions` RPC).
2. Compares each one against the device's actual state.
3. Applies any action that's drifted, in the order the action set dictates.
4. Reports the outcome of every action back as an execution event.
<!-- docref: end -->

That loop is where the system's idempotency property lives. Re-running the same set of actions against a converged device is a no-op, so reconciling every half hour costs almost nothing in the steady state.

## What sets the interval

<!-- docref: begin src=sdk:proto/pm/v1/control.proto#SetDeviceSyncIntervalRequest:4a3d9937,agent:cmd/power-manage-agent/main.go#defaultSyncInterval:2d5b57db,sdk:proto/pm/v1/agent.proto#SyncActionsResponse.sync_interval_minutes:f9b5478a -->
The agent's built-in default is 30 minutes (`defaultSyncInterval` in the agent's main package). The interval is a **server-side setting, not an agent flag**: set it per device (`SetDeviceSyncInterval`, `0` = default, max 24 h) or per device group — a device in several groups gets the smallest non-zero group interval. The agent receives the effective value with every sync response and re-times its loop on the fly.
<!-- docref: end -->

Common tunings:

| Use case | Suggested tick |
|---|---|
| Configuration drift on busy hosts | 5–10 min |
| Default | 30 min |
| Steady-state config that rarely changes | 1 h |
| Heavy reconciliations bound by maintenance windows | Leave at 30 min; let the window gate the work |

Faster ticks mean tighter drift detection at the cost of more agent CPU per device. On a converged device the cost is roughly "check a hash and decide nothing changed", so even 5-minute ticks are cheap.

## Reconciliation vs. scheduling vs. instant

Three different ways an action can run:

**Reconciliation tick.** The default. The agent's loop notices the assignment, runs the action, reports. No-op on converged devices.

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#ActionSchedule:2f9d3987,agent:internal/scheduler/scheduler.go#Scheduler.Start:ecd13b70 -->
**Schedule.** A cron expression or fixed interval attached to the assignment. Independent of the reconciliation tick: the action runs at the scheduled time even on devices that just reconciled. The offline scheduler keeps schedules firing while the agent is disconnected.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/handler/handler.go#Handler.OnActionWithStreaming:06e9eebb,agent:internal/executor/executor.go#IsInstantAction:401666e5 -->
**Instant.** Dispatched immediately over the agent's stream, bypassing the tick. `SYNC` and `REBOOT` work this way when dispatched from a device-detail page in the UI.
<!-- docref: end -->

The three compose. An assignment can have a schedule (run at 03:00) inside a maintenance window (only on weekdays) and still get an instant `SYNC` if an operator wants to force it now.

## Maintenance windows and the tick

<!-- docref: begin src=agent:internal/scheduler/scheduler.go#Scheduler.runDueActions:615f76e3 -->
The tick keeps running inside a window and outside it. What changes is what the tick *does*: inside the window, all due assignments run. Outside it, the scheduler defers **all** due work until the window opens — nothing scheduled is exempt. Only instant dispatches pushed over the stream (an operator's `SYNC` or `REBOOT`) bypass the scheduler and run immediately. See [Maintenance windows](/concepts/maintenance-windows).
<!-- docref: end -->

## What happens when the agent is offline

<!-- docref: begin src=agent:internal/scheduler/scheduler.go#Scheduler.SyncActions:6e603cc7,agent:internal/scheduler/scheduler.go#Scheduler.GetUnsyncedResults:c5aef9ab -->
The agent caches its current assignment set, schedules, and windows in a local store. While disconnected from the gateway it keeps reconciling against the cache. Actions that fired offline produce execution events that get queued locally and shipped to the control inbox when the agent reconnects.
<!-- docref: end -->

If an operator changes an assignment while the agent is offline, the agent won't see it until the next gateway connection. The control server doesn't try to "push" a missed assignment; the agent pulls on its next tick after reconnect.

## Forcing an out-of-band tick

<!-- docref: begin src=agent:internal/handler/handler.go#Handler.OnActionWithStreaming:06e9eebb -->
The `SYNC` action triggers a reconciliation immediately rather than waiting for the next interval. Useful when you've just made a change in the UI and want to see it land without waiting up to 30 minutes. See [SYNC](/action-reference/system/sync).
<!-- docref: end -->
