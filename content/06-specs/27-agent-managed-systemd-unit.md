---
title: "Agent-managed systemd unit (embedded single source, startup reconcile)"
status: implemented
created: 2026-07-09
updated: 2026-07-10
---

# Agent-managed systemd unit

## Overview

The agent's systemd unit is written once by `install.sh` at enrollment and
never touched again. Agent self-update replaces only the binary, so the unit
drifts from the binary's requirements: devices enrolled before #96
(2026-06-09) still run a `CapabilityBoundingSet` without `CAP_SETFCAP` /
`CAP_KILL` / `CAP_NET_RAW`, and every process apt/dpkg spawns inherits it —
package post-install scripts that set file capabilities (snapd, iputils, …)
fail with `Operation not permitted` even as root, and the half-configured
package wedges every subsequent UPDATE action (observed in production
2026-07-09, agent#187). This spec makes the unit ship **inside** the agent
binary (`go:embed`) as the single source of truth: the agent installs and
maintains its own unit via an `install-unit` subcommand and a startup
reconcile — `install.sh` merely invokes `install-unit` once (systemd cannot
start the service before a unit exists, and enrollment runs through the
running daemon's socket, so the very first placement has to be triggered from
outside). The self-update path invokes the new binary's `install-unit` before
the post-update respawn, so a binary update updates the unit in the restart it
already performs — nothing extra downloaded, the whole chain covered by the
existing update-authenticity verification (WS7).

## Motivation

A unit that encodes capability and hardening requirements is version-coupled
to the binary: new agent features legitimately need new capabilities, and a
stale unit turns them into silent, hard-to-diagnose EPERM failures deep
inside package hooks. Today that drift is invisible (one WARN at a boot long
scrolled away) and unrecoverable without manual per-host surgery. Two sources
currently exist (the `install.sh` heredoc and the operator's disk copy);
after an update there are effectively three. One embedded source, printed at
install and reconciled at startup, eliminates the class.

## Design summary

- **Single source, agent-owned install**: the unit lives as an embedded
  template in the agent binary. A new `install-unit` subcommand renders it
  and installs it (validated, atomic write, 0644 root:root, then
  `daemon-reload`) — `install.sh`'s heredoc and systemd-version probe are
  deleted and replaced by one invocation of `"$BINARY_PATH" install-unit`
  before `systemctl enable --now`. The script keeps that single call because
  of the bootstrap order: systemd cannot start the service before a unit
  exists, and enrollment runs through the *running* daemon's socket — so the
  very first placement must be triggered from outside systemd. The
  `RestrictRealtime` conditional (systemd ≥ 257 → `true`, else `false`,
  unparseable/unknown → `false` as a precaution) moves from the script into
  the render.
- **SDK mechanics, not agent-local plumbing**: all unit operations go
  through `sdk/sys/service.Manager` — `WriteUnit` (unit-name and
  unit-content validation + atomic temp-and-rename write via `sys/fs`
  safe-replace), `DaemonReload`, `EnableNow` — driven by the existing
  `sys/exec` runner. Two small mechanisms the reconcile needs that the SDK
  lacks are added **to the SDK first** (SDK-first rule): a
  `service.Version(ctx)` systemd-version probe and a `ReadUnit` sibling of
  `WriteUnit`, so the unit path stays constructed in exactly one place. A
  nice by-product: the agent's own unit passes the same
  `validateUnitContent` gate operator-supplied SERVICE actions do.
- **Startup reconcile** (daemon path only, root only, skipped when the unit
  file does not exist — container/dev runs): render the embedded template,
  byte-compare against the on-disk unit (`ReadUnit`); on drift, rewrite via
  `WriteUnit` + `DaemonReload`, logging at ERROR that the unit was stale.
  **No self-restart** (user decision 2026-07-10): the rewritten unit's
  settings apply at the next service restart — reboot, a manual
  `systemctl restart` (e.g. via a PM terminal), or the respawn the next
  self-update performs. Waiting is accepted; the ERROR log is the signal.
- **Update-path convergence**: the AGENT_UPDATE executor, after the atomic
  binary swap and self-test and *before* signaling graceful shutdown,
  invokes the **new** binary's `install-unit`. The respawn systemd already
  performs (`Restart=always`) then starts the new binary under the new unit
  — a normal update converges in the one restart it was doing anyway.
  (The update *to* the first version carrying this feature runs the old
  updater, which lacks the call; those devices converge via the startup
  reconcile + their next restart/reboot, per the decision above.)
- **Backend posture**: the reconciler is keyed on `sys/service.Detect()` —
  it runs only where a usable systemd is detected and no-ops (DEBUG log)
  elsewhere, instead of assuming systemd. Systemd is the only implemented
  backend today: that is a deliberate, standing SDK decision (the
  OpenRC/Runit/S6 scaffolds that only ever returned "not supported" were
  deleted; `Backend` is fail-closed via `ErrUnknownBackend`). A real second
  backend is its own spec — SDK backend implementation first, then a
  per-backend template here — and this package is structured (template
  keyed by backend, all operations behind `service.Manager`) so that lands
  additively, with no redesign.
- **Operator override contract**: the unit file is agent-managed ("vendor
  unit"); operator customizations go in drop-ins
  (`power-manage-agent.service.d/*.conf`), which the reconciler never reads
  or writes and which win over the unit per systemd semantics. Documented on
  the installation page.
- **Fail-open**: a reconcile failure (read-only `/etc`, `daemon-reload`
  error) logs at ERROR and the agent starts anyway — a broken reconcile must
  never take the device unmanaged. No retry ticker (deliberate: a failed
  root write to `/etc` means a broken host; the next restart retries). The
  updater's `install-unit` call is equally fail-open: its failure never
  aborts a binary update.

## Acceptance criteria

1. Given the agent binary, when `power-manage-agent install-unit` runs as
   root, then it installs the rendered unit via `sys/service.WriteUnit`
   (validated, atomic, 0644 root:root) and runs `DaemonReload` — content
   identical to what the startup reconciler renders on the same host (same
   template, same version probe) — and `install.sh` uses it instead of a
   heredoc (no second copy of the unit exists anywhere in the repo).
2. Given a systemd version probe (`sys/service.Version`), when systemd
   ≥ 257, then the rendered unit has `RestrictRealtime=true`; when < 257,
   unknown, or unparseable, then `RestrictRealtime=false` (precaution,
   matching current install.sh behavior).
3. Given a daemon startup with an on-disk unit whose bytes differ from the
   rendered template, when the reconciler runs, then it rewrites the file
   via `WriteUnit`, runs `DaemonReload`, and logs at ERROR naming the
   drift; given identical bytes, then it does nothing and logs nothing above
   DEBUG. The reconciler never triggers a service restart — the rewritten
   settings apply at the next restart/reboot (accepted, 2026-07-10).
4. Given an AGENT_UPDATE execution, when the binary swap and self-test have
   succeeded, then the updater invokes the NEW binary's `install-unit`
   before signaling graceful shutdown — so the systemd respawn starts the
   new binary under the new unit; an `install-unit` failure logs at ERROR
   and the update proceeds regardless (fail-open).
5. Given operator drop-ins under `power-manage-agent.service.d/`, when the
   reconciler runs, then they are never read, modified, or deleted.
6. Given a reconcile failure (unwritable unit path, failing
   `daemon-reload`), when the daemon starts, then it logs at ERROR and
   continues serving — enrollment, sync, and actions are unaffected.
7. Given a non-daemon invocation (`enroll`, `luks …`, any CLI subcommand),
   a non-root run, a host where `sys/service.Detect()` finds no usable
   systemd, or a host without the unit file, when the agent runs, then the
   startup reconciler does not run (`install-unit` is the explicit,
   root-only exception — it is the install path).
8. Given a pre-#96 fleet device, when its agent self-updates to a version
   carrying this feature, then the first startup of the new binary rewrites
   the stale unit (ERROR log naming the drift) and the device converges at
   its next restart — reboot, manual `systemctl restart`, or the respawn of
   any subsequent update — with no dispatched remediation action (closes
   the fleet-wide half of agent#187).

## Out of scope

- `.deb`/`.rpm` packaging (single-script install stays the documented shape).
- The opt-in desktop URI handler file (static, not version-coupled).
- A second service-manager backend (OpenRC/Runit/S6). Deliberate standing
  SDK decision: implemented-backends-only, no "not supported" scaffolds.
  When one is actually wanted it is its own spec — SDK
  `sys/service.Backend` implementation first, then a per-backend template
  here. This spec's structure (Detect-keyed reconciler, all operations
  behind `service.Manager`, backend-keyed template) is chosen so that lands
  additively.
- Any reconciler-triggered service restart (user decision 2026-07-10 —
  convergence waits for the next restart/reboot; the ERROR log is the
  operator signal).
- Surfacing reconcile state via heartbeat metadata (proto change; revisit if
  ERROR-level logging proves insufficient in practice).
- Retrying failed reconciles on a timer (deliberate — see Design summary).

## Technical design

### Affected packages

- `sdk/sys/service` — two mechanism additions (SDK-first): `Version(ctx)`
  (systemd version probe, parsed from `systemctl --version`) and
  `ReadUnit(ctx, unit)` (sibling of `WriteUnit`, keeps the unit path in one
  place). Ships first as its own small SDK PR.
- `agent/cmd/power-manage-agent` — `install-unit` subcommand; reconciler
  invocation in the daemon startup path (after logging is up, before serving).
- `agent/internal/unit` (new, small) — embedded template (`go:embed`, keyed
  by backend), render, byte-compare; ALL system operations via
  `sys/service.Manager` (`ReadUnit`/`WriteUnit`/`DaemonReload`) over the
  existing `sys/exec` runner — no agent-local systemctl or file plumbing.
- `agent/internal/executor` — `agent_update.go`: invoke the new binary's
  `install-unit` between self-test and graceful shutdown (fail-open).
- `agent/install.sh` — heredoc and systemd-version probe deleted; calls
  `install-unit` before `systemctl enable --now`.
- `docs` — installation page: unit is agent-managed, override via drop-ins.

### Database changes

None.

### New dependencies

None (`go:embed` plus the existing `sdk/sys/service`, `sys/fs`, `sys/exec`
mechanisms).

## Security considerations

- **Chain of custody**: the unit ships inside the CA-/checksum-verified
  binary (WS7); nothing new is fetched, no second artifact to verify. The
  template is static content — no untrusted input reaches the rendered unit
  (the only variable is the boolean systemd-version probe result).
- **Privilege**: writing `/etc/systemd/system` and `daemon-reload`/`restart`
  are within the agent's existing root remit and — field-confirmed in
  agent#187 — require none of the capabilities a stale bounding set lacks,
  so the reconciler works precisely when it is needed most.
- **Operator intent**: an operator who deliberately restricted the agent via
  direct unit edits gets reverted; the supported restriction path is a
  drop-in (which wins and which the agent never touches). This is by design
  and documented — a covert revert-war with the operator is avoided by the
  loud ERROR log naming the drift on every reconcile.
- **Same gate as operator content**: the write goes through
  `sys/service.WriteUnit`, so the agent's own template passes the identical
  unit-name and unit-content validation and atomic safe-replace write that
  operator-supplied SERVICE units do — no privileged bypass path.
- **No reconciler-triggered restarts**: the reconciler only rewrites and
  daemon-reloads; a restart loop is structurally impossible because the
  reconciler never restarts anything. The updater's respawn is the one the
  update already performs.

## Test requirements

- SDK: `service.Version` parse table (≥ 257 / < 257 / garbage / empty →
  value + error contract); `ReadUnit` round-trips what `WriteUnit` wrote;
  the agent's embedded template passes `validateUnitContent`.
- Render: systemd ≥ 257 / < 257 / unparseable → `RestrictRealtime`
  true/false/false; `install-unit` installs bytes identical to the
  reconciler's render on the same host.
- Reconcile: drifted file → rewritten + reload invoked (recorded via the
  runner seam) + ERROR logged; identical file → no write, no reload; NO
  restart invoked in any reconcile path (asserted on the runner seam);
  drop-in files untouched (fixture dir).
- Updater hook: after a (seamed) successful swap + self-test, the new
  binary's `install-unit` is invoked before shutdown; its failure does not
  fail the update.
- Fail-open: unwritable path / failing reload → ERROR + startup proceeds.
- Guard rails: reconciler not invoked for CLI subcommands, non-root, or
  hosts where `Detect()` finds no systemd (seam-level assertion).
- `install.sh` contains no unit heredoc (grep guard in the agent test suite,
  matches-zero-guarded), so the single-source property cannot silently
  regress.

## Rejection paths

| Scenario | Behavior | Logged context |
|---|---|---|
| Unit path unwritable | fail-open, agent serves | ERROR: reconcile failed, path, error |
| `daemon-reload` fails after write | fail-open, agent serves | ERROR: reload failed (unit updated on disk) |
| `service.Version` unparseable | render with `RestrictRealtime=false` | WARN: probe failed, precaution applied |
| `install-unit` fails during self-update | fail-open, update proceeds; startup reconcile retries on respawn | ERROR: unit install failed, update continues |
| No usable systemd (`Detect()` empty) | reconciler no-ops | DEBUG: no service manager detected |

## Rollout and migration

Ships as a small SDK PR (`Version` + `ReadUnit`) followed by the agent
release; no server change. Existing fleet self-heals in two steps: the first
startup after the self-update rewrites stale units (ERROR log), and the unit
takes effect at each device's next restart — reboot, manual restart, or the
respawn of any subsequent update (AC 8; accepted 2026-07-10). Updates
*after* this version converge in their own respawn via the updater's
`install-unit` call (AC 4). The interim SHELL-action remediation documented
in agent#187 becomes unnecessary for devices that receive the update. Closes
agent#187's fix #1 (detection — the ERROR log) and fix #2 (remediation).

## Audit findings

- agent#187 (2026-07-09 production incident): pre-#96 units wedge Ubuntu
  updates via snapd's `setcap` postinst; `sudo` inside a PM terminal cannot
  escape the stale bounding set (capability drops are irrevocable for
  descendants) — remediation had to go through SSH. This spec removes the
  class.

## References

- agent#187 (incident + interim remediation), #96 (the capability additions
  that exposed the drift).
- WS7 agent self-update authenticity (the trust chain the embedded unit
  rides).
- `install.sh` `install_systemd_service()` (current heredoc + systemd-version
  conditional this spec relocates).
