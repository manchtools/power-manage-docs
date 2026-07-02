---
title: "LPS sealed password transport (end-to-end agent→control encryption)"
status: draft
created: 2026-07-01
---

# LPS sealed password transport

## Overview

LPS (Local Password Solution) rotated passwords currently travel agent → gateway → control as cleartext inside mTLS tunnels; the gateway process momentarily holds every rotated password in memory, and the password also sits cleartext inside the agent's result metadata. This spec seals each rotated password on the agent to a control-owned X25519 public key at the moment of generation, makes the gateway a pure opaque relay, and has control unseal at receipt before re-encrypting with the existing at-rest path. Operator recovery (`GetDeviceLpsPasswords`) is unchanged. Closes manchtools/power-manage-agent#62 (option C).

## Motivation

The events-table leak from agent#62 was already closed (gateway strips `lps.rotations`, control encrypts at rest), but the remaining exposure is real under the five-actor trust model: a compromised **gateway** reads every rotated password for every device it relays. The gateway is deliberately the least-trusted server-side actor (no DB, no encryption key); LPS passwords are the only high-value secret it can currently see in cleartext. Sealing at the agent removes the gateway from the confidentiality boundary entirely and, as a side effect, removes cleartext passwords from the agent's own result pipeline.

## Design summary

- **Primitive** (SDK `crypto`): ECIES-style seal — ephemeral X25519 + HKDF-SHA256 (mandatory domain-separation `info`) + the existing mandatory-AAD AES-256-GCM. Output: `ephemeral_pub(32) || nonce || ct || tag`. Pure stdlib (`crypto/ecdh`, `crypto/hkdf`).
- **Key ownership**: control generates one X25519 keypair at boot (first instance wins under an advisory lock), stores it in a new single-row `lps_keypair` table with the private key encrypted by the existing at-rest encryptor (`enc:v2`, AAD-bound). Multi-instance control shares it via Postgres.
- **Distribution**: the sync response (`SyncActionsResponse`) carries a new `LpsPublicKey{public_key, signature}` where the signature is minted by the control CA under a new WS4 signing domain `power-manage-lps-pubkey`. The agent verifies against its enrollment CA **fail-closed** before trusting — a hostile gateway cannot substitute its own key. The agent persists the verified key in its store settings (same pattern as the maintenance window).
- **Sealing point** (agent `lps.go`): generate password → **seal** → set OS password → record state. AAD = `device_id|action_id|username`; HKDF info = `power-manage-lps-password:v1`. If no verified public key is stored, the LPS action fails **before any rotation**. If sealing fails, that user's password is not rotated.
- **Wire**: metadata JSON entries carry `sealed_password` (base64) instead of `password`; the gateway base64-decodes into the re-typed proto field `LpsPasswordRotation.sealed_password bytes = 2` (clean break, re-tagged in place per project proto policy) and relays without the ability to read.
- **Receipt** (control `ProxyStoreLpsPasswords`): unseal with the private key + reconstructed AAD, then the existing `EncryptWithContext` at-rest path, event append, projection, and recovery RPC — all unchanged downstream.

### Compatibility (paired 2026.07 release, clean break)

- **Old agent (≤2026.06) + new server**: the gateway drops legacy cleartext entries with an ERROR log naming device and usernames ("agent predates sealed LPS transport"). The local rotation already happened; it becomes centrally recoverable again at the first post-upgrade rotation. No cleartext is ever proxied.
- **New agent + old server**: no public key arrives in sync → LPS actions fail with an explicit error, no rotation happens, nothing is sent. Fail-closed.

## Acceptance criteria

SDK (`crypto`, `verify`):

1. Given a recipient X25519 public key, when `SealToPublicKey(pub, plaintext, aad, info)` runs with non-empty inputs, then the output is `32-byte ephemeral key || AEAD blob` and `OpenWithPrivateKey(priv, sealed, aad, info)` returns the exact plaintext.
2. Given a sealed blob, when any single byte (ephemeral key, nonce, ciphertext, tag) is tampered, or the AAD differs, or the info differs, or a different private key is used, then `OpenWithPrivateKey` returns an error and no plaintext.
3. Given empty `aad` or empty `info`, when sealing or opening, then the call is refused by construction (no naked calls).
4. Given the same plaintext sealed twice to the same key, then the two outputs differ (fresh ephemeral key + nonce per call).
5. Given a blob shorter than the minimum sealed length, when opening, then a malformed-input error is returned (not a panic, not a generic auth failure).
6. Given the new `power-manage-lps-pubkey` signing domain, then the sdk/verify completeness guard discovers it, its canonical encoder clears the signature field and is deterministic, and a signature minted for any other domain fails verification under it.

