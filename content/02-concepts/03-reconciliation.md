---
title: Reconciliation
---
# Reconciliation

The agent keeps durable local desired state and executes due work against the
device. One long-lived outbound mTLS stream carries synchronization,
heartbeats, delivery, results, and terminal traffic directly between agent and
control.

## Delivery and receipt

Control stores the complete manifest in a delivery row before attempting to
send it. An in-process wakeup reduces latency; a periodic database sweep is the
correctness path when a wakeup is missed or a device is offline.

The agent durably records the `delivery_id` before acknowledging receipt.
Retries and reconnects reuse the same delivery ID, so they do not execute the
same delivery twice. Results are idempotent.

## Assigned work versus an explicit dispatch

<!-- docref: begin src=server:internal/manifest/compiler.go#AsOneShot:4dcee40c,agent:internal/store/manifest.go#Store.BeginManifestRun:869363a8,agent:internal/store/manifest.go#Store.GetDueManifestDeliveries:6fd045a2 -->
A delivery is either scheduled or one-shot, and the manifest says which
structurally — the agent never infers it from the action type or the shape of a
schedule. Assigned work carries its authored schedule and recurs on it. An
explicit dispatch compiles a one-shot manifest: the agent runs it once on
durable receipt, stamps the run in the same transaction that advances the
delivery cursor, and from then on the due-work query skips that delivery
permanently. The delivery row is kept rather than deleted, so a replayed
delivery of the same ID is absorbed instead of re-executed.

The two kinds also differ at the maintenance window: scheduled deliveries defer
until the window opens, one-shot deliveries do not. See
[Maintenance windows](/concepts/maintenance-windows).
<!-- docref: end -->

## Offline behavior

The agent continues already received schedules and reconciliation from its
local store while control is temporarily unavailable. New assignments wait in
the control database and arrive after reconnect.

Before a non-idempotent side effect, the agent records `STARTED`. If it
crashes after that point, it reports `INDETERMINATE` instead of silently
repeating the effect. Reboot uses a boot marker to resolve its outcome.

## Immediate synchronization

The SYNC action asks the agent to reconcile immediately instead of waiting for
its normal cadence. See [SYNC](/action-reference/system/sync).
