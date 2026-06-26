---
title: "control doctor — stack health & security posture checks"
status: draft
created: 2026-06-26
---

# control doctor

## Overview

`power-manage-control doctor` is a one-shot subcommand an operator runs on the
Control host to flag stack-health and security-posture problems before (or after)
exposing a deployment. It runs a registry of cheap, high-signal checks — weak
secrets, world-readable keys, CORS/port misconfig, datastore reachability, queue
and search-index health — prints findings with a severity, and exits non-zero if
anything material is wrong. It is the operational companion to `SECURITY.md`:
where that document states the threat model's expectations, `doctor` checks a live
deployment against them. Reports only; it never mutates state.

## Motivation

Misconfiguration, not novel exploits, is the realistic failure mode for a
self-hosted security product: a `CHANGE_ME` password left in `.env`, a private key
checked in at mode 0644, `CONTROL_CORS_ORIGINS=*`, the mTLS port bound to a public
interface, or a silently-drifted search index. Today an operator has no single
command to surface these — they're spread across `.env`, cert files, runtime
config, and live datastore state. `doctor` consolidates them into one
exit-code-bearing check suitable for a post-install gate, a cron/monitoring probe
(`--json`), or a support triage step. Closes #322; pairs with #323 (SECURITY.md).

## Acceptance criteria

1. Given a Control host, when `power-manage-control doctor` runs, then it executes
   every registered check and prints each finding as `severity  check-id  message`
   (plus a one-line remediation), grouped/sorted by severity.
2. Given the run completes, when no `warning` or `critical` finding was produced,
   then the process exits **0**; when ≥1 `warning`/`critical` finding exists, it
   exits **1**; when a check cannot be *executed* at all (config fails to load, or
   a check panics/errors unexpectedly), it exits **2**. `info`/`ok` results never
   force a non-zero exit.
3. Given `--json`, when `doctor` runs, then it writes a single JSON object
   `{ "summary": {counts by severity}, "findings": [{id, severity, message,
   remediation, detail?}], "exit_code": N }` to stdout and nothing else to stdout
   (human text and errors go to stderr), so CI/monitoring can consume it.
4. Given a tracked secret env var (`POSTGRES_PASSWORD`, `VALKEY_PASSWORD`,
   `JWT_SECRET`, `CONTROL_ENCRYPTION_KEY`, `PM_TASK_SIGNING_KEY`) whose value
   matches `CHANGE_ME*` (case-insensitive) or is shorter than its required floor,
   when checked, then a **critical** finding names that var (never echoing the
   value).
5. Given `CONTROL_ENCRYPTION_KEY` is unset, when checked, then a **critical**
   finding is produced (at-rest encryption is mandatory — the historical
   `CONTROL_ENCRYPTION_KEY_REQUIRED=false` opt-out no longer exists; Control will
   not boot without it).
6. Given a private key file under the certs directory (`*.key`, CA/signing keys)
   with a mode more permissive than `0400` (group/other bits set), when checked,
   then a **critical** finding naming the file + its mode.
7. Given the device/service/action-signing CA certificate, when checked: missing
   → **critical**; not-yet-valid or already-expired → **critical**; expiring
   within the configured horizon (default 30 days) → **warning**.
8. Given `CONTROL_CORS_ORIGINS=*` (or otherwise allowing a credentialed wildcard),
   when checked, then a **critical** finding (the runtime already rejects
   credentialed wildcards — ADR 0008 — so this is a config that would break the UI
   or signal intent to weaken CORS).
9. Given the Control mTLS/internal listener is bound to a public interface
   (`0.0.0.0`/a routable address rather than the internal Docker network /
   loopback), when checked, then a **warning** finding.
10. Given `IMAGE_TAG=latest` (or `latest-rc`) in a deploy that looks production
    (not an `-rc`/dev profile), when checked, then a **warning** finding (image-tag
    contract — pin a digest/version).
11. Given Postgres and Valkey, when `doctor` attempts a bounded connection to each,
    then unreachable → **critical** (per datastore), with the connection error in
    `detail`; reachable → `ok`.
12. Given the Asynq queues, when checked, then a dead-letter / archived depth `> 0`
    → **warning** with the depth and queue name.
13. Given the search subsystem, when checked: each expected index missing from
    `FT.INFO` → **critical**; the last indexer reconcile older than the configured
    staleness horizon (default 2× the reconcile interval) → **warning**.
14. Given the bootstrap admin email is still the default (`admin@example.com`),
    when checked, then a **warning** finding.
15. Given the check registry, a self-discovering completeness test fails the build
    if any registered check lacks a unit test (matches-zero guard), mirroring the
    project's other self-discovering guards.

Each criterion follows "Given [precondition], when [action], then [observable
outcome]."

## Out of scope

- **Auto-remediation.** `doctor` reports; it never edits `.env`, fixes perms,
  rotates keys, or restarts services. Every finding carries a remediation *string*,
  not an action.
- **Daemon / continuous monitoring.** One-shot only; a cron + `--json` + an alert
  rule is the monitoring story, not a long-running mode.
- **Agent-side health.** This is the Control/stack doctor. Agent self-diagnostics
  are a separate concern.