Server:

7. Given an empty database, when control boots, then exactly one `lps_keypair` row exists with the private key stored only in `enc:v2` encrypted form; when N concurrent ensure calls race, then still exactly one row exists and all callers load the same key.
8. Given a stored keypair, when `ProxySyncActions` responds, then the response carries the stored public key with a CA signature that verifies under `power-manage-lps-pubkey`.
9. Given a rotation sealed by the SDK primitive to the stored public key, when `ProxyStoreLpsPasswords` processes it, then the appended event's at-rest ciphertext decrypts to the original password and `GetDeviceLpsPasswords` returns it to an authorized operator (end-to-end).
10. Given a sealed_password that does not unseal (tampered, sealed to a different key, or sealed with a different device/action/username AAD), when `ProxyStoreLpsPasswords` processes it, then the request is rejected with an invalid-argument error, no event is appended for that entry, and no secret material is logged.
11. Given a legacy cleartext rotation entry in agent metadata, when the gateway parses it, then the entry is dropped before the internal RPC with an ERROR log naming device and username — never proxied, never enqueued.
12. Given a device bound to a different gateway, when `ProxyStoreLpsPasswords` is called, then the existing device→gateway binding check still rejects it (regression pin).

Agent:

13. Given a sync response with a validly-signed `lps_public_key`, when the agent processes it, then the key is persisted in the agent store and the next LPS execution seals with it.
14. Given a sync response whose `lps_public_key` signature does not verify against the enrollment CA, when the agent processes it, then the key is refused, any previously-stored key is kept, and an error is logged.
15. Given no stored public key, when an LPS action executes, then it fails with an explicit error before any `SetPassword` call, state write, or metadata emission.
16. Given a stored key, when a rotation occurs, then `lps.rotations` metadata entries contain `sealed_password` (base64) and no cleartext password appears in metadata, stdout, or the agent result store.
17. Given a sealing failure for one user, when the LPS loop processes that user, then that user's OS password is NOT changed (seal-before-set ordering) and the action reports the error.

## Out of scope

- **LPS keypair rotation.** V1 pins one long-lived keypair; rotating it (re-signing, agent cache invalidation, unsealing old blobs) is a follow-up spec. The single-row table and signed-distribution design leave room for it.
- **LUKS passphrase transport.** `StoreLuksKey` has the same gateway-visible cleartext shape; the primitive and key distribution built here make sealing it a small follow-up (tracked separately).
- **At-rest format changes.** Stored events keep the existing `enc:v2` symmetric encryption; recovery RPC, projections, and web are untouched.
- **Re-encryption of historical events.**

## Technical design

### Affected packages

- `sdk/crypto` — new `seal.go`: `GenerateX25519`, `ParseX25519PublicKey`, `SealToPublicKey`, `OpenWithPrivateKey` (stdlib `crypto/ecdh` + `crypto/hkdf`, reuses `SealWithAAD`/`OpenWithAAD`).
- `sdk/verify` — new `LpsPublicKeySignatureDomain = "power-manage-lps-pubkey"` + `LpsPublicKeyCanonical` encoder (WS4 pattern; completeness guard picks it up automatically).
- `sdk/proto/pm/v1/agent.proto` — new `LpsPublicKey` message; `SyncActionsResponse.lps_public_key = 6`.
- `sdk/proto/pm/v1/internal.proto` — `LpsPasswordRotation.password string` → `sealed_password bytes` (re-tag field 2 in place).
- `server/internal/store` — migration: single-row `lps_keypair` table; sqlc queries get/insert.
- `server/internal/api` — boot-time `EnsureLpsKeypair` (advisory-locked), signed-pubkey attachment in `ProxySyncActions`, unseal in `ProxyStoreLpsPasswords`.
- `server/internal/handler` — gateway `proxyLpsRotations` parses `sealed_password` base64, drops legacy entries loudly.
- `agent/internal/scheduler` — verify+persist `lps_public_key` from sync (maintenance-window pattern).
- `agent/internal/executor/lps.go` — fail-closed key precondition; seal-before-set; base64 metadata.
- `web` — no change.

