---
title: "LUKS passphrase sealed transport (agent→control)"
status: implemented
created: 2026-07-04
updated: 2026-07-09
---

# LUKS passphrase sealed transport

## Overview

LUKS device passphrases travel agent → gateway → control as **cleartext** inside
`InternalStoreLuksKeyRequest.passphrase` (mTLS-protected on the wire, but the
gateway process momentarily holds every passphrase). This is the **identical**
gateway-cleartext exposure that spec 18 closed for LPS passwords. This spec
applies the same seal: the agent seals each passphrase to the control-owned
X25519 key at generation, the gateway relays opaque bytes, and control unseals at
receipt before re-encrypting at rest. Closes agent#165.

## Motivation

Under the five-actor trust model the **gateway is the least-trusted server-side
actor** (no DB, no encryption key). After spec 18, LPS passwords no longer cross
it in cleartext — but LUKS passphrases still do, leaving the gateway able to read
every device's disk-encryption secret it relays. This is the last known
gateway-cleartext secret of its class. At-rest encryption already protects the
stored key (WS10); this closes the *in-transit past the gateway* gap.

## Design summary

Reuse the spec-18 machinery wholesale — a new key is **not** needed:

- **Primitive**: the existing `crypto.SealToPublicKey` / `OpenWithPrivateKey`
  (ephemeral X25519 + HKDF-SHA256 + mandatory-AAD AES-GCM), SDK #263.
- **Key**: the existing control X25519 keypair (`lps_keypair`, now event-sourced
  per #498) — same distributed, CA-signed public key the agent already verifies
  and caches for LPS.
- **Domain separation**: a **distinct** HKDF info `power-manage-luks-passphrase:v1`
  and AAD `device|action|"luks"`, so a LUKS-sealed blob can't be confused with an
  LPS-sealed one.
- **Wire**: re-type `InternalStoreLuksKeyRequest.passphrase string` →
  `sealed_passphrase bytes` (clean break, re-tagged in place per proto policy);
  the gateway base64-relays without the ability to read.
- **Receipt**: control unseals with the private key + reconstructed AAD, then the
  existing at-rest path (the single `enc:v1` AAD format from spec 20).

## Acceptance criteria

1. Given the control public key (already distributed for LPS), when the agent
   stores a LUKS passphrase, then it seals the passphrase with
   `SealToPublicKey(pub, passphrase, aad="device|action|luks",
   info="power-manage-luks-passphrase:v1")` and sends `sealed_passphrase` bytes —
   no cleartext passphrase leaves the agent.
2. Given a sealed passphrase, when `ProxyStoreLuksKey` receives it, then control
   unseals with the private key + reconstructed AAD, re-encrypts at rest, and the
   downstream projection / `GetDeviceLuksKeys` retrieval is unchanged
   (end-to-end).
3. Given a `sealed_passphrase` that does not unseal (tampered, wrong key, or wrong
   device/action AAD), when control processes it, then it is rejected with an
   invalid-argument error, nothing is stored, and no secret material is logged.
4. Given a LUKS blob sealed with the LPS info/AAD (or vice versa), when unsealed
   under the LUKS domain, then it fails — the distinct info/AAD enforces domain
   separation.
5. Given no verified control public key cached, when a LUKS store is attempted,
   then it fails closed **before** sending — no cleartext fallback.
6. Given a device bound to a different gateway, when `ProxyStoreLuksKey` is
   called, then the existing device→gateway binding check still rejects it
   (regression pin).

## Out of scope

- LPS transport (spec 18, shipped).
- The at-rest format itself (spec 20).
- Any new keypair or signing domain (reuse LPS's).

## Technical design

### Affected packages

- `sdk/proto/pm/v1/internal.proto` — re-type `passphrase` →
  `sealed_passphrase bytes` (`@gotags validate:"required,min=…"`).
- `sdk/crypto` — reuse `SealToPublicKey`/`OpenWithPrivateKey`; add the LUKS
  info/AAD constants (single construction site, mirroring `SealLpsPassword`).
- `agent` — seal in the LUKS store path before send; fail closed without a key.
- `server/internal/api` / `internal/handler` — `ProxyStoreLuksKey` unseals; the
  gateway relays opaque.

### New dependencies

None.

## Security considerations

- **Gateway removed from the LUKS confidentiality boundary** — it relays opaque
  bytes.
- **Domain separation** via distinct info/AAD prevents cross-use with LPS.
- **Fail-closed**: no key → no store, no cleartext fallback; unseal failure →
  reject, no partial store, no secret logged.
- **Compatibility (paired release, clean break)**: old agent + new server → the
  gateway drops legacy cleartext with a loud ERROR (never proxied); new agent +
  old server → no key arrives, store fails closed. Mirrors spec 18.

## Test requirements

- SDK: seal/open round-trip with LUKS info/AAD; tamper/wrong-key/wrong-AAD →
  error; cross-domain (LPS↔LUKS) → error.
- Server: sealed store end-to-end (retrieval returns the original passphrase);
  bad seal → InvalidArgument, nothing stored, no secret logged; device-binding
  regression.
- Agent: seals before send; no-key → fail closed; no cleartext in metadata/logs.

## Rejection paths

| Scenario | Error code | Notes |
|---|---|---|
| `sealed_passphrase` won't unseal | InvalidArgument | tampered/wrong-key/wrong-AAD; nothing stored |
| No verified control key at agent | (agent error, pre-send) | fail closed, no cleartext |
| Legacy cleartext from old agent | (gateway drop + ERROR) | never proxied |
| Cross-domain blob (LPS info on LUKS) | InvalidArgument | domain separation |
| Wrong-gateway device binding | (existing binding reject) | regression pin |

## Rollout and migration

- Paired release; beta reprovision aligns with spec 20. No historical
  re-encryption (append-only log; the at-rest copy is already encrypted).

## Audit findings

- **F-15 (coordinate, not owned here)** — `luks_keys` uses `uuid.UUID`; the
  ULID migration is owned by spec 20 (which reprovisions the LUKS domain). This
  spec is transport-only; it should land coordinated with spec 20's LUKS changes.

## References

- spec 18 (LPS sealed transport — the pattern this reuses), ADR 0028.
- SDK #263 (seal primitive), #498 (lps_keypair now event-sourced).
- agent#165; spec 20 (at-rest format + LUKS ULID, coordinate).
