---
title: LPS
label: LPS (password rotation)
---
# LPS (Local Password Solution)

Rotates local-account passwords on a schedule. The agent generates a new password, seals it to the control server's public key, sets it on the target account, and ships the sealed value back to the control server where it's stored encrypted at rest. Operators can retrieve the current password through the web UI when they need to log in locally.

LPS is roughly analogous to Microsoft's LAPS: keep local admin passwords strong, unique per device, and recoverable through a centralised permission-gated path rather than scribbled in a wiki.

<!-- docref: begin src=agent:internal/executor/lps.go#Executor.setupLpsPasswords:daa2a2c0 -->
> **LPS will manage any local account you give it — including `root`, service accounts, and humans.** There is no allow-list, no built-in account-class filter, and no "are you sure" prompt. Every name in `usernames` gets its password rotated on schedule. A typo (`postgrs` instead of `postgres`) is skipped with only a warning in the execution output — the account you *meant* to manage silently keeps its old password on every device the action targets. Be deliberate about the list. For service accounts that an application logs into with the password from a config file, rotating *will* break the application — keep LPS for human-and-admin accounts and rotate service-account credentials through their own application path.
<!-- docref: end -->

## Parameters

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#LpsParams:70cc723b,sdk:proto/pm/v1/actions.proto#LpsPasswordComplexity:070eabb6 -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `usernames` | string[] | yes | — | Target user accounts on the device. Each 1–32 chars. The action manages every user in the list. |
| `password_length` | int32 | yes | — | Length of generated passwords. 8–128. |
| `complexity` | enum | yes | — | `ALPHANUMERIC` (a-z, A-Z, 0-9) or `COMPLEX` (adds special chars). |
| `rotation_interval_days` | int32 | yes | — | Days between scheduled rotations. 1–365. |
| `grace_period_hours` | int32 | no | `0` | Hours after an observed login before triggering an out-of-schedule rotation. `0` disables. Max 8760. |
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/lps.go#shouldRotateLps:93e98077 -->
The agent tracks per-user rotation state in a local SQLite store. On every [reconciliation tick](/concepts/reconciliation):

1. If a user is unmanaged, generate a password and set it. Send the sealed value back to the control server.
2. If a user is managed and within the rotation interval, no-op.
3. If the rotation interval has elapsed (or the grace-period rotation triggers), generate a new password, set it, and send it back.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/lps.go#Executor.removeLpsManagement:73ebd6e8 -->
`desired_state: ABSENT` clears the agent's local state for the listed users but doesn't reset their passwords. The accounts and their last-rotated passwords remain valid until something else changes them.
<!-- docref: end -->

## Example

Rotate the root and `ops` passwords every 30 days, 24-char complex:

```yaml
type: LPS
usernames:
  - root
  - ops
password_length: 24
complexity: COMPLEX
rotation_interval_days: 30
desired_state: PRESENT
```

## Gotchas

<!-- docref: begin src=sdk:crypto/lps.go#SealLpsPassword:94af0f03,agent:internal/executor/lps.go#Executor.setupLpsPasswords:daa2a2c0,server:internal/api/internal_handler.go#InternalHandler.ProxyStoreLpsPasswords:da6698e9 -->
- Passwords flow **agent → control**, sealed to the control server's X25519 LPS public key before they leave the device — the relaying gateway carries an opaque blob it cannot open. The seal is bound to (device, action, username), so a blob can't be replayed into another record. The agent seals *before* setting the password locally: if it can't seal (no verified control key yet), it refuses to rotate rather than strand a credential. Control unseals and re-encrypts with its at-rest key.
<!-- docref: end -->
<!-- docref: begin src=server:internal/api/audit_handler.go#eventRedactionSchemas:dd5d7439,server:internal/api/device_handler.go#DeviceHandler.GetDeviceLpsPasswords:fabbbb9d -->
- Passwords never appear in the audit log — the rotation event's password field is redacted from the audit API; only "rotation occurred" is visible. Retrieval goes through `GetDeviceLpsPasswords`, gated on the dedicated `GetDeviceLpsPasswords` permission. Note that retrievals themselves are not currently written to the audit log.
<!-- docref: end -->
- The target accounts have to exist before LPS runs. A listed user that doesn't exist is skipped with a warning; LPS never creates accounts. If you're managing both, put a `USER` action ahead of LPS in the same action set.
<!-- docref: begin src=agent:internal/executor/lps.go#Executor.setupLpsPasswords:daa2a2c0,agent:internal/executor/lps.go#killUserSessions:17ecd89e -->
- After rotation, affected users get a desktop notification and a 60-second grace period, then their sessions and processes are terminated. If an operator is logged in via SSH when rotation fires, they'll be disconnected. Plan rotation cadence around that.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/lps.go#shouldRotateLps:93e98077,sdk:sys/user/sessions.go#shadowUtils.LastLogin:af832950 -->
- The grace-period trigger observes **logins only**, via the `last` wtmp records (not syslog, and not sudo events). On devices where wtmp isn't populated (some containers, minimal images), the user never appears to log in and the grace period silently never fires.
<!-- docref: end -->
