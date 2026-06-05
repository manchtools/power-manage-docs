---
title: AGENT_UPDATE
---
# AGENT_UPDATE

Updates the agent binary itself. The agent downloads the new binary, verifies its SHA-256 against a checksum file, runs a self-test, and swaps the binary in place. Failed self-tests keep the old binary running.

This is the *only* way the agent rolls itself forward in a fleet. There's no other path: distro packages aren't shipped, and `SERVICE` is forbidden from managing `power-manage-agent.service`.

## Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `amd64` | object | no\* | Binary + checksum URLs for x86_64. |
| `amd64.binary_url` | string | yes if `amd64` set | HTTPS URL to the agent binary. |
| `amd64.checksum_url` | string | yes if `amd64` set | HTTPS URL to a SHA-256 checksum file. |
| `arm64` | object | no\* | Binary + checksum URLs for arm64. |
| `arm64.binary_url` | string | yes if `arm64` set | HTTPS URL to the agent binary. |
| `arm64.checksum_url` | string | yes if `arm64` set | HTTPS URL to a SHA-256 checksum file. |

\* At least one of `amd64` or `arm64` must be set.

## How it works

1. The agent reads its own architecture and picks the matching entry. If there's no entry for this arch, the action exits with `changed=false` and a noted skip.
2. It fetches the binary and the checksum file from the URLs. Both must be HTTPS.
3. The agent parses the checksum file (sha256sums format) and verifies the binary's hash against the entry whose filename matches the binary URL.
4. It writes the new binary alongside the running one, makes it executable, and runs it in a subprocess as `power-manage-agent --self-test` with a 60-second timeout. The self-test exercises the same wiring the new binary will need in production — see [below](#what-the-self-test-actually-does).
5. If the self-test passes, the agent swaps the binary atomically (rename) and restarts itself.
6. If the self-test fails, the new binary is discarded and the old one keeps running.

### What the self-test actually does

The subprocess walks four checks in order and exits non-zero on the first failure:

1. **Credentials load.** The new binary reads the agent's mTLS key + certificate from disk and parses them. Catches enrolment-state issues that would prevent the binary from connecting at all.
2. **mTLS handshake.** It dials the gateway URL the agent is currently using and completes a TLS handshake with `https://` enforced (an `http://` gateway URL is a hard failure here). Catches CA-trust drift, cert expiry, gateway address regressions.
3. **Bidirectional stream.** It opens the streaming RPC, sends `Hello`, and verifies it receives `Welcome` back. Catches proto mismatches between agent and gateway.
4. **`SyncActions` round-trip.** It calls `SyncActions` to confirm the new binary can fetch its assignment set. Catches RPC-surface regressions before the binary takes over.

Anything that fails surfaces as the test exit code; the running binary captures stdout/stderr from the subprocess into the execution event so you can see *what* failed.

## Idempotency

The agent compares the to-be-installed binary's checksum against its own running version. Match means `changed=false`. Mismatch triggers the self-test.

Multiple `AGENT_UPDATE` actions in one [reconciliation cycle](/concepts/reconciliation) deduplicate to one execution.

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

- A failing self-test isn't an error in the audit-log sense. The agent reports `changed=false` and notes the failure in the execution event. Fix the underlying issue and dispatch a new `AGENT_UPDATE`.
- No cooldown between retries. The agent retries on every reconciliation tick (default 30 minutes) until the action succeeds or you cancel the assignment.
- The checksum file is the same for both architectures by convention; the agent searches for the filename matching its binary URL.
- A successful self-update restarts the agent process. The current mTLS stream drops and reconnects on the new binary. Operators watching the device's "online" status will see a brief offline blip.
- Maintenance windows do *not* apply. `AGENT_UPDATE` is treated as critical-path security work and runs as soon as it's available.
