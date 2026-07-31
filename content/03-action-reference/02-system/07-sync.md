---
title: SYNC
---
# SYNC

<!-- docref: begin src=agent:internal/handler/handler.go#Handler.OnActionWithStreaming:06e9eebb,agent:cmd/power-manage-agent/runtime.go#periodicSync:2e2cbb96 -->
Triggers an out-of-band [reconciliation tick](/concepts/reconciliation).
Control commits the delivery and offers it on the direct agent stream; the
agent runs a full desired-state reconcile immediately instead of waiting for
its normal cadence.
<!-- docref: end -->

`SYNC` is an **instant action**. It bypasses the reconciliation cadence; the actions it triggers still respect their own schedules and maintenance windows.

## Parameters

<!-- docref: begin src=server:internal/api/action_dispatch.go#ActionHandler.DispatchInstantAction:0c9f64b1 -->
None. Instant actions are parameterless — the signed envelope carries no params, and the execution event records the canonical empty object `{}`.
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/handler/handler.go#Handler.OnActionWithStreaming:06e9eebb -->
None in the traditional sense. Triggering `SYNC` is itself the operation, and the actual work performed depends on the device's assignments at that moment. The SYNC action itself reports success with `changed=false` and `Sync triggered` as its output; the actions it triggers report their own outcomes.
<!-- docref: end -->

## Example

From an operator's perspective, "Sync now" on the device-detail page in the web UI. From an assignment:

```yaml
type: SYNC
```

## Gotchas

- `SYNC` doesn't pause for the maintenance window. The actions it triggers respect their own windows, so dispatching `SYNC` outside one isn't dangerous; anything window-gated stays queued.
<!-- docref: begin src=agent:internal/handler/handler.go#Handler.OnActionWithStreaming:06e9eebb -->
- A flood of `SYNC` to the same device coalesces. The trigger is a single-slot channel — while a sync is already pending, further SYNC actions log "sync already pending" and fold into that one tick.
<!-- docref: end -->
<!-- docref: begin src=agent:cmd/power-manage-agent/main.go#defaultSyncInterval:2d5b57db -->
- This is the action you reach for when an operator wants to see their change land *now* rather than within the next reconciliation interval (default 30 minutes). Use it sparingly: a full re-apply re-runs everything, including `SHELL` scripts without detection scripts and any `SCRIPT_RUN` in an assignment.
<!-- docref: end -->
