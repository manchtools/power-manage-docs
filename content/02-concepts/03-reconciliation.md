---
title: Reconciliation
---
# Reconciliation

The reconciliation tick is the agent's periodic loop. Every interval (default 30 minutes), the agent:

1. Asks the gateway for the current set of assignments that apply to it.
2. Compares each one against the device's actual state.
3. Applies any action that's drifted, in the order the action set dictates.
4. Reports the outcome of every action back as an execution event.

That loop is where the system's idempotency property lives. Re-running the same set of actions against a converged device is a no-op, so reconciling every half hour costs almost nothing in the steady state.

## What sets the interval

The agent default is 30 minutes (`defaultSyncInterval` in the agent's main package). Override it on the agent with the `--sync-interval` flag or in the agent config. Common tunings:

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

**Schedule.** A cron expression or fixed interval attached to the assignment. Independent of the reconciliation tick: the action runs at the scheduled time even on devices that just reconciled. The offline scheduler keeps schedules firing while the agent is disconnected.

**Instant.** Dispatched immediately over the agent's stream, bypassing the tick. `SYNC` and `REBOOT` work this way when dispatched from a device-detail page in the UI.

The three compose. An assignment can have a schedule (run at 03:00) inside a maintenance window (only on weekdays) and still get an instant `SYNC` if an operator wants to force it now.

## Maintenance windows and the tick

The tick keeps running inside a window and outside it. What changes is what the tick *does* with each assignment. Inside a window, all applicable assignments run. Outside, only window-exempt ones do (the rest queue until the window opens). See [Maintenance windows](/concepts/maintenance-windows).

## What happens when the agent is offline

The agent caches its current assignment set, schedules, and windows in a local store. While disconnected from the gateway it keeps reconciling against the cache. Actions that fired offline produce execution events that get queued locally and shipped to the control inbox when the agent reconnects.

If an operator changes an assignment while the agent is offline, the agent won't see it until the next gateway connection. The control server doesn't try to "push" a missed assignment; the agent pulls on its next tick after reconnect.

## Forcing an out-of-band tick

The `SYNC` action triggers a reconciliation immediately rather than waiting for the next interval. Useful when you've just made a change in the UI and want to see it land without waiting up to 30 minutes. See [SYNC](/action-reference/system/sync).
