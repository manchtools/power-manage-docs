---
title: "At-rest encryption: single AAD format + ULID consolidation"
status: approved
created: 2026-07-04
---

# At-rest encryption: single AAD format + ULID consolidation

## Overview

At-rest secret encryption currently ships **two** on-disk formats: `enc:v1`
(nil-AAD, used for IdP client secrets and TOTP secrets) and `enc:v2` (AAD-bound,
used for LPS/LUKS/the LPS keypair). This spec collapses them into a **single
AAD-bound format** tagged `enc:v1`, migrating IdP and TOTP secrets onto
context-bound AAD (finishing the WS10 deferral / audit F-06) and removing the
naked nil-AAD path entirely. While reprovisioning the same at-rest-secret
domains, it **also** migrates the `luks_keys` and `security_alerts` identifiers
from `uuid.UUID` to **ULID** (audit F-15) — the project's mandatory ID scheme —
which the Path-A reprovision makes free (no data backfill). It is a deliberate
beta-window breaking change (Path A: reprovision, no dual-read shim), and a
prerequisite for spec 19, whose per-user DEK envelope wraps under this one format.

## Motivation

A wire-format version number should mark a genuine incompatible crypto change,
not a mid-beta functionality iteration. `enc:v2` was introduced to *add* AAD
binding (ADR 0009) while `enc:v1` lingered for the deferred IdP/TOTP cases —
leaving two formats, a public naked `Encrypt`/`Decrypt` that invites new nil-AAD
call sites (audit F-06), and a violation of the repo's own rule that "all crypto
calls carry domain-separation info tags." In beta we can break and consolidate:
one AAD-bound format, no legacy path, no naked API. This also closes the last
un-bound at-rest secrets before spec 19 layers per-user DEKs on top.

## Audit findings addressed

From `server/TECH_DEBT_AUDIT.md` (2026-07-04):

- **F-06 (Medium, closed here)** — IdP client secrets and TOTP secrets use
  `Encrypt`/`Decrypt` without AAD context while LPS/LUKS use `enc:v2` AAD binding;
  a ciphertext can be swapped across rows/contexts undetected, and the public
  naked API invites new nil-AAD call sites. This spec migrates both domains to
  row-bound AAD, removes the naked API, and unifies the format — the WS10
  deferral's resolution.
- **F-05 (coordination)** — the same `idp_handler.go` (4 sites),
  `totp_handler.go` (6), `sso_handler.go` (2) that this spec re-encrypts *also*
  emit `map[string]any` event payloads that #507 (typed-payloads prerequisite)
  converts to `eventtypes/payloads` structs. Same files: sequence so they don't
  collide, and the typed structs make the row-bound AAD (`idp_id` / `user_id`)
  cleaner to derive. This spec depends on #507 landing (or landing together) so
  the AAD binding reads the identity from a typed field, not a map lookup.
- **F-15 (Low, closed here)** — `luks_keys` and `security_alerts` use `uuid.UUID`
  vs the project's **mandatory** ULID rule ("IDs use ULID, never UUID"). This is
  not a defer-able open question — it's a rule violation. Because this spec
  already reprovisions those at-rest-secret domains (Path A, fresh DB, no
  backfill), migrating their IDs to ULID is nearly free and belongs here rather
  than waiting for a hypothetical later schema-touching release.

## Acceptance criteria

1. Given the at-rest encryptor, when it encrypts any secret, then the output
   carries the single prefix `enc:v1` and is AAD-bound AES-256-GCM; there is no
   nil-AAD code path and no second prefix.
2. Given an IdP client secret, when it is stored, then it is encrypted with an
   AAD bound to its identity-provider row (e.g. `idp_id` + purpose), and reading
   it with a mismatched AAD (different provider / purpose) fails.
3. Given a TOTP secret, when it is stored, then it is encrypted with an AAD bound
   to its user row (e.g. `user_id` + purpose), and reading it with a mismatched
   AAD fails.
4. Given the crypto package, when the build runs, then the naked `Encrypt` /
   `Decrypt` (nil-AAD) functions are unexported or removed, and a guard test
   fails the build on any production call site that encrypts without an AAD.
5. Given a stored ciphertext, when decrypted, then only the AAD-bound path exists
   — the former `enc:v1` legacy nil-AAD fallback in `DecryptWithContext` is gone.
6. Given an existing (pre-change) deployment, when upgraded, then it is
   reprovisioned (Path A) — documented; no backfill job and no dual-read shim are
   provided (beta).
