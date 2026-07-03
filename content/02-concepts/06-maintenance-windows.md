---
title: Maintenance windows
---
# Maintenance windows

<!-- docref: begin src=sdk:proto/pm/v1/common.proto#MaintenanceWindow:528399a5,agent:internal/scheduler/scheduler.go#Scheduler.runDueActions:615f76e3 -->
A maintenance window is a set of weekly time ranges, attached to a device group, during which scheduled work for that group's devices is allowed to run. Outside the window, the agent defers due work and runs it when the window opens.
<!-- docref: end -->

<!-- docref: begin src=sdk:proto/pm/v1/common.proto#MaintenanceWindowEntry:7c3003a6,sdk:maintenance/window.go#IsAllowed:8a918a14 -->
Windows are evaluated in the **device-local timezone**, not the operator's and not UTC. A "weeknights, 2 AM – 4 AM" window means 2 AM local on each device, so a fleet spread across timezones converges across its night. Ranges may cross midnight (`22:00-06:00` continues into the next day).
<!-- docref: end -->

## Why use them

Without windows, every assignment fires on its [reconciliation tick](/concepts/reconciliation) (default 30 minutes). That's fine for small idempotent actions. For things that hurt when they go wrong (package updates, kernel patches, services that restart on config change) you want them firing when nobody is on the box. Windows give you that without per-device scheduling.

## Defining a window

<!-- docref: begin src=sdk:proto/pm/v1/control.proto#ControlService.SetDeviceGroupMaintenanceWindow:4987b892 -->
Open a device group in the web UI, switch to **Maintenance**, and add a window. (RPC: `SetDeviceGroupMaintenanceWindow` on `ControlService`; user groups have a `SetUserGroupMaintenanceWindow` sibling.)
<!-- docref: end -->

| Field | Example |
|---|---|
| Days of week | `mon, tue, wed, thu, fri` |
| Allowed range | `02:00-04:00` |
| Timezone interpretation | `device-local` (the only mode) |

<!-- docref: begin src=sdk:maintenance/window.go#Union:be10448d,server:internal/api/maintenance_window.go#resolveMaintenanceWindowUnion:62428506 -->
A window can carry multiple schedule entries, and a device can sit in several groups that each carry a window. Entries and windows combine as **OR**: the control server resolves the union across every group that reaches the device, and the union opens execution. Outside the union, work queues.
<!-- docref: end -->

## How the agent enforces it

<!-- docref: begin src=sdk:proto/pm/v1/agent.proto#SyncActionsResponse.maintenance_window:2ba80c17,agent:internal/scheduler/scheduler.go#Scheduler.dispatchAllowed:c2a9b671 -->
The resolved window union rides on every sync response — the agent never computes group membership itself. The scheduler's due-action loop checks the window against the device-local clock on each pass; when the window is closed it defers everything due and re-checks on the next pass (about once a minute), so work starts within a minute of the window opening.
<!-- docref: end -->

<!-- docref: begin src=sdk:maintenance/window.go#IsAllowed:8a918a14,agent:internal/scheduler/scheduler.go#Scheduler.SetMaintenanceWindow:3cc8813a -->
There is no clock-skew tolerance: if the device's local time is wrong, windows misfire. The agent caches the window locally so it keeps working across disconnects — and the cache is **fail-closed**: if the persisted window can't be decoded, the agent defers scheduled work rather than running it unconstrained.
<!-- docref: end -->

## What ignores the window

<!-- docref: begin src=agent:internal/scheduler/scheduler.go#Scheduler.runDueActions:615f76e3,agent:internal/executor/executor.go#IsInstantAction:401666e5 -->
The window gates the **scheduler** — everything it runs, including `AGENT_UPDATE` and compliance checks, waits for the window. What doesn't wait is anything pushed directly over the agent's stream: an operator's instant `SYNC` ("talk to me now") or instant `REBOOT` executes immediately, bypassing the scheduler entirely. That matches the intent — an admin hitting "reboot now" expects a reboot now.
<!-- docref: end -->

## Combining with reconciliation

Cheap idempotent work and expensive work usually want different cadences. Cheap actions (file content, user presence, sshd config) reconcile continuously, costing a few hundred milliseconds per tick on a converged device. Expensive actions (package upgrades, service restarts) belong in an assignment with a maintenance window so they run once per night, not every reconciliation tick.

That split keeps drift on the cheap layer tight without paying for the expensive layer all day.
