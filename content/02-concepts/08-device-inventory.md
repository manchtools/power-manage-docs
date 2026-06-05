---
title: Device inventory
---
# Device inventory

The agent reports hardware, OS, and network facts about every device it runs on. Operators see the data on the device-detail page; the server stores it as a set of tables (one row per CPU, one per block device, etc.) and exposes them through Connect-RPC.

Inventory is **request-response, not streaming**. The control server asks the agent to refresh; the agent collects locally and ships the result back. There is no continuous background telemetry.

## What gets collected

A baseline collector lives in `sdk/go/sys/inventory/` and always runs. It gathers:

- `system_info` — hostname, kernel, CPU count, memory
- `os_version` — `/etc/os-release` fields
- `block_devices` — output of `lsblk -J`
- `interface_details` — output of `ip -j addr`

If [`osquery`](/concepts/osquery) is installed on the device, the agent layers it on top: osquery's richer versions of the same tables override the baseline, and additional tables (`usb_devices`, `pci_devices`, `memory_info`, `deb_packages`, `rpm_packages`, `python_packages`) are appended. A device without osquery still produces a useful inventory — just a smaller one.

## How a refresh happens

1. An operator clicks **Refresh inventory** on the device-detail page, or the server kicks off a periodic refresh.
2. The control server's `RefreshDeviceInventory` RPC enqueues an Asynq task on the device's per-device queue.
3. The gateway dequeues and sends a `RequestInventory` over the agent's stream.
4. The agent's handler runs the baseline collector, optionally augments with osquery, and sends back a `DeviceInventory` message carrying a list of `InventoryTable` entries.
5. The gateway proxies the result back to control via `InternalService`; control persists the tables and surfaces them via `GetDeviceInventory`.

Inventory is **not event-sourced** the same way action history is. The latest snapshot replaces the previous one. There's no audit trail of "what was on the device three weeks ago" — that's a deliberate scope choice; if you need point-in-time facts, wire a [`SCRIPT_RUN`](/action-reference/system/script-run) to dump and ship them.

## Privacy and surface area

- The agent never collects user files, home directories, or process command-lines.
- The collected facts are routine inventory — the same data a standard CMDB pulls.
- All transport is over the agent's mTLS stream. The web UI shows inventory only to operators with the relevant device-scoped permission.

## When to use

- "How many devices on kernel ≤ 5.15?" — query against the projected `system_info` table.
- "Which devices have a specific USB peripheral?" — osquery-enhanced inventory carries `usb_devices`.
- "Did the package I deployed actually land?" — refresh inventory after the action, look at the `*_packages` tables.

For anything more dynamic — process state, log content, current network connections — reach for [log collection](/concepts/log-collection) or an [osquery](/concepts/osquery) query instead. Inventory is a snapshot, not a probe.
