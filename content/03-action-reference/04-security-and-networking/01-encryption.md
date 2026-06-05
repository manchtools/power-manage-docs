---
title: ENCRYPTION
label: ENCRYPTION (LUKS)
---
# ENCRYPTION (LUKS)

Rotates the passphrase on an encrypted root volume. The agent generates a new passphrase, enrols it in a LUKS keyslot, optionally enrols a device-bound key (TPM or user-chosen passphrase), and ships the managed passphrase back to the control server for recovery.

> **GELI and CGD are abstraction placeholders, not shipping backends.** The proto carries `GELI` (FreeBSD) and `CGD` (NetBSD) enum values to keep the interface neutral as those distros come into scope. Selecting them today is accepted by validation but fails at execution time — every operation in the agent's encryption path is gated on `BackendLUKS` and returns `ErrBackendNotSupported`. Treat the backend dimension as "LUKS only" for the 2026.06/07 window.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `preshared_key` | string | yes | — | Pre-shared passphrase used for initial ownership. Once the agent has rotated to a managed passphrase, the PSK is no longer needed. 1–256 chars. |
| `rotation_interval_days` | int32 | yes | — | Days between scheduled passphrase rotations. 1–365. |
| `min_words` | int32 | no | `5` | Minimum word count in the generated passphrase. 3–10. |
| `device_bound_key_type` | enum | no | `NONE` | `NONE` (passphrase only), `TPM` (TPM2 auto-unlock), or `USER_PASSPHRASE` (a user-supplied secondary passphrase). |
| `user_passphrase_min_length` | int32 | no | `16` | Min length for the user passphrase. 16–128. Only used when `device_bound_key_type=USER_PASSPHRASE`. |
| `user_passphrase_complexity` | enum | no | `ALPHANUMERIC` | `ALPHANUMERIC` or `COMPLEX`. Only used when `device_bound_key_type=USER_PASSPHRASE`. |
| `backend` | enum | no | `LUKS` | `LUKS` (default and the only working value). `GELI` and `CGD` are reserved enum slots; selecting one fails at run time. |

## Idempotency

The agent auto-detects the primary encrypted volume on first run. Subsequent runs:

1. Check the local rotation-state store. If never managed, take ownership using `preshared_key`, generate a managed passphrase, enrol it, and send it back to the control server.
2. If managed and within the rotation interval, no-op.
3. If the rotation interval elapsed, derive a new passphrase, swap keyslots atomically (new slot enrolled before the old slot is wiped), and send the new value back.

The TPM enrolment (when `device_bound_key_type=TPM`) goes into slot 7 and isn't rotated on schedule. The TPM seal stays valid as long as PCRs haven't changed.

## Keyslot layout

LUKS2 has eight slots (0–7). The agent uses them as follows:

| Slot(s) | Role | Set by | Lifecycle |
|---|---|---|---|
| 0–6 | **Managed passphrase.** The server-stored secret the agent rotates on schedule. | `cryptsetup luksAddKey` without an explicit slot — cryptsetup picks the lowest free slot. | Rewritten every `rotation_interval_days`; old slot wiped only after the new one verifies. |
| 7 | **Device-bound key.** Either TPM-sealed (auto-unlock) or a user-chosen passphrase. | `systemd-cryptenroll --tpm2-device=auto --tpm2-pcrs=7+14` (TPM) or `cryptsetup luksAddKey ... --key-slot 7` (user). | Set once during enrolment; replaced on re-enrolment; not touched by scheduled rotation. |

A device with `device_bound_key_type=NONE` simply leaves slot 7 empty.

The pre-shared key from the action's `preshared_key` field is consumed during the very first rotation: the agent uses it to authenticate against an existing keyslot, adds the new managed passphrase to a fresh slot (0–6), then wipes the PSK slot. After that, the PSK is gone from the device and not retrievable from the server.

## Setting a USER_PASSPHRASE

`device_bound_key_type=USER_PASSPHRASE` is an opt-in second-factor flow. The action carries the *policy* (min length, complexity, enabled flag); the *passphrase itself* is set interactively on the device by the user, not pushed from the server.

The flow is:

1. The operator assigns an `ENCRYPTION` action with `device_bound_key_type=USER_PASSPHRASE`.
2. The operator issues the user a one-shot enrolment token from the device-detail page in the web UI.
3. The user runs `power-manage-agent luks set-passphrase --token <token>` on the device.
4. The agent validates the token with the control server (which hands back the active action's complexity rules), then prompts the user three times: enter, confirm, and a final "are you sure" prompt.
5. If the input clears the policy checks, the agent fetches the current managed passphrase over the mTLS stream, revokes whatever was in slot 7 previously (e.g. a stale TPM seal), and enrols the user passphrase into slot 7.
6. A SHA-256 of the user passphrase is stored locally for reuse-prevention on subsequent re-enrolments; the passphrase itself is never sent back to the server.

The managed passphrase (slots 0–6) remains the primary unlock path. The user passphrase in slot 7 is an *additional* unlock — either one opens the volume. Only the managed slot rotates on schedule.

## Examples

LUKS with TPM auto-unlock, rotate every 90 days:

```yaml
type: ENCRYPTION
preshared_key: "initial-setup-passphrase"
rotation_interval_days: 90
device_bound_key_type: TPM
desired_state: PRESENT
```

LUKS with a secondary user passphrase (laptop, BitLocker-like flow):

```yaml
type: ENCRYPTION
preshared_key: "initial-setup-passphrase"
rotation_interval_days: 180
device_bound_key_type: USER_PASSPHRASE
user_passphrase_min_length: 20
user_passphrase_complexity: COMPLEX
desired_state: PRESENT
```

## Gotchas

- The pre-shared key only matters for the very first rotation on a device. After that the agent uses its own managed passphrase. Don't reuse the PSK across many devices; it gets you owned-keyslot ownership and that's it.
- TPM enrolment is best-effort. If the device has no TPM, `device_bound_key_type=TPM` falls back to passphrase-only and logs a warning to the audit log. The action doesn't fail.
- Rotating breaks any external tools that have a saved LUKS passphrase. If you have a separate recovery key in a keyslot, it survives rotation. The managed slot is the only one that gets rewritten.
- The current managed passphrase is retrievable through the web UI's device-detail page under **Encryption** for users with the `GetDeviceLuksKeys` permission (RPC: `GetDeviceLuksKeys`). Every access is audit-logged.
- `desired_state: ABSENT` removes the agent's local state but does *not* unenroll the managed keyslot. Use `cryptsetup luksRemoveKey` manually if you need to fully decommission.
