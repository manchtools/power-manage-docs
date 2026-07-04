---
title: "RebuildAll operability & cascade-safety"
status: approved
created: 2026-07-04
---

# RebuildAll operability & cascade-safety

## Overview

`RebuildAll` — the emergency projection replay that ADR 0029's recovery
guarantee rests on — is today reachable only from test code, and its
single-target path is silently destructive (a partial rebuild CASCADE-wipes FK
children it never replays). This spec gives `RebuildAll` a production entry point
(a `control rebuild-projections` subcommand) and makes partial rebuilds
cascade-safe (auto-include the FK closure, or refuse with a clear error). It is a
prerequisite for spec 19, whose snapshot-restore path replays subsets by
definition. Closes audit F-01 (#505) and F-03 (#506).

## Motivation

The #498 guard family made the event-sourcing *write* path trustworthy, but the
*recovery* half doesn't hold: an operator mid-incident cannot invoke replay
(F-01), and anyone who does invoke a single-target rebuild silently destroys 2FA
enrollments and SSO links (F-03 — the #497 data-loss class via the partial path).
Both must be fixed before spec 19 builds snapshot-restore on top of the same
machinery.

## Acceptance criteria

1. Given a booted control host, when an operator runs `control rebuild-projections`
   with no target, then it wires `projectors.WireAll`, replays all
   `AllRebuildTargets`, prints a per-target result (name / events applied /
   skipped / duration), and exits non-zero on any target error.
2. Given `control rebuild-projections <target…>`, when named targets are given,
   then only those (plus their FK-closure, per AC 4) are rebuilt; an unknown
   target name is rejected with `ErrUnknownTarget` and a clear message.
3. Given the subcommand, when it runs, then it uses a CLI lifecycle context (not
   a request context) and requires host/shell access to the control container —
   there is **no remote RPC** exposing `RebuildAll` (a destructive
   TRUNCATE-and-replay is not a network-reachable operation).
4. **Cascade-safe partial rebuild.** Given a partial rebuild whose selected
   targets own tables that FK-CASCADE onto tables owned by *unselected* targets
   (e.g. `users` → `totp_projection`, `identity_links_projection`), when
   `selectTargets` resolves, then it either **auto-includes** every target owning
   a table in the cascade closure (canonical order) or **refuses** with an error
   naming the missing targets — it never TRUNCATEs a table it will not replay.
5. Given `control rebuild-projections users` (the F-03 case), when it runs, then a
   seeded TOTP enrollment and identity link **survive** (regression pin).
6. Given a full-fidelity round-trip, when a rich fixture is seeded, dumped
   (ordered `SELECT *` over every `AllRebuildTargets` table), rebuilt no-arg, and
   re-dumped, then the two dumps are byte-identical (absorbs F-04: proves
   "replay reproduces 1:1" per-column, self-discovering over the target set).
7. Given the `RebuildResult`, when events are skipped (`ErrSkipEvent`), then
   applied and skipped counts are reported **separately** (absorbs F-14 — a
   `Skipped` counter, so an operator sees N events were unprojectable).

## Out of scope

- Snapshot capture / pruning / the changed post-prune rebuild contract — spec 19.
- Drift *detection* in doctor — spec 19 (AC 31a), which builds on this being
  trustworthy.
- An RBAC-gated remote rebuild RPC — deliberately not built (AC 3).

## Technical design

### Affected packages

- `cmd/control` — new `rebuild.go` subcommand (doctor pattern:
  `cmd/control/doctor.go`); boot store, `SetRepos`, `projectors.WireAll`,
  `RebuildAll`, print result.
- `internal/store/rebuild.go` — `selectTargets`/`runOneTarget` FK-closure
  auto-include (reuse `schema_classification_test.go:fkCascadeClosure`);
  `TargetResult` gains a `Skipped int64`.
- `deploy/QUICKSTART.md` — "Emergency projection rebuild" section, docref-anchored.

### Database changes

None (behavioral only; TRUNCATE targets already come from the static registry).

### New dependencies

None.

## Security considerations

- **Authz = host access.** The subcommand is local-only (like `doctor`); running
  it requires shell access to the control host/container. No network surface, no
  RBAC permission — a TRUNCATE-and-replay is an operator-console operation. This
  resolves the audit's open question (was `RebuildAll` unexposed deliberately?)
  in favor of "expose via CLI, gate by host access," not a remote RPC.
- **Destructive-op safety.** Cascade-safety (AC 4) is the guard against the
  operator footgun; the subcommand prints what it will rebuild before doing so.
- **Fail-loud.** Non-zero exit on any target error; the full-fidelity test (AC 6)
  is the standing proof the operation is faithful.

## Test requirements

- Subcommand: no-arg rebuilds all; named target rebuilds subset+closure; unknown
  target rejected; non-zero exit on applier error.
- Cascade-safety: `users` alone auto-includes/refuses; seeded TOTP + identity
  link survive (AC 5).
- Full-fidelity round-trip over `AllRebuildTargets` (AC 6).
- `Skipped` counter populated when `ErrSkipEvent` fires (AC 7).

## Rejection paths

| Scenario | Error code / behavior | Notes |
|---|---|---|
| Unknown target name | `ErrUnknownTarget`, non-zero exit | clear message listing valid targets |
| Partial rebuild missing a cascade-closure target | error (or auto-include) | never TRUNCATE-without-replay |
| Applier error mid-rebuild | rollback that target, non-zero exit | tx atomicity (existing) |
| Invoked without host access | (n/a — no remote surface) | CLI only |

## Rollout and migration

- Ships before spec 19 (its snapshot-restore uses this machinery).
- No migration; additive subcommand + safer `selectTargets`.
- Correct the stale ADR 0026 / `wire.go` "periodic reconcile is the safety net"
  wording once the real recovery path (this subcommand + spec 19's drift check)
  exists (audit F-02 follow-up).

## References

- `server/TECH_DEBT_AUDIT.md` F-01 (#505), F-03 (#506), F-04, F-14.
- ADR 0029 (recovery guarantee), ADR 0026 (audit model — wording to correct).
- spec 19 (depends on this).
