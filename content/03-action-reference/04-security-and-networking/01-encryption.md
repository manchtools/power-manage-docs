---
title: ENCRYPTION
label: ENCRYPTION (LUKS)
---
# ENCRYPTION (LUKS)

Rotates the passphrase on an encrypted root volume. The agent generates a new passphrase, enrols it in a LUKS keyslot, optionally enrols a device-bound key (TPM or user-chosen passphrase), and ships the managed passphrase back to the control server for recovery.

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#EncryptionBackend:c13a7b0c,agent:internal/executor/per_user.go#mustEncManager:0ed309db,sdk:sys/encryption/encryption.go#New:ba4f9552 -->
> **GELI and CGD are abstraction placeholders, not shipping backends.** The proto carries `GELI` (FreeBSD) and `CGD` (NetBSD) enum values to keep the interface neutral as those platforms come into scope. The agent currently **ignores the `backend` field entirely** and always drives cryptsetup/LUKS — the SDK's encryption constructor fails closed on any non-LUKS backend, and the agent only ever builds the LUKS one. Selecting GELI or CGD today does not error; it just gets you LUKS behaviour. Treat the backend dimension as "LUKS only".
<!-- docref: end -->

## Parameters

<!-- docref: begin src=sdk:proto/pm/v1/actions.proto#EncryptionParams:affc49f3,sdk:proto/pm/v1/actions.proto#EncryptionDeviceBoundKeyType:c35263d8 -->
| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `preshared_key` | string | yes | — | Pre-shared passphrase used for initial ownership. Once the agent has rotated to a managed passphrase, the PSK is no longer needed. 1–256 chars. |
| `rotation_interval_days` | int32 | yes | — | Days between scheduled passphrase rotations. 1–365. |
| `min_words` | int32 | no | `5` | Minimum word count in the generated passphrase. 3–10. |
| `device_bound_key_type` | enum | no | `NONE` | `NONE` (passphrase only), `TPM` (TPM2 auto-unlock), or `USER_PASSPHRASE` (a user-supplied secondary passphrase). |
| `user_passphrase_min_length` | int32 | no | `16` | Min length for the user passphrase. 16–128. Only used when `device_bound_key_type=USER_PASSPHRASE`. |
| `user_passphrase_complexity` | enum | no | `ALPHANUMERIC` | `ALPHANUMERIC` or `COMPLEX`. Only used when `device_bound_key_type=USER_PASSPHRASE`. |
| `backend` | enum | no | `LUKS` | `LUKS` is the only implemented value. `GELI` and `CGD` are reserved enum slots; the agent ignores the field today. |
<!-- docref: end -->

<!-- docref: begin src=sdk:sys/encryption/passphrase.go#GeneratePassphrase:071b3df0 -->
Generated managed passphrases are word-based: at least `min_words` capitalised words joined by `-` and at least 32 chars total (e.g. `Apple-Tower-Kitchen-Forest`), drawn from `crypto/rand`.
<!-- docref: end -->

## Idempotency

<!-- docref: begin src=agent:internal/executor/luks.go#Executor.setupLuks:cc4a0407,agent:internal/executor/luks.go#Executor.takeOwnership:a185bdfd,agent:internal/executor/luks.go#Executor.checkAndRotate:f5b07eb1 -->
The agent auto-detects the encrypted volume on first run (preferring the volume the PSK unlocks, falling back to heuristic detection). Subsequent runs:

1. Check the local rotation-state store. If never managed, take ownership using `preshared_key`, generate a managed passphrase, enrol it, and send it to the control server. The old key is only removed after the server confirms — and round-trips — the new one.
2. If managed and within the rotation interval, no-op.
3. If the rotation interval elapsed, generate a new passphrase, swap keyslots (new slot enrolled and server-verified before the old slot is wiped), and send the new value back.
<!-- docref: end -->

<!-- docref: begin src=agent:internal/executor/luks.go#Executor.reconcileDeviceKey:2b0933df -->
The device-bound key (when `device_bound_key_type` is not `NONE`) is reconciled separately and isn't rotated on schedule. The TPM seal stays valid as long as PCRs haven't changed.
<!-- docref: end -->

## Keyslot layout

LUKS2 has eight slots (0–7). The agent uses them as follows:

<!-- docref: begin src=agent:internal/executor/luks.go#Executor.checkAndRotate:f5b07eb1,sdk:sys/encryption/tpm.go#tpmEnroller.Enroll:3ede22be,sdk:sys/encryption/tpm.go#tpmEnroller.Wipe:5a854081,agent:internal/luksd/protocol.go#userPassphraseSlot:7b8f34c0 -->
| Key | Slot | Set by | Lifecycle |
|---|---|---|---|
| **Managed passphrase.** The server-stored secret the agent rotates on schedule. | auto (lowest free slot) | `cryptsetup luksAddKey` without an explicit slot. | Rewritten every `rotation_interval_days`; old slot wiped only after the new one verifies. |
| **TPM device-bound key** (auto-unlock at boot). | auto — systemd-cryptenroll picks a free slot and tracks it as its `tpm2` token. | `systemd-cryptenroll --tpm2-device=auto --tpm2-pcrs=7+14`. | Set once during enrolment; removed via `--wipe-slot=tpm2`; not touched by scheduled rotation. |
| **User passphrase device-bound key.** | 7 (pinned) | `cryptsetup luksAddKey --key-slot 7` via the agent's LUKS daemon. | Set by the user through the token flow; replaced on re-enrolment; not touched by scheduled rotation. |
<!-- docref: end -->

