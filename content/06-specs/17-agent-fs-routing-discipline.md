---
title: "Agent filesystem-routing discipline + package-manager detection"
status: implemented
created: 2026-06-29
---

# Agent filesystem-routing discipline + package-manager detection

## Overview

Two archtest fitness functions in the agent (`TestNoDirectOSIOInSensitivePaths`
and `TestNoRedundantPackageManagerLookPath`) currently fail against pre-existing
production code: 34 direct `os.*` filesystem calls in `internal/executor/` and
`internal/credentials/` that bypass the SDK fs Manager, and 3 `exec.LookPath`
calls for package-manager binaries the SDK already detects. This spec decides,
per call-site category, which calls must route through the privilege-aware SDK fs
Manager (so a future non-root agent and the sudo/fd backend are honored), and
which are legitimately direct and must be exempted **with a documented reason**.
It also corrects the fitness functions so the exemptions are self-discovering and
fail-closed, not a blanket allowlist.

## Motivation

The fitness functions encode a real invariant: operator-targeted file I/O in
action handlers must honor the configured privilege backend, or a non-root agent
silently loses access to privileged files and idempotency/existence checks return
wrong answers. But the functions are currently over-broad — they also flag
agent-private I/O where direct `os.*` is correct and, in one case, security-load-
bearing:

- The local **credential store** (`internal/credentials/credentials.go`)
  deliberately uses raw `os.Stat`/`os.Chmod` to enforce its owner-only-writable
  guard (`info.Mode().Perm()&0o022`, WS10 #1/#2). The fs Manager wrappers discard
  mode bits, so "converting" these would *delete* the forgeable-store defense.
- Package/AppImage/agent-update handlers `os.CreateTemp` an **agent-private temp
  path**, download a checksum-verified artifact into it, then hand it to an
  escalated `dpkg`/`rpm`/exec. The security boundary is the checksum + the
  escalated install, not the temp create; routing a private mkstemp through the
  sudo backend buys nothing.

Leaving the tests red trains everyone to ignore them. The fix is to make the
production code correct **and** make the fitness functions assert the real
invariant (privilege-routed I/O on operator paths; justified, enumerated
exceptions for agent-private I/O).

## Acceptance criteria

1. Given an executor action handler that reads, writes, deletes, stats, or
   mkdirs an **operator-specified path** (file/directory/user/service actions),
   when it performs that I/O, then it routes through an `fs.go` wrapper
   (`readFileWithSudo`/`fileExistsWithSudo`/`atomicWriteFile`/`removeFileStrict`/
   `createDirectory`/`statFile`) rather than a direct `os.*` call.
2. Given `fileMatchesDesired`/`directoryMatchesDesired` need file metadata
   (mode/IsRegular), when they check it, then a new `fs.go` wrapper returns that
   metadata through the SDK fs Manager, and the functions take a `context.Context`
   so the call is cancellation-bound (no `context.Background()` introduced).
3. Given the `dpkg`, `rpm`, and `flatpak` presence checks in
   `action_deb.go`/`action_rpm.go`/`action_flatpak.go`, when they decide whether
   to skip on an unsupported host, then they consult SDK detection — `pkg.Detect`
   membership (deb→`Apt`, rpm→`Dnf`/`Zypper`, flatpak→`Flatpak`) — instead of
   `exec.LookPath`, preserving the existing "skipped: … not available" output.
   `flatpak` is a first-class `pkg.Backend` that `pkg.Detect` already enumerates,
   so it is converted, NOT exempted; there are **zero** `LookPath` exemptions.
4. Given the agent-private I/O sites (credential-store perms guard,
   artifact-staging temp files and their cleanup, agent self-update state files),
   when the fitness functions run, then each site is exempted by an **enumerated
   allowlist entry carrying a justification**, and a newly-introduced unexplained
   `os.*` call still fails the test (fail-closed).
5. Given the credential store's owner-only-writable guard, when the refactor is
   complete, then `requireOwnerOnlyDir`/`Save` still inspect `info.Mode().Perm()`
   via raw stat (the WS10 #1/#2 defense is unchanged).
6. Given an artifact-staging site, when it stages a download, then the staged file
   is created owner-only in the agent's temp dir and removed on completion (no
   behavioral change to checksum verification or escalated install).
7. Given `TestNoDirectOSIOInSensitivePaths` and
   `TestNoRedundantPackageManagerLookPath`, when run after the change, then both
   pass with zero unexplained findings and retain their matches-zero guards.
8. Given the existing executor unit and container/integration suites, when run
   after the change, then they remain green (no behavioral regression in file,
   directory, package, or self-update actions).

## Out of scope

- Changing the SDK `sys/fs` Manager's API or privilege model. New wrappers live
  in the agent's `fs.go` and call existing `fsMgr` methods (plus one metadata
  read — see Technical design).
