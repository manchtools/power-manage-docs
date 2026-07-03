---
title: Dynamic device groups
---
# Dynamic device groups

<!-- docref: begin src=server:internal/projectors/device_listener.go#enqueueDynamicDeviceGroupsForDevice:18e1abc5,server:cmd/control/periodic.go#startDynamicGroupWorker:0805db00 -->
A dynamic group is a query, not a list. Label changes and newly registered devices queue the groups for re-evaluation, and a server-side worker recomputes membership on its evaluation interval — so queries over slower-moving inventory fields converge on the periodic pass.
<!-- docref: end -->

## Query language

The grammar is intentionally small:

```
labels.environment equals "production" and labels.role equals "web"
```

Operators:

<!-- docref: begin src=server:internal/dynamicquery/ast.go:fddf4b09,server:internal/dynamicquery/parser.go#Parse:6cdbf956 -->
- `equals`, `notEquals`
- `contains`, `notContains`
- `startsWith`, `endsWith`
- `greaterThan`, `lessThan`, `greaterThanOrEquals`, `lessThanOrEquals`
- `in`, `notIn` for comma-separated value lists
- `exists`, `notExists` (unary, no value)
<!-- docref: end -->

Fields:

<!-- docref: begin src=server:internal/dynamicquery/eval.go#evalDeviceAtom:45abf0a5 -->
- `labels.<key>` for device labels (the key match is case-insensitive)
- `device.os`, `device.kernel`, `device.hostname`, ... for inventory fields
- `device.group` for membership of other groups, so you can compose
<!-- docref: end -->

<!-- docref: begin src=server:internal/dynamicquery/parser.go#Parse:6cdbf956,server:cmd/control/setup.go#bootstrapAllDevicesGroup:04b9912a -->
Compose with `and`, `or`, `not`, and parentheses. An empty query matches every device.
<!-- docref: end -->

## Examples

| Query | Members |
|---|---|
| `labels.environment equals "production"` | every production device |
| `device.os equals "linux" and labels.role in "web,api"` | Linux web and api hosts |
| `not labels.role equals "deprecated"` | everything not flagged for removal |
| (empty) | every registered device (what the **All Devices** seed group uses)|

{% callout type="info" title="All Devices" %}
<!-- docref: begin src=server:cmd/control/setup.go#bootstrapAllDevicesGroup:04b9912a -->
A built-in dynamic group called "All Devices" is seeded on first boot. Its query is empty, so it matches every registered device. Use it as the default target for fleet-wide actions.
<!-- docref: end -->
{% /callout %}

## When membership recomputes

<!-- docref: begin src=server:internal/projectors/device_listener.go#enqueueDynamicDeviceGroupsForDevice:18e1abc5,server:cmd/control/periodic.go#startDynamicGroupWorker:0805db00,server:cmd/control/flags.go#clampDurations:0b177e87 -->
- **Event-queued.** A label change or device registration enqueues the affected dynamic groups for re-evaluation inside the projector transaction. The queue is drained by a server worker on the `DYNAMIC_GROUP_EVAL_INTERVAL` cadence (default `1h`, clamped to 30m–8h), with a full re-evaluation every 24h as a safety net.
<!-- docref: end -->
<!-- docref: begin src=sdk:proto/pm/v1/control.proto#ControlService.EvaluateDynamicGroup:9567a7bf -->
- **Manual.** The `EvaluateDynamicGroup` RPC forces a re-evaluation on demand.
<!-- docref: end -->

<!-- docref: begin src=server:internal/store/queries/devices.sql:13a691e6,sdk:proto/pm/v1/control.proto#DeviceGroup.sync_interval_minutes:2e65300f -->
A group's `sync_interval_minutes` field is **not** a group re-evaluation timer — it sets the agent sync cadence for the group's member devices (a device-level override wins; otherwise the smallest non-zero interval across the device's groups applies).
<!-- docref: end -->
