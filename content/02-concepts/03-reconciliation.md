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