- Making the agent actually run non-root. This refactor *enables* it by routing
  I/O correctly; it does not flip the runtime.
- The reboot-path safety work (already shipped: FakeRunner reboot test +
  destructive-integration container guard + `scheduleRebootAfterUpdate` nil-runner
  guard).
- Any change to credential-store cryptography, machine-id binding, or KDF.

## Technical design

### Affected packages

- `agent/internal/executor/fs.go` — add `statFile(ctx, path)` returning
  the metadata needed by idempotency checks (existence + mode) through the SDK fs
  Manager; add a temp-staging helper only if review shows the artifact sites are
  cleaner with one (otherwise they are exempted, not converted).
- `agent/internal/executor/action_file.go`, `action_directory.go`,
  `action_user.go`, `action_service.go` — convert operator-path `os.*` to
  wrappers; thread `ctx` into `*MatchesDesired` helpers.
- `agent/internal/executor/action_deb.go`, `action_rpm.go`,
  `action_flatpak.go` — `dpkg`/`rpm`/`flatpak` presence via `pkg.Detect`
  membership; artifact-staging temp files exempted (justified).
- `agent/internal/executor/action_appimage.go`, `agent_update.go` —
  agent-private staging/state exempted (justified); any operator-path I/O
  converted.
- `agent/internal/credentials/credentials.go` — **no production change**; the
  package's perms-guard `os.*` calls are exempted in the fitness function.
- `agent/internal/archtest/no_direct_os_io_test.go`,
  `no_redundant_lookpath_test.go` — add the justified, enumerated exemption
  allowlist + keep the matches-zero guard.

### Call-site categorization (the heart of this spec)

| Site | Category | Action |
|------|----------|--------|
| `action_file.go:103` `os.Stat` (ABSENT existence) | operator path | → `fileExistsWithSudo` |
| `action_file.go:179` `os.Stat` (mode/IsRegular) | operator path | → `statFile` (new) |
| `action_file.go:190` `os.ReadFile` | operator path | → `readFileWithSudo` (thread ctx) |
| `action_directory.go:86,114` `os.Stat` | operator path | → `fileExistsWithSudo`/`statFile` |
| `action_user.go:508` `os.Stat` (`setUserHidden`) | operator path | → `fileExistsWithSudo`/`statFile` |
| `action_service.go:53` `os.ReadFile` | operator path | → `readFileWithSudo` |
| `action_deb.go:76,158` / `action_rpm.go:60,109` `os.CreateTemp` + paired `os.Remove` | agent-private staging | **exempt (justified)** |
| `agent_update.go:142` `os.MkdirAll`, `:146` `os.CreateTemp`, `:152` `os.Remove`, `:265` `os.ReadFile` | agent-private staging | **exempt (justified)** |
| `agent_update.go:440` `os.ReadFile`, `:461`/`:521` `os.Remove` (update-state) | agent-private state | **exempt (justified)** |
| `credentials.go` (11 sites) | agent-private, perms-critical | **exempt (justified)** |
| `action_deb.go:50` `LookPath("dpkg")` | redundant detection | → `pkg.Detect` membership (`Apt`) |
| `action_rpm.go:32` `LookPath("rpm")` | redundant detection | → `pkg.Detect` membership (`Dnf`/`Zypper`) |
| `action_flatpak.go:45` `LookPath("flatpak")` | redundant detection (`pkg.Flatpak` exists, `Detect` enumerates it) | → `pkg.Detect` membership (`Flatpak`) |

`appimage`/`Open`/`Chmod` and any site not yet line-pinned above are categorized
during TEST/IMPLEMENT by the same rule: **operator-specified path → convert;
agent-private file → exempt with a reason.**

### Proto changes

None. No request/response shape changes.

### Database changes

None.

### New dependencies

None. `statFile` uses the existing `fsMgr`; if the SDK fs Manager lacks a
metadata read, the wrapper falls back to a raw `os.Stat` *inside `fs.go`* (already
an exempt wrapper file) and is documented as the single sanctioned metadata-read
chokepoint.

## Security considerations

