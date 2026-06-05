---
title: LPS
label: LPS (password rotation)
---
# LPS (Local Password Solution)

Rotates local-account passwords on a schedule. The agent generates a new password, sets it on the target account, and ships the new value back to the control server where it's stored encrypted at rest. Operators can retrieve the current password through the web UI when they need to log in locally.

LPS is roughly analogous to Microsoft's LAPS: keep local admin passwords strong, unique per device, and recoverable through a centralised audit-logged path rather than scribbled in a wiki.

> **LPS will manage any local account you give it — including `root`, service accounts, and humans.** There is no allow-list, no built-in account-class filter, and no "are you sure" prompt. Every name in `usernames` gets its password rotated on schedule. A typo (`postgrs` instead of `postgres`) will silently create / disable / lock-out the wrong account on every device the action targets. Be deliberate about the list. For service accounts that an application logs into with the password from a config file, rotating *will* break the application — keep LPS for human-and-admin accounts and rotate service-account credentials through their own application path.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `usernames` | string[] | yes | — | Target user accounts on the device. Each 1–32 chars. The action manages every user in the list. |
| `password_length` | int32 | yes | — | Length of generated passwords. 8–128. |
| `complexity` | enum | yes | — | `ALPHANUMERIC` (a-z, A-Z, 0-9) or `COMPLEX` (adds special chars). |
| `rotation_interval_days` | int32 | yes | — | Days between scheduled rotations. 1–365. |
| `grace_period_hours` | int32 | no | `0` | Hours after a noted auth event before triggering an out-of-schedule rotation. `0` disables. Max 8760. |

## Idempotency

The agent tracks per-user rotation state in a local SQLite store. On every [reconciliation tick](/concepts/reconciliation):

1. If a user is unmanaged, generate a password and set it. Send the new value back to the control server.
2. If a user is managed and within the rotation interval, no-op.
3. If the rotation interval has elapsed (or the grace-period rotation triggers), generate a new password, set it, and send it back.

`desired_state: ABSENT` clears the agent's local state for the listed users but doesn't reset their passwords. The accounts and their last-rotated passwords remain valid until something else changes them.

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

- Passwords flow control → agent in cleartext over the mTLS stream. They never appear in the audit log. Only "rotation occurred" events do.
- The target accounts have to exist before LPS runs. If you're managing both, put a `USER` action ahead of LPS in the same action set.
- After rotation, active user sessions on the device get killed. If an operator is logged in via SSH when rotation fires, they'll be disconnected. Plan rotation cadence around that.
- The grace-period feature requires the agent to observe auth events (login / sudo). Detection happens via syslog; on devices without those logs configured, the grace period is silently ignored.
