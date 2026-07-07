---
title: Device inventory
---
# Device inventory

The agent reports hardware, OS, and network facts about every device it runs on. Operators see the data on the device-detail page; the server stores it as a set of tables (one row per CPU, one per block device, etc.) and exposes them through Connect-RPC.

Inventory is **request-response, not streaming**, and always **server-initiated**: a refresh runs when an operator asks for one, or when the server-side scheduler notices a device's inventory is older than its configured interval. The agent collects locally and ships the result back — it has no timer of its own, and there is no continuous background telemetry.

## What gets collected

<!-- docref: begin src=sdk:sys/inventory/inventory.go:ee808315,agent:internal/handler/handler.go#Handler.collectBaselineInventory:848206bf -->
A baseline collector lives in the SDK's `sys/inventory` package and always runs. It gathers:

- `system_info` + `kernel_info` — hostname, CPU, memory, kernel version
- `os_version` — `/etc/os-release` fields
- `block_devices` — output of `lsblk --json`
- `interface_details` — output of `ip -j addr`
<!-- docref: end -->

<!-- docref: begin src=agent:internal/handler/handler.go#inventoryCoreTables:4de81c39,agent:internal/handler/handler.go#inventoryPackageTables:4de81c39,agent:internal/handler/handler.go#Handler.supplementWithOsquery:a9c57039 -->
If [`osquery`](/concepts/osquery) is installed on the device, the agent layers it on top: osquery's richer versions of the same tables override the baseline, and additional tables (`interface_addresses`, `usb_devices`, `pci_devices`, `memory_info`, `deb_packages`, `rpm_packages`, `python_packages`) are appended. The table set is a fixed, hardcoded allowlist — an inventory request can't make the agent query arbitrary osquery tables. A device without osquery still produces a useful inventory — just a smaller one.
<!-- docref: end -->

## How a refresh happens

<!-- docref: begin src=sdk:proto/pm/v1/control.proto#ControlService.RefreshDeviceInventory:350743b3,sdk:proto/pm/v1/agent.proto#RequestInventory:2f88fbd5,agent:internal/handler/handler.go#Handler.OnRequestInventory:398d6189,sdk:proto/pm/v1/agent.proto#DeviceInventory:c6dad42e,sdk:proto/pm/v1/control.proto#ControlService.GetDeviceInventory:9c68d985 -->
1. An operator clicks **Refresh inventory** on the device-detail page — the control server's `RefreshDeviceInventory` RPC enqueues an Asynq task on the device's per-device queue.
2. The gateway dequeues and sends a `RequestInventory` over the agent's stream.
3. The agent verifies the request's CA signature (fail-closed — a compromised gateway can't forge it), runs the baseline collector, optionally augments with osquery, and sends back a `DeviceInventory` message carrying a list of `InventoryTable` entries.
4. The gateway proxies the result back to control via `InternalService`; control persists the tables and surfaces them via `GetDeviceInventory`.
<!-- docref: end -->

## Collection cadence

<!-- docref: begin src=server:internal/inventorysched/inventorysched.go#Tick:b1c40c96,server:internal/inventorysched/inventorysched.go#DefaultIntervalMinutes:b1c40c96 -->
Periodic collection is scheduled **by the server**, not the agent. Every 15 minutes the control server checks for connected devices whose inventory is older than their resolved interval and sends each one a signed inventory request over the exact same path as a manual refresh. The default interval is 24 hours.
<!-- docref: end -->

<!-- docref: begin src=sdk:proto/pm/v1/control.proto#SetDeviceInventoryIntervalRequest:55d9b12b,sdk:proto/pm/v1/control.proto#SetDeviceGroupInventoryIntervalRequest:24594347 -->
The interval is policy you set per device or per device group (`SetDeviceInventoryInterval` / `SetDeviceGroupInventoryInterval`, 2 h – 7 d): a device-level override wins; otherwise the smallest interval across the device's groups applies; otherwise the 24 h default. `0` means "inherit". Changes are event-sourced and audit-visible like every other setting.
<!-- docref: end -->

<!-- docref: begin src=server:internal/inventorysched/inventorysched.go#Overdue:4842b820,sdk:proto/pm/v1/control.proto#Device.inventory_overdue:47df467c -->
The device list and detail views show `last_inventory_at` and an **inventory overdue** badge. Overdue trips only when inventory age exceeds the interval *plus* a grace period (one hour or 25 % of the interval, whichever is larger) — under normal operation the scheduler re-collects as soon as inventory is due, so the badge means collection is *failing* (device offline, agent broken), not merely "due". It's computed from server-held policy, so it stays meaningful while a device is offline.
<!-- docref: end -->

Change-frozen environments that must not run osquery on a cadence can disable the scheduler with `CONTROL_INVENTORY_SCHEDULER_ENABLED=false` — manual refresh and the overdue computation keep working; freshness simply won't self-heal.

<!-- docref: begin src=server:internal/store/queries/inventory.sql:d2d9ad07 -->
Inventory is **not event-sourced** the same way action history is. The latest snapshot replaces the previous one per table. There's no audit trail of "what was on the device three weeks ago" — that's a deliberate scope choice; if you need point-in-time facts, wire a [`SCRIPT_RUN`](/action-reference/system/script-run) to dump and ship them.
<!-- docref: end -->

## Privacy and surface area

- The agent never collects user files, home directories, or process command-lines.
- The collected facts are routine inventory — the same data a standard CMDB pulls.
- All transport is over the agent's mTLS stream. The web UI shows inventory only to operators with the relevant device-scoped permission.

## When to use

- "How many devices on kernel ≤ 5.15?" — query against the projected `kernel_info` table.
- "Which devices have a specific USB peripheral?" — osquery-enhanced inventory carries `usb_devices`.
- "Did the package I deployed actually land?" — refresh inventory after the action, look at the `*_packages` tables.

For anything more dynamic — process state, log content, current network connections — reach for [log collection](/concepts/log-collection) or an [osquery](/concepts/osquery) query instead. Inventory is a snapshot, not a probe.