A device with `device_bound_key_type=NONE` has no device-bound slot at all.

<!-- docref: begin src=agent:internal/executor/luks.go#Executor.takeOwnership:a185bdfd -->
The pre-shared key from the action's `preshared_key` field is consumed during the very first rotation: the agent uses it to authenticate against an existing keyslot, adds the new managed passphrase to a fresh slot, verifies the server round-trip, then wipes the PSK slot. After that, the PSK is gone from the device and not retrievable from the server.
<!-- docref: end -->

## Setting a USER_PASSPHRASE

`device_bound_key_type=USER_PASSPHRASE` is an opt-in second-factor flow. The action carries the *policy* (min length, complexity, enabled flag); the *passphrase itself* is set interactively on the device by the user, not pushed from the server.

The flow is:

1. The operator assigns an `ENCRYPTION` action with `device_bound_key_type=USER_PASSPHRASE`.
2. The operator issues the user a one-shot enrolment token from the device-detail page in the web UI.
3. The user runs `power-manage-agent luks set-passphrase --token <token>` on the device (no sudo needed — the CLI is unprivileged).
<!-- docref: begin src=agent:cmd/power-manage-agent/cmd_luks.go#promptPassphrase:e5c5840b,agent:internal/luksd/server.go#Daemon.handleRequest:6a1f4df2 -->
4. The CLI prompts enter + confirm (up to 3 attempts for a matching pair, with a 16-char floor as UX) and hands {token, passphrase} to the root agent's LUKS daemon over a local socket. The daemon validates the token via the agent's gateway session — single-use, device-bound, short-TTL — and enforces the action's min-length/complexity policy server-authoritatively, plus a reuse check against previous passphrase hashes.
5. If the input clears the policy checks, the daemon fetches the current managed passphrase over the mTLS stream, revokes whatever device-bound key existed (e.g. a stale TPM seal), and enrols the user passphrase into slot 7.
<!-- docref: end -->
<!-- docref: begin src=sdk:sys/encryption/validate.go#HashPassphrase:b7c6e027 -->
6. A SHA-512 hash of the user passphrase is stored locally (root-readable only) for reuse-prevention on subsequent re-enrolments; the passphrase itself is never sent back to the server.
<!-- docref: end -->

The managed passphrase remains the primary unlock path. The user passphrase in slot 7 is an *additional* unlock — either one opens the volume. Only the managed slot rotates on schedule.

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
<!-- docref: begin src=agent:internal/executor/luks.go#Executor.setupLuks:cc4a0407,agent:internal/executor/luks.go#Executor.enrollTpm:e3a16272 -->
- TPM enrolment is best-effort. If the device has no TPM (no `/dev/tpm0` / `/dev/tpmrm0`), the device-key reconciliation fails with "TPM2 device not found" — the failure is noted in the execution output and the agent log, but the action itself doesn't fail and the volume stays passphrase-only. It is not surfaced as a distinct audit event, so check execution output if you expect TPM auto-unlock.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/luks.go#Executor.checkAndRotate:f5b07eb1 -->
- Rotating breaks any external tools that have a saved copy of the managed LUKS passphrase. If you have a separate recovery key in another keyslot, it survives rotation. The managed slot is the only one that gets rewritten.
<!-- docref: end -->
<!-- docref: begin src=sdk:crypto/luks.go#SealLuksPassphrase:4ce5127e,agent:internal/executor/luks.go#Executor.sealLuksPassphrase:f5802d0c,server:internal/api/internal_handler.go#InternalHandler.ProxyStoreLuksKey:87fb66ea -->
- Managed passphrases are **sealed in transit** (spec 25): the agent encrypts each one to the control server's X25519 key before it leaves the device, so the relaying gateway only ever carries opaque bytes — the same transport model LPS rotation uses, under a distinct crypto domain. Without a verified control key the agent refuses to rotate (fail-closed, before any LUKS slot is touched); control rejects anything that doesn't unseal and stores nothing.
<!-- docref: end -->
<!-- docref: begin src=server:internal/api/device_handler.go#DeviceHandler.GetDeviceLuksKeys:b41f8631 -->
- The current managed passphrase (and its history) is retrievable through the web UI's device-detail page under **Encryption** via the `GetDeviceLuksKeys` RPC, gated on the dedicated `GetDeviceLuksKeys` permission. Keys are stored encrypted at rest and decrypted per request. Every retrieval is itself audited: a `LuksKeysViewed` event records who read which keys (rotation IDs and device paths only, never the passphrase), and a handler-tier denial records `LuksKeysViewDenied`.
<!-- docref: end -->
<!-- docref: begin src=agent:internal/executor/luks.go#Executor.removeLuksManagement:e6eb9e84 -->
- `desired_state: ABSENT` removes the agent's local state but does *not* unenroll the managed keyslot — the keys remain on the device. Use `cryptsetup luksRemoveKey` manually if you need to fully decommission.
<!-- docref: end -->
