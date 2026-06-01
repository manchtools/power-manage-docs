# Dynamic device groups

A dynamic group is a query, not a list. Membership recomputes whenever a device's inventory or labels change, plus on a periodic tick you configure per group.

## Query language

The grammar is intentionally small:

```
labels.environment equals "production" and labels.role equals "web"
```

Operators:

- `equals`, `notEquals`
- `contains`, `notContains`
- `startsWith`, `endsWith`
- `greaterThan`, `lessThan`, `greaterThanOrEquals`, `lessThanOrEquals`
- `in`, `notIn` for comma-separated value lists
- `exists`, `notExists` (unary, no value)

Fields:

- `labels.<key>` for device labels (the key match is case-insensitive)
- `device.os`, `device.kernel`, `device.hostname`, ... for inventory fields
- `device.group` for membership of other groups, so you can compose

Compose with `and`, `or`, `not`, and parentheses. An empty query matches every device.

## Examples

| Query | Members |
|---|---|
| `labels.environment equals "production"` | every production device |
| `device.os equals "linux" and labels.role in "web,api"` | Linux web and api hosts |
| `not labels.role equals "deprecated"` | everything not flagged for removal |
| (empty) | every registered device (what the **All Devices** seed group uses)|

{% callout type="info" title="All Devices" %}
A built-in dynamic group called "All Devices" is seeded on first boot. Its query is empty, so it matches every registered device. Use it as the default target for fleet-wide actions.
{% /callout %}

## When membership recomputes

- **Event-driven.** A label change or device-registered event re-evaluates the affected groups inside the projector, synchronously.
- **Periodic.** Each group has an optional `sync_interval_minutes` for a full re-evaluation. Use it for queries that hit inventory fields the agent reports every heartbeat.
- **Manual.** The `EvaluateDynamicGroup` RPC forces a re-evaluation on demand.
