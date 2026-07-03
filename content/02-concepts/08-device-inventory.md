---
title: Device inventory
---
# Device inventory

The agent reports hardware, OS, and network facts about every device it runs on. Operators see the data on the device-detail page; the server stores it as a set of tables (one row per CPU, one per block device, etc.) and exposes them through Connect-RPC.

Inventory is **request-response, not streaming**. A refresh runs when the server asks for one, plus on the agent's own cadence (on connect and every 24 hours). The agent collects locally and ships the result back. There is no continuous background telemetry.

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

<!-- docref: begin src=sdk:client.go#InventoryHandler:2277d9b5 -->
The agent-initiated path (on connect + every 24 h) collects the same tables on its own schedule, with no server command involved.
<!-- docref: end -->

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