- **Deep gateway reachability / end-to-end dispatch probing.** Checking that a
  specific agent can round-trip an action is out; the cheap config/port checks
  (criterion 9) stay in.
- **Secrets *values* in output.** Findings name variables/files and report
  length/shape, never the secret itself — true for human and `--json` output.

## Technical design

### Affected packages

- `server/cmd/control` — a new `doctor` subcommand (arg dispatch; reuses Control's
  existing config loader so the env/paths match the running server exactly).
- `server/internal/doctor` (new) — the check engine: a `Check` interface
  (`ID() string`, `Run(ctx, Env) Finding`), a self-registering registry, the
  `Finding`/`Severity` types, the runner (collect → sort → exit-code), and the
  human + JSON renderers. Each concrete check is one file (e.g. `check_secrets.go`,
  `check_cert_perms.go`, `check_cors.go`, `check_ports.go`, `check_image_tag.go`,
  `check_datastores.go`, `check_queues.go`, `check_search.go`, `check_admin.go`).
- `server/deploy/README.md` (+ QUICKSTART) — document `doctor` and its exit codes.

The runner is dependency-injected (config snapshot, a Postgres handle, a Valkey
client, a clock) so checks are unit-testable without a live host; the live checks
get a real handle under testcontainers.

### Proto changes

None — `doctor` is a host-local CLI, not an RPC.

### Database changes

None — read-only. It connects with the existing Control DB credentials and issues
only `SELECT`/`PING`-class queries (and `FT.INFO` against Valkey).

### New dependencies

None expected — reuses the existing pgx, go-redis/asynq, and crypto/x509 already
in the module.

### Severity & exit-code model

`Severity` ∈ {`ok`, `info`, `warning`, `critical`}. A *finding* is a `warning` or
`critical` result. Exit: `0` no findings · `1` ≥1 finding · `2` could-not-run
(config load failure, or a check returning an execution error rather than a
verdict). A check whose dependency is down (e.g. Valkey unreachable) returns a
`critical`/`warning` **finding**, not an exit-2 — one dead datastore must not abort
the rest of the suite.

## Security considerations

- **No secret disclosure.** Checks read secret env vars to judge them but emit only
  the variable name + a length/shape verdict; `--json` `detail` is whitelisted per
  check so a value can never leak into machine output or logs.
- **Read-only, least-surprise.** `doctor` opens bounded, short-deadline connections
  and runs only read queries; it cannot change deployment state.
- **Runs as the operator, on the trusted host.** It inherits the operator's access
  to `.env`/certs/DB by design (the operator is trusted — see SECURITY.md *Actors*);
  it is not an attack surface exposed to users.
- **Fail-closed verdicts.** An indeterminate check (can't read a file, can't reach
  a store) is reported as a finding, never silently passed.

## Test requirements

### Unit tests (per check, no live host)

- Static checks (secrets, cert perms, CORS, image tag, ports, admin email) driven
  by a constructed `Env` / temp files: assert the severity and that the message
  names the offending var/file and **never** contains the secret value.
- Severity→exit mapping: a synthetic finding set for each of 0/1/2.
- `--json` shape: schema-asserted (summary counts, findings array, exit_code), and
  that secret values never appear.
- Self-discovering completeness: enumerate the registry; fail if a check has no
  corresponding test (matches-zero guard).

### Integration tests (testcontainers)

- Datastore reachability (criterion 11) against a real Postgres + Valkey, and the
  unreachable path (closed port) → critical finding (not a crash).
- Search health (criterion 13): with the valkey-search container, assert
  missing-index → critical and a stale-reconcile timestamp → warning.
- Queue depth (criterion 12): seed an archived/dead-letter task → warning.

## Rejection paths

| Scenario | Result | Exit |
|----------|--------|------|
| Config / `.env` cannot be loaded | single error finding on stderr (+ JSON if `--json`) | 2 |
| A check errors unexpectedly (panic/IO error not a verdict) | recovered, reported as an execution error; suite continues | 2 (overall) |
| Postgres or Valkey unreachable | `critical` finding for that datastore; other checks still run | 1 |
| Tracked secret is `CHANGE_ME*` / too short | `critical` finding (var named, value withheld) | 1 |
| Everything clean | `ok`/`info` only | 0 |

## Rollout and migration

- Ships in the Control binary; no migration, no config change required to *run* it.
- Recommended in `install.sh`/`setup.sh` as a post-install gate and documented for
  cron/monitoring use via `--json`.
- Additive and read-only — safe to backport to any running deployment.

## References

- [#322](https://github.com/manchtools/power-manage-server/issues/322) — doctor subcommand.
- [Spec template](./01-spec-template.md); `SECURITY.md` (the posture this validates); ADR 0008 (CORS/identity), ADR 0014 (secrets at rest), ADR 0019 (indexer rebuild gate).
- Open design questions for approval: (a) `doctor` subcommand of `power-manage-control` vs a standalone `cmd/doctor` binary — spec assumes the subcommand; (b) the expiry/staleness horizons' defaults (30d / 2× reconcile) and whether they're flags; (c) whether a `--strict` mode should also fail on `info`.
