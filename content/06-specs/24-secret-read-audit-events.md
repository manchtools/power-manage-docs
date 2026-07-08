---
title: "Audit events for secret reads (LPS / LUKS)"
status: draft
created: 2026-07-04
updated: 2026-07-08
---

# Audit events for secret reads (LPS / LUKS)

## Overview

`GetDeviceLpsPasswords` and `GetDeviceLuksKeys` return **decrypted** credential
material to an authorized operator but append **no audit event** — there is no
record of who retrieved which device's password/key, when. This spec adds
`LpsPasswordsViewed` / `LuksKeysViewed` audit events on the success path of each
read (no secret material in the payload), surfaced in `ListAuditEvents`. It is
the read-side complement to the write-side audit-completeness work (#496) and
closes server#494.

## Motivation

Retrieving a device's break-glass password or LUKS key is one of the most
security-sensitive operations in the product, and it is exactly the class of
access a NIS2/SOC 2 audit expects to be logged (cf. LAPS password-retrieval
auditing in AD). The project rule "every state-changing RPC is audit-logged"
doesn't reach reads — but secret-returning reads are the standard exception where
read auditing is required. Both docs pages previously *claimed* this auditing
existed; this makes it true.

## Acceptance criteria

1. Given an authorized `GetDeviceLpsPasswords`, when it returns, then an
   `LpsPasswordsViewed` event is appended (actor, device, timestamp, and *which*
   entries were returned by username/rotation-id — **never** the password),
   before the response.
2. Given an authorized `GetDeviceLuksKeys`, when it returns, then a
   `LuksKeysViewed` event is appended (actor, device, timestamp, key identifiers —
   **never** the passphrase).
3. Given a read rejected **at the handler** (out-of-scope → NotFound, absent
   device, decrypt failure), when it fails, then a `LpsPasswordsViewDenied` /
   `LuksKeysViewDenied` event is appended (actor, requested device, reason —
   never any secret material) and **no** view event — "who wanted to read it
   without access" is auditable, not just journal-logged. Reads rejected **at
   the interceptor** (unauthenticated, or the caller lacks the base permission
   entirely) never reach the handler and stay journal-only (see Out of scope —
   the interceptor cannot know the target device without parsing payloads).
   Denied-event appends are best-effort like the view events (`AUDIT GAP` on
   failure) and never change the caller-visible NotFound response.
4. Given the view events, when `ListAuditEvents` is queried, then they appear
   with the actor/device/time and are covered by the read-side redaction schema
   (no secret material can leak through the audit API).
5. Given a successful read, when it appends the event, then exactly **one**
   event is appended per call, listing the returned identifiers. (**Pinned
   2026-07-08**: per-call. Each call returns one key/password set, so per-call
   IS the natural forensic unit; per-entry is rejected as noise.)

## Out of scope

- Auditing interceptor-tier authorization failures as EVENTS, across all RPCs.
  Those denials (missing base permission, unauthenticated) are logged to the
  journal by the RPC logging interceptor — procedure, request_id, user_id when
  authenticated, code, duration, client metadata — but carry **no target
  device** (the interceptor never parses payloads), and making it payload-aware
  per-RPC is a whole subsystem. AC 3 deliberately carves out the two
  secret-read RPCs at the HANDLER tier, where the target device is known; the
  generic case stays out.
- Changing the read RPCs' authorization (unchanged).

## Technical design

### Affected packages

- `server/internal/eventtypes` (+ `payloads`) — `LpsPasswordsViewed`,
  `LuksKeysViewed`, `LpsPasswordsViewDenied`, `LuksKeysViewDenied` typed
  payloads (identifiers/reason only, no secrets).
- `server/internal/api/device_handler.go` — append on the success path of
  `GetDeviceLpsPasswords` / `GetDeviceLuksKeys` (after authz + decrypt, before
  returning); an append failure logs `AUDIT GAP` but does not fail the read (the
  material was already returned — same contract as the #496 dispatch audits).
- Redaction schemas — ensure the new event types carry no secret material and
  are covered.

### Database changes

- Two new event types (audit-only; they record a *view*, not a domain mutation —
  the events table is the audit log). These are reads that voluntarily append;
  the #498 append-completeness guard classifies them as reads and does not
  require it, but does not forbid it.

### New dependencies

None.

## Security considerations

- **No secret material in payloads** — identifiers only; redaction-schema pinned.
- **Best-effort append after a successful read**: the credential was already
  handed to the authorized caller, so a post-read append failure is logged loudly
  (`AUDIT GAP`) but cannot un-return the secret — mirrors the #496 contract.
- **Reads are low-frequency** (an operator retrieving a break-glass secret), so
  auditing every read carries no noise concern.

## Test requirements

- Success → exactly one view event with correct actor/device/identifiers, no
  secret material; `ListAuditEvents` shows it; redaction verified.
- Handler-tier rejection (out-of-scope NotFound / absent device / decrypt
  failure) → zero VIEW events, exactly one DENIED event with actor + requested
  device + reason, and the caller response unchanged (still NotFound — the
  denied event must not create an existence oracle).
- Interceptor-tier rejection (unauthenticated / missing base permission) →
  zero events of either kind (journal-only).
- Payload never contains a password/passphrase (assert on the stored event).

## Rejection paths

| Scenario | Error code | Client message | Logged context |
|---|---|---|---|
| Unauthenticated read | Unauthenticated | (interceptor) | method, remote |
| Wrong role / out-of-scope | NotFound | "device not found" | actor, device |
| Decrypt failure on stored material | Internal | "failed to decrypt" | device, "no view event appended" |
| View append fails post-read | (log `AUDIT GAP`) | (read still succeeds) | actor, device, error |

## Rollout and migration

- Additive: two event types + append calls. No migration.

## Rider (same PR)

- Fix the stale comment in `internal/scim/handler.go` ("Discovery endpoints (no
  auth required)") — all three discovery routes are wrapped in `withAuth`; the
  code is correct, the comment lies (audit-adjacent doc fix from the docs sync).

## Audit findings

No `TECH_DEBT_AUDIT.md` finding is specific to this (it was tracked separately as
#494). Related: the write-side audit-completeness guard (#496/#498) covers
mutations; this covers the secret-returning-read exception the guard intentionally
does not.

## References

- server#494; the #496 dispatch-audit pattern (best-effort post-action append).