7. Given `luks_keys` and `security_alerts`, when a new row is created, then its
   identifier is a **ULID** (`ulidx`), not a `uuid.UUID`; no production code path
   mints a UUID for these domains (F-15).
8. Given the repo, when the ID-scheme guard runs, then no production code
   generates a `uuid.UUID`/`gen_random_uuid()` identifier for a domain row — a
   self-discovering check so a third domain can't copy the UUID pattern.

## Out of scope

- **Hard KEK rotation** (ADR 0001) — the envelope/DEK rotation story is spec 19 /
  its follow-on; this spec only unifies the ciphertext format.
- **Per-user DEK envelope** — spec 19.
- Any non-secret data.

## Technical design

### Affected packages

- `server/internal/crypto` — collapse to one AAD-bound format under prefix
  `enc:v1`; drop the nil-AAD encrypt path and the legacy decrypt fallback;
  unexport the naked API.
- `server/internal/api` — IdP (`idp_handler.go`, `sso_handler.go`) and TOTP
  (`totp_handler.go`) encrypt/decrypt call sites move to `EncryptWithContext` /
  `DecryptWithContext` with a row-bound AAD.
- `server/internal/store/luks.go`, `server/internal/projectors/security_alert.go`
  (+ their migrations/queries) — mint `ulidx` identifiers instead of `uuid.UUID`
  (F-15). Path-A reprovision means the migration is a code + schema change with no
  data backfill.
- A `uuid`-usage guard (archtest-style, self-discovering) so no domain mints a
  UUID identifier.

### Crypto changes

- One format: AAD-bound AES-256-GCM, `enc:v1:<base64(nonce‖ciphertext)>`.
- AAD dimensions: LPS/LUKS keep `device|action|type`; IdP binds `idp_id|purpose`;
  TOTP binds `user_id|purpose` (mirrors `SecretAAD`'s shape).
- Remove `Encrypt`/`Decrypt` (nil-AAD) from the public API; the only entry points
  are the context-bound ones.
- A guard test (archtest-style) asserts no production code calls a nil-AAD
  encrypt.

### New dependencies

None.

## Security considerations

- **Domain separation everywhere.** Every at-rest secret is now context-bound;
  a ciphertext cannot be swapped across rows/contexts without detection —
  satisfying the repo rule and closing F-06. Removing the naked API prevents
  regression to nil-AAD.
- **No secrets logged**; ciphertext prefixes/AAD dimensions are not sensitive.
- **Beta breaking change.** Reprovision is the migration; no plaintext ever
  written. A non-reprovisioned environment fails to decrypt old `enc:v2`/nil-AAD
  data loudly (documented), never silently returns wrong plaintext.

## Test requirements

- Round-trip per domain (IdP, TOTP, LPS, LUKS) with correct AAD → plaintext;
  wrong AAD → error; tampered ciphertext → error.
- Guard: no production nil-AAD encrypt call site (F-06 anti-regression).
- Format: every encrypt emits `enc:v1`; no code path emits a second prefix or a
  nil-AAD blob.
- ID scheme: `luks_keys`/`security_alerts` rows mint ULIDs (F-15); the
  self-discovering `uuid`-usage guard fails on any domain minting a UUID.

## Rejection paths

| Scenario | Error code / behavior | Notes |
|---|---|---|
| Decrypt with wrong AAD (cross-row/context) | error, no plaintext | GCM auth failure |
| Decrypt tampered ciphertext | error, no plaintext | GCM auth failure |
| Decrypt legacy `enc:v2`/nil-AAD blob post-change (un-reprovisioned) | error, loud | Path A requires reprovision |
| Any new nil-AAD encrypt call site | build fails (guard) | F-06 anti-regression |

## Rollout and migration

- **Path A (beta):** reprovision the deployment; existing encrypted data is
  discarded. No backfill, no dual-read. (A future non-beta consolidation would
  specify a lazy re-encrypt-on-read migration as WS5 did for `enc:v2`.)
- Sequences **before** spec 19 (its DEKs wrap under this format).

## References

- ADR 0009 — at-rest AAD binding (this spec supersedes its dual-version framing
  with a single AAD-bound format; amend or write a short superseding ADR).
- ADR 0001 — key rotation (separate).
- `server/TECH_DEBT_AUDIT.md` — F-06 (closed here), F-15 (closed here — mandatory
  ULID rule), F-05 (#507, coordinated — same idp/totp/sso handlers).
- server#504 (this spec); server#507 (F-05 typed payloads — coordinate/sequence
  together); WS10 deferral.
- spec 19 (depends on this).
