---
title: "Server-side inventory collection interval"
status: implemented
created: 2026-07-04
updated: 2026-07-07
---

# Server-side inventory collection interval

## Overview

Device inventory currently has **no cadence at all**: the only trigger in the
entire system is the manual `RefreshDeviceInventory` RPC (the sole
`TypeInventoryRequest` enqueue site), which sends a CA-signed
`RequestInventory` to the agent. There is no agent-side periodic collector and
no on-connect push — a comment in the agent handler referring to an
"agent-initiated periodic path" is stale; no such caller exists.

This spec introduces periodic inventory as a **server-scheduled** capability:
the interval is a server-held policy (per-device override, group minimum,
24 h default — the `SetDeviceSyncInterval` shape), and a control-side
scheduler requests inventory from stale devices over the **existing signed
`RequestInventory` path**. The agent is not modified at all — collection
stays server-initiated, matching the project principle *agent executes and
reports; server evaluates and holds policy*. Freshness ("inventory overdue")
is computed server-side from the same policy and exposed on the Device RPC
surface so the web UI can show it.

> **Amended 2026-07-07 (pinned with maintainer):** the original draft assumed
> an existing agent-side "on connect + every 24 h" cadence and proposed
> delivering the interval on the sync response for the agent to honor. That
> premise was false (no cadence exists), so the design was re-pinned to the
> server-side scheduler above: zero agent changes, no
> `SyncActionsResponse` field. Decisions: default 24 h; bounds 120 min–7 d;
> full group tier (both RPCs); overdue surfaced via the Device RPC/web, **not**
> doctor (stale inventory is inevitable at fleet scale — a doctor check would
> permanently flag large fleets).

## Motivation