### Proto changes

```proto
// agent.proto
message LpsPublicKey {
  // 32-byte X25519 public key agents seal LPS passwords to.
  // @gotags: validate:"required,len=32"
  bytes public_key = 1;
  // Control-CA signature over the canonical form (signature field
  // cleared, deterministic marshal) under the power-manage-lps-pubkey
  // domain. Agents verify against the enrollment CA; fail closed.
  // @gotags: validate:"required,min=1,max=1024"
  bytes signature = 2;
}
// SyncActionsResponse: LpsPublicKey lps_public_key = 6;

// internal.proto — LpsPasswordRotation field 2 re-typed:
//   string password = 2  →  bytes sealed_password = 2
// @gotags: validate:"required,min=61,max=4096"
// (61 = 32 ephemeral || 12 nonce || ≥1 ct || 16 tag)
```

### Database changes

One migration: `lps_keypair(id TEXT PRIMARY KEY CHECK (id = 'global'), private_key_enc TEXT NOT NULL, public_key BYTEA NOT NULL, created_at ...)`. Infrastructure state, not domain state: no event, no projection (same category as the reconciler-owned seed). Down migration drops the table.

## Security considerations

- **Key separation**: the CA (ECDSA, signing) never encrypts; the LPS key (X25519, encryption) never signs. The pubkey's authenticity chains to the CA via the WS4 domain signature.
- **Fail-closed everywhere**: agent without key → no rotation; unverifiable key → refused; unsealable blob → rejected, nothing stored; sealing failure → password not rotated.
- **AAD binding** `device_id|action_id|username` means a blob replayed under another device/action/user fails authentication at control.
- **No secrets in logs**: sealed blobs, plaintexts, and private keys never appear in log fields; log usernames/device IDs only.
- **Nonce/ephemeral hygiene**: fresh ephemeral scalar and fresh AEAD nonce per seal, both from `crypto/rand`, fail-closed on RNG error.
- **Private key at rest**: only ever stored `enc:v2`-encrypted under the master key; never logged; loaded into memory at boot.
- **Permanent-failure semantics**: unseal failures are invalid-argument (non-retryable) — a tampered blob must not put the inbox into an infinite retry loop.

## Test requirements

- SDK: unit tests for criteria 1–6 (tamper matrix table-driven; completeness guard is self-discovering).
- Server: testcontainer tests for 7–12 — concurrent ensure race, sync-response signature verification, full seal→store→recover E2E using the real SDK primitive, tamper/cross-AAD rejection, legacy-entry drop at the gateway handler, binding regression.
- Agent: unit tests (fake runner where OS mutation is involved, real seams elsewhere) for 13–17, including the ordering pin (seal failure ⇒ no SetPassword) and metadata-shape assertion (no `password` key present).

## Rejection paths

| # | Failure | Where | Error / behavior | Logged context |
|---|---------|-------|------------------|----------------|
| R1 | LPS action runs with no stored public key | agent executor | action fails, exit non-zero, no rotation | action_id, "no control LPS public key; sync first" |
| R2 | Sync delivers key with bad CA signature | agent scheduler | key refused, previous kept | device-side error log, signature domain |
| R3 | Seal fails (RNG/key parse) | agent executor | user skipped BEFORE SetPassword; action reports error | username, error |
| R4 | Legacy cleartext entry from old agent | gateway | entry dropped, never proxied | device_id, username, "agent predates sealed LPS transport" |
| R5 | sealed_password fails validation (len bounds) | control interceptor + handler | invalid-argument | field violation |
| R6 | Unseal fails (tamper / wrong AAD / wrong key) | control handler | invalid-argument, no event appended, no retry loop | device_id, action_id, username |
| R7 | At-rest encrypt or event append fails | control handler | internal (retryable) — existing behavior | existing fields |
| R8 | Device→gateway binding mismatch | control handler | existing binding rejection (regression-pinned) | existing fields |
