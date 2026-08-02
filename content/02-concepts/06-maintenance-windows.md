---
title: Maintenance windows
---
# Maintenance windows

<!-- docref: begin src=sdk:proto/powermanage/v1/common.proto#MaintenanceWindow:528399a5,agent:internal/scheduler/scheduler.go#Scheduler.runDue:b20ae0bb -->
A maintenance window is a set of weekly time ranges, attached to a device group, during which **scheduled** work for that group's devices is allowed to run. Outside the window, the agent defers due scheduled work and runs it when the window opens. A one-shot delivery — what any explicit dispatch compiles to — is the deliberate exception and runs regardless of the window.
<!-- docref: end -->

<!-- docref: begin src=sdk:proto/powermanage/v1/common.proto#MaintenanceWindowEntry:7c3003a6,sdk:maintenance/window.go#IsAllowed:99ea5428 -->
Windows are evaluated in the **device-local timezone**, not the operator's and not UTC. A "weeknights, 2 AM – 4 AM" window means 2 AM local on each device, so a fleet spread across timezones converges across its night. Ranges may cross midnight (`22:00-06:00` continues into the next day).
<!-- docref: end -->

## Why use them

Without windows, every assignment fires on its [reconciliation tick](/concepts/reconciliation) (default 30 minutes). That's fine for small idempotent actions. For things that hurt when they go wrong (package updates, kernel patches, services that restart on config change) you want them firing when nobody is on the box. Windows give you that without per-device scheduling.

## Defining a window

<!-- docref: begin src=sdk:proto/powermanage/v1/control.proto#ControlService.SetDeviceGroupMaintenanceWindow:4987b892 -->
Open a device group in the web UI, switch to **Maintenance**, and add a window. (RPC: `SetDeviceGroupMaintenanceWindow` on `ControlService`; user groups have a `SetUserGroupMaintenanceWindow` sibling.)
<!-- docref: end -->

| Field | Example |
|---|---|
| Days of week | `mon, tue, wed, thu, fri` |
| Allowed range | `02:00-04:00` |
| Timezone interpretation | `device-local` (the only mode) |

<!-- docref: begin src=sdk:maintenance/window.go#Union:283d2f52,server:internal/agentsync/service.go#unionMaintenanceWindows:f987da2f -->
A window can carry multiple schedule entries, and a device can sit in several groups that each carry a window. Entries and windows combine as **OR**: the control server resolves the union across every group that reaches the device, and the union opens execution. Outside the union, work queues.
<!-- docref: end -->

## How the agent enforces it

<!-- docref: begin src=sdk:proto/powermanage/v1/agent.proto#SyncState.maintenance_window:fd69fb07,agent:internal/scheduler/scheduler.go#Scheduler.dispatchAllowed:fcb93355,agent:internal/scheduler/scheduler.go#Scheduler.runDue:b20ae0bb -->
The resolved window union rides on every sync state — the agent never computes group membership itself. The scheduler's due-work loop checks the window against the device-local clock on each pass; when the window is closed it defers every due delivery except the one-shot ones and re-checks on the next pass (about once a minute), so deferred work starts within a minute of the window opening.
<!-- docref: end -->

<!-- docref: begin src=sdk:maintenance/window.go#IsAllowed:99ea5428,agent:internal/scheduler/scheduler.go#Scheduler.SetMaintenanceWindow:8a80f35f -->
There is no clock-skew tolerance: if the device's local time is wrong, windows misfire. The agent caches the window locally so it keeps working across disconnects — and the cache is **fail-closed**: if the persisted window can't be decoded, the agent defers scheduled work rather than running it unconstrained.
<!-- docref: end -->

## What the window does and does not gate

<!-- docref: begin src=agent:internal/scheduler/scheduler.go#Scheduler.runDue:b20ae0bb,server:internal/manifest/compiler.go#AsOneShot:4dcee40c,server:internal/dispatch/handlers.go#Handlers.DispatchInstantAction:df9720ed,server:internal/dispatch/handlers.go#Handlers.DispatchAssignedActions:e22e7c71,agent:internal/handler/handler.go#Handler.OnQuery:2e6b242b -->
The window gates the **scheduler**, and it gates it by delivery kind, not by action type. The scheduler checks the window once per pass and then skips only the due deliveries whose manifest is *not* marked one-shot. So:

- **Scheduled (assigned) work defers.** Anything the device runs off its own assignments — `AGENT_UPDATE`, package upgrades, compliance checks, ordinary `SHELL` reconciliation — waits for the window, including a `DispatchAssignedActions` re-run, which re-dispatches assignments on their authored schedules.
- **Explicit dispatches run immediately.** Every Dispatch RPC other than `DispatchAssignedActions` compiles a one-shot manifest, and one-shot deliveries are exempt: an operator asking for it "now" means now. That covers the instant `REBOOT` and `SYNC` actions and equally a dispatched action, inline action, ActionSet, Definition, multi-device, or group dispatch — including a dispatched `AGENT_UPDATE` or package upgrade.

Widening the window is therefore about the *assigned* layer. If you don't want an operator forcing expensive work mid-day, control it with RBAC on the dispatch permissions, not with the window.

What the window never touches is the interactive traffic the agent answers straight off its stream without going through the scheduler: remote terminal sessions, on-demand OSQuery and log queries, inventory requests, and LUKS key exchange.
<!-- docref: end -->

## Combining with reconciliation

Cheap idempotent work and expensive work usually want different cadences. Cheap actions (file content, user presence, sshd config) reconcile continuously, costing a few hundred milliseconds per tick on a converged device. Expensive actions (package upgrades, service restarts) belong in an assignment with a maintenance window so they run once per night, not every reconciliation tick.

That split keeps drift on the cheap layer tight without paying for the expensive layer all day.
