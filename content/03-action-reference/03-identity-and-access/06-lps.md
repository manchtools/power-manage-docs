---
title: LPS
label: LPS (password rotation)
---
# LPS (Local Password Solution)

Rotates local-account passwords on a schedule. The agent generates a new password, seals it to the control server's public key, ships the sealed value to control, and only then sets it on the target account; control stores it encrypted at rest. Operators list a device's rotation metadata and reveal one individual password when they need to log in locally.

LPS is roughly analogous to Microsoft's LAPS: keep local admin passwords strong, unique per device, and recoverable through a centralised permission-gated path rather than scribbled in a wiki.

<!-- docref: begin src=agent:internal/executor/lps.go#Executor.setupLpsPasswords:3285a1b0 -->
> **LPS will manage any local account you give it — including `root`, service accounts, and humans.** There is no allow-list, no built-in account-class filter, and no "are you sure" prompt. Every name in `usernames` gets its password rotated on schedule. A typo (`postgrs` instead of `postgres`) is skipped with only a warning in the execution output — the account you *meant* to manage silently keeps its old password on every device the action targets. Be deliberate about the list. For service accounts that an application logs into with the password from a config file, rotating *will* break the application — keep LPS for human-and-admin accounts and rotate service-account credentials through their own application path.
<!-- docref: end -->

## Parameters

<!-- docref: begin src=sdk:proto/powermanage/v1/actions.proto#LpsParams:70cc723b,sdk:proto/powermanage/v1/actions.proto#LpsPasswordComplexity:070eabb6 -->
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

1. If a user is unmanaged, generate a password, report the sealed value to the control server, then set it locally.
2. If a user is managed and within the rotation interval, no-op.
3. If the rotation interval has elapsed (or the grace-period rotation triggers), generate a new password, report it, then set it.
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

<!-- docref: begin src=sdk:crypto/field_context.go#FieldSealContext:dc8c1166,sdk:crypto/seal.go#SealToPublicKey:6b2352e6,agent:internal/executor/sealing.go#Executor.sealToControl:95f17a38,agent:internal/executor/lps.go#Executor.setupLpsPasswords:3285a1b0,server:internal/agentsecrets/service.go#Service.StoreLpsPasswords:0a592b91 -->
- Passwords flow **agent → control**, sealed to control's pinned X25519
  recipient key before they leave the device. Sealing is the SDK's generic
  versioned field seal, not an LPS-specific routine: the context binds the
  transport direction, the protobuf message and field name, and the device,
  action, and username, into both the AAD and the HKDF domain, so a sealed
  password cannot be replayed into another field, device, action, or account.
  The agent reports the sealed value to control **before** setting the new
  password locally — a report that fails leaves the account's old password in
  place rather than stranding a credential the operator can never recover.
  Control opens the envelope only at the narrow `openAgentField` sink and
  immediately re-encrypts the plaintext for at-rest storage.
<!-- docref: end -->
<!-- docref: begin src=server:internal/device/secrets.go#Handlers.ListLpsPasswords:29c2366e,server:internal/device/secrets.go#Handlers.RevealLpsPassword:c699cfdf,server:internal/device/secrets.go#Handlers.recordSecretReveal:09f0a4fb,server:internal/store/audit.go#AuditEffect:4a8afbb5 -->
- **Retrieval is split into a metadata list and an explicit one-entry reveal.**
  `ListLpsPasswords` takes a device ID and returns current plus bounded history
  entries — entry ID, device, action, username, rotation time, rotation reason.
  Its store query does not select ciphertext, so listing decrypts nothing.
  `RevealLpsPassword` takes exactly one entry ULID and returns exactly that one
  plaintext. There is no bulk retrieval and no way to dump a device's password
  history in one call.
- The two carry **separate RBAC permissions** (`ListLpsPasswords` and
  `RevealLpsPassword`), so read-the-inventory and read-the-secret are grantable
  independently. Both are audited: listing records a sensitive-read operation
  against the device, and each reveal records its own sensitive-read operation
  with effects naming the LPS entry, the device, and the action. The audit log
  cannot carry the password itself — an audit effect has no free-form value
  field at all, only field *names*, references, flags, counts, non-reversible
  digests, and per-subject sealed detail.
<!-- docref: end -->
- The target accounts have to exist before LPS runs. A listed user that doesn't exist is skipped with a warning; LPS never creates accounts. If you're managing both, put a `USER` action ahead of LPS in the same action set.
<!-- docref: begin src=agent:internal/executor/lps.go#Executor.setupLpsPasswords:3285a1b0,agent:internal/executor/lps.go#killUserSessions:17ecd89e -->
- After rotation, affected users get a desktop notification and a 60-second grace period, then their sessions and processes are terminated. If an operator is logged in via SSH when rotation fires, they'll be disconnected. Plan rotation cadence around that.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/lps.go#shouldRotateLps:93e98077,sdk:sys/user/sessions.go#shadowUtils.LastLogin:af832950 -->
- The grace-period trigger observes **logins only**, via the `last` wtmp records (not syslog, and not sudo events). On devices where wtmp isn't populated (some containers, minimal images), the user never appears to log in and the grace period silently never fires.
<!-- docref: end -->
