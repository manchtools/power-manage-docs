# ENCRYPTION (LUKS / GELI / CGD)

Rotates the passphrase on an encrypted root volume. The agent generates a new passphrase, enrols it in the encryption backend's keyslot, optionally enrols a device-bound key (TPM), and ships the managed passphrase back to the control server for recovery.

Default backend is LUKS on Linux. GELI (FreeBSD) and CGD (NetBSD) are supported through the same interface.

## Parameters

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `preshared_key` | string | yes | — | Pre-shared passphrase used for initial ownership. Once the agent has rotated to a managed passphrase, the PSK is no longer needed. 1–256 chars. |
| `rotation_interval_days` | int32 | yes | — | Days between scheduled passphrase rotations. 1–365. |
| `min_words` | int32 | no | `5` | Minimum word count in the generated passphrase. 3–10. |
| `device_bound_key_type` | enum | no | `NONE` | `NONE` (passphrase only), `TPM` (TPM2 auto-unlock), or `USER_PASSPHRASE` (a user-supplied secondary passphrase). |
| `user_passphrase_min_length` | int32 | no | `16` | Min length for the user passphrase. 16–128. Only used when `device_bound_key_type=USER_PASSPHRASE`. |
| `user_passphrase_complexity` | enum | no | `ALPHANUMERIC` | `ALPHANUMERIC` or `COMPLEX`. Only used when `device_bound_key_type=USER_PASSPHRASE`. |
| `backend` | enum | no | `LUKS` | `LUKS`, `GELI`, or `CGD`. |

## Idempotency

The agent auto-detects the primary encrypted volume on first run. Subsequent runs:

1. Check the local rotation-state store. If never managed, take ownership using `preshared_key`, generate a managed passphrase, enrol it, and send it back to the control server.
2. If managed and within the rotation interval, no-op.
3. If the rotation interval elapsed, derive a new passphrase, swap keyslots atomically (new slot enrolled before the old slot is wiped), and send the new value back.

The TPM enrolment (when `device_bound_key_type=TPM`) goes into a dedicated keyslot (slot 7 for LUKS) and isn't rotated on schedule. The TPM seal stays valid as long as PCRs haven't changed.

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
- The current managed passphrase is retrievable through the web UI's device-detail page under **Encryption** for users with the `ReadEncryptionPassphrase` permission. Every access is audit-logged.
- `desired_state: ABSENT` removes the agent's local state but does *not* unenroll the managed keyslot. Use `cryptsetup luksRemoveKey` manually if you need to fully decommission.