- **Authorization:** unchanged. These are agent-local action handlers already
  gated by signed-envelope verification upstream.
- **Input validation:** unchanged. Protected-path delete refusal
  (`isProtectedPath`) and checksum verification of staged artifacts MUST remain
  exactly as-is; criterion 6/8 pin this.
- **Secrets:** the credential store's owner-only guard and 0600/0700 perms are
  load-bearing (WS10). Criterion 5 forbids weakening them — the exemption exists
  precisely so the raw mode inspection survives.
- **Audit:** unchanged.
- **Fail-closed:** the fitness-function exemptions are an *enumerated* allowlist
  with a matches-zero guard, so a future unexplained direct `os.*` call fails the
  build rather than slipping in under a blanket skip.

## Test requirements

### Fitness-function tests (the spec's primary gate)

- `TestNoDirectOSIOInSensitivePaths` passes with the exemption allowlist; a
  deliberately-added unexplained `os.Remove` in a converted file makes it fail
  (red-check the allowlist is not fail-open).
- `TestNoRedundantPackageManagerLookPath` passes; re-adding `LookPath("dpkg")`
  fails it.
- Both retain the existing `matches-zero` guard (walking zero files fails).

### Handler behavior tests

- File/directory/user/service idempotency (`*MatchesDesired`) and ABSENT-existence
  paths keep their current truth tables after ctx threading and wrapper routing —
  covered by existing unit tests; add cases where the wrapper is exercised via a
  fake fs Manager if a gap exists.
- `action_deb`/`action_rpm` "skipped on unsupported host" output is unchanged when
  `e.pkgBackend` indicates the format is absent (unit test with a non-matching
  backend).

### Integration tests

- Existing container/integration suites (file/dir/package/self-update) stay green;
  they are the real proof that privilege-routed I/O behaves identically on a root
  container. Run in the container lane (host run is now guarded).

## Rejection paths

Internal refactor — no new user-facing error surface. The invariants that must
NOT regress:

| Scenario | Required behavior | Logged context |
|----------|-------------------|----------------|
| ABSENT delete targets a protected system path | refused before any I/O (`isProtectedPath`) | refusal with resolved + original path |
| Credential-store dir is group/world-writable | `Save`/load fail closed (raw mode check) | `store directory … is group/world-writable` |
| Staged artifact fails checksum | install aborted, temp removed | download/verify error |
| fs Manager read fails on a privileged file as non-root agent | surfaced as an error, not a silent "absent"/"matches" | wrapper error |

## Rollout and migration

No migration, no config, backward-compatible. Ships as ordinary agent code.
Land per-file in small commits (one handler file + its tests at a time), each
keeping both fitness functions and the unit suite green, so a regression bisects
to one file.

## Implementation notes

Landed as designed. Two things worth recording:

- **Behavior change (intended): deb/rpm skip now keys on the SDK backend, not the
  raw binary.** A host with a stray `dpkg` binary but no `apt-get` (e.g. a dnf box
  that installed `dpkg` for cross-distro tooling) is no longer treated as
  deb-capable — the DEB action skips. This is more correct (a dnf box is not
  deb-managed) and is the direct consequence of `pkg.Detect`→`Apt` membership. The
  host-conditional `distro_skip_test.go` gates were updated to mirror the new
  predicate (`debCapable`/`rpmCapable`/`flatpakCapable`) so the test skip-logic
  matches production exactly. `flatpak` detection is unchanged in effect
  (`pkg.Detect` probes the `flatpak` binary).
- **Verification.** `go vet` (both tag sets), `gofmt`, the whole-module build, the
  executor unit suite, and both fitness functions are green on the host. The
  privilege-routed I/O behaving identically on a real root filesystem is proven by
  the **container/integration suite**, which is container-only (and now guarded
  against host runs) — it must be run in CI's `docker run` lane to close criterion 8.

The `agentPrivate` allowlist in `no_direct_os_io_test.go` was red-checked both
ways: a decoy operator-path `os.Stat` is flagged (fail-closed), and a bogus
allowlist key is reported stale (`assertNoStale`).

## References

- `agent/internal/archtest/no_direct_os_io_test.go`,
  `no_redundant_lookpath_test.go` — the fitness functions.
- WS10 secrets-at-rest (credential-store owner-only guard).
- WS6 fd-based fs hardening (privilege-backend-keyed fs ops).
- Spec 12 (agent spec), ADR 0012 (operator-choice repo config).
