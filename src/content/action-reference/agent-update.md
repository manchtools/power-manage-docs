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
4. It writes the new binary alongside the running one, makes it executable, and runs a 55-second self-test in a subprocess. The self-test validates credentials, mTLS, the stream, and `SyncActions`.
5. If the self-test passes, the agent swaps the binary atomically (rename) and restarts itself.
6. If the self-test fails, the new binary is discarded and the old one keeps running.

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
- No cooldown between retries. If the action's assignment is on a 5-minute reconciliation tick, the agent will retry every 5 minutes until success or you cancel.
- The checksum file is the same for both architectures by convention; the agent searches for the filename matching its binary URL.
- A successful self-update restarts the agent process. The current mTLS stream drops and reconnects on the new binary. Operators watching the device's "online" status will see a brief offline blip.
- Maintenance windows do *not* apply. `AGENT_UPDATE` is treated as critical-path security work and runs as soon as it's available.
