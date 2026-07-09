---
title: "NOT_APPLICABLE execution status (security-only precondition and friends)"
status: implemented
created: 2026-07-04
updated: 2026-07-09
---

# `NOT_APPLICABLE` execution status

> **Redesigned 2026-07-08 (maintainer direction):** the original draft added a
> per-device capability signal (inventory field + projection + pre-dispatch
> rejection). That machinery is disproportionate: the pre-dispatch gate was an
> optimization whose staleness handling re-required the execution-time check as
> the authority anyway. Replaced with **one new proto value**:
> `EXECUTION_STATUS_NOT_APPLICABLE`. The agent reports *why* inside the result;
> the UI renders it distinctly; no new evaluation mode, no capability
> projection, no dispatch-time special cases — and it generalizes beyond
> security-only upgrades.

## Overview

An action can be structurally inapplicable to a device: `security_only: true`
on a package manager with no security-patch notion (pacman; apt without
`unattended-upgrades`), a `DEB` action on an rpm host, a `FLATPAK` action with
no flatpak installed. Today these surface either as a delayed execution
**FAILED** (security-only) or — worse — as a **silent success** ("skipped: no
supported .deb package manager available", exit 0). This spec adds
`EXECUTION_STATUS_NOT_APPLICABLE` so inapplicability is a first-class,
visible, non-error outcome with a machine-readable reason.

## Motivation

Operators need to distinguish three things at a glance: "it worked", "it
broke", and "it doesn't apply here". Overloading FAILED makes admins chase
non-errors; overloading SUCCESS hides fleet gaps (a `DEB` action "succeeding"
on 40 rpm hosts means 40 devices silently unmanaged). A dedicated status is
cleaner UI, honest reporting, and extensible: every future "this device can't
do that" lands in the same bucket instead of growing bespoke pre-dispatch
checks.

## Acceptance criteria

1. Given `ExecutionStatus`, then it gains `EXECUTION_STATUS_NOT_APPLICABLE`
   (additive proto enum value; sdk → server → web).
2. Given an UPDATE action with `security_only: true` executing on a device
   whose package manager cannot scope to security patches, when it completes,
   then the result status is `NOT_APPLICABLE` with the reason in the result
   error/output (e.g. "security-only upgrades unsupported: pacman has no
   security-patch scoping" / "apt: unattended-upgrades not installed") — not
   FAILED, and nothing is upgraded (the existing fail-closed behavior is
   unchanged, only its classification).
3. Given the existing silent-skip paths — `DEB`/`RPM`/`APP_IMAGE`/`FLATPAK`/
   `REPOSITORY` (and siblings) on hosts with no matching backend — when they
   skip, then they report `NOT_APPLICABLE` with the existing skip message as
   the reason instead of SUCCESS. (Self-discovering sweep: every
   `"skipped: no …"` success return in the executor migrates; a grep guard in
   the agent test suite keeps new ones from reverting to silent success.)
4. Given a `NOT_APPLICABLE` result, when the server ingests it, then it flows
   through the existing execution pipeline (events, projections,
   `GetExecution`/`ListExecutions`) unchanged — no special-casing beyond the
   enum value.
5. Given the web UI, when an execution is `NOT_APPLICABLE`, then it renders as
   a distinct badge (neither red nor green) with the reason visible on the
   execution detail, and list filters can select it.
6. Given scheduled/recurring actions, when a run is `NOT_APPLICABLE` and
   nothing changed since the prior run, then result reporting follows the same
   skip-if-unchanged dedup as SUCCESS results (no per-tick event spam for a
   permanently inapplicable action).
7. Given `security_only: false` (or an applicable device), then behavior is
   unchanged.

## Out of scope

- **Pre-dispatch capability gating** (the original draft) — deliberately
  rejected: post-execution feedback arrives in seconds for connected devices,
  and the execution-time check was always the authority. Revisit only if
  operators demonstrably need pre-enqueue rejection for offline fleets.
- Auto-installing `unattended-upgrades` (operator action via PACKAGE).
- Retroactively reclassifying historical results.

## Technical design

- `sdk/proto/pm/v1/common.proto` — `EXECUTION_STATUS_NOT_APPLICABLE` value on
  `ExecutionStatus` (additive; no retag).
- `agent/internal/executor` — the security-only fail-closed path and the
  backend-skip returns map to the new status + reason; a small
  `notApplicable(reason)` result helper keeps the sites uniform.
- `server` — enum passthrough; no schema change (status column already stores
  the enum value).
- `web` — badge + i18n + filter for the new status.

### Database changes

None (existing status columns store the new value).

## Security considerations

- No authz change. The classification is agent-asserted, like every other
  execution result — a compromised agent could already lie about SUCCESS;
  NOT_APPLICABLE adds no new trust.
- Fail-closed property preserved: `security_only` on an incapable device still
  performs **no** upgrade; only the reported classification changes.

## Test requirements

- Agent: pacman + apt-without-unattended-upgrades security-only → NOT_APPLICABLE
  with reason, nothing executed; apt-with-unattended-upgrades → proceeds.
- Agent: each migrated skip path (deb on rpm host, etc.) → NOT_APPLICABLE, and
  the grep guard fails on a new `"skipped:"`-success return.
- Server: NOT_APPLICABLE round-trips dispatch → result → projection →
  `GetExecution`.
- Web: badge + filter rendering (component test).
- Dedup: recurring NOT_APPLICABLE follows skip-if-unchanged reporting.

## Rejection paths

| Scenario | Status | Result reason | Logged context |
|---|---|---|---|
| security_only on incapable backend | NOT_APPLICABLE | "security-only upgrades unsupported: <backend detail>" | device, backend |
| Action format has no backend on host | NOT_APPLICABLE | existing skip message | device, backend |

## Rollout and migration

- Additive enum value; old servers/web render unknown enum as its number until
  upgraded (cross-repo order sdk → server → web → agent, so consumers precede
  the producer).

## References

- server#475; the original capability-signal draft (superseded, this file's
  history); the executor's `"skipped: no supported …"` success returns (the
  silent-skip class AC 3 fixes).
