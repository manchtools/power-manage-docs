---
title: AGENT_UPDATE
---
# AGENT_UPDATE

Updates the agent binary itself. The agent downloads the new binary, verifies
its SHA-256 against a checksum file or the hash carried in the authenticated
delivery, runs a self-test, and swaps the binary in place. Failed self-tests
keep the old binary running.

<!-- docref: begin src=agent:internal/executor/action_service.go#Executor.executeService:c2202793 -->
This is the *only* way the agent rolls itself forward in a fleet. There's no other path: distro packages aren't shipped, and `SERVICE` refuses to manage `power-manage-agent.service`.
<!-- docref: end -->

## Parameters

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#AgentUpdateParams:c7480e9b,sdk:proto/pm/v1/actions.proto#AgentUpdateArch:c166c386,server:internal/api/action_validators.go#validateAgentUpdateParams:c528275a -->
| Field | Type | Required | Description |
|---|---|---|---|
| `amd64` | object | no\* | Binary source for x86_64. |
| `amd64.binary_url` | string | yes if `amd64` set | HTTPS URL to the agent binary. |
| `amd64.checksum_url` | string | no\*\* | HTTPS URL to a SHA256SUMS-style checksum file. The default integrity source — lets an action track "latest" release assets hands-off. |
| `amd64.expected_sha256` | string | no\*\* | Pinned SHA-256 of the binary, 64 lowercase hex chars. When set it is authoritative and **overrides** `checksum_url`; it arrives over the direct authenticated control stream. |
| `arm64` | object | no\* | Binary source for arm64. Same sub-fields as `amd64`. |
| `allow_downgrade` | bool | no | Install even if the target version is older than the running one. Without it the agent refuses a downgrade (anti-rollback). |
| `allow_redirect` | bool | no | Follow a redirect that changes host or scheme during download (e.g. GitHub release assets 302 to a CDN host). Default false: a cross-origin redirect is refused. SHA-256 verification and the https-only rule still apply either way. |

\* At least one of `amd64` or `arm64` must be set.
\*\* Per architecture, at least one of `checksum_url` or `expected_sha256` must be set — the server rejects an action with neither, so an update can never run without an integrity check.
<!-- docref: end -->

## How it works

<!-- docref: begin src=agent:internal/executor/agent_update.go#Executor.executeAgentUpdate:3dca9d56,agent:internal/executor/agent_update.go#compareAgentVersion:708de6c1 -->
1. The agent reads its own architecture and picks the matching entry. If there's no entry for this arch, the action exits with `changed=false` and a noted skip.
2. It determines the expected hash: `expected_sha256` from the delivery when present; otherwise it fetches the checksum file and selects the entry whose filename matches the binary URL. All URLs must be HTTPS.
3. It downloads the binary to a staging directory and verifies the SHA-256. A mismatch aborts before anything runs.
4. It runs the downloaded binary's `version` command and compares with the running version. Same version → `changed=false`, done. An **older** version is refused unless `allow_downgrade` is set on the action (anti-rollback); an unparseable version fails closed.
5. It runs the new binary in a subprocess as `power-manage-agent self-test` with a 60-second timeout. The self-test exercises the same wiring the new binary will need in production — see [below](#what-the-self-test-actually-does).
6. If the self-test passes, the agent copies the current binary to `<path>.bak` (manual rollback: restore it and restart the service) and atomically swaps in the new binary.
7. It invokes the **new** binary's `install-unit`, refreshing the systemd unit from the template embedded in the new binary (fail-open — a unit failure never aborts a completed swap), then restarts itself: the respawn picks up binary and unit together.
8. If the self-test fails, the new binary is discarded and the old one keeps running.
<!-- docref: end -->

### What the self-test actually does

<!-- docref: begin src=agent:cmd/power-manage-agent/cmd_selftest.go#runSelfTest:6ab4e9c7 -->
The subprocess walks four checks in order and exits non-zero on the first failure:

1. **Credentials load.** The new binary reads the agent's mTLS key + certificate from disk and parses them. Catches enrolment-state issues that would prevent the binary from connecting at all.
2. **mTLS handshake.** It dials the configured control endpoint and completes
   the authenticated TLS handshake. This catches CA-trust drift, certificate
   expiry, and endpoint regressions.
3. **Bidirectional stream.** It opens the agent RPC, sends `Hello`, and
   verifies `Welcome`. This catches contract mismatches between agent and
   control.
4. **`SyncActions` round-trip.** It calls `SyncActions` to confirm the new binary can fetch its assignment set. Catches RPC-surface regressions before the binary takes over.

Anything that fails surfaces as the test exit code; the running binary captures stdout/stderr from the subprocess into the execution event so you can see *what* failed. Side note: the self-test connects with the live agent's device identity, so the running agent briefly disconnects (a few seconds) while the probe holds the stream.
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/agent_update.go#Executor.executeAgentUpdate:3dca9d56 -->
The agent compares the downloaded binary's reported version against its own running version. Equal means `changed=false`. A newer version triggers the self-test and swap.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/agent_update.go#Executor.ResetUpdateCycle:fccb41a8,agent:internal/executor/agent_update.go#Executor.markAgentUpdateExecuted:0b162db5 -->
Multiple `AGENT_UPDATE` actions in one [reconciliation cycle](/concepts/reconciliation) deduplicate to one execution.
<!-- docref: end -->

## Example

```yaml
type: AGENT_UPDATE
amd64:
  binary_url: https://updates.power-manage.example/agent/2026.06.0/power-manage-agent.amd64
  checksum_url: https://updates.power-manage.example/agent/2026.06.0/SHA256SUMS
arm64:
  binary_url: https://updates.power-manage.example/agent/2026.06.0/power-manage-agent.arm64
  checksum_url: https://updates.power-manage.example/agent/2026.06.0/SHA256SUMS
```

## Gotchas

<!-- docref: begin src=agent:internal/executor/agent_update.go#Executor.executeAgentUpdate:3dca9d56 -->
- A failing self-test **fails the action**: the execution reports `FAILED` with the self-test's output in the execution event, and the old binary keeps running. Fix the underlying issue and let the next run retry.
- No cooldown between retries. Retry frequency is governed entirely by the action's schedule — if the target version is broken and the action runs every 30 minutes, the agent re-downloads and re-tests it every 30 minutes until a fixed release is published or you cancel the assignment.
<!-- docref: end -->
- The checksum file is the same for both architectures by convention; the agent searches it for the filename matching its binary URL.
- A successful self-update restarts the agent process. The current mTLS stream drops and reconnects on the new binary. Operators watching the device's "online" status will see a brief offline blip (the self-test itself also causes one).
<!-- docref: begin src=agent:internal/scheduler/scheduler.go#Scheduler.runDueActions:615f76e3 -->
- Maintenance windows **do apply**: a scheduled `AGENT_UPDATE` defers like any other due action while the window is closed. Only stream-dispatched instant actions (e.g. "reboot now") bypass the window.
<!-- docref: end -->