An operator cannot make inventory refresh automatically, and the server cannot
state whether a device's inventory is stale-by-policy vs stale-because-broken
(there is no expected cadence to compare against). Cadence is policy, so it
belongs server-side, audit-evented, and resolvable per device. This underpins
the freshness contract the compliance-on-inventory work (2026.09, #492) and
spec 19's "as-of last inventory" claims rely on.

## Acceptance criteria

1. Given a device, when an operator calls `SetDeviceInventoryInterval`, then
   the value is persisted as an event (`DeviceInventoryIntervalSet`), projected
   onto the device projection, and audit-visible (#498 append-completeness).
2. Given a device group, when an operator calls
   `SetDeviceGroupInventoryInterval`, then the value is persisted as an event
   (`DeviceGroupInventoryIntervalSet`) and projected onto the group projection.
3. Given interval resolution for a device, then: a device-level override (> 0)
   wins; otherwise the **minimum** non-zero interval across the device's
   groups; otherwise the server default of **1440 minutes (24 h)**. `0` means
   "inherit" at both levels (mirrors sync-interval semantics).
4. Given `SetDeviceInventoryInterval` / `SetDeviceGroupInventoryInterval` with
   a non-zero value outside **[120, 10080] minutes** (2 h – 7 d), when
   validated, then it is rejected at the boundary AND the handler
   (`validate:"omitempty,gte=120,lte=10080"`).
5. Given the control-side inventory scheduler, when it ticks (fixed 15 min
   cadence, advisory-lock single-flighted across replicas), then for every
   device whose inventory age exceeds its resolved interval AND whose
   `last_seen_at` is within one tick period (heartbeats update it every
   30 s, so a connected device is always within this window), it enqueues at
   most one signed `RequestInventory` per tick, with an Asynq deadline
   **below the tick period** so requests to disconnected devices expire
   rather than accumulate. **No per-tick batch cap** (pinned): the
   first-rollout herd (the whole fleet is stale on day one) is absorbed by
   Asynq's queueing — the ingest side drains at its own pace, and the
   deadline expires whatever cannot be delivered within a tick.
6. Given a device with no inventory rows at all, when the scheduler evaluates
   it, then it is treated as stale (first collection happens automatically
   once the device is seen).
7. Given a device whose inventory age exceeds `resolved interval + grace`
   where `grace = max(1 h, 25 % of the interval)`, when devices are read over
   the RPC surface (`GetDevice` / `ListDevices`), then the Device message
   reports `last_inventory_at` and `inventory_overdue = true` — computed from
   the server-held cadence, valid even while the device is offline.
   Inventory age is `now − MAX(device_inventory.collected_at)` for the
   device. **Deliberately NOT a doctor check** (pinned): stale inventory is
   inevitable on large fleets and would permanently trip doctor; overdue is
   an RPC/UI signal, not a health gate.
   The scheduler threshold (interval) and the overdue threshold
   (interval + grace) differ **deliberately**: the scheduler re-collects as
   soon as inventory is *due*, so under normal operation the grace gap means
   `overdue` only trips when collection is *failing* (device offline, agent
   broken) — the stale-by-policy vs stale-because-broken distinction.
8. Given the manual `RefreshDeviceInventory` RPC, when it succeeds, then it
   naturally resets freshness (inventory age is measured from
   `device_inventory.collected_at`); manual refresh semantics are unchanged.
9. Given the agent, then it is **unchanged** by this spec: collection remains
   server-initiated over the WS4-verified signed `RequestInventory` path.
10. Given `CONTROL_INVENTORY_SCHEDULER_ENABLED=false` (default `true`), when
    the control server boots, then the scheduler is not started (one boot
    log line states so) — the deployment-layer escape hatch for
    change-frozen environments that must not run osquery on a cadence.
    Manual `RefreshDeviceInventory` and the `inventory_overdue` computation
    are unaffected (freshness is still evaluated against policy; it simply
    will not self-heal).

## Out of scope

- Any agent change (timer, sync-response field, env var) — collection stays
  server-initiated; revisit only if offline collection ever becomes a
  requirement.
- Changing *what* inventory is collected (baseline/osquery field set).
- A doctor check for overdue inventory (pinned decision, see AC 7).
- The compliance FACT-rule consumption of inventory freshness — 2026.09
  (#492).
- A configuration knob for the scheduler tick (fixed 15 min; cheap query).
  The only operational knob is the on/off switch
  (`CONTROL_INVENTORY_SCHEDULER_ENABLED`, AC 10).
- A per-tick batch cap (pinned: Asynq queueing absorbs the first-rollout
  herd; revisit only if ingest pressure is observed in practice).

## Technical design

### Affected repos (cross-repo order: sdk → server → web)

- **sdk** — `control.proto` only: `SetDeviceInventoryInterval` +
  `SetDeviceGroupInventoryIntervalRequest` RPCs/messages
  (`validate:"omitempty,gte=120,lte=10080"` on the minutes field,
  `validate:"required,ulid"` on ids); `Device` gains `last_inventory_at`
  (timestamp) and `inventory_overdue` (bool); `DeviceGroup` gains
  `inventory_interval_minutes`. **No agent-facing proto change.**
- **server** —
  - `internal/api`: the two handlers, cloned from `SetDeviceSyncInterval`
    (validate → `EnforceDeviceScopeOnBaseTier`) and
    `SetDeviceGroupSyncInterval` (validate → `EnforceDeviceGroupScope`);
    out-of-scope/absent targets → `NotFound`. Device read paths populate the
    two new fields from the freshness data **joined into the existing list /
    get queries** (`ListDevices` is plain SQL — a grouped/LATERAL join on
    `MAX(device_inventory.collected_at)`, never a per-row N+1; the search
    index is not involved).
  - `internal/store`: migration adding `inventory_interval_minutes` to
    `devices_projection` and `device_groups_projection` (default 0);
    typed payloads + projector appliers for the two new event types (device /
    device_group streams — the existing rebuild targets already own these
    tables, so replay coverage is automatic; extend the full-fidelity
    fixture); `GetDeviceInventoryInterval` resolution query cloned from
    `GetDeviceSyncInterval`; a stale-devices query (join
    `devices_projection` × `MAX(device_inventory.collected_at)`, filter by
    resolved interval and `last_seen_at`).
  - scheduler: a control-side periodic worker (the `startDynamicGroupWorker`
    / retention-worker pattern: `runPeriodic`, `TryWithAdvisoryLock`
    single-flight, panic recovery). Reuses the exact signing + enqueue code
    path of `RefreshDeviceInventory` (`asynq.MaxRetry(3)`,
    `asynq.Deadline(now + <tick)`). Gated by
    `CONTROL_INVENTORY_SCHEDULER_ENABLED` (default `true`; `false` skips the
    worker with one boot log line — AC 10).
- **web** (direct-to-main) — show `last_inventory_at` / overdue badge on the
  device list and detail views; interval fields on the device / group edit
  surfaces alongside the sync interval.

### Database changes

- `devices_projection.inventory_interval_minutes int NOT NULL DEFAULT 0`;
  `device_groups_projection.inventory_interval_minutes int NOT NULL DEFAULT 0`.
- New event types `DeviceInventoryIntervalSet`,
  `DeviceGroupInventoryIntervalSet` (typed payloads; no PII).
- No change to `device_inventory` (operational, non-event-sourced) —
  `collected_at` already provides the freshness timestamp.

### New dependencies

None.

## Security considerations

- **Authorization**: identical scope model to the sync-interval RPCs
  (`EnforceDeviceScopeOnBaseTier` / `EnforceDeviceGroupScope`); out-of-scope
  callers get `NotFound` uniformly.
- **Audit**: both interval changes are events → audit-logged automatically
  (#498 guard).
- **Signed collection**: the scheduler emits the same CA-signed
  `RequestInventory` as the manual path — the agent's WS4 fail-closed
  verification is unchanged; a compromised control DB row (interval value)
  can at most change *how often* collection runs, never *what* runs.
- **Input validation**: bounds at boundary + handler; the 120 min floor
  protects devices from osquery hammering.
- **DoS posture**: at most one request per stale device per 15 min tick,
  task deadline < tick (no queue pile-up for offline devices), and the
  `last_seen_at` filter avoids enqueueing for long-dead devices.

## Test requirements

- Handlers (both RPCs): correct / absent / out-of-range value (119, 10081,
  negative); `0` accepted as inherit; unauthenticated; wrong role;
  out-of-scope → NotFound; event appended on success (audit).
- Resolution: device override wins; group MIN across multiple groups;
  default 1440 when nothing set; `0` inherits at each level (clone the
  sync-interval resolution tests).
- Scheduler (real Postgres): stale device gets exactly one enqueued signed
  request per tick; fresh device gets none; never-collected device counts as
  stale; device with old `last_seen_at` is skipped; single-flight (second
  replica skips); panic in one cycle doesn't kill the worker;
  `CONTROL_INVENTORY_SCHEDULER_ENABLED=false` starts no worker.
- Freshness/RPC: `last_inventory_at` and `inventory_overdue` correct at the
  boundary (age just below vs above interval + grace); overdue computable
  while device offline; the list query carries the fields without a per-row
  N+1.
- Full-fidelity rebuild: the two new events reproduce the projection columns
  byte-identically (extend the existing fixture).

## Rejection paths

| Scenario | Error code | Client message | Logged context |
|---|---|---|---|
| Non-zero interval outside [120, 10080] | InvalidArgument | "inventory interval out of range" | actor, target, value |
| Absent device or group | NotFound | "device not found" / "device group not found" | actor, target |
| Out-of-scope device or group | PermissionDenied | "permission denied" | actor, target |
| Unauthenticated | Unauthenticated | (interceptor) | method, remote |

> **Amended during implementation (2026-07-07):** the original table said
> out-of-scope → NotFound, but the spec also pins "identical scope model
> to the sync-interval RPCs" — and the WS3 helpers those RPCs use
> (`EnforceDeviceScopeOnBaseTier` / `EnforceDeviceGroupScope`) return
> PermissionDenied for out-of-scope *mutations* across every
> device-targeted write (NotFound is the read-visibility code). The
> template's security-reviewed behavior wins; absent targets still
> return NotFound.

## Rollout and migration

- Additive migration (two columns, default 0 = inherit).
- **Behavioral change (deliberate):** with the 24 h server default, every
  device begins receiving a signed inventory request once its inventory is
  older than 24 h — today nothing collects automatically. The 15 min tick +
  `last_seen_at` filter + per-tick dedup bound the request side; the
  first-rollout ingest herd is accepted (pinned) — Asynq queueing absorbs
  it and the sub-tick deadline expires undeliverable requests. Operators can
  raise intervals per group up to 7 d, or disable the scheduler entirely via
  `CONTROL_INVENTORY_SCHEDULER_ENABLED=false` (change-frozen environments).

## Audit findings

None from `TECH_DEBT_AUDIT.md` apply directly (`device_inventory` is
classified operational state and stays out of the event-sourced set; this
spec adds only the *interval policy*, which is event-sourced). The stale
"agent-initiated periodic path" comment in `agent/internal/handler/handler.go`
should be corrected when convenient (docs-only; the agent is otherwise
untouched).

## References

- server#500; the `SetDeviceSyncInterval` / `SetDeviceGroupSyncInterval`
  pattern (the template).
- `RefreshDeviceInventory` (`osquery_handler.go`) — the signing + enqueue
  path the scheduler reuses.
- spec 19 (freshness contract), server#492 (compliance-on-inventory consumer).
