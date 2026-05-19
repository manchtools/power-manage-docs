# Dynamic device groups

A dynamic device group is defined by a query rather than an explicit member list. Membership is re-evaluated whenever a device's inventory or labels change, plus on a periodic tick the operator can configure per-group.

## Query language

The expression grammar is small on purpose:

```
labels.environment equals "production" and labels.role equals "web"
```

Operators:

- `equals`, `notEquals`
- `contains`, `notContains`
- `startsWith`, `endsWith`
- `greaterThan`, `lessThan`, `greaterThanOrEquals`, `lessThanOrEquals`
- `in`, `notIn` — comma-separated value list
- `exists`, `notExists` — unary, no value

Fields:

- `labels.<key>` — device labels (case-insensitive on the key)
- `device.os`, `device.kernel`, `device.hostname`, … — inventory fields
- `device.group` — name(s) of other groups this device is in (for composition)

Boolean composition with `and`, `or`, `not`, and parentheses. Empty query matches every device.

## Examples

| Query | Members |
|---|---|
| `labels.environment equals "production"` | every production device |
| `device.os equals "linux" and labels.role in "web,api"` | Linux web + api hosts |
| `not labels.role equals "deprecated"` | everything not flagged for removal |
| (empty) | every registered device (this is what the **All Devices** seed group uses) |

{% callout type="info" title="All Devices" %}
A built-in dynamic group named "All Devices" is seeded on first boot. Its query is empty — so it matches every registered device. Use it as the default assignment target for organisation-wide actions.
{% /callout %}

## Evaluation cadence

- **Event-driven** — a label change or device-registered event re-evaluates the affected groups synchronously inside the projector.
- **Periodic** — each group has an optional `sync_interval_minutes` for full re-evaluation. Useful for queries against inventory fields the agent reports on every heartbeat.
- **Operator-triggered** — the `EvaluateDynamicGroup` RPC forces a re-evaluation.
