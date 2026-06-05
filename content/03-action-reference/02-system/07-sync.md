---
title: SYNC
---
# SYNC

Triggers an out-of-band [reconciliation tick](/concepts/reconciliation). The agent immediately fetches its current assignments from the gateway and applies anything that's due, rather than waiting for the next scheduled tick.

`SYNC` is an **instant action**. It bypasses maintenance windows and reconciliation cadence. That's the whole point.

## Parameters

None. The payload is canonical `{}`.

## Idempotency

None in the traditional sense. Triggering `SYNC` is itself the operation, and the actual work performed depends on what assignments are due at that moment. The agent reports `changed=false` for the SYNC action itself (it didn't mutate state directly); the underlying actions it triggers report their own outcomes.

## Example

From an operator's perspective, "Sync now" on the device-detail page in the web UI. From an assignment:

```yaml
type: SYNC
```

## Gotchas

- `SYNC` doesn't pause for the maintenance window. The actions it triggers respect their own windows, so dispatching `SYNC` outside one isn't dangerous; anything window-gated stays queued.
- A flood of `SYNC` to the same device coalesces. The agent treats them as a single tick rather than queuing each.
- This is the action you reach for when an operator wants to see their change land *now* rather than within the next reconciliation interval (default 30 minutes). Use it sparingly: chronic SYNC defeats reconciliation's batching properties.
