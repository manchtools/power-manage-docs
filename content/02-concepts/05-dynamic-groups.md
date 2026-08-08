---
title: Dynamic device groups
---
# Dynamic device groups

A dynamic group is a query, not an authored member list. Relevant CRUD changes
mark affected groups due for evaluation in the same database transaction. A
bounded database-backed worker evaluates due rows; a periodic sweep recovers a
missed in-process wakeup.

## Query language

The grammar is intentionally small:

```
labels.environment equals "production" and labels.role equals "web"
```

Operators:

<!-- docref: begin src=server:internal/dynamicquery/ast.go:ff596b1b,server:internal/dynamicquery/parser.go#Parse:6cdbf956 -->
- `equals`, `notEquals`
- `contains`, `notContains`
- `startsWith`, `endsWith`
- `greaterThan`, `lessThan`, `greaterThanOrEquals`, `lessThanOrEquals`
- `in`, `notIn` for comma-separated value lists
- `exists`, `notExists` (unary, no value)
<!-- docref: end -->

Fields:

<!-- docref: begin src=server:internal/dynamicquery/eval.go#evalDeviceAtom:47fd0ba1 -->
- `labels.<key>` for device labels (the key match is case-insensitive)
- `device.os`, `device.kernel`, `device.hostname`, ... for inventory fields
- `device.group` for membership of other groups, so you can compose
<!-- docref: end -->

<!-- docref: begin src=server:internal/dynamicquery/parser.go#Parse:6cdbf956 -->
Compose with `and`, `or`, `not`, and parentheses. An empty query parses to an atom that always matches, so it selects every device.
<!-- docref: end -->

## Examples

| Query | Members |
|---|---|
| `labels.environment equals "production"` | every production device |
| `device.os equals "linux" and labels.role in "web,api"` | Linux web and api hosts |
| `not labels.role equals "deprecated"` | everything not flagged for removal |
| (empty) | every registered device |

{% callout type="info" title="Fleet-wide targeting" %}
Control seeds no device groups. If you want a standing fleet-wide target, create
a dynamic group yourself and leave its query empty — it then matches every
registered device, and new enrolments join it as they arrive.
{% /callout %}

## When membership recomputes

- **Change-triggered.** A label, inventory, membership, or registration
  mutation marks affected groups due in the same transaction.
- **Swept.** A periodic database scan catches due work even when an in-process
  signal was lost.
<!-- docref: begin src=sdk:proto/powermanage/v1/control.proto#ControlService.EvaluateDynamicGroup:9567a7bf -->
- **Manual.** The `EvaluateDynamicGroup` RPC forces a re-evaluation on demand.
<!-- docref: end -->

<!-- docref: begin src=server:internal/agentsync/service.go#Service.Sync:5e0653b5,sdk:proto/powermanage/v1/control.proto#DeviceGroup.sync_interval_minutes:2e65300f -->
A group's `sync_interval_minutes` field is **not** a group re-evaluation timer — it is an agent sync-cadence setting stored on the group record. The cadence control actually hands an agent is the device's own `sync_interval_minutes`, carried on each sync state; the group-level field is stored and editable but is not currently folded into that value.
<!-- docref: end -->
