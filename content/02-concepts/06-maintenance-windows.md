---
title: Maintenance windows
---
# Maintenance windows

A maintenance window is a time range, attached to a device group, during which actions assigned to that group are allowed to run. Outside the window, the agent queues the dispatch and runs it when the window opens.

Windows are evaluated in the **device-local timezone**, not the operator's and not UTC. A "weeknights, 2 AM – 4 AM" window means 2 AM local on each device, so a fleet spread across timezones converges across its night.

## Why use them

Without windows, every assignment fires on its [reconciliation tick](/concepts/reconciliation) (default 30 minutes). That's fine for small idempotent actions. For things that hurt when they go wrong (package updates, kernel patches, services that restart on config change) you want them firing when nobody is on the box. Windows give you that without per-device scheduling.

## Defining a window

Open a device group in the web UI, switch to **Maintenance**, and add a window. (RPC: `SetDeviceGroupMaintenanceWindow` on `ControlService`.)

| Field | Example |
|---|---|
| Days of week | `Mon, Tue, Wed, Thu, Fri` |
| Start time | `02:00` |
| End time | `04:00` |
| Timezone interpretation | `device-local` (the only mode) |

You can have multiple windows on the same group. The union opens execution; outside the union, dispatches queue.

## How the agent enforces it

When the gateway dispatches an assignment, the payload includes the action *and* the windows that apply (the group's plus any inherited from parent groups). The agent's `runDueActions()` loop checks the windows against the device-local clock and either runs the action or schedules a re-check at the next window edge.

There is no clock-skew tolerance: if the device's local time is wrong, windows misfire. The agent's offline scheduler caches windows so they keep working across disconnects.

## What ignores the window

Some actions don't wait. `SYNC` runs immediately because it's a "talk to me now" trigger, not a state change. `REBOOT` dispatched as an instant action runs immediately; dispatched inside a scheduled action set it respects the window like everything else. `AGENT_UPDATE` runs as soon as a signed binary is available, since self-update is treated as critical-path security work.

Compliance evaluation runs continuously regardless of windows. The remediation action that compliance optionally triggers respects the window. The evaluation itself doesn't.

## Combining with reconciliation

Cheap idempotent work and expensive work usually want different cadences. Cheap actions (file content, user presence, sshd config) reconcile continuously, costing a few hundred milliseconds per tick on a converged device. Expensive actions (package upgrades, service restarts) belong in an assignment with a maintenance window so they run once per night, not every reconciliation tick.

That split keeps drift on the cheap layer tight without paying for the expensive layer all day.
